import { formatNum } from './format';
import { resolveCraftInputs } from './craft-inputs';
import { resolveTerasaInputs } from './terasa-inputs';
import type { CraftId, CraftInputs } from './types';

// ─── Ocena trajanja montaže — deterministični normativi ─────
// Raziskava (contractortalk: »man hours per sq. ft.«, RUBI,
// estimationpro): izvajalci načrtujejo termine z man-urami na
// enoto. Tu so konzervativni orientacijski normativi za
// montersko ekipo — čiste skripte, brez AI. Uporabnik lahko
// števila razume kot oceno, ne obljubo.

export interface LaborNorm {
  /** Man-ure na enoto norme. */
  manHoursPerUnit: number;
  /** Kaj je enota (opis za UI). */
  unit: string;
  note: string;
}

export const LABOR_NORMS: Record<CraftId, LaborNorm> = {
  'ograje': { manHoursPerUnit: 1.2, unit: 'm ograje', note: 'vključno s stebri in izravnavo' },
  'stopnice': { manHoursPerUnit: 1.3, unit: 'stopnico', note: 'konstrukcija + obloga + ograja' },
  'keramika': { manHoursPerUnit: 0.75, unit: 'm²', note: 'polaganje + fugiranje' },
  'wpc-terasa': { manHoursPerUnit: 0.6, unit: 'm² terase', note: 'nosilci + deske' },
  'okna-vrata': { manHoursPerUnit: 1.5, unit: 'odprtino', note: 'vrata štejejo 2,5 man-ure' },
  'nadstreški': { manHoursPerUnit: 2.4, unit: 'm² kritine', note: 'konstrukcija + kritina + betoniranje' },
  'fasada': { manHoursPerUnit: 0.9, unit: 'm² fasade', note: 'podkonstrukcija + obloga' },
};

export interface DurationEstimate {
  /** Skupne man-ure dela. */
  manHours: number;
  /** Št. delovnih dni za ekipo (privzeto 2 monterja × 8 h). */
  days: number;
  /** Velikost ekipe. */
  crew: number;
  /** Povzetek za UI: "≈ 2 delovna dneva (16 man-ur, ekipa 2)". */
  summary: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Man-ure se pišejo z vejico: 7,2 ne 7.2. */
const nf = (n: number) => formatNum(n, 1);

/** Ocena trajanja iz vnesenih mer — ista geometrija kot kalkulator. */
export function estimateDuration(craft: CraftId, inputs: CraftInputs): DurationEstimate | null {
  const norm = LABOR_NORMS[craft];
  if (!norm) return null;

  let units = 0;
  // Trije bralci istega vnosa (cena, načrt, norma) morajo zavrniti skupaj.
  // Sicer bi vrstica »Trajanje montaže« načrtovala termine po meritvi, ki jo je
  // ponudba že zavrnila — norma je zato pri vseh dejavnostih na resolverju.
  switch (craft) {
    case 'ograje': {
      const inp = resolveCraftInputs('ograje', inputs);
      if (!inp.ok) return null;
      units = inp.v.length;
      break;
    }
    case 'stopnice': {
      const inp = resolveCraftInputs('stopnice', inputs);
      if (!inp.ok) return null;
      units = inp.v.steps;
      // Isti samodejni predlog kot pri ceni in načrtu (ciljna višina 17,5 cm).
      if (units === 0 && inp.v.totalRiseCm > 0) units = Math.ceil(inp.v.totalRiseCm / 17.5);
      break;
    }
    case 'keramika': {
      const inp = resolveCraftInputs('keramika', inputs);
      if (!inp.ok) return null;
      const L = inp.v.floorLength;
      const W = inp.v.floorWidth;
      units = L * W + 2 * (L + W) * inp.v.wallHeight;
      break;
    }
    case 'wpc-terasa': {
      const inp = resolveTerasaInputs(inputs);
      if (!inp.ok) return null;
      units = inp.v.deckLength * inp.v.deckWidth;
      break;
    }
    case 'okna-vrata': {
      const inp = resolveCraftInputs('okna-vrata', inputs);
      if (!inp.ok) return null;
      // Vrata trajajo več kot okno — razmerje je 2,5 / 1,5 man-ure.
      units = inp.v.windowCount + (2.5 / 1.5) * inp.v.doorCount;
      break;
    }
    case 'nadstreški': {
      const inp = resolveCraftInputs('nadstreški', inputs);
      if (!inp.ok) return null;
      units = inp.v.canopyWidth * inp.v.canopyDepth;
      break;
    }
    case 'fasada': {
      const inp = resolveCraftInputs('fasada', inputs);
      if (!inp.ok) return null;
      const gross = inp.v.facadePerimeter * inp.v.facadeHeight;
      // Resolver že zavrne, če so odprtine večje od stene, zato `max(0, …)`
      // ni več potreben — in tudi ne bi več prikril napačne izmere.
      units = gross - inp.v.openingsM2;
      break;
    }
  }

  if (units <= 0) return null;

  const manHours = r1(units * norm.manHoursPerUnit);
  const crew = 2;
  const days = Math.max(1, Math.ceil(manHours / (crew * 8)));

  return {
    manHours,
    days,
    crew,
    summary: `≈ ${days} ${days === 1 ? 'delovni dan' : days === 2 ? 'delovna dneva' : 'delovne dni'} (${nf(manHours)} man-ur, ekipa ${crew} monterja)`,
  };
}
