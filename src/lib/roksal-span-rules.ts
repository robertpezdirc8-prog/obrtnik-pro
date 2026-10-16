// ─── ROKSALova pravila razmikov (iz javnih navodil montaže) ────────────────
// ČISTO, brez domnev: vsako pravilo spodaj dobesedno citira stran
// `roksal.com/woodcore-wpc-deske/montaza-wpc-deske/` ali
// `.../balkonske-ograje-in-dvoriscne-ograje/` (prebrano 2026-10-16). Kjer se
// dva citata razhajata, modul NE izbere enega «lepšega» — vzame STROŽJEGA in
// razhajanje izrecno javi. To je isto načelo kot drugje v aplikaciji:
// monter sme videti samo tisto, kar je utemeljeno.
//
// Zakaj sploh obstaja: `post-layout.ts` je do danes `maxSpanCm` samo PREVERIL
// (60..300 cm) in je sama izbrala 150. Številka 150 je bila doslej privzetek, ne
// vir. Tukaj je vir zapisan stavek za stavkom, da lahko aplikacija reče
// »največ 133 cm, ker gre za pas vodoravne postavitve, ne za poljubnih 150«.
//
// Tri vrste poštenosti, ki jih ta modul drži:
//  1. `basis` — DIRECT = citat IMENUJE tisto, kar merimo; ADJACENT = citat
//     govori o drugem elementu in se sme navesti samo kot opomba, nikoli kot meja.
//  2. `kind` — limit = zgornja meja; consequence = posledica (»dodaj še en
//     stebriček«), ki NIKOLI ne more postati meja.
//  3. pas (133–140) sme vplivati samo s SPODNJIM robom; zgornji rob pasu je
//     informacija, ne dovoljenje.

/** Kontekst, v katerem razmik velja — različni konteksti imajo različne omejitve. */
export type SpanContext =
  /** stebrički pod vodoravno postavljenimi deskami / polnilom */
  | 'posts'
  /** letve / nosilci, na katere se deske pritrdijo */
  | 'bearers'
  /** horizontalne cevi pri KUBO profilu */
  | 'kubo-rails'
  /** vijaki skozi ročaj v nosilno cev */
  | 'handle-screws'
  /** podložne letve pod romb na fasadi */
  | 'battens';

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
  | 'profile=polna-128'
  | 'profile=kubo-80-42'
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
  /** DIRECT = citat imenuje merjeni element; ADJACENT = sme se navesti samo kot opomba */
  basis: 'DIRECT' | 'ADJACENT';
  /** dobeseden citat z objavljenega navodila (nikoli preveden) */
  quote: string;
  /** kje je bilo prebrano (domena strani) */
  source: string;
  appliesTo?: SpanCondition | readonly SpanCondition[];
}

/** Zgornja meja. Za pasu je `limitCm` VEDNO SPODNJI rob pasu — ne zgornji. */
export interface SpanLimitRule extends SpanRuleBase {
  kind: 'limit';
  limitCm: number;
  /** pas, če citat ne daje ene same številke */
  bandCm?: [number, number];
}

/** Posledica (»dodaj še en stebriček«): oglasi se pri razmiku ≥ prag, nikoli ne zniža meje. */
export interface SpanConsequenceRule extends SpanRuleBase {
  kind: 'consequence';
  firesAtSpacingCm: number;
  /** monterjevo besedilo — citat je predolg za v UI */
  advice: string;
}

export type SpanRule = SpanLimitRule | SpanConsequenceRule;

const URL_MONTAZA = 'roksal.com/woodcore-wpc-deske/montaza-wpc-deske/';
const URL_OGRAJE = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/';

/**
 * Vsa pravila, ki jih je stran leta 2026 objavila v zvezi z razmiki.
 * `limitCm` je VEDNO meja, ki jo sme monter uporabiti (pri pasu spodnji rob).
 */
