import type { CalcResult, CraftId, CraftInputs } from './types';
import { runCalculator } from './pricing';

// ─── Opcije »Dobro · Boljše · Najboljše« ────────────────────
// Deterministične materialne lestvice po dejavnosti: ista
// dimenzija, drugačna izvedba → 3 (ali 2) realni ceni.
// Raziskava (Leap, Joist, Housecall Pro): stranke najraje
// sprejmejo, če ima »tri načine za da« namesto ene številke.
// Pravilo cenovnega pasu (Leap): »dobro« naj ne bo > 25 % pod
// »boljše«, »najboljše« naj ne preseže »boljše« za > 50 %.

export interface GbbVariant {
  /** Ključ lestvice (npr. 'inox'). */
  key: string;
  /** Položaj: 'Dobro' | 'Boljše' | 'Najboljše' (ali 2-variantne oznake). */
  label: string;
  /** Ime izvedbe, npr. 'Inox cev 42,4 mm'. */
  tierName: string;
  description: string;
  /** Popravek vnosov, ki definira izvedbo. */
  patch: Partial<CraftInputs>;
  result: CalcResult;
  total: number;
  /** Ali je to izvedba, ki jo je uporabnik izbral v kalkulatorju. */
  isCurrent: boolean;
}

interface LadderStep {
  key: string;
  tierName: string;
  description: string;
  patch: Partial<CraftInputs>;
}

/** Določi izvedbeni vnos, ki ga lestvica spreminja (za označevanje trenutne izbire). */
function tierKeyOf(patch: Partial<CraftInputs>): string {
  return Object.keys(patch)[0];
}

const LADDERS: Record<CraftId, LadderStep[]> = {
  'ograje': [
    { key: 'alu', tierName: 'Aluminij', description: 'Standard v industriji — vzdržljiv in cenovno uravnotežen', patch: { material: 'alu' } },
    { key: 'inox', tierName: 'Inox cev 42,4 mm', description: 'Premium videz, idealen ob bazenih in na obali', patch: { material: 'inox' } },
    { key: 'steklo', tierName: 'Kaljeno steklo 10 mm', description: 'Neprekinjen pogled — najvišja cena in največji wow', patch: { material: 'steklo' } },
  ],
  'stopnice': [
    { key: 'wpc', tierName: 'WPC deske', description: 'Nezahtevno vzdrževanje, pripravljeno za zunanjost', patch: { stepMaterial: 'wpc' } },
    { key: 'hrast', tierName: 'Hrastove deske', description: 'Klasičen, toplen videz za notranje stopnice', patch: { stepMaterial: 'hrast' } },
  ],
  'keramika': [
    { key: 'std', tierName: 'Standardna ploščica', description: 'Soliden material za kopalnice in hodnike', patch: { tilePricePerM2: 22 } },
    { key: 'format', tierName: 'Veliki format 60×60', description: 'Manj fug, sodoben izgled — zahteva bolj raven pod', patch: { tilePricePerM2: 38 } },
    { key: 'premium', tierName: 'Rektificirani premium', description: 'Vrhunska estetika, minimalne fuge (1,5 mm)', patch: { tilePricePerM2: 60 } },
  ],
  'wpc-terasa': [
    { key: 'klasicna', tierName: 'Klasična WPC deska', description: 'Preverjena osnova z grbovito površino', patch: { boardPricePerM: 12.5 } },
    { key: 'relief', tierName: '3D relief WPC', description: 'Izrazita lesna struktura, boljše protizdrsné lastnosti', patch: { boardPricePerM: 19 } },
    { key: 'jedro', tierName: 'WPC s polnim jedrom', description: 'Mehkejši zvok pod nogami, najvišja obstojnost', patch: { boardPricePerM: 26 } },
  ],
  'okna-vrata': [
    { key: 'pvc', tierName: 'PVC okna', description: 'Najboljši razmerje cena/izolativnost', patch: { windowMaterial: 'pvc' } },
    { key: 'alu', tierName: 'Aluminijasta okna', description: 'Tanjši profili, večja steklena površina, daljša življenjska doba', patch: { windowMaterial: 'alu' } },
  ],
  'nadstreški': [
    { key: 'ploc', tierName: 'Trapezna pločevina', description: 'Solidna kritina za parkirišča in skladišča', patch: { canopyCover: 'ploc' } },
    { key: 'polikar', tierName: 'Polikarbonat 10 mm', description: 'Prepušča svetlobo — vhodi in terase', patch: { canopyCover: 'polikar' } },
    { key: 'steklo', tierName: 'Varnostno steklo 8 mm', description: 'Vrhunski videz za reprezentativne vhode', patch: { canopyCover: 'steklo' } },
  ],
  'fasada': [
    { key: 'ploc', tierName: 'Fasadna pločevina', description: 'Najhitrejša montaža in najnižja cena/m²', patch: { cladding: 'ploc' } },
    { key: 'les', tierName: 'Termo smreka', description: 'Naraven videz, zahteva občasno oljenje', patch: { cladding: 'les' } },
    { key: 'wpc', tierName: 'WPC obloga', description: 'Videz lesa brez vzdrževanja', patch: { cladding: 'wpc' } },
  ],
};

