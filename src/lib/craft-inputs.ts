import type { CraftId, CraftInputs } from './types';
import { CRAFT_INPUT_DEFAULTS } from './defaults';
import { formatNum } from './format';

// ─── Vnosna okna kalkulatorjev ──────────────────────────────
//
// Isti pogon, ki ga je Task 83 vzpostavil za teraso (`terasa-inputs.ts`), zdaj
// velja tudi za ostale dejavnosti. Pravilo je eno samo:
//
//   Vpisanega števila kalkulator NE SME popraviti. Ali ga uporabi točno tako,
//   kot je vpisan, ali pa izračun zavrne in v razlogu navede VPISANO vrednost.
//
// Popravek se je zgodil povsod, kjer je bila v kodi `Math.max(rob, vnos)`:
// ograje `Math.max(0.9, višina)` (vpišeš 0,5 m, obračunano 0,9 m), stopnice
// `Math.max(0.6, širina)`, keramika `Math.max(1, cena)` in rezerva do 30 %,
// okna `Math.max(0,5, velikost)`, nadstrešek `Math.max(2, št. stebrov)`.
// Vsaka od teh je bila tiha menjava monterjeve meritve z našo številko.
//
// OKNO VNOSA ni inženirski predpis. Pove samo, kaj ta aplikacija še ZNA
// izračunati. Inženirske meje (ROKSALovi razmiki, pasovi) ostajajo v
// `roksal-span-rules.ts` in znotraj okna samo OCENIJO vpisano vrednost.

/** Katera koli številčna vnosna polja kalkulatorjev. */
export type NumericField =
  | 'length' | 'height' | 'gates'
  | 'steps' | 'stepWidth' | 'railingLength' | 'totalRiseCm'
  | 'floorLength' | 'floorWidth' | 'wallHeight' | 'tilePricePerM2' | 'reservePercent'
  | 'deckLength' | 'deckWidth' | 'joistSpacing' | 'boardPricePerM' | 'boardLengthM'
  | 'sideGapMm' | 'endGapMm'
  | 'windowCount' | 'windowSize' | 'doorCount'
  | 'canopyWidth' | 'canopyDepth' | 'canopyPosts'
  | 'facadePerimeter' | 'facadeHeight' | 'openingsM2';

export interface InputBound {
  field: NumericField;
  /** Ime, kot ga monter vidi na zaslonu — obvezno ISTO kot label polja. */
  label: string;
  unit: string;
  /** Rob okna; `null` = ta smer ni omejena. */
  min: number | null;
  max: number | null;
  /** Zakaj prav TA rob. Okno brez razloga je samo nova izmišljotina. */
  why: string;
}

export interface InputProblem {
  bound: InputBound;
  /** Kar je monter dejansko vpisal — nikoli prirejeno. */
  typed: number;
  side: 'min' | 'max' | 'nan';
}

export type CraftInputValues = Record<string, number>;

export type CraftInputResult =
  | { ok: true; v: CraftInputValues; problems: [] }
  | { ok: false; v: null; problems: InputProblem[] };

export const OGRAJE_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'length', label: 'Dolžina ograje', unit: 'm', min: 0, max: 2000,
    why: 'daljše od 2000 m ne naročaš iz ročnega kalkulatorja',
  },
  {
    field: 'height', label: 'Višina ograje', unit: 'm', min: 0.2, max: 4,
    why: 'pod 20 cm vpisano ni ograja, nad 4 m pa ta kalkulator ne more preveriti nosilnosti',
  },
  {
    field: 'gates', label: 'Št. oključljivih prehodov', unit: 'kos', min: 0, max: 200,
    why: 'nad 200 prehodov ne šteješ v ročnem kalkulatorju',
  },
];

const OGRAJE_DEFAULTS: Record<string, number> = {
  length: CRAFT_INPUT_DEFAULTS.length ?? 6,
  height: CRAFT_INPUT_DEFAULTS.height ?? 1,
  gates: CRAFT_INPUT_DEFAULTS.gates ?? 0,
};

/**
 * Registracija po dejavnostih. Terasa ima svoj modul (`terasa-inputs.ts`),
 * ker je tam okno nastalo skupaj z rezalnim načrtom; stroj besedila so
 * skupni, da se ne moreta dve formulaciji raziti.
 */
