// ─── URADNI KATALOG ROKSAL (roksal.com) ─────────────────────────────────
// Vse podatke so prebrani z uradnih strani 19. 10. 2026 in so DOBESEDNO
// citirani. Vir po družinah:
//   barve    → roksal.com/woodcore-wpc-deske/barvni-odtenki/
//   mere     → roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/
//              roksal.com/woodcore-wpc-deske/nacini-pritrjevanja/
//
// NAMEN: aplikacija sme ponujati NATANČNO tisto, kar ROKSAL proizvaja — ne
// več barv, ne manj, in z imeni, ki so objavljena.

export interface CatalogueFamily {
  /** ime družine, kot ga uporablja aplikacija */
  id: string;
  /** družina v registru profilov (lahko se razlikuje od id) */
  registryFamily: string;
  /** Ali so te barve ponujene kot LASTNI profili v registru. Fasadni profili
   *  (ROMB / POLNA-100 za fasado) uporabljajo barve obstoječih družin, zato
   *  se ne štejejo posebej. */
  offeredAsProfiles?: boolean;
  /** uradno ime profila (ROKSAL) */
  officialName: string;
  /** širina deske v cm */
  boardWidthCm: number;
  /** debelina deske v cm (0, če ni objavljena) */
  boardThicknessCm: number | null;
  /** standardna dolžina deske v m (null, če ni objavljena) */
  boardLengthM: number | null;
  /** koliko barv ROKSAL trenutno ponuja */
  colours: number;
  /** dobesedni citat o številu barv */
  coloursQuote: string;
  /** površine (terasna profil: rebrasta / gladka / Rustic) */
  surfaces: string[];
  surfacesQuote?: string;
  source: string;
}

const SRC_COLOUR = 'roksal.com/woodcore-wpc-deske/barvni-odtenki/';
const SRC_VERTICAL = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/';

