// ─── Zaznavanje obstoječega vzorca v štirikotniku (0 AI) ─────
// Deterministična skripta: iz fotke ugotovi, KAKŠNA ograja/struktura
// je na izbranem območju, in predlaga ustrezen vzorec v vizualizerju.
// Tehnika (raziskava task19):
//  1. Sobel gradienti znotraj štirikotnika → smerne energije
//     (vertikalne palice = visok |Gx|, horizontalne lamele = visok |Gy|,
//      diagonale = projekcija gradienta na 45°/135°, panel = nizka skupna).
//  2. Projekcijski profili vzdolž 4 smeri (x, y, 45°, 135°) + odstranitev
//     trenda → avtokorelacija razkrije periodičnost (razmak elementov);
//     osnovna perioda = NAJMANJŠI lag z AC ≥ 85 % globalnega vrha
//     (harmoniki ne zavedejo klasifikacije).
//  3. Klasifikacija: mreža = perioda v OBEH axialnih smereh in brez
//     diagonale; lamele45/vozlik = perioda na diagonalah; sicer
//     vertikalne/horizontalne po axialni periodi + smeri energije.
//  4. Debelina elementa = povprečje run-ov |det| > 50 % vrha.

import type { RgbaImage, PctPoint } from './bar-count';

export interface PatternSuggestion {
  /** Zaznani vzorec (podmnožica VizPattern — obstoječe strukture). */
  pattern: 'vertikalne' | 'horizontalne' | 'lamele45' | 'vozlik' | 'mreza' | 'panel';
  confidence: 'visoka' | 'srednja' | 'nizka';
  /** Perioda (razmak os–os) v px vzdolž zmagovalne smeri, če periodično. */
  pitchPx: number | null;
  /** Debelina elementa v px, če periodično. */
  barWidthPx: number | null;
  /** Smer periodičnosti elementov. */
  direction: 'x' | 'y' | 'd45' | 'd135' | null;
  /** Kratki slovenski opis za UI. */
  detail: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ─── Točka v štirikotniku (even-odd ray casting) ────────────

function pointInQuad(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// ─── ROI: sivine + maska + Sobel ────────────────────────────

interface RoiAnalysis {
  w: number;
  h: number;
  gx: Float32Array;
  gy: Float32Array;
  gray: Float32Array;
  mask: Uint8Array;
}

function analyzeRoi(img: RgbaImage, quad: PctPoint[]): RoiAnalysis | null {
  const poly = quad.map((p) => ({
    x: (p.x / 100) * (img.width - 1),
    y: (p.y / 100) * (img.height - 1),
  }));
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = clamp(Math.floor(Math.min(...xs)) - 1, 0, img.width - 2);
  const x1 = clamp(Math.ceil(Math.max(...xs)) + 1, 1, img.width - 1);
  const y0 = clamp(Math.floor(Math.min(...ys)) - 1, 0, img.height - 2);
  const y1 = clamp(Math.ceil(Math.max(...ys)) + 1, 1, img.height - 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 12 || h < 12) return null;

  const gray = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  let insideCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xi = x0 + x;
      const yi = y0 + y;
      const i = (yi * img.width + xi) * 4;
      gray[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      if (pointInQuad(xi, yi, poly)) {
        mask[y * w + x] = 1;
        insideCount++;
      }
    }
  }
  if (insideCount < 400) return null;

  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      const at = (xx: number, yy: number) => gray[yy * w + xx];
      const gxv =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gyv =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const idx = y * w + x;
      gx[idx] = gxv;
      gy[idx] = gyv;
    }
  }
  return { w, h, gx, gy, gray, mask };
}

// ─── Pripomočki za profili ──────────────────────────────────

function smooth3(v: number[]): number[] {
  const n = v.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = v[Math.max(0, i - 1)];
    const b = v[i];
    const c = v[Math.min(n - 1, i + 1)];
    out[i] = (a + 2 * b + c) / 4;
  }
  return out;
}

function movingMean(v: number[], win: number): number[] {
  const n = v.length;
  const w = Math.max(1, Math.min(win, n));
  const out = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += v[i];
    if (i >= w) sum -= v[i - w];
    out[i] = sum / Math.min(i + 1, w);
  }
  return out;
}

interface Periodicity {
  pitchPx: number | null;
  barWidthPx: number | null;
  strength: number; // 0–1: vrh AC / varianca
}

