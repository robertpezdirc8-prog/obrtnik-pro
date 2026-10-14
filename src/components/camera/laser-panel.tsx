'use client';

// ─── Laserski merilnik: Web Bluetooth (BLE) + ročni vnos ────
// Poveže merilnik (Leica DISTO, Bosch GLM, generični BLE moduli s
// servisom FFE0/FFE1 oz. zasilno FFF0/FFF1) in samodejno posluša
// izmerke; vedno na voljo tudi ročni vnos — vse gre v isti seznam
// meritev kot fotomeritve (onAddMeasurement).
// Protokoli za znane modele (Bosch GLM 120 C / GLM 50C·100C / PLR)
// so v src/lib/laser-protocols.ts; razčlenjevalniki so preverjeni s
// fiksaturami iz dokumentiranih zajemov (samopreizkus v UI).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Bluetooth,
  BluetoothOff,
  Check,
  Info,
  Plus,
  Ruler,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { formatCm } from '@/lib/measure-geometry';
import {
  BOSCH_C0_MEASURE,
  GLM120_ENABLE_INDICATIONS,
  GLM120_INIT,
  GLM120_MODE_DISTANCE,
  GLM120_TRIGGER,
  LASER_MODELS,
  detectLaserModel,
  parseLaserValue,
  protocolSelfTest,
  type LaserModelId,
} from '@/lib/laser-protocols';

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
  /** Best-effort pisanje sprožitvenih zaporedij (GLM 120 C). */
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  properties?: {
    write?: boolean;
    writeWithoutResponse?: boolean;
    notify?: boolean;
    indicate?: boolean;
  };
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

