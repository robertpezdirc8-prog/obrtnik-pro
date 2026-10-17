import { formatNum } from './format';
import { inputWindowText, type InputBound, type InputProblem, type NumericField } from './craft-inputs';

// ─── Vnosna okna nastavitev (denar in roki na dokumentih) ───
//
// Task 83–85 so isto bolezen zdravili v kalkulatorjih. Tu je bila hujša, ker
// gre za številke, ki jih stranka plača. `depositPercent` so štirje bralci
// razumeli vsak po svoje:
//
//   · urejevalnik ponudbe  → vpisano dobesedno, brez vejice (»33.7 %«)
//   · PDF ponudbe          → `Math.floor(...)`, torej 33 %
//   · račun (PDF)           → `Math.floor(...)`, prav tako 33 %
//   · SMS / WhatsApp       → `Math.floor(...)`, a z LASTNIM privzetkom 30 %
//                            (PDF pa svojega: 0 %)
//
// Posledica: monter vpiše 33,7 %, na zaslonu vidi znesek po 33,7 %, dokument
// pa gre iz tiskalnika po 33 %. Pri 150 % je urejevalnik izračunal NEGATIVEN
// ostanek, PDF pa 100 %. Noben od teh prehodov monterju ni povedal, da je
// aplikacija njegovo številko popravila.
//
// Pravilo je torej isto kot povsod drugje: vpisane vrednosti NE popravljamo.
// Ali jo dokument uporabi dobesedno, ali pa vrsto izpusti z razlogom, ki
// imenuje VPISANO vrednost. Zgornjih meja za dni ne postavljamo — to je
// monterjeva poslovna odločitev, ne inženirsko pravilo; spodnja meja pri
// odstotkih izhaja iz enote (odstotek je delež celote), ne iz predpisa.

export type SettingsField = Extract<
  NumericField,
  'vatRate' | 'laborRate' | 'quoteValidDays' | 'depositPercent' | 'paymentDays'
>;

export const SETTINGS_INPUT_BOUNDS: readonly InputBound[] = [
  {
    field: 'depositPercent', label: 'Akontacija (%)', unit: '%', min: 0, max: 100,
    why: 'odstotek je delež celote, zato ga ta aplikacija ne more razumeti drugače kot med 0 in 100',
  },
  {
    field: 'vatRate', label: 'DDV (%)', unit: '%', min: 0, max: 100,
    why: 'stopnja DDV je odstotek osnove; katero stopnjo izbereš, je tvoja davčna odločitev, ne nastavitev aplikacije',
  },
  {
    field: 'laborRate', label: 'Urna postavka dela (€/h)', unit: '€/h', min: 0, max: null,
    why: '0 €/h je veljavno (delo je obračunano drugje), negativne cene ponudba ne more izstaviti',
  },
  {
    field: 'quoteValidDays', label: 'Veljavnost ponudbe (dni)', unit: 'dni', min: 1, max: null, integer: true,
    why: 'ponudba, ki velja 0 dni, ni ponudba; zgornje meje ne postavljamo, ker je dolžina veljavnosti tvoja poslovna odločitev',
  },
  {
    field: 'paymentDays', label: 'Rok plačila računa (dni)', unit: 'dni', min: 1, max: null, integer: true,
    why: 'rok plačila 0 dni pomeni takojšnje plačilo, kar na dokumentu izpisati ne moremo; zgornje meje ne postavljamo',
  },
];

export type SettingsInputValues = Record<SettingsField, number>;

export type SettingsInputResult =
  | { ok: true; v: SettingsInputValues; problems: [] }
  | { ok: false; v: null; problems: InputProblem[] };

const boundFor = (field: SettingsField): InputBound => {
  const b = SETTINGS_INPUT_BOUNDS.find((x) => x.field === field);
  if (!b) throw new Error(`neznan rob za ${field}`);
  return b;
};

/**
 * Nastavitve kot vir resnice za vse dokumente. `input` je lahko celoten
 * `SettingsDTO` ali njegov izseček — manjkajoče število NI naknadno izmišljeno,
 * ampak javljen kot problem (`side: 'nan'`), ker je tihi privzetek ravno tisto,
 * kar je bilo narobe.
 */
export function resolveSettingsInputs(input: Partial<Record<SettingsField, unknown>>): SettingsInputResult {
  const problems: InputProblem[] = [];
  const values = {} as SettingsInputValues;

  for (const bound of SETTINGS_INPUT_BOUNDS) {
    const raw = input[bound.field];
    const value = raw === undefined || raw === null ? Number.NaN : Number(raw);
    values[bound.field] = value;
    if (!Number.isFinite(value)) {
      problems.push({ bound, typed: value, side: 'nan' });
    } else if (bound.min !== null && value < bound.min) {
      problems.push({ bound, typed: value, side: 'min' });
    } else if (bound.max !== null && value > bound.max) {
      problems.push({ bound, typed: value, side: 'max' });
    } else if (bound.integer && !Number.isInteger(value)) {
      problems.push({ bound, typed: value, side: 'fraction' });
    }
  }

  if (problems.length > 0) return { ok: false, v: null, problems };
  return { ok: true, v: values, problems: [] };
}

const nf = (n: number) => formatNum(n, 2);

