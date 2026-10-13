// ─── Fasada: meritvena skripta iz fotke ─────────────────────
// Čisto skriptno, brez AI (nadgradna Task 32 — zadnji obrt brez
// lastne meritvene skripte, napovedano v Task 30).
//
//  • LINIJE OBLOGE = vzporedne črte v ENI smeri (WPC/lesena obloga,
//    trapezna pločevina) → ista Radonova projekcija gradientov kot
//    deck-analysis (Task 29, dokazana): grobo po 5°, fina ±4° po 1°,
//    pitch iz Pearsonove ACF + regularna veriga vrhov. Smer linij
//    določa smer podkonstrukcije (letve tečejo pravokotno na oblogo).
//  • STENA = 4 oglisča (kliki uporabnika) → širina × višina po
//    kalibraciji (referenčni objekt: vrata 200 / okno 120 cm —
//    pxPerCm enakomeren, kot pri deckQuadArea). Par nasprotnih
//    stranic z bolj VODORAVNO smerjo = širina, bolj NAVPIČNO = višina
//    (deluje tudi za ozke zanimive stene, višje kot široke).
//  • ODPRINE = pravokotniki (okna/vrata iz samodejne analize ALI
//    ročni kliki) → Sutherland–Hodgman rez poligona stene vsakim
//    pravokotnikom → vsota m² odprtin znotraj stene → NETO površina.
//  • PREFILL kalkulatorja: facadePerimeter = dolžina stene (m),
//    facadeHeight = višina stene (m), openingsM2 = vsota odprtin.
//
// Vse čiste funkcije (brez DOM) — testabilno v bun (tests/verify).

import type { RgbaImage } from './bar-count';
import type { ImgSize, XY } from './measure-geometry';
import { pctToPx } from './measure-geometry';
import { orderQuad } from './homography';

export type { RgbaImage };

// ─── 1) Linije obloge (smer + ritem) ────────────────────────

export type CladOrientation = 'vodoravno' | 'navpično' | 'neznano';

export interface CladLinePct {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FasadaLinesResult {
  ok: boolean;
  /** Smer LINIJ obloge mod 180° (0 = vodoravno, 90 = navpično). */
  cladAngleDeg: number;
  /** Korak linij (središče–središče) v px delovne slike. */
  pitchPx: number | null;
  /** Moč vzorca (0–1). */
  amplitude: number;
  /** Variacijski koeficient razmakov (manjši = pravilneje). */
  pitchCv: number;
  /** Št. vidnih linij. */
  linesVisible: number | null;
  /** 'vodoravno' | 'navpično' | 'neznano' — letve tečejo pravokotno. */
  orientation: CladOrientation;
  /** Anotacije linij v % slike (za SVG overlay). */
  lines: CladLinePct[];
  confidence: number;
  verdict: 'visoka' | 'srednja' | 'nizka';
  warnings: string[];
}

// ── Mali pripomočki (isti vzorci kot deck-analysis) ─────────

function toGray(img: RgbaImage): Float32Array {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

function movingMean(v: Float32Array, win: number): Float32Array {
  const out = new Float32Array(v.length);
  const half = Math.max(1, Math.floor(win / 2));
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= 2 * half + 1) sum -= v[i - (2 * half + 1)];
    out[i] = sum / Math.min(i + 1, 2 * half + 1);
  }
  return out;
}

