// ─── MERILNA KONTROLA: ali je vnesena širina plauzilna? ───────────────────
// Vpeljava: obrtnik vnese širino ograje v cm. Aplikacija lahko širino
// PREVERI SAMOSTOJNO — iz strukture ograje v isti fotografiji. Če sta
// koraka med deskami znana (izmerjena iz fotografije) in je razmak stebrov
// enak, lahko širino ocenimo brez metra:
//
//   cm/piksel = širina_profila / korak_px
//   ocena širine = širina ravnine v pikslih × cm/piksel
//
// Če se ocena in vnos ujemata (npr. ±3 %), je vnos verjetno prav — to je
// PRAVILEN način, kako se merilna napaka loči od programske. Če se ne ujemata,
// je lahko napaka v vnosu ALI pa je v ograji drug profil (druga širina deske)
// — zato se sporočilo ne izreka, ampak POKAZE obe števili in razliko.
//
// ISKRENO: detektor koraka deluje zanesljivo le, kjer so deske v ravnini
// vodoravno ali navpično in so dovolj velike; sicer vrne null in preverjanje
// se preskoči (UI pove, da preverjanja ni bilo).

import { findBoard } from './board-detect';

export interface StructureDetection {
  /** izmerjen korak med deskami v pikslih */
  pitchPx: number | null;
  /** koliko različnih pasov je dalo isti korak (stabilnost) */
  stableBands: number;
  /** število desk čez ravnino (zaokroženo) */
  boardsAcross: number | null;
}

export interface MeasureCheck {
  /** vnesena širina (cm) */
  enteredWidthCm: number | null;
  /** neodvisna ocena širine iz strukture (cm) */
  derivedWidthCm: number | null;
  /** odstopanje v % (pozitivno = ocena večja od vnosa) */
  diffPct: number | null;
  /** 'se ujema' | 'odstopanje' | 'ni mogoče preveriti' */
  verdict: 'se ujema' | 'odstopanje' | 'ni mogoče preveriti';
  /** besedilo za UI in za list */
  message: string;
  /** zanesljivost preverjanja 0–100 */
  confidence: number;
}

/** Najdi korak med deskami znotraj ravnine (več pasov, vzamemo najbolj stabilnega). */
export function detectPlaneStructure(args: {
  rgba: Uint8Array;
  W: number;
  H: number;
  quadPct: [number, number][];
}): StructureDetection {
  const { rgba, W, H, quadPct } = args;
  const empty: StructureDetection = { pitchPx: null, stableBands: 0, boardsAcross: null };
  if (quadPct.length !== 4) return empty;
  const xs = quadPct.map(([x]) => x);
  const ys = quadPct.map(([, y]) => y);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) / 100) * W));
  const x1 = Math.min(W, Math.ceil((Math.max(...xs) / 100) * W));
  const y0 = Math.max(0, Math.floor((Math.min(...ys) / 100) * H));
  const y1 = Math.min(H, Math.ceil((Math.max(...ys) / 100) * H));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 16 || ch < 16) return empty;

  const counts = new Map<number, number>();
  for (let band = 0.05; band <= 0.9; band += 0.05) {
    const by0 = y0 + Math.round(ch * band * 0.6);
    const by1 = Math.min(y1, by0 + Math.round(ch * 0.12));
    if (by1 - by0 < 12) continue;
    const prof: number[] = [];
    for (let x = x0; x < x1; x++) {
      let s = 0;
      let c = 0;
      for (let y = by0; y < by1; y++) {
        const i = (y * W + x) * 4;
        s += (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
        c++;
      }
      prof.push(s / c);
    }
    const b = findBoard(prof, { minPitch: 5, maxPitch: Math.max(24, Math.round(cw / 2)) });
    if (b) counts.set(b.pitch, (counts.get(b.pitch) ?? 0) + 1);
  }
  if (counts.size === 0) return empty;
  let bestPitch = 0;
  let bestN = 0;
  for (const [pitch, n] of counts) {
    if (n > bestN || (n === bestN && pitch > bestPitch)) { bestN = n; bestPitch = pitch; }
  }
  if (bestPitch <= 0) return empty;
  return { pitchPx: bestPitch, stableBands: bestN, boardsAcross: null };
}

/**
 * Informativni opis strukture ograje v fotografiji (NE preverjanje vnosa).
 *
 * Zakaj ni preverjanja: razporeditev desk po pravilu spoj-na-stebru pušča
 * ostanek do konca celote, zato število desk v fotografiji sistematično
 * odstopa od širine ravnine (na primer 28 desk zapolni 334 cm od 350 cm).
 * Zato je število desk INFORMACIJA, ne merilo za vnos — preverljivo merilo
 * ostaja negotova širina z modelom napake.
 */
export function describeStructure(args: {
  boardsDetected: number | null;
  plankCm: number;
  gapCm: number;
}): string {
  const n = args.boardsDetected;
  if (!n || n < 2) return '';
  const step = args.plankCm + args.gapCm;
  return (
    `V fotografiji je približno ${n} ${n === 1 ? 'deska' : n === 2 ? 'deski' : 'desk'} ` +
    `(${step.toFixed(1)} cm korak) — informativno: razporeditev pušča ostanek, zato število ni merilo za širino.`
  );
}

