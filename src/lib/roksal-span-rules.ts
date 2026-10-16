// ─── ROKSALova pravila razmikov (iz javnih navodil montaže) ────────────────
// ČISTO, brez domnev: vsako pravilo spodaj dobesedno citira eno od treh
// objavljenih strani (prebrano 2026-10-16):
//   `roksal.com/woodcore-wpc-deske/montaza-wpc-deske/`
//   `roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/`
//   `roksal.com/pogosta-vprasanja-wpc/`
//
// Zakaj sploh obstaja: `post-layout.ts` je do danes `maxSpanCm` samo PREVERIL
// (60..300 cm) in je sama izbrala 150. Številka 150 je bila doslej privzetek, ne
// vir. Tukaj je vir zapisan stavek za stavkom.
//
// POPRAVEK PROTI PRVI VERZIJI (2026-10-16): prva verzija je pravila vezala samo
// na ELEMENT (stebriček, nosilec, letev). Stran pa isto besedo uporablja za
// različne IZDELKE in številke se razhajajo prav po izdelku: podložna letev je
// na fasadi 70–80 cm, na terasi pa 33–35 cm. Pravilo brez družine torej ne more
// biti pravilno — zato zdaj vsako pravilo nosi `family` in dobeseden `heading`,
// klicatelj pa mora družino izreči. Brez nje modul vrne UNKNOWN in UI številke
// ne sme pokazati.
//
// Štiri vrste poštenosti, ki jih ta modul drži:
//  1. `basis` — DIRECT = citat IMENUJE tisto, kar merimo; ADJACENT = citat
//     govori o drugem elementu in se sme navesti samo kot opomba, nikoli kot meja.
//  2. `kind` — limit = zgornja meja; consequence = posledica (»dodaj še en
//     stebriček«), ki NIKOLI ne more postati meja; range = priporočen pas (reža
//     med deskama), ki nima zgornje meje in zato nikoli ne more biti `binding`.
//  3. pas (133–140) sme vplivati na mejo samo s SPODNJIM robom; zgornji rob
//     pasu je informacija, ne dovoljenje.
//  4. `family` — številka velja samo za izdelek, pod katerim je bila objavljena.

/** Izdelek, za katerega je bilo pravilo objavljeno. */
export type RoksalFamily =
  /** balkonske in dvoriščne ograje (navpični stebri + polnilo) */
  | 'ograja'
  /** terase: podložne letve pod terasno desko */
  | 'terasa'
  /** prezračevane fasade */
  | 'fasada'
  /** pregradne stene iz KUBO profila */
  | 'pregrada'
  /** ročaj kot element ograje (lasten razmik vijakov) */
  | 'rocaj'
  /** korita ob ograji */
  | 'korito';

/** Kontekst, v katerem razmik velja — različni konteksti imajo različne omejitve. */
export type SpanContext =
  /** stebrički / stebri, na katere se polnilo nasloni */
  | 'posts'
  /** nosilci, na katere se deske privijačijo (vodorovne letve pri ograji) */
  | 'bearers'
  /** podložna letev / macesnova mora / kovinska podkonstrukcija pod desko */
  | 'battens'
  /** horizontalne cevi pri KUBO profilu */
  | 'kubo-rails'
  /** vijaki skozi ročaj v nosilno cev/letev */
  | 'handle-screws'
  /** reža (fuga) med sosednjima deskama */
  | 'board-gap';

export type RoksalProfileKind =
  | 'polna-57-32'
  | 'polna-100'
  | 'polna-128'
  | 'romb-67'
  | 'kubo-80-42'
  | 'terasna-150';

/** Pogoj, pri katerem pravilo sploh pride v poštev. Vsi pogoji morajo držati. */
export type SpanCondition =
  | 'panelHeight<=150'
  | 'panelHeight>150'
  | 'profile=polna-57-32'
  | 'profile=polna-100'
  | 'profile=polna-128'
  | 'profile=romb-67'
  | 'profile=kubo-80-42'
  | 'profile=terasna-150'
  | 'orientation=horizontal'
  | 'orientation=cross'
  | 'orientation=vertical'
  | 'lBracket'
  | 'kuboAluInsert'
  | 'kuboNoInsert';

