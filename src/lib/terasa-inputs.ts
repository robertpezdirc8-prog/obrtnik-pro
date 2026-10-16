import type { CraftInputs } from './types';
import { CRAFT_INPUT_DEFAULTS } from './defaults';
import { formatNum } from './format';

// ─── Vnosna okna kalkulatorja WPC terase ────────────────────
//
// POPRAVEK napake, ki je monter ne more opaziti: kalkulator je vpisano
// vrednost TIHO spremenil. `Math.min(0.6, Math.max(0.3, razmak))` pomeni, da
// je na zaslonu pisalo 8 m, obračun pa je tekel pri 0,6 m — račun in slika sta
// si nasprotovala. Enako za ceno deske (`Math.max(1, …)`), dolžino nabavne
// deske in obe dilataciji.
//
// Zdaj ločimo dve stvari, ki prej nista bili ločeni:
//
//  1. OKNO VNOSA (ta modul) — samo to, kar aplikacija še ZNA izračunati.
//     Vrednost zunaj okna ni nujno napačna odločitev montera; lahko je
//     tipkarska napaka ali nerazumljena meritev. Takšnega vnosa aplikacija NE
//     sme popraviti ali usekati: vrne razlog in ne zaračuna ničesar.
//     To NI inženirski predpis in se ne sklicuje na ROKSAL.
//
//  2. ROKSALOVA MEJA (`roksal-span-rules.ts`) — znotraj okna aplikacija
//     računa TOČNO tako, kot je vpisano, objavljeni pas razmika letev
//     (33–35 cm) pa številko samo OCENI (ok / warn / bad). Torej 1,2 m je
//     veljaven vnos, ki bo pošteno označen kot preširok, ne pa skrit za
//     usekom.

export type TerasaField =
  | 'deckLength' | 'deckWidth' | 'joistSpacing'
  | 'boardLengthM' | 'sideGapMm' | 'endGapMm' | 'boardPricePerM';

export interface TerasaInputBound {
  field: TerasaField;
  /** Ime, kot ga vidi monter na zaslonu. */
  label: string;
  unit: string;
  /** Spodnji ali zgornji rob okna; `null` = ta smer ni omejena. */
  min: number | null;
  max: number | null;
  /** Zakaj prav TA rob — okno vnosa mora biti utemeljeno, ne poljubno. */
  why: string;
}

export const TERASA_INPUT_BOUNDS: readonly TerasaInputBound[] = [
  {
    field: 'deckLength', label: 'Dolžina terase', unit: 'm', min: 0.1, max: 100,
    why: 'pod 10 cm ni terase, nad 100 m pa kalkulator ne naroča materiala brez projekta',
  },
  {
    field: 'deckWidth', label: 'Širina terase', unit: 'm', min: 0.1, max: 100,
    why: 'pod 10 cm ni terase, nad 100 m pa kalkulator ne naroča materiala brez projekta',
  },
  {
    field: 'joistSpacing', label: 'Razmak nosilcev', unit: 'm', min: 0.05, max: 3,
    why: 'razmak zunaj 5 cm–3 m aplikacija ne zna več pretvoriti v število nosilcev',
  },
  {
    field: 'boardLengthM', label: 'Nabavna dolžina deske', unit: 'm', min: 0.5, max: 13,
    why: 'krajše od 0,5 m ne nabaviš, daljše od 13 m ne moreš peljati',
  },
  {
    field: 'sideGapMm', label: 'Stranska dilatacija', unit: 'mm', min: 0, max: 50,
    why: 'širša od 50 mm ni dilatacijska reža, ampak vmesni material',
  },
  {
    field: 'endGapMm', label: 'Čelna dilatacija', unit: 'mm', min: 0, max: 50,
    why: 'širša od 50 mm ni dilatacijska reža, ampak vmesni material',
  },
  {
    field: 'boardPricePerM', label: 'Cena deske', unit: '€/m', min: 0, max: null,
    why: 'cena je tvoja pogodba z dobaviteljem — aplikacija zavrne samo negativno',
  },
];

