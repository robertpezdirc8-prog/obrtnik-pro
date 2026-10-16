// ─── Inkrementalni Structure-from-Motion iz 2–5 fotk (ROKSAL Faza 5) ──
// Klasični deterministični SfM, ki PONOVNO UPORABLJA obstoječe jedro
// multiview-core.ts (Shi-Tomasi, NCC ujemanje, 8-točkovni + RANSAC za F,
// Hartley/Kruppa samokalibracija fokusa, DLT triangulacija, relativna poza).
// Nobenega vzporednega jedra, 0 AI, 0 novih odvisnosti, 0 DOM.
//
// Algoritem ("alternacijski blok", namenoma BREZ gostobundle adjustmenta):
//  1. značilnosti po fotkah (findCorners + buildDescriptors, enako kot pri paru),
//  2. porne ujemaje za vse pare (matchFeatures + estimateFundamental, seed
//     lcg(42 + i*100 + j)),
//  3. začetni par = največ inlierjev (tie: najmanjši (i, j)),
//  4. fokus: known (povprečje) / preset / selfcal (obstoječi Hartley/Kruppa),
//  5. začetna rekonstrukcija: relativePose + DLT triangulacija inlierjev,
//  6. inkrementalna registracija: PnP-DLT + RANSAC (seed lcg(1000+i), 200 iteracij,
//     prag 2,5 px) + Gauss–Newton (Rodrigues), nato triangulacija NOVIH točk,
//  7. alternacija: poza (PnP-GN čez VSE opazavanja) ⇄ točke (GN na točko),
//     do 4 rondov, zgodnji izhod pri relativni izboljšavi < 1e-4.
//
// Iskrenost (ista pogodba kot preostali merilni modul): vsak primanjkljaj je
// EKSPPLICITNA napaka oz. opozorilo v slovenščini (NO_VALID_PAIR,
// INSUFFICIENT_OVERLAP, REPROJECTION_HIGH, NO_REFERENCE, DEGENERATE_GEOMETRY).
// Nič tihih privzetkov, nič izmišljenih števil. Vse funkcije so čiste in
// deterministične: enaki vhodi → bajtno identičen JSON izhod (LCG semena,
// fiksni vrstni red iteracij, fiksni tie-breaki, brez Date/Math.random).

import {
  buildDescriptors,
  estimateFundamental,
  findCorners,
  focalCandidatesFromF,
  jacobiEigen,
  lcg,
  matchFeatures,
  projectionMatrix,
  relativePose,
  triangulateDLT,
} from './multiview-core';
import type { Corner, MVMatch } from './multiview-core';
import type { XY } from './photo-replace-core';
import { validateSfm } from './measurement-status';
import type { ScaleValidation } from './measurement-status';

export const SFM_SCRIPT_VERSION = '1.0.0';

// ─── Javni tipi ───────────────────────────────────────────────

/** Vhodna fotka: siva slika (0..1) + znana goriščna razdalja (null = oceni). */
export interface SfmImageInput {
  name: string;
  /** Siva slika dolžine ≥ width*height (Float32Array iz UI; Float64Array = izhod toGrayscale). */
  gray: Float32Array | Float64Array;
  width: number;
  height: number;
  /** Goriščna razdalja v px (EXIF/preset/znana); null/izpuščeno = samokalibracija. */
  focalPx?: number | null;
}

/** Opazavanje točke (treka) na eni fotki (px). */
export interface SfmObservation {
  imgIdx: number;
  x: number;
  y: number;
}

/** Treka: povezana opazavanja iste fizične točke čez fotke. */
export interface SfmTrack {
  id: number;
  observations: SfmObservation[];
  /** 3D točka v enotah rekonstrukcije (|t začetnega para| = 1); null = ni trijangulirana. */
  point3: { x: number; y: number; z: number } | null;
  /** true = trijangulirana in srednja reprojekcijska residuala ≤ 3 px. */
  inlier: boolean;
}

/** Registrirana fotka: poza (R, t) v skupnem koordinatnem sistemu rekonstrukcije. */
export interface SfmRegistered {
  imgIdx: number;
  /** Rotacija world→camera (row-major 3×3). Prva registrirana fotka ima R = I. */
  R: number[];
  /** Translacija world→camera v enotah rekonstrukcije. */
  t: { x: number; y: number; z: number };
  /** Število opazavanj trek s 3D točko na tej fotki (podpora poze). */
  inliers: number;
  /** RMS reprojekcijske residuale te fotke (px). */
  reprojRmsPx: number;
}

/** Fotka, ki je NE uspela registrirati — z eksplicitnim slovenskim razlogom. */
export interface SfmUnregistered {
  imgIdx: number;
  reason: string;
}

/** Eksplicitne napake SfM (nikoli tihi padec). */
export type SfmErrorCode =
  | 'NO_VALID_PAIR'
  | 'INSUFFICIENT_OVERLAP'
  | 'REPROJECTION_HIGH'
  | 'NO_REFERENCE'
  | 'DEGENERATE_GEOMETRY';

/** Status — enaka oblika kot validateMultiView/validateSfm (pogodba merilnega lista). */
export type SfmStatus = ScaleValidation;

/** Uspešen izhod: registrirane + neuspele fotke, treke, fokus, merilo, status. */
export type SfmResult = {
  ok: true;
  registered: SfmRegistered[];
  unregistered: SfmUnregistered[];
  tracks: SfmTrack[];
  focalPx: number;
  focalSource: 'known' | 'preset' | 'selfcal';
  reprojRmsPx: number;
  /** cm na enoto rekonstrukcije; null, dokler ni znane referenčne dolžine. */
  scaleCmPerUnit: number | null;
  status: SfmStatus;
  warnings: string[];
} | {
  ok: false;
  error: SfmErrorCode;
  message: string;
};

export interface SfmOptions {
  /** Najmanj RANSAC inlierjev za porečni par fotk (privzeto 30). */
  minPairInliers?: number;
  /** Najmanjše razmerje inlierjev med ujemanji za porečni par (privzeto 0.5). */
  minPairInlierRatio?: number;
  /** Srednja epipolarna residuala porečnega para nad tem (px, privzeto 3) → opozorilo. */
  maxPairResidualPx?: number;
  /** Najmanj korespondenc z 3D točkami za registracijo fotke (privzeto 12). */
  minRegisterCorrespondences?: number;
  /** Največje število fotk (privzeto 5). */
  maxImages?: number;
}

/** Privzete pragi (izvožene za UI/teste — enake notranjim privzetcem runSfm). */
export const SFM_DEFAULTS = {
  /** Najmanj RANSAC inlierjev za začetni par (≥ 2.5× minimum 8-točkovnega). */
  minPairInliers: 30,
  /** Največja srednja Sampsonova residuala (px, čez VSE ujemanja) — samo
   *  OPOZORILO (iskren signal raztresenosti), ne trdi pogoj. */
  maxPairResidualPx: 3,
  /** Najmanjše razmerje inlierjev med ujemanji za začetni par. */
  minPairInlierRatio: 0.5,
  /** Najmanj korespondenc z 3D točkami za registracijo fotke. Nizak BOOTSTRAP
   *  prag (6 = minimum DLT poze): nova fotka vidi samo že-triangulirane treke,
   *  zato je pool ob uvodu majhen; končna kakovost ostane gate-ana v
   *  validateSfm (min 12 3D podpor na registrirano fotko, MIN_MULTIVIEW_INLIERS). */
  minRegisterCorrespondences: 6,
  maxImages: 5,
  /** Radij priklepa klika na opazavanje treka (px). */
  clickRadiusPx: 12,
  /** RANSAC prag pri PnP (px). */
  pnpThresholdPx: 2.5,
  /** Največja dovoljena reprojekcijska napaka pri trijangulaciji (px). */
  trackMaxErrPx: 3,
  /** Največ RANSAC iteracij pri PnP. */
  pnpIterations: 200,
  /** Največ rondov alternacije. */
  alternationRounds: 12,
} as const;

// ─── Notranje: majhne matrične operacije (row-major 3×3) ──────

function mulMat3(a: number[], b: number[]): number[] {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

function transposeMat3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function applyMat3(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function crossVec3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function detMat3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function frobMat3(m: number[]): number {
  let s = 0;
  for (let i = 0; i < 9; i++) s += m[i] * m[i];
  return Math.sqrt(s);
}

function allFinite(v: ArrayLike<number>): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ─── Rodrigues (os + kot ⇄ matrika) ───────────────────────────

/**
 * Rodriguesova formula: vektor osi-kota ω (kot = |ω|, os = ω/|ω|) → matrika
 * rotacije R (row-major 3×3). Deterministično; |ω| < 1e-8 → identiteta + [ω]×.
 *
 * R = I + sin θ·K̂ + (1 − cos θ)·K̂², kjer je K̂ = [û]× kižna matrika ENOTSKE
 * osi (K̂² = ûûᵀ − I). Diagonala: cos θ + (1 − cos θ)·û_i²; ne-diagonala:
 * sin θ·(−û_k) + (1 − cos θ)·û_i·û_j. (Prejšnja različica je MEŠALA enotsko
 * in ne-enotsko obliko formule → ne-ortogonalna "rotacija".)
 */
export function rodriguesMatrix(w: number[]): number[] {
  const theta = Math.hypot(w[0], w[1], w[2]);
  if (theta < 1e-8) {
    // prvi red: I + [ω]× (napaka O(θ²) < 1e-16 — zanemarljiva)
    return [
      1, -w[2], w[1],
      w[2], 1, -w[0],
      -w[1], w[0], 1,
    ];
  }
  const x = w[0] / theta, y = w[1] / theta, z = w[2] / theta;
  const s = Math.sin(theta);
  const kk = 1 - Math.cos(theta);
  return [
    1 - kk * (y * y + z * z), -s * z + kk * x * y, s * y + kk * x * z,
    s * z + kk * x * y, 1 - kk * (x * x + z * z), -s * x + kk * y * z,
    -s * y + kk * x * z, s * x + kk * y * z, 1 - kk * (x * x + y * y),
  ];
}

/**
 * Obrat Rodriguesove formule: rotacijska matrika R → vektor osi-kota ω
 * (kot = |ω| ∈ [0, π]). Varna tudi pri kotu blizu π (sin θ → 0).
 */
export function rodriguesAxis(R: number[]): number[] {
  const cosT = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2));
  const theta = Math.acos(cosT);
  const sinT = Math.sin(theta);
  if (theta < 1e-8) return [0, 0, 0];
  if (sinT < 1e-6) {
    // θ ≈ π: os iz diagonale (R + I)/2 — deterministična veja
    let ax = Math.sqrt(Math.max((R[0] + 1) / 2, 0));
    let ay = Math.sqrt(Math.max((R[4] + 1) / 2, 0));
    let az = Math.sqrt(Math.max((R[8] + 1) / 2, 0));
    // predznaki iz največje komponente (deterministično)
    if (ax >= ay && ax >= az) {
      if (R[1] < 0) ay = -ay;
      if (R[2] < 0) az = -az;
    } else if (ay >= ax && ay >= az) {
      if (R[1] < 0) ax = -ax;
      if (R[5] < 0) az = -az;
    } else {
      if (R[2] < 0) ax = -ax;
      if (R[5] < 0) ay = -ay;
    }
    return [theta * ax, theta * ay, theta * az];
  }
  // os iz antisimetričnega dela: [ω]× = (R − Rᵀ)/(2·sin θ)·θ... ω = θ/(2 sin θ)·(R32−R23, R13−R31, R21−R12)
  const s = theta / (2 * sinT);
  return [
    s * (R[7] - R[5]),
    s * (R[2] - R[6]),
    s * (R[3] - R[1]),
  ];
}