interface SpanRuleBase {
  /** stabilna oznaka za doklade (npr. v poročilu) */
  id: string;
  context: SpanContext;
  /** izdelek, pod katerim je citat objavljen — nujno za pravilno mejo */
  family: RoksalFamily;
  /** dobeseden naslov odseka na strani, pod katerim citat stoji */
  heading: string;
  /** DIRECT = citat imenuje merjeni element; ADJACENT = samo opomba */
  basis: 'DIRECT' | 'ADJACENT';
  /** dobeseden citat z objavljenega navodila (nikoli preveden) */
  quote: string;
  /** kje je bilo prebrano (domena strani) */
  source: string;
  /** številko je potrdila še druga stran — navedeno, a ne podvoji meje */
  alsoSeenAt?: string;
  appliesTo?: SpanCondition | readonly SpanCondition[];
}

/** Zgornja meja. Za pasove je `limitCm` VEDNO SPODNJI rob pasu — ne zgornji. */
export interface SpanLimitRule extends SpanRuleBase {
  kind: 'limit';
  limitCm: number;
  /** pas, če citat ne daje ene same številke */
  bandCm?: [number, number];
}

/** Priporočen pas (reža med deskami): obe meji sta levi, nikoli ne vežeta. */
export interface SpanRangeRule extends SpanRuleBase {
  kind: 'range';
  rangeCm: [number, number];
}

/** Posledica (»dodaj še en stebriček«): oglasi se pri razmiku ≥ prag, nikoli ne zniža meje. */
export interface SpanConsequenceRule extends SpanRuleBase {
  kind: 'consequence';
  firesAtSpacingCm: number;
  /** monterjevo besedilo — citat je predolg za v UI */
  advice: string;
}

export type SpanRule = SpanLimitRule | SpanRangeRule | SpanConsequenceRule;

const URL_MONTAZA = 'roksal.com/woodcore-wpc-deske/montaza-wpc-deske/';
const URL_OGRAJE = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/';
const URL_FAQ = 'roksal.com/pogosta-vprasanja-wpc/';

/** Dobesedni naslovi odsekov, kot jih ima stran. */
export const SPAN_HEADINGS = {
  polna5732: 'Montaža pokončne ograje - profil POLNA DESKA-57-32',
  polna100128: 'Montaža pokončne ograje - profil POLNA DESKA-100 in POLNA DESKA-128',
  romb67: 'Montaža prečne ograje - profil ROMB DESKA-67',
  deska150: 'Montaža prečne ograje - profil DESKA-150',
  deska128: 'Montaža prečne ograje - profil DESKA-128',
  rocaj: 'Pritrjevanje ročaja',
  fasada: 'Montaža fasade',
  kubo: 'Montaža pregradne stene - KUBO',
  faqTerasa: 'TERASE (pogosta vprašanja)',
  faqOgraje: 'OGRAJE (pogosta vprašanja)',
  faqFasade: 'FASADE (pogosta vprašanja)',
  faqPregrade: 'PREGRADNE STENE (pogosta vprašanja)',
  faqRazmak: 'Kakšen je maksimalen razmak med stebri?',
} as const;

/**
 * Vsa pravila, ki jih je stran leta 2026 objavila v zvezi z razmiki.
 * `limitCm` je VEDNO meja, ki jo sme monter uporabiti (pri pasu spodnji rob).
 */
