// Ročno prebrani ground truth štirikotniki NAMESTITIH ROKSAL ploskev iz
// fotk monterja (Ograje Lozar). Oglisja v OdstOTKI slike, vrstni red
// ZL, ZD, SD, SL. vsak vnos ima opombo, kaj je na sliki — brez tega se
// ponovi napaka iz 2026-10-16, ko je bil GT narisano čez fasado namesto
// čez ograjo in so bili vsi izmerjeni odmiki brezpomenski.
//
// FOTKE SAME NISO V REPOZITORIJU: na njih so tuje hiše, vrtovi in napisi na hišah.
// Ali se smejo objaviti, se odloči lastnik fotk, ne koda. Zato ta datoteka
// nosi samo koordinate in opise, sonde v tests/gt/ pa pot do fotk vzamejo iz
// argumenta (glej tests/gt/README.md).
//
// `file` je zapisan z izvirnim prefiksom ('../fb-hi/…'), da se nizi ujemajo
// z izpisi v tests/gt/outputs/; harness vzame samo ime datoteke, regijo na
// fotki pa določa kvadrat sam (04.jpg in 04.jpg#zgoraj sta dva predmeta na
// ISTI fotki).
export type Quad = [number, number][];

export interface GtCase {
  file: string;
  what: string;
  quad: Quad;
  // Ali je ploskev obrnjena skoraj pravokotno v kamero (takrat je rob na
  // fotki res rob) ali pod kotom / v ozadju (takrat ga model lahko le ugane).
  frontal: boolean;
  // ALI JE SPLOH PRIMEREN za pristop "iz tapke najdi zgornji in spodnji rob".
  // false = fotka pogojev ne izpolnjuje in detektor mora NEČI (vrniti nič),
  // ne pa si izmisliti črte. Razlog je v `why`.
  inScope: boolean;
  why: string;
}

export const GT_CASES: GtCase[] = [
  {
    file: '../fb-hi/04.jpg',
    what: 'spodnja terasa: siva vodoravna lamelna ograja, dolg frontalen zamah',
    quad: [
      [17.5, 62.5],
      [82, 63],
      [82, 82],
      [17.5, 89.5],
    ],
    frontal: true,
    inScope: true,
    why: 'navpična ograja, oba tirnica v kadru',
  },
  {
    file: '../fb-hi/04.jpg#zgoraj',
    what: 'zgornji balkon: temno siva lamelna obloga, pod kotom',
    quad: [
      [16, 6.5],
      [78, 20],
      [78, 41.5],
      [16, 31],
    ],
    frontal: false,
    inScope: true,
    why: 'navpična obloga balkona, oba robova v kadru',
  },
  {
    file: '../fb-hi/16.jpg',
    what: 'delavnica: gotov panel vertikalnih lamel skoraj pravokotno v kamero',
    quad: [
      [6, 6],
      [95, 12],
      [93, 92],
      [4, 88],
    ],
    frontal: true,
    inScope: true,
    why: 'panel je cel v kadru, kontrastna svetla ozadja',
  },
  {
    file: '../fb-hi/15.jpg',
    what: 'delavnica: isti panel od strani, močna perspektiva',
    quad: [
      [11, 9],
      [84, 5],
      [86, 72],
      [15, 96],
    ],
    frontal: false,
    inScope: true,
    why: 'navpičen panel, oba robova v kadru',
  },
  {
    file: '../fb-hi/05.jpg',
    what: 'hiša: lesena lamelna fasdna obloga med dekorativnimi ploščami',
    quad: [
      [17, 12],
      [79, 15],
      [79, 52],
      [17, 52],
    ],
    frontal: false,
    inScope: true,
    why: 'navpična fasdna obloga, oba robova v kadru',
  },
  // ── Zgledi, kjer pristop NE SME trditi ničesar ───────────────────────────
  {
    file: '../fb-hi/06.jpg',
    what: 'ista fasada kot 05, a pod ostrejšim kotom; zgornji rob je odrezan',
    quad: [
      [21, 0],
      [88, 2],
      [88, 47],
      [21, 46],
    ],
    frontal: false,
    inScope: false,
    why: 'zgornja tirnica je ZUNAJ kadra — detektor je ne more najti in je ne sme izmisliti',
  },
  {
    file: '../fb-hi/14.jpg#rombi',
    what: 'podstrešna obloga "wpc rombi" (lastna oznaka monterja na fotki)',
    quad: [
      [13, 2],
      [99, 30],
      [63, 33],
      [0, 28],
    ],
    frontal: false,
    inScope: false,
    why: 'ležeča ploskev pod stropom: robovi NISO vodoravni črti, pas se ne definira',
  },
  {
    file: '../fb-hi/14.jpg#terasa',
    what: 'terasne deske "wpc terasa" (lastna oznaka monterja na fotki)',
    quad: [
      [30, 63],
      [99, 68],
      [72, 92],
      [10, 72],
    ],
    frontal: false,
    inScope: false,
    why: 'tla pod kotom: "zgornji rob" je črta, ki teče stran od kamere',
  },
  {
    file: '../fb-hi/22.jpg',
    what: 'terasa v gradnji: deska na podkonstrukciji, delno položena',
    quad: [
      [33, 55],
      [100, 47],
      [100, 95],
      [52, 95],
    ],
    frontal: false,
    inScope: false,
    why: 'tla + nedokončana ploskev brez zgornjega roba',
  },
  {
    file: '../fb-hi/20.jpg',
    what: 'drog: celotna soteska hiš, nameski produkt je pikuljen',
    quad: [
      [45, 44],
      [62, 44],
      [62, 54],
      [45, 54],
    ],
    frontal: false,
    inScope: false,
    why: 'ploskev zavzame ~1 % kadra — pod mejo katerekoli zanesljive meritve',
  },
];
