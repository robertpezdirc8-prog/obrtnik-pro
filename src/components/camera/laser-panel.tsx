'use client';

// ─── Laserski merilnik: Web Bluetooth (BLE) + ročni vnos ────
// Poveže merilnik (Leica DISTO, Bosch GLM, generični BLE moduli s
// servisom FFE0/FFE1 oz. zasilno FFF0/FFF1) in samodejno posluša
// izmerke; vedno na voljo tudi ročni vnos — vse gre v isti seznam
// meritev kot fotomeritve (onAddMeasurement).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bluetooth,
  BluetoothOff,
  Check,
  Info,
  Plus,
  Ruler,
} from 'lucide-react';
import { formatCm } from '@/lib/measure-geometry';

export interface LaserPanelProps {
  /** Pokliče se ob vsakem izmerku (BLE notifikacija ali ročni vnos). */
  onAddMeasurement: (label: string, cm: number) => void;
}

// ── Minimalni tipi za Web Bluetooth (projekt nima @types/web-bluetooth) ──
interface BtCharacteristic {
  startNotifications(): Promise<BtCharacteristic>;
  stopNotifications(): Promise<BtCharacteristic>;
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (event: Event) => void,
  ): void;
}
interface BtService {
  getCharacteristic(uuid: number | string): Promise<BtCharacteristic>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: number | string): Promise<BtService>;
}
interface BtDevice {
  name?: string;
  gatt?: BtServer;
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  removeEventListener(
    type: 'gattserverdisconnected',
    listener: () => void,
  ): void;
}
interface BtApi {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: Array<string>;
  }): Promise<BtDevice>;
}
type NavigatorWithBluetooth = Navigator & { bluetooth?: BtApi };

// ── Konstante ───────────────────────────────────────────────
/** Servisi, ki jih zahtevamo od naprave (FFE0/FFF0 = tipični laserski moduli). */
const OPTIONAL_SERVICES: Array<string> = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  'device_information',
];
/** Par [servis, značka] za samodejni sprejem izmerkov (vrstni red poskusov). */
const NOTIFY_CANDIDATES: Array<[number, number]> = [
  [0xffe0, 0xffe1],
  [0xfff0, 0xfff1],
];
const CM_MIN = 1;
const CM_MAX = 50_000;

const inRange = (cm: number): boolean =>
  Number.isFinite(cm) && cm >= CM_MIN && cm <= CM_MAX;

/**
 * Iz BLE notifikacije izlušči številko: najprej besedilo (ASCII,
 * "350", "3,50"), sicer surove bajte, ki mnogi moduli pošiljajo kot
 * mm v uint16/uint32 (little-endian) → /10 na cm. Razpon lovi klicatelj.
 */
function parseLaserValue(dv: DataView): number | null {
  try {
    const text = new TextDecoder()
      .decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))
      .trim();
    const m = text.match(/\d+(?:[.,]\d+)?/);
    if (m) {
      const v = parseFloat(m[0].replace(',', '.'));
      if (Number.isFinite(v)) return v;
    }
  } catch {
    // brez berljivega besedila — poskusi surove bajte
  }
  if (dv.byteLength === 2) return dv.getUint16(0, true) / 10;
  if (dv.byteLength === 4) return dv.getUint32(0, true) / 10;
  return null;
}