/** Kot med dvema rotacijama v stopinjah (trace-based; za testne izpise in UI). */
export function rotationAngleDeg(Ra: number[], Rb: number[]): number {
  const d = mulMat3(Rb, transposeMat3(Ra));
  const w = rodriguesAxis(d);
  return (Math.hypot(w[0], w[1], w[2]) * 180) / Math.PI;
}

// ─── Notranje: projekcija in K ────────────────────────────────

/** Notranja kalibracija (glavna točka v središču — enako kot projectionMatrix v jedru). */
interface KParams { f: number; cx: number; cy: number }

function projectCam(R: number[], t: [number, number, number], K: KParams, X: [number, number, number]): { x: number; y: number; z: number } | null {
  const Xc = applyMat3(R, X);
  const z = Xc[2] + t[2];
  if (Math.abs(z) < 1e-12) return null;
  return {
    x: (K.f * (Xc[0] + t[0])) / z + K.cx,
    y: (K.f * (Xc[1] + t[1])) / z + K.cy,
    z,
  };
}

function projectP(P: number[], X: [number, number, number]): { x: number; y: number } | null {
  const d = P[8] * X[0] + P[9] * X[1] + P[10] * X[2] + P[11];
  if (Math.abs(d) < 1e-12) return null;
  return {
    x: (P[0] * X[0] + P[1] * X[1] + P[2] * X[2] + P[3]) / d,
    y: (P[4] * X[0] + P[5] * X[1] + P[6] * X[2] + P[7]) / d,
  };
}

// ─── Notranje: DLT rešitev poze (PnP) ─────────────────────────

/** Korespondenca 2D(px) ↔ 3D(enote rekonstrukcije) za PnP. */
export interface PoseCorrespondence {
  x: number;
  y: number;
  X: [number, number, number];
}

/**
 * Hartleyjeva normalizacija 3D oblaka: težišče v izhodišče, povprečna razdalja √3.
 * Vrne null pri degeneriranem oblaku (vse točke praktično identične).
 */
function normalizeCloud3D(pts: [number, number, number][]): { c: [number, number, number]; s: number; norm: [number, number, number][] } | null {
  const n = pts.length;
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= n; cy /= n; cz /= n;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
  d /= n;
  if (!(d > 1e-12)) return null;
  const s = Math.sqrt(3) / d;
  const norm = pts.map((p) => [(p[0] - cx) * s, (p[1] - cy) * s, (p[2] - cz) * s] as [number, number, number]);
  return { c: [cx, cy, cz], s, norm };
}

/**
 * Linearna DLT rešitev poze iz 2D–3D korespondenc (PnP): 2D točki normaliziramo
 * z K⁻¹, 3D oblak Hartleyjevo; vsak par da 2 vrstici nad 12 neznankami P̂ = [R|t];
 * rešitev = lastni vektor najmanjše lastne vrednosti M = AᵀA (12×12, Jacobijev
 * razcep iz jedra). Skala se rekonstruira iz pogoja, da je R ortonormalen
 * (λ = |Rpart|_F/√3 · sign(det)); R se ortogonalizira z Gram–Schmidtom.
 * Vrne (R, t) v enotah 3D oblaka. Null pri degeneriranih vhodih oz. cheirality.
 */
export function solvePoseDLT(
  corrs: PoseCorrespondence[],
  K: KParams,
): { R: number[]; t: [number, number, number] } | null {
  if (corrs.length < 6) return null;
  const cloud = normalizeCloud3D(corrs.map((c) => c.X));
  if (!cloud) return null;
  const { c, s, norm } = cloud;
  // M = Σ vrsticᵀ·vrstica (12×12, simetrična)
  const M: number[][] = [];
  for (let i = 0; i < 12; i++) M.push(new Array<number>(12).fill(0));
  for (let k = 0; k < corrs.length; k++) {
    const xu = (corrs[k].x - K.cx) / K.f;
    const yu = (corrs[k].y - K.cy) / K.f;
    const X = norm[k];
    const rows = [
      [X[0], X[1], X[2], 1, 0, 0, 0, 0, -xu * X[0], -xu * X[1], -xu * X[2], -xu],
      [0, 0, 0, 0, X[0], X[1], X[2], 1, -yu * X[0], -yu * X[1], -yu * X[2], -yu],
    ];
    for (const r of rows) {
      for (let i = 0; i < 12; i++) {
        if (r[i] === 0) continue;
        for (let j = 0; j < 12; j++) M[i][j] += r[i] * r[j];
      }
    }
  }
  const eg = jacobiEigen(M);
  if (eg.vectors.length === 0) return null;
  let minI = 0;
  for (let i = 1; i < 12; i++) if (eg.values[i] < eg.values[minI]) minI = i;
  const p = new Array<number>(12);
  for (let i = 0; i < 12; i++) p[i] = eg.vectors[i][minI];
  if (!allFinite(p)) return null;
  // P̂ (3×4, row-major) v normaliziranih koordinatah
  const Phat = p.slice();
  // de-normalizacija: x̂ = P̂·X̂ = P̂·(s·X − s·c) → P = [s·P̂(0..2) | P̂(3) − s·P̂(0..2)·c]
  // (4. stolpec: P̂(i,3) z PLUS predznak — minus bi zrcalil translacijo in
  //  uničil cheirality; prejšnja različica je imela -(s·Σ + P̂(i,3)).)
  const P = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) P[i * 4 + j] = s * Phat[i * 4 + j];
    P[i * 4 + 3] = Phat[i * 4 + 3] - s * (Phat[i * 4] * c[0] + Phat[i * 4 + 1] * c[1] + Phat[i * 4 + 2] * c[2]);
  }
  // ekstrakcija: Rpart = λ·R, det(Rpart) = λ³ (det R = 1) → predznak λ določa det
  const Rpart = [P[0], P[1], P[2], P[4], P[5], P[6], P[8], P[9], P[10]];
  const tpart: [number, number, number] = [P[3], P[7], P[11]];
  const fr = frobMat3(Rpart);
  if (!(fr > 1e-12)) return null;
  const d = detMat3(Rpart);
  if (!Number.isFinite(d) || d === 0) return null;
  const lambda = (fr / Math.sqrt(3)) * Math.sign(d);
  let R = Rpart.map((v) => v / lambda);
  const t: [number, number, number] = [tpart[0] / lambda, tpart[1] / lambda, tpart[2] / lambda];
  if (!allFinite(R) || !allFinite(t)) return null;
  // ortogonalizacija (Gram–Schmidt po vrsticah, r2 = r0×r1 → det = +1)
  let r0: [number, number, number] = [R[0], R[1], R[2]];
  let r1: [number, number, number] = [R[3], R[4], R[5]];
  const n0 = Math.hypot(...r0);
  if (!(n0 > 1e-12)) return null;
  r0 = [r0[0] / n0, r0[1] / n0, r0[2] / n0];
  const d1 = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
  r1 = [r1[0] - d1 * r0[0], r1[1] - d1 * r0[1], r1[2] - d1 * r0[2]];
  const n1 = Math.hypot(...r1);
  if (!(n1 > 1e-12)) return null;
  r1 = [r1[0] / n1, r1[1] / n1, r1[2] / n1];
  const r2 = crossVec3(r0, r1);
  R = [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]];
  // cheirality: vsaj polovica korespondenc mora biti pred kamero
  let front = 0;
  for (const c2 of corrs) {
    const Xc = applyMat3(R, c2.X);
    if (Xc[2] + t[2] > 0) front++;
  }
  if (front * 2 < corrs.length) return null;
  return { R, t };
}

// ─── Notranje: Gauss–Newton ───────────────────────────────────

/** Vrne normalne enačbe (A = JᵀJ + λ·trace/n·I, g = Jᵀr) — rešitev δ po korakih. */
function solveNormalEqs(A: number[][], g: number[], dampingRel: number): number[] | null {
  const n = g.length;
  let tr = 0;
  for (let i = 0; i < n; i++) tr += A[i][i];
  const lam = dampingRel * (tr / n) + 1e-18;
  for (let i = 0; i < n; i++) A[i][i] += lam;
  const eg = jacobiEigen(A);
  if (eg.vectors.length === 0) return null;
  const delta = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    if (!(eg.values[k] > 1e-12)) continue;
    let proj = 0;
    for (let i = 0; i < n; i++) proj += eg.vectors[i][k] * g[i];
    const c = -proj / eg.values[k];
    for (let i = 0; i < n; i++) delta[i] += c * eg.vectors[i][k];
  }
  if (!allFinite(delta)) return null;
  return delta;
}

/**
 * Gauss–Newton rafiniranje poze (R, t) na 2D–3D korespondencah. Parametrizacija
 * inkrementa: rotacija po Rodriguesu (R' = exp([δω]×)·R), t' = t + δt.
 * Numerični Jacobian (h = 1e-5), normalne enačbe 6×6 (Jacobijev razcep iz jedra),
 * korak sprejet SAMO, če zniža vsoto kvadratov residualov (deterministično).
 * iters privzeto 10, relativna damping 1e-6.
 */