/**
 * Vpis v polje → število, kakor ga je monter napisal. Prazno polje in
 * neštevilske vrednosti so NaN — NE 0, ker bi `Number('')` sicer pomenil
 * »monter je vpisal ničlo«. vejico pa sprejmemo (`33,7`), ker jo tipka
 * slovenska tipkovnica.
 */
export function parseNumberInput(v: string): number {
  const t = v.trim();
  if (t === '') return Number.NaN;
  return Number(t.replace(',', '.'));
}

/** Namig pod poljem — številke vzame IZ REGISTRA, kot v kalkulatorjih. */
export function settingsWindowHint(field: SettingsField, extra?: string): string {
  const window = `sprejemamo ${inputWindowText(boundFor(field))}; zunaj tega na dokumentu ni izračunano`;
  return extra ? `${extra} · ${window}` : window;
}

/**
 * Stavek o VPISANEM besedilu, ki številka ni — ista oblika za Nastavitve,
 * urejevalnik ponudbe, kalkulator in evidenco ur. Loči se od `settingsProblem*`
 * (ti ocenjujeta številko glede na OKNO); ta pove samo, da brskalnik ni vrnil
 * števila. Vpisano besedilo gre v stavek DOBESEDNO, ker je to edini dokaz, kaj
 * je monter udaril po tipkovnici — `Number('12,5')` bi izginilo.
 */
export function numberProblemSentence(label: string, typed: string): string {
  return typed.trim() === ''
    ? `${label}: številka ni vpisana`
    : `${label} „${typed}“ številka ni`;
}

/** Kratka oblika (vrstica na dokumentu): kaj in koliko, kot ga je monter vpisal. */
export function settingsProblemShort(p: InputProblem): string {
  if (p.side === 'nan') return `${p.bound.label}: številka ni vpisana`;
  return `${p.bound.label} ${nf(p.typed)} ${p.bound.unit}`;
}

/**
 * Dolga oblika za dokument. Za razliko od kalkulatorskega stavka NE pravi
 * »nobena postavka ni obračunana« — postavke ponudbe so pravilne; zaustavljena
 * je samo TA vrsta (akontacija, veljavnost, rok plačila).
 */
export function settingsProblemText(p: InputProblem): string {
  const { bound, typed, side } = p;
  if (side === 'nan') {
    return `${bound.label}: številka ni vpisana. Nastavi vrednost v Nastavitvah ` +
      `(sprejemamo ${inputWindowText(bound)}); vnosa nismo popravili, zato ta vrsta na dokumentu ni izračunana.`;
  }
  if (side === 'fraction') {
    return `${bound.label} ${nf(typed)} ${bound.unit} ni celo število. Polovičnih dni dokument ne more izpisati, ` +
      `zaokrožiti pa jih ne smemo brez tvoje vednosti (sprejemamo ${inputWindowText(bound)}). ` +
      'Vpisane vrednosti nismo popravili, zato ta vrsta na dokumentu ni izračunana.';
  }
  const rel = side === 'min'
    ? `premalo za izračun (${nf(typed)} < ${nf(bound.min ?? 0)})`
    : `preveč za izračun (${nf(typed)} > ${nf(bound.max ?? 0)})`;
  const why = bound.why.charAt(0).toUpperCase() + bound.why.slice(1);
  return `${bound.label} ${nf(typed)} ${bound.unit} je ${rel}; sprejemamo ${inputWindowText(bound)}. ` +
    `${why}. Vpisane vrednosti nismo popravili, zato ta vrsta na dokumentu ni izračunana.`;
}

/**
 * Kateri problemi se nanašajo na TO polje — dokument tako izpusti samo tisto
 * vrsto, ki res ne more biti izračunana, ne pa tudi preostalih postavk.
 */
export function problemsForField(problems: InputProblem[], field: SettingsField): InputProblem[] {
  return problems.filter((p) => p.bound.field === field);
}

export interface SettingReading {
  /** Vpisana vrednost, kakršna je — nikoli usekana, zaokrožena ali nadomeščena. */
  value: number;
  /** Null pomeni: vrednost je v oknu in jo dokument sme uporabiti dobesedno. */
  problem: InputProblem | null;
}

/**
 * EDINI bralec nastavitev za vse dokumente (PDF ponudbe, račun, SMS, zaslon
 * urejevalnika, strežniški rok plačila). `resolveSettingsInputs` pove samo, ali
 * je VSE v oknu; tukaj se rezultat razreže PO POLJIH, ker napaka na enem
 * številskem vnosu ne sme ugasniti ostalih vrst na dokumentu.
 */
export function readSettings(
  input: Partial<Record<SettingsField, unknown>>,
): Record<SettingsField, SettingReading> {
  const r = resolveSettingsInputs(input);
  const out = {} as Record<SettingsField, SettingReading>;
  for (const bound of SETTINGS_INPUT_BOUNDS) {
    const field = bound.field as SettingsField;
    const raw = input[field];
    // ISTA normalizacija kot v resolverju: manjkajoč vnos je NaN, ne `0`
    // (kjer bi `Number(null)` dal 0 in dokument bi izpraznjen stolpec
    // razumel kot ničlo).
    const value = raw === undefined || raw === null ? Number.NaN : Number(raw);
    out[field] = r.ok
      ? { value: r.v[field], problem: null }
      : { value, problem: problemsForField(r.problems, field)[0] ?? null };
  }
  return out;
}
