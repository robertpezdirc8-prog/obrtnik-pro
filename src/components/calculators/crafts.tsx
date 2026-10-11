'use client';

import { useState } from 'react';
import { CraftCalculator, NumField, SelField, BoolField } from './shared';
import { calculateOgraje, calculateStopnice, calculateKeramika, calculateWpcTerasa, calculateOknaVrata, calculateNadstresek, calculateFasada } from '@/lib/pricing';
import type { CraftInputs } from '@/lib/types';

const DEFAULTS: CraftInputs = {
  length: 6, height: 1.1, material: 'alu', gates: 0,
  steps: 12, stepWidth: 1.1, stepMaterial: 'wpc', railingNeeded: true,
  floorLength: 4, floorWidth: 3, wallHeight: 0, tilePricePerM2: 24, reservePercent: 10,
  deckLength: 4, deckWidth: 3, joistSpacing: 0.4, boardPricePerM: 12.5,
  windowCount: 3, windowSize: 2, windowMaterial: 'pvc', doorCount: 1, removeOld: true,
  canopyWidth: 5, canopyDepth: 3, canopyCover: 'ploc', canopyPosts: 2, waterDrain: true,
  facadePerimeter: 36, facadeHeight: 2.8, openingsM2: 12, cladding: 'wpc',
};

function useCraftInputs(initial: Partial<CraftInputs>) {
  const [inputs, set] = useState<CraftInputs>({ ...DEFAULTS, ...initial });
  return { inputs, setInputs: (patch: Partial<CraftInputs>) => set((s) => ({ ...s, ...patch })) };
}

// ─── 1. OGRAJE ──────────────────────────────────────────────

export function OgrajeCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="ograje"
      title="Balkonske ograje in ograje"
      description="Stebri se izračunajo na vsakih ~1,5 m, steklo po m², montáža na meter."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateOgraje(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina ograje" unit="m" value={inputs.length ?? 0} onChange={(v) => setInputs({ length: v })} />
        <NumField label="Višina ograje" unit="m" value={inputs.height ?? 1} onChange={(v) => setInputs({ height: v })} step={0.05} min={0.9} />
      </div>
      <SelField
        label="Material ograje"
        value={inputs.material ?? 'alu'}
        onChange={(v) => setInputs({ material: v })}
        options={[
          { value: 'alu', label: 'Aluminij' },
          { value: 'steklo', label: 'Steklo' },
          { value: 'inox', label: 'Inox' },
        ]}
      />
      <NumField label="Št. oključljivih prehodov" unit="kos" value={inputs.gates ?? 0} onChange={(v) => setInputs({ gates: v })} step={1} hint="Vrata za dostop (0,9 m)" />
    </CraftCalculator>
  );
}

// ─── 2. STOPNICE ────────────────────────────────────────────

export function StopniceCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="stopnice"
      title="Stopnice"
      description="Stopnice po kosu, nosilna konstrukcija, ograja in montaža."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateStopnice(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. stopnic" unit="kos" value={inputs.steps ?? 0} onChange={(v) => setInputs({ steps: v })} step={1} />
        <NumField label="Širina stopnic" unit="m" value={inputs.stepWidth ?? 1} onChange={(v) => setInputs({ stepWidth: v })} min={0.6} />
      </div>
      <SelField
        label="Material stopnic"
        value={inputs.stepMaterial ?? 'wpc'}
        onChange={(v) => setInputs({ stepMaterial: v })}
        options={[
          { value: 'wpc', label: 'WPC' },
          { value: 'hrast', label: 'Hrast masiv' },
        ]}
      />
      <BoolField
        label="Ograja na stopnicah"
        hint="Dolžina se samodejno izračuna (30 cm / stopnico)"
        value={inputs.railingNeeded ?? true}
        onChange={(v) => setInputs({ railingNeeded: v })}
      />
    </CraftCalculator>
  );
}

// ─── 3. KERAMIKA ────────────────────────────────────────────

export function KeramikaCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="keramika"
      title="Keramika"
      description="Ploščice z rezervo, lepilo, fuga, prižice in polaganje."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateKeramika(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina prostora" unit="m" value={inputs.floorLength ?? 0} onChange={(v) => setInputs({ floorLength: v })} />
        <NumField label="Širina prostora" unit="m" value={inputs.floorWidth ?? 0} onChange={(v) => setInputs({ floorWidth: v })} />
      </div>
      <NumField label="Višina obloženih sten" unit="m" value={inputs.wallHeight ?? 0} onChange={(v) => setInputs({ wallHeight: v })} hint="0 = oblagujemo samo tla" />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Cena ploščic" unit="€/m²" value={inputs.tilePricePerM2 ?? 24} onChange={(v) => setInputs({ tilePricePerM2: v })} />
        <NumField label="Rezerva za rezanje" unit="%" value={inputs.reservePercent ?? 10} onChange={(v) => setInputs({ reservePercent: v })} step={1} />
      </div>
    </CraftCalculator>
  );
}