function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Pearsonova avtokorelacija (normalizirana) — najmanjši lag z ≥ 0,8× maksimuma. */
function bestPeriod(v: Float32Array, minLag: number, maxLag: number): { lag: number; score: number } {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= Math.max(1, v.length);
  const c = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) c[i] = v[i] - mean;
  let sumSqAll = 0;
  for (let i = 0; i < c.length; i++) sumSqAll += c[i] * c[i];
  const corr = (lag: number): number => {
    let s = 0, sumSqTail = 0;
    for (let i = 0; i + lag < v.length; i++) {
      s += c[i] * c[i + lag];
      sumSqTail += c[i + lag] * c[i + lag];
    }
    const denom = Math.sqrt(sumSqAll * sumSqTail) || 1;
    return s / denom;
  };
  let maxScore = 0;
  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag && lag < v.length; lag++) {
    scores[lag] = corr(lag);
    if (scores[lag] > maxScore) maxScore = scores[lag];
  }
  for (let lag = minLag; lag <= maxLag && lag < v.length; lag++) {
    if (scores[lag] >= 0.8 * maxScore) return { lag, score: scores[lag] };
  }
  return { lag: 0, score: 0 };
}

interface Peak { pos: number; val: number }

function findPeaks(v: Float32Array, minDist: number, minProm: number): Peak[] {
  const raw: Peak[] = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] >= v[i - 1] && v[i] > v[i + 1] && v[i] > 0) raw.push({ pos: i, val: v[i] });
  }
  raw.sort((a, b) => b.val - a.val);
  const chosen: Peak[] = [];
  for (const p of raw) {
    if (chosen.every((q) => Math.abs(q.pos - p.pos) >= minDist)) chosen.push(p);
  }
  chosen.sort((a, b) => a.pos - b.pos);
  if (chosen.length === 0) return [];
  const top = chosen[0].val;
  return chosen.filter((p) => p.val >= top * minProm);
}

/** Regularna veriga: samo vrhovi z razmaki ≈ pitch. */
function regularChain(peaks: Peak[], pitch: number): Peak[] {
  if (peaks.length <= 2 || pitch <= 0) return peaks;
  let bestChain: Peak[] = [];
  let cur: Peak[] = [];
  for (const p of peaks) {
    if (cur.length === 0) cur = [p];
    else {
      const g = p.pos - cur[cur.length - 1].pos;
      if (g >= pitch * 0.55 && g <= pitch * 2.1) cur.push(p);
      else {
        if (cur.length > bestChain.length) bestChain = cur;
        cur = [p];
      }
    }
  }
  if (cur.length > bestChain.length) bestChain = cur;
  return bestChain.length >= 3 ? bestChain : peaks;
}

/** |gx·cosθ + gy·sinθ| po binih u = x·cosθ + y·sinθ (povprečje po binu). */
function projectGradient(
  gx: Float32Array, gy: Float32Array, w: number, h: number, thetaDeg: number,
): Float32Array {
  const th = (thetaDeg * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  const minU = Math.min(0, w * ct, h * st, w * ct + h * st);
  const maxU = Math.max(0, w * ct, h * st, w * ct + h * st);
  const nBins = Math.max(8, Math.ceil(maxU - minU) + 1);
  const sum = new Float32Array(nBins);
  const cnt = new Float32Array(nBins);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const proj = Math.abs(gx[i] * ct + gy[i] * st);
      if (proj < 1) continue;
      const u = x * ct + y * st - minU;
      const b = Math.round(u);
      if (b >= 0 && b < nBins) { sum[b] += proj; cnt[b] += 1; }
    }
  }
  const prof = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) prof[b] = cnt[b] > 0 ? sum[b] / cnt[b] : 0;
  return prof;
}

function detrendNorm(prof: Float32Array): { det: Float32Array; maxV: number } {
  const win = Math.max(24, Math.round(prof.length / 8));
  const trend = movingMean(prof, win);
  const det = new Float32Array(prof.length);
  let maxV = 0;
  for (let i = 0; i < prof.length; i++) {
    det[i] = Math.max(0, prof[i] - trend[i]);
    if (det[i] > maxV) maxV = det[i];
  }
  if (maxV > 0) for (let i = 0; i < prof.length; i++) det[i] /= maxV;
  return { det, maxV };
}

