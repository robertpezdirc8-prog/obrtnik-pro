import type { CraftInputs } from './types';
import { CRAFT_INPUT_DEFAULTS } from './defaults';
import {
  craftProblemShort, craftProblemText, resolveInputBounds,
  type InputBound, type InputProblem,
} from './craft-inputs';

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

export type TerasaInputBound = InputBound;

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

export type TerasaProblem = InputProblem;

/**
 * Vsi trdi, ki jih calculator uporabi. `TerasaResolved` je ožji zapis istih
 * polj, da cen in načrtov ne rabajo indeksnega dostopa.
 */
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
  const r = resolveInputBounds(TERASA_INPUT_BOUNDS, TERASA_DEFAULTS, input);
  if (!r.ok) return { ok: false, v: null, problems: r.problems };
  return { ok: true, v: r.v as unknown as TerasaResolved, problems: [] };
}

/** Kratka oblika za povzetek kalkulatorja — skupen stroj z ostalimi dejavnostmi. */
export const terasaProblemShort = craftProblemShort;

/** Dolga oblika za načrt montaže — skupen stroj z ostalimi dejavnostmi. */
export const terasaProblemText = craftProblemText;