export function refinePoseGN(
  R0: number[],
  t0: [number, number, number],
  corrs: PoseCorrespondence[],
  K: KParams,
  iters = 10,
): { R: number[]; t: [number, number, number] } {
  let R = R0.slice();
  let t: [number, number, number] = [t0[0], t0[1], t0[2]];
  const cost = (Rc: number[], tc: [number, number, number]): number | null => {
    let s = 0;
    for (const c of corrs) {
      const p = projectCam(Rc, tc, K, c.X);
      if (!p) return null;
      const dx = p.x - c.x, dy = p.y - c.y;
      s += dx * dx + dy * dy;
    }
    return s;
  };
  let cur = cost(R, t);
  if (cur === null) return { R, t };
  const hW = 1e-5; // rad — perturbacija rotacije
  const hT = 1e-5; // enote rekonstrukcije — perturbacija translacije
  for (let it = 0; it < iters; it++) {
    const r0: number[] = [];
    for (const c of corrs) {
      const p = projectCam(R, t, K, c.X);
      if (!p) return { R, t };
      r0.push(p.x - c.x, p.y - c.y);
    }
    const n = corrs.length;
    const g = new Array<number>(6).fill(0);
    // numerični Jacobian (6 parametrov: δω 3, δt 3) — perturbirane projekcije
    // se izračunajo ENKRAT na točko in parameter (deterministično), nato
    // normalne enačbe A = JᵀJ, g = Jᵀr iz zbranih komponent
    const Jx: number[][] = [];
    const Jy: number[][] = [];
    for (let k = 0; k < n; k++) { Jx.push(new Array<number>(6).fill(0)); Jy.push(new Array<number>(6).fill(0)); }
    for (let pi = 0; pi < 6; pi++) {
      const step = pi < 3 ? hW : hT;
      for (let k = 0; k < n; k++) {
        const pp = perturbedProjection(R, t, K, corrs[k].X, pi, step);
        if (!pp) return { R, t };
        Jx[k][pi] = (pp.x - corrs[k].x - r0[k * 2]) / step;
        Jy[k][pi] = (pp.y - corrs[k].y - r0[k * 2 + 1]) / step;
        g[pi] += Jx[k][pi] * r0[k * 2] + Jy[k][pi] * r0[k * 2 + 1];
      }
    }
    const A: number[][] = [];
    for (let i = 0; i < 6; i++) A.push(new Array<number>(6).fill(0));
    for (let pi = 0; pi < 6; pi++) {
      for (let pj = pi; pj < 6; pj++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += Jx[k][pi] * Jx[k][pj] + Jy[k][pi] * Jy[k][pj];
        }
        A[pi][pj] = sum;
        A[pj][pi] = sum;
      }
    }
    const delta = solveNormalEqs(A, g, 1e-6);
    if (!delta) break;
    const dR = rodriguesMatrix([delta[0], delta[1], delta[2]]);
    const Rnew = mulMat3(dR, R);
    const tnew: [number, number, number] = [t[0] + delta[3], t[1] + delta[4], t[2] + delta[5]];
    if (!allFinite(Rnew) || !allFinite(tnew)) break;
    const cNew = cost(Rnew, tnew);
    if (cNew !== null && cNew < cur - 1e-12) {
      // ortogonalizacija po vsakem sprejetem koraku
      R = orthonormalize(Rnew);
      t = tnew;
      cur = cNew;
    } else break;
  }
  return { R, t };
}

/** Preslikana točka pri perturbiranem parameterju pi (pomožnik za Jacobian). */
function perturbedProjection(
  R: number[], t: [number, number, number], K: KParams,
  X: [number, number, number], pi: number, step: number,
): { x: number; y: number } | null {
  const Rp = R.slice();
  const tp: [number, number, number] = [t[0], t[1], t[2]];
  if (pi < 3) {
    const w = [0, 0, 0];
    w[pi] = step;
    const Rm = mulMat3(rodriguesMatrix(w), R);
    for (let i = 0; i < 9; i++) Rp[i] = Rm[i];
  } else {
    tp[pi - 3] += step;
  }
  const p = projectCam(Rp, tp, K, X);
  return p ? { x: p.x, y: p.y } : null;
}

/** Gram–Schmidt ortogonalizacija vrstic (r2 = r0×r1 → det +1). */
function orthonormalize(R: number[]): number[] {
  let r0: [number, number, number] = [R[0], R[1], R[2]];
  let r1: [number, number, number] = [R[3], R[4], R[5]];
  const n0 = Math.hypot(...r0);
  if (!(n0 > 1e-12)) return R.slice();
  r0 = [r0[0] / n0, r0[1] / n0, r0[2] / n0];
  const d1 = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
  r1 = [r1[0] - d1 * r0[0], r1[1] - d1 * r0[1], r1[2] - d1 * r0[2]];
  const n1 = Math.hypot(...r1);
  if (!(n1 > 1e-12)) return R.slice();
  r1 = [r1[0] / n1, r1[1] / n1, r1[2] / n1];
  const r2 = crossVec3(r0, r1);
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]];
}

/**
 * Gauss–Newton rafiniranje ENE 3D točke na fiksnih pozah (2–5 opazavanj).
 * Numerični Jacobian (3 parametri), normalne enačbe 3×3, damping 1e-6,
 * največ 10 iteracij, korak sprejet samo ob zmanjšanju vsote kvadratov px residualov.
 */
export function refinePointGN(
  X0: [number, number, number],
  views: Array<{ P: number[]; x: number; y: number }>,
  iters = 10,
): [number, number, number] {
  let X: [number, number, number] = [X0[0], X0[1], X0[2]];
  if (views.length === 0) return X;
  const cost = (Xc: [number, number, number]): number | null => {
    let s = 0;
    for (const v of views) {
      const p = projectP(v.P, Xc);
      if (!p) return null;
      s += (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
    }
    return s;
  };
  let cur = cost(X);
  if (cur === null) return X;
  const h = 1e-6 * (1 + Math.abs(X[0]) + Math.abs(X[1]) + Math.abs(X[2]));
  for (let it = 0; it < iters; it++) {
    const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const g = [0, 0, 0];
    for (let pi = 0; pi < 3; pi++) {
      const Xp: [number, number, number] = [X[0], X[1], X[2]];
      Xp[pi] += h;
      for (const v of views) {
        const pb = projectP(v.P, X);
        const pp = projectP(v.P, Xp);
        if (!pb || !pp) return X;
        const jx = (pp.x - pb.x) / h;
        const jy = (pp.y - pb.y) / h;
        const rx = pb.x - v.x;
        const ry = pb.y - v.y;
        g[pi] += jx * rx + jy * ry;
        A[pi][pi] += jx * jx + jy * jy;
        for (let pj = pi + 1; pj < 3; pj++) {
          const Xq: [number, number, number] = [X[0], X[1], X[2]];
          Xq[pj] += h;
          const pq = projectP(v.P, Xq);
          if (!pq) return X;
          const jxq = (pq.x - pb.x) / h;
          const jyq = (pq.y - pb.y) / h;
          const cross = jx * jxq + jy * jyq;
          A[pi][pj] += cross;
          A[pj][pi] += cross;
        }
      }
    }
    const delta = solveNormalEqs(A, g, 1e-6);
    if (!delta) break;
    const Xnew: [number, number, number] = [X[0] + delta[0], X[1] + delta[1], X[2] + delta[2]];
    if (!allFinite(Xnew)) break;
    const cNew = cost(Xnew);
    if (cNew !== null && cNew < cur - 1e-15) {
      X = Xnew;
      cur = cNew;
    } else break;
  }
  return X;
}

// ─── Notranje: PnP RANSAC ─────────────────────────────────────

/** Reprojekcijska residuala (px) korespondence pri dani pozi. */
function reprojPx(R: number[], t: [number, number, number], K: KParams, c: PoseCorrespondence): number | null {
  const p = projectCam(R, t, K, c.X);
  if (!p) return null;
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/**
 * RANSAC okoli linearne DLT rešitve poze (glej solvePoseRansac spodaj).
 */
// ─── Ravninska inicializacija začetnega para (klasična, deterministična) ──────
// Stene/fasade/ograje so v praksi PRETEŽNO ravninske: za takšen par je
// esencialna matrika slabo kondicionirana (baza ↔ konvergenca se zamenjujeta)
// in SfM pristane v lokalnem minimumu z izkrivljeno metriko (izmerjeno ×1,49).
// Rešitev: RANSAC homografija na inlierjih para → točke ravnine X = (u, v, 1)
// v kameri A (normalizirani žarki ∩ ravnina z = 1) → PnP za kamero B s
// STOJEČO, testirano PnP mehaniko. Metrični gabarit nato določa ravnina.

export interface HomographyResult {
  H: number[];
  inliers: number[];
  meanResidualPx: number;
}

/** Hartleyjeva normalizacija 2D točk (težišče v izhodišče, povp. razdalja √2). */
function hartley2D(pts: XY[]): { T: number[]; norm: XY[] } | null {
  const n = pts.length;
  if (n < 4) return null;
  let sx = 0, sy = 0;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    sx += p.x; sy += p.y;
  }
  const mx = sx / n, my = sy / n;
  let s = 0;
  for (const p of pts) s += Math.hypot(p.x - mx, p.y - my);
  const meanDist = s / n;
  if (!(meanDist > 1e-9)) return null;
  const sc = Math.SQRT2 / meanDist;
  const T = [sc, 0, -sc * mx, 0, sc, -sc * my, 0, 0, 1];
  const norm = pts.map((p) => ({ x: sc * (p.x - mx), y: sc * (p.y - my) }));
  return { T, norm };
}

function applyH(H: number[], p: XY): XY {
  const x = H[0] * p.x + H[1] * p.y + H[2];
  const y = H[3] * p.x + H[4] * p.y + H[5];
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return Math.abs(w) > 1e-12 ? { x: x / w, y: y / w } : { x: NaN, y: NaN };
}

/** Inverz 3×3 (row-major, adjugat/determinanta) ali null pri degenerirani. */
function inv3(m: number[]): number[] | null {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const c11 = e * i - f * h, c12 = -(d * i - f * g), c13 = d * h - e * g;
  const c21 = -(b * i - c * h), c22 = a * i - c * g, c23 = -(a * h - b * g);
  const c31 = b * f - c * e, c32 = -(a * f - c * d), c33 = a * e - b * d;
  const det = a * c11 + b * c12 + c * c13;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  // adjugat = transponiranka kofaktorjev
  return [c11 / det, c21 / det, c31 / det, c12 / det, c22 / det, c32 / det, c13 / det, c23 / det, c33 / det];
}

/** DLT homografija iz ≥ 4 točk (normalne enačbe 9×9, najmanjša lastna vrednost). */
function solveHomographyDLT(pa: XY[], pb: XY[]): number[] | null {
  const na = hartley2D(pa), nb = hartley2D(pb);
  if (!na || !nb) return null;
  const n = pa.length;
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const { x: u, y: v } = na.norm[i];
    const { x: U, y: V } = nb.norm[i];
    A.push([u, v, 1, 0, 0, 0, -U * u, -U * v, -U]);
    A.push([0, 0, 0, u, v, 1, -V * u, -V * v, -V]);
  }
  // M = AᵀA (simetrična 9×9) → najmanjša lastna vrednost = rešitev
  const M: number[][] = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (let i = 0; i < 9; i++) {
    for (let j = i; j < 9; j++) {
      let s = 0;
      for (const row of A) s += row[i] * row[j];
      M[i][j] = s; M[j][i] = s;
    }
  }
  const eg = jacobiEigen(M);
  if (eg.values.length !== 9) return null;
  let minI = 0;
  for (let i = 1; i < 9; i++) if (eg.values[i] < eg.values[minI]) minI = i;
  // jacobiEigen: stolpec j = lastni vektor za values[j] (vectors[komponenta][j])
  const hFlat = eg.vectors.map((row) => row[minI]);
  if (hFlat.some((v) => !Number.isFinite(v))) return null;
  // denormalizacija: H = Tb⁻¹ · Ĥ · Ta
  const Hn = [hFlat[0], hFlat[1], hFlat[2], hFlat[3], hFlat[4], hFlat[5], hFlat[6], hFlat[7], hFlat[8]];
  const TbInv = [1 / nb.T[0], 0, -nb.T[2] / nb.T[0], 0, 1 / nb.T[4], -nb.T[5] / nb.T[4], 0, 0, 1];
  const H1 = mulMat3(TbInv, Hn);
  const H = mulMat3(H1, na.T);
  const scale = Math.hypot(H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7], H[8]);
  if (!(scale > 1e-12)) return null;
  return H.map((v) => v / scale);
}