export const CRAFT_INPUT_BOUNDS: Partial<Record<CraftId, readonly InputBound[]>> = {
  ograje: OGRAJE_INPUT_BOUNDS,
};

const CRAFT_INPUT_DEFAULTS_BY_CRAFT: Partial<Record<CraftId, Record<string, number>>> = {
  ograje: OGRAJE_DEFAULTS,
};

/** Skupni obrat za vsak registriran niz meja. */
export function resolveInputBounds(
  bounds: readonly InputBound[],
  defaults: Record<string, number>,
  input: CraftInputs,
): CraftInputResult {
  const problems: InputProblem[] = [];
  const values: CraftInputValues = {};

  for (const bound of bounds) {
    const raw = input[bound.field as keyof CraftInputs];
    const given = raw === undefined || Number.isNaN(raw) ? null : Number(raw);
    const value = given === null ? defaults[bound.field] : given;
    values[bound.field] = value;
    if (given === null && raw !== undefined) {
      problems.push({ bound, typed: raw as number, side: 'nan' });
    } else if (bound.min !== null && value < bound.min) {
      problems.push({ bound, typed: value, side: 'min' });
    } else if (bound.max !== null && value > bound.max) {
      problems.push({ bound, typed: value, side: 'max' });
    }
  }

  if (problems.length > 0) return { ok: false, v: null, problems };
  return { ok: true, v: values, problems: [] };
}

export function resolveCraftInputs(craft: CraftId, input: CraftInputs): CraftInputResult {
  const bounds = CRAFT_INPUT_BOUNDS[craft];
  const defaults = CRAFT_INPUT_DEFAULTS_BY_CRAFT[craft];
  if (!bounds || !defaults) return { ok: true, v: {}, problems: [] };
  return resolveInputBounds(bounds, defaults, input);
}

const nf = (n: number) => formatNum(n, 2);

function windowText(b: InputBound): string {
  if (b.min !== null && b.max !== null) return `${nf(b.min)}–${nf(b.max)} ${b.unit}`;
  if (b.min !== null) return `najmanj ${nf(b.min)} ${b.unit}`;
  if (b.max !== null) return `največ ${nf(b.max)} ${b.unit}`;
  return 'kar je vpisano';
}

/**
 * Namig pod poljem vzame ISTE številke, ki jih resolver dejansko preverja —
 * sicer beseda pod poljem in zavrnitev v ponudbi lahko zletita narazen.
 */
export function inputWindowHint(craft: CraftId, field: NumericField): string | undefined {
  const bound = CRAFT_INPUT_BOUNDS[craft]?.find((b) => b.field === field);
  if (!bound) return undefined;
  return `sprejemamo ${windowText(bound)}; zunaj tega izračun ni opravljen`;
}

/** Kratka oblika za povzetek ponudbe (ozek prostor): samo kaj in koliko. */
export function craftProblemShort(p: InputProblem): string {
  if (p.side === 'nan') return `${p.bound.label}: vnos ni število`;
  return `${p.bound.label} ${nf(p.typed)} ${p.bound.unit}`;
}

/**
 * Dolga oblika za načrt montaže. Navede VPISANO vrednost in razlog, zakaj
 * izračuna ni — to je edini stavek, ki monterju pojasni, da ponudbe ni.
 */
export function craftProblemText(p: InputProblem): string {
  const { bound, typed, side } = p;
  if (side === 'nan') {
    return `${bound.label}: vnos ni število. Sprejemamo ${windowText(bound)}. ` +
      'Izračun ni opravljen — nobena postavka ni obračunana.';
  }
  const rel = side === 'min'
    ? `premalo za izračun (${nf(typed)} < ${nf(bound.min ?? 0)})`
    : `preveč za izračun (${nf(typed)} > ${nf(bound.max ?? 0)})`;
  // `why` je v registru zapisan z malo (je stavek sredi besedila); tu je prvi
  // stavek za njim, zato mora začeti z veliko.
  const why = bound.why.charAt(0).toUpperCase() + bound.why.slice(1);
  return `${bound.label} ${nf(typed)} ${bound.unit} je ${rel}; sprejemamo ${windowText(bound)}. ` +
    `${why}. Izračun ni opravljen — nobena postavka ni obračunana.`;
}