const LABELS_3: string[] = ['Dobro', 'Boljše', 'Najboljše'];
const LABELS_2: string[] = ['Osnovno', 'Vrhunsko'];

/** Zgradi opcije za stranko iz vnesenih mer. Vrne 2–3 izvedbe,
 *  sortirane po ceni naraščajoče. Če izračun za izvedbo vrne
 *  nič postavk, izvedbo spusti. */
export function buildGBB(craft: CraftId, inputs: CraftInputs, laborRate: number): GbbVariant[] {
  const ladder = LADDERS[craft];
  if (!ladder || ladder.length < 2) return [];

  const labels = ladder.length >= 3 ? LABELS_3 : LABELS_2;

  const variants: GbbVariant[] = [];
  ladder.forEach((step, i) => {
    const merged: CraftInputs = { ...inputs, ...step.patch };
    const result = runCalculator(craft, merged, laborRate);
    if (result.lines.length === 0) return;
    const total = result.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const tk = tierKeyOf(step.patch);
    const currentVal = (inputs as Record<string, unknown>)[tk];
    variants.push({
      key: step.key,
      label: labels[Math.min(i, labels.length - 1)],
      tierName: step.tierName,
      description: step.description,
      patch: step.patch,
      result,
      total,
      isCurrent: currentVal === (step.patch as Record<string, unknown>)[tk],
    });
  });

  // Sortiraj po ceni (lestvice so definirane naraščajoče, a za varnost še enkrat)
  return variants.sort((a, b) => a.total - b.total);
}

export interface GbbBand {
  status: 'ok' | 'warn';
  note: string;
}

/** Cenovni pas po Leap smernici: najnižja ≥ 75 % srednje,
 *  najvišja ≤ 150 % srednje. Za 2 opciji kontroliramo samo
 *  razmerje višje/nize (≤ 1,5). Vrni null, če ni smiselno. */
export function gbbBandCheck(totals: number[]): GbbBand | null {
  if (totals.length < 2 || totals.some((t) => t <= 0)) return null;
  if (totals.length === 2) {
    const ratio = totals[1] / totals[0];
    return ratio <= 1.5
      ? { status: 'ok', note: `razmerje višje/nize ${Math.round(ratio * 100)} % — v priporočenem pasu (do 150 %)` }
      : { status: 'warn', note: `razmerje višje/nize ${Math.round(ratio * 100)} % — nad priporočenih 150 %; stranke premnogokrat zavrnejo skok v ceni` };
  }
  const [lo, mid, hi] = [totals[0], totals[1], totals[2]];
  const lowOk = lo >= 0.75 * mid;
  const highOk = hi <= 1.5 * mid;
  if (lowOk && highOk) {
    return { status: 'ok', note: `pas ${Math.round((lo / mid) * 100)}–${Math.round((hi / mid) * 100)} % srednje opcije — v priporočenem območju 75–150 %` };
  }
  const parts: string[] = [];
  if (!lowOk) parts.push(`»dobro« je pod 75 % srednje (${Math.round((lo / mid) * 100)} %) — lahko deluje kot zvaba`);
  if (!highOk) parts.push(`»najboljše« je nad 150 % srednje (${Math.round((hi / mid) * 100)} %) — razmisli o vmesni opciji`);
  return { status: 'warn', note: parts.join(' · ') };
}

/** Odstopanje opcije od srednje (ali nize, če sta samo 2) v %. */
export function gbbDiffPct(total: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round(((total - base) / base) * 100);
}
