// ─── ROKSALova pravila razmikov (iz javnih navodil montaže) ────────────────
// ČISTO, brez domnev: vsako pravilo spodaj dobesedno citira eno od štirih
// objavljenih strani (prebrane 2026-10-16):
//   `roksal.com/woodcore-wpc-deske/montaza-wpc-deske/`
//   `roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/`
//   `roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/`
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
//
// POPRAVEK PROTI DRUGI VERZIJI (Task 82, 2026-10-16): ista vrsta napake je
// živela pri REŽI med deskami. Katalog je trdil „uradni FAQ obseg 0,2–3 cm“,
// take razsežnosti pa nobena stran ne objavlja. V resnici sta dve LOČENI
// trditvi pod ločenimi naslovi: pas 0,5–3 cm spada k ograji (naslov imenuje
// profil 100 IN 128), 2 mm pa je odgovor na vprašanje o FASADI. Iz teh dveh
// seštevana „0,2–3“ številka bi bila izmišljena. Zato modul pozna še tipe
// objav, ki številke NE dajo in je zato ne smejo ustvariti:
//  5. `typical` — objavljena OBČAJNA vrednost, brez zgornje ali spodnje meje.
//  6. `free` — ROKSAL izrecno objavi, da je razmik POLJUBEN.
//  7. `deferred` — ROKSAL številke ne objavi in napoti na navodila stroke.
//  8. `qualitative` — objavljena je samo posledica, brez številke.
//  9. `profiles` — OR množica: citat pod naslovom, ki imenuje dva profila,
//     velja za oba; posamezen `profile=` pogoj ga ne more izraziti, ker se
//     pogoji ANDajo.

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
  /**
   * OR množica profilov: citat pod naslovom, ki imenuje več profilov, velja za
   * katerega koli od njih. Posamezen `profile=` pogoj tega ne more izraziti,
   * ker se pogoji ANDajo. Če profil NI izrečen, takšno pravilo ostane vidno —
   * gre za nasvet, ne za mejo, pa bi sicer številka kar izginila.
   */
  profiles?: readonly RoksalProfileKind[];
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

/**
 * Objavljena OBIČAJNA vrednost brez meja (npr. fasadna reža 2 mm). Ni pas in ni
 * meja: monter vidi, kaj dobavitelj navaja kot običajno, aplikacija pa iz tega
 * NE sme narediti dovoljenega obsega.
 */
export interface SpanTypicalRule extends SpanRuleBase {
  kind: 'typical';
  typicalCm: number;
}

/** Izrecna objava, da je razmik POLJUBEN — številke ni in je ni treba iskati. */
export interface SpanFreeRule extends SpanRuleBase {
  kind: 'free';
}

/**
 * ROKSAL številke NE objavi in napoti drugam (»navodila stroke«). To ni
 * molkanje: je objavljena odločitev, da o številki odloča nekdo drug — UI to
 * pove, namesto da bi izpraznil prostor z ugibano mejo.
 */
export interface SpanDeferredRule extends SpanRuleBase {
  kind: 'deferred';
  advice: string;
}

/** Samo kakovostna posledica brez številke (npr. »večji razmak ⇒ viden klip«). */
export interface SpanQualitativeRule extends SpanRuleBase {
  kind: 'qualitative';
  advice: string;
}

export type SpanRule =
  | SpanLimitRule
  | SpanRangeRule
  | SpanConsequenceRule
  | SpanTypicalRule
  | SpanFreeRule
  | SpanDeferredRule
  | SpanQualitativeRule;

export const SPAN_RULE_KINDS = [
  'limit', 'range', 'consequence', 'typical', 'free', 'deferred', 'qualitative',
] as const;

