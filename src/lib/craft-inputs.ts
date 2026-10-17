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
// `Math.max(0.6, širina)`, keramika `Math.max(1, cena)` in rezerva usekana na
// 30 %, okna `Math.max(0,5, velikost)`, nadstrešek `Math.max(2, št. stebrov)`,
// fasada `Math.max(0, bruto − odprtine)`. Vsaka od teh je bila tiha menjava
// monterjeve meritve z našo številko. Register spodaj jih pokriva vseh sedem
// dejavnosti (terasa preko `terasa-inputs.ts`, ki uvaža ta stroj).
//
// OKNO VNOSA ni inženirski predpis. Pove samo, kaj ta aplikacija še ZNA
// izračunati. Inženirske meje (ROKSALovi razmiki, pasovi) ostajajo v
// `roksal-span-rules.ts` in znotraj okna samo OCENIJO vpisano vrednost.

/** Katera koli številčna vnosna polja kalkulatorjev in nastavitev.
 *  Cen TU NI: cena ni meritev in ne sme biti vnosno polje kalkulatorja —
 *  živi v Ceniku (`cenik.ts`), kalkulator izbere samo kakovostni razred. */
export type NumericField =
  | 'length' | 'height' | 'gates'
  | 'steps' | 'stepWidth' | 'railingLength' | 'totalRiseCm'
  | 'floorLength' | 'floorWidth' | 'wallHeight' | 'reservePercent'
  | 'deckLength' | 'deckWidth' | 'joistSpacing' | 'boardLengthM'
  | 'sideGapMm' | 'endGapMm'
  | 'windowCount' | 'windowSize' | 'doorCount'
  | 'canopyWidth' | 'canopyDepth' | 'canopyPosts'
  | 'facadePerimeter' | 'facadeHeight' | 'openingsM2'
  | 'vatRate' | 'laborRate' | 'quoteValidDays' | 'depositPercent' | 'paymentDays';

export interface InputBound {
  field: NumericField;
  /** Ime, kot ga monter vidi na zaslonu — obvezno ISTO kot label polja. */
  label: string;
  unit: string;
  /** Rob okna; `null` = ta smer ni omejena. */
  min: number | null;
  max: number | null;
  /**
   * Vrednost mora biti celo število. Uporablja ga SAMO resolver nastavitev
   * (`settings-inputs.ts`), ker sta dni v bazi `Int` — sicer bi 15,5 dneva
   * tiho postalo 15. Kalkulatorski resolverter tega ne preverja, ker št.
   * stopnic ali kosov doslej nikoli ni bilo zaokroženo.
   */
  integer?: boolean;
  /** Zakaj prav TA rob. Okno brez razloga je samo nova izmišljotina. */
  why: string;
}

export interface InputProblem {
  bound: InputBound;
  /** Kar je monter dejansko vpisal — nikoli prirejeno. */
  typed: number;
  side: 'min' | 'max' | 'nan' | 'fraction';
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

// Stopnice. Stara cena je računala `Math.max(0.6, širina)`, načrt pa vpisano
// širino dobesedno — pri 0,4 m sta bila na dveh mestih različni števili.
export const STOPNICE_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'steps', label: 'Št. stopnic', unit: 'kos', min: 0, max: 60,
    why: 'nad 60 stopnic v eni ponudbi ne načrtuješ ročno, ampak po seznamu stopniščen',
  },
  {
    field: 'stepWidth', label: 'Širina stopnic', unit: 'm', min: 0.4, max: 3,
    why: 'ožje od 40 cm stopnica ni uporabna, širše od 3 m pa deske v tem kalkulatorju ne režejo',
  },
  {
    field: 'totalRiseCm', label: 'Višinska razlika (od tal do galerije)', unit: 'cm', min: 0, max: 600,
    why: 'nad 600 cm višinske razlike ta kalkulator ne predlaga števila stopnic',
  },
];

// Keramika. Cena je rezervo usekala na 30 %, načrt pa jo je bral dobesedno,
// torej je vpisanih 50 % načrt risel po 50 %, ponudba zaračunavala po 30 %.
export const KERAMIKA_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'floorLength', label: 'Dolžina prostora', unit: 'm', min: 0, max: 60,
    why: 'prostor s stranico nad 60 m ni stanovanjska izmera, ki jo ročno obračunaš',
  },
  {
    field: 'floorWidth', label: 'Širina prostora', unit: 'm', min: 0, max: 60,
    why: 'prostor s stranico nad 60 m ni stanovanjska izmera, ki jo ročno obračunaš',
  },
  {
    field: 'wallHeight', label: 'Višina obloženih sten', unit: 'm', min: 0, max: 4,
    why: 'nad 4 m sten ta kalkulator ne predlaga odra in varnostne opreme',
  },
  {
    field: 'reservePercent', label: 'Rezerva za rezanje', unit: '%', min: 0, max: 100,
    why: 'rezerva nad 100 % pomeni dvakrat toliko materiala kot je površina, česar ročni izračun ne razloži',
  },
];