/** RANSAC homografija (simetrični prenosni prag, deterministično prek rand). */
export function estimateHomographyRansac(
  ptsA: XY[],
  ptsB: XY[],
  rand: () => number,
  opts?: { iters?: number; thresholdPx?: number },
): HomographyResult | null {
  const iters = opts?.iters ?? 600;
  const thr = opts?.thresholdPx ?? 3;
  if (ptsA.length !== ptsB.length || ptsA.length < 4) return null;
  if (!ptsA.concat(ptsB).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  let best: HomographyResult | null = null;
  const n = ptsA.length;
  for (let it = 0; it < iters; it++) {
    let sample: number[] | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const s: number[] = [];
      for (let k = 0; k < 4; k++) s.push(Math.floor(rand() * n));
      if (new Set(s).size === 4) { sample = s; break; }
    }
    if (!sample) continue;
    const H = solveHomographyDLT(sample.map((i) => ptsA[i]), sample.map((i) => ptsB[i]));
    if (!H) continue;
    const Hinv = inv3(H);
    if (!Hinv) continue;
    const inliers: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const fwd = applyH(H, ptsA[i]);
      const bwd = applyH(Hinv, ptsB[i]);
      if (!Number.isFinite(fwd.x) || !Number.isFinite(bwd.x)) continue;
      const e = Math.hypot(fwd.x - ptsB[i].x, fwd.y - ptsB[i].y) + Math.hypot(bwd.x - ptsA[i].x, bwd.y - ptsA[i].y);
      sum += e / 2;
      if (e / 2 <= thr) inliers.push(i);
    }
    const mean = sum / n;
    if (best === null || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && mean < best.meanResidualPx)) {
      best = { H, inliers, meanResidualPx: mean };
    }
  }
  if (!best || best.inliers.length < 6) return null;
  // končna DLT na vseh inlierjih (deterministična izboljšava)
  const H2 = solveHomographyDLT(best.inliers.map((i) => ptsA[i]), best.inliers.map((i) => ptsB[i]));
  if (!H2) return best;
  const H2inv = inv3(H2);
  if (!H2inv) return best;
  const inliers2: number[] = [];
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const fwd = applyH(H2, ptsA[i]);
    const bwd = applyH(H2inv, ptsB[i]);
    if (!Number.isFinite(fwd.x) || !Number.isFinite(bwd.x)) continue;
    const e = Math.hypot(fwd.x - ptsB[i].x, fwd.y - ptsB[i].y) + Math.hypot(bwd.x - ptsA[i].x, bwd.y - ptsA[i].y);
    sum2 += e / 2;
    if (e / 2 <= thr) inliers2.push(i);
  }
  if (inliers2.length >= best.inliers.length) {
    return { H: H2, inliers: inliers2, meanResidualPx: sum2 / n };
  }
  return best;
}

/**
 * Poza kamere B iz ravninske homografije: točke ravnine X = (u, v, 1) v kameri
 * A (normalizirani žarki skozi piksle A ∩ ravnina z = 1), korespondenca =
 * piksli B → PnP (DLT + RANSAC + GN, stoječa mehanika). Čeiralnost: če je
 * ravnina za kamero B, poskusi še obrnjen t in izbere boljšo (deterministično).
 */
export function planarPoseFromHomography(
  H: number[],
  focalPx: number,
  cxA: number,
  cyA: number,
  cxB: number,
  cyB: number,
  ptsA: XY[],
  ptsB: XY[],
  homInliers: number[],
): { R: number[]; t: [number, number, number]; planeInliers: number } | null {
  if (!(focalPx > 0) || homInliers.length < 6) return null;
  // normalizirane koordinate pikslov A (K⁻¹ p) — ravnina z = 1 v kameri A
  const corrs: PoseCorrespondence[] = [];
  for (const k of homInliers) {
    const p = ptsA[k];
    const u = (p.x - cxA) / focalPx;
    const v = (p.y - cyA) / focalPx;
    corrs.push({ x: ptsB[k].x, y: ptsB[k].y, X: [u, v, 1] });
  }
  const K = { f: focalPx, cx: cxB, cy: cyB };
  const attempt = (flip: boolean): { R: number[]; t: [number, number, number]; inliers: number[] } | null => {
    const ransac = solvePoseRansac(corrs, K, lcg(5200 + (flip ? 1 : 0)), { thresholdPx: 2.5 });
    if (!ransac) return null;
    const t: [number, number, number] = flip
      ? [-ransac.t[0], -ransac.t[1], -ransac.t[2]]
      : ransac.t;
    // GN rafinacija na RANSAC inlierjih
    const inlierCorrs = ransac.inliers.map((i) => corrs[i]);
    const ref = refinePoseGN(ransac.R, t, inlierCorrs, K);
    let inliers = ransac.inliers;
    // ponovno ovrednoti inlierje po rafinaciji
    const nIn: number[] = [];
    for (let i = 0; i < corrs.length; i++) {
      const X = corrs[i].X;
      const xc = ref.R[0] * X[0] + ref.R[1] * X[1] + ref.R[2] * X[2] + ref.t[0];
      const yc = ref.R[3] * X[0] + ref.R[4] * X[1] + ref.R[5] * X[2] + ref.t[1];
      const zc = ref.R[6] * X[0] + ref.R[7] * X[1] + ref.R[8] * X[2] + ref.t[2];
      if (zc <= 1e-6) continue;
      const px = (focalPx * xc) / zc + cxB;
      const py = (focalPx * yc) / zc + cyB;
      if (Math.hypot(px - corrs[i].x, py - corrs[i].y) <= 2.5) nIn.push(i);
    }
    if (nIn.length >= inliers.length) inliers = nIn;
    return { R: ref.R, t: ref.t, inliers };
  };
  const a = attempt(false);
  const b = attempt(true);
  const score = (r: { R: number[]; t: [number, number, number]; inliers: number[] } | null): number => {
    if (!r) return -1;
    // število ravninskih točk PRED kamero B (cheirality) — odločilni kriterij
    let front = 0;
    for (const c of corrs) {
      const zc = r.R[6] * c.X[0] + r.R[7] * c.X[1] + r.R[8] * c.X[2] + r.t[2];
      if (zc > 0) front++;
    }
    return front * 1000 + r.inliers.length;
  };
  const sa = score(a);
  const sb = score(b);
  const best = sa >= sb ? a : b;
  if (!best || score(best) < 0) return null;
  return { R: best.R, t: best.t, planeInliers: best.inliers.length };
}

export function solvePoseRansac(
  corrs: PoseCorrespondence[],
  K: KParams,
  rand: () => number,
  opts?: { iters?: number; thresholdPx?: number },
): { R: number[]; t: [number, number, number]; inliers: number[]; meanResidualPx: number } | null {
  /**
   * RANSAC okoli linearne DLT rešitve poze: 200 iteracij (deterministični vzorci
   * prek danega LCG), vzorec 6 korespondenc, prag reprojekcije (px). Najboljša
   * poza = največ inlierjev, izenačeno → manjša srednja residuala. Nato DLT čez
   * vse inlierje + Gauss–Newton in ponovni izbor inlierjev. Null pri < 6 točkah
   * oz. če noben vzorec ne da veljavne poze.
   */
  const iters = opts?.iters ?? SFM_DEFAULTS.pnpIterations;
  const thr = opts?.thresholdPx ?? SFM_DEFAULTS.pnpThresholdPx;
  if (corrs.length < 6) return null;
  let best: { R: number[]; t: [number, number, number]; inliers: number[]; mean: number } | null = null;
  for (let it = 0; it < iters; it++) {
    let sample: number[] | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const s: number[] = [];
      for (let k = 0; k < 6; k++) s.push(Math.floor(rand() * corrs.length));
      if (new Set(s).size === 6) { sample = s; break; }
    }
    if (!sample) continue;
    const pose = solvePoseDLT(sample.map((k) => corrs[k]), K);
    if (!pose) continue;
    const inliers: number[] = [];
    let sum = 0;
    for (let k = 0; k < corrs.length; k++) {
      const r = reprojPx(pose.R, pose.t, K, corrs[k]);
      if (r === null) continue;
      sum += r;
      if (r <= thr) inliers.push(k);
    }
    const mean = sum / corrs.length;
    if (best === null || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && mean < best.mean - 1e-12)) {
      best = { R: pose.R, t: pose.t, inliers, mean };
    }
  }
  if (!best) return null;
  // DLT čez vse inlierje + GN na inlierjih + ponovni izbor
  let finalR = best.R;
  let finalT = best.t;
  const dl = solvePoseDLT(best.inliers.map((k) => corrs[k]), K);
  if (dl) {
    const ref = refinePoseGN(dl.R, dl.t, best.inliers.map((k) => corrs[k]), K);
    finalR = ref.R;
    finalT = ref.t;
  }
  const inliers: number[] = [];
  let sum = 0;
  for (let k = 0; k < corrs.length; k++) {
    const r = reprojPx(finalR, finalT, K, corrs[k]);
    if (r === null) continue;
    sum += r;
    if (r <= thr) inliers.push(k);
  }
  if (inliers.length < 6) return null;
  return { R: finalR, t: finalT, inliers, meanResidualPx: sum / corrs.length };
}

// ─── Notranje: unija-find za gradnjo trekov ───────────────────

const CORNER_STRIDE = 1024; // največ vogalov na fotko (privzeti maxCorners = 600)
const nodeKey = (imgIdx: number, cornerIdx: number): number => imgIdx * CORNER_STRIDE + cornerIdx;

function ufFind(parent: Int32Array, a: number): number {
  let r = a;
  while (parent[r] !== r) r = parent[r];
  while (parent[a] !== r) { const nx = parent[a]; parent[a] = r; a = nx; }
  return r;
}

function ufUnion(parent: Int32Array, a: number, b: number): void {
  const ra = ufFind(parent, a);
  const rb = ufFind(parent, b);
  if (ra === rb) return;
  // deterministično: manjši koren postane starš
  if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
}

