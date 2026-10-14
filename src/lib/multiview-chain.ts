// ─────────────────────────────────────────────────────────────────────────────
// multiview-chain.ts — VERIŽENJE PAROV FOTK (> 2 fotki) s prenosom merila
// prek skupnih točk (Task 42, Faza 3 nadgradnja — inkrementalni SfM v najbolj
// preprosti, popolnoma deterministični obliki; 0 AI, 0 novih odvisnosti).
//
// Ideja (potrjena z raziskavo: incremental SfM — inicializacija iz para →
// dodajanje pogledov; Umeyama 1991 za podobnostno transformacijo):
//   1. Osnovni par A–B meri s klasičnim potekom (measureFromPair) — merilo v cm
//      po znani referenčni dolžini.
//   2. Dodatni par B–C se trijangulira v LASTNEM okviru (enote |t|).
//   3. Skupne točke (ista fizična točka trijangulirana v OBEH parih, ključ =
//      kornerski indeks na fotki B) prenesejo merilo:
//        – ≥ 2 skupni točki  → merilo = razmerje razdalj (cm / enota |t|),
//        – ≥ 3 nekolinearne  → Umeyamova podobnostna transformacija (s, R, t)
//          združi oblak B–C z oblakom A–B v enoten okvir kamere A → razdalje
//          TUDI MED TOČKAMI, ki jih noben posamezen par ne vidi skupaj
//          (npr. čez vogal prostora).
//   4. Iskrenost: vsak neuspeh je EKSPPLICITEN (code + opozorila v
//      slovenščini). Pri samo 2 skupnih točkah ALI kolinearnih točkah je način
//      'scale' — prečne razdalje (A↔C) se NE izračunajo. Neskladje meril ali
//      preveliki ostanki transformacije → NI rezultata (nikoli tiho).
// ─────────────────────────────────────────────────────────────────────────────

import {
  estimateFundamental,
  focalCandidatesFromF,
  lcg,
  projectionMatrix,
  relativePose,
  svd3,
  triangulateDLT,
  measureFromPair,
} from './multiview-core';
import type { PairMeasureResult } from './multiview-core';
import type { XY } from './photo-replace-core';

// ─── Konstante pogodbe (iskrenost) ───────────────────────────────────────────

/** Najmanjše število uporabnih skupnih točk za prenos MERILA. */
export const MIN_SHARED_FOR_SCALE = 2;
/** Najmanjše število uporabnih skupnih točk za POLNO podobnostno transformacijo. */
export const MIN_SHARED_FOR_FULL = 3;
/** Kolinearnost skupnih točk: d1/d0 < prag → rotacija okoli premice ni določena. */
export const COLLINEAR_D1_TOLERANCE = 0.05;
/** Neskladje Umeyamovega merila z neodvisno mediano razmerij — opozorilo / zavrnitev. */
export const SCALE_MISMATCH_WARN = 0.05;
export const SCALE_MISMATCH_FAIL = 0.15;
/** Razpon razmerij (max−min)/mediana pri kolinearni poti. */
export const RATIO_SPREAD_FAIL = 0.15;
/** Ostanek podobnostne transformacije relativno na razpon oblaka A–B. */
export const RESIDUAL_WARN_REL = 0.05;
export const RESIDUAL_FAIL_REL = 0.15;
/** Prag residuale za par B–C (skladno z measureFromPair). */
const MAX_RESIDUAL_PX = 3;
/** Največji dopustni odmik fokusa B–C od fokusa A–B (isti fotoaparat). */
const FOCAL_DRIFT_WARN = 0.2;
/** Deterministično seme RANSAC za par B–C. */
const BC_RANSAC_SEED = 4242;

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type ChainMode = 'full' | 'scale';

export type ChainCode =
  | 'OK'
  | 'AB_FAILED'
  | 'BC_FAILED'
  | 'SHARED_INSUFFICIENT'
  | 'COLLINEAR_SHARED'
  | 'SCALE_INCONSISTENT'
  | 'CHAIN_INCONSISTENT';

