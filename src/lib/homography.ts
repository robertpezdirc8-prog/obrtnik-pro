// ─── Homografija: perspektivna korekcija ravnin ─────────────
// Single-view metrology po 4 točkah: uporabnik klikne 4 oglišča
// znano pravokotne ravnine (stena, fasada, tla, terasa) in vnese
// realno širino ter višino v cm. Iz homografije (slika → ravnina)
// so potem VSE meritve na tej ravnini prave — tudi če je bil
// posnetek močno poševn. (Tehnika: img-meter/metrologija ene slike.)

import type { ImgSize, XY } from './measure-geometry';
import { pctToPx } from './measure-geometry';

export interface PlaneCalib {
  /** Homografija 3×3 v ravni vrstici: [h11,h12,h13,h21,h22,h23,h31,h32] (h33=1). */
  H: number[];
  wCm: number;
  hCm: number;
}

/**
 * Reši 4-točkovno homografijo (natančno, Gaussova eliminacija
 * z delno pivotizacijo). src/dst = 4 točke. Vrne 8 neznank ali null,
 * če je sistem singular (degenerirane točke).
 */
export function solveHomography(src: XY[], dst: XY[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const X = dst[i].x;
    const Y = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const sol = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * sol[c];
    sol[r] = s / A[r][r];
  }
  return sol.every((v) => Number.isFinite(v)) ? sol : null;
}

/** Uporabi homografijo na točko. */
export function applyH(H: number[], x: number, y: number): XY {
  const w = H[6] * x + H[7] * y + 1;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/** Shoelace ploščina poligona (px). */
function polygonAreaPx(pts: XY[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const bpt = pts[(i + 1) % pts.length];
    sum += a.x * bpt.y - bpt.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Uredi 4 točke v deterministični konveksni vrstni red
 * (urejanje po kotu okoli težišča) — prepreči "pentljo" pri klikanju.
 */
export function orderQuad(pts: XY[]): XY[] {
  if (pts.length !== 4) return pts;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const start = Math.atan2(pts[0].y - cy, pts[0].x - cx);
  return [...pts]
    .map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((u, v) => u.a - v.a)
    .map((o) => o.p);
}

/**
 * Kalibriraj merilno ravnino: 4 oglišča v % slike + realna
 * širina in višina v cm. Oglišča se samodejno uredijo v konveksni
 * vrstni red. Vrne null pri degeneriranih vnosih.
 */
export function calibratePlane(
  quadPct: XY[],
  wCm: number,
  hCm: number,
  imgSize: ImgSize,
): PlaneCalib | null {
  if (quadPct.length !== 4 || !Number.isFinite(wCm) || !Number.isFinite(hCm)) return null;
  if (wCm < 10 || hCm < 10 || wCm > 10_000 || hCm > 10_000) return null;
  const quadPx = orderQuad(quadPct.map((p) => pctToPx(p, imgSize)));
  // zavrni degenerirane štirikotnike (< 0,5 % slike)
  if (polygonAreaPx(quadPx) < 0.005 * imgSize.w * imgSize.h) return null;
  const dst = [
    { x: 0, y: 0 },
    { x: wCm, y: 0 },
    { x: wCm, y: hCm },
    { x: 0, y: hCm },
  ];
  const H = solveHomography(quadPx, dst);
  if (!H) return null;
  return { H, wCm, hCm };
}

/** Točka (% slike) → koordinata na ravnini (cm). */
export function planePoint(plane: PlaneCalib, pct: XY, imgSize: ImgSize): XY {
  const p = pctToPx(pct, imgSize);
  return applyH(plane.H, p.x, p.y);
}

/** Razdalja med dvema točkama NA RAVNINI v cm (perspektivno popravljeno). */
export function planeDistanceCm(plane: PlaneCalib, a: XY, b: XY, imgSize: ImgSize): number | null {
  const A = planePoint(plane, a, imgSize);
  const B = planePoint(plane, b, imgSize);
  const d = Math.hypot(B.x - A.x, B.y - A.y);
  return Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
}

/** Površina poligona NA RAVNINI v m² (Shoelace v cm²). */
export function planePolygonAreaM2(
  pts: XY[],
  plane: PlaneCalib,
  imgSize: ImgSize,
): number | null {
  if (pts.length < 3) return null;
  const cm = pts.map((p) => planePoint(plane, p, imgSize));
  let sum = 0;
  for (let i = 0; i < cm.length; i++) {
    const a = cm[i];
    const b = cm[(i + 1) % cm.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const cm2 = Math.abs(sum) / 2;
  return Math.round((cm2 / 10_000) * 100) / 100;
}

/** Dolžine strani poligona NA RAVNINI v cm. */
export function planeSidesCm(pts: XY[], plane: PlaneCalib, imgSize: ImgSize): number[] {
  const sides: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = planeDistanceCm(plane, pts[i], pts[(i + 1) % pts.length], imgSize);
    sides.push(d ?? 0);
  }
  return sides;
}

/** Kot pri oglišču NA RAVNINI v stopinjah (0–180) — perspektivno popravljeno. */
export function planeAngleDeg(a: XY, v: XY, c: XY, plane: PlaneCalib, imgSize: ImgSize): number | null {
  const A = planePoint(plane, a, imgSize);
  const V = planePoint(plane, v, imgSize);
  const C = planePoint(plane, c, imgSize);
  const v1 = { x: A.x - V.x, y: A.y - V.y };
  const v2 = { x: C.x - V.x, y: C.y - V.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;
  const ang = Math.atan2(Math.abs(cross), dot);
  const deg = (ang * 180) / Math.PI;
  return Number.isFinite(deg) ? Math.round(deg * 10) / 10 : null;
}

export interface PlaneChainStats {
  /** dolžine odsekov NA RAVNINI v cm */
  segmentsCm: number[];
  /** skupni tek po trasi NA RAVNINI v cm */
  totalCm: number;
  /** vodoravni razpon (prva → zadnja) na ravnini v cm */
  spanCm: number;
  /** višinska razlika na ravnini v cm (absolutna) */
  riseCm: number;
  /** naklon trase v stopinjah (iz ravninskih koordinat) */
  slopeDeg: number;
  /** naklon v % (rise/span · 100) */
  slopePct: number;
}

/**
 * Statistika verige točk NA KALIBRIRANI RAVNINI (perspektivno popravljeno):
 * odseki, skupni tek, razpon, višinska razlika, naklon. Uporabi jo, kadar je
 * umerjena ravnina — meritve čez klanec so potem prave, ne le orientacijske.
 */
export function planeChainStats(
  points: XY[],
  plane: PlaneCalib,
  imgSize: ImgSize,
): PlaneChainStats | null {
  if (points.length < 2) return null;
  const cm = points.map((p) => planePoint(plane, p, imgSize));
  if (cm.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y))) return null;
  const segmentsCm: number[] = [];
  let total = 0;
  for (let i = 1; i < cm.length; i++) {
    const d = Math.hypot(cm[i].x - cm[i - 1].x, cm[i].y - cm[i - 1].y);
    total += d;
    segmentsCm.push(Math.round(d * 10) / 10);
  }
  const dx = Math.abs(cm[cm.length - 1].x - cm[0].x);
  const dy = Math.abs(cm[cm.length - 1].y - cm[0].y);
  return {
    segmentsCm,
    totalCm: Math.round(total * 10) / 10,
    spanCm: Math.round(dx * 10) / 10,
    riseCm: Math.round(dy * 10) / 10,
    slopeDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
    slopePct: dx > 0 ? Math.round((dy / dx) * 1000) / 10 : 0,
  };
}