export const SPAN_RULES: SpanRule[] = [
  // ── OGRAJA ──────────────────────────────────────────────────────────────
  {
    id: 'ograja-polna5732-posts-150',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna5732,
    limitCm: 150,
    appliesTo: 'profile=polna-57-32',
    quote: 'Maksimalni razmak med stebrički je 150 cm ne glede na višino ograje.',
    source: URL_MONTAZA,
  },
  {
    // 100 cm NI splošna meja nosilcev — objavljena je samo pod profilom 57-32.
    id: 'ograja-polna5732-bearers-100',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'bearers',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna5732,
    limitCm: 100,
    appliesTo: 'profile=polna-57-32',
    quote: 'Največja dovoljena razdalja med nosilci je 100 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-polna100128-posts-180-low',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna100128,
    limitCm: 180,
    appliesTo: ['profile=polna-100', 'panelHeight<=150'],
    quote: 'Maksimalni razmak med stebrički je 180 cm pri ograjah, ki so visoke do 150 cm višine.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-polna100128-posts-150-tall',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna100128,
    limitCm: 150,
    appliesTo: ['profile=polna-100', 'panelHeight>150'],
    quote: 'Pri višjih ograjah pa je maksimalni razmak med stebrički 150 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-polna128-posts-110',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.deska128,
    limitCm: 110,
    appliesTo: 'profile=polna-128',
    quote: 'Stebrički za vodoravno postavitev desk morajo biti na maksimalni razdalji 110 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-romb67-posts-lbracket-145',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.romb67,
    limitCm: 145,
    appliesTo: ['profile=romb-67', 'lBracket'],
    quote: 'Maksimalna razdalja med stebrički z L-kotniki je 145 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-romb67-extra-over-180',
    kind: 'consequence',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.romb67,
    firesAtSpacingCm: 180,
    advice: 'Pri razmiku 180 cm ali več ROKSAL zahteva še en dodaten stebriček.',
    quote: 'Če je razmak enak ali večji od 180 cm je potrebno dodati še en stebriček.',
    source: URL_MONTAZA,
  },
  {
    id: 'ograja-deska150-posts-horizontal-band',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.deska150,
    limitCm: 133,
    bandCm: [133, 140],
    appliesTo: ['profile=terasna-150', 'orientation=horizontal'],
    quote: 'Stebrički za vodoravno postavitev desk morajo biti na maksimalni razdalji 133 – 140 cm.',
    source: URL_MONTAZA,
  },
  {
    // Splošna trditev (brez profila): velja za vsako prečno ograjo. Zgornji rob
    // 145 je samo informacija — meja je spodnjih 133 cm.
    id: 'ograja-posts-cross-133',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.faqRazmak,
    limitCm: 133,
    bandCm: [133, 145],
    appliesTo: 'orientation=cross',
    quote: 'Za prečno postavitev je maksimalen razmak med stebri 133–145 cm, odvisno od izbranega profila.',
    source: URL_OGRAJE,
    alsoSeenAt: URL_FAQ,
  },
  {
    id: 'ograja-posts-vertical-200',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    family: 'ograja',
    heading: SPAN_HEADINGS.faqRazmak,
    limitCm: 200,
    appliesTo: 'orientation=vertical',
    quote: 'Za pokončno postavitev je maksimalen razmak 200 cm.',
    source: URL_OGRAJE,
    alsoSeenAt: URL_FAQ,
  },
  {
    id: 'korito-battens-70',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'korito',
    heading: SPAN_HEADINGS.faqOgraje,
    limitCm: 70,
    quote: 'Za korita je potrebno pripraviti kovinsko konstrukcijo v razmaku 70 cm.',
    source: URL_FAQ,
  },
  // ── ROČAJ ───────────────────────────────────────────────────────────────
  {
    id: 'rocaj-handle-screws-50',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'handle-screws',
    family: 'rocaj',
    heading: SPAN_HEADINGS.rocaj,
    limitCm: 50,
    quote: 'Ročaj se vijači v razmaku 50 cm skozi ročaj v nosilno cev.',
    source: URL_MONTAZA,
    alsoSeenAt: URL_FAQ,
  },
  // ── FASADA ──────────────────────────────────────────────────────────────
  {
    id: 'fasada-battens-70',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'fasada',
    heading: SPAN_HEADINGS.fasada,
    limitCm: 70,
    bandCm: [70, 80],
    quote: 'Na njo se privijači podložna letev debeline 4 cm, širine 6 cm iz macesna v razmakih 70 – 80 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'fasada-polna100-battens-50',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasade,
    limitCm: 50,
    appliesTo: 'profile=polna-100',
    quote: 'Polna deska 100: Maksimalna razdalja med macesnovimi morali je 50 cm.',
    source: URL_FAQ,
  },
  {
    id: 'fasada-romb-battens-80',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasade,
    limitCm: 80,
    appliesTo: 'profile=romb-67',
    quote: 'Romb: Maksimalna razdalja med macesnovimi morali je 80 cm.',
    source: URL_FAQ,
  },
  {
    // KUBO na FASADI: 100 cm. KUBO kot PREGRADNA STENA: 120/260 cm. Isti profil,
    // različen izdelek — brez `family` bi modul izenačil napačno številko.
    id: 'fasada-kubo-rails-100',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'kubo-rails',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasade,
    limitCm: 100,
    appliesTo: 'profile=kubo-80-42',
    quote: 'Kubo: Maksimalna razdalja med alu cevmi je 100 cm.',
    source: URL_FAQ,
  },
  // ── TERASA ──────────────────────────────────────────────────────────────
  {
    id: 'terasa-battens-33',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'terasa',
    heading: SPAN_HEADINGS.faqTerasa,
    limitCm: 33,
    bandCm: [33, 35],
    quote: 'V primeru da so podložne letve v razmaku 33-35 cm (center) do zvijanja desk ne more priti.',
    source: URL_FAQ,
  },
  {
    id: 'terasa-steel-substructure-33',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    family: 'terasa',
    heading: SPAN_HEADINGS.faqTerasa,
    limitCm: 33,
    bandCm: [33, 35],
    quote: 'Deske lahko privijačite na kovinsko konstrukcijo, ki mora biti na maksimalnem razmaku 33-35 cm (center).',
    source: URL_FAQ,
  },
  // ── PREGRADNA STENA (KUBO) ─────────────────────────────────────────────
  {
    id: 'pregrada-kubo-rails-120',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'kubo-rails',
    family: 'pregrada',
    heading: SPAN_HEADINGS.kubo,
    limitCm: 120,
    appliesTo: ['profile=kubo-80-42', 'kuboNoInsert'],
    quote: 'Maksimalni razpon med horizontalnimi cevmi brez dodatkov je 120 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'pregrada-kubo-rails-260-alu',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'kubo-rails',
    family: 'pregrada',
    heading: SPAN_HEADINGS.kubo,
    limitCm: 260,
    appliesTo: ['profile=kubo-80-42', 'kuboAluInsert'],
    quote: 'Če je razpon konstrukcije večji od 120 cm, se v KUBO letvico vstavi alu cev 20 × 60 × 2 mm, ' +
      'v tem primeru je dovoljeni razpon med horizontalnimi nosilci do 260 cm.',
    source: URL_MONTAZA,
  },
  // ── REŽA MED DESKAMI (pas, ne meja) ────────────────────────────────────
  {
    id: 'ograja-polna100128-board-gap-range',
    kind: 'range',
    basis: 'DIRECT',
    context: 'board-gap',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna100128,
    rangeCm: [0.5, 3],
    appliesTo: 'profile=polna-100',
    quote: 'Priporočen razmak med deskami je od 0,5cm do 3cm.',
    source: URL_MONTAZA,
  },
  {
    // ADJACENT: številka stoji v samem VPRAŠANJU, ne v odgovoru — sme se
    // navesti kot opomba, nikoli kot predpis.
    id: 'terasa-board-gap-5-6mm',
    kind: 'range',
    basis: 'ADJACENT',
    context: 'board-gap',
    family: 'terasa',
    heading: SPAN_HEADINGS.faqTerasa,
    rangeCm: [0.5, 0.6],
    quote: 'Med deskami je razmak 5-6mm kako potem čistite umazanijo, ki se nabira spodaj?',
    source: URL_FAQ,
  },
];