/** Poizvedba za razdaljo ZNOTRAJI enega para (indeksa v pts tistega para). */
export interface ChainQuery {
  pair: 'ab' | 'bc';
  ai: number;
  bi: number;
}

/** Prečna poizvedba: razdalja med točko iz para A–B in točko iz para B–C (samo 'full'). */
export interface ChainCrossQuery {
  abIdx: number;
  bcIdx: number;
}

export interface ChainMeasureInput {
  wA: number; hA: number; wB: number; hB: number; wC: number; hC: number;
  /** Par A–B: ptsA (fotka A) in ptsB (fotka B) — isti indeks = ista fizična točka. */
  ptsA: XY[];
  ptsB: XY[];
  /** Par B–C: ptsB2 (fotka B, NOVI kornerski prostor paira) in ptsC (fotka C). */
  ptsB2: XY[];
  ptsC: XY[];
  /** RANSAC seme za par A–B (isti klic kot pri samostojnem measureFromPair). */
  rand: () => number;
  focalMode: 'known' | 'preset' | 'selfcal';
  focalPx?: number | null;
  /** Referenčna dolžina v indeksnem prostoru para A–B. */
  reference: { ai: number; bi: number; cm: number };
  /**
   * Skupne točke: abIdx = indeks v ptsA/ptsB, bcIdx = indeks v ptsB2/ptsC —
   * ISTA fizična točka (ključ = kornerski indeks na fotki B). Gradi UI iz
   * baznih inlierjev obeh parov.
   */
  sharedTracks: { abIdx: number; bcIdx: number }[];
  queries?: ChainQuery[];
  crossQueries?: ChainCrossQuery[];
}

export interface ChainPoint3D {
  pair: 'ab' | 'bc';
  /** Indeks točke v svojem paru. */
  i: number;
  /**
   * 3D točka. Pri mode='full': enoten okvir KAMERE A, cm za vse točke.
   * Pri mode='scale': točke 'ab' v cm (okvir A), točke 'bc' pa v lastnem
   * okviru kamere B × merilo — prečne razdalje zato NISO smiselne.
   */
  X: [number, number, number];
  errPx: number;
}

export interface ChainSharedStats {
  /** Število podanih skupnih parov. */
  count: number;
  /** Število DEJANSKO uporabljenih (obe strani so se trijangulirali). */
  used: number;
  /** Neodvisna ocena merila: mediana razmerij razdalj (cm / enota |t|). */
  ratioMedian: number | null;
  /** Razpon razmerij (max−min)/mediana v %. */
  ratioSpreadPct: number | null;
  /** Umeyamovo merilo (samo mode='full'). */
  umeyamaScale: number | null;
  /** Največji ostanek transformacije na skupnih točkah v cm (samo 'full'). */
  residualMaxCm: number | null;
  /** Kolinearnost skupnih točk (d1/d0 kovariančne matrike; nizko = kolinearne). */
  d1Ratio: number | null;
}

export interface ChainMeasureResult {
  ok: boolean;
  mode: ChainMode | null;
  code: ChainCode;
  /** Polni rezultat osnovnega para A–B (vedno prisoten). */
  ab: PairMeasureResult;
  /** Diagnostika par B–C (okvir kamere B, enote |t|). */
  bc: {
    ok: boolean;
    F: number[] | null;
    inliers: number[];
    meanResidualPx: number | null;
    focalPx: number | null;
    focalSelfCal: boolean;
    warnings: string[];
  } | null;
  shared: ChainSharedStats | null;
  /** cm na enoto |t| para B–C. */
  scaleCmPerUnitBC: number | null;
  points3D: ChainPoint3D[] | null;
  distancesCm: { pair: 'ab' | 'bc' | 'cross'; i: number; j: number; cm: number }[] | null;
  warnings: string[];
}

// ─── Male pomožne funkcije ───────────────────────────────────────────────────

