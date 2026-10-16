// ─── Nadstrešek: samodejna meritev širine, globine in naklona (0 AI) ──
// Frontalna fotka → rob kritine (Hough po (θ, ρ)) → ŠIRINA (kalibracija
// po referenci). Stranska fotka → poševni rob kritine → NAKLON (kot je
// brezplačen, brez kalibracije) + GLOBINA = vodoravna projekcija daljice.
// Čiste funkcije, brez DOM/AI — klice jih CanopyPanel.

import type { ImgSize, XY } from './measure-geometry';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Črta v % slike (0–100). */
export interface PctLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type CanopyMode = 'width' | 'depth';

export interface CanopyLineResult {
  ok: boolean;
  seg: PctLine | null;
  /** Kot črte glede na vodoravno (0 = vodoravno, vedno ≥ 0). */
  angleDeg: number | null;
  /** Dolžina podprtega odseka kot % širine slike. */
  spanPct: number | null;
  /** Trdost 0–1 (gostota podpore vzdolž odseka). */
  strength: number;
  warnings: string[];
}

interface EdgePx {
  x: number;
  y: number;
  m: number;
}

const DEG = Math.PI / 180;

/** Svetlost BT.601 (0–255). */
function luma(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Zberi robne piksle (centralna diferenca, prag magnitude). */
function collectEdges(img: RgbaImage, thr: number): EdgePx[] {
  const { width: w, height: h, data } = img;
  const out: EdgePx[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx =
        luma(data, i + 4) - luma(data, i - 4) +
        0.5 * (luma(data, i - w * 4 + 4) + luma(data, i + w * 4 + 4) - luma(data, i - w * 4 - 4) - luma(data, i + w * 4 - 4));
      const gy =
        luma(data, i + w * 4) - luma(data, i - w * 4) +
        0.5 * (luma(data, i + 4 - w * 4) + luma(data, i + 4 + w * 4) - luma(data, i - 4 - w * 4) - luma(data, i - 4 + w * 4));
      const m = Math.hypot(gx, gy);
      if (m >= thr) out.push({ x, y, m });
    }
  }
  return out;
}

/**
 * Detekcija roba kritine z Houghovo akumulacijo po (θ, ρ).
 * - 'width' (frontalna fotka): išče ~vodoravno črto (rob kritine), θ ∈ [−14°, +14°].
 * - 'depth' (stranska fotka): išče poševno črto (rob kritine od stene do spredaj), θ ∈ [2°, 46°].
 * Podporne točke se projektirajo na smer črte; z gap-groženjem izberemo najmočnejši
 * zvezni odsek — njegova konca sta predlagani točki meritve.
 */