export interface MaxSpanInput {
  /** izreči izdelek; brez njega modul NE SME vrniti meje */
  family: RoksalFamily;
  context?: SpanContext;
  /** višina polnila/ograje v cm; izpuščena = monter je ni vnesel */
  panelHeightCm?: number | null;
  profile?: RoksalProfileKind | null;
  /** deske ležijo vodoravno (133–140), prečno (133–145) ali pokončno (200) */
  orientation?: 'horizontal' | 'cross' | 'vertical' | null;
  /** pritrditev z L-kotniki (145 cm pri ROMB) */
  lBracket?: boolean;
  /** KUBO: v letvico je vstavljena alu cev 20 × 60 × 2 mm (sicer 120 cm) */
  kuboAluInsert?: boolean;
}

export interface ProfileLimitRow {
  profile: RoksalProfileKind;
  limitCm: number;
  heading: string;
  quote: string;
  source: string;
}

export interface MaxSpanVerdict {
  family: RoksalFamily;
  context: SpanContext;
  /** meja, ki jo sme monter uporabiti; 0 kadar utemeljene meje ni */
  maxSpanCm: number;
  /** pravilo, ki je odločilo; `null` kadar ni nobenega */
  binding: SpanLimitRule | null;
  /** vsa veljavna NEPOSREDNA mejna pravila, od najstrožjega naprej */
  applicable: SpanLimitRule[];
  /** veljavna posledična pravila — monter jih vidi, meja iz njih NE postane */
  consequences: SpanConsequenceRule[];
  /** veljavni priporočeni pasovi (reža) — nikoli ne vežejo kot meja */
  ranges: SpanRangeRule[];
  /** citati o drugem elementu, ki so na voljo a NISO uporabljene meje */
  analogies: SpanLimitRule[];
  /** kadar meja obstaja, a profil ni izbran — tabela mej po profilih */
  byProfile: ProfileLimitRow[];
  /** najstrožja od objavljenih meja po profilih; `null` kadar tabele ni */
  profileFloorCm: number | null;
  /** kje se citata res razhajata — modul tega NE reši z izborom, ampak javi */
  conflicts: string[];
  /** opombe, ki jih monter mora videti (pas, analogija, manjkajoč podatek) */
  notes: string[];
  /** SOURCED = odločilo je neposredno citatno pravilo; UNKNOWN = utemeljene številke ni */
  assurance: 'SOURCED' | 'UNKNOWN';
}