type V3 = [number, number, number];

function dist3(a: V3, b: V3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function det3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor((s.length - 1) / 2);
  return s.length % 2 === 1 ? s[mid] : 0.5 * (s[mid] + s[mid + 1]);
}

// ─── Umeyamova podobnostna transformacija (Umeyama 1991) ─────────────────────

export interface UmeyamaResult {
  /** Merilo (cm na enoto vira). */
  s: number;
  /** Rotacija 3×3 row-major (det = +1 — prava rotacija, brez zrcaljenja). */
  R: number[];
  /** Prevod. */
  t: V3;
  /** Kolinearnost: d1/d0 singularnih vrednosti kovariančne matrike. */
  d1Ratio: number;
  /** Največji ostanek |y − (sRx + t)| po enotah tarče. */
  residualMax: number;
}

/**
 * Umeyama (1991): najmanjšekvadratna podobnostna transformacija y ≈ s·R·x + t
 * (s > 0, R prava rotacija — odpravlja zrcaljenje klasičnega Kabsch postopka).
 * x = točke vira (par B–C, enote |t|), y = tarče (par A–B, cm).
 * Vrne null, če so točke degradirane (vse praktično iste, nekonečne vrednosti).
 * d1Ratio ≈ 0 pomeni kolinearne točke — rotacija okoli premice ni določena;
 * klicatelj to obravnava (samo merilo).
 */
export function umeyamaSimilarity(x: V3[], y: V3[]): UmeyamaResult | null {
  const n = x.length;
  if (n !== y.length || n < MIN_SHARED_FOR_FULL) return null;
  let mx = 0, my = 0, mz = 0, nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    if (!x[i].every(Number.isFinite) || !y[i].every(Number.isFinite)) return null;
    mx += x[i][0]; my += x[i][1]; mz += x[i][2];
    nx += y[i][0]; ny += y[i][1]; nz += y[i][2];
  }
  mx /= n; my /= n; mz /= n; nx /= n; ny /= n; nz /= n;
  // σx² (povprečna kvadratična razpršenost vira) in kovariančna matrika
  // H = (1/n)·Σ (y−ȳ)(x−x̄)ᵀ — SVD → U·Vᵀ = R (izpeljava: H = c·R_true·Σxx).
  let sigmaX2 = 0;
  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const dx0 = x[i][0] - mx, dx1 = x[i][1] - my, dx2 = x[i][2] - mz;
    const dy0 = y[i][0] - nx, dy1 = y[i][1] - ny, dy2 = y[i][2] - nz;
    sigmaX2 += dx0 * dx0 + dx1 * dx1 + dx2 * dx2;
    H[0] += dy0 * dx0; H[1] += dy0 * dx1; H[2] += dy0 * dx2;
    H[3] += dy1 * dx0; H[4] += dy1 * dx1; H[5] += dy1 * dx2;
    H[6] += dy2 * dx0; H[7] += dy2 * dx1; H[8] += dy2 * dx2;
  }
  sigmaX2 /= n;
  if (!(sigmaX2 > 1e-15)) return null; // vse točke vira praktično iste
  for (let k = 0; k < 9; k++) H[k] /= n;
  const sv = svd3(H);
  if (!sv) return null;
  if (!(sv.s[0] > 1e-12)) return null;
  // R0 = U·Vᵀ → predznak tretje smeri popravi det(R0) = +1
  const R0 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R0[i * 3 + j] = sv.U[0][i] * sv.V[0][j] + sv.U[1][i] * sv.V[1][j] + sv.U[2][i] * sv.V[2][j];
    }
  }
  const S3 = det3(R0) >= 0 ? 1 : -1;
  const s = (sv.s[0] + sv.s[1] + S3 * sv.s[2]) / sigmaX2;
  if (!(s > 0) || !Number.isFinite(s)) return null;
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i * 3 + j] = sv.U[0][i] * sv.V[0][j] + sv.U[1][i] * sv.V[1][j] + S3 * sv.U[2][i] * sv.V[2][j];
    }
  }
  const t: V3 = [nx, ny, nz];
  // t = ȳ − s·R·x̄
  const rx = [
    R[0] * mx + R[1] * my + R[2] * mz,
    R[3] * mx + R[4] * my + R[5] * mz,
    R[6] * mx + R[7] * my + R[8] * mz,
  ];
  t[0] -= s * rx[0]; t[1] -= s * rx[1]; t[2] -= s * rx[2];
  // ostanki + kolinearnost
  let residualMax = 0;
  for (let i = 0; i < n; i++) {
    const px = s * (R[0] * x[i][0] + R[1] * x[i][1] + R[2] * x[i][2]) + t[0];
    const py = s * (R[3] * x[i][0] + R[4] * x[i][1] + R[5] * x[i][2]) + t[1];
    const pz = s * (R[6] * x[i][0] + R[7] * x[i][1] + R[8] * x[i][2]) + t[2];
    const r = Math.hypot(y[i][0] - px, y[i][1] - py, y[i][2] - pz);
    if (r > residualMax) residualMax = r;
  }
  const d1Ratio = sv.s[1] / sv.s[0];
  return { s, R, t, d1Ratio, residualMax };
}