// Okna in vrata. Stara cena je velikost usekala na 0,5 m².
export const OKNA_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'windowCount', label: 'Št. oken', unit: 'kos', min: 0, max: 200,
    why: 'nad 200 kosov gre za objekt s seznamom odprtij, ne za ročni kalkulator',
  },
  {
    field: 'windowSize', label: 'Povprečna velikost okna', unit: 'm²', min: 0, max: 30,
    why: 'velikost samo OPISUJE okno (cena je na kos), zato je 0 m² veljaven vnos, nad 30 m² pa gre za stensko zasnovo, ne posamezno odprtino',
  },
  {
    field: 'doorCount', label: 'Št. zunanjih vrat', unit: 'kos', min: 0, max: 100,
    why: 'nad 100 vratih ta kalkulator ne šteje monterskih ur na kos',
  },
];

// Nadstrešek. Stara cena je št. stebrov usekala na 2, sicer je ponudba
// zavračala upravičen izum (0 stebrov = sidranje na zid).
export const NADSTRESEK_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'canopyWidth', label: 'Širina (fronta)', unit: 'm', min: 0, max: 30,
    why: 'nad 30 m fronte gre za konstrukcijo s statiko, ne za nadstrešek iz ročnega kalkulatorja',
  },
  {
    field: 'canopyDepth', label: 'Globina', unit: 'm', min: 0, max: 15,
    why: 'nad 15 m globine nosilci presegajo meritev, ki jo ta kalkulator še oceni',
  },
  {
    field: 'canopyPosts', label: 'Št. stebrov', unit: 'kos', min: 0, max: 40,
    why: '0 stebrov je veljavno (konstrukcija je sidrana na zid), nad 40 kosov pa razmaka ne znamo več načrtovati',
  },
];

// Fasada. Rob odprtin je tukaj odvisen od drugega vnosa, zato ima še
// povezalno preverjanje (`fasadaOpeningProblem`).
export const FASADA_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'facadePerimeter', label: 'Obseg / dolžina stene', unit: 'm', min: 0, max: 200,
    why: 'nad 200 m obsega gre za več objektov, ne za eno steno iz ročnega kalkulatorja',
  },
  {
    field: 'facadeHeight', label: 'Višina fasade', unit: 'm', min: 0, max: 30,
    why: 'nad 30 m višine fasada potrebuje oder in statiko, česar ta kalkulator ne načrtuje',
  },
  {
    field: 'openingsM2', label: 'Površina odprtin (okna, vrata)', unit: 'm²', min: 0, max: 2000,
    why: 'nad 2000 m² odprtin ta kalkulator ne obvlada',
  },
];

const STOPNICE_DEFAULTS: Record<string, number> = {
  steps: CRAFT_INPUT_DEFAULTS.steps ?? 12,
  stepWidth: CRAFT_INPUT_DEFAULTS.stepWidth ?? 1.1,
  totalRiseCm: CRAFT_INPUT_DEFAULTS.totalRiseCm ?? 0,
};

const KERAMIKA_DEFAULTS: Record<string, number> = {
  floorLength: CRAFT_INPUT_DEFAULTS.floorLength ?? 4,
  floorWidth: CRAFT_INPUT_DEFAULTS.floorWidth ?? 3,
  wallHeight: CRAFT_INPUT_DEFAULTS.wallHeight ?? 0,
  reservePercent: CRAFT_INPUT_DEFAULTS.reservePercent ?? 10,
};

const OKNA_DEFAULTS: Record<string, number> = {
  windowCount: CRAFT_INPUT_DEFAULTS.windowCount ?? 3,
  windowSize: CRAFT_INPUT_DEFAULTS.windowSize ?? 2,
  doorCount: CRAFT_INPUT_DEFAULTS.doorCount ?? 1,
};

const NADSTRESEK_DEFAULTS: Record<string, number> = {
  canopyWidth: CRAFT_INPUT_DEFAULTS.canopyWidth ?? 5,
  canopyDepth: CRAFT_INPUT_DEFAULTS.canopyDepth ?? 3,
  canopyPosts: CRAFT_INPUT_DEFAULTS.canopyPosts ?? 2,
};

