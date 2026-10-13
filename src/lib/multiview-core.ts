// ─── Klasična fotogrametrija iz več fotk (deterministično jedro, ROKSAL Faza 3) ──
// Čista geometrija + klasična obdelava slik: Shi-Tomasi vogalne točke, NCC
// ujemanje, Hartley-normalizirani 8-točkovni algoritem + RANSAC za
// fundamentalno matriko, Hartley/Kruppa samokalibracija fokusa, DLT
// triangulacija in relativna poza iz esencialne matrike.
//
// 0 AI, 0 omrežja, 0 canvasa, 0 novih odvisnosti — vse lastne implementacije
// (idejno po COLMAP/HOVER, koda je lastna). Vsota osnovnih operacij: Jacobi
// lastne vrednosti za simetrične matrike (AᵀA) — SVD 3×3 iz Jacobijevega
// razcepa, brez knjižnic.
//
// Iskrenost: degenerirani oz. manjkajoči podatki so EKSPPLICITNE napake
// (null / code 'DEGENERATE_GEOMETRY' / opozorila v slovenščini) — NIKOLI
// tihi privzetki. Vse funkcije so čiste in deterministične (enaki vhodi →
// identični izhodi; RANSAC vzorca prek podanega determinističnega RNG).
//
// Konvencije: matrike row-major (F, R: 9 števil; P: 12 števil; t: 3 števila).
// Epipolarna konvencija (Hartley & Zisserman): x2ᵀ·F·x1 = 0,
// E = [t]×·R, x2 ~ K·(R·X + t).

import type { ImgData, XY } from './photo-replace-core';

export const MULTIVIEW_SCRIPT_VERSION = '1.0.0';

/** Vogalna točka (px + Shi-Tomasi score λ2). */
export interface Corner { x: number; y: number; score: number }
/** Ujemanje: indeks vogala v A, indeks vogala v B, NCC koeficient. */
export interface MVMatch { ai: number; bi: number; ncc: number }
/** Fundamentalna matrika + RANSAC inlierji + srednja Sampsonova residuala (px, čez VSE pare). */
export interface FundamentalResult { F: number[]; inliers: number[]; meanResidualPx: number }

// ─── Notranje: majhne matrike (row-major) ────────────────────

/** Transponiraj 3×3. */
function transpose3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Zmnoži 3×3 · 3×3. */
function mul3(a: number[], b: number[]): number[] {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

/** Uporabi 3×3 na vektor. */
function apply3(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function det3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Frobeniusova norma 3×3. */
function frob3(m: number[]): number {
  let s = 0;
  for (let i = 0; i < 9; i++) s += m[i] * m[i];
  return Math.sqrt(s);
}

/** Vse komponente končne? */
function allFinite(v: ArrayLike<number>): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}

/**
 * Ciklični Jacobi lastne vrednosti in vektorjev za SIMETRIČNO matriko
 * (determinističen fiksni vrstni red rotacij; vhod se notranje skalira z
 * maksimalno absolutno vrednostjo, da so protiščila neodvisna od skale).
 * Vrne lastne vrednosti + lastne vektorje kot STOLPCE (neurejene).
 */
function jacobiEigen(mIn: number[][]): { values: number[]; vectors: number[][] } {
  const n = mIn.length;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = mIn[i][j];
      if (!Number.isFinite(v)) return { values: new Array(n).fill(NaN), vectors: [] };
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
    }
  }
  const a: number[][] = maxAbs > 0
    ? mIn.map((row) => row.map((v) => v / maxAbs))
    : mIn.map((row) => row.slice());
  const v: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    v.push(row);
  }
  if (maxAbs === 0) {
    return { values: new Array(n).fill(0), vectors: v };
  }
  for (let sweep = 0; sweep < 100; sweep++) {
    let sm = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) sm += Math.abs(a[p][q]);
    if (sm < 1e-14) break;
    const tresh = sweep < 3 ? 0.2 * sm / (n * n) : 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        const g = 100 * Math.abs(apq);
        if (sweep > 3 && Math.abs(a[p][p]) + g === Math.abs(a[p][p]) && Math.abs(a[q][q]) + g === Math.abs(a[q][q])) {
          a[p][q] = 0;
        } else if (Math.abs(apq) > tresh) {
          const h = a[q][q] - a[p][p];
          let t: number;
          if (Math.abs(h) + g === Math.abs(h)) {
            t = apq / h;
          } else {
            const theta = 0.5 * h / apq;
            t = 1 / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
            if (theta < 0) t = -t;
          }
          const c = 1 / Math.sqrt(1 + t * t);
          const s = t * c;
          const tau = s / (1 + c);
          const h2 = t * apq;
          a[p][p] -= h2;
          a[q][q] += h2;
          a[p][q] = 0;
          // rotacija matrike a (stolpca p, q)
          for (let i = 0; i < p; i++) {
            const gip = a[i][p], hiq = a[i][q];
            a[i][p] = gip - s * (hiq + gip * tau);
            a[i][q] = hiq + s * (gip - hiq * tau);
          }
          for (let i = p + 1; i < q; i++) {
            const gpi = a[p][i], hiq = a[i][q];
            a[p][i] = gpi - s * (hiq + gpi * tau);
            a[i][q] = hiq + s * (gpi - hiq * tau);
          }
          for (let i = q + 1; i < n; i++) {
            const gpi = a[p][i], hqi = a[q][i];
            a[p][i] = gpi - s * (hqi + gpi * tau);
            a[q][i] = hqi + s * (gpi - hqi * tau);
          }
          // rotacija vektorjev (stolpca p, q)
          for (let i = 0; i < n; i++) {
            const gip = v[i][p], hiq = v[i][q];
            v[i][p] = gip - s * (hiq + gip * tau);
            v[i][q] = hiq + s * (gip - hiq * tau);
          }
        }
      }
    }
  }
  const values = a.map((row, i) => row[i] * maxAbs);
  return { values, vectors: v };
}

/** Indeksi, urejeni po lastnih vrednostih PADajoče. */
function orderDesc(values: number[]): number[] {
  return values.map((val, i) => ({ val, i })).sort((u, w) => (u.val === w.val ? u.i - w.i : w.val - u.val)).map((o) => o.i);
}

/**
 * SVD 3×3 iz dveh Jacobijevih razcepov (mᵀm in m·mᵀ) — brez knjižnic.
 * Posamezni vektorji so skladni po konstrukciji: u_i = m·v_i / s_i, zato
 * razveljaven tudi pri ponovljenih singularnih vrednostih.
 * Vrne U (stolpci), s padajoče, V (stolpci); m = U·diag(s)·Vᵀ.
 */
function svd3(m: number[]): { U: [number, number, number][]; s: number[]; V: [number, number, number][] } | null {
  if (!allFinite(m)) return null;
  // G = mᵀ·m (simetrična)
  const G: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) G[i][j] = m[i] * m[j] + m[3 + i] * m[3 + j] + m[6 + i] * m[6 + j];
  const eg = jacobiEigen(G);
  if (eg.vectors.length === 0) return null;
  const ord = orderDesc(eg.values);
  const V: [number, number, number][] = ord.map((k) => [eg.vectors[0][k], eg.vectors[1][k], eg.vectors[2][k]]);
  const s = ord.map((k) => Math.sqrt(Math.max(eg.values[k], 0)));
  const mv = [apply3(m, V[0]), apply3(m, V[1]), apply3(m, V[2])];
  const U: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    if (s[i] > 1e-12 * (s[0] + 1e-300)) {
      const u: [number, number, number] = [mv[i][0] / s[i], mv[i][1] / s[i], mv[i][2] / s[i]];
      const nu = Math.hypot(u[0], u[1], u[2]);
      U[i] = nu > 0 ? [u[0] / nu, u[1] / nu, u[2] / nu] : [1, 0, 0];
    } else {
      // singularna smer: deterministično dopolni ortogonalno
      const prev = U[0][0] !== 0 || U[0][1] !== 0 || U[0][2] !== 0 ? U[0] : [1, 0, 0] as [number, number, number];
      const other: [number, number, number] = Math.abs(prev[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const c = cross3(prev, other);
      const nc = Math.hypot(c[0], c[1], c[2]);
      U[i] = nc > 0 ? [c[0] / nc, c[1] / nc, c[2] / nc] : [0, 0, 1];
    }
  }
  return { U, s, V };
}