/** Detrendiran signal → avtokorelacija (osnovna perioda, ne harmonik). */
function acPeriod(det: number[], pxPerStep: number): Periodicity {
  const n = det.length;
  // absolutno amplitudno vrata: profil brez prave teksture (samo šum)
  // ima vrh < ~2,5 sivinske stopnje — periodičnosti ne izmišljujemo
  const amp0 = Math.max(...det.map((v) => Math.abs(v)));
  if (amp0 < 2.5) return { pitchPx: null, barWidthPx: null, strength: 0 };

  // prva razlika — odstrani poostankotno korelacijo sosednjih vzorcev
  // (realne fotke: glajenje/šum dvigne AC pri majhnih lagih)
  const d = det.slice(1).map((v, i) => v - det[i]);
  const m = d.length;
  let mean = 0;
  for (const x of d) mean += x;
  mean /= m;
  let variance = 0;
  const c = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    c[i] = d[i] - mean;
    variance += c[i] * c[i];
  }
  variance /= m;
  if (variance < 1e-6) return { pitchPx: null, barWidthPx: null, strength: 0 };

  const minLag = 4;
  const maxLag = Math.min(Math.floor(m / 2) - 1, Math.max(minLag + 1, Math.round(m / 3)));
  if (maxLag <= minLag) return { pitchPx: null, barWidthPx: null, strength: 0 };

  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < m; i++) s += c[i] * c[i + lag];
    ac.push(s / (m - lag));
  }
  const globalMax = Math.max(...ac);
  if (globalMax <= 0) return { pitchPx: null, barWidthPx: null, strength: 0 };
  // osnovna perioda = NAJMANJŠI LOKALNI MAKSIMUM z AC ≥ 75 % globalnega
  // (harmoniki in lag-šum ne zavedejo klasifikacije)
  let bestIdx = -1;
  for (let i = 0; i < ac.length; i++) {
    if (ac[i] < globalMax * 0.75) continue;
    const left = i > 0 ? ac[i - 1] : -Infinity;
    const right = i < ac.length - 1 ? ac[i + 1] : -Infinity;
    if (ac[i] >= left && ac[i] >= right) {
      bestIdx = i;
      break;
    }
  }
  if (bestIdx < 0) bestIdx = ac.indexOf(globalMax);
  const bestLag = bestIdx + minLag;
  const strength = clamp(ac[bestIdx] / variance, 0, 1);

  // debelina elementa: run-i |det| > 50 % vrha
  const peak = Math.max(...det.map((v) => Math.abs(v)));
  const half = peak * 0.5;
  let sum = 0;
  let cnt = 0;
  let run = 0;
  for (const x of det) {
    if (Math.abs(x) > half) run++;
    else if (run > 0) { sum += run; cnt++; run = 0; }
  }
  if (run > 0) { sum += run; cnt++; }
  const barWidthPx = cnt > 0 ? (sum / cnt) * pxPerStep : null;
  return { pitchPx: bestLag * pxPerStep, barWidthPx, strength };
}

/** Axialni profil: povprečje sivin po stolpcih (x) ali vrsticah (y). */
function axialProfile(roi: RoiAnalysis, axis: 'x' | 'y'): { det: number[]; pxPerStep: number } | null {
  const { w, h, gray, mask } = roi;
  const along = axis === 'x' ? w : h;
  const across = axis === 'x' ? h : w;
  const prof: number[] = [];
  const pos: number[] = [];
  const minCover = Math.max(2, Math.round(across * 0.3));
  for (let a = 0; a < along; a++) {
    let s = 0;
    let n = 0;
    for (let b = 0; b < across; b++) {
      const idx = axis === 'x' ? b * w + a : a * w + b;
      if (mask[idx]) { s += gray[idx]; n++; }
    }
    if (n >= minCover) { prof.push(s / n); pos.push(a); }
  }
  if (prof.length < 12) return null;
  const trend = movingMean(prof, Math.max(6, Math.round(prof.length / 8)));
  const det = smooth3(prof.map((v, i) => v - trend[i]));
  const pxPerStep = prof.length > 1 ? (pos[pos.length - 1] - pos[0]) / (prof.length - 1) : 1;
  return { det, pxPerStep };
}