// ─── Notranje: vmesne strukture runSfm ────────────────────────

interface PairInfo {
  i: number;
  j: number;
  matches: MVMatch[];
  F: number[] | null;
  inlierIdx: number[];
  meanResidualPx: number;
  count: number;
}

interface ImgFeature {
  gray: Float64Array;
  corners: Corner[];
  desc: (Float64Array | null)[];
  K: KParams;
}

// ─── Glavna funkcija: runSfm ──────────────────────────────────

/**
 * Inkrementalni klasični SfM iz 2–5 fotk. Vsi vhodi so deterministično obdelani;
 * vsak neuspeh je ekspliciten (ok:false + slovenski error code + sporočilo).
 * Merilo (cm) NI del runSfm — nastane šele z znano referenčno dolžino prek
 * resolveReferenceAndMeasures (do takrat scaleCmPerUnit = null in status
 * javlja manjkajočo referenco — nič izmišljenega merila).
 */
export function runSfm(images: SfmImageInput[], opts?: SfmOptions): SfmResult {
  const minPairInliers = opts?.minPairInliers ?? SFM_DEFAULTS.minPairInliers;
  const minPairInlierRatio = opts?.minPairInlierRatio ?? SFM_DEFAULTS.minPairInlierRatio;
  const maxPairResidualPx = opts?.maxPairResidualPx ?? SFM_DEFAULTS.maxPairResidualPx;
  const minRegisterCorrespondences = opts?.minRegisterCorrespondences ?? SFM_DEFAULTS.minRegisterCorrespondences;
  const maxImages = opts?.maxImages ?? SFM_DEFAULTS.maxImages;

  // ── 1) Validacija vhodov (eksplicitno, brez tihih popravkov)
  if (!Array.isArray(images) || images.length < 2) {
    return {
      ok: false, error: 'DEGENERATE_GEOMETRY',
      message: 'NEZADOSTNI PODATKI: SfM potrebuje vsaj 2 fotki istega objekta.',
    };
  }
  if (images.length > maxImages) {
    return {
      ok: false, error: 'DEGENERATE_GEOMETRY',
      message: `NEZADOSTNI PODATKI: preveč fotk (${images.length} > ${maxImages}) — ta implementacija podpira do ${maxImages} fotk.`,
    };
  }
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    if (!im || !Number.isInteger(im.width) || !Number.isInteger(im.height) || im.width < 1 || im.height < 1) {
      return {
        ok: false, error: 'DEGENERATE_GEOMETRY',
        message: `NEZADOSTNI PODATKI: fotka ${i} (${im?.name ?? 'brez imena'}) ima neveljavne dimenzije.`,
      };
    }
    if (!im.gray || im.gray.length < im.width * im.height) {
      return {
        ok: false, error: 'DEGENERATE_GEOMETRY',
        message: `NEZADOSTNI PODATKI: siva slika fotke ${i} (${im.name}) ne pokriva celotne slike (${im.width}×${im.height}).`,
      };
    }
    if (im.focalPx !== null && im.focalPx !== undefined && (!Number.isFinite(im.focalPx) || im.focalPx <= 0)) {
      return {
        ok: false, error: 'DEGENERATE_GEOMETRY',
        message: `NEZADOSTNI PODATKI: fokus fotke ${i} (${im.name}) je neveljaven (${String(im.focalPx)} px) — popravi EXIF oz. vnos.`,
      };
    }
  }

  const N = images.length;
  const warnings: string[] = [];

  // ── 2) Značilnosti po fotkah (gostejše kot pri paru: manjši minDistancePx
  // — pri SfM je treba povezati ISTO fizikalno točko čez ≥ 3 fotke, zato
  // več kandidatov pomaga; NCC + ratio test + RANSAC odstranijo lažna)
  const feats: ImgFeature[] = [];
  for (let i = 0; i < N; i++) {
    const im = images[i];
    const gray = im.gray instanceof Float64Array ? im.gray : Float64Array.from(im.gray);
    const corners = findCorners(gray, im.width, im.height, { minDistancePx: 6, maxCorners: 900 });
    const desc = buildDescriptors(gray, im.width, im.height, corners, 9);
    feats.push({ gray, corners, desc, K: { f: 1, cx: im.width / 2, cy: im.height / 2 } });
  }

  // ── 3) Porne ujemanje + fundamentalne matrike za vse pare (fiksni vrstni red)
  const pairMap = new Map<string, PairInfo>();
  const pairList: PairInfo[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const matches = matchFeatures(
        feats[i].corners, feats[i].desc, feats[j].corners, feats[j].desc,
        { width: images[i].width, height: images[i].height },
        { width: images[j].width, height: images[j].height },
        // minNcc ostane 0.86 (enako kot pri paru): nižje vrednosti povečajo
        // recall, a ustvarijo konflikte v trekih (veje istega kota na isti
        // fotki) — dedup potem vzame napačen kot in triangulacija odpade.
        { maxDisplacementPct: 25 },
      );
      const ptsA = matches.map((m) => ({ x: feats[i].corners[m.ai].x, y: feats[i].corners[m.ai].y }));
      const ptsB = matches.map((m) => ({ x: feats[j].corners[m.bi].x, y: feats[j].corners[m.bi].y }));
      const fr = ptsA.length >= 8
        ? estimateFundamental(images[i].width, images[i].height, images[j].width, images[j].height, ptsA, ptsB, lcg(42 + i * 100 + j))
        : null;
      const info: PairInfo = {
        i, j, matches,
        F: fr?.F ?? null,
        inlierIdx: fr?.inliers ?? [],
        meanResidualPx: fr?.meanResidualPx ?? Number.POSITIVE_INFINITY,
        count: fr?.inliers.length ?? 0,
      };
      pairMap.set(`${i},${j}`, info);
      pairList.push(info);
    }
  }

  // ── 4) Začetni par: največ inlierjev, tie → najmanjši (i, j)
  // Pogoj: dovolj inlierjev IN zdravo razmerje (inlierji/ujemanja ≥ 0.5).
  // Srednja residuala čez VSE ujemanja je iskren signal raztresenosti —
  // ob realističnem deležu lažnih ujemanj ni trdi pogoj, ampak opozorilo.
  let initPair: PairInfo | null = null;
  for (const p of pairList) {
    if (p.count < minPairInliers) continue;
    const ratio = p.matches.length > 0 ? p.count / p.matches.length : 0;
    if (ratio < minPairInlierRatio) continue;
    if (initPair === null || p.count > initPair.count) initPair = p;
  }
  if (!initPair || !initPair.F) {
    return {
      ok: false, error: 'NO_VALID_PAIR',
      message: `NEZADOSTNI PODATKI: noben par fotk nima dovolj zanesljivih skupnih povezav (potrebno ≥ ${minPairInliers} RANSAC inlierjev in razmerje inlierjev ≥ ${Math.round(minPairInlierRatio * 100)} % ujemanj). Posnemi fotke z večjim prekrivanjem (vsaj 60 % skupnega pogleda), ostre in z izrazito neperiodično teksturo.`,
    };
  }
  if (initPair.meanResidualPx > maxPairResidualPx) {
    warnings.push(`Srednja residuala začetnega para je ${initPair.meanResidualPx.toFixed(1)} px (nad ${maxPairResidualPx} px) — med ujemanji je razmeroma veliko neskladnih povezav; RANSAC jih je izločil, a preveri ostrino in teksturo.`);
  }

  // ── 5) Fokus: known (povprečje) / preset / selfcal (obstoječi Hartley/Kruppa)
  const focalVals = images.map((im) => (im.focalPx ?? null));
  let focalPx: number;
  let focalSource: 'known' | 'preset' | 'selfcal';
  if (focalVals.every((v) => v !== null)) {
    focalPx = (focalVals as number[]).reduce((a, b) => a + b, 0) / N;
    focalSource = 'known';
  } else {
    const first = focalVals.find((v) => v !== null);
    if (first !== null && first !== undefined) {
      focalPx = first;
      focalSource = 'preset';
      warnings.push('Fokus je znan le za del fotk — uporabljen prvi podani fokus (preset). Za zanesljivejšo geometrijo nastavi fokus za vse fotke (EXIF).');
    } else {
      const cands = focalCandidatesFromF(initPair.F, images[initPair.i].width, images[initPair.i].height);
      if (cands.length === 0) {
        return {
          ok: false, error: 'DEGENERATE_GEOMETRY',
          message: 'Ne morem oceniti fokusa iz geometrije (samokalibracija ni uspela) — vnesi fokus naprave (EXIF) ali uporabi znani preset.',
        };
      }
      focalPx = cands[Math.floor((cands.length - 1) / 2)];
      focalSource = 'selfcal';
      warnings.push('Fokus ocenjen iz fotk (samokalibracija) — mera je samo orientacijska, za proizvodno uporabi EXIF fokus.');
    }
  }

  // ── 6) Začetna rekonstrukcija (par): kandidati s ponovitvami ─────────────
  // Klasična robustnost: relativePose lahko pri repetitivni teksturi izbere
  // napačno vejo poze (cheiralnost šteje samo predznake globin, ne prileganja)
  // in triangulacija začetnega para da 0 veljavnih točk (izmerjeno: seed 44 →
  // vseh 68 točk z napako > 3 px). Zato kandidati padajoče po inlierjih
  // (fiksni vrstni red, tie → manjši (i, j)); za vsakega ravninska
  // inicializacija (≥ 60 % homografskih točk) ali esencialna poza, nato
  // začetna triangulacija; sprejme se PRVI kandidat z ≥ 12 veljavnimi točkami.
  const parent = new Int32Array(N * CORNER_STRIDE);
  for (let k = 0; k < parent.length; k++) parent[k] = k;
  for (const p of pairList) {
    for (const k of p.inlierIdx) {
      const m = p.matches[k];
      ufUnion(parent, nodeKey(p.i, m.ai), nodeKey(p.j, m.bi));
    }
  }
  // komponente → treki (deterministično: id po naraščajočem najmanjšem članu;
  // samo komponente z ≥ 2 člani so treki; na fotko ostane NAJMANJŠI cornerIdx)
  interface TrackDraft {
    observations: SfmObservation[];
    point3: { x: number; y: number; z: number } | null;
  }
  const members = new Map<number, number[]>(); // root → [nodeKey naraščajoče]
  for (let img = 0; img < N; img++) {
    for (let cIdx = 0; cIdx < feats[img].corners.length; cIdx++) {
      const key = nodeKey(img, cIdx);
      const root = ufFind(parent, key);
      let arr = members.get(root);
      if (!arr) { arr = []; members.set(root, arr); }
      arr.push(key);
    }
  }
  const ids = [...members.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .sort((u, v) => u[1][0] - v[1][0]);
  const trackDrafts: TrackDraft[] = [];
  const cornerToTrack = new Map<number, number>();
  for (const [root, arr] of ids) {
    const tid = trackDrafts.length;
    trackDrafts.push({ observations: [], point3: null });
    const seenImg = new Set<number>();
    for (const key of arr) {
      const img = Math.floor(key / CORNER_STRIDE);
      // karte za VSE člane (tudi odstranjene duplikate — štejejo kot pozicije na fotki)
      if (!cornerToTrack.has(key)) cornerToTrack.set(key, tid);
      if (seenImg.has(img)) continue; // duplikat v isti fotki → manjši cornerIdx ostane
      seenImg.add(img);
      const cIdx = key % CORNER_STRIDE;
      trackDrafts[tid].observations.push({ imgIdx: img, x: feats[img].corners[cIdx].x, y: feats[img].corners[cIdx].y });
    }
  }

  const poses = new Map<number, { R: number[]; t: [number, number, number] }>();

  const cheiral = (R: number[], t: [number, number, number], X: [number, number, number]): boolean => {
    const Xc = applyMat3(R, X);
    return X[2] > 0 && Xc[2] + t[2] > 0;
  };

  const Pof = (imgIdx: number): number[] => {
    const p = poses.get(imgIdx)!;
    return projectionMatrix(focalPx, images[imgIdx].width, images[imgIdx].height, p.R, p.t);
  };

  const minInitPoints = 12;
  const candPairs = pairList
    .filter((p) => p.F !== null && p.count >= minPairInliers && p.matches.length > 0 && p.count / p.matches.length >= minPairInlierRatio)
    .sort((u, v) => v.count - u.count || u.i - v.i || u.j - v.j)
    .slice(0, 4);
  let ia = -1;
  let ib = -1;
  let pose01: { R: number[]; t: number[] } | null = null;
  let initAccepted = false;
  for (const cand of candPairs) {
    const pA = cand.matches.map((m) => ({ x: feats[cand.i].corners[m.ai].x, y: feats[cand.i].corners[m.ai].y }));
    const pB = cand.matches.map((m) => ({ x: feats[cand.j].corners[m.bi].x, y: feats[cand.j].corners[m.bi].y }));
    let p: { R: number[]; t: number[] } | null = null;
    let planarPct = -1;
    const hom = estimateHomographyRansac(pA, pB, lcg(4200 + cand.i * 100 + cand.j), { thresholdPx: 3 });
    const homRatio = hom ? hom.inliers.length / Math.max(1, cand.count) : 0;
    if (hom && homRatio >= 0.6) {
      const pp = planarPoseFromHomography(
        hom.H, focalPx,
        images[cand.i].width / 2, images[cand.i].height / 2,
        images[cand.j].width / 2, images[cand.j].height / 2,
        pA, pB, hom.inliers,
      );
      if (pp) {
        p = { R: pp.R, t: [pp.t[0], pp.t[1], pp.t[2]] };
        planarPct = Math.round(homRatio * 100);
      }
    }
    if (!p) {
      const F = cand.F;
      if (!F) continue;
      p = relativePose(
        F, focalPx, focalPx,
        images[cand.i].width, images[cand.i].height, images[cand.j].width, images[cand.j].height,
        pA, pB, cand.inlierIdx,
      );
    }
    if (!p) continue;
    // začetna triangulacija za TEGA kandidata → štej veljavne točke
    poses.clear();
    poses.set(cand.i, { R: IDENTITY3.slice(), t: [0, 0, 0] });
    poses.set(cand.j, { R: p.R.slice(), t: [p.t[0], p.t[1], p.t[2]] });
    const Pa = Pof(cand.i);
    const Pb = Pof(cand.j);
    let valid = 0;
    for (const tr of trackDrafts) tr.point3 = null; // ponastavi predhodnega kandidata
    for (const tr of trackDrafts) {
      const oA = tr.observations.find((o) => o.imgIdx === cand.i);
      const oB = tr.observations.find((o) => o.imgIdx === cand.j);
      if (!oA || !oB) continue;
      const tri = triangulateDLT(Pa, Pb, { x: oA.x, y: oA.y }, { x: oB.x, y: oB.y });
      if (!tri || tri.errPx > SFM_DEFAULTS.trackMaxErrPx) continue;
      if (!cheiral(IDENTITY3, [0, 0, 0], tri.X)) continue;
      if (!cheiral(p.R, [p.t[0], p.t[1], p.t[2]], tri.X)) continue;
      tr.point3 = { x: tri.X[0], y: tri.X[1], z: tri.X[2] };
      valid++;
    }
    if (valid >= minInitPoints) {
      ia = cand.i;
      ib = cand.j;
      pose01 = p;
      initAccepted = true;
      if (planarPct >= 0) {
        warnings.push(`Scena je pretežno ravninska (${planarPct} % točk začetnega para na isti ravnini) — inicializacija po ravnini. Globinske razlike so občutljive: za globino preveri s trakom/laserjem.`);
      }
      break;
    }
  }
  if (!initAccepted || !pose01) {
    return {
      ok: false, error: 'DEGENERATE_GEOMETRY',
      message: 'NEZADOSTNI PODATKI: noben par fotk ne da dovolj zanesljivih skupnih 3D točk za začetek rekonstrukcije. Posnemi pare z večjim prekrivanjem (vsaj 60 % skupnega pogleda), ostre in z izrazito neperiodično teksturo.',
    };
  }
  const registeredOrder: number[] = [ia, ib].sort((u, v) => u - v);
  const pending = new Set<number>();
  for (let i = 0; i < N; i++) if (!poses.has(i)) pending.add(i);
  const unregisteredOut: SfmUnregistered[] = [];
  const emitted = new Set<number>();
  const failedPnp = new Map<number, string>();
  // fokus je znan šele zdaj — dopolni K vseh fotk
  for (const ft of feats) ft.K.f = focalPx;

  // ── 7) Inkrementalna registracija (deterministični vrstni red)

  /** Korespondence fotke n s 3D točkami trekov (deterministično, brez duplikatov). */
  const correspondencesFor = (n: number): { list: PoseCorrespondence[]; count: number } => {
    const seenTrack = new Set<number>();
    const list: PoseCorrespondence[] = [];
    const seenCorner = new Set<number>();
    for (const r of registeredOrder) {
      const p = n < r ? pairMap.get(`${n},${r}`) : pairMap.get(`${r},${n}`);
      if (!p) continue;
      for (const k of p.inlierIdx) {
        const m = p.matches[k];
        const cIdx = p.i === n ? m.ai : m.bi;
        const ckey = nodeKey(n, cIdx);
        if (seenCorner.has(ckey)) continue;
        seenCorner.add(ckey);
        const tid = cornerToTrack.get(ckey);
        if (tid === undefined) continue;
        const tr = trackDrafts[tid];
        if (!tr.point3) continue;
        if (seenTrack.has(tid)) continue;
        seenTrack.add(tid);
        const obs = tr.observations.find((o) => o.imgIdx === n);
        if (!obs) continue;
        list.push({ x: obs.x, y: obs.y, X: [tr.point3.x, tr.point3.y, tr.point3.z] });
      }
    }
    return { list, count: list.length };
  };

  let registeredAny = false;
  while (pending.size > 0) {
    // kandidat: največ korespondenc, tie → najmanjši imgIdx
    let bestIdx = -1;
    let bestCount = -1;
    let bestList: PoseCorrespondence[] = [];
    const countCache = new Map<number, { list: PoseCorrespondence[]; count: number }>();
    for (const i of [...pending].sort((u, v) => u - v)) {
      const res = correspondencesFor(i);
      countCache.set(i, res);
      if (res.count > bestCount) { bestCount = res.count; bestIdx = i; bestList = res.list; }
    }
    if (bestIdx < 0 || bestCount < minRegisterCorrespondences) {
      for (const i of [...pending].sort((u, v) => u - v)) {
        const cnt = countCache.get(i)?.count ?? 0;
        unregisteredOut.push({
          imgIdx: i,
          reason: `INSUFFICIENT_OVERLAP: premalo skupnih točk z že registriranimi fotkami (${cnt}, potrebnih ≥ ${minRegisterCorrespondences}) — fotka ni registrirana.`,
        });
        emitted.add(i);
        pending.delete(i);
        failedPnp.delete(i);
      }
      break;
    }
    // PnP-DLT + RANSAC + GN
    const Kn = feats[bestIdx].K;
    Kn.f = focalPx;
    const ransac = solvePoseRansac(bestList, Kn, lcg(1000 + bestIdx));
    let okPose: { R: number[]; t: [number, number, number] } | null = null;
    if (ransac && ransac.inliers.length >= minRegisterCorrespondences) {
      okPose = { R: ransac.R, t: ransac.t };
    }
    if (!okPose) {
      pending.delete(bestIdx);
      failedPnp.set(bestIdx, `PREMALO UJEMANJ Z 3D TOČKAMI: RANSAC pri PnP ni potrdil dovolj korespondenc (potrebnih ≥ ${minRegisterCorrespondences}) — fotka ni registrirana.`);
      if (pending.size === 0) break;
      // če je od zadnjega neuspeha prišel napredek, poskusi spodletelše še enkrat
      if (registeredAny && failedPnp.size > 0) {
        for (const k of failedPnp.keys()) pending.add(k);
        failedPnp.clear();
        registeredAny = false;
      }
      continue;
    }
    // uspeh: registriraj
    poses.set(bestIdx, okPose);
    pending.delete(bestIdx);
    registeredOrder.push(bestIdx);
    registeredOrder.sort((u, v) => u - v);
    registeredAny = true;
    // triangulacija NOVIH točk: treki brez 3D, ki imajo zdaj opazavanje na bestIdx
    const Pn = Pof(bestIdx);
    for (const tr of trackDrafts) {
      if (tr.point3) continue;
      const oN = tr.observations.find((o) => o.imgIdx === bestIdx);
      if (!oN) continue;
      let partner: { imgIdx: number; obs: SfmObservation } | null = null;
      for (const r of registeredOrder) {
        if (r === bestIdx) continue;
        const oR = tr.observations.find((o) => o.imgIdx === r);
        if (oR) { partner = { imgIdx: r, obs: oR }; break; }
      }
      if (!partner) continue;
      const Pr = Pof(partner.imgIdx);
      const tri = triangulateDLT(Pn, Pr, { x: oN.x, y: oN.y }, { x: partner.obs.x, y: partner.obs.y });
      if (!tri || tri.errPx > SFM_DEFAULTS.trackMaxErrPx) continue;
      const poseN = poses.get(bestIdx)!;
      const poseR = poses.get(partner.imgIdx)!;
      if (!cheiral(poseN.R, poseN.t, tri.X)) continue;
      if (!cheiral(poseR.R, poseR.t, tri.X)) continue;
      tr.point3 = { x: tri.X[0], y: tri.X[1], z: tri.X[2] };
    }
  }

  // trajno spodleteli PnP (brez napredka za ponovni poskus) — eksplicitni razlog
  for (const [i, reason] of [...failedPnp.entries()].sort((u, v) => u[0] - v[0])) {
    if (!emitted.has(i)) {
      unregisteredOut.push({ imgIdx: i, reason });
      emitted.add(i);
    }
  }

  if (registeredOrder.length < 2) {
    return {
      ok: false, error: 'INSUFFICIENT_OVERLAP',
      message: 'NEZADOSTNI PODATKI: manj kot 2 fotki sta registrirani — rekonstrukcija ni možna. Posnemi fotke z večjim prekrivanjem.',
    };
  }

  // ── 7e) Alternacija: poze (PnP-GN čez VSA opazavanja) ⇄ točke (GN na točko)
  const trackObservationsOf = (imgIdx: number): PoseCorrespondence[] => {
    const list: PoseCorrespondence[] = [];
    for (const tr of trackDrafts) {
      if (!tr.point3) continue;
      const obs = tr.observations.find((o) => o.imgIdx === imgIdx);
      if (!obs) continue;
      list.push({ x: obs.x, y: obs.y, X: [tr.point3.x, tr.point3.y, tr.point3.z] });
    }
    return list;
  };

  const computeRms = (): number => {
    let sum = 0;
    let n = 0;
    for (const imgIdx of registeredOrder) {
      const P = Pof(imgIdx);
      for (const tr of trackDrafts) {
        if (!tr.point3) continue;
        const obs = tr.observations.find((o) => o.imgIdx === imgIdx);
        if (!obs) continue;
        const p = projectP(P, [tr.point3.x, tr.point3.y, tr.point3.z]);
        if (!p) continue;
        const dx = p.x - obs.x, dy = p.y - obs.y;
        sum += dx * dx + dy * dy;
        n++;
      }
    }
    return n > 0 ? Math.sqrt(sum / n) : 0;
  };

  let rms = computeRms();
  // Gabarit: obe kameri začetnega para sta FIKSNI (ia: R = I, t = 0; ib: poza
  // iz relativePose, |t| = 1). Skupaj pripnejo okvir IN merilo rekonstrukcije —
  // sicer alternacija drsi po gabaritu (točke globlje, |t| kamer ne sledi) in
  // notranje merilo postane nedoločeno (izmerjeno: globine ×1,49 pri |t| = 1).
  for (let round = 0; round < SFM_DEFAULTS.alternationRounds; round++) {
    // (i) poze (gabaritni par je fikszen) — ROBUSTNO: vsak rond uporabi samo
    // opazovanja z trenutno reprojekcijo ≤ trackMaxErrPx (izloči napačne
    // korespondence, sicer pokvarijo točke in poze v naslednjih rondeh)
    for (const imgIdx of registeredOrder) {
      if (imgIdx === ia || imgIdx === ib) continue;
      const corrs = trackObservationsOf(imgIdx);
      if (corrs.length < 6) continue;
      const pose = poses.get(imgIdx)!;
      const K = { f: focalPx, cx: images[imgIdx].width / 2, cy: images[imgIdx].height / 2 };
      const clean = corrs.filter((c) => {
        const r = reprojPx(pose.R, pose.t, K, c);
        return r !== null && r <= SFM_DEFAULTS.trackMaxErrPx;
      });
      if (clean.length < 6) continue;
      const ref = refinePoseGN(pose.R, pose.t, clean, K);
      poses.set(imgIdx, { R: ref.R, t: ref.t });
    }
    // (ii) točke — prav tako samo prek čistih pogledov (reprojekcija ≤ 3 px)
    for (const tr of trackDrafts) {
      if (!tr.point3) continue;
      const views: Array<{ P: number[]; x: number; y: number }> = [];
      for (const o of tr.observations) {
        const pose = poses.get(o.imgIdx);
        if (!pose) continue;
        const P = Pof(o.imgIdx);
        const p = projectP(P, [tr.point3.x, tr.point3.y, tr.point3.z]);
        if (!p) continue;
        if (Math.hypot(p.x - o.x, p.y - o.y) > SFM_DEFAULTS.trackMaxErrPx) continue;
        views.push({ P, x: o.x, y: o.y });
      }
      if (views.length < 2) continue;
      const X = refinePointGN([tr.point3.x, tr.point3.y, tr.point3.z], views);
      tr.point3 = { x: X[0], y: X[1], z: X[2] };
    }
    const rmsNew = computeRms();
    const improved = rms > 0 ? (rms - rmsNew) / rms : 0;
    rms = rmsNew;
    if (round >= 1 && improved < 1e-4) break;
  }

  // ── 7b) Poliranje (3 iteracije): sveža ponovna registracija ne-gabaritnih
  // kamer iz trenutnih točk + točkovni Gauss–Newton rond. Svež RANSAC lahko
  // ubeži slabu bazo PnP, v katero je pristal uvod; sprejme se samo
  // izboljšava RMS-ja — deterministično.
  for (let polish = 0; polish < 3; polish++) {
    for (const imgIdx of registeredOrder) {
      if (imgIdx === ia || imgIdx === ib) continue;
      const corrs = trackObservationsOf(imgIdx);
      if (corrs.length < 6) continue;
      const K = { f: focalPx, cx: images[imgIdx].width / 2, cy: images[imgIdx].height / 2 };
      const rmsOf = (R: number[], t: [number, number, number]): number => {
        let s = 0, n = 0;
        for (const c of corrs) {
          const r = reprojPx(R, t, K, c);
          if (r !== null) { s += r * r; n++; }
        }
        return n > 0 ? Math.sqrt(s / n) : Number.POSITIVE_INFINITY;
      };
      const cur = poses.get(imgIdx)!;
      const rmsBefore = rmsOf(cur.R, cur.t);
      const ransac = solvePoseRansac(corrs, K, lcg(7700 + imgIdx * 10 + polish), { thresholdPx: 2.5 });
      if (!ransac || ransac.inliers.length < 6) continue;
      const ref = refinePoseGN(ransac.R, ransac.t, ransac.inliers.map((i) => corrs[i]), K);
      if (rmsOf(ref.R, ref.t) < rmsBefore) {
        poses.set(imgIdx, { R: ref.R, t: ref.t });
      }
    }
    // točkovni rond (robustno, kot v alternaciji)
    for (const tr of trackDrafts) {
      if (!tr.point3) continue;
      const views: Array<{ P: number[]; x: number; y: number }> = [];
      for (const o of tr.observations) {
        const pose = poses.get(o.imgIdx);
        if (!pose) continue;
        const P = Pof(o.imgIdx);
        const p = projectP(P, [tr.point3.x, tr.point3.y, tr.point3.z]);
        if (!p) continue;
        if (Math.hypot(p.x - o.x, p.y - o.y) > SFM_DEFAULTS.trackMaxErrPx) continue;
        views.push({ P, x: o.x, y: o.y });
      }
      if (views.length < 2) continue;
      const X = refinePointGN([tr.point3.x, tr.point3.y, tr.point3.z], views);
      tr.point3 = { x: X[0], y: X[1], z: X[2] };
    }
  }

  // ── 8) Končna poročila (deterministična, kanonično urejena)
  const tracks: SfmTrack[] = trackDrafts.map((tr, id) => {
    let sum = 0;
    let n = 0;
    if (tr.point3) {
      for (const o of tr.observations) {
        if (!poses.has(o.imgIdx)) continue;
        const p = projectP(Pof(o.imgIdx), [tr.point3.x, tr.point3.y, tr.point3.z]);
        if (!p) continue;
        sum += (p.x - o.x) * (p.x - o.x) + (p.y - o.y) * (p.y - o.y);
        n++;
      }
    }
    const meanRes = n > 0 ? Math.sqrt(sum / n) : Number.POSITIVE_INFINITY;
    return {
      id,
      observations: tr.observations.slice().sort((u, v) => u.imgIdx - v.imgIdx),
      point3: tr.point3,
      inlier: tr.point3 !== null && meanRes <= SFM_DEFAULTS.trackMaxErrPx,
    };
  });

  const registered: SfmRegistered[] = registeredOrder.map((imgIdx) => {
    let sum = 0;
    let n = 0;
    for (const tr of trackDrafts) {
      if (!tr.point3) continue;
      const obs = tr.observations.find((o) => o.imgIdx === imgIdx);
      if (!obs) continue;
      const p = projectP(Pof(imgIdx), [tr.point3.x, tr.point3.y, tr.point3.z]);
      if (!p) continue;
      sum += (p.x - obs.x) * (p.x - obs.x) + (p.y - obs.y) * (p.y - obs.y);
      n++;
    }
    return {
      imgIdx,
      R: poses.get(imgIdx)!.R.slice(),
      t: { x: poses.get(imgIdx)!.t[0], y: poses.get(imgIdx)!.t[1], z: poses.get(imgIdx)!.t[2] },
      inliers: n,
      reprojRmsPx: n > 0 ? Math.sqrt(sum / n) : 0,
    };
  }).sort((u, v) => u.imgIdx - v.imgIdx);

  const unregisteredSorted = unregisteredOut.slice().sort((u, v) => u.imgIdx - v.imgIdx);
  for (const u of unregisteredSorted) {
    const nm = images[u.imgIdx].name;
    warnings.push(`Fotka ${u.imgIdx} (${nm}) ni registrirana: ${u.reason}`);
  }

  if (rms > SFM_DEFAULTS.trackMaxErrPx) {
    warnings.push(`Reprojekcijska napaka visoka (RMS ${rms.toFixed(1)} px > ${SFM_DEFAULTS.trackMaxErrPx} px) — geometrija ni zanesljiva, mere so samo orientacijske. Posnemi nove fotke z boljšim prekrivanjem, ostrostjo in fiksnim zoomom.`);
  }
  if (!Number.isFinite(rms)) {
    return {
      ok: false, error: 'REPROJECTION_HIGH',
      message: 'NEZADOSTNI PODATKI: reprojekcijska residuala rekonstrukcije ni končna (degenerirana geometrija) — rezultat je zavržen.',
    };
  }

  const minPerImageInliers = registered.length > 0 ? Math.min(...registered.map((r) => r.inliers)) : 0;
  const status = validateSfm({
    registeredCount: registered.length,
    totalImages: N,
    minPerImageInliers,
    reprojRmsPx: rms,
    focalSource,
    hasScale: false, // merilo nastane šele z referenco (resolveReferenceAndMeasures)
    warnings,
  });

  return {
    ok: true,
    registered,
    unregistered: unregisteredSorted,
    tracks,
    focalPx,
    focalSource,
    reprojRmsPx: rms,
    scaleCmPerUnit: null,
    status,
    warnings,
  };
}