/** Uint8Array iz številskega zaporedja (sprožitvena zaporedja protokolov). */
const bytesOf = (...b: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(b);

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

  // ── Protokoli znanih modelov ──
  const [modelId, setModelId] = useState<LaserModelId>('auto');
  const [detectedModel, setDetectedModel] = useState<LaserModelId | null>(null);
  // Samopreizkus razčlenjevalnikov (determinističen, 0 AI) — šele po
  // mount-u, da strežniški in odjemalski prvi ris sta identična.
  const [selfTest, setSelfTest] = useState<{ ok: number; all: number } | null>(
    null,
  );
  useEffect(() => {
    const rows = protocolSelfTest();
    setSelfTest({ ok: rows.filter((r) => r.ok).length, all: rows.length });
  }, []);

  // Učinkovit model: ročna izbira ima prednost, sicer prepoznana naprava,
  // sicer samodejno (poskusi vse znane protokole po vrsti).
  const effectiveModel: LaserModelId =
    modelId !== 'auto' ? modelId : (detectedModel ?? 'auto');

  const deviceRef = useRef<BtDevice | null>(null);
  const charRef = useRef<BtCharacteristic | null>(null);
  const addRef = useRef(onAddMeasurement); // vedno najnovejši prop
  const modelRef = useRef<LaserModelId>('auto'); // trenutni model za poslušalca
  const aliveRef = useRef(false); // zaščita pred setState po unmount

  useEffect(() => {
    addRef.current = onAddMeasurement;
  }, [onAddMeasurement]);

  useEffect(() => {
    modelRef.current = effectiveModel;
  }, [effectiveModel]);

  // ── BLE: samodejni izmer iz notifikacije (stabilna identiteta) ──
  const handleNotify = useCallback((event: Event) => {
    if (!aliveRef.current) return;
    const dv = (event.target as { value?: DataView | null } | null)?.value;
    if (!dv) return;
    const res = parseLaserValue(dv, modelRef.current);
    if (res === null) return; // neznan okvir — mirno ignoriramo
    if (res.warning && res.cm === 0) {
      // naprava je javila napako (npr. strojna napaka) — iskreno pokaži
      setNote(res.warning);
      return;
    }
    if (res.warning) setNote(res.warning);
    else setNote(null);
    setLastCm(res.cm); // razpon že preverjen v knjižnici (1–50.000 cm)
    addRef.current('Laser', res.cm);
  }, []);

  // ── BLE: naprava se je sama odjavila ──
  const handleDisconnected = useCallback(() => {
    if (!aliveRef.current) return;
    charRef.current = null;
    deviceRef.current = null;
    setDeviceName(null);
    setDetectedModel(null);
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
    setDetectedModel(null);
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

  // ── Best-effort pisanje sprožitvenega zaporedja (GLM 120 C) ──
  const writeSequence = async (
    char: BtCharacteristic,
    seq: number[],
  ): Promise<boolean> => {
    const data = bytesOf(...seq);
    try {
      if (char.properties?.write && char.writeValue) {
        await char.writeValue(data);
        return true;
      }
      if (char.properties?.writeWithoutResponse && char.writeValueWithoutResponse) {
        await char.writeValueWithoutResponse(data);
        return true;
      }
      // lastnosti niso znane — poskusi writeValueWithoutResponse
      if (char.writeValueWithoutResponse) {
        await char.writeValueWithoutResponse(data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

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
      const name = device.name?.trim() || 'neznana naprava';
      setDeviceName(name);
      const detected = detectLaserModel(device.name);
      setDetectedModel(detected === 'auto' ? null : detected);

      // Samodejni sprejem izmerkov: FFE0/FFE1, zasilno še FFF0/FFF1
      let autoReceive = false;
      let flowMessage: string | null = null;
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

          // Bosch GLM 120 C: dokumentirano sprožitveno zaporedje
          // (vir: laser-protocols.ts) — best-effort; če značka ne
          // dovoljuje pisanja, uporabnik sproži na napravi.
          const modelNow: LaserModelId | null =
            modelId !== 'auto' ? modelId : detected === 'auto' ? null : detected;
          if (modelNow === 'bosch-glm120') {
            const w1 = await writeSequence(characteristic, GLM120_ENABLE_INDICATIONS);
            const w2 = await writeSequence(characteristic, GLM120_INIT);
            await writeSequence(characteristic, GLM120_MODE_DISTANCE);
            await writeSequence(characteristic, GLM120_TRIGGER);
            await writeSequence(characteristic, GLM120_TRIGGER);
            flowMessage =
              w1 || w2
                ? 'GLM 120 C: poslano dokumentirano sprožitveno zaporedje — meritev sproži na napravi (dvakrat), sprejem je aktiven.'
                : 'GLM 120 C: sprejem je aktiven — sproži meritev na napravi (dvakrat zaporedoma: priprava, nato izmer).';
          } else if (modelNow === 'bosch-c0') {
            const ok = await writeSequence(characteristic, BOSCH_C0_MEASURE);
            flowMessage = ok
              ? 'Bosch (C0 protokol): ukaz za meritev poslan — sprejem je aktiven.'
              : 'Bosch (C0 protokol): sprejem je aktiven — sproži meritev na napravi.';
          }
          break;
        } catch {
          // ta servis/značka ni na voljo — poskusi naslednjega
        }
      }
      if (!autoReceive) {
        flowMessage =
          'Povezava je vzpostavljena, ta model pa ne pošilja izmerkov prek znanega protokola — vpiši vrednost ročno spodaj.';
      } else if (flowMessage === null) {
        flowMessage = 'Samodejni sprejem izmerkov je aktiven — sproži meritev na napravi.';
      }
      if (detected !== 'auto') {
        const modelInfo = LASER_MODELS.find((m) => m.id === detected);
        flowMessage = `${modelInfo ? `Prepoznan model: ${modelInfo.name}. ` : ''}${flowMessage}`;
      }
      setInfo(flowMessage);
    } catch (err) {
      detachListeners();
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // povezava sploh ni bila vzpostavljena
      }
      deviceRef.current = null;
      setDeviceName(null);
      setDetectedModel(null);
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

  const activeModelInfo = useMemo(
    () => LASER_MODELS.find((m) => m.id === effectiveModel) ?? LASER_MODELS[0],
    [effectiveModel],
  );

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

      {/* Samopreizkus protokolov (determinističen, 0 AI) */}
      {mounted && selfTest && (
        <p
          className={`flex items-center gap-2 text-xs ${
            selfTest.ok === selfTest.all
              ? 'text-muted-foreground'
              : 'text-amber-600'
          }`}
        >
          {selfTest.ok === selfTest.all ? (
            <ShieldCheck
              className="h-3.5 w-3.5 shrink-0 text-green-600"
              aria-hidden="true"
            />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            Protokoli znanih modelov: preverjenih{' '}
            <strong>
              {selfTest.ok}/{selfTest.all}
            </strong>{' '}
            fiksatur iz dokumentiranih zajemov
          </span>
        </p>
      )}

      {/* Izbira modela */}
      <div className="space-y-1.5">
        <label
          htmlFor="laser-model"
          className="text-sm font-medium"
        >
          Model merilnika
        </label>
        <Select
          value={modelId}
          onValueChange={(v) => setModelId(v as LaserModelId)}
        >
          <SelectTrigger
            id="laser-model"
            className="min-h-11 w-full"
            aria-label="Model laserskega merilnika"
          >
            <SelectValue placeholder="Samodejno" />
          </SelectTrigger>
          <SelectContent>
            {LASER_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {activeModelInfo.hint}
          {modelId === 'auto' && detectedModel !== null && (
            <>
              {' '}
              — prepoznano: <strong>{deviceName ?? 'naprava'}</strong>
            </>
          )}
        </p>
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
          <div className="space-y-2 rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            <p>
              Poveži Leica DISTO ali Bosch GLM prek Bluetootha. Za Bosch GLM
              120 C aplikacija zna poslati dokumentirano sprožitveno
              zaporedje; za GLM 50C/100C in PLR zna razbrati meritvene
              odgovore (C0-protokol).
            </p>
            <p>
              Če tvoj model ne komunicira, izmeri z laserjem in vpiši
              vrednost tukaj — meritev gre v isti seznam kot fotomeritve.
              Razčlenjevalniki znanih modelov so preverjeni proti
              dokumentiranim zajemom (glej samopreizkus zgoraj).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