function conditionsOf(rule: SpanRule): readonly SpanCondition[] {
  const c = rule.appliesTo;
  if (!c) return [];
  return typeof c === 'string' ? [c] : c;
}

/** Ali pravilo spada k tem vhodom? Vsi pogoji morajo držati; brez pogojev velja vedno. */
function conditionHolds(cond: SpanCondition, input: MaxSpanInput): boolean {
  const h = input.panelHeightCm;
  switch (cond) {
    case 'panelHeight<=150':
      return typeof h === 'number' && Number.isFinite(h) && h > 0 && h <= 150;
    case 'panelHeight>150':
      return typeof h === 'number' && Number.isFinite(h) && h > 150;
    case 'profile=polna-57-32':
      return input.profile === 'polna-57-32';
    case 'profile=polna-100':
      return input.profile === 'polna-100';
    case 'profile=polna-128':
      return input.profile === 'polna-128';
    case 'profile=romb-67':
      return input.profile === 'romb-67';
    case 'profile=kubo-80-42':
      return input.profile === 'kubo-80-42';
    case 'profile=terasna-150':
      return input.profile === 'terasna-150';
    case 'orientation=horizontal':
      return input.orientation === 'horizontal';
    case 'orientation=cross':
      return input.orientation === 'cross';
    case 'orientation=vertical':
      return input.orientation === 'vertical';
    case 'lBracket':
      return input.lBracket === true;
    case 'kuboAluInsert':
      return input.kuboAluInsert === true;
    case 'kuboNoInsert':
      return input.kuboAluInsert !== true;
  }
}

function ruleApplies(rule: SpanRule, input: MaxSpanInput): boolean {
  return conditionsOf(rule).every((c) => conditionHolds(c, input));
}

const PROFILE_LABELS: Record<RoksalProfileKind, string> = {
  'polna-57-32': 'POLNA DESKA 57-32',
  'polna-100': 'POLNA DESKA 100',
  'polna-128': 'POLNA DESKA 128',
  'romb-67': 'ROMB DESKA 67',
  'kubo-80-42': 'KUBO 80-42',
  'terasna-150': 'DESKA 150 (terasna)',
};

export function profileLabel(profile: RoksalProfileKind): string {
  return PROFILE_LABELS[profile];
}

/**
 * Imena MANJKAJOČIH VHOODOV (ne posameznega pogoja): klicatelj vprašanje
 * zastavi enkrat, zato tudi odgovor imenuje enkrat — trikrat zapored
 * „orientacija (prečno), orientacija (pokončno) …“ bi bilo šum.
 */
const CONDITION_LABELS: Record<string, string> = {
  'orientation=horizontal': 'orientacija desk',
  'orientation=cross': 'orientacija desk',
  'orientation=vertical': 'orientacija desk',
  'panelHeight<=150': 'višina polnila',
  'panelHeight>150': 'višina polnila',
  lBracket: 'način pritrditve (L-kotnik)',
  kuboAluInsert: 'alu vstavek 20 × 60 × 2 mm',
  kuboNoInsert: 'alu vstavek 20 × 60 × 2 mm',
};

/**
 * Ali pogoja sploh NI bilo mogoče ovrednotiti, ker klicatelj vhoda ni izrekel —
 * kaj sesuatu drugega (izrecno drugačna izbira) JE pa odločen odgovor.
 */