const FASADA_DEFAULTS: Record<string, number> = {
  facadePerimeter: CRAFT_INPUT_DEFAULTS.facadePerimeter ?? 36,
  facadeHeight: CRAFT_INPUT_DEFAULTS.facadeHeight ?? 2.8,
  openingsM2: CRAFT_INPUT_DEFAULTS.openingsM2 ?? 12,
};

/**
 * Registracija po dejavnostih. Terasa ima svoj modul (`terasa-inputs.ts`),
 * ker je tam okno nastalo skupaj z rezalnim načrtom; stroj besedila so
 * skupni, da se ne moreta dve formulaciji raziti.
 */
export const CRAFT_INPUT_BOUNDS: Partial<Record<CraftId, readonly InputBound[]>> = {
  ograje: OGRAJE_INPUT_BOUNDS,
  stopnice: STOPNICE_INPUT_BOUNDS,
  keramika: KERAMIKA_INPUT_BOUNDS,
  'okna-vrata': OKNA_INPUT_BOUNDS,
  nadstreški: NADSTRESEK_INPUT_BOUNDS,
  fasada: FASADA_INPUT_BOUNDS,
};

const CRAFT_INPUT_DEFAULTS_BY_CRAFT: Partial<Record<CraftId, Record<string, number>>> = {
  ograje: OGRAJE_DEFAULTS,
  stopnice: STOPNICE_DEFAULTS,
  keramika: KERAMIKA_DEFAULTS,
  'okna-vrata': OKNA_DEFAULTS,
  nadstreški: NADSTRESEK_DEFAULTS,
  fasada: FASADA_DEFAULTS,
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

/**
 * Povezalno preverjanje za fasado: odprtine so lahko manjše od bruto površine
 * stene. Stari `Math.max(0, bruto − odprtine)` je iz napačne izmere naredil
 * nič neto površine in prazno ponudbo brez razloga. `max` te meje je TUJ
 * izračun (bruto površina), zato je meja odvisna od drugega vnosa in jo
 * sestavimo ob klicu — besedilo pa pride iz istega stroja kot vse ostalo.
 */
export function fasadaOpeningProblem(grossM2: number, openingsM2: number): InputProblem | null {
  if (openingsM2 <= grossM2 + 1e-9) return null;
  const bound = FASADA_INPUT_BOUNDS.find((b) => b.field === 'openingsM2');
  if (!bound) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    bound: {
      ...bound,
      max: r2(grossM2),
      why: `odprtine so večje od cele stene (${nf(r2(grossM2))} m²), zato se izmere ne izidejo`,
    },
    typed: openingsM2,
    side: 'max',
  };
}

export function resolveCraftInputs(craft: CraftId, input: CraftInputs): CraftInputResult {
  const bounds = CRAFT_INPUT_BOUNDS[craft];
  const defaults = CRAFT_INPUT_DEFAULTS_BY_CRAFT[craft];
  if (!bounds || !defaults) return { ok: true, v: {}, problems: [] };
  const base = resolveInputBounds(bounds, defaults, input);
  if (!base.ok || craft !== 'fasada') return base;
  const opening = fasadaOpeningProblem(base.v.facadePerimeter * base.v.facadeHeight, base.v.openingsM2);
  if (opening) return { ok: false, v: null, problems: [opening] };
  return base;
}

const nf = (n: number) => formatNum(n, 2);

/** Besedilo okna (»0,4–3 m«, »najmanj 1 dan«). Izvoženo, ker ga uporabljata
 *  tudi namig pod poljem in zavrnitev — sicer se formulaciji lahko razideta. */
export function inputWindowText(b: InputBound): string {
  if (b.min !== null && b.max !== null) return `${nf(b.min)}–${nf(b.max)} ${b.unit}`;
  if (b.min !== null) return `najmanj ${nf(b.min)} ${b.unit}`;
  if (b.max !== null) return `največ ${nf(b.max)} ${b.unit}`;
  return 'kar je vpisano';
}

function windowText(b: InputBound): string {
  return inputWindowText(b);
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

/**
 * Polja, ki imajo že svojo razlago (npr. »0 = oblagujemo samo tla«), morajo
 * obdržati ALSO besedo, številke okna pa še vedno pridejo iz REGISTRA.
 */
export function inputWindowHintWith(craft: CraftId, field: NumericField, extra: string): string {
  const window = inputWindowHint(craft, field);
  return window ? `${extra} · ${window}` : extra;
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