/**
 * Vsili rank 2 na fundamentalno matriko: SVD 3×3, izniči najmanjšo
 * singularno vrednost. Vrne null, če je F praktično rank ≤ 1 (singularno).
 */
function enforceRank2(F: number[]): number[] | null {
  const sv = svd3(F);
  if (!sv) return null;
  if (!Number.isFinite(sv.s[0]) || sv.s[0] < 1e-10 || sv.s[1] < 1e-8 * sv.s[0]) return null;
  const out = new Array<number>(9).fill(0);
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] += sv.s[k] * sv.U[k][i] * sv.V[k][j];
      }
    }
  }
  return allFinite(out) ? out : null;
}

/** Normaliziraj F: Frobeniusova norma 1, predznak takšen, da je element z največjo |vrednostjo| pozitiven. */
function normalizeF(F: number[]): number[] {
  const n = frob3(F);
  if (!(n > 0) || !Number.isFinite(n)) return F.slice();
  const out = F.map((v) => v / n);
  let maxI = 0;
  for (let i = 1; i < 9; i++) if (Math.abs(out[i]) > Math.abs(out[maxI])) maxI = i;
  if (out[maxI] < 0) for (let i = 0; i < 9; i++) out[i] = -out[i];
  return out;
}

// ─── 1) Siva slika (Rec.709 luma, 0..1) ──────────────────────

/** Rec.709 luminenca (0.2126 R + 0.7152 G + 0.0722 B), normalizirana na 0..1. */
export function toGrayscale(img: ImgData): Float64Array {
  if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) {
    throw new Error('NEZADOSTNI PODATKI: neveljavna slika (dimenzije manjkajo oz. so neveljavne).');
  }
  const n = img.width * img.height;
  const out = new Float64Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  }
  return out;
}

// ─── 2) Shi-Tomasi vogalne točke ─────────────────────────────

/**
 * Shi-Tomasi (Good Features to Track): strukturni tenzor po oknu
 * (centralne diferenence), score = λ2 (manjša lastna vrednost).
 * Prag quality relativno na maksimalni score, grid non-max suppression
 * z minDistancePx ( pohlepno, kandidati urejeni score desc → y asc → x asc,
 * sprejemi do maxCorners). Deterministično.
 */
export function findCorners(
  gray: Float64Array,
  w: number,
  h: number,
  opts?: { maxCorners?: number; quality?: number; minDistancePx?: number; window?: number },
): Corner[] {
  const maxCorners = opts?.maxCorners ?? 600;
  const quality = opts?.quality ?? 0.01;
  const minDist = opts?.minDistancePx ?? 12;
  const window = opts?.window ?? 5;
  if (!(window >= 1) || window % 2 === 0) throw new Error('NEZADOSTNI PODATKI: window mora biti liho pozitivno število.');
  const half = (window - 1) / 2;
  if (w < window + 2 || h < window + 2) return [];
  // centralne diferenence
  const ix = new Float64Array(w * h);
  const iy = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      ix[i] = (gray[i + 1] - gray[i - 1]) / 2;
      iy[i] = (gray[i + w] - gray[i - w]) / 2;
    }
  }
  // strukturni tenzor + λ2
  const scores = new Float64Array(w * h);
  let maxScore = 0;
  const x0 = half + 1, x1 = w - 2 - half, y0 = half + 1, y1 = h - 2 - half;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let sa = 0, sb = 0, sc = 0;
      for (let dy = -half; dy <= half; dy++) {
        const row = (y + dy) * w;
        for (let dx = -half; dx <= half; dx++) {
          const i = row + x + dx;
          const gx = ix[i], gy = iy[i];
          sa += gx * gx;
          sb += gy * gy;
          sc += gx * gy;
        }
      }
      const tr = sa + sb;
      const diff = sa - sb;
      const l2 = (tr - Math.sqrt(diff * diff + 4 * sc * sc)) / 2;
      scores[y * w + x] = l2;
      if (l2 > maxScore) maxScore = l2;
    }
  }
  if (!(maxScore > 0)) return [];
  const thr = quality * maxScore;
  const cands: Corner[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = scores[y * w + x];
      if (s > thr) cands.push({ x, y, score: s });
    }
  }
  cands.sort((u, v) => {
    if (u.score !== v.score) return v.score - u.score;
    if (u.y !== v.y) return u.y - v.y;
    return u.x - v.x;
  });
  // grid non-max suppression: pohlepno z minimalno razdaljo
  const accepted: Corner[] = [];
  const min2 = minDist * minDist;
  for (const c of cands) {
    if (accepted.length >= maxCorners) break;
    let ok = true;
    for (const a of accepted) {
      const dx = c.x - a.x, dy = c.y - a.y;
      if (dx * dx + dy * dy < min2) { ok = false; break; }
    }
    if (ok) accepted.push(c);
  }
  return accepted;
}

// ─── 3) Deskriptorji: mean-normaliziran patch ────────────────

/**
 * Deskriptor = mean-normaliziran patch (privzeto 9×9 = 81 vrednosti).
 * Null, če patch sega čez rob slike. Plošč patch → ničelni vektor
 * (NCC bo 0 — takšne točke se ne ujemajo).
 */
export function buildDescriptors(
  gray: Float64Array,
  w: number,
  h: number,
  corners: Corner[],
  patch = 9,
): (Float64Array | null)[] {
  if (!Number.isInteger(patch) || patch < 1 || patch % 2 === 0) {
    throw new Error('NEZADOSTNI PODATKI: patch mora biti liho pozitivno število.');
  }
  const half = (patch - 1) / 2;
  const out: (Float64Array | null)[] = [];
  for (const c of corners) {
    const px = Math.round(c.x), py = Math.round(c.y);
    const sx = px - half, sy = py - half;
    if (sx < 0 || sy < 0 || sx + patch > w || sy + patch > h) { out.push(null); continue; }
    const d = new Float64Array(patch * patch);
    let mean = 0;
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const val = gray[(sy + dy) * w + sx + dx];
        d[dy * patch + dx] = val;
        mean += val;
      }
    }
    mean /= patch * patch;
    for (let i = 0; i < d.length; i++) d[i] -= mean;
    out.push(d);
  }
  return out;
}

/** NCC dveh mean-normaliziranih deskriptorjev (= Pearson korelacija). */
function nccDesc(a: Float64Array, b: Float64Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / Math.sqrt(na * nb);
}

// ─── 4) Ujemanje: NCC + mutual best ──────────────────────────

/**
 * Ujemanje deskriptorjev: NCC + medsebojni najboljši (mutual best),
 * prag minNcc, Lowe-jev ratio test (razlika med najboljšim in
 * drugim-najboljšim NCC ≥ ratioMargin — zavre dvoumna ujemanja pri
 * ponavljajoči se teksturi) in filter premikov maxDisplacementPct %
 * večje dimenzije. Izenačeni NCC → nižji bi (deterministično: stroje >
 * pri izboljšavi).
 */