// ─── 4. WPC TERASA ──────────────────────────────────────────

export function WpcTerasaCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="wpc-terasa"
      title="WPC terasa"
      description="Deske po smeri polaganja, nosilci na razmak, skrite kljukice."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateWpcTerasa(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina terase" unit="m" value={inputs.deckLength ?? 0} onChange={(v) => setInputs({ deckLength: v })} />
        <NumField label="Širina terase" unit="m" value={inputs.deckWidth ?? 0} onChange={(v) => setInputs({ deckWidth: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Razmak nosilcev" unit="m" value={inputs.joistSpacing ?? 0.4} onChange={(v) => setInputs({ joistSpacing: v })} min={0.3} max={0.6} hint="Privzeto 0,4 m" />
        <NumField label="Cena deske" unit="€/m" value={inputs.boardPricePerM ?? 12.5} onChange={(v) => setInputs({ boardPricePerM: v })} />
      </div>
    </CraftCalculator>
  );
}

// ─── 5. OKNA IN VRATA ───────────────────────────────────────

export function OknaVrataCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="okna-vrata"
      title="Okna in vrata"
      description="Števec kosov z montažo, zatesnitvijo in odstranitvijo starih."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateOknaVrata(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. oken" unit="kos" value={inputs.windowCount ?? 0} onChange={(v) => setInputs({ windowCount: v })} step={1} />
        <NumField label="Povprečna velikost okna" unit="m²" value={inputs.windowSize ?? 2} onChange={(v) => setInputs({ windowSize: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. zunanjih vrat" unit="kos" value={inputs.doorCount ?? 0} onChange={(v) => setInputs({ doorCount: v })} step={1} />
      </div>
      <SelField
        label="Material oken"
        value={inputs.windowMaterial ?? 'pvc'}
        onChange={(v) => setInputs({ windowMaterial: v })}
        options={[
          { value: 'pvc', label: 'PVC' },
          { value: 'alu', label: 'Aluminij' },
        ]}
      />
      <BoolField
        label="Odstranitev starih odprtij"
        hint="Demontaža + odvoz"
        value={inputs.removeOld ?? true}
        onChange={(v) => setInputs({ removeOld: v })}
      />
    </CraftCalculator>
  );
}

// ─── 6. NADSTREŠKI ──────────────────────────────────────────

export function NadstresekCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="nadstreški"
      title="Nadstreški"
      description="Konstrukcija, kritina s preklopi, stebri in odvod vode."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateNadstresek(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Širina (fronta)" unit="m" value={inputs.canopyWidth ?? 0} onChange={(v) => setInputs({ canopyWidth: v })} />
        <NumField label="Globina" unit="m" value={inputs.canopyDepth ?? 0} onChange={(v) => setInputs({ canopyDepth: v })} />
      </div>
      <SelField
        label="Kritina"
        value={inputs.canopyCover ?? 'ploc'}
        onChange={(v) => setInputs({ canopyCover: v })}
        options={[
          { value: 'ploc', label: 'Trapezna pločevina' },
          { value: 'polikar', label: 'Polikarbonat' },
          { value: 'steklo', label: 'Varnostno steklo' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. stebrov" unit="kos" value={inputs.canopyPosts ?? 2} onChange={(v) => setInputs({ canopyPosts: v })} step={1} min={0} />
      </div>
      <BoolField
        label="Odvod padavinske vode"
        hint="Zaboj + cev po sprednji strani"
        value={inputs.waterDrain ?? true}
        onChange={(v) => setInputs({ waterDrain: v })}
      />
    </CraftCalculator>
  );
}

// ─── 7. FASADE ──────────────────────────────────────────────

export function FasadaCalc() {
  const { inputs, setInputs } = useCraftInputs({});
  return (
    <CraftCalculator
      craft="fasada"
      title="Fasade"
      description="Neto površina minus odprtine, letve na 40 cm, montáža."
      inputs={inputs}
      setInputs={setInputs}
      compute={(i) => calculateFasada(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Obseg / dolžina stene" unit="m" value={inputs.facadePerimeter ?? 0} onChange={(v) => setInputs({ facadePerimeter: v })} />
        <NumField label="Višina fasade" unit="m" value={inputs.facadeHeight ?? 0} onChange={(v) => setInputs({ facadeHeight: v })} />
      </div>
      <NumField label="Površina odprtin (okna, vrata)" unit="m²" value={inputs.openingsM2 ?? 0} onChange={(v) => setInputs({ openingsM2: v })} />
      <SelField
        label="Vrsta obloge"
        value={inputs.cladding ?? 'wpc'}
        onChange={(v) => setInputs({ cladding: v })}
        options={[
          { value: 'wpc', label: 'WPC' },
          { value: 'les', label: 'Les (termo)' },
          { value: 'ploc', label: 'Trapezna pločevina' },
        ]}
      />
    </CraftCalculator>
  );
}