/** Vrednosti, ki jih kalkulator uporabi, kadar polja sploh ni. */
const TERASA_DEFAULTS: Record<TerasaField, number> = {
  deckLength: CRAFT_INPUT_DEFAULTS.deckLength ?? 4,
  deckWidth: CRAFT_INPUT_DEFAULTS.deckWidth ?? 3,
  joistSpacing: CRAFT_INPUT_DEFAULTS.joistSpacing ?? 0.33,
  boardLengthM: CRAFT_INPUT_DEFAULTS.boardLengthM ?? 4,
  sideGapMm: CRAFT_INPUT_DEFAULTS.sideGapMm ?? 5,
  endGapMm: CRAFT_INPUT_DEFAULTS.endGapMm ?? 4,
  boardPricePerM: CRAFT_INPUT_DEFAULTS.boardPricePerM ?? 12.5,
};

export interface TerasaProblem {
  bound: TerasaInputBound;
  /** Kar je monter dejansko vpisal (nikoli ne priredimo). */
  typed: number;
  side: 'min' | 'max' | 'nan';
}

export interface TerasaResolved {
  deckLength: number;
  deckWidth: number;
  joistSpacing: number;
  boardLengthM: number;
  sideGapMm: number;
  endGapMm: number;
  boardPricePerM: number;
}

export type TerasaInput =
  | { ok: true; v: TerasaResolved; problems: [] }
  | { ok: false; v: null; problems: TerasaProblem[] };

export function resolveTerasaInputs(input: CraftInputs): TerasaInput {
  const problems: TerasaProblem[] = [];
  const values = {} as TerasaResolved;

  for (const bound of TERASA_INPUT_BOUNDS) {
    const raw = input[bound.field];
    const given = raw === undefined || Number.isNaN(raw) ? null : Number(raw);
    const value = given === null ? TERASA_DEFAULTS[bound.field] : given;
    values[bound.field] = value;
    if (given === null && raw !== undefined) {
      problems.push({ bound, typed: raw, side: 'nan' });
    } else if (bound.min !== null && value < bound.min) {
      problems.push({ bound, typed: value, side: 'min' });
    } else if (bound.max !== null && value > bound.max) {
      problems.push({ bound, typed: value, side: 'max' });
    }
  }

  if (problems.length > 0) return { ok: false, v: null, problems };
  return { ok: true, v: values, problems: [] };
}

/** Decimalno vejica, kot jo monter bere na zaslonu. */
const nf = (n: number) => formatNum(n, 2);

function windowText(b: TerasaInputBound): string {
  if (b.min !== null && b.max !== null) return `${nf(b.min)}–${nf(b.max)} ${b.unit}`;
  if (b.min !== null) return `najmanj ${nf(b.min)} ${b.unit}`;
  if (b.max !== null) return `največ ${nf(b.max)} ${b.unit}`;
  return 'kar je vpisano';
}

/** Kratka oblika za povzetek kalkulatorja (zelo ozek prostor): samo kaj in koliko. */
export function terasaProblemShort(p: TerasaProblem): string {
  if (p.side === 'nan') return `${p.bound.label}: vnos ni število`;
  return `${p.bound.label} ${nf(p.typed)} ${p.bound.unit}`;
}

/**
 * Eno samo besedilo za oba uporabnika (cena in načrt), da se ne moreta
 * raziti. Navede VPISANO vrednost, ne popravljene — to je bistvo popravka.
 */
export function terasaProblemText(p: TerasaProblem): string {
  const { bound, typed, side } = p;
  if (side === 'nan') {
    return `${bound.label}: vnos ni število. Sprejemamo ${windowText(bound)}. ` +
      'Izračun ni opravljen — nobena postavka ni obračunana.';
  }
  const rel = side === 'min'
    ? `premalo za izračun (${nf(typed)} < ${nf(bound.min ?? 0)})`
    : `preveč za izračun (${nf(typed)} > ${nf(bound.max ?? 0)})`;
  // `why` je v registru pisana z malo (je stavek sredi besedila); tu je prvi stavek
  // za njim, zato mora začeti z veliko — sicer monter bere »… 0 €/m. cena je tvoja …«.
  const why = bound.why.charAt(0).toUpperCase() + bound.why.slice(1);
  return `${bound.label} ${nf(typed)} ${bound.unit} je ${rel}; sprejemamo ${windowText(bound)}. ` +
    `${why}. Izračun ni opravljen — nobena postavka ni obračunana.`;
}