export function matchFeatures(
  cornersA: Corner[],
  descA: (Float64Array | null)[],
  cornersB: Corner[],
  descB: (Float64Array | null)[],
  sizeA: { width: number; height: number },
  sizeB: { width: number; height: number },
  opts?: { minNcc?: number; maxDisplacementPct?: number; ratioMargin?: number },
): MVMatch[] {
  const minNcc = opts?.minNcc ?? 0.86;
  const pct = opts?.maxDisplacementPct ?? 20;
  const ratioMargin = opts?.ratioMargin ?? 0.03;
  const maxDim = Math.max(sizeA.width, sizeA.height, sizeB.width, sizeB.height);
  const maxDisp = (pct / 100) * maxDim;
  const nA = Math.min(cornersA.length, descA.length);
  const nB = Math.min(cornersB.length, descB.length);
  const bestB = new Int32Array(nA).fill(-1);
  const bestNccB = new Float64Array(nA).fill(-1);
  const secondNccB = new Float64Array(nA).fill(-1);
  const bestA = new Int32Array(nB).fill(-1);
  const bestNccA = new Float64Array(nB).fill(-1);
  for (let i = 0; i < nA; i++) {
    const da = descA[i];
    if (!da) continue;
    const ca = cornersA[i];
    for (let j = 0; j < nB; j++) {
      const db = descB[j];
      if (!db) continue;
      const cb = cornersB[j];
      const dx = cb.x - ca.x, dy = cb.y - ca.y;
      if (Math.hypot(dx, dy) > maxDisp) continue;
      const ncc = nccDesc(da, db);
      if (ncc > bestNccB[i]) { secondNccB[i] = bestNccB[i]; bestNccB[i] = ncc; bestB[i] = j; }
      else if (ncc > secondNccB[i]) { secondNccB[i] = ncc; }
      if (ncc > bestNccA[j]) { bestNccA[j] = ncc; bestA[j] = i; }
    }
  }
  const matches: MVMatch[] = [];
  for (let i = 0; i < nA; i++) {
    const j = bestB[i];
    if (j < 0) continue;
    if (bestA[j] !== i) continue;
    if (bestNccB[i] < minNcc) continue;
    // Lowe-jev ratio test: če obstaja konkurenčen kandidat s podobnim NCC,
    // je ujemanje dvoumno (ponavljajoča se tekstura) → zavrnjeno.
    if (secondNccB[i] > 0 && bestNccB[i] - secondNccB[i] < ratioMargin) continue;
    matches.push({ ai: i, bi: j, ncc: bestNccB[i] });
  }
  return matches;
}

// ─── 5) Deterministični RNG (mulberry32) ─────────────────────

/**
 * Deterministični generator psevdonaključnih števil mulberry32:
 * seed → vedno enako zaporedje v [0, 1).
 */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 6) Sampsonova razdalja (px) ─────────────────────────────

/**
 * Sampsonova geometrijska residuala v pikslih (skalno invariantna):
 * |x2ᵀFx1| / sqrt((Fᵀx2)₁² + (Fᵀx2)₂² + (Fx1)₁² + (Fx1)₂²).
 */
export function sampsonResidualPx(F: number[], pA: XY, pB: XY): number {
  const ax = pA.x, ay = pA.y, bx = pB.x, by = pB.y;
  const lx = F[0] * ax + F[1] * ay + F[2];   // (F·x1)₁
  const ly = F[3] * ax + F[4] * ay + F[5];   // (F·x1)₂
  const num = bx * lx + by * ly + (F[6] * ax + F[7] * ay + F[8]);
  const m0 = F[0] * bx + F[3] * by + F[6];   // (Fᵀ·x2)₁
  const m1 = F[1] * bx + F[4] * by + F[7];   // (Fᵀ·x2)₂
  const den = m0 * m0 + m1 * m1 + lx * lx + ly * ly;
  if (den < 1e-15) return num === 0 ? 0 : 1e9;
  return Math.abs(num) / Math.sqrt(den);
}

// ─── 7) Fundamentalna matrika: 8-točkovni + RANSAC ───────────

/** Hartley normalizacija oblaka točk: težišče v izhodišče, povprečna razdalja √2. */
function hartleyNormalize(pts: XY[]): { T: number[]; norm: XY[] } | null {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - cx, p.y - cy);
  d /= n;
  if (!(d > 1e-9)) return null;
  const s = Math.SQRT2 / d;
  const T = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const norm = pts.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) }));
  return { T, norm };
}

/** Ali so točke (praktično) kolinearne → 8-točkovni algoritem degeneriran. */
function collinear(pts: XY[]): boolean {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const tr = sxx + syy;
  const diff = sxx - syy;
  const l2 = (tr - Math.sqrt(diff * diff + 4 * sxy * sxy)) / 2;
  const l1 = (tr + Math.sqrt(diff * diff + 4 * sxy * sxy)) / 2;
  if (l1 < 1e-12) return true; // vse točke praktično identične
  return l2 < 1e-9 * l1;
}

/** Reši 8-točkovni sistem (normalizirano) → F (rank 2, Frobenius 1) ali null. */
function solveEightPoint(sa: XY[], sb: XY[], Ta: number[], Tb: number[]): number[] | null {
  // M = AᵀA (9×9), A vrstica: [bx·ax, bx·ay, bx, by·ax, by·ay, by, ax, ay, 1]
  const M: number[][] = [];
  for (let i = 0; i < 9; i++) M.push(new Array<number>(9).fill(0));
  for (let k = 0; k < 8; k++) {
    const ax = sa[k].x, ay = sa[k].y, bx = sb[k].x, by = sb[k].y;
    const r = [bx * ax, bx * ay, bx, by * ax, by * ay, by, ax, ay, 1];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) M[i][j] += r[i] * r[j];
  }
  const eg = jacobiEigen(M);
  if (eg.vectors.length === 0) return null;
  let minI = 0;
  for (let i = 1; i < 9; i++) if (eg.values[i] < eg.values[minI]) minI = i;
  const f = [eg.vectors[0][minI], eg.vectors[1][minI], eg.vectors[2][minI],
    eg.vectors[3][minI], eg.vectors[4][minI], eg.vectors[5][minI],
    eg.vectors[6][minI], eg.vectors[7][minI], eg.vectors[8][minI]];
  if (!allFinite(f)) return null;
  const Fn = enforceRank2(f);
  if (!Fn) return null;
  // denormalizacija: F = T_Bᵀ · F_n · T_A
  const F = mul3(transpose3(Tb), mul3(Fn, Ta));
  if (!allFinite(F) || !(frob3(F) > 1e-15)) return null;
  return normalizeF(F);
}

/**
 * Fundamentalna matrika: Hartley-normalizirani 8-točkovni algoritem +
 * RANSAC (Sampsonov prag). Deterministično: vzorci prek podanega rand.
 * meanResidualPx = srednja Sampsonova residuala čez VSE pare (iskren
 * signal raztresenosti ujemanj, ne samo inlierjev). Null pri < 8 unikatnih
 * parov, kolinearnih točkah oz. če vsi poskusi singularni.
 */