// ─── Glavni orkestrator verige ───────────────────────────────────────────────

function failBase(ab: PairMeasureResult, extra: string[]): ChainMeasureResult {
  return {
    ok: false, mode: null, code: 'AB_FAILED', ab,
    bc: null, shared: null, scaleCmPerUnitBC: null, points3D: null,
    distancesCm: null,
    warnings: [...ab.warnings, ...extra],
  };
}

/**
 * Veriženje parov: osnovni par A–B (merilo iz referenčne dolžine) → par B–C
 * (lasten okvir) → prenos merila prek skupnih točk (≥ 2) oz. polna
 * podobnostna transformacija (≥ 3 nekolinearne). Vse napake eksplicitne.
 */
export function measureFromChain(input: ChainMeasureInput): ChainMeasureResult {
  const warnings: string[] = [];
  const queries = input.queries ?? [];
  const crossQueries = input.crossQueries ?? [];

  // ── 1) Osnovni par A–B (isti potek kot samostojna meritev) ──
  const abQueries = queries.filter((q) => q.pair === 'ab').map((q) => ({ ai: q.ai, bi: q.bi }));
  const ab = measureFromPair({
    wA: input.wA, hA: input.hA, wB: input.wB, hB: input.hB,
    ptsA: input.ptsA, ptsB: input.ptsB,
    rand: input.rand,
    focalMode: input.focalMode,
    focalPx: input.focalPx ?? null,
    reference: input.reference,
    queries: abQueries,
  });
  if (!ab.ok || ab.scaleCmPerUnit === null || !ab.R || !ab.t || ab.focalPx === null) {
    return failBase(ab, ['Veriga ni izračunana — najprej mora osnovni par A–B uspeti (referenca + geometrija).']);
  }
  const abScale = ab.scaleCmPerUnit;
  // opozorila osnovnega para so del iskrenega poročila verige
  warnings.push(...ab.warnings);

  // ── 2) Par B–C: fundamentalna matrika, fokus, poza, triangulacija ──
  const bcWarnings: string[] = [];
  const bcEmpty = {
    ok: false, F: null as number[] | null, inliers: [] as number[],
    meanResidualPx: null as number | null, focalPx: null as number | null,
    focalSelfCal: false, warnings: bcWarnings,
  };
  if (input.ptsB2.length !== input.ptsC.length || input.ptsB2.length < 8) {
    return {
      ok: false, mode: null, code: 'BC_FAILED', ab, bc: bcEmpty,
      shared: null, scaleCmPerUnitBC: null, points3D: null, distancesCm: null,
      warnings: [...warnings, 'NEZADOSTNI PODATKI: premalo ujemajočih točk med fotkama B in C (< 8) — verige ni izračunana.'],
    };
  }
  const fr2 = estimateFundamental(input.wB, input.hB, input.wC, input.hC, input.ptsB2, input.ptsC, lcg(BC_RANSAC_SEED), {});
  if (!fr2) {
    return {
      ok: false, mode: null, code: 'BC_FAILED', ab, bc: bcEmpty,
      shared: null, scaleCmPerUnitBC: null, points3D: null, distancesCm: null,
      warnings: [...warnings, 'NEZADOSTNI PODATKI: geometrija par B–C je degenerirana — fundamentalna matrika ni izračunljiva.'],
    };
  }
  if (fr2.meanResidualPx > MAX_RESIDUAL_PX) {
    return {
      ok: false, mode: null, code: 'BC_FAILED', ab,
      bc: { ...bcEmpty, F: fr2.F, inliers: fr2.inliers, meanResidualPx: fr2.meanResidualPx },
      shared: null, scaleCmPerUnitBC: null, points3D: null, distancesCm: null,
      warnings: [...warnings, `NEZADOSTNI PODATKI: ujemanja med fotkama B in C so preveč raztresena (srednja residuala ${fr2.meanResidualPx.toFixed(1)} px > ${MAX_RESIDUAL_PX} px) — verige ni izračunana.`],
    };
  }
  // fokus B–C: ISTI fotoaparat (UI zahteva fiksni zoom) → fokus iz kalibriranega
  // para A–B se PRENESE na par B–C. Pri selfcal se kandidati B–C izračunajo samo
  // za presek: najbližji kandidat, ki je > 20 % od fokusa A–B → iskreno
  // opozorilo (drift/zoom), vendar se fokus A–B še vedno uporabi (boljša kalibra-
  // cija: več točk, močnejša geometrija).
  let focalBC: number | null = null;
  let focalBCSelf = false;
  if (input.focalMode === 'known' || input.focalMode === 'preset') {
    focalBC = ab.focalPx;
  } else {
    focalBC = ab.focalPx;
    focalBCSelf = true;
    const cands = focalCandidatesFromF(fr2.F, input.wB, input.hB);
    if (cands.length > 0) {
      const nearest = cands.reduce((best, f) => (Math.abs(f - ab.focalPx!) < Math.abs(best - ab.focalPx!) ? f : best), cands[0]);
      if (Math.abs(nearest - ab.focalPx!) / ab.focalPx! > FOCAL_DRIFT_WARN) {
        bcWarnings.push(`Presek fokusa: samokalibracija par B–C namigne ${nearest.toFixed(0)} px, uporabljen pa je fokus iz para A–B (${ab.focalPx!.toFixed(0)} px) — odmik > ${Math.round(FOCAL_DRIFT_WARN * 100)} % lahko pomeni spremenjen zoom med posnetki; mera je še bolj orientacijska.`);
      }
    }
  }
  const pose2 = relativePose(fr2.F, focalBC, focalBC, input.wB, input.hB, input.wC, input.hC, input.ptsB2, input.ptsC, fr2.inliers);
  if (!pose2) {
    return {
      ok: false, mode: null, code: 'BC_FAILED', ab,
      bc: { ...bcEmpty, F: fr2.F, inliers: fr2.inliers, meanResidualPx: fr2.meanResidualPx, focalPx: focalBC, focalSelfCal: focalBCSelf },
      shared: null, scaleCmPerUnitBC: null, points3D: null, distancesCm: null,
      warnings: [...warnings, 'NEZADOSTNI PODATKI: relativna poza med fotkama B in C ni določljiva — verige ni izračunana.'],
    };
  }
  // triangulacija: inlierji + skupne točke + konci poizvedb (unikatni indeksi)
  const wanted2 = new Set<number>(fr2.inliers);
  for (const st of input.sharedTracks) wanted2.add(st.bcIdx);
  for (const q of queries) {
    if (q.pair === 'bc') { wanted2.add(q.ai); wanted2.add(q.bi); }
  }
  const P1c = projectionMatrix(focalBC, input.wB, input.hB, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
  const P2c = projectionMatrix(focalBC, input.wC, input.hC, pose2.R, pose2.t);
  const bcByIndex = new Map<number, { X: V3; errPx: number }>();
  let bcFailedTri = 0;
  for (const i of [...wanted2].sort((a, b) => a - b)) {
    if (i < 0 || i >= input.ptsB2.length || i >= input.ptsC.length) continue;
    const tri = triangulateDLT(P1c, P2c, input.ptsB2[i], input.ptsC[i]);
    if (!tri) { bcFailedTri++; continue; }
    bcByIndex.set(i, { X: tri.X, errPx: tri.errPx });
  }
  if (bcFailedTri > 0) {
    bcWarnings.push(`NEZADOSTNI PODATKI: ${bcFailedTri} ${bcFailedTri === 1 ? 'točke par B–C ni bilo mogoče' : 'točk par B–C ni bilo mogoče'} trijangulirati (izpuščene).`);
  }
  if (focalBCSelf) {
    bcWarnings.push('Fokus za par B–C je prenešen iz samokalibriranega para A–B (isti fotoaparat, fiksni zoom) — mera je samo orientacijska.');
  }

  // ── 3) Skupne točke → prenos merila ──
  const sharedPairs: { P: V3; Q: V3; abIdx: number }[] = [];
  for (const st of input.sharedTracks) {
    const pa = ab.points3D?.find((p) => p.i === st.abIdx);
    const qc = bcByIndex.get(st.bcIdx);
    if (!pa || !qc) continue;
    sharedPairs.push({
      P: [pa.X[0] * abScale, pa.X[1] * abScale, pa.X[2] * abScale],
      Q: qc.X,
      abIdx: st.abIdx,
    });
  }
  const sharedStats: ChainSharedStats = {
    count: input.sharedTracks.length,
    used: sharedPairs.length,
    ratioMedian: null,
    ratioSpreadPct: null,
    umeyamaScale: null,
    residualMaxCm: null,
    d1Ratio: null,
  };
  const bcDiag = {
    ok: true, F: fr2.F, inliers: fr2.inliers, meanResidualPx: fr2.meanResidualPx,
    focalPx: focalBC, focalSelfCal: focalBCSelf, warnings: bcWarnings,
  };
  const failChain = (code: ChainCode, msgs: string[]): ChainMeasureResult => ({
    ok: false, mode: null, code, ab, bc: bcDiag,
    shared: sharedStats, scaleCmPerUnitBC: null, points3D: null, distancesCm: null,
    warnings: [...warnings, ...msgs],
  });

  if (sharedPairs.length < MIN_SHARED_FOR_SCALE) {
    return failChain('SHARED_INSUFFICIENT', [
      `NEZADOSTNI PODATKI: prenesti merilo je mogoče samo z vsaj ${MIN_SHARED_FOR_SCALE} skupnimi točkami (isti oglji vidni na vseh treh fotkah); uporabnih je ${sharedPairs.length} od ${input.sharedTracks.length} podanih. Posnemi fotki B in C z večjim prekrivanjem oz. označi več skupnih povezav.`,
    ]);
  }
  // neodvisna ocena merila: razmerja razdalj med vsemi pari skupnih točk
  const ratios: number[] = [];
  for (let i = 0; i < sharedPairs.length; i++) {
    for (let j = i + 1; j < sharedPairs.length; j++) {
      const dq = dist3(sharedPairs[i].Q, sharedPairs[j].Q);
      if (dq > 1e-9) ratios.push(dist3(sharedPairs[i].P, sharedPairs[j].P) / dq);
    }
  }
  const ratioMed = median(ratios);
  sharedStats.ratioMedian = ratioMed;
  if (ratioMed === null || !(ratioMed > 0)) {
    return failChain('SHARED_INSUFFICIENT', [
      'NEZADOSTNI PODATKI: skupne točke so v prostoru praktično iste točke — merila ni mogoče prenesti.',
    ]);
  }
  if (ratios.length > 1) {
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / ratioMed;
    sharedStats.ratioSpreadPct = spread * 100;
  }

  // ── 4) Polna transformacija (≥ 3 nekolinearne) ali samo merilo ──
  let mode: ChainMode = 'scale';
  let scaleBC = ratioMed;
  let transform: { R: number[]; t: V3; s: number } | null = null;

  if (sharedPairs.length >= MIN_SHARED_FOR_FULL) {
    const um = umeyamaSimilarity(
      sharedPairs.map((p) => p.Q),
      sharedPairs.map((p) => p.P),
    );
    if (um) {
      sharedStats.d1Ratio = um.d1Ratio;
      if (um.d1Ratio < COLLINEAR_D1_TOLERANCE) {
        warnings.push(`Skupne točke so skoraj kolinearne (razmerje ${um.d1Ratio.toFixed(3)} < ${COLLINEAR_D1_TOLERANCE}) — rotacija med okvirji ni zanesljiva, zato je prenešeno SAMO merilo. Prečne razdalje (A↔C) niso izračunane.`);
      } else {
        // skladje dveh NEODVISNIH ocen merila (Umeyama vs. mediana razmerij)
        const mismatch = Math.abs(um.s - ratioMed) / ratioMed;
        sharedStats.umeyamaScale = um.s;
        if (mismatch > SCALE_MISMATCH_FAIL) {
          return failChain('SCALE_INCONSISTENT', [
            `NEZADOSTNI PODATKI: dve neodvisni oceni merila se razlikujeta za ${(mismatch * 100).toFixed(1)} % (Umeyama ${um.s.toFixed(4)} vs. mediana razmerij ${ratioMed.toFixed(4)}) — geometrija verige je neskladna. Preveri označbe povezav in posnemi nove fotke.`,
          ]);
        }
        if (mismatch > SCALE_MISMATCH_WARN) {
          warnings.push(`Opozorilo: oceni merila se razlikujeta za ${(mismatch * 100).toFixed(1)} % (Umeyama vs. mediana razmerij) — mera je manj zanesljiva.`);
        }
        // ostanek transformacije relativno na razpon oblaka A–B (cm)
        const abPts = (ab.points3D ?? []).map((p) => [p.X[0] * abScale, p.X[1] * abScale, p.X[2] * abScale] as V3);
        let extent = 0;
        for (let i = 0; i < abPts.length; i++) {
          for (let j = i + 1; j < abPts.length; j++) {
            const d = dist3(abPts[i], abPts[j]);
            if (d > extent) extent = d;
          }
        }
        const resMaxCm = um.residualMax;
        sharedStats.residualMaxCm = resMaxCm;
        if (extent > 1e-9) {
          const rel = resMaxCm / extent;
          if (rel > RESIDUAL_FAIL_REL) {
            return failChain('CHAIN_INCONSISTENT', [
              `NEZADOSTNI PODATKI: skupne točke se po transformaciji ne ujemajo (največji ostanek ${resMaxCm.toFixed(1)} cm = ${(rel * 100).toFixed(1)} % razpona oblaka) — veriga fotk je neskladna, mera NI izračunana.`,
            ]);
          }
          if (rel > RESIDUAL_WARN_REL) {
            warnings.push(`Opozorilo: ostanki transformacije na skupnih točkah so veliki (največ ${resMaxCm.toFixed(1)} cm = ${(rel * 100).toFixed(1)} % razpona) — točke B–C so manj zanesljive.`);
          }
        }
        mode = 'full';
        scaleBC = um.s;
        transform = { R: um.R, t: um.t, s: um.s };
      }
    } else {
      warnings.push('Podobnostna transformacija ni izračunljiva iz skupnih točk (degenerirana) — prenešeno je samo merilo.');
    }
  } else {
    warnings.push(`Samo ${sharedPairs.length} skupni točki — prenešeno je SAMO merilo (brez rotacije med okvirji). Za polno združitev oblakov in prečne razdalje (A↔C) so potrebne vsaj ${MIN_SHARED_FOR_FULL} nekolinearne skupne točke.`);
  }

  // ── 5) Združen oblak točk ──
  const points3D: ChainPoint3D[] = [];
  for (const p of ab.points3D ?? []) {
    points3D.push({ pair: 'ab', i: p.i, X: [p.X[0] * abScale, p.X[1] * abScale, p.X[2] * abScale], errPx: p.errPx });
  }
  const transformPoint = (Q: V3): V3 => {
    if (!transform) return [Q[0] * scaleBC, Q[1] * scaleBC, Q[2] * scaleBC];
    return [
      transform.s * (transform.R[0] * Q[0] + transform.R[1] * Q[1] + transform.R[2] * Q[2]) + transform.t[0],
      transform.s * (transform.R[3] * Q[0] + transform.R[4] * Q[1] + transform.R[5] * Q[2]) + transform.t[1],
      transform.s * (transform.R[6] * Q[0] + transform.R[7] * Q[1] + transform.R[8] * Q[2]) + transform.t[2],
    ];
  };
  const bcUnified = new Map<number, V3>();
  for (const [i, p] of bcByIndex) bcUnified.set(i, transformPoint(p.X));
  for (const [i, X] of [...bcUnified.entries()].sort((a, b) => a[0] - b[0])) {
    points3D.push({ pair: 'bc', i, X, errPx: bcByIndex.get(i)?.errPx ?? 0 });
  }

  // ── 6) Razdalje ──
  const distancesCm: { pair: 'ab' | 'bc' | 'cross'; i: number; j: number; cm: number }[] = [];
  for (const d of ab.distancesCm ?? []) distancesCm.push({ pair: 'ab', i: d.i, j: d.j, cm: d.cm });
  let missingBc = 0;
  for (const q of queries) {
    if (q.pair !== 'bc') continue;
    const pa = bcUnified.get(q.ai);
    const pb = bcUnified.get(q.bi);
    if (!pa || !pb) { missingBc++; continue; }
    distancesCm.push({ pair: 'bc', i: q.ai, j: q.bi, cm: Math.round(dist3(pa, pb) * 10) / 10 });
  }
  if (missingBc > 0) {
    warnings.push(`NEZADOSTNI PODATKI: ${missingBc} poizvedbeni ${missingBc === 1 ? 'par B–C je izpuščen' : 'parov B–C je izpuščenih'} (točk se ni trijanguliralo).`);
  }
  if (crossQueries.length > 0 && mode !== 'full') {
    warnings.push(`Prečne razdalje (med točkami para A–B in točkami para B–C) se pri načinu 'samo merilo' NE izračunajo — izpuščenih ${crossQueries.length}.`);
  } else {
    let missingCross = 0;
    for (const q of crossQueries) {
      const pa = (ab.points3D ?? []).find((p) => p.i === q.abIdx);
      const pb = bcUnified.get(q.bcIdx);
      if (!pa || !pb) { missingCross++; continue; }
      const PA: V3 = [pa.X[0] * abScale, pa.X[1] * abScale, pa.X[2] * abScale];
      distancesCm.push({ pair: 'cross', i: q.abIdx, j: q.bcIdx, cm: Math.round(dist3(PA, pb) * 10) / 10 });
    }
    if (missingCross > 0) {
      warnings.push(`NEZADOSTNI PODATKI: ${missingCross} prečnih ${missingCross === 1 ? 'poizvedba je izpuščena' : 'poizvedb je izpuščenih'} (točk se ni trijanguliralo).`);
    }
  }

  return {
    ok: true, mode, code: 'OK', ab, bc: bcDiag,
    shared: sharedStats, scaleCmPerUnitBC: scaleBC,
    points3D, distancesCm, warnings: [...warnings, ...bcWarnings],
  };
}