/** Zanesljivost merila: koliko je širina lahko dvotna? */
export interface Uncertainty {
  /** ocena napake v cm */
  plusMinusCm: number;
  /** v odstotku širine */
  plusMinusPct: number;
  /** razlog (za UI in list) */
  reason: string;
}

/**
 * Negotova merska napaka je vnesena širina (zaokrožena na cm) in v *označevanju
 * oglišč* (pritisni polmer ≈ 5 px na dotik). Zato je negotova širina
 *
 *   ±(5 px / širina ravnine v px) × širina  ±  0,5 cm
 *
 * To je MODEL, ne izmerjena vrednost — zato je v izpisu vedno označeno, kaj
 * je vključeno.
 */
export function measurementUncertainty(args: {
  widthCm: number | null;
  quadWidthPx: number | null;
  /** napaka klikništva v px (privzeto 5 px) */
  cornerErrorPx?: number;
}): Uncertainty {
  const corner = args.cornerErrorPx ?? 5;
  if (!args.widthCm || !args.quadWidthPx || args.quadWidthPx <= 0) {
    return { plusMinusCm: 0, plusMinusPct: 0, reason: 'Merilo ni določeno (ni širine ravnine).' };
  }
  const fromClicks = (corner / args.quadWidthPx) * args.widthCm;
  const plusMinusCm = fromClicks + 0.5;
  return {
    plusMinusCm: Math.round(plusMinusCm * 10) / 10,
    plusMinusPct: Math.round((plusMinusCm / args.widthCm) * 1000) / 10,
    reason: `±${Math.round(plusMinusCm * 10) / 10} cm (kliknišče ±${corner} px + zaokrožitev vnosa 0,5 cm)`,
  };
}

/**
 * Prešteje DESKE v ravnini: temne reže med deskami so lokalni minimumi na
 * posamezni VRSTI skozi ravnino (ne povprečje stolpcev — to bi reže raztopilo
 * v širini ravnine). Vzporedno se preveri enakomernost razporeditve.
 */
export function countBoardsInPlane(args: {
  rgba: Uint8Array;
  W: number;
  H: number;
  quadPct: [number, number][];
  /** najmanjša razlika med sosednjima režama v px */
  minSeparationPx?: number;
}): { boards: number | null; gaps: number; regular: boolean; pitchPx: number | null } {
  const { rgba, W, H, quadPct } = args;
  const minSep = args.minSeparationPx ?? 4;
  if (quadPct.length !== 4) return { boards: null, gaps: 0, regular: false, pitchPx: null };
  const xs = quadPct.map(([x]) => x);
  const ys = quadPct.map(([, y]) => y);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) / 100) * W));
  const x1 = Math.min(W, Math.ceil((Math.max(...xs) / 100) * W));
  const y0 = Math.max(0, Math.floor((Math.min(...ys) / 100) * H));
  const y1 = Math.min(H, Math.ceil((Math.max(...ys) / 100) * H));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 20 || ch < 12) return { boards: null, gaps: 0, regular: false, pitchPx: null };

  const rowGaps = (y: number): number[] => {
    const prof: number[] = [];
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      prof.push((rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3);
    }
    const n = prof.length;
    const sorted = [...prof].sort((a, b) => a - b);
    const med = sorted[Math.floor(n / 2)];
    const mins: number[] = [];
    for (let i = 1; i < n - 1; i++) {
      if (prof[i] < med - 4 && prof[i] <= prof[i - 1] && prof[i] < prof[i + 1]) mins.push(i);
    }
    const gaps: number[] = [];
    for (const m of mins) {
      if (gaps.length === 0 || m - (gaps[gaps.length - 1] as number) >= minSep) gaps.push(m);
    }
    return gaps;
  };

  // tri vrstice skozi sredino ravnine; vzamemo srednji rezultat
  const counts: number[] = [];
  for (const f of [0.4, 0.5, 0.6]) {
    const y = Math.round(y0 + ch * f);
    if (y < y0 || y >= y1) continue;
    const g = rowGaps(y);
    if (g.length >= 2) counts.push(g.length);
  }
  if (counts.length === 0) return { boards: null, gaps: 0, regular: false, pitchPx: null };
  counts.sort((a, b) => a - b);
  const gaps = counts[Math.floor(counts.length / 2)] as number;

  // enakomernost: primerjamo razporeditev rež na srednji vrstici
  const midY = Math.round(y0 + ch * 0.5);
  const g = rowGaps(midY);
  const diffs: number[] = [];
  for (let i = 1; i < g.length; i++) diffs.push((g[i] as number) - (g[i - 1] as number));
  diffs.sort((a, b) => a - b);
  const medPitch = diffs.length ? (diffs[Math.floor(diffs.length / 2)] as number) : 0;
  const spread = diffs.length > 1 ? (diffs[diffs.length - 1] as number) - (diffs[0] as number) : 0;
  const regular = medPitch > 0 && spread <= Math.max(3, medPitch * 0.6);
  return { boards: gaps + 1, gaps, regular, pitchPx: medPitch || null };
}
