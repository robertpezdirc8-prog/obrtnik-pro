import { formatNum } from './format';
import { resolveCraftInputs } from './craft-inputs';
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
  switch (craft) {
    case 'ograje': {
      // Trije bralci istega vnosa (cena, načrt, norma) morajo zavrniti skupaj.
      // Sicer bi vrstica »Trajanje montaže« načrtovala termine po meritvi, ki
      // je ponudba že zavrnila.
      const inp = resolveCraftInputs('ograje', inputs);
      if (!inp.ok) return null;
      units = inp.v.length;
      break;
    }
    case 'stopnice':
      units = Math.max(0, inputs.steps ?? 0);
      break;
    case 'keramika': {
      const L = Math.max(0, inputs.floorLength ?? 0);
      const W = Math.max(0, inputs.floorWidth ?? 0);
      const wallH = Math.max(0, inputs.wallHeight ?? 0);
      units = L * W + 2 * (L + W) * wallH;
      break;
    }
    case 'wpc-terasa':
      units = Math.max(0, inputs.deckLength ?? 0) * Math.max(0, inputs.deckWidth ?? 0);
      break;
    case 'okna-vrata':
      units = Math.max(0, inputs.windowCount ?? 0) + 1.67 * Math.max(0, inputs.doorCount ?? 0); // vrata ≈ 2,5 / 1,5
      break;
    case 'nadstreški':
      units = Math.max(0, inputs.canopyWidth ?? 0) * Math.max(0, inputs.canopyDepth ?? 0);
      break;
    case 'fasada': {
      const gross = Math.max(0, inputs.facadePerimeter ?? 0) * Math.max(0, inputs.facadeHeight ?? 0);
      units = Math.max(0, gross - Math.max(0, inputs.openingsM2 ?? 0));
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
