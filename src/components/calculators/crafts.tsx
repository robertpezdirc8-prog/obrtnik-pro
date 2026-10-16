'use client';

import { useState } from 'react';
import { CraftCalculator, NumField, SelField, BoolField } from './shared';
import { calculateOgraje, calculateStopnice, calculateKeramika, calculateWpcTerasa, calculateOknaVrata, calculateNadstresek, calculateFasada } from '@/lib/pricing';
import { CRAFT_INPUT_DEFAULTS } from '@/lib/defaults';
import { inputWindowHint, inputWindowHintWith } from '@/lib/craft-inputs';
import { useView } from '@/lib/store';
import type { CraftId, CraftInputs } from '@/lib/types';

function useCraftInputs(craft: CraftId, initial: Partial<CraftInputs>) {
  const prefill = useView((s) => s.cameraPrefill);
  const applied = prefill && prefill.craft === craft ? prefill.inputs : null;
  const [inputs, set] = useState<CraftInputs>({ ...CRAFT_INPUT_DEFAULTS, ...initial, ...(applied ?? {}) });
  return { inputs, setInputs: (patch: Partial<CraftInputs>) => set((s) => ({ ...s, ...patch })), isPrefilled: !!applied };
}

// ─── 1. OGRAJE ──────────────────────────────────────────────