function conditionAbsent(cond: SpanCondition, input: MaxSpanInput): boolean {
  switch (cond) {
    case 'panelHeight<=150':
    case 'panelHeight>150':
      return input.panelHeightCm === undefined || input.panelHeightCm === null;
    case 'orientation=horizontal':
    case 'orientation=cross':
    case 'orientation=vertical':
      return !input.orientation;
    case 'lBracket':
      return input.lBracket === undefined;
    case 'kuboAluInsert':
    case 'kuboNoInsert':
      return input.kuboAluInsert === undefined;
    default:
      // profili: obravnava jih tabela `profileRows`
      return false;
  }
}

/**
 * Objavljena meja obstaja, a odvisna je od vhoda, ki še ni izrečen. Brez te
 * ugotovitve bi UNKNOWN lažno trdil „ROKSAL tega ne objavlja“ v primeru, ko
 * monter samo ni odgovoril na vprašanje (npr. profil 100 brez višine polnila).
 */
function unevaluatedLabels(input: MaxSpanInput, context: SpanContext): string[] {
  const missed = SPAN_RULES.filter(
    (r): r is SpanLimitRule => r.family === input.family && r.context === context &&
      r.kind === 'limit' && r.basis === 'DIRECT' && !ruleApplies(r, input),
  );
  const labels: string[] = [];
  for (const r of missed) {
    const failing = conditionsOf(r).filter((c) => !conditionHolds(c, input));
    if (failing.length > 0 && failing.every((c) => conditionAbsent(c, input))) {
      for (const c of failing) {
        const label = CONDITION_LABELS[c] ?? c;
        if (!labels.includes(label)) labels.push(label);
      }
    }
  }
  return labels;
}