const URL_MONTAZA = 'roksal.com/woodcore-wpc-deske/montaza-wpc-deske/';
const URL_OGRAJE = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/';
const URL_POKONCNA = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/';
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
  faqZvijanje: 'Ali se WPC deske pri ograji zvijajo?',
  /** ista trditev na PODABNI strani izdelka (naslov brez besede „pokončne“) */
  polna100128Produkt: 'Montaža ograje - profil POLNA DESKA-100 in POLNA DESKA-128',
  /**
   * V FAQ so pod enim naslovom odgovori na VEČ vprašanj, vzorčenih enako
   * („Polna deska 100: …“, „Romb: …“, „Kubo: …“) — brez samega vprašanja ni
   * vedeti, ali številka spada k razmaku morali ali k reži. Zato ta oznaka
   * nosi naslov in vprašanje skupaj.
   */
  faqFasadeReza: 'FASADE (pogosta vprašanja) — „Pri pokončni fasadi bi imel večji razmak kot imate prikazano. Kako to dosežem?“',
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
    // Naslov imenuje DVA profila, zato `profiles` in ne `appliesTo`: sicer bi
    // 128 ostal brez objavljenega pasu, kljub temu da je številka zanj.
    id: 'ograja-polna100128-board-gap-range',
    kind: 'range',
    basis: 'DIRECT',
    context: 'board-gap',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna100128,
    rangeCm: [0.5, 3],
    profiles: ['polna-100', 'polna-128'],
    quote: 'Priporočen razmak med deskami je od 0,5cm do 3cm.',
    source: URL_MONTAZA,
    alsoSeenAt: URL_POKONCNA,
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
  // ── REŽA NA FASADI — tri LOČENE objave, nobena ni meja ─────────────────
  {
    // „običajno 2mm“ NI pas in NI meja: iz njiju ne sme nastati „0,2–3 cm“,
    // kar pa je katalog trdil (»uradni FAQ obseg«). Odgovor velja samo profilu,
    // ki ga imenuje, in samo fasadi.
    id: 'fasada-polna100-board-gap-typical-02',
    kind: 'typical',
    basis: 'DIRECT',
    context: 'board-gap',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasadeReza,
    typicalCm: 0.2,
    profiles: ['polna-100'],
    quote: 'Polna deska 100: razmak med deskami je običajno 2mm.',
    source: URL_FAQ,
  },
  {
    id: 'fasada-kubo-board-gap-free',
    kind: 'free',
    basis: 'DIRECT',
    context: 'board-gap',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasadeReza,
    profiles: ['kubo-80-42'],
    quote: 'Kubo: razmak med deskami poljuben, tudi profil obračate po želji.',
    source: URL_FAQ,
  },
  {
    // Številke ni — je pa objavljena posledica. UI jo pove in NE išče meje.
    id: 'fasada-romb-board-gap-clips',
    kind: 'qualitative',
    basis: 'DIRECT',
    context: 'board-gap',
    family: 'fasada',
    heading: SPAN_HEADINGS.faqFasadeReza,
    profiles: ['romb-67'],
    advice: 'ROKSAL za ROMB na fasadi ne objavlja številke: pri večjem razmaku je viden pritrdilni material (fasadni klipi).',
    quote: 'Romb: v primeru večjega razmaka viden pritrdilni material (fasadni klipi).',
    source: URL_FAQ,
  },
  // ── NOSILCI, KJER ROKSAL NAMERNO NE OBJAVLJA ŠTEVILKE ──────────────────
  {
    // Pod naslovom „POLNA DESKA-100 in POLNA DESKA-128“ je objavljena meja za
    // STEBRIČKE (180/150), za NOSILCE pa ne — stran napoti na navodila stroke.
    // To je razlog, zakaj katalog ne sme trditi „max razmak nosilcev 80 cm“.
    id: 'ograja-polna100128-bearers-deferred',
    kind: 'deferred',
    basis: 'DIRECT',
    context: 'bearers',
    family: 'ograja',
    heading: SPAN_HEADINGS.polna100128Produkt,
    profiles: ['polna-100', 'polna-128'],
    advice: 'Za profila 100 in 128 ROKSAL razmika nosilcev NE objavi — konstrukcijo mora preveriti po navodilih stroke.',
    quote: 'Pri izdelavi konstrukcije upoštevajte navodila stroke za nosilnost konstrukcije.',
    source: URL_POKONCNA,
  },
  {
    // Splošna trditev na strani za ograje: nosilci so predpisani PO PROFILIH,
    // stran samega razmika ne napiše. Navedena kot utemeljitev, zakaj je
    // odgovor lahko samo UNKNOWN.
    id: 'ograja-bearers-per-profile',
    kind: 'deferred',
    basis: 'ADJACENT',
    context: 'bearers',
    family: 'ograja',
    heading: SPAN_HEADINGS.faqZvijanje,
    advice: 'Vsak profil ima predpisano maksimalno razdaljo med nosilci; pri večjem razmaku deska nima dovolj opore in se lahko zvije.',
    quote: 'razmak med nosilci – vsak profil ima predpisane maksimalne razdalje med nosilci; ' +
      'pri večjem razmaku deska nima dovolj opore in se lahko zvije.',
    source: URL_OGRAJE,
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
  /** objavljena OBIČAJNA vrednost — številka brez pasu in brez meje */
  typicals: SpanTypicalRule[];
  /** objave, da je razmik poljuben — številke ni in je ni treba iskati */
  freeStatements: SpanFreeRule[];
  /** objave, ki številko namerno prepustijo drugim (navodila stroke) */
  deferrals: SpanDeferredRule[];
  /** objavljena je samo posledica, brez številke */
  qualitatives: SpanQualitativeRule[];
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
  // OR množica iz naslova, ki imenuje več profilov: izključi samo takrat, ko je
  // profil izrečen in ga v množici ni. Brez izrečenega profila nasvet ostane
  // viden — meje tu ni, zato ni kaj zažgati.
  if (rule.profiles && input.profile && !rule.profiles.includes(input.profile)) return false;
  return conditionsOf(rule).every((c) => conditionHolds(c, input));
}