/** Diagonalni profil: povprečje sivin po normalni koordinati diagonale. */
function diagProfile(roi: RoiAnalysis, which: 'd45' | 'd135'): { det: number[]; pxPerStep: number } | null {
  const { w, h, gray, mask } = roi;
  // s = (x+y)/√2 (d45) ali (x−y)/√2 (d135) — normala na elemente
  const sMin = which === 'd45' ? 0 : -(h - 1);
  const sMax = which === 'd45' ? (w - 1) + (h - 1) : (w - 1);
  const nb = Math.round((sMax - sMin) / Math.SQRT1_2 / 2) + 1; // počet skupin
  const sum = new Float64Array(nb);
  const cnt = new Uint32Array(nb);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      const s = which === 'd45' ? (x + y) / Math.SQRT2 : (x - y) / Math.SQRT2;
      const b = Math.round((s - sMin) / Math.SQRT1_2 / 2);
      if (b < 0 || b >= nb) continue;
      sum[b] += gray[idx];
      cnt[b]++;
    }
  }
  let maxCnt = 0;
  for (const c of cnt) maxCnt = Math.max(maxCnt, c);
  if (maxCnt < 4) return null;
  const minCnt = Math.max(2, Math.round(maxCnt * 0.35));
  const prof: number[] = [];
  const pos: number[] = [];
  for (let b = 0; b < nb; b++) {
    if (cnt[b] >= minCnt) { prof.push(sum[b] / cnt[b]); pos.push(b); }
  }
  if (prof.length < 12) return null;
  const trend = movingMean(prof, Math.max(6, Math.round(prof.length / 8)));
  const det = smooth3(prof.map((v, i) => v - trend[i]));
  // 1 skupina = 1 px v smeri normale (s je v px)
  return { det, pxPerStep: 1 };
}

// ─── Histogram orientacij robov (utežen z magnitudo gradienta) ──

/**
 * Deleži robov po orientaciji (edge = smer črte, ne gradienta):
 *  fH — horizontalne črte (0°), fD1 — diagonala 45°, fV — vertikalne (90°),
 *  fD2 — diagonala 135°. Vsota = 1. Robustno pri mrežah (masa 50/50 H/V),
 *  kjer razmerja energij odpovejo (kotički pikslovvi dvignejo diagonalno
 *  energijo). Standardni pristop orientacijskega histograma.
 */
function orientationFractions(roi: RoiAnalysis): {
  fH: number; fD1: number; fV: number; fD2: number; total: number;
} {
  const { w, h, gx, gy, mask } = roi;
  let fH = 0, fD1 = 0, fV = 0, fD2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      const ax = gx[idx];
      const ay = gy[idx];
      const mag = Math.hypot(ax, ay);
      if (mag < 12) continue; // šum
      // gradient smeri θg = atan2(ay, ax); ROB (črta) je pravokoten nanj
      let a = Math.atan2(-ay, ax) * (180 / Math.PI); // gradient orientation
      if (a < 0) a += 180;
      let e = a + 90; // edge orientation = gradient + 90°
      if (e >= 180) e -= 180;
      if (e < 22.5 || e >= 157.5) fH += mag;
      else if (e < 67.5) fD1 += mag;
      else if (e < 112.5) fV += mag;
      else fD2 += mag;
      n += mag;
    }
  }
  if (n <= 0) return { fH: 0, fD1: 0, fV: 0, fD2: 0, total: 0 };
  return { fH: fH / n, fD1: fD1 / n, fV: fV / n, fD2: fD2 / n, total: n };
}

// ─── Glavna detekcija ───────────────────────────────────────

const DETAIL: Record<PatternSuggestion['pattern'], string> = {
  vertikalne: 'Navpični elementi (palice/rebra)',
  horizontalne: 'Vodoravne lamele',
  lamele45: 'Nagnjene lamele (diagonala)',
  vozlik: 'Križana diagonala (vozlik)',
  mreza: 'Mreža — perioda v obeh smereh',
  panel: 'Polna površina',
};

/**
 * Zazna obstoječi vzorec v štirikotniku in vrne predlog za vizualizer.
 * Deluje na izvorni fotki (brez plast!) — kliče se s canvas ImageData.
 */