function missingInputs(conds: readonly SpanCondition[], probe: MaxSpanInput): string[] {
  const out: string[] = [];
  for (const c of conds) {
    if (c.startsWith('profile=')) continue;
    if (!conditionHolds(c, probe)) {
      const label = CONDITION_LABELS[c] ?? c;
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

interface ProfileRows {
  rows: ProfileLimitRow[];
  /** profili, katerih meja je NI bilo mogoče ovrednoteti — in kaj manjka */
  unresolved: { profile: RoksalProfileKind; missing: string[] }[];
}

/**
 * Tabela mej po profilih za dano družino in kontekst — uporabí se, kadar
 * klicatelj profila še ni izrekel: številka obstaja, a je odvisna, zato ne sme
 * biti prikazana kot ena sama meja.
 */
function profileRows(input: MaxSpanInput): ProfileRows {
  const limits = SPAN_RULES.filter(
    (r): r is SpanLimitRule => r.family === input.family && r.context === (input.context ?? 'posts') &&
      r.kind === 'limit' && r.basis === 'DIRECT',
  );
  const rows: ProfileLimitRow[] = [];
  const unresolved: ProfileRows['unresolved'] = [];
  for (const profile of Object.keys(PROFILE_LABELS) as RoksalProfileKind[]) {
    const probe: MaxSpanInput = { ...input, profile };
    const candidates = limits.filter((r) => ruleApplies(r, probe));
    if (candidates.length > 0) {
      const strictest = candidates.reduce((a, b) => (a.limitCm <= b.limitCm ? a : b));
      rows.push({
        profile,
        limitCm: strictest.limitCm,
        heading: strictest.heading,
        quote: strictest.quote,
        source: strictest.source,
      });
      continue;
    }
    // Kateri pogoji so zavrnili samo zaradi neznanega vhoda?
    const profiled = limits.filter((r) => conditionsOf(r).includes(`profile=${profile}` as SpanCondition));
    const missing = profiled.length
      ? [...new Set(profiled.flatMap((r) => missingInputs(conditionsOf(r), probe)))]
      : [];
    if (profiled.length > 0) unresolved.push({ profile, missing });
  }
  return { rows: rows.sort((a, b) => a.limitCm - b.limitCm), unresolved };
}

/**
 * Največji dovoljeni razmak za dano družino in kontekst, po objavljenih
 * pravilih. Odloči NAJSTROŽJE neposredno pravilo; analogije so samo opomba.
 */
export function maxAllowedSpan(input: MaxSpanInput): MaxSpanVerdict {
  const context = input.context ?? 'posts';
  const matched = SPAN_RULES.filter(
    (r) => r.family === input.family && r.context === context && ruleApplies(r, input),
  );

  const limits = matched.filter((r): r is SpanLimitRule => r.kind === 'limit');
  const consequences = matched.filter((r): r is SpanConsequenceRule => r.kind === 'consequence');
  const ranges = matched.filter((r): r is SpanRangeRule => r.kind === 'range');
  const applicable = limits.filter((r) => r.basis === 'DIRECT').sort((a, b) => a.limitCm - b.limitCm);
  const analogies = limits.filter((r) => r.basis === 'ADJACENT').sort((a, b) => a.limitCm - b.limitCm);
  const binding = applicable[0] ?? null;
  const rows = input.profile ? { rows: [] as ProfileLimitRow[], unresolved: [] } : profileRows(input);
  const profileFloorCm = rows.rows.length > 0 ? rows.rows[0].limitCm : null;

  if (!binding) {
    const notes: string[] = [];
    if (rows.rows.length > 0) {
      notes.push(
        `Meja je odvisna od profila — ene same številke ni: ` +
          rows.rows.map((r) => `${profileLabel(r.profile)} ${r.limitCm} cm`).join(', ') + '.',
      );
      notes.push(
        `Najstrožja od objavljenih mej je ${profileFloorCm} cm; velja samo, če montiraš tisti profil.`,
      );
    }
    if (rows.unresolved.length > 0) {
      notes.push(
        `Za ${rows.unresolved.map((u) => profileLabel(u.profile)).join(', ')} meja ni ovrednotena — manjka: ` +
          [...new Set(rows.unresolved.flatMap((u) => u.missing))].join(', ') + '.',
      );
    }
    const pending = rows.rows.length === 0 && rows.unresolved.length === 0
      ? unevaluatedLabels(input, context)
      : [];
    if (pending.length > 0) {
      notes.push(
        `ROKSAL za „${input.family} / ${context}“ objavlja mejo, a te ni bilo mogoče ovrednotiti — ` +
          `manjka: ${pending.join(', ')} (številka zato NI prikazana).`,
      );
    }
    if (rows.rows.length === 0 && rows.unresolved.length === 0 && pending.length === 0) {
      notes.push(
        ranges.length > 0
          ? `ROKSAL za „${input.family} / ${context}“ objavlja samo priporočen pas, ne zgornje meje — meja kot številka ne bi bila utemeljena.`
          : `ROKSAL za izdelek „${input.family}“ in kontekst „${context}“ ne objavlja omejitve razmika — številka ne bi bila utemeljena.`,
      );
    }
    for (const r of ranges) {
      notes.push(
        `Priporočen pas za „${context}“ je ${r.rangeCm[0]}–${r.rangeCm[1]} cm (${r.source}) — pas ne veže kot meja.`,
      );
    }
    return {
      family: input.family,
      context,
      maxSpanCm: 0,
      binding: null,
      applicable: [],
      consequences,
      ranges,
      analogies,
      byProfile: rows.rows,
      profileFloorCm,
      conflicts: [],
      notes,
      assurance: 'UNKNOWN',
    };
  }

  const notes: string[] = [];
  const conflicts: string[] = [];

  // Pas (133–140) je bistven: ena sama številka bi lažno obljubila zgornji rob.
  if (binding.bandCm) {
    notes.push(
      `Objavljeno kot pas ${binding.bandCm[0]}–${binding.bandCm[1]} cm; varna meja je spodnji rob ${binding.limitCm} cm.`,
    );
  }
  for (const a of analogies) {
    notes.push(
      `Citat ${a.limitCm} cm govori o drugem elementu kot o „${context}“ (»${a.quote.slice(0, 44)}…«) — ni uporabljen kot meja.`,
    );
  }
  for (const r of ranges) {
    notes.push(
      `Priporočen pas za „${context}“ je ${r.rangeCm[0]}–${r.rangeCm[1]} cm (${r.source}) — pas ne veže kot meja.`,
    );
  }
  // Razhajanje je samo med ENAKO splošnimi citati. Splošen citat proti
  // profilnemu ni protislovje, ampak specializacija — zato ne šteje.
  const general = applicable.filter((r) => !conditionsOf(r).some((c) => c.startsWith('profile=')));
  if (general.length > 1) {
    const lo = general[0];
    const hi = general[general.length - 1];
    if (lo.limitCm !== hi.limitCm) {
      conflicts.push(
        `Dva enako splošna objavljena citata dajeta različni meji: ${lo.limitCm} cm („${lo.heading}“) proti ` +
          `${hi.limitCm} cm („${hi.heading}“). Vzeta je NIŽJA; za višjo mora potrditi dobavitelj.`,
      );
    }
  }
  // Orientacija: če monterjeva izbira dopušča več, mora vedeti, da je omejuje drug citat.
  if (context === 'posts') {
    if (input.orientation) {
      const byOrient = applicable.filter((r) => conditionsOf(r).some((c) => c.startsWith('orientation=')));
      const loosest = byOrient.reduce((m, r) => Math.max(m, r.limitCm), 0);
      if (loosest > binding.limitCm) {
        notes.push(
          `Orientacija „${input.orientation}“ bi po svojem citatu dovolila do ${loosest} cm, a drugo objavljeno ` +
            `pravilo je strožje (${binding.limitCm} cm) — velja strožje.`,
        );
      }
    } else {
      notes.push('Orientacija desk ni izbrana — pas 133–140 / 133–145 in 200 cm zato nista mogla biti ovrednotena.');
    }
    if (typeof input.panelHeightCm !== 'number') {
      notes.push('Višina polnila ni vnesena — pravili, vezani na višino (180 cm do 150 cm višine), nista mogla biti ovrednotena.');
    }
  }
  if (context === 'kubo-rails' && input.family === 'pregrada' && input.kuboAluInsert !== true) {
    notes.push('Brez vstavljene alu cevi 20 × 60 × 2 mm velja 120 cm; do 260 cm sme samo z vstavkom.');
  }
  if (input.profile === 'kubo-80-42' && context === 'kubo-rails' && input.family !== 'pregrada') {
    notes.push('KUBO je objavljen v dveh vlogah: fasada (100 cm) in pregradna stena (120/260 cm). Preveri, kateri izdelek montiraš.');
  }

  return {
    family: input.family,
    context,
    maxSpanCm: binding.limitCm,
    binding,
    applicable,
    consequences,
    ranges,
    analogies,
    byProfile: rows.rows,
    profileFloorCm,
    conflicts,
    notes,
    assurance: 'SOURCED',
  };
}

/**
 * Ali je monterjev razmak skladen? `null` pomeni „nerazpoložljivo“ (brez
 * vira ne moremo trditi ne enega ne drugega) — klicatelj sme pokazati
 * besedilo samo ob `true`/`false`, ob `null` pa mora molčati ali reči
 * „ni utemeljeno“.
 */
export function checkSpan(
  input: MaxSpanInput,
  spacingCm: number,
): {
  ok: boolean | null;
  verdict: MaxSpanVerdict;
  fires: SpanConsequenceRule[];
  /** pasovi, ki jih razmak krši (npr. reža 4 mm pod objavljenimi 5–6 mm) */
  outsideRange: SpanRangeRule[];
} {
  const verdict = maxAllowedSpan(input);
  if (!Number.isFinite(spacingCm)) {
    return { ok: null, verdict, fires: [], outsideRange: [] };
  }
  // Pasovi (reža med deskama) se javljajo tudi brez meje: priporočilo je
  // citirano, trditev o SKLADNOSTI pa utemeljene meje brez vira ne more biti.
  const outsideRange = verdict.ranges.filter(
    (r) => r.basis === 'DIRECT' && (spacingCm < r.rangeCm[0] || spacingCm > r.rangeCm[1]),
  );
  if (verdict.assurance === 'UNKNOWN') {
    return { ok: null, verdict, fires: [], outsideRange };
  }
  const fires = verdict.consequences.filter((r) => spacingCm >= r.firesAtSpacingCm);
  return { ok: spacingCm <= verdict.maxSpanCm, verdict, fires, outsideRange };
}

/**
 * Nasvet v eni stavku za v UI. `null` = ni utemeljene številke in UI ne
 * sme pokazati meje (enako kot drugje: brez vira nobena trditev).
 */
export function spanAdvice(input: MaxSpanInput): string | null {
  const v = maxAllowedSpan(input);
  if (!v.binding) return null;
  const b = v.binding;
  const why = b.bandCm ? `objavljeno kot pas ${b.bandCm[0]}–${b.bandCm[1]} cm` : `vir: ${b.source}`;
  return `Največ ${b.limitCm} cm (${why}).`;
}