// ─── Referenca + meritve (deterministično, filozofija obstoječega klika) ──

export interface SfmClick {
  imgIdx: number;
  x: number;
  y: number;
}

export interface SfmResolvedClick {
  clickIdx: number;
  imgIdx: number;
  x: number;
  y: number;
  /** Treka, na katero se je klik priklepal (null = brez opazavanja v radiju). */
  trackId: number | null;
  /** Razdalja klika do opazavanja (px); null, če se ni priklepal. */
  distPx: number | null;
  /** 3D točka treka (null = treka ni trijangulirana). */
  point3: { x: number; y: number; z: number } | null;
  /** true = klik uporaben za referenco/meritve. */
  usable: boolean;
  /** Slovenski razlog, če NI uporaben. */
  reason: string | null;
}

export interface SfmDistanceCm {
  fromClick: number;
  toClick: number;
  cm: number;
}

export interface SfmExcludedDistance {
  fromClick: number;
  toClick: number;
  reason: string;
}

export interface SfmMeasureResult {
  /** Posodobljen SfmResult (nova kopija: scaleCmPerUnit, status, warnings). */
  sfm: SfmResult;
  scaleCmPerUnit: number | null;
  /** Referenčni par (indeksa klikov) — null, če referenca ni uspela. */
  refPair: { clickA: number; clickB: number; trackIdA: number; trackIdB: number } | null;
  /** Slovenski razlog, če referenca NI uspela. */
  refError: string | null;
  /** Vsi kliki z izidom priklepa (iskreno, tudi neuspele). */
  clicks: SfmResolvedClick[];
  /** Verižne razdalje med zaporednima rešenima 3D točkama (cm, zaokroženo na 0,1). */
  distancesCm: SfmDistanceCm[];
  /** Zaporedna para, ki NISTA izračunana — z eksplicitnim razlogom. */
  excludedDistances: SfmExcludedDistance[];
  warnings: string[];
}