export function detectCanopyLine(img: RgbaImage, mode: CanopyMode): CanopyLineResult {
  const { width: w, height: h } = img;
  const diag = Math.hypot(w, h);
  const warn: string[] = [];
  const empty: CanopyLineResult = { ok: false, seg: null, angleDeg: null, spanPct: null, strength: 0, warnings: warn };

  if (w < 120 || h < 90) {
    warn.push('Fotografija je premajhna za zaznavo roba kritine.');
    return empty;
  }

  const edges = collectEdges(img, 34);
  if (edges.length < 60) {
    warn.push('Ni izrazitih robov — fotka je preveč enotna ali zamegljena.');
    return empty;
  }

  // Koti iskanja po načinu (kot ČRTE glede na vodoravno)
  const a0 = mode === 'width' ? -14 : 2;
  const a1 = mode === 'width' ? 14 : 46;
  const stepA = 1;

  let best = { theta: 0, rho: 0, weight: 0 };
  const rhoBin = 2;
  const rhoMax = Math.ceil(diag / rhoBin) + 2;
  const acc = new Float64Array(rhoMax * 2 + 1);

  for (let a = a0; a <= a1 + 1e-9; a += stepA) {
    acc.fill(0);
    const th = a * DEG;
    const nx = -Math.sin(th);
    const ny = Math.cos(th);
    for (const e of edges) {
      const rho = e.x * nx + e.y * ny;
      const bin = Math.round(rho / rhoBin) + rhoMax;
      acc[bin] += e.m;
    }
    for (let b = 0; b < acc.length; b++) {
      if (acc[b] > best.weight) best = { theta: th, rho: (b - rhoMax) * rhoBin, weight: acc[b] };
    }
  }
  if (best.weight <= 0) {
    warn.push(mode === 'width' ? 'Ni vodoravnega roba kritine.' : 'Ni poševnega roba kritine (slikaj s strani).');
    return empty;
  }

  // Fina izbira kota ±2° po 0,25° (osnova se FIKSIRA — lekcija Task 29)
  const base = (best.theta / DEG);
  let fine = { theta: best.theta, rho: best.rho, weight: best.weight };
  for (let d = -2; d <= 2 + 1e-9; d += 0.25) {
    const a = base + d;
    const th = a * DEG;
    const nx = -Math.sin(th);
    const ny = Math.cos(th);
    acc.fill(0);
    for (const e of edges) {
      const rho = e.x * nx + e.y * ny;
      const bin = Math.round(rho / rhoBin) + rhoMax;
      acc[bin] += e.m;
    }
    for (let b = 0; b < acc.length; b++) {
      if (acc[b] > fine.weight) fine = { theta: th, rho: (b - rhoMax) * rhoBin, weight: acc[b] };
    }
  }

  const { theta, rho } = fine;
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  const dx = Math.cos(theta); // smer črte
  const dy = Math.sin(theta);

  // Podporne točke (≤ 3 px od črte) → t-parameter vzdolž črte
  const sup: { t: number; m: number }[] = [];
  for (const e of edges) {
    const dist = Math.abs(e.x * nx + e.y * ny - rho);
    if (dist <= 3) sup.push({ t: e.x * dx + e.y * dy, m: e.m });
  }
  if (sup.length < 25) {
    warn.push('Rob kritine ni dovolj izrazit.');
    return empty;
  }
  sup.sort((p, q) => p.t - q.t);

  // Gap-groždenje po t (dovoljena vrzelja 3,5 % diagonale) → najmočnejši grozd
  const gapTol = 0.035 * diag;
  type Cl = { t0: number; t1: number; w: number };
  const clusters: Cl[] = [];
  let cur: Cl | null = null;
  for (let i = 0; i < sup.length; i++) {
    const p = sup[i];
    if (cur && p.t - cur.t1 <= gapTol) {
      cur.t1 = p.t;
      cur.w += p.m;
    } else {
      if (cur) clusters.push(cur);
      cur = { t0: p.t, t1: p.t, w: p.m };
    }
  }
  if (cur) clusters.push(cur);
  if (clusters.length === 0) {
    warn.push('Rob kritine ni dovolj zvezen.');
    return empty;
  }
  let bestC = clusters[0];
  for (const c of clusters) if (c.w > bestC.w) bestC = c;

  const span = bestC.t1 - bestC.t0;
  const minSpan = (mode === 'width' ? 0.22 : 0.14) * w;
  if (span < minSpan) {
    warn.push(
      mode === 'width'
        ? 'Vodoravni rob je prekratek (< 22 % fotke) — slikaj kritino širše ali meri s 2 klikoma.'
        : 'Poševni rob je prekratek (< 14 % fotke) — slikaj iz večje razdalje ali meri s 2 klikoma.',
    );
    return empty;
  }

  // Konca odseka → % slike (točki ležita na črti (rho) pri t0/t1)
  const toXY = (t: number): XY => {
    const cx = rho * nx + t * dx;
    const cy = rho * ny + t * dy;
    return { x: (cx / w) * 100, y: (cy / h) * 100 };
  };
  const p1 = toXY(bestC.t0);
  const p2 = toXY(bestC.t1);

  const angleDeg = Math.abs((Math.atan2((p2.y - p1.y) * (h / 100), (p2.x - p1.x) * (w / 100)) * 180) / Math.PI);
  const strength = Math.min(1, bestC.w / (span * 110));

  // V načinu depth je "najmočnejša črta skoraj vodoravna" znak, da je fotka frontalna
  // (fina izbira lahko zdrsi na vodoravno fašno lento) — zavrni, naj uporabnik klikne ročno.
  if (mode === 'depth' && angleDeg < 2.5) {
    warn.push(`Najmočnejša črta je skoraj vodoravna (≈ ${angleDeg.toFixed(1).replace('.', ',')}°) — to je verjetno frontalna fotka. Za globino in naklon uporabi stransko fotko ali meri z 2 klikoma.`);
    return { ok: false, seg: null, angleDeg: null, spanPct: null, strength: 0, warnings: warn };
  }

  if (mode === 'width' && angleDeg > 10) {
    warn.push('Rob ni vodoraven (> 10°) — za globino in naklon uporabi stransko fotko.');
  }

  return { ok: true, seg: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, angleDeg, spanPct: (span / w) * 100, strength, warnings: warn };
}

/** Merilo na delovni sliki: (višina referenčnega okvirja v naravnih px × skala) / znani cm. */
export function refPxPerCm(naturalBoxH: number, assumedCm: number, workScale: number): number | null {
  if (!(assumedCm > 0) || !(naturalBoxH > 4)) return null;
  const v = (naturalBoxH * workScale) / assumedCm;
  return v > 0.02 && Number.isFinite(v) ? v : null;
}

export interface PointMeasure {
  /** Dolžina daljice (kalibrirana) v cm ali null brez merila. */
  lenCm: number | null;
  /** Kot glede na vodoravno (0–90°, brez predznaka) — kalibracije ne potrebuje. */
  angleDeg: number;
  /** Vodoravna projekcija (cm) — samo z merilom. */
  horizCm: number | null;
  /** Dvig (cm) — samo z merilom. */
  riseCm: number | null;
  lenPx: number;
}

/**
 * Meritev iz dveh klikov (% slike) na delovni sliki (ImgSize = delovna ločljivost).
 * Kot je brezplačen, cm potrebujejo pxPerCm.
 */