function angleScore(prof: Float32Array, minPitchPx: number): { det: Float32Array; score: number; maxV: number } {
  const { det, maxV } = detrendNorm(prof);
  if (maxV <= 0) return { det, score: 0, maxV: 0 };
  const minLag = Math.max(8, minPitchPx);
  const maxLag = Math.max(minLag + 4, Math.floor(det.length / 4));
  const acf = bestPeriod(det, minLag, Math.min(maxLag, 600));
  const score = acf.score * (maxV / 255);
  return { det, score, maxV };
}

const F_ANGLE_STEP = 5;
const F_ANGLE_FINE = 1;
const F_MIN_PITCH_PX = 14;
const F_MAX_LINES = 20;

/**
 * Zaznaj linije obloge na fasadi (Radonova projekcija gradientov,
 * isti dokazani pristop kot deck-analysis). Obloga ima ritem v ENI
 * smeri — iščemo najboljši en koter.
 */
export function analyzeFasadaLines(img: RgbaImage): FasadaLinesResult {
  const { width: w, height: h } = img;
  const warnings: string[] = [];
  const base: FasadaLinesResult = {
    ok: false, cladAngleDeg: 0, pitchPx: null, amplitude: 0, pitchCv: 1,
    linesVisible: null, orientation: 'neznano', lines: [],
    confidence: 0, verdict: 'nizka', warnings,
  };
  if (w < 80 || h < 80) {
    warnings.push('Slika je premajhna za analizo obloge.');
    return base;
  }

  const g = toGray(img);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] = g[i + 1] - g[i - 1];
      gy[i] = g[i + w] - g[i - w];
    }
  }

  // 1) grobo + 2) fina izbira kota (osnova fiksna)
  let bestA = 0, bestScore = -1, bestDet: Float32Array | null = null, bestMaxV = 0;
  for (let a = 0; a < 180; a += F_ANGLE_STEP) {
    const sc = angleScore(projectGradient(gx, gy, w, h, a), F_MIN_PITCH_PX);
    if (sc.score > bestScore) { bestScore = sc.score; bestA = a; bestDet = sc.det; bestMaxV = sc.maxV; }
  }
  const baseA = bestA;
  for (let d = -4; d <= 4; d += F_ANGLE_FINE) {
    const a = ((baseA + d) % 180 + 180) % 180;
    const sc = angleScore(projectGradient(gx, gy, w, h, a), F_MIN_PITCH_PX);
    if (sc.score > bestScore) { bestScore = sc.score; bestA = a; bestDet = sc.det; bestMaxV = sc.maxV; }
  }
  if (!bestDet) {
    warnings.push('Slike nisem uspel analizirati.');
    return base;
  }
  const amplitude = bestMaxV / 255;

  // 3) pitch: ACF → vrhovi → združevanje dvojnih → regularna veriga
  const prof = bestDet;
  const acf = bestPeriod(prof, Math.max(8, F_MIN_PITCH_PX), Math.min(Math.floor(prof.length / 3), 600));
  const minDist = Math.max(F_MIN_PITCH_PX, acf.score > 0.15 ? Math.round(acf.lag * 0.7) : F_MIN_PITCH_PX);
  let peaks = findPeaks(prof, minDist, 0.22);
  const pitchGuess = acf.score > 0.15 ? acf.lag : (peaks.length > 1 ? median(peaks.slice(1).map((q, i) => q.pos - peaks[i].pos)) : 0);
  if (peaks.length > 2 && pitchGuess > 0) {
    const merged: Peak[] = [];
    for (const p of peaks) {
      const last = merged[merged.length - 1];
      if (last && p.pos - last.pos < pitchGuess * 0.55) {
        if (p.val > last.val) merged[merged.length - 1] = p;
      } else merged.push(p);
    }
    peaks = merged;
  }
  peaks = regularChain(peaks, pitchGuess);
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i].pos - peaks[i - 1].pos);
  const pitch = median(gaps) || pitchGuess;
  const meanPitch = gaps.length > 0 ? gaps.reduce((s, v) => s + v, 0) / gaps.length : pitch;
  const cv = meanPitch > 0 ? Math.sqrt(gaps.reduce((s, v) => s + (v - meanPitch) ** 2, 0) / gaps.length) / meanPitch : 1;

  if (!pitch || pitch <= F_MIN_PITCH_PX || amplitude < 0.18) {
    warnings.push('Ritema obloge nisem zaznal — gladki omet ali preveč poševna fotka? Površino lahko vseeno izmeriš po oglisčih.');
    return base;
  }
  if (pitch < F_MIN_PITCH_PX * 1.5) warnings.push('Zelo ozek ritem — to je lahko tekstura, ne obloga. Preveri ročno.');

  // 4) smer linij + orientacija (θ projekcije je NORMALA linij)
  const cladAngleDeg = (bestA + 90) % 180;
  const mod = ((cladAngleDeg % 90) + 90) % 90;
  const orientation: CladOrientation = mod <= 12 ? 'vodoravno' : mod >= 78 ? 'navpično' : 'neznano';
  if (orientation === 'neznano') warnings.push('Linije niso niti vodoravne niti navpične — poševna fotka? Letve računaj ročno (pravokotno na oblogo).');

  // 5) anotacije (črte linij v % slike)
  const th = (bestA * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  const minU = Math.min(0, w * ct, h * st, w * ct + h * st);
  const clipLine = (u: number): CladLinePct | null => {
    const p0x = (u + minU) * ct, p0y = (u + minU) * st;
    const dx = -st, dy = ct;
    const diag = Math.hypot(w, h);
    const inR = (t: number) => {
      const x = p0x + t * dx, y = p0y + t * dy;
      return x >= 0 && x <= w && y >= 0 && y <= h;
    };
    let a: number | null = null;
    let b: number | null = null;
    for (let t = -diag / 2; t <= diag / 2; t += 4) { if (inR(t)) { a = t; break; } }
    for (let t = diag / 2; t >= -diag / 2; t -= 4) { if (inR(t)) { b = t; break; } }
    if (a === null || b === null) return null;
    const A = { x: ((p0x + a * dx) / w) * 100, y: ((p0y + a * dy) / h) * 100 };
    const B = { x: ((p0x + b * dx) / w) * 100, y: ((p0y + b * dy) / h) * 100 };
    return { x1: A.x, y1: A.y, x2: B.x, y2: B.y };
  };
  const lines: CladLinePct[] = [];
  for (const pk of peaks.slice(0, F_MAX_LINES)) {
    const l = clipLine(pk.pos);
    if (l) lines.push(l);
  }

  // 6) zanesljivost
  let conf = 30;
  if (amplitude > 0.35) conf += 15;
  else if (amplitude > 0.25) conf += 8;
  if (cv < 0.15) conf += 15;
  else if (cv < 0.3) conf += 8;
  if (peaks.length >= 5) conf += 10;
  if (orientation !== 'neznano') conf += 10;
  conf = Math.max(10, Math.min(97, Math.round(conf)));
  const verdict = conf >= 75 ? 'visoka' : conf >= 50 ? 'srednja' : 'nizka';

  return {
    ok: true, cladAngleDeg, pitchPx: pitch, amplitude, pitchCv: cv,
    linesVisible: peaks.length, orientation, lines, confidence: conf, verdict, warnings,
  };
}