export const SPAN_RULES: SpanRule[] = [
  {
    id: 'posts-abs-150',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 150,
    quote: 'Maksimalni razmak med stebrički je 150 cm ne glede na višino ograje.',
    source: URL_MONTAZA,
  },
  {
    id: 'posts-180-low',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 180,
    quote: 'Maksimalni razmak med stebrički je 180 cm pri ograjah, ki so visoke do 150 cm višine.',
    source: URL_MONTAZA,
    appliesTo: 'panelHeight<=150',
  },
  {
    id: 'posts-150-tall',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 150,
    quote: 'Pri višjih ograjah pa je maksimalni razmak med stebrički 150 cm.',
    source: URL_MONTAZA,
    appliesTo: 'panelHeight>150',
  },
  {
    id: 'posts-lbracket-145',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 145,
    quote: 'Maksimalna razdalja med stebrički z L-kotniki je 145 cm.',
    source: URL_MONTAZA,
    appliesTo: 'lBracket',
  },
  {
    id: 'posts-horizontal-band',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 133,
    bandCm: [133, 140],
    quote: 'Stebrički za vodoravno postavitev desk morajo biti na maksimalni razdalji 133 – 140 cm.',
    source: URL_MONTAZA,
    appliesTo: 'orientation=horizontal',
  },
  {
    id: 'posts-cross-band',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 133,
    bandCm: [133, 145],
    quote: 'Za prečno postavitev je maksimalen razmak med stebri 133–145 cm.',
    source: URL_OGRAJE,
    appliesTo: 'orientation=cross',
  },
  {
    id: 'posts-vertical-200',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 200,
    quote: 'Za pokončno postavitev je maksimalen razmak 200 cm.',
    source: URL_OGRAJE,
    appliesTo: 'orientation=vertical',
  },
  {
    id: 'posts-polna128-110',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'posts',
    limitCm: 110,
    quote: 'Polne deske širine 12,8 cm, dolžine 2,2 m. Stebrički za vodoravno postavitev desk ' +
      'morajo biti na maksimalni razdalji 110 cm.',
    source: URL_MONTAZA,
    appliesTo: 'profile=polna-128',
  },
  {
    // ADJACENT: citat govori o NOSILCIH (letvah), ne o stebričkih. NIKOLI ne sme
    // postati meja stebričkov — je pa opomba, ki jo monter sme videti.
    id: 'posts-via-bearers-100',
    kind: 'limit',
    basis: 'ADJACENT',
    context: 'posts',
    limitCm: 100,
    quote: 'Največja dovoljena razdalja med nosilci je 100 cm.',
    source: URL_MONTAZA,
  },
  {
    // ADJACENT za KUBO: 120 cm je razpon med HORIZONTALNIMI cevmi (navpični razmik
    // v polnilu), ne razmik med stebrički. Sega sem pomeni, da je neka številka
    // na voljo, a NI za to, kar monter trenutno vnaša.
    id: 'posts-via-kubo-rails-120',
    kind: 'limit',
    basis: 'ADJACENT',
    context: 'posts',
    limitCm: 120,
    quote: 'Maksimalni razpon med horizontalnimi cevmi brez dodatkov je 120 cm.',
    source: URL_MONTAZA,
    appliesTo: 'profile=kubo-80-42',
  },
  {
    id: 'posts-extra-over-180',
    kind: 'consequence',
    basis: 'DIRECT',
    context: 'posts',
    firesAtSpacingCm: 180,
    advice: 'Pri razmiku 180 cm ali več ROKSAL zahteva še en dodaten stebriček.',
    quote: 'Če je razmak enak ali večji od 180 cm je potrebno dodati še en stebriček.',
    source: URL_MONTAZA,
  },
  {
    id: 'bearers-100',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'bearers',
    limitCm: 100,
    quote: 'Največja dovoljena razdalja med nosilci je 100 cm.',
    source: URL_MONTAZA,
  },
  {
    id: 'kubo-rails-120',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'kubo-rails',
    limitCm: 120,
    quote: 'Maksimalni razpon med horizontalnimi cevmi brez dodatkov je 120 cm.',
    source: URL_MONTAZA,
    appliesTo: ['profile=kubo-80-42', 'kuboNoInsert'],
  },
  {
    id: 'kubo-rails-260-alu',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'kubo-rails',
    limitCm: 260,
    quote: 'Če je razpon konstrukcije večji od 120 cm se v KUBO letvico vstavi alu cev 20 × 60 × 2 mm, ' +
      'potem je dovoljeni razpon med horizontalnimi nosilci do 260 cm.',
    source: URL_MONTAZA,
    appliesTo: ['profile=kubo-80-42', 'kuboAluInsert'],
  },
  {
    id: 'handle-screws-50',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'handle-screws',
    limitCm: 50,
    quote: 'Ročaj se vijači v razmaku 50 cm skozi ročaj v nosilno cev.',
    source: URL_MONTAZA,
  },
  {
    id: 'battens-80',
    kind: 'limit',
    basis: 'DIRECT',
    context: 'battens',
    limitCm: 70,
    bandCm: [70, 80],
    quote: 'Prvič se privijači podložna letev debeline 4 cm, širine 6 cm v razmakih 70 – 80 cm.',
    source: URL_MONTAZA,
  },
];

export interface MaxSpanInput {
  context?: SpanContext;
  /** višina polnila/ograje v cm; izpuščena = monter je ni vnesel */
  panelHeightCm?: number | null;
  profile?: RoksalProfileKind | null;
  /** deske ležijo vodoravno (133–140), prečno (133–145) ali pokončno (200) */
  orientation?: 'horizontal' | 'cross' | 'vertical' | null;
  /** pritrditev z L-kotniki (145 cm) */
  lBracket?: boolean;
  /** KUBO: v letvico je vstavljena alu cev 20 × 60 × 2 (sicer velja 120 cm) */
  kuboAluInsert?: boolean;
}