export function estimateFundamental(
  wA: number, hA: number, wB: number, hB: number,
  ptsA: XY[], ptsB: XY[],
  rand: () => number,
  opts?: { iters?: number; thresholdPx?: number },
): FundamentalResult | null {
  const iters = opts?.iters ?? 600;
  const thr = opts?.thresholdPx ?? 2;
  if (!Number.isFinite(wA) || !Number.isFinite(hA) || !Number.isFinite(wB) || !Number.isFinite(hB)) return null;
  if (wA < 1 || hA < 1 || wB < 1 || hB < 1) return null;
  if (ptsA.length !== ptsB.length || ptsA.length < 8) return null;
  if (!ptsA.concat(ptsB).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  // unikatni pari (točne duplikati odstranimo)
  const seen = new Set<string>();
  const ua: XY[] = [], ub: XY[] = [];
  for (let i = 0; i < ptsA.length; i++) {
    const key = `${ptsA[i].x},${ptsA[i].y}|${ptsB[i].x},${ptsB[i].y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ua.push(ptsA[i]);
    ub.push(ptsB[i]);
  }
  if (ua.length < 8) return null;
  if (collinear(ua) || collinear(ub)) return null;
  const na = hartleyNormalize(ua);
  const nb = hartleyNormalize(ub);
  if (!na || !nb) return null;
  const n = ua.length;
  let best: { F: number[]; inliers: number[]; meanAll: number; count: number } | null = null;
  for (let it = 0; it < iters; it++) {
    // 8 različnih indeksov (ponovno žrebanje, deterministično prek rand)
    let sample: number[] | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const s: number[] = [];
      for (let k = 0; k < 8; k++) s.push(Math.floor(rand() * n));
      if (new Set(s).size === 8) { sample = s; break; }
    }
    if (!sample) continue;
    const sa = sample.map((i) => na.norm[i]);
    const sb = sample.map((i) => nb.norm[i]);
    const F = solveEightPoint(sa, sb, na.T, nb.T);
    if (!F) continue;
    const inliers: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const r = sampsonResidualPx(F, ua[i], ub[i]);
      sum += r;
      if (r <= thr) inliers.push(i);
    }
    const meanAll = sum / n;
    const better = best === null
      || inliers.length > best.count
      || (inliers.length === best.count && meanAll < best.meanAll - 1e-12);
    if (better) best = { F, inliers, meanAll, count: inliers.length };
  }
  if (!best) return null;
  // Nelinearno rafiniranje (Gauss–Newton na Sampsonovi razdalji čez
  // inlierje — klasičen korak, cf. OpenCV refineF): zniža residualo in
  // izboljša točnost poze. Deterministično — sprejme samo izboljšave.
  const refined = refineFundamental(best.F, ua, ub, best.inliers);
  if (refined) {
    const inliers2: number[] = [];
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const r = sampsonResidualPx(refined, ua[i], ub[i]);
      sum2 += r;
      if (r <= thr) inliers2.push(i);
    }
    if (inliers2.length >= best.inliers.length) {
      return { F: refined, inliers: inliers2, meanResidualPx: sum2 / n };
    }
  }
  return { F: best.F, inliers: best.inliers, meanResidualPx: best.meanAll };
}

/**
 * Gauss–Newton rafiniranje fundamentalne matrike: minimizira srednjo
 * Sampsonovo residualo (px) čez inlierje. Numerični Jacobian (n×9),
 * normalne enačbe 9×9 rešene z Jacobijevimi lastnimi vrednostmi (brez
 * knjižnic), po vsakem koraku rank 2 + normalizacija. Sprejme samo
 * korake, ki znižajo residualo (deterministično, brez naključja).
 */
function refineFundamental(
  F0: number[], ua: XY[], ub: XY[], inlierIdx: number[], iters = 12,
): number[] | null {
  if (inlierIdx.length < 8) return null;
  const n = inlierIdx.length;
  const cost = (F: number[]): number => {
    let s = 0;
    for (const i of inlierIdx) s += sampsonResidualPx(F, ua[i], ub[i]);
    return s / n;
  };
  let F = F0.slice();
  let cur = cost(F);
  const h0 = 1e-6 * frob3(F);
  if (!(h0 > 0)) return null;
  for (let it = 0; it < iters; it++) {
    const r0: number[] = new Array<number>(n);
    for (let k = 0; k < n; k++) r0[k] = sampsonResidualPx(F, ua[inlierIdx[k]], ub[inlierIdx[k]]);
    // numerični Jacobian J (n×9)
    const J: number[][] = [];
    for (let k = 0; k < n; k++) J.push(new Array<number>(9).fill(0));
    for (let p = 0; p < 9; p++) {
      const Fp = F.slice();
      Fp[p] += h0;
      for (let k = 0; k < n; k++) {
        const rp = sampsonResidualPx(Fp, ua[inlierIdx[k]], ub[inlierIdx[k]]);
        J[k][p] = (rp - r0[k]) / h0;
      }
    }
    // normalne enačbe (JᵀJ + εI)·δ = −Jᵀr
    const A: number[][] = [];
    for (let i = 0; i < 9; i++) A.push(new Array<number>(9).fill(0));
    const g = new Array<number>(9).fill(0);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 9; i++) {
        g[i] += J[k][i] * r0[k];
        for (let j = 0; j < 9; j++) A[i][j] += J[k][i] * J[k][j];
      }
    }
    for (let i = 0; i < 9; i++) A[i][i] += 1e-9 * (A[i][i] > 0 ? A[i][i] : 1) + 1e-18;
    const eg = jacobiEigen(A);
    if (eg.vectors.length === 0) break;
    const delta = new Array<number>(9).fill(0);
    for (let k = 0; k < 9; k++) {
      if (!(eg.values[k] > 1e-12)) continue;
      let proj = 0;
      for (let i = 0; i < 9; i++) proj += eg.vectors[i][k] * g[i];
      const c = -proj / eg.values[k];
      for (let i = 0; i < 9; i++) delta[i] += c * eg.vectors[i][k];
    }
    if (!allFinite(delta)) break;
    const rank2 = enforceRank2(F.map((v, i) => v + delta[i]));
    if (!rank2) break;
    const Fn = normalizeF(rank2);
    if (Fn.length !== 9 || !allFinite(Fn)) break;
    const cNew = cost(Fn);
    if (cNew < cur - 1e-15) { F = Fn; cur = cNew; } else break;
  }
  return allFinite(F) ? F : null;
}

// ─── 8) Fokus iz F (Hartley/Kruppa) ──────────────────────────

/**
 * Hartleyjev pogoj za esencialno matriko: E(f) = diag(f,f,1)·F₀·diag(f,f,1)
 * mora imeti σ1 = σ2 (σ3 = 0 sledi iz rank 2 F). F₀ = Kppᵀ·F·Kpp je F
 * premaknjena v glavno točko pp = (w/2, h/2) — brez premika formula ne velja.
 * g(f) = trace((EᵀE)²) − ½·trace(EᵀE)² = ½[(λ1−λ2)² + (λ2−λ3)² + (λ1−λ3)²] ≥ 0
 * VEDNO — pogoj je izpolnjen točko pri pravem fokusu, zato iščemo MINIMUM,
 * ne prehoda predznaka. Vrne NORMALIZIRANO vrzel ĝ = g / (½·trace(EᵀE)²) ∈
 * [0, 1] — brezrazsežna, neodvisna od skale F (0 ⟺ esencialna matrika).
 */
function focalGapRel(F0: number[], f: number): number {
  // E = D·F0·D, D = diag(f,f,1)
  const e = [
    F0[0] * f * f, F0[1] * f * f, F0[2] * f,
    F0[3] * f * f, F0[4] * f * f, F0[5] * f,
    F0[6] * f, F0[7] * f, F0[8],
  ];
  // M = EᵀE (simetrična)
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = i; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += e[k * 3 + i] * e[k * 3 + j];
      m[i * 3 + j] = s;
      m[j * 3 + i] = s;
    }
  }
  // trace(M) = m00+m11+m22; trace(M²) = Σ M_ij² (M je simetrična)
  const t1 = m[0] + m[4] + m[8];
  let t2 = 0;
  for (let i = 0; i < 9; i++) t2 += m[i] * m[i];
  const half = 0.5 * t1 * t1;
  if (!(half > 1e-300)) return Number.POSITIVE_INFINITY; // E(f) ≈ 0 — degenerirano
  return (t2 - half) / half;
}

/** Prag sprejema kandidata: normalizirana vrzel ĝ mora biti pod to vrednostjo. */
const FOCAL_GAP_TOLERANCE = 0.002;

/**
 * Kandidati za goriščno razdaljo (px) iz fundamentalne matrike —
 * Hartley/Kruppa samokalibracija (pp = središče slike, kvadratni piksli).
 * Ker je normalizirana vrzel ĝ(f) = g / (½·trace(EᵀE)²) VEDNO ≥ 0 in je 0
 * točko pri pravem fokusu (dvojni koren), se kandidati iščejo kot LOKALNI
 * MINIMUMI ĝ na log-razponu [0.3·minDim, 3·maxDim] (128 vzorcev), vsak
 * refined z zlatim rezom. Kandidat sprejet, če je min ĝ ≤
 * FOCAL_GAP_TOLERANCE (neskladen F → brez kandidatov — iskren izhod).
 * Izhod NARASNAJOČE, deduplikacija znotraj 2 %; lahko je prazen.
 */
export function focalCandidatesFromF(F: number[], w: number, h: number): number[] {
  if (!allFinite(F) || !(w > 0) || !(h > 0)) return [];
  const cx = w / 2, cy = h / 2;
  // F0 = Kppᵀ · F · Kpp (premik glavne točke v izhodišče)
  const Kpp = [1, 0, cx, 0, 1, cy, 0, 0, 1];
  const F0 = mul3(transpose3(Kpp), mul3(F, Kpp));
  const minDim = Math.min(w, h), maxDim = Math.max(w, h);
  const lo = 0.3 * minDim, hi = 3 * maxDim;
  if (!(lo > 0) || !(hi > lo)) return [];
  const N = 128;
  const loLog = Math.log(lo), hiLog = Math.log(hi);
  const fs: number[] = [];
  const rels: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = Math.exp(loLog + ((hiLog - loLog) * i) / (N - 1));
    fs.push(f);
    rels.push(focalGapRel(F0, f));
  }
  const PHI = 0.6180339887498949;
  const cands: number[] = [];
  for (let i = 1; i < N - 1; i++) {
    // lokalni minimum (strog < na obeh straneh — deterministično)
    if (!(rels[i] < rels[i - 1]) || !(rels[i] < rels[i + 1])) continue;
    // zlati rez na oklepaju [fs[i−1], fs[i+1]]
    let a = fs[i - 1], b = fs[i + 1];
    let c1 = b - (b - a) * PHI, c2 = a + (b - a) * PHI;
    let g1 = focalGapRel(F0, c1), g2 = focalGapRel(F0, c2);
    for (let k = 0; k < 90 && b - a > 1e-9 * b; k++) {
      if (g1 <= g2) {
        b = c2; c2 = c1; g2 = g1;
        c1 = b - (b - a) * PHI; g1 = focalGapRel(F0, c1);
      } else {
        a = c1; c1 = c2; g1 = g2;
        c2 = a + (b - a) * PHI; g2 = focalGapRel(F0, c2);
      }
    }
    const fmin = 0.5 * (a + b);
    const relMin = focalGapRel(F0, fmin);
    if (Number.isFinite(relMin) && relMin <= FOCAL_GAP_TOLERANCE) cands.push(fmin);
  }
  cands.sort((u, v) => u - v);
  const out: number[] = [];
  for (const f of cands) {
    if (!Number.isFinite(f) || f <= 0) continue;
    let dup = false;
    for (const a of out) {
      if (Math.abs(f - a) <= 0.02 * a) { dup = true; break; }
    }
    if (!dup) out.push(f);
  }
  return out;
}

// ─── 9) Projekcijska matrika P = K·[R|t] ─────────────────────

/** Projekcijska matrika 3×4 (row-major): K = [f,0,w/2; 0,f,h/2; 0,0,1], P = K·[R|t]. */
export function projectionMatrix(f: number, w: number, h: number, R: number[], t: number[]): number[] {
  const cx = w / 2, cy = h / 2;
  const out = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    // K vrstica i: [f,0,cx] / [0,f,cy] / [0,0,1]
    const k0 = i === 0 ? f : 0;
    const k1 = i === 1 ? f : 0;
    const k2 = i === 2 ? 1 : i === 0 ? cx : cy;
    for (let j = 0; j < 4; j++) {
      const m0 = j < 3 ? R[j] : t[0];
      const m1 = j < 3 ? R[3 + j] : t[1];
      const m2 = j < 3 ? R[6 + j] : t[2];
      out[i * 4 + j] = k0 * m0 + k1 * m1 + k2 * m2;
    }
  }
  return out;
}

// ─── 10) DLT triangulacija ───────────────────────────────────

/**
 * DLT triangulacija: homogeni sistem 4×12 → Jacobi na AᵀA 12×12 →
 * lastni vektor najmanjše lastne vrednosti. errPx = največja
 * reprojekcijska napaka (px) v obeh pogledih. Null pri degeneriranih
 * vhodih (w ≈ 0 — točka v neskončnosti, ne-končne vrednosti, točka na
 * kamerski ravnini).
 */
export function triangulateDLT(
  P1: number[], P2: number[], x1: XY, x2: XY,
): { X: [number, number, number]; errPx: number } | null {
  if (P1.length !== 12 || P2.length !== 12 || !allFinite(P1) || !allFinite(P2)) return null;
  if (!Number.isFinite(x1.x) || !Number.isFinite(x1.y) || !Number.isFinite(x2.x) || !Number.isFinite(x2.y)) return null;
  // DLT: vsak pogled da 2 vrstici nad ISTIM homogenim vektorjem [X,Y,Z,T]ᵀ
  // (4 neznank) → A je 4×4, M = AᵀA (4×4), rešitev = lastni vektor najmanjše
  // lastne vrednosti.
  const A: number[][] = [];
  for (let r = 0; r < 4; r++) A.push(new Array<number>(4).fill(0));
  const P = [P1, P2];
  const xs = [x1, x2];
  for (let cam = 0; cam < 2; cam++) {
    const p = P[cam];
    const xx = xs[cam].x, yy = xs[cam].y;
    for (let c = 0; c < 4; c++) {
      A[cam * 2][c] = xx * p[8 + c] - p[c];
      A[cam * 2 + 1][c] = yy * p[8 + c] - p[4 + c];
    }
  }
  // M = AᵀA (4×4)
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) M.push(new Array<number>(4).fill(0));
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 4; i++) {
      if (A[r][i] === 0) continue;
      for (let j = 0; j < 4; j++) M[i][j] += A[r][i] * A[r][j];
    }
  }
  const eg = jacobiEigen(M);
  if (eg.vectors.length === 0) return null;
  let minI = 0;
  for (let i = 1; i < 4; i++) if (eg.values[i] < eg.values[minI]) minI = i;
  const w = eg.vectors[3][minI];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null; // točka v neskončnosti
  const X: [number, number, number] = [eg.vectors[0][minI] / w, eg.vectors[1][minI] / w, eg.vectors[2][minI] / w];
  if (!allFinite(X)) return null;
  // reprojekcijski epsilon (px) v obeh pogledih
  const proj = (P: number[], X: [number, number, number]): XY | null => {
    const d = P[8] * X[0] + P[9] * X[1] + P[10] * X[2] + P[11];
    if (Math.abs(d) < 1e-12) return null;
    return {
      x: (P[0] * X[0] + P[1] * X[1] + P[2] * X[2] + P[3]) / d,
      y: (P[4] * X[0] + P[5] * X[1] + P[6] * X[2] + P[7]) / d,
    };
  };
  const u1 = proj(P1, X), u2 = proj(P2, X);
  if (!u1 || !u2) return null;
  const e1 = Math.hypot(u1.x - x1.x, u1.y - x1.y);
  const e2 = Math.hypot(u2.x - x2.x, u2.y - x2.y);
  const errPx = Math.max(e1, e2);
  if (!Number.isFinite(errPx)) return null;
  return { X, errPx };
}

// ─── 11) Relativna poza iz esencialne matrike ────────────────

const CHEIRALITY_POINTS = 24;

/**
 * Relativna poza: E = diag(fB,fB,1)·(KppBᵀ·F·KppA)·diag(fA,fA,1) (F premaknjena
 * v glavni točki), vsiljene esencialne omejitve (σ1=σ2=1, σ3=0 prek SVD 3×3
 * iz Jacobijevega razcepa), 4 razcepili (R1/R2 × ±t), cheirality prek DLT
 * triangulacije prvih do 24 inlier parov. t je normaliziran (|t| = 1) —
 * točke so zato v enotah |t|. Izenačeno → fiksni vrstni red razcepov.
 */
export function relativePose(
  F: number[],
  fA: number, fB: number,
  wA: number, hA: number, wB: number, hB: number,
  ptsA: XY[], ptsB: XY[],
  inliers: number[],
): { R: number[]; t: number[] } | null {
  if (!allFinite(F) || F.length !== 9) return null;
  if (!Number.isFinite(fA) || !Number.isFinite(fB) || fA <= 0 || fB <= 0) return null;
  const KppA = [1, 0, wA / 2, 0, 1, hA / 2, 0, 0, 1];
  const KppB = [1, 0, wB / 2, 0, 1, hB / 2, 0, 0, 1];
  const F0 = mul3(transpose3(KppB), mul3(F, KppA));
  let E = [
    fB * F0[0] * fA, fB * F0[1] * fA, fB * F0[2],
    fB * F0[3] * fA, fB * F0[4] * fA, fB * F0[5],
    F0[6] * fA, F0[7] * fA, F0[8],
  ];
  const scale = frob3(E);
  if (!(scale > 1e-15)) return null;
  E = E.map((v) => v / scale);
  // SVD 3×3: V iz EᵀE, U = E·V/s (skladno po konstrukciji)
  const G: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) G[i][j] = E[i] * E[j] + E[3 + i] * E[3 + j] + E[6 + i] * E[6 + j];
  const eg = jacobiEigen(G);
  if (eg.vectors.length === 0) return null;
  const ord = orderDesc(eg.values);
  const V: [number, number, number][] = ord.map((k) => [eg.vectors[0][k], eg.vectors[1][k], eg.vectors[2][k]]);
  const s0 = Math.sqrt(Math.max(eg.values[ord[0]], 0));
  const s1 = Math.sqrt(Math.max(eg.values[ord[1]], 0));
  if (!(s0 > 1e-10) || !(s1 > 1e-6 * s0)) return null; // rank < 2 → brez poze
  const mkU = (i: number): [number, number, number] | null => {
    const ev = apply3(E, V[i]);
    const si = i === 0 ? s0 : s1;
    const u: [number, number, number] = [ev[0] / si, ev[1] / si, ev[2] / si];
    const nu = Math.hypot(u[0], u[1], u[2]);
    if (!(nu > 0)) return null;
    return [u[0] / nu, u[1] / nu, u[2] / nu];
  };
  const u0 = mkU(0), u1 = mkU(1);
  if (!u0 || !u1) return null;
  let u2 = cross3(u0, u1);
  let v2 = cross3(V[0], V[1]);
  // det(U) > 0 in det(V) > 0 — pri tem se E' (u0,v0,u1,v1) ne spremeni
  const detU = dot3(cross3(u0, u1), u2);
  if (detU < 0) u2 = [-u2[0], -u2[1], -u2[2]];
  const detV = dot3(cross3(V[0], V[1]), v2);
  if (detV < 0) v2 = [-v2[0], -v2[1], -v2[2]];
  const U = [u0, u1, u2];
  const Vc = [V[0], V[1], v2];
  const W = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const WT = [0, 1, 0, -1, 0, 0, 0, 0, 1];
  // U in Vc sta shranjena kot STOLPCI (U[0] = prvi stolpec u0). Formula
  // R = U·W·Vᵀ v row-major: Uflattened = U (stolpci → row-major), Vflattened
  // = Vᵀ (vrstice = stolpci V). NAPAKA Uᵀ namesto U je dala ortogonalne,
  // a POVARNE rotacije (klasična past pri razcepu esencialne matrike).
  const Uflat = [
    U[0][0], U[1][0], U[2][0],
    U[0][1], U[1][1], U[2][1],
    U[0][2], U[1][2], U[2][2],
  ];
  const Vflat = [
    Vc[0][0], Vc[0][1], Vc[0][2],
    Vc[1][0], Vc[1][1], Vc[1][2],
    Vc[2][0], Vc[2][1], Vc[2][2],
  ];
  const R1 = mul3(mul3(Uflat, W), Vflat);
  const R2 = mul3(mul3(Uflat, WT), Vflat);
  if (!allFinite(R1) || !allFinite(R2)) return null;
  const tvec: [number, number, number] = [u2[0], u2[1], u2[2]];
  // kandidati v fiksnem vrstnem redu (izenačeno → prvi v tem redu)
  const cands: { R: number[]; t: number[] }[] = [
    { R: R1, t: tvec },
    { R: R1, t: [-tvec[0], -tvec[1], -tvec[2]] },
    { R: R2, t: tvec },
    { R: R2, t: [-tvec[0], -tvec[1], -tvec[2]] },
  ];
  const P1 = projectionMatrix(fA, wA, hA, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
  let best: { R: number[]; t: number[]; count: number } | null = null;
  for (const cand of cands) {
    const P2 = projectionMatrix(fB, wB, hB, cand.R, cand.t);
    let count = 0;
    const limit = Math.min(inliers.length, CHEIRALITY_POINTS);
    for (let k = 0; k < limit; k++) {
      const idx = inliers[k];
      if (idx < 0 || idx >= ptsA.length || idx >= ptsB.length) continue;
      const tri = triangulateDLT(P1, P2, ptsA[idx], ptsB[idx]);
      if (!tri) continue;
      const z1 = tri.X[2];
      const z2 = cand.R[6] * tri.X[0] + cand.R[7] * tri.X[1] + cand.R[8] * tri.X[2] + cand.t[2];
      if (z1 > 0 && z2 > 0) count++;
    }
    if (best === null || count > best.count) best = { R: cand.R, t: cand.t, count };
  }
  if (!best || best.count < 2) return null;
  return { R: best.R, t: best.t };
}

// ─── 12) Iskanje korespondence po epipolarni črti ────────────

/** NCC dveh raw patchev (odšteje mean, normira) — null, če patch sega čez rob. */
function patchNCC(
  grayA: Float64Array, wA: number, hA: number, xA: number, yA: number,
  grayB: Float64Array, wB: number, hB: number, xB: number, yB: number,
  patch: number,
): number | null {
  const half = (patch - 1) / 2;
  const ax = Math.round(xA), ay = Math.round(yA), bx = Math.round(xB), by = Math.round(yB);
  if (ax - half < 0 || ay - half < 0 || ax + half >= wA || ay + half >= hA) return null;
  if (bx - half < 0 || by - half < 0 || bx + half >= wB || by + half >= hB) return null;
  const pa = new Float64Array(patch * patch);
  const pb = new Float64Array(patch * patch);
  let ma = 0, mb = 0;
  for (let dy = 0; dy < patch; dy++) {
    for (let dx = 0; dx < patch; dx++) {
      const va = grayA[(ay - half + dy) * wA + ax - half + dx];
      const vb = grayB[(by - half + dy) * wB + bx - half + dx];
      pa[dy * patch + dx] = va; ma += va;
      pb[dy * patch + dx] = vb; mb += vb;
    }
  }
  ma /= pa.length; mb /= pb.length;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < pa.length; i++) {
    const va = pa[i] - ma, vb = pb[i] - mb;
    dot += va * vb; na += va * va; nb += vb * vb;
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Iskanje korespondence v fotki B za točko iz A vzdolž epipolarne črte
 * l_B = F·[xA,yA,1]ᵀ: gosta preiskava pikslov B znotraj radiusPx od
 * (xA,yA), ki ležijo ≤ 1.5 px od črte; NCC patch (privzeto 9); vrstni red
 * y naraščajoče, x naraščajoče (izenčeni → prvi). Null, če nič ≥ minNcc.
 */
export function matchPointOnEpipolar(
  grayA: Float64Array, wA: number, hA: number, xA: number, yA: number,
  grayB: Float64Array, wB: number, hB: number,
  F: number[],
  opts?: { radiusPx?: number; patch?: number; minNcc?: number },
): { x: number; y: number; ncc: number } | null {
  const radius = opts?.radiusPx ?? 24;
  const patch = opts?.patch ?? 9;
  const minNcc = opts?.minNcc ?? 0.7;
  if (!allFinite(F) || F.length !== 9) return null;
  if (!Number.isFinite(xA) || !Number.isFinite(yA)) return null;
  // črta l = F·[xA,yA,1]ᵀ
  const a = F[0] * xA + F[1] * yA + F[2];
  const b = F[3] * xA + F[4] * yA + F[5];
  const c = F[6] * xA + F[7] * yA + F[8];
  const nl = Math.hypot(a, b);
  if (!(nl > 1e-12)) return null; // degenerirana črta
  const x0 = Math.max(0, Math.ceil(xA - radius));
  const x1b = Math.min(wB - 1, Math.floor(xA + radius));
  const y0 = Math.max(0, Math.ceil(yA - radius));
  const y1b = Math.min(hB - 1, Math.floor(yA + radius));
  const r2 = radius * radius;
  let best: { x: number; y: number; ncc: number } | null = null;
  for (let y = y0; y <= y1b; y++) {
    for (let x = x0; x <= x1b; x++) {
      const dx = x - xA, dy = y - yA;
      if (dx * dx + dy * dy > r2) continue;
      const dist = Math.abs(a * x + b * y + c) / nl;
      if (dist > 1.5) continue;
      const ncc = patchNCC(grayA, wA, hA, xA, yA, grayB, wB, hB, x, y, patch);
      if (ncc === null) continue;
      if (best === null || ncc > best.ncc) best = { x, y, ncc };
    }
  }
  if (!best || best.ncc < minNcc) return null;
  return best;
}

// ─── 13) Orchestrator merjenja iz para fotk ──────────────────

/**
 * RMS odmik 3D točk od najbolje prilagojene ravnine (najmanjša lastna
 * vrednost razpršilne matrike → normala ravnine). Uporabljen za iskren
 * opozorilni signal skoraj ravninskih scen (globina slabo določena).
 */
function planeFitRms(X: [number, number, number][]): number | null {
  const n = X.length;
  if (n < 3) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const p of X) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= n; cy /= n; cz /= n;
  const S: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of X) {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    S[0][0] += dx * dx; S[0][1] += dx * dy; S[0][2] += dx * dz;
    S[1][1] += dy * dy; S[1][2] += dy * dz; S[2][2] += dz * dz;
  }
  S[1][0] = S[0][1]; S[2][0] = S[0][2]; S[2][1] = S[1][2];
  const eg = jacobiEigen(S);
  if (eg.vectors.length === 0) return null;
  let minI = 0;
  for (let i = 1; i < 3; i++) if (eg.values[i] < eg.values[minI]) minI = i;
  const nrm: [number, number, number] = [eg.vectors[0][minI], eg.vectors[1][minI], eg.vectors[2][minI]];
  const nn = Math.hypot(nrm[0], nrm[1], nrm[2]);
  if (!(nn > 1e-12)) return null;
  let s = 0;
  for (const p of X) {
    const d = nrm[0] * (p[0] - cx) + nrm[1] * (p[1] - cy) + nrm[2] * (p[2] - cz);
    s += d * d;
  }
  return Math.sqrt(s / n) / nn;
}

export interface PairMeasureInput {
  wA: number; hA: number; wB: number; hB: number;
  ptsA: XY[]; ptsB: XY[];
  rand: () => number;
  focalMode: 'known' | 'preset' | 'selfcal';
  focalPx?: number | null;
  reference?: { ai: number; bi: number; cm: number } | null;
  queries?: { ai: number; bi: number }[];
}

export interface PairMeasureResult {
  ok: boolean;
  code: 'OK' | 'NO_MATCHES' | 'DEGENERATE_GEOMETRY' | 'NO_REFERENCE' | 'RESIDUAL_HIGH';
  F: number[] | null;
  inliers: number[];
  meanResidualPx: number | null;
  focalPx: number | null;
  focalSelfCal: boolean;
  R: number[] | null;
  t: number[] | null;
  points3D: { i: number; X: [number, number, number]; errPx: number }[] | null;
  scaleCmPerUnit: number | null;
  distancesCm: { i: number; j: number; cm: number }[] | null;
  warnings: string[];
}

/** Prag residuale — skladno z MAX_MULTIVIEW_RESIDUAL_PX v measurement-status.ts. */
const MAX_RESIDUAL_PX = 3;

/**
 * Merjenje iz para fotk: F (RANSAC) → fokus (known/preset/selfcal) →
 * relativna poza → DLT triangulacija → merilo po znani referenci →
 * razdalje po queries. Vsi neuspehi EKSPPLICITNI (code + opozorila v
 * slovenščini) — nič tihega.
 */
export function measureFromPair(input: PairMeasureInput): PairMeasureResult {
  const wA = input.wA, hA = input.hA, wB = input.wB, hB = input.hB;
  const ptsA = input.ptsA, ptsB = input.ptsB;
  const queries = input.queries ?? [];
  const empty = {
    F: null as number[] | null,
    inliers: [] as number[],
    meanResidualPx: null as number | null,
    focalPx: null as number | null,
    focalSelfCal: false,
    R: null as number[] | null,
    t: null as number[] | null,
    points3D: null as PairMeasureResult['points3D'],
    scaleCmPerUnit: null as number | null,
    distancesCm: null as PairMeasureResult['distancesCm'],
  };
  // 1) dovolj parov?
  if (ptsA.length !== ptsB.length || ptsA.length < 8) {
    return {
      ok: false, code: 'NO_MATCHES', ...empty,
      warnings: ['NEZADOSTNI PODATKI: premalo ujemajočih parov (< 8).'],
    };
  }
  // 2) fundamentalna matrika
  const fr = estimateFundamental(wA, hA, wB, hB, ptsA, ptsB, input.rand, {});
  if (!fr) {
    return {
      ok: false, code: 'DEGENERATE_GEOMETRY', ...empty,
      warnings: ['NEZADOSTNI PODATKI: geometrija ujemajočih parov je degenerirana (npr. kolinearne točke) — fundamentalna matrika ni izračunljiva.'],
    };
  }
  // 3) residuala čez vse pare — preveč raztresena → NI mere
  if (fr.meanResidualPx > MAX_RESIDUAL_PX) {
    return {
      ok: false, code: 'RESIDUAL_HIGH',
      F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
      focalPx: null, focalSelfCal: false, R: null, t: null,
      points3D: null, scaleCmPerUnit: null, distancesCm: null,
      warnings: [`NEZADOSTNI PODATKI: ujemanja med fotkama so preveč raztresena (srednja epipolarna residuala ${fr.meanResidualPx.toFixed(1)} px > ${MAX_RESIDUAL_PX} px) — mera NI izračunana. Ponovi označbo povezav ali posnemi nove fotke.`],
    };
  }
  const warnings: string[] = [];
  // 4) fokus
  const minDim = Math.min(wA, hA, wB, hB);
  const maxDim = Math.max(wA, hA, wB, hB);
  let focalPx: number | null = null;
  let focalSelfCal = false;
  if (input.focalMode === 'known' || input.focalMode === 'preset') {
    const fx = input.focalPx ?? NaN;
    if (!Number.isFinite(fx) || !(fx > 0.3 * minDim) || !(fx < 3 * maxDim)) {
      return {
        ok: false, code: 'DEGENERATE_GEOMETRY',
        F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
        focalPx: null, focalSelfCal: false, R: null, t: null,
        points3D: null, scaleCmPerUnit: null, distancesCm: null,
        warnings: [`NEZADOSTNI PODATKI: fokus ${String(input.focalPx)} px je izven zanesljivega razpona (${(0.3 * minDim).toFixed(1)}–${(3 * maxDim).toFixed(1)} px za fotki ${wA}×${hA} oz. ${wB}×${hB}) — preveri EXIF oz. vnos fokusa.`],
      };
    }
    focalPx = fx;
  } else {
    const cands = focalCandidatesFromF(fr.F, wA, hA);
    if (cands.length === 0) {
      return {
        ok: false, code: 'DEGENERATE_GEOMETRY',
        F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
        focalPx: null, focalSelfCal: false, R: null, t: null,
        points3D: null, scaleCmPerUnit: null, distancesCm: null,
        warnings: ['Ne morem oceniti fokusa iz geometrije — vnesi fokus naprave ali uporabi EXIF.'],
      };
    }
    focalPx = cands[Math.floor((cands.length - 1) / 2)];
    focalSelfCal = true;
    if (cands.length > 1) {
      warnings.push(`Fokus ocenjen iz fotk (več kandidatov: ${cands.map((f) => f.toFixed(0)).join(', ')} px) — mera je samo orientacijska.`);
    }
    warnings.push('Fokus ocenjen iz fotk (samokalibracija) — mera je samo orientacijska, za proizvodno uporabi EXIF fokus.');
  }
  // 5) relativna poza
  const pose = relativePose(fr.F, focalPx, focalPx, wA, hA, wB, hB, ptsA, ptsB, fr.inliers);
  if (!pose) {
    return {
      ok: false, code: 'DEGENERATE_GEOMETRY',
      F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
      focalPx, focalSelfCal, R: null, t: null,
      points3D: null, scaleCmPerUnit: null, distancesCm: null,
      warnings: ['NEZADOSTNI PODATKI: relativna poza med fotkama ni določljiva (esencialna matrika degenerirana).'],
    };
  }
  // 6) triangulacija inlierjev + queries + reference (unikatni indeksi)
  const wanted = new Set<number>(fr.inliers);
  for (const q of queries) { wanted.add(q.ai); wanted.add(q.bi); }
  if (input.reference) { wanted.add(input.reference.ai); wanted.add(input.reference.bi); }
  const P1 = projectionMatrix(focalPx, wA, hA, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
  const P2 = projectionMatrix(focalPx, wB, hB, pose.R, pose.t);
  const byIndex = new Map<number, { i: number; X: [number, number, number]; errPx: number }>();
  let failed = 0;
  for (const i of [...wanted].sort((u, v) => u - v)) {
    if (i < 0 || i >= ptsA.length || i >= ptsB.length) continue;
    const tri = triangulateDLT(P1, P2, ptsA[i], ptsB[i]);
    if (!tri) { failed++; continue; }
    byIndex.set(i, { i, X: tri.X, errPx: tri.errPx });
  }
  if (failed > 0) {
    warnings.push(`NEZADOSTNI PODATKI: ${failed} ${failed === 1 ? 'točke ni bilo mogoče' : 'točk ni bilo mogoče'} trijangulirati (izpuščene iz izida).`);
  }
  const points3D = [...byIndex.values()].sort((u, v) => u.i - v.i);
  // iskren signal: skoraj ravninski oblak točk → globina slabo določena
  if (points3D.length >= 6) {
    const rms = planeFitRms(points3D.map((p) => p.X));
    if (rms !== null) {
      let ext = 0;
      for (const a of points3D) {
        for (const b of points3D) {
          const d = Math.hypot(b.X[0] - a.X[0], b.X[1] - a.X[1], b.X[2] - a.X[2]);
          if (d > ext) ext = d;
        }
      }
      if (ext > 1e-9 && rms / ext < 0.05) {
        warnings.push(`Opomba: 3D točke so skoraj ravninske (odmik od ravnine ${(rms / ext * 100).toFixed(1)} % razpona) — globina je slabo določena. Mere po ravnini ostanejo približno prave, mere v globino pa so nezanesljive; za zanesljive mere v globino posnemi fotki, ki zajameta tudi globino (prednji in zadnji objekt).`);
      }
    }
  }
  // 7) referenca → merilo → razdalje
  const ref = input.reference ?? null;
  if (!ref) {
    warnings.push('NEZADOSTNI PODATKI: manjka znana referenčna dolžina — izračunana so samo razmerja med točkami, ne mere v cm.');
    return {
      ok: false, code: 'NO_REFERENCE',
      F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
      focalPx, focalSelfCal, R: pose.R, t: pose.t,
      points3D, scaleCmPerUnit: null, distancesCm: null,
      warnings,
    };
  }
  const refOk = Number.isInteger(ref.ai) && Number.isInteger(ref.bi)
    && ref.ai >= 0 && ref.bi >= 0 && ref.ai < ptsA.length && ref.bi < ptsB.length
    && Number.isFinite(ref.cm) && ref.cm > 0
    && byIndex.has(ref.ai) && byIndex.has(ref.bi);
  if (!refOk) {
    warnings.push('NEZADOSTNI PODATKI: referenčni par ni veljaven oz. se ni trijanguliral — merilo v cm ni izračunljivo, samo razmerja.');
    return {
      ok: false, code: 'NO_REFERENCE',
      F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
      focalPx, focalSelfCal, R: pose.R, t: pose.t,
      points3D, scaleCmPerUnit: null, distancesCm: null,
      warnings,
    };
  }
  const Xa = byIndex.get(ref.ai)!.X;
  const Xb = byIndex.get(ref.bi)!.X;
  const len3D = Math.hypot(Xb[0] - Xa[0], Xb[1] - Xa[1], Xb[2] - Xa[2]);
  const scale = len3D > 1e-12 ? ref.cm / len3D : NaN;
  if (!Number.isFinite(scale) || scale <= 0) {
    warnings.push('NEZADOSTNI PODATKI: referenčni točki so v prostoru praktično ista točka — merilo v cm ni izračunljivo.');
    return {
      ok: false, code: 'NO_REFERENCE',
      F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
      focalPx, focalSelfCal, R: pose.R, t: pose.t,
      points3D, scaleCmPerUnit: null, distancesCm: null,
      warnings,
    };
  }
  const distancesCm: { i: number; j: number; cm: number }[] = [];
  let missingQueries = 0;
  for (const q of queries) {
    const pa = byIndex.get(q.ai);
    const pb = byIndex.get(q.bi);
    if (!pa || !pb) { missingQueries++; continue; }
    const d = Math.hypot(pb.X[0] - pa.X[0], pb.X[1] - pa.X[1], pb.X[2] - pa.X[2]) * scale;
    distancesCm.push({ i: q.ai, j: q.bi, cm: Math.round(d * 10) / 10 });
  }
  if (missingQueries > 0) {
    warnings.push(`NEZADOSTNI PODATKI: ${missingQueries} poizvedbeni ${missingQueries === 1 ? 'par je izpuščen' : 'parov je izpuščenih'} (točk se ni trijanguliralo).`);
  }
  // 8) OK
  return {
    ok: true, code: 'OK',
    F: fr.F, inliers: fr.inliers, meanResidualPx: fr.meanResidualPx,
    focalPx, focalSelfCal, R: pose.R, t: pose.t,
    points3D, scaleCmPerUnit: scale, distancesCm,
    warnings,
  };
}