/**
 * Priklep klikov na treke + referenčna dolžina → merilo (cm/enoto) → verižne
 * 3D razdalje. Klik se priklepe na NAJBLIŽJE opazavanje treka v radiju 12 px
 * na registrirani fotki (tie: nižji id treka). Klik brez priklepa oz. treka
 * brez 3D točke je EKSPPLICITNO javljen — ničesar ne izmislimo. Merilo nastane
 * SAMO iz para trekov z znano 3D razdaljo (refCm / |Xa − Xb|).
 */
export function resolveReferenceAndMeasures(
  sfm: SfmResult,
  clicks: SfmClick[],
  refPairIdx: [number, number] | null,
  refCm: number,
): SfmMeasureResult {
  const warnings: string[] = [];
  if (!sfm.ok) {
    return {
      sfm,
      scaleCmPerUnit: null,
      refPair: null,
      refError: `NEZADOSTNI PODATKI: SfM ni uspel (${sfm.error}) — ${sfm.message}`,
      clicks: [],
      distancesCm: [],
      excludedDistances: [],
      warnings,
    };
  }
  if (!Number.isFinite(refCm) || refCm <= 0) {
    return {
      sfm,
      scaleCmPerUnit: null,
      refPair: null,
      refError: `NEZADOSTNI PODATKI: referenčna dolžina je neveljavna (${String(refCm)} cm).`,
      clicks: [],
      distancesCm: [],
      excludedDistances: [],
      warnings,
    };
  }

  // 1) priklep klikov (najbližje opazavanje v radiju, tie → nižji id treka)
  const resolved: SfmResolvedClick[] = clicks.map((cl, clickIdx) => {
    const reg = sfm.registered.find((r) => r.imgIdx === cl.imgIdx);
    if (!reg) {
      return {
        clickIdx, imgIdx: cl.imgIdx, x: cl.x, y: cl.y,
        trackId: null, distPx: null, point3: null, usable: false,
        reason: `Fotka ${cl.imgIdx} ni registrirana — klik ni uporabljen.`,
      };
    }
    let bestTrack: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const tr of sfm.tracks) {
      for (const o of tr.observations) {
        if (o.imgIdx !== cl.imgIdx) continue;
        const d = Math.hypot(o.x - cl.x, o.y - cl.y);
        if (d <= SFM_DEFAULTS.clickRadiusPx && d < bestDist) {
          bestDist = d;
          bestTrack = tr.id;
        }
      }
    }
    if (bestTrack === null) {
      return {
        clickIdx, imgIdx: cl.imgIdx, x: cl.x, y: cl.y,
        trackId: null, distPx: null, point3: null, usable: false,
        reason: `V radiju ${SFM_DEFAULTS.clickRadiusPx} px ni opazavanja treka — klik ostane nerešen.`,
      };
    }
    const tr = sfm.tracks[bestTrack];
    const point3 = tr.point3 ? { ...tr.point3 } : null;
    const usable = point3 !== null;
    return {
      clickIdx, imgIdx: cl.imgIdx, x: cl.x, y: cl.y,
      trackId: bestTrack, distPx: bestDist, point3, usable,
      reason: usable ? null : 'Treka se je priklepala, a nima 3D točke (ni trijangulirana) — klik ni uporabljen.',
    };
  });

  const unresolved = resolved.filter((r) => !r.usable);
  for (const u of unresolved) {
    warnings.push(`Klik ${u.clickIdx} (fotka ${u.imgIdx} na ${u.x.toFixed(0)}, ${u.y.toFixed(0)}) ni uporabljen: ${u.reason}`);
  }

  // 2) referenca → merilo
  let scale: number | null = null;
  let refPair: SfmMeasureResult['refPair'] = null;
  let refError: string | null = null;
  if (!refPairIdx) {
    refError = 'NEZADOSTNI PODATKI: manjka referenčni par klikov — merilo v cm ni izračunljivo, samo razmerja.';
  } else {
    const [ia, ib] = refPairIdx;
    const ra = resolved[ia];
    const rb = resolved[ib];
    if (!ra || !rb) {
      refError = 'NEZADOSTNI PODATKI: referenčni indeks klika ne obstaja.';
    } else if (!ra.usable || !rb.usable || !ra.point3 || !rb.point3) {
      refError = 'NEZADOSTNI PODATKI: referenčni klik se ni priklepal na trijangulirano 3D točko — merilo v cm ni izračunljivo.';
    } else {
      const len = Math.hypot(rb.point3.x - ra.point3.x, rb.point3.y - ra.point3.y, rb.point3.z - ra.point3.z);
      if (!(len > 1e-9)) {
        refError = 'NEZADOSTNI PODATKI: referenčni točki sta v prostoru praktično ista točka — merilo ni izračunljivo.';
      } else {
        scale = refCm / len;
        refPair = { clickA: ia, clickB: ib, trackIdA: ra.trackId!, trackIdB: rb.trackId! };
      }
    }
  }
  if (refError) warnings.push(refError);
  else if (scale !== null) warnings.push(`Merilo nastavljeno po referenčni dolžini ${refCm} cm: ${scale.toFixed(4)} cm/enoto rekonstrukcije.`);

  // 3) verižne razdalje med zaporednimi rešenimi 3D točkami
  const distancesCm: SfmDistanceCm[] = [];
  const excludedDistances: SfmExcludedDistance[] = [];
  for (let k = 0; k + 1 < resolved.length; k++) {
    const ra = resolved[k];
    const rb = resolved[k + 1];
    if (!ra.usable || !rb.usable || !ra.point3 || !rb.point3) {
      excludedDistances.push({
        fromClick: k, toClick: k + 1,
        reason: `Razdalja ${k}–${k + 1} ni izračunana: ${!ra.usable ? `klik ${k} nerešen` : ''}${!ra.usable && !rb.usable ? '; ' : ''}${!rb.usable ? `klik ${k + 1} nerešen` : ''}.`,
      });
      continue;
    }
    if (scale === null) {
      excludedDistances.push({
        fromClick: k, toClick: k + 1,
        reason: `Razdalja ${k}–${k + 1} ni izračunana: manjka merilo (referenčna dolžina).`,
      });
      continue;
    }
    const d = Math.hypot(rb.point3.x - ra.point3.x, rb.point3.y - ra.point3.y, rb.point3.z - ra.point3.z) * scale;
    distancesCm.push({ fromClick: k, toClick: k + 1, cm: Math.round(d * 10) / 10 });
  }
  for (const ex of excludedDistances) warnings.push(ex.reason);

  // 4) posodobljen sfm (nova kopija — čista funkcija)
  const minPerImageInliers = sfm.registered.length > 0 ? Math.min(...sfm.registered.map((r) => r.inliers)) : 0;
  const updatedStatus = validateSfm({
    registeredCount: sfm.registered.length,
    totalImages: sfm.registered.length + sfm.unregistered.length,
    minPerImageInliers,
    reprojRmsPx: sfm.reprojRmsPx,
    focalSource: sfm.focalSource,
    hasScale: scale !== null,
    warnings,
  });
  const updatedSfm: SfmResult = {
    ...sfm,
    scaleCmPerUnit: scale,
    status: updatedStatus,
    warnings: [...sfm.warnings, ...warnings],
  };

  return {
    sfm: updatedSfm,
    scaleCmPerUnit: scale,
    refPair,
    refError,
    clicks: resolved,
    distancesCm,
    excludedDistances,
    warnings,
  };
}

