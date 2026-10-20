// ─── URADNI CENIK ROKSAL 2026 (roksal.com) ──────────────────────────────────
// VIR: »CENIK WPC OGRAJE IN PREGRADNE STENE 2026« (Kranj, veljaven
// 1. 01. 2026) in »CENIK WPC TERASE 2026« — objavljena na roksal.com
// (strani »Cenik wpc ograje SI / terase / fasade«).
//
// ZAKAJ TO JE UPORABNO: register je do sedaj imel prazna polja `catalogSku`
// (»čaka original ROKSAL katalog«) in v aplikaciji ni bilo mogoče navesti
// dejanske cene. Zdaj imamo URADNE kode in cene — zato:
//
//  1. profilom lahko pripišemo resnično ROKSAL kodo (DT…, DP…, DK…, RPK…);
//  2. montažni list lahko pokaže »uradni cenik« kot ORIENTACIJO (cene se
//     spreminjajo — zato je ob vsaki ceni zapisan datum veljavnosti);
//  3. montažna pravila (razmaki, odmik vijaka) so zdaj napisana DOBESEDNO.
//
// ISKRENO: cene so od 1. 01. 2026 in jih aplikacija NE vpisuje sama v
// ponudbo — ponudba ostaja brez cene, dokler je ne vnese obrtnik. Tu so kot
// referenca.

export interface CenikItem {
  /** uradna ROKSAL koda */
  code: string;
  /** naziv po ceniku */
  name: string;
  /** mere po ceniku */
  dims: string;
  /** enota (kom, m1 …) */
  unit: string;
  /** cena brez DDV (EUR) */
  net: number;
  /** cena z DDV (EUR) */
  gross: number;
  /** družina profila (za iskanje v registru) */
  family: string;
  /** površina/varianta (KLASIK ali RUSTIC) */
  surface: 'KLASIK' | 'RUSTIC' | '—';
}

/** Datum veljavnosti cenika (iz glave cenika). */
export const CENIK_DATE = '1. 01. 2026';

export const CENIK_SOURCE = {
  fences: 'roksal.com → Cenik WPC ograje in pregradne stene 2026 (Kranj, 1. 01. 2026)',
  terraces: 'roksal.com → Cenik WPC terase 2026 (Kranj, 1. 01. 2026)',
  url: 'https://roksal.com/woodcore-wpc-deske/',
} as const;