/** URADNI katalog po družinah (številke so objavljene na roksal.com). */
export const ROKSAL_CATALOGUE: Record<string, CatalogueFamily> = {
  'polna-100': {
    id: 'polna-100',
    registryFamily: 'polna-100',
    officialName: 'POLNA DESKA-100',
    boardWidthCm: 10,
    boardThicknessCm: 1.2,
    boardLengthM: 5.8,
    colours: 8,
    coloursQuote: 'Pri deskah s polnim profilom lahko izbirate med spodnjimi osmimi barvami:',
    surfaces: [],
    source: `${SRC_COLOUR} · ${SRC_VERTICAL}`,
  },
  'polna-128': {
    id: 'polna-128',
    registryFamily: 'polna-128',
    officialName: 'POLNA DESKA-128',
    boardWidthCm: 12.8,
    boardThicknessCm: 1.6,
    boardLengthM: 2.2,
    colours: 5,
    coloursQuote: 'Ta profil se lahko uporabi pri prečni ali pokončni ograji. Izbirate lahko med spodnjimi petimi barvami:',
    surfaces: [],
    source: `${SRC_COLOUR} · ${SRC_VERTICAL}`,
  },
  'polna-57-32': {
    id: 'polna-57-32',
    registryFamily: 'polna-57-32',
    officialName: 'POLNA DESKA-57/32',
    boardWidthCm: 5.7,
    boardThicknessCm: 3.2,
    boardLengthM: 5.8,
    colours: 3,
    coloursQuote: 'Te deske so primerne samo za pokončne ograje . Trenutno so na voljo tri barve:',
    surfaces: [],
    source: `${SRC_COLOUR} · ${SRC_VERTICAL}`,
  },
  'romb-67': {
    id: 'romb-67',
    registryFamily: 'romb-67',
    officialName: 'ROMB DESKA-67',
    boardWidthCm: 6.7,
    boardThicknessCm: 2.6,
    boardLengthM: 5.8,
    colours: 7,
    coloursQuote: 'Pri deskah s profilom ROMB lahko izbirate med spodnjimi sedmimi barvami:',
    surfaces: [],
    source: `${SRC_COLOUR} · ${SRC_VERTICAL}`,
  },
  'kubo-80-42': {
    id: 'kubo-80-42',
    registryFamily: 'kubo-80-42',
    officialName: 'KUBO (pregradna stena / fasada)',
    boardWidthCm: 8,
    boardThicknessCm: 4.2,
    boardLengthM: 5,
    colours: 4,
    coloursQuote: 'Pri deskah s profilom KUBO lahko izbirate med spodnjimi štirimi barvami:',
    surfaces: [],
    source: `${SRC_COLOUR}`,
  },
  'fasada-romb': {
    id: 'fasada-romb',
    registryFamily: 'fasadna-obloga-8',
    offeredAsProfiles: false,
    officialName: 'ROMB (fasada) — profil 6,7 cm z alu cevjo',
    boardWidthCm: 6.7,
    boardThicknessCm: 2.6,
    boardLengthM: null,
    colours: 7,
    coloursQuote: 'Pri deskah s profilom ROMB lahko izbirate med spodnjimi sedmimi barvami:',
    surfaces: [],
    surfacesQuote:
      'Za fasado se naredi najprej izolacija, na njo se privijači podložna letev debeline 4 cm, širine 6 cm iz macesna v razmakih 70 – 80 cm. ' +
      'Na njo se pritrdi romb debeline 2,6 cm + debelina pritrdilnega sistema je 0,5 cm. Skupna debelina na izolaciji je 7,1 cm.',
    source: `${SRC_COLOUR} · roksal.com/woodcore-wpc-deske/wpc-deske-za-fasado/`,
  },
  'fasada-polna-100': {
    id: 'fasada-polna-100',
    registryFamily: 'polna-100',
    offeredAsProfiles: false,
    officialName: 'POLNA DESKA-100 (fasada) — horizontalno ali vertikalno',
    boardWidthCm: 10,
    boardThicknessCm: 1.2,
    boardLengthM: 5.8,
    colours: 8,
    coloursQuote: 'Pri deskah s polnim profilom lahko izbirate med spodnjimi osmimi barvami:',
    surfaces: [],
    surfacesQuote:
      'Polne deske se lahko montirajo horizontalno ali vertikalno na pripravljeno izolacijo … ' +
      'Na izolacijo se v razmakih 70–80 cm pritrdijo macesnove letve dimenzije 4 × 7 cm … ' +
      'Pri vertikalni postavitvi desk se dodatno montira še horizontalne letve 2 × 7 cm v razmaku do 50cm.',
    source: `${SRC_COLOUR} · roksal.com/woodcore-wpc-deske/wpc-deske-za-fasado/`,
  },
  'terasna-150': {
    id: 'terasna-150',
    registryFamily: 'roksal-deka-150',
    officialName: 'TERASNI profil (WPC deka 150)',
    boardWidthCm: 15,
    boardThicknessCm: null,
    boardLengthM: null,
    colours: 7,
    coloursQuote: 'Deske za teraso in ograjo - TERASNI profil: Izbirate lahko med sedmimi barvnimi odtenki in tremi površinami.',
    surfaces: ['rebra bolj na gosto', 'rebra bolj na široko', 'Rustic (popolnoma gladko na eni strani)'],
    surfacesQuote:
      'Deske imajo na eni strani rebra bolj na gosto, na drugi pa na široko. Le Rustic deske so na eni strani popolnoma gladke, na drugi strani pa gosto rebričene.',
    source: `${SRC_COLOUR}`,
  },
};

/** Večbarvni odtenki (Rustic) — pri njih se odtenek med deskami opazno razlikuje. */
export const RUSTIC_NOTE =
  'Pri odtenkih Rustic Oak in Rustic Walnut, ki imata večbarvni videz, lahko odtenek in razpored lis med deskami in serijami opazneje variirata.';

/**
 * Barva posamezne deske se lahko med serijami razlikuje — zato odstopanje
 * tona po deski v renderju. Vir: OPOMBA POD URADNIMI BARVNIMI LESTVICAMI
 * (BARVNA_LESTVICA_*.png) in stran »Barvni odtenki«.
 */