export function detectPatternInQuad(img: RgbaImage, quad: PctPoint[]): PatternSuggestion | null {
  if (quad.length !== 4) return null;
  const roi = analyzeRoi(img, quad);
  if (!roi) return null;

  const of = orientationFractions(roi);
  const px = axialProfile(roi, 'x');
  const py = axialProfile(roi, 'y');
  const d45 = diagProfile(roi, 'd45');
  const d135 = diagProfile(roi, 'd135');

  const perX = px ? acPeriod(px.det, px.pxPerStep) : { pitchPx: null, barWidthPx: null, strength: 0 };
  const perY = py ? acPeriod(py.det, py.pxPerStep) : { pitchPx: null, barWidthPx: null, strength: 0 };
  const perD1 = d45 ? acPeriod(d45.det, d45.pxPerStep) : { pitchPx: null, barWidthPx: null, strength: 0 };
  const perD2 = d135 ? acPeriod(d135.det, d135.pxPerStep) : { pitchPx: null, barWidthPx: null, strength: 0 };

  // prag "nizke teksture" → panel (polna plošča / zasebnost)
  // en.total = skupna magnituda robov na piksel (gray nivoji)
  if (of.total / Math.max(1, roi.mask.reduce((s, v) => s + v, 0)) < 2.5) {
    return {
      pattern: 'panel',
      confidence: 'visoka',
      pitchPx: null,
      barWidthPx: null,
      direction: null,
      detail: DETAIL.panel,
    };
  }

  const STRONG = 0.18;
  const axialPair = perX.strength >= STRONG && perY.strength >= STRONG;

  let pattern: PatternSuggestion['pattern'];
  let per: Periodicity;
  let dir: PatternSuggestion['direction'];
  // prevladujoči delež orientacije (za zanesljivost)
  let fWin: number;

  const diagBoth = of.fD1 >= 0.28 && of.fD2 >= 0.28;
  if (diagBoth && (perD1.strength >= STRONG || perD2.strength >= STRONG)) {
    pattern = 'vozlik';
    const d1wins = perD1.strength >= perD2.strength;
    per = d1wins ? perD1 : perD2;
    dir = d1wins ? 'd45' : 'd135';
    fWin = of.fD1 + of.fD2;
  } else if (of.fD1 >= 0.5 && perD1.strength >= 0.1) {
    pattern = 'lamele45';
    per = perD1;
    dir = 'd45';
    fWin = of.fD1;
  } else if (of.fD2 >= 0.5 && perD2.strength >= 0.1) {
    pattern = 'lamele45';
    per = perD2;
    dir = 'd135';
    fWin = of.fD2;
  } else if (of.fV >= 0.3 && of.fH >= 0.3 && axialPair) {
    pattern = 'mreza';
    per = perX.strength >= perY.strength ? perX : perY;
    dir = perX.strength >= perY.strength ? 'x' : 'y';
    fWin = of.fV + of.fH;
  } else if (of.fV >= 0.45 && perX.strength >= STRONG) {
    pattern = 'vertikalne';
    per = perX;
    dir = 'x';
    fWin = of.fV;
  } else if (of.fH >= 0.45 && perY.strength >= STRONG) {
    pattern = 'horizontalne';
    per = perY;
    dir = 'y';
    fWin = of.fH;
  } else if (of.fD1 + of.fD2 >= 0.45) {
    pattern = 'lamele45';
    per = perD1.strength >= perD2.strength ? perD1 : perD2;
    dir = perD1.strength >= perD2.strength ? 'd45' : 'd135';
    fWin = of.fD1 + of.fD2;
  } else if (of.fV >= of.fH && perX.strength >= perY.strength) {
    return mk('vertikalne', 'nizka', perX, 'x');
  } else {
    return mk('horizontalne', 'nizka', perY, 'y');
  }

  // zanesljivost: prevladujoča orientacija + jakost periode
  const confidence: PatternSuggestion['confidence'] =
    fWin >= 0.65 && per.strength >= 0.3 ? 'visoka' : fWin >= 0.45 || per.strength >= 0.22 ? 'srednja' : 'nizka';

  return mk(pattern, confidence, per, dir);
}

function mk(
  pattern: PatternSuggestion['pattern'],
  confidence: PatternSuggestion['confidence'],
  per: Periodicity,
  dir: NonNullable<PatternSuggestion['direction']>,
): PatternSuggestion {
  // fizično nesmiselna perioda (< 8 px na fotki) = šum, ne struktura
  const pitch = per.pitchPx !== null && per.pitchPx >= 8 ? Math.round(per.pitchPx * 10) / 10 : null;
  const width = pitch !== null && per.barWidthPx !== null ? Math.round(per.barWidthPx * 10) / 10 : null;
  return {
    pattern,
    confidence,
    pitchPx: pitch,
    barWidthPx: width,
    direction: pitch !== null ? dir : null,
    detail: DETAIL[pattern],
  };
}