/** Izdelki iz uradnega cenika ograj in pregradnih sten (prebrano 19. 10. 2026). */
export const CENIK_2026: CenikItem[] = [
  { code: 'DT400K', name: 'deska 150 (terasa) 150x25x4000 mm', dims: '150x25x4000', unit: 'kom', net: 30.95, gross: 37.76, family: 'terasna-150', surface: 'KLASIK' },
  { code: 'DT220K', name: 'deska 150 (terasa) 150x25x2200 mm', dims: '150x25x2200', unit: 'kom', net: 17.02, gross: 20.77, family: 'terasna-150', surface: 'KLASIK' },
  { code: 'DT400R', name: 'deska 150 (terasa) 150x25x4000 mm', dims: '150x25x4000', unit: 'kom', net: 41.01, gross: 50.03, family: 'terasna-150', surface: 'RUSTIC' },
  { code: 'DT220R', name: 'deska 150 (terasa) 150x25x2200 mm', dims: '150x25x2200', unit: 'kom', net: 22.56, gross: 27.52, family: 'terasna-150', surface: 'RUSTIC' },
  { code: 'DTC', name: 'čep za desko 150 mm', dims: '—', unit: 'kom', net: 2.7, gross: 3.29, family: 'terasna-150', surface: '—' },
  { code: 'DR580K', name: 'romb deska z alu cevjo 67x26x5800 mm', dims: '67x26x5800', unit: 'kom', net: 44.61, gross: 54.42, family: 'romb-67', surface: 'KLASIK' },
  { code: 'DR580R', name: 'romb deska z alu cevjo 67x26x5800 mm', dims: '67x26x5800', unit: 'kom', net: 47.9, gross: 57.71, family: 'romb-67', surface: 'RUSTIC' },
  { code: 'DRC', name: 'čep z vijakom M8x20 mm za romb desko', dims: '—', unit: 'kom', net: 3.34, gross: 4.08, family: 'romb-67', surface: '—' },
  { code: 'DRL', name: 'letvica za romb 27x12x1000 mm', dims: '27x12x1000', unit: 'm1', net: 8.82, gross: 10.76, family: 'romb-67', surface: '—' },
  { code: 'DP128K', name: 'polna deska 128 128x16x2200 mm', dims: '128x16x2200', unit: 'kom', net: 19.65, gross: 23.97, family: 'polna-128', surface: 'KLASIK' },
  { code: 'DP128R', name: 'polna deska 128 128x16x2200 mm', dims: '128x16x2200', unit: 'kom', net: 21.62, gross: 26.37, family: 'polna-128', surface: 'RUSTIC' },
  { code: 'DP100K', name: 'polna deska 100 100x12x5800 mm', dims: '100x12x5800', unit: 'kom', net: 27.28, gross: 33.29, family: 'polna-100', surface: 'KLASIK' },
  { code: 'DP100R', name: 'polna deska 100 100x12x5800 mm', dims: '100x12x5800', unit: 'kom', net: 29.75, gross: 36.3, family: 'polna-100', surface: 'RUSTIC' },
  { code: 'REZR', name: 'razrez desk ravno', dims: '—', unit: 'kom', net: 0.65, gross: 0.8, family: '—', surface: '—' },
  { code: 'REZK', name: 'razrez desk po dolžini', dims: '—', unit: 'kom', net: 1.62, gross: 1.98, family: '—', surface: '—' },
  { code: 'REZZ', name: 'zaobljenje desk', dims: '—', unit: 'kom', net: 2.29, gross: 2.79, family: '—', surface: '—' },
  { code: 'DP57/32K', name: 'polna deska 57/32 57x32x5800 mm', dims: '57x32x5800', unit: 'kom', net: 38.22, gross: 46.83, family: 'polna-57-32', surface: 'KLASIK' },
  { code: 'DK20', name: 'profil kubo 80x42x5800 mm, alu cev 20x20 mm, širina 4,2 cm', dims: '80x42x5800', unit: 'kom', net: 49.48, gross: 60.37, family: 'kubo-80-42', surface: '—' },
  { code: 'DK25', name: 'profil kubo 80x42x5800 mm, alu cev 25x25 mm, širina 8 cm', dims: '80x42x5800', unit: 'kom', net: 51.24, gross: 62.51, family: 'kubo-80-42', surface: '—' },
  { code: 'DK60', name: 'profil kubo 80x42x5800 mm, alu cev 20x60 mm', dims: '80x42x5800', unit: 'kom', net: 65.19, gross: 79.53, family: 'kubo-80-42', surface: '—' },
  { code: 'RPK', name: 'ročaj 95x45x5800 mm', dims: '95x45x5800', unit: 'kom', net: 56.24, gross: 68.61, family: 'rocaj', surface: 'KLASIK' },
  { code: 'RPR', name: 'ročaj 95x45x5800 mm', dims: '95x45x5800', unit: 'kom', net: 61.06, gross: 74.5, family: 'rocaj', surface: 'RUSTIC' },
  { code: 'RC', name: 'čep za ročaj', dims: '—', unit: 'kom', net: 2.67, gross: 3.25, family: 'rocaj', surface: '—' },
];

/** Uradna montažna pravila (dobesedno iz cenika / strani »Načini pritrjevanja«). */
export const CENIK_RULES: { text: string; source: string }[] = [
  {
    text:
      'Profili za vertikalno postavitev: 128mm, 100mm, 80/42mm in 57/32mm. ' +
      'Vodoravni razmak med stebrički je zaviralno nastavljen na 145cm (odvisno od višine ograje in izbire profila). ' +
      'Razmak med horizontalnimi cevmi je od 80-120cm. Odmik pritrditve vijaka od roba reza deske min. 2,5cm in maks. 12cm.',
    source: CENIK_SOURCE.fences,
  },
  {
    text:
      'Profili za horizontalno postavitev: 128mm, 67mm in 150mm. ' +
      'Stebrički za horizontalno postavitev desk morajo biti na maksimalni razdalji od 100 do 145cm.',
    source: CENIK_SOURCE.fences,
  },
  {
    text:
      'Izvrtine v deskah naj bodo zaradi raztezanja materiala za 0,5–1mm večje od premera vijaka. ' +
      'Odmik od roba reza deske min. 3cm. Lepiti ni dovoljeno.',
    source: CENIK_SOURCE.fences,
  },
];

/** Vsi izdelki dane družine (z variantami površine). */
export function cenikFor(family: string): CenikItem[] {
  return CENIK_2026.filter((i) => i.family === family);
}

/** Kode izdelkov družine (npr. ['DP100K', 'DP100R']). */
export function cenikCodes(family: string): string[] {
  return cenikFor(family).map((i) => i.code);
}

/** Najdi izdelek po kodi. */
export function cenikByCode(code: string): CenikItem | null {
  return CENIK_2026.find((i) => i.code === code) ?? null;
}