/** Kateri profili so pod pravilom navedeni (appliesTo IN/OR `profiles`). */
function profilesOf(rule: SpanRule): RoksalProfileKind[] {
  const out: RoksalProfileKind[] = [];
  if (rule.profiles) out.push(...rule.profiles);
  for (const c of conditionsOf(rule)) {
    if (c.startsWith('profile=')) out.push(c.slice('profile='.length) as RoksalProfileKind);
  }
  return out;
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
 * Tabela mej po profilih za dano družino in kontekst — uporabi se, kadar
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
    const profiled = limits.filter((r) => profilesOf(r).includes(profile));
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
  const typicals = matched.filter((r): r is SpanTypicalRule => r.kind === 'typical');
  const freeStatements = matched.filter((r): r is SpanFreeRule => r.kind === 'free');
  const deferrals = matched.filter((r): r is SpanDeferredRule => r.kind === 'deferred');
  const qualitatives = matched.filter((r): r is SpanQualitativeRule => r.kind === 'qualitative');
  const applicable = limits.filter((r) => r.basis === 'DIRECT').sort((a, b) => a.limitCm - b.limitCm);
  const analogies = limits.filter((r) => r.basis === 'ADJACENT').sort((a, b) => a.limitCm - b.limitCm);
  const binding = applicable[0] ?? null;
  const rows = input.profile ? { rows: [] as ProfileLimitRow[], unresolved: [] } : profileRows(input);
  const profileFloorCm = rows.rows.length > 0 ? rows.rows[0].limitCm : null;
  /**
   * Katera koli objava BREZ številke (pas, običajna vrednost, „poljuben“,
   * napotitev, posledica) je odgovor: trditev „ROKSAL tega ne objavlja“ bi bila
   * napačna, če je stran o razmiku kaj rekla — samo ne v obliki meje.
   */
  const published = ranges.length + typicals.length + freeStatements.length +
    deferrals.filter((d) => d.basis === 'DIRECT').length + qualitatives.length;

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
    if (rows.rows.length === 0 && rows.unresolved.length === 0 && pending.length === 0 && published === 0) {
      notes.push(
        `ROKSAL za izdelek „${input.family}“ in kontekst „${context}“ ne objavlja omejitve razmika — številka ne bi bila utemeljena.`,
      );
    }
    for (const r of ranges) {
      notes.push(
        `Priporočen pas za „${context}“ je ${fmtCm(r.rangeCm[0])}–${fmtCm(r.rangeCm[1])} cm (${r.source}) — pas ne veže kot meja.`,
      );
    }
    // Objave brez številke (običajna vrednost, „poljuben“, posledica,
    // napotitev) povedo monterju, ZAKAJ številke ni — in da je ni treba ugibati.
    for (const r of typicals) {
      notes.push(
        `Za „${context}“ ROKSAL objavlja OBIČAJNO vrednost ${fmtCm(r.typicalCm)} cm (${r.source}) — to ni meja ` +
          `in ne pas: dovoljenega obsega iz nje ne delamo.`,
      );
    }
    for (const r of freeStatements) {
      notes.push(
        `ROKSAL za „${context}“ objavlja, da je razmik POLJUBEN (${r.source}) — številke ni treba iskati.`,
      );
    }
    for (const r of qualitatives) {
      notes.push(`Za „${context}“ številka ni objavljena, je pa posledica: ${r.advice}`);
    }
    for (const r of deferrals) {
      notes.push(
        r.basis === 'DIRECT'
          ? `ROKSAL za „${context}“ zavestno NE objavi številke in napoti na navodila stroke (${r.source}) — ` +
            `meje, ki bi bila utemeljena, tu ni.`
          : `Citat pravi, da ima vsak profil svojo mejo za „${context}“, a je ne poimenuje (${r.source}) — zato ni uporabljene meje.`,
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
      typicals,
      freeStatements,
      deferrals,
      qualitatives,
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
      `Priporočen pas za „${context}“ je ${fmtCm(r.rangeCm[0])}–${fmtCm(r.rangeCm[1])} cm (${r.source}) — pas ne veže kot meja.`,
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
    typicals,
    freeStatements,
    deferrals,
    qualitatives,
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

// ─── REŽA MED DESKAMI ───────────────────────────────────────────────────────
// Ločen izvod istih pravil, ker reža NIMA meje: edina poštena vprašanja sta
// „kaj je objavljeno“ in „za kateri izdelek“. Do danes je aplikacija imela samo
// `gapCm` kot PRIVZETEK in je v katalogu trdila „uradni obseg 0,2–3 cm“ —
// številko, ki je nobena stran ne objavlja (Task 82).

export type BoardGapState =
  /** ROKSAL za ta izdelek objavi pas ali OBIČAJNO vrednost */
  | 'SOURCED'
  /** ROKSAL izrecno objavi, da je razmik poljuben — številke ni treba iskati */
  | 'PUBLISHED_FREE'
  /** zanj ni objavljeno nič: UI sme reči samo to, ne sme pokazati številke */
  | 'UNKNOWN';

export interface BoardGapVerdict {
  family: RoksalFamily;
  profile: RoksalProfileKind | null;
  state: BoardGapState;
  /** objavljen pas (samo kadar ga je ROKSAL objavil kot pas) */
  bandCm: [number, number] | null;
  /** objavljena OBIČAJNA vrednost, kadar pasu ni */
  typicalCm: number | null;
  /** dobesedni citati, ki so odločili */
  quotes: string[];
  /** kje so objavljene — UI mora pokazati vsakega naštetega vira */
  sources: string[];
  /** kaj monitor vidi, kadar številke ni */
  notes: string[];
  /** ali je bil profil sploh izrečen (brez njega številka ne sme biti pokazana) */
  profileMissing: boolean;
}

/** Reža med deskami po objavljenih navodilih — brez izmišljenega obsega. */
export function boardGap(input: MaxSpanInput): BoardGapVerdict {
  const profile = input.profile ?? null;
  const matchedAll = SPAN_RULES.filter(
    (r) => r.context === 'board-gap' && r.family === input.family && ruleApplies(r, input),
  );
  // Brez izrečenega profila je NE SME biti pokazana številka, ki je objavljena
  // POD profilom — sicer bi kartica trdila splošnost, ki je ROKSAL ni napisal
  // (ista vrsta napake kot pri meji, Task 81).
  const matched = profile === null ? matchedAll.filter((r) => profilesOf(r).length === 0) : matchedAll;
  const direct = matched.filter((r) => r.basis === 'DIRECT');
  const notes: string[] = [];
  const quotes = matched.map((r) => r.quote);
  const sources = [...new Set(matched.flatMap((r) => [r.source, r.alsoSeenAt ?? ''].filter(Boolean)))];

  const ranges = direct.filter((r): r is SpanRangeRule => r.kind === 'range');
  const typicals = direct.filter((r): r is SpanTypicalRule => r.kind === 'typical');
  const frees = direct.filter((r): r is SpanFreeRule => r.kind === 'free');
  const quals = direct.filter((r): r is SpanQualitativeRule => r.kind === 'qualitative');

  for (const r of matched.filter((x) => x.basis === 'ADJACENT')) {
    notes.push(
      `Številka ${fmtRange(r)} se pojavlja samo v VPRAŠANJU, ne v odgovoru (${r.source}) — ne sme se uporabiti kot predpis.`,
    );
  }

  if (ranges.length > 0) {
    const r = ranges[0];
    if (ranges.length > 1) {
      notes.push(`Objavljena sta več pasov — prikazan je prvi (${fmtCm(r.rangeCm[0])}–${fmtCm(r.rangeCm[1])} cm).`);
    }
    return {
      family: input.family, profile, state: 'SOURCED',
      bandCm: r.rangeCm, typicalCm: null, quotes, sources,
      notes: [
        `ROKSAL priporoča razmik ${fmtCm(r.rangeCm[0])}–${fmtCm(r.rangeCm[1])} cm (${r.source}).`,
        ...notes,
      ],
      profileMissing: profile === null,
    };
  }
  if (typicals.length > 0) {
    const r = typicals[0];
    return {
      family: input.family, profile, state: 'SOURCED',
      bandCm: null, typicalCm: r.typicalCm, quotes, sources,
      notes: [
        `ROKSAL navaja OBIČAJNO razmik ${fmtCm(r.typicalCm)} cm (${r.source}) — objavljen je samo običaj, ` +
          `ne pa dovoljenega obsega, zato aplikacija iz njega meje ne dela.`,
        ...notes,
      ],
      profileMissing: profile === null,
    };
  }
  if (frees.length > 0) {
    return {
      family: input.family, profile, state: 'PUBLISHED_FREE',
      bandCm: null, typicalCm: null, quotes, sources,
      notes: [
        `ROKSAL objavlja, da je razmik poljuben (${frees[0].source}) — monter ga izbere sam.`,
        ...notes,
      ],
      profileMissing: profile === null,
    };
  }
  for (const r of quals) notes.push(`Številke ni, je pa objavljena posledica: ${r.advice}`);

  // Kje pa JE številka objavljena — da monter ve, da ne manjka podatek, ampak
  // ga za njegov profil preprosto ni.
  const elsewhere = SPAN_RULES.filter(
    (r) => r.context === 'board-gap' && r.family === input.family && r.basis === 'DIRECT' &&
      (r.kind === 'range' || r.kind === 'typical') && profilesOf(r).length > 0,
  );
  if (elsewhere.length > 0 && profile !== null) {
    const own = profileLabel(profile);
    const covers = [...new Set(elsewhere.flatMap((r) => profilesOf(r).map(profileLabel)))].filter(
      (label) => label !== own,
    );
    if (covers.length > 0) {
      notes.push(
        `Za „${profileLabel(profile)}“ reže ni objavljene; številka velja samo za ${covers.join(' / ')} — ` +
          `ne sme se prenesti.`,
      );
    }
  }
  if (profile === null) {
    notes.push('Profil ni izbran — reža je objavljena samo pod določenimi profili, zato je ni pokazati.');
  }
  return {
    family: input.family, profile, state: 'UNKNOWN',
    bandCm: null, typicalCm: null, quotes, sources,
    notes, profileMissing: profile === null,
  };
}

function fmtRange(rule: SpanRule): string {
  return rule.kind === 'range' ? `${fmtCm(rule.rangeCm[0])}–${fmtCm(rule.rangeCm[1])} cm`
    : rule.kind === 'typical' ? `${fmtCm(rule.typicalCm)} cm`
      : 'brez številke';
}

/** Slovenija piše decimalno vejico — številke iz Pravil gredo v uporabnikov tekst. */
export function formatSpanCm(cm: number): string {
  return String(cm).replace('.', ',');
}

/** @internal — kratko ime za notranjo rabo modula. */
const fmtCm = formatSpanCm;

// ── REŽA NA PRODUKTNI KARTICI ─────────────────────────────────────────────
// Kartica še ne ve, v katero družino bo monter desko vgradil, sme pa prikazati
// samo to, kar je zares objavljeno — zato ima vsaka številka reže na kartici
// žig: ali jo je objavil ROKSAL (in kje) ali je privzetek izračuna. (Task 82:
// katalog je brez žiga trdil „uradni FAQ obseg 0,2–3 cm“, česar ni nobena stran.)

/** Vse družine, ki jih Pravila poznajo. */
export const ROKSAL_FAMILIES: readonly RoksalFamily[] = [
  'ograja', 'terasa', 'fasada', 'pregrada', 'rocaj', 'korito',
];

const FAMILY_LOCATIVE: Record<RoksalFamily, string> = {
  ograja: 'na ograji', terasa: 'na terasi', fasada: 'na fasadi',
  pregrada: 'na pregradi', rocaj: 'na ročaju', korito: 'na koritu',
};

/**
 * Katalogski id → ROKSALov profil, na katerega se objave sklicujejo.
 * Različice »-dekor-N« delijo osnovni profil; id-ji, ki nimajo ROKSALovega
 * para (wpc-deka-140, alu-palice …), vrnejo null — zanje ni nič objavljenega.
 */
const CATALOG_BASE_PROFILE: Record<string, RoksalProfileKind> = {
  'polna-57-32': 'polna-57-32',
  'polna-100': 'polna-100',
  'polna-128': 'polna-128',
  'romb-67': 'romb-67',
  'kubo-80-42': 'kubo-80-42',
  'roksal-deka-150': 'terasna-150',
};

export function profileKindForCatalog(catalogId: string): RoksalProfileKind | null {
  const base = catalogId.replace(/-dekor-\d+$/, '');
  return CATALOG_BASE_PROFILE[base] ?? null;
}

export interface CatalogGapStamp {
  /** ali je številka kje objavljena (sicer je privzetek izračuna) */
  published: boolean;
  /** kratek žig za kartico; vir (URL) ostane v panelu razporeda */
  stamp: string;
}

/** Od kod je številka reže na produktni kartici. */
export function boardGapStamp(catalogId: string): CatalogGapStamp {
  const profile = profileKindForCatalog(catalogId);
  if (profile === null) return { published: false, stamp: 'privzetek izračuna' };
  const published = ROKSAL_FAMILIES.map((family) => boardGap({ family, profile }))
    .filter((v) => v.state !== 'UNKNOWN');
  const band = published.find((v) => v.bandCm !== null);
  if (band?.bandCm) {
    return {
      published: true,
      stamp: `ROKSAL objavlja ${fmtCm(band.bandCm[0])}–${fmtCm(band.bandCm[1])} cm ${FAMILY_LOCATIVE[band.family]}`,
    };
  }
  const typical = published.find((v) => v.typicalCm !== null);
  if (typical !== undefined && typical.typicalCm !== null) {
    return {
      published: true,
      stamp: `ROKSAL navaja običajno ${fmtCm(typical.typicalCm)} cm ${FAMILY_LOCATIVE[typical.family]}`,
    };
  }
  const free = published.find((v) => v.state === 'PUBLISHED_FREE');
  if (free) return { published: true, stamp: `ROKSAL: razmik poljuben ${FAMILY_LOCATIVE[free.family]}` };
  return { published: false, stamp: 'privzetek izračuna — ROKSAL je ne objavlja' };
}