// ─── 2) Rez poligona z pravokotnikom (Sutherland–Hodgman) ────

/**
 * Rez konveksnega poligona (v px) z osno poravnanim pravokotnikom.
 * Klasičen Sutherland–Hodgman — 4 urejene rezalne ravnine.
 */
export function clipPolygonRect(poly: XY[], rect: { x0: number; y0: number; x1: number; y1: number }): XY[] {
  let out = poly;
  const clip = (keep: (a: XY, b: XY) => boolean, intersect: (a: XY, b: XY) => XY) => {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i];
      const prev = inp[(i + inp.length - 1) % inp.length];
      const cIn = keep(cur, cur);
      const pIn = keep(prev, prev);
      if (cIn) {
        if (!pIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (pIn) {
        out.push(intersect(prev, cur));
      }
    }
  };
  const lerpX = (a: XY, b: XY, x: number): XY => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1e-9) });
  const lerpY = (a: XY, b: XY, y: number): XY => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9), y });
  clip((p) => p.x >= rect.x0, (a, b) => lerpX(a, b, rect.x0));
  clip((p) => p.x <= rect.x1, (a, b) => lerpX(a, b, rect.x1));
  clip((p) => p.y >= rect.y0, (a, b) => lerpY(a, b, rect.y0));
  clip((p) => p.y <= rect.y1, (a, b) => lerpY(a, b, rect.y1));
  return out;
}