export function LaserPanel({ onAddMeasurement }: LaserPanelProps) {
  // Detekcija zmožnosti (SSR-varna: navigator ne obstaja na strežniku)
  const hasBluetooth =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  const [mounted, setMounted] = useState(false); // prvi ris strežniku+odjema enak
  const [connecting, setConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // prijazna opomba (amber)
  const [info, setInfo] = useState<string | null>(null); // nevtralna opomba
  const [lastCm, setLastCm] = useState<number | null>(null);
  const [manual, setManual] = useState('');
  const [manualCount, setManualCount] = useState(0); // lokalni števec izmerkov
  const [helpOpen, setHelpOpen] = useState(false);

  const deviceRef = useRef<BtDevice | null>(null);
  const charRef = useRef<BtCharacteristic | null>(null);
  const addRef = useRef(onAddMeasurement); // vedno najnovejši prop
  const aliveRef = useRef(false); // zaščita pred setState po unmount

  useEffect(() => {
    addRef.current = onAddMeasurement;
  }, [onAddMeasurement]);

  // ── BLE: samodejni izmer iz notifikacije (stabilna identiteta) ──
  const handleNotify = useCallback((event: Event) => {
    if (!aliveRef.current) return;
    const dv = (event.target as { value?: DataView | null } | null)?.value;
    if (!dv) return;
    const v = parseLaserValue(dv);
    if (v === null) return;
    const cm = Math.round(v * 10) / 10;
    if (!inRange(cm)) return; // smiselni razpon 1–50.000 cm
    setLastCm(cm);
    setNote(null);
    addRef.current('Laser', cm);
  }, []);

  // ── BLE: naprava se je sama odjavila ──
  const handleDisconnected = useCallback(() => {
    if (!aliveRef.current) return;
    charRef.current = null;
    deviceRef.current = null;
    setDeviceName(null);
    setInfo('Merilnik je bil odjavljen.');
  }, []);

  // ── BLE: počisti poslušalce (stabilno za removeEventListener) ──
  const detachListeners = useCallback(() => {
    const char = charRef.current;
    if (char) {
      try {
        char.removeEventListener('characteristicvaluechanged', handleNotify);
      } catch {
        // značka že ni dosegljiva
      }
      charRef.current = null;
    }
    const device = deviceRef.current;
    if (device) {
      try {
        device.removeEventListener(
          'gattserverdisconnected',
          handleDisconnected,
        );
      } catch {
        // naprava že ni dosegljiva
      }
      deviceRef.current = null;
    }
  }, [handleNotify, handleDisconnected]);

  // ── BLE: uporabniška odjava ──
  const disconnectDevice = useCallback(() => {
    detachListeners();
    try {
      deviceRef.current?.gatt?.disconnect();
    } catch {
      // povezava že ne obstaja
    }
    setDeviceName(null);
    setNote(null);
    setInfo('Merilnik je odjavljen.');
  }, [detachListeners]);

  // Mount + čistitev ob unmount (brez puščanj povezave)
  useEffect(() => {
    aliveRef.current = true;
    setMounted(true);
    return () => {
      aliveRef.current = false;
      detachListeners();
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // povezava že ne obstaja
      }
    };
  }, [detachListeners]);

  // ── BLE: potek povezave ──
  const connectDevice = async (): Promise<void> => {
    setNote(null);
    setInfo(null);
    const bt = (navigator as NavigatorWithBluetooth).bluetooth;
    if (!bt) {
      setNote('Web Bluetooth ni dosegljiv — vpiši izmer ročno spodaj.');
      return;
    }
    setConnecting(true);
    try {
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: OPTIONAL_SERVICES,
      });
      if (!device.gatt) throw new Error('naprava ne podpira GATT povezave');
      device.addEventListener('gattserverdisconnected', handleDisconnected);
      deviceRef.current = device;
      const server = await device.gatt.connect();
      setDeviceName(device.name?.trim() || 'neznana naprava');

      // Samodejni sprejem izmerkov: FFE0/FFE1, zasilno še FFF0/FFF1
      let autoReceive = false;
      for (const [serviceUuid, charUuid] of NOTIFY_CANDIDATES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          const characteristic = await service.getCharacteristic(charUuid);
          await characteristic.startNotifications();
          characteristic.addEventListener(
            'characteristicvaluechanged',
            handleNotify,
          );
          charRef.current = characteristic;
          autoReceive = true;
          break;
        } catch {
          // ta servis/značka ni na voljo — poskusi naslednjega
        }
      }
      setInfo(
        autoReceive
          ? 'Samodejni sprejem izmerkov je aktiven — sproži meritev na napravi.'
          : 'Povezava je vzpostavljena, ta model pa ne pošilja izmerkov prek znanega protokola — vpiši vrednost ročno spodaj.',
      );
    } catch (err) {
      detachListeners();
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // povezava sploh ni bila vzpostavljena
      }
      deviceRef.current = null;
      setDeviceName(null);
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setNote(
          'Iskanje naprave je preklicano — ne skrbi, izmer lahko vpišeš ročno spodaj.',
        );
      } else {
        const reason = err instanceof Error ? err.message : 'neznan razlog';
        setNote(
          `Povezava z merilnikom ni uspela (${reason}). Poskusi znova ali izmeri ročno in vpiši vrednost spodaj.`,
        );
      }
    } finally {
      if (aliveRef.current) setConnecting(false);
    }
  };

  // ── Ročni vnos ──────────────────────────────────────────────
  const manualCm = (() => {
    const t = manual.trim();
    if (!t) return null;
    const v = Number(t.replace(',', '.'));
    return Number.isFinite(v) && v > 0 ? v : null;
  })();
  const canAddManual = manualCm !== null;

  const addManual = (): void => {
    if (manualCm === null) return;
    const cm = Math.round(manualCm * 10) / 10;
    if (!inRange(cm)) {
      setNote('Vrednost naj bo v razponu 1–50.000 cm.');
      return;
    }
    setNote(null);
    addRef.current(`Laser ${manualCount + 1}`, cm);
    setManualCount((c) => c + 1);
    setManual('');
  };

  return (
    <div className="space-y-3 rounded-xl border p-4">
      {/* Glava */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Laserski merilnik</h3>
        </div>
        {deviceName && (
          <Badge
            variant="outline"
            className="border-green-300 bg-green-50 text-green-700"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            Povezano: {deviceName}
          </Badge>
        )}
      </div>

      {/* BLE povezava */}
      <Button
        type="button"
        onClick={deviceName ? disconnectDevice : () => void connectDevice()}
        disabled={!mounted || !hasBluetooth || connecting}
        variant={deviceName ? 'outline' : 'default'}
        className="min-h-11 w-full sm:w-auto"
        aria-label={
          deviceName
            ? `Prekini povezavo z merilnikom ${deviceName}`
            : 'Poveži laserski merilnik prek Bluetootha'
        }
      >
        {deviceName ? (
          <BluetoothOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Bluetooth className="h-4 w-4" aria-hidden="true" />
        )}
        {connecting ? 'Povezujem…' : deviceName ? 'Prekini' : 'Poveži merilnik'}
      </Button>

      {/* Mirna opomba, če Web Bluetooth ni podprt */}
      {mounted && !hasBluetooth && (
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
          role="status"
        >
          Ta brskalnik ne podpira Web Bluetooth — uporabi ročni vnos spodaj
          (podprt v Chrome/Edge na Androidu).
        </p>
      )}

      {/* Prijazne inline opombe (nikoli toast, nikoli crash) */}
      {note && (
        <p
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{note}</span>
        </p>
      )}
      {info && (
        <p
          className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground"
          role="status"
        >
          {info}
        </p>
      )}

      {/* Zadnji samodejni izmer */}
      {lastCm !== null && (
        <p className="flex items-center gap-2 text-sm">
          <Check
            className="h-4 w-4 shrink-0 text-green-600"
            aria-hidden="true"
          />
          <span>
            Zadnji izmer:{' '}
            <strong className="text-green-700">{formatCm(lastCm)}</strong> —
            dodan v seznam meritev.
          </span>
        </p>
      )}

      {/* Ročni vnos (vedno viden) */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Ročni vnos izmerka</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            placeholder="npr. 350"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addManual();
            }}
            className="min-h-11 min-w-0 flex-1"
            aria-label="Dolžina iz laserskega merilnika v centimetrih"
          />
          <span
            className="text-sm font-medium text-muted-foreground"
            aria-hidden="true"
          >
            cm
          </span>
          <Button
            type="button"
            onClick={addManual}
            disabled={!canAddManual}
            className="min-h-11 shrink-0"
            aria-label="Dodaj izmer iz laserskega merilnika"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Dodaj izmer
          </Button>
        </div>
      </div>

      {/* Kratka pomoč (sklopljiva) */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setHelpOpen((o) => !o)}
          aria-expanded={helpOpen}
          aria-label="Pokaži pomoč za povezavo laserskega merilnika"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
          {helpOpen ? 'Skrij pomoč' : 'Kako povežem merilnik?'}
        </button>
        {helpOpen && (
          <p className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            Poveži Leica DISTO ali Bosch GLM prek Bluetootha. Če tvoj model ne
            komunicira, izmeri z laserjem in vpiši vrednost tukaj — meritev gre
            v isti seznam kot fotomeritve.
          </p>
        )}
      </div>
    </div>
  );
}