export const COLOUR_BATCH_NOTE =
  'Zaradi dodajanja naravnega materiala s proizvodnim procesom barvanja, lahko barvni odtenki desk med posameznimi dobavami malenkost variirajo.';

/** Dodatna izjava s strani »Barvni odtenki«. */
export const COLOUR_BATCH_NOTE_PAGE =
  'Barva posamezne deske lahko med serijami variira in se lahko razlikuje od vzorca.';

/** Katalog za družino ali null. */
export function catalogueFor(id: string): CatalogueFamily | null {
  const base = id.replace(/-dekor-\d+$/, '');
  return ROKSAL_CATALOGUE[base] ?? null;
}

/**
 * PRAVI ROKSALOVI REFERENČNI OBJEKTI (roksal.com/de/referenz-wpc-dielen/,
 * prebrano 19. 10. 2026). Uporabni iz dveh razlogov:
 *  1. potrjujejo, da so imena odtenkov res URADNA (uporabljena v lastnih
 *     referencah podjetja);
 *  2. obrtniku pokažejo, kaj je ROKSAL v istem odtenku ŽE postavil — to je
 *     najmočnejši argument pri stranki.
 */
export interface RoksalReference {
  /** objekt (javno dostopen) */
  place: string;
  /** kaj je bilo narejeno */
  what: string;
  /** uradni odtenek */
  colour: string;
  /** leto postavitve */
  year: string;
}

export const ROKSAL_REFERENCES: RoksalReference[] = [
  { place: 'Pizzeria Olivia, Trzin', what: 'terasa', colour: 'Rustic Walnut', year: '2026' },
  { place: 'Zen Smaragd, Most na Soči', what: 'terasa', colour: 'Rustic Oak', year: '2026' },
  { place: 'Feuerwehr Britof', what: 'zaščitna ograja (polna deska)', colour: 'Amazon Wood', year: '2026' },
  { place: 'Čevabdžinica Erniša, Fokovci', what: 'terasa (gladka stran navzgor)', colour: 'Rustic Walnut', year: '2025' },
  { place: 'Chalet Zana, Bled', what: 'terasa', colour: 'Ash Wood', year: '2025' },
  { place: 'Promenada Burger, Bled', what: 'terasa', colour: 'Burma Teak', year: '2025' },
  { place: 'Orhideja Caffe, Kamnik', what: 'vertikalna ograja 10 cm', colour: 'Ash Wood', year: '2025' },
  { place: 'Butik, Murska Sobota', what: 'fasada', colour: 'Rustic Oak', year: '2024' },
  { place: 'Vrtec St. Marien, Cerklje', what: 'terasa in vertikalna ograja', colour: 'Burma Teak', year: '2024' },
  { place: 'Café in Bar Panorama, Kranj', what: 'terasa', colour: 'Ash Wood', year: '2023' },
  { place: 'Kofi bar, Kranj', what: 'terasa, stopnica, romb profil 67', colour: 'Burma Teak', year: '2023' },
  { place: 'Občina Trbovlje', what: 'vertikalna ograja, polni profil 100', colour: 'Burma Teak', year: '2022' },
  { place: 'Intersport BTC, Ljubljana', what: 'vertikalna fasada, romb profil 67', colour: 'Oak Wood', year: '2022' },
  { place: 'Železnina Kljukca, Kranj', what: 'fasada in vertikalna ograja', colour: 'Oak Wood', year: '2019' },
  { place: 'Bunny Bar, Ljubljana', what: 'romb profil 67, klopi', colour: 'Burma Teak', year: '2015/2020' },
  { place: 'Roksal, Zgornje Bitnje 186 (sedež)', what: 'terasa', colour: 'Golden Teak', year: '2006' },
];

/** Vsa uradna imena odtenkov, ki se pojavljajo v ROKSALOVIH referencah. */
export const REFERENCE_COLOURS: string[] = [...new Set(ROKSAL_REFERENCES.map((r) => r.colour))];