export interface MaxSpanVerdict {
  context: SpanContext;
  /** meja, ki jo sme monter uporabiti; 0 kadar utemeljene meje ni */
  maxSpanCm: number;
  /** pravilo, ki je odločilo; `null` kadar ni nobenega */
  binding: SpanLimitRule | null;
  /** vsa veljavna NEPOSREDNA mejna pravila, od najstrožjega naprej */
  applicable: SpanLimitRule[];
  /** veljavna posledična pravila — monter jih vidi, meja iz njih NE postane */
  consequences: SpanConsequenceRule[];
  /** citati o drugem elementu, ki so na voljo a NISO uporabljene meje */
  analogies: SpanLimitRule[];
  /** kje se citata razhajata — modul tega NE reši z izborom, ampak javi */
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
    case 'profile=polna-128':
      return input.profile === 'polna-128';
    case 'profile=kubo-80-42':
      return input.profile === 'kubo-80-42';
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

/**
 * Največji dovoljeni razmak za podani kontekst, po objavljenih pravilih.
 * Odloči NAJSTROŽJE neposredno pravilo; analogije so samo opomba.
 */
export function maxAllowedSpan(input: MaxSpanInput): MaxSpanVerdict {
  const context = input.context ?? 'posts';
  const matched = SPAN_RULES.filter((r) => r.context === context && ruleApplies(r, input));

  const limits = matched.filter((r): r is SpanLimitRule => r.kind === 'limit');
  const consequences = matched.filter((r): r is SpanConsequenceRule => r.kind === 'consequence');
  const applicable = limits.filter((r) => r.basis === 'DIRECT').sort((a, b) => a.limitCm - b.limitCm);
  const analogies = limits.filter((r) => r.basis === 'ADJACENT').sort((a, b) => a.limitCm - b.limitCm);
  const binding = applicable[0] ?? null;

  if (!binding) {
    return {
      context,
      maxSpanCm: 0,
      binding: null,
      applicable: [],
      consequences,
      analogies,
      conflicts: [],
      notes: ['ROKSAL za ta kontekst ne objavlja omejitve razmika — številka ne bi bila utemeljena.'],
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
      `Citat ${a.limitCm} cm govori o drugem elementu kot o stebričkih (»${a.quote.slice(0, 44)}…“) — ni uporabljen kot meja.`,
    );
  }
  // Razhajanje citatov: 150 »ne glede na višino« proti 180 »do 150 cm višine«.
  const ids = new Set(applicable.map((r) => r.id));
  if (ids.has('posts-abs-150') && ids.has('posts-180-low')) {
    conflicts.push(
      'Navodili se v isti strani razhajata: 150 cm „ne glede na višino ograje“ proti 180 cm „pri ograjah do ' +
        '150 cm višine«. Vzeta je NIŽJA meja; za 180 cm mora potrditi dobavitelj.',
    );
  }
  // Orientacija: če monterjeva izbira dopušča več, mora vedeti, da je omejuje drug citat.
  const ORIENT_MAX: Record<'horizontal' | 'cross' | 'vertical', number> =
    { horizontal: 140, cross: 145, vertical: 200 };
  if (context === 'posts') {
    if (input.orientation) {
      const byOrient = ORIENT_MAX[input.orientation];
      if (byOrient > binding.limitCm) {
        notes.push(
          `Orientacija „${input.orientation}“ bi po svojem citatu dovolila do ${byOrient} cm, a drugo objavljeno ` +
            `pravilo je strožje (${binding.limitCm} cm) — velja strožje.`,
        );
      }
    } else {
      notes.push('Orientacija desk ni izbrana — pas 133–140 / 133–145 ali 200 cm zato ne more biti ovrednoten.');
    }
    if (typeof input.panelHeightCm !== 'number') {
      notes.push('Višina polnila ni vnesena — pravili, vezani na višino (180 cm do 150 cm višine), niso mogla biti ovrednotena.');
    }
  }
  if (context === 'kubo-rails' && input.kuboAluInsert !== true) {
    notes.push('Brez vstavljene alu cevi 20 × 60 × 2 mm velja 120 cm; do 260 cm sme samo z vstavkom.');
  }

  return {
    context,
    maxSpanCm: binding.limitCm,
    binding,
    applicable,
    consequences,
    analogies,
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
): { ok: boolean | null; verdict: MaxSpanVerdict; fires: SpanConsequenceRule[] } {
  const verdict = maxAllowedSpan(input);
  if (verdict.assurance === 'UNKNOWN' || !Number.isFinite(spacingCm)) {
    return { ok: null, verdict, fires: [] };
  }
  const fires = verdict.consequences.filter((r) => spacingCm >= r.firesAtSpacingCm);
  return { ok: spacingCm <= verdict.maxSpanCm, verdict, fires };
}

/**
 * Ena sama stavčna nasvet za v UI. `null` = ni utemeljene številke in UI ne
 * sme pokazati meje (enako kot drugje: brez vira nobena trditev).
 */
export function spanAdvice(input: MaxSpanInput): string | null {
  const v = maxAllowedSpan(input);
  if (!v.binding) return null;
  const b = v.binding;
  const why = b.bandCm ? `objavljeno kot pas ${b.bandCm[0]}–${b.bandCm[1]} cm` : `vir: ${b.source}`;
  return `Največ ${b.limitCm} cm (${why}).`;
}