export function OgrajeCalc() {
  const { inputs, setInputs, isPrefilled } = useCraftInputs('ograje', {});
  return (
    <CraftCalculator
      craft="ograje"
      title="Balkonske ograje in ograje"
      description="Stebri se izračunajo na vsakih ~1,5 m, steklo po m², montaža na meter."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateOgraje(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina ograje" unit="m" value={inputs.length ?? 0} onChange={(v) => setInputs({ length: v })} hint={inputWindowHint('ograje', 'length')} />
        <NumField label="Višina ograje" unit="m" value={inputs.height ?? 1} onChange={(v) => setInputs({ height: v })} step={0.05} hint={inputWindowHint('ograje', 'height')} />
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
      <NumField label="Št. oključljivih prehodov" unit="kos" value={inputs.gates ?? 0} onChange={(v) => setInputs({ gates: v })} step={1} hint={inputWindowHintWith('ograje', 'gates', 'Vrata za dostop (0,9 m)')} />
    </CraftCalculator>
  );
}

// ─── 2. STOPNICE ────────────────────────────────────────────

export function StopniceCalc() {
  const { inputs, setInputs, isPrefilled } = useCraftInputs('stopnice', {});
  return (
    <CraftCalculator
      craft="stopnice"
      title="Stopnice"
      description="Stopnice po kosu, nosilna konstrukcija, ograja in montaža."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateStopnice(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. stopnic" unit="kos" value={inputs.steps ?? 0} onChange={(v) => setInputs({ steps: v })} step={1} hint={inputWindowHintWith('stopnice', 'steps', '0 = samodejno iz višinske razlike')} />
        <NumField label="Širina stopnic" unit="m" value={inputs.stepWidth ?? 1} onChange={(v) => setInputs({ stepWidth: v })} hint={inputWindowHint('stopnice', 'stepWidth')} />
      </div>
      <NumField
        label="Višinska razlika (od tal do galerije)"
        unit="cm"
        value={inputs.totalRiseCm ?? 0}
        onChange={(v) => setInputs({ totalRiseCm: v })}
        step={1}
        hint={inputWindowHintWith('stopnice', 'totalRiseCm', 'Skripta predlaga št. stopnic in pove, kakšno globino stopnice zahteva pravilo 2R + G = 60–66 cm')}
      />
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
  const { inputs, setInputs, isPrefilled } = useCraftInputs('keramika', {});
  return (
    <CraftCalculator
      craft="keramika"
      title="Keramika"
      description="Ploščice z rezervo, lepilo, fuga, priključki in polaganje."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateKeramika(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina prostora" unit="m" value={inputs.floorLength ?? 0} onChange={(v) => setInputs({ floorLength: v })} hint={inputWindowHint('keramika', 'floorLength')} />
        <NumField label="Širina prostora" unit="m" value={inputs.floorWidth ?? 0} onChange={(v) => setInputs({ floorWidth: v })} hint={inputWindowHint('keramika', 'floorWidth')} />
      </div>
      <NumField label="Višina obloženih sten" unit="m" value={inputs.wallHeight ?? 0} onChange={(v) => setInputs({ wallHeight: v })} hint={inputWindowHintWith('keramika', 'wallHeight', '0 = oblagujemo samo tla')} />
      <SelField
        label="Vzorec polaganja"
        value={inputs.tilePattern ?? 'ravno'}
        onChange={(v) => setInputs({ tilePattern: v, reservePercent: v === 'diagonalno' ? 15 : v === 'ribja-kost' ? 18 : 10 })}
        options={[
          { value: 'ravno', label: 'Ravno (odpadek 10 %)' },
          { value: 'diagonalno', label: 'Diagonalno (15 %)' },
          { value: 'ribja-kost', label: 'Ribja kost (18 %)' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Cena ploščic" unit="€/m²" value={inputs.tilePricePerM2 ?? 24} onChange={(v) => setInputs({ tilePricePerM2: v })} hint={inputWindowHint('keramika', 'tilePricePerM2')} />
        <NumField label="Rezerva za rezanje" unit="%" value={inputs.reservePercent ?? 10} onChange={(v) => setInputs({ reservePercent: v })} step={1} hint={inputWindowHint('keramika', 'reservePercent')} />
      </div>
    </CraftCalculator>
  );
}

// ─── 4. WPC TERASA ──────────────────────────────────────────

export function WpcTerasaCalc() {
  const { inputs, setInputs, isPrefilled } = useCraftInputs('wpc-terasa', {});
  return (
    <CraftCalculator
      craft="wpc-terasa"
      title="WPC terasa"
      description="Deske po smeri polaganja, nosilci na razmak, skrite kljukice."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateWpcTerasa(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Dolžina terase" unit="m" value={inputs.deckLength ?? 0} onChange={(v) => setInputs({ deckLength: v })} />
        <NumField label="Širina terase" unit="m" value={inputs.deckWidth ?? 0} onChange={(v) => setInputs({ deckWidth: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Razmak nosilcev" unit="m" value={inputs.joistSpacing ?? CRAFT_INPUT_DEFAULTS.joistSpacing ?? 0.33} onChange={(v) => setInputs({ joistSpacing: v })} step={0.01} hint="ROKSAL za teraso objavlja razmak podložnih letev 33–35 cm — privzeto spodnji rob" />
        <NumField label="Cena deske" unit="€/m" value={inputs.boardPricePerM ?? 12.5} onChange={(v) => setInputs({ boardPricePerM: v })} />
        <NumField label="Nabavna dolžina deske" unit="m" value={inputs.boardLengthM ?? 4} onChange={(v) => setInputs({ boardLengthM: v })} step={0.5} hint="Za rezalni načrt" />
        <NumField label="Čelna dilatacija" unit="mm" value={inputs.endGapMm ?? 4} onChange={(v) => setInputs({ endGapMm: v })} step={1} hint="3–5 mm (tržna praksa, ne ROKSAL)" />
        <NumField label="Stranska dilatacija" unit="mm" value={inputs.sideGapMm ?? 5} onChange={(v) => setInputs({ sideGapMm: v })} step={1} hint="3–6 mm (tržna praksa, ne ROKSAL)" />
      </div>
    </CraftCalculator>
  );
}

// ─── 5. OKNA IN VRATA ───────────────────────────────────────

export function OknaVrataCalc() {
  const { inputs, setInputs, isPrefilled } = useCraftInputs('okna-vrata', {});
  return (
    <CraftCalculator
      craft="okna-vrata"
      title="Okna in vrata"
      description="Števec kosov z montažo, zatesnitvijo in odstranitvijo starih."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateOknaVrata(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. oken" unit="kos" value={inputs.windowCount ?? 0} onChange={(v) => setInputs({ windowCount: v })} step={1} hint={inputWindowHint('okna-vrata', 'windowCount')} />
        <NumField label="Povprečna velikost okna" unit="m²" value={inputs.windowSize ?? 2} onChange={(v) => setInputs({ windowSize: v })} hint={inputWindowHint('okna-vrata', 'windowSize')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Št. zunanjih vrat" unit="kos" value={inputs.doorCount ?? 0} onChange={(v) => setInputs({ doorCount: v })} step={1} hint={inputWindowHint('okna-vrata', 'doorCount')} />
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
  const { inputs, setInputs, isPrefilled } = useCraftInputs('nadstreški', {});
  return (
    <CraftCalculator
      craft="nadstreški"
      title="Nadstreški"
      description="Konstrukcija, kritina s preklopi, stebri in odvod vode."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateNadstresek(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Širina (fronta)" unit="m" value={inputs.canopyWidth ?? 0} onChange={(v) => setInputs({ canopyWidth: v })} hint={inputWindowHint('nadstreški', 'canopyWidth')} />
        <NumField label="Globina" unit="m" value={inputs.canopyDepth ?? 0} onChange={(v) => setInputs({ canopyDepth: v })} hint={inputWindowHint('nadstreški', 'canopyDepth')} />
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
        <NumField label="Št. stebrov" unit="kos" value={inputs.canopyPosts ?? 2} onChange={(v) => setInputs({ canopyPosts: v })} step={1} hint={inputWindowHintWith('nadstreški', 'canopyPosts', '0 = konstrukcija je sidrana na zid')} />
      </div>
      <BoolField
        label="Odvod padavinske vode"
        hint="Odvodni žleb + cev po sprednji strani"
        value={inputs.waterDrain ?? true}
        onChange={(v) => setInputs({ waterDrain: v })}
      />
    </CraftCalculator>
  );
}

// ─── 7. FASADE ──────────────────────────────────────────────

export function FasadaCalc() {
  const { inputs, setInputs, isPrefilled } = useCraftInputs('fasada', {});
  return (
    <CraftCalculator
      craft="fasada"
      title="Fasade"
      description="Neto površina minus odprtine, letve na 40 cm, montaža."
      inputs={inputs}
      setInputs={setInputs}
      prefilled={isPrefilled}
      compute={(i) => calculateFasada(i, 35)}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Obseg / dolžina stene" unit="m" value={inputs.facadePerimeter ?? 0} onChange={(v) => setInputs({ facadePerimeter: v })} hint={inputWindowHint('fasada', 'facadePerimeter')} />
        <NumField label="Višina fasade" unit="m" value={inputs.facadeHeight ?? 0} onChange={(v) => setInputs({ facadeHeight: v })} hint={inputWindowHint('fasada', 'facadeHeight')} />
      </div>
      <NumField label="Površina odprtin (okna, vrata)" unit="m²" value={inputs.openingsM2 ?? 0} onChange={(v) => setInputs({ openingsM2: v })} hint={inputWindowHintWith('fasada', 'openingsM2', 'največ toliko, kot znaša bruto površina stene')} />
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