function shoelacePx(poly: XY[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// ─── 3) Stena: 4 oglisča → širina × višina × površina − odprtine ──

export interface FasadaOpeningPx {
  /** Pravokotnik odprtine v px delovne slike. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  label?: string;
}

export interface FasadaWallResult {
  ok: boolean;
  /** Dolžina stene (vodoravni par stranic) v cm. */
  wallWidthCm: number | null;
  /** Višina stene (navpični par stranic) v cm. */
  wallHeightCm: number | null;
  /** Bruto površina štirikotnika v m². */
  grossM2: number | null;
  /** Vsota odprtin ZNOTRAJ stene v m². */
  openingsM2: number;
  /** Št. odprtin, ki so vsaj delno znotraj stene. */
  openingsCount: number;
  /** Št. odprtin, ki so IZVEN stene (preskočene). */
  openingsOutside: number;
  /** Neto površina = bruto − odprtine (m²). */
  netM2: number | null;
  warnings: string[];
}

export const WALL_MIN_CM = 40;
export const WALL_MAX_CM = 6000;

/**
 * Površina stene iz 4 oglisč + odštevanje odprtin (rez poligona).
 * Širina = povprečje para stranic z bolj vodoravno smerjo, višina =
 * povprečje bolj navpičnega para (deluje tudi za višje kot široke stene).
 */
export function fasadaWallArea(
  quadPct: XY[],
  pxPerCm: number | null,
  imgSize: ImgSize,
  openings: FasadaOpeningPx[] = [],
): FasadaWallResult {
  const warnings: string[] = [];
  const base: FasadaWallResult = {
    ok: false, wallWidthCm: null, wallHeightCm: null, grossM2: null,
    openingsM2: 0, openingsCount: 0, openingsOutside: 0, netM2: null, warnings,
  };
  if (quadPct.length !== 4) {
    warnings.push('Potrebna so točno 4 oglisča stene.');
    return base;
  }
  if (quadPct.some((p) => p.x < -2 || p.x > 102 || p.y < -2 || p.y > 102 || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    warnings.push('Oglisča so izven slike — klikni znova 4 vogale stene.');
    return base;
  }
  const quadPx = orderQuad(quadPct.map((p) => pctToPx(p, imgSize)));
  const px2 = shoelacePx(quadPx);
  if (px2 < 0.005 * imgSize.w * imgSize.h) {
    warnings.push('Oglisča so preblizu skupaj — klikni 4 vogale stene.');
    return base;
  }
  if (!pxPerCm || pxPerCm <= 0) {
    warnings.push('Brez kalibracije: površine ne morem izmeriti — umeri po referenčnem objektu (vrata/okno).');
    return base;
  }

  // strani + klasifikacija horizontalen/navpičen par po smeri
  const sidesPx: number[] = [];
  const horiz: number[] = [];
  const vert: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quadPx[i];
    const b = quadPx[(i + 1) % 4];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const len = Math.hypot(dx, dy);
    sidesPx.push(len);
    if (dx >= dy) horiz.push(len); else vert.push(len);
  }
  // nasprotni si stranici iste smeri povprečeni (perspektiva: bližnja daljša)
  const pairH = horiz.length === 2 ? (horiz[0] + horiz[1]) / 2 : horiz.length === 1 ? horiz[0] * 1 : 0;
  const pairV = vert.length === 2 ? (vert[0] + vert[1]) / 2 : vert.length === 1 ? vert[0] * 1 : 0;
  // zaščita: če klasifikacija ni 2+2 (skrajno poševno), padaj na max/min
  let widthPx = pairH, heightPx = pairV;
  if (horiz.length !== 2 || vert.length !== 2) {
    const s = [...sidesPx].sort((a, b) => b - a);
    widthPx = (s[0] + s[1]) / 2;
    heightPx = (s[2] + s[3]) / 2;
  }
  const wallWidthCm = Math.round((widthPx / pxPerCm) * 10) / 10;
  const wallHeightCm = Math.round((heightPx / pxPerCm) * 10) / 10;

  // bruto površina štirikotnika (Shoelace, enoten pxPerCm)
  const grossM2 = Math.round((px2 / (pxPerCm * pxPerCm)) / 10_000 * 100) / 100;

  // odprtine: rez poligona stene vsakim pravokotnikom
  let openingsM2 = 0;
  let inside = 0;
  let outside = 0;
  for (const op of openings) {
    const clipped = clipPolygonRect(quadPx, op.rect);
    if (clipped.length < 3) { outside++; continue; }
    const a = shoelacePx(clipped);
    if (a <= 1) { outside++; continue; }
    openingsM2 += a / (pxPerCm * pxPerCm) / 10_000;
    inside++;
  }
  openingsM2 = Math.round(openingsM2 * 100) / 100;
  const netM2 = Math.max(0, Math.round((grossM2 - openingsM2) * 100) / 100);

  if (wallWidthCm > WALL_MAX_CM || wallHeightCm > WALL_MAX_CM) warnings.push('Izmerjena stena je nenavadno velika (> 60 m) — preveri kalibracijo.');
  if (wallWidthCm < WALL_MIN_CM || wallHeightCm < WALL_MIN_CM) warnings.push('Izmerjena stena je nenavadno majhna (< 0,4 m) — preveri kalibracijo ali oglisča.');
  if (openingsM2 >= grossM2 * 0.9 && openingsM2 > 0) warnings.push('Odprtine pokrijejo > 90 % stene — preveri, če si kliknil prava oglisča.');
  if (outside > 0) warnings.push(`${outside} odprtin(a) je povsem izven stene — preskočene.`);

  return {
    ok: true, wallWidthCm, wallHeightCm, grossM2,
    openingsM2, openingsCount: inside, openingsOutside: outside,
    netM2, warnings,
  };
}

// ─── 4) Prefill kalkulatorja fasade ─────────────────────────

export interface FasadaPrefill {
  /** Dolžina stene v m (kalkulator: facadePerimeter). */
  facadePerimeter?: number;
  /** Višina stene v m (kalkulator: facadeHeight). */
  facadeHeight?: number;
  /** Odprtine v m² (kalkulator: openingsM2). */
  openingsM2?: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Čista preslikava izmere → CraftInputs kalkulatorja fasade.
 * Kalkulator računa bruto = facadePerimeter × facadeHeight, zato
 * dolžino stene vpišemo v facadePerimeter (za celo hišo uporabnik
 * doda ostale stene oz. vpiše obod ročno).
 */
export function fasadaPrefill(w: FasadaWallResult): FasadaPrefill {
  if (!w.ok || w.wallWidthCm === null || w.wallHeightCm === null) return {};
  const out: FasadaPrefill = {
    facadePerimeter: r2(w.wallWidthCm / 100),
    facadeHeight: r2(w.wallHeightCm / 100),
  };
  if (w.openingsM2 > 0) out.openingsM2 = r2(w.openingsM2);
  return out;
}