// ─── Pomočnik za UI: slovenske razlage stanja ─────────────────

/**
 * Človeku berljive slovenske vrstice o stanju SfM (status, fokus, merilo,
 * neregistrirane fotke, opozorila). Determinističen vrstni red.
 */
export function explainSfm(sfm: SfmResult): string[] {
  if (!sfm.ok) {
    return [`SfM NI uspel (${sfm.error}): ${sfm.message}`];
  }
  const lines: string[] = [];
  const total = sfm.registered.length + sfm.unregistered.length;
  lines.push(`SfM: registriranih ${sfm.registered.length}/${total} fotk.`);
  const focalLabel = sfm.focalSource === 'known'
    ? 'znan (EXIF/naprava)'
    : sfm.focalSource === 'preset'
      ? 'preset (ocena)'
      : 'ocenjen iz fotk (samokalibracija — samo orientacijsko)';
  lines.push(`Fokus: ${sfm.focalPx.toFixed(0)} px (${focalLabel}).`);
  lines.push(`Reprojekcijska napaka (RMS): ${sfm.reprojRmsPx.toFixed(2)} px.`);
  if (sfm.scaleCmPerUnit !== null) {
    lines.push(`Merilo: ${sfm.scaleCmPerUnit.toFixed(4)} cm/enoto rekonstrukcije.`);
  } else {
    lines.push('Merilo: NI nastavljeno — manjka znana referenčna dolžina (mere v cm ne obstajajo).');
  }
  for (const u of sfm.unregistered) {
    lines.push(`Fotka ${u.imgIdx} ni registrirana: ${u.reason}`);
  }
  lines.push(`Status: ${sfm.status.message}`);
  lines.push(`Naslednji korak: ${sfm.status.nextStep}`);
  for (const w of sfm.warnings) lines.push(`Opozorilo: ${w}`);
  return lines;
}