export function measureFromPoints(a: XY, b: XY, work: ImgSize, pxPerCm: number | null): PointMeasure {
  const ax = (a.x / 100) * work.w;
  const ay = (a.y / 100) * work.h;
  const bx = (b.x / 100) * work.w;
  const by = (b.y / 100) * work.h;
  const dx = bx - ax;
  const dy = by - ay;
  const lenPx = Math.hypot(dx, dy);
  const angleDeg = Math.min(90, Math.abs((Math.atan2(dy, dx) * 180) / Math.PI));
  const lenCm = pxPerCm && pxPerCm > 0 ? lenPx / pxPerCm : null;
  return {
    lenCm,
    angleDeg,
    horizCm: lenCm !== null ? lenCm * Math.cos(angleDeg * DEG) : null,
    riseCm: lenCm !== null ? lenCm * Math.sin(angleDeg * DEG) : null,
    lenPx,
  };
}

/** Št. stebrov po razponu: ≤ 3,5 m → 2, ≤ 7 m → 3, sicer 4 (jeklo 80×80, praksa EU). */
export function suggestPosts(widthM: number): number {
  if (widthM <= 3.5) return 2;
  if (widthM <= 7) return 3;
  return 4;
}

export interface CanopyMeasureInput {
  widthM: number | null;
  depthM: number | null;
  /** Naklon v stopinjah (0–45) ali null, če ni znan. */
  slopeDeg?: number | null;
  /** Ročna izbira št. stebrov (sicer suggestPosts). */
  posts?: number | null;
}

export interface CanopyMeasureResult {
  ok: boolean;
  areaM2: number | null;
  roofAreaM2: number | null;
  posts: number | null;
  /** Dvig sprednjega roba (cm) glede na naklon. */
  riseCm: number | null;
  warnings: string[];
}

/** Kombinirana geometrija nadstreška iz širine + globine (+ naklona). */
export function measureCanopy(input: CanopyMeasureInput): CanopyMeasureResult {
  const warn: string[] = [];
  const W = input.widthM ?? 0;
  const D = input.depthM ?? 0;
  const slope = input.slopeDeg ?? null;
  const res: CanopyMeasureResult = { ok: false, areaM2: null, roofAreaM2: null, posts: null, riseCm: null, warnings: warn };

  if (W <= 0 && D <= 0) {
    warn.push('Manjkata širina in globina — izmeri vsaj eno (drugo vpiši ročno).');
    return res;
  }
  if (W <= 0) {
    warn.push('Manjka širina — frontalna fotka ali ročni vnos.');
    return res;
  }
  if (D <= 0) {
    warn.push('Manjka globina — stranska fotka ali ročni vnos.');
    return res;
  }

  const area = Math.round(W * D * 100) / 100;
  const slopeOk = slope !== null && Number.isFinite(slope) && slope > 0.5 && slope <= 45;
  if (slope !== null && !slopeOk && slope > 45) warn.push('Naklon > 45° je nenavaden za nadstrešek — preveri meritveno daljico.');
  const roofArea = slopeOk ? Math.round((area / Math.cos((slope as number) * DEG)) * 100) / 100 : null;
  if (slopeOk && slope! > 20) warn.push('Naklon > 20° — preveri, ali meriš res nadstrešek (ne strehe).');
  const posts = input.posts && input.posts >= 0 ? Math.round(input.posts) : suggestPosts(W);
  const rise = slopeOk ? Math.round(D * Math.tan((slope as number) * DEG) * 100) : null;

  res.ok = true;
  res.areaM2 = area;
  res.roofAreaM2 = roofArea;
  res.posts = posts;
  res.riseCm = rise;
  if (roofArea !== null && roofArea - area > 0.04 * area) {
    warn.push('Kritina po naklonu je vidno večja od projekcije — pri odmerku upoštevaj večjo vrednost.');
  }
  return res;
}

/** Povzetek za kopiranje (decimalna vejica). */
export function formatCanopyText(
  m: CanopyMeasureResult & { widthM: number; depthM: number; slopeDeg: number | null },
): string {
  const f1 = (v: number) => v.toFixed(1).replace('.', ',');
  const f2 = (v: number) => v.toFixed(2).replace('.', ',');
  const L: string[] = ['Nadstrešek (samodejna meritev s fotke)'];
  L.push(`- Širina (fronta): ${f2(m.widthM)} m`);
  L.push(`- Globina: ${f2(m.depthM)} m`);
  if (m.slopeDeg !== null) L.push(`- Naklon kritine: ≈ ${f1(m.slopeDeg)}°`);
  if (m.areaM2 !== null) L.push(`- Površina: ${f2(m.areaM2)} m²`);
  if (m.roofAreaM2 !== null) L.push(`- Kritina po naklonu: ${f2(m.roofAreaM2)} m²`);
  if (m.posts !== null) L.push(`- Stebri (predlog): ${m.posts} kosov`);
  if (m.riseCm !== null) L.push(`- Dvig sprednjega roba: ≈ ${f1(m.riseCm)} cm`);
  L.push('- Mere so orientacijske (napaka 2–8 % pri poševni fotki) — preveri z laserjem.');
  return L.join('\n');
}
