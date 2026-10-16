// ─── WPC terasa: samodejna analiza desk s fotke ─────────────
// Čisto skriptno, brez AI (raziskava: research/task29).
//  • Deske = vzporedne črte v ENI smeri (pravokotno ni strukture — čela so
//    naključno razporejena) → iščemo NAJBOLJŠI EN koter (Radonova projekcija
//    gradientov po kotih, korak 5°, fina izbira ±4° po 1°), NE ortogonalni par.
//  • Reža med deskami = temna dolina v profilu svetlosti → širina na pol
//    globine (FWHM); pitch (deska + reža) iz ACF + regularne verige vrhov
//    (dokazano Task 26/27). Širina deske = pitch − reža.
//  • Kalibracija: referenčni objekt (pxPerCm) ALI znana deska (pitchCm =
//    boardCm / (1 − gapPx/pitchPx) — razmerje reže v isti sliki je
//    perspektivno invariantno, brez predpostavke o reži).
//  • Snap na standardne širine WPC desk (tržna praksa, toleranca 8 %).
//  • Površina: 4 oglišča terase → strani + Shoelace z enotnim pxPerCm
//    (orientacijska mera — enako kot ostale fotomeritve, disclaimer 2–8 %).
//  • Predlog razmaka nosilcev: SAMO iz ROKSALove objave (spodnji rob pasu
//    33–35 cm za podložne letve terase, `roksal-span-rules`). Prejšnji
//    »ravno 0,40 / diagonalno 0,30« je bil navedek proizvajalcev brez vira in
//    je montera spravil čez ROKSALovo mejo; ROKSAL za diagonalno ne objavlja
//    ničesar, zato oba primera dobita isto utemeljeno vrednost.
//
// Vse čiste funkcije (brez DOM) — testabilno v bun (tests/verify).

import type { RgbaImage } from './bar-count';
import type { ImgSize, XY } from './measure-geometry';
import { pctToPx } from './measure-geometry';
import { orderQuad } from './homography';
import { maxAllowedSpan } from './roksal-span-rules';

/** Predlog razmaka nosilcev v metrih = spodnji rob (vežoči rob) ROKSALovega
 *  objavljenega pasu za podložne letve terase. Izpeljan iz pravila, ne vklesan. */
export const JOIST_SUGGEST_M = maxAllowedSpan({ family: 'terasa', context: 'battens' }).maxSpanCm / 100;

export type { RgbaImage };

// ─── Javni tipi ─────────────────────────────────────────────

export type DeckCalibSource = 'reference' | 'known-board' | 'none';

export interface DeckAnalysisInput {
  img: RgbaImage;
  /** Kalibracija iz referenčnega objekta (delovni px na cm) — izbirno. */
  pxPerCm?: number | null;
  /** Znana širina deske v cm (npr. 14) → obratna kalibracija. */
  knownBoardCm?: number | null;
}

export interface DeckLinePct {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DeckResult {
  ok: boolean;
  /** Kot smeri desk mod 180° (0 = vodoravno, 90 = navpično). */
  boardAngleDeg: number;
  /** Korak desk (deska + reža, središče–središče) v px. */
  pitchPx: number | null;
  /** Širina reže v px (FWHM doline svetlosti) ali null. */
  gapPx: number | null;
  /** Moč vzorca (0–1). */
  amplitude: number;
  /** Variacijski koeficient razmakov (manjši = bolj pravilno). */
  pitchCv: number;
  /** Št. vidnih rež (≈ vidnih desk − 1). */
  boardsVisible: number | null;
  /** Anotacije rež na sliki (v % — za SVG overlay). */
  lines: DeckLinePct[];
  pxPerCm: number | null;
  calibSource: DeckCalibSource;
  /** Širina deske (obraza, brez reže) v cm. */
  boardCm: number | null;
  /** Širina reže v cm. */
  gapCm: number | null;
  /** Snap na standardno širino WPC deske (ali null, če izven tolerance 8 %). */
  snapBoard: number | null;
  /** Deske tečejo diagonalno (kot mod 90 > 12°) — privzetek: kamera frontalna s hiše. */
  diagonal: boolean;
  /** Predlog razmaka nosilcev (m): diagonalno 0,3 / ravno 0,4. */
  joistSpacingSuggestM: number;
  confidence: number;
  verdict: 'visoka' | 'srednja' | 'nizka';
  warnings: string[];
}

// ─── Notranje pomo (dokazane v tile-grid / stair-profile) ───

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

/** Pearsonova avtokorelacija (normalizirana [-1,1]) — NAJMANJŠI lag z ≥ 0,8× maksimuma. */
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

/** Regularna veriga: samo vrhovi z razmaki ≈ pitch (nepravilne linije izpadejo). */
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

/** Detrend + normalizacija profila na [0,1]. */
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

// ─── Projekcija po kotih (Radon po redkih kotih) ────────────

/** Projekcija vrednosti `val` po binih u = x·cosθ + y·sinθ (povprečje po binu). */
function projectValues(
  val: Float32Array, w: number, h: number, thetaDeg: number,
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
      const u = x * ct + y * st - minU;
      const b = Math.round(u);
      if (b >= 0 && b < nBins) { sum[b] += val[y * w + x]; cnt[b] += 1; }
    }
  }
  const prof = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) prof[b] = cnt[b] > 0 ? sum[b] / cnt[b] : 0;
  return prof;
}

/**
 * Projekcija gradienta na NORMALO θ (reža je temna črta — gradient najmočnejši
 * pravokotno nanjo); prof prevzame |gx·cosθ + gy·sinθ|.
 */
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
      if (proj < 1) continue; // šum
      const u = x * ct + y * st - minU;
      const b = Math.round(u);
      if (b >= 0 && b < nBins) { sum[b] += proj; cnt[b] += 1; }
    }
  }
  const prof = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) prof[b] = cnt[b] > 0 ? sum[b] / cnt[b] : 0;
  return prof;
}

/** Ocena mreže v kotu: Pearsonova ACF vrhov × relativna amplituda (0–1). */
function angleScore(prof: Float32Array, minPitchPx: number): { det: Float32Array; score: number; maxV: number } {
  const { det, maxV } = detrendNorm(prof);
  if (maxV <= 0) return { det, score: 0, maxV: 0 };
  const minLag = Math.max(8, minPitchPx);
  const maxLag = Math.max(minLag + 4, Math.floor(det.length / 4));
  const acf = bestPeriod(det, minLag, Math.min(maxLag, 600));
  const score = acf.score * (maxV / 255);
  return { det, score, maxV };
}

/**
 * Širina reže iz profila SVETLOSTI (FWHM doline): reža = temna dolina med
 * ploščicama; sprehod od dna doline ven, dokler svetlost ne doseže
 * (ploščaj + dolina)/2. Robustno na šum (profil povprečen čez vse deske).
 */
function gapByValley(bright: Float32Array, valleyPos: number, pitch: number): number | null {
  // lokalna maksimuma levo/desno (znotraj ±pitch)
  const half = Math.max(4, Math.round(pitch / 2));
  let lMax = -Infinity, rMax = -Infinity;
  for (let d = 2; d <= half; d++) {
    if (valleyPos - d >= 0) lMax = Math.max(lMax, bright[valleyPos - d]);
    if (valleyPos + d < bright.length) rMax = Math.max(rMax, bright[valleyPos + d]);
  }
  if (!Number.isFinite(lMax) || !Number.isFinite(rMax)) return null;
  const plateau = Math.min(lMax, rMax);
  const depth = plateau - bright[valleyPos];
  if (depth <= 1.5) return null; // reže ni (deske brez vidne vrzeli)
  const thr = bright[valleyPos] + depth / 2;
  let li = valleyPos, ri = valleyPos;
  while (li > 0 && bright[li] < thr && valleyPos - li < half) li--;
  while (ri < bright.length - 1 && bright[ri] < thr && ri - valleyPos < half) ri++;
  const w = ri - li;
  return w > 0 && w < pitch * 0.35 ? w : null;
}

// ─── Snap na standardne širine WPC desk (tržna praksa) ──────

export const STANDARD_BOARD_CM = [10, 12.5, 13.5, 14, 14.5, 15, 16, 19.5, 20];
export const SNAP_TOLERANCE = 0.08;

export function snapBoard(cm: number): number | null {
  if (!Number.isFinite(cm) || cm <= 0) return null;
  let best: { value: number; err: number } | null = null;
  for (const s of STANDARD_BOARD_CM) {
    const err = Math.abs(cm - s) / s;
    if (!best || err < best.err) best = { value: s, err };
  }
  return best && best.err <= SNAP_TOLERANCE ? best.value : null;
}

// ─── Glavna funkcija ────────────────────────────────────────

const ANGLE_STEP = 5;          // grobo iskanje kota po 5°
const ANGLE_FINE = 1;          // fina izbira ±4° po 1°
const MIN_PITCH_PX = 14;       // min korak desk v delovni sliki
const MAX_LINES = 24;          // anotacij rež

export function analyzeDeck(input: DeckAnalysisInput): DeckResult {
  const { img } = input;
  const { width: w, height: h } = img;
  const warnings: string[] = [];
  const base: DeckResult = {
    ok: false, boardAngleDeg: 0, pitchPx: null, gapPx: null, amplitude: 0, pitchCv: 1,
    boardsVisible: null, lines: [], pxPerCm: null, calibSource: 'none',
    boardCm: null, gapCm: null, snapBoard: null, diagonal: false,
    joistSpacingSuggestM: JOIST_SUGGEST_M, confidence: 0, verdict: 'nizka', warnings,
  };
  if (w < 80 || h < 80) {
    warnings.push('Slika je premajhna za analizo desk.');
    return base;
  }

  // gradienti (centralne diference) + svetlost
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

  // 1) grobo iskanje NAJBOLJŠEGA ENEGA kota (deske nimajo pravokotne strukture)
  let bestA = 0, bestScore = -1, bestDet: Float32Array | null = null, bestMaxV = 0;
  for (let a = 0; a < 180; a += ANGLE_STEP) {
    const prof = projectGradient(gx, gy, w, h, a);
    const sc = angleScore(prof, MIN_PITCH_PX);
    if (sc.score > bestScore) { bestScore = sc.score; bestA = a; bestDet = sc.det; bestMaxV = sc.maxV; }
  }

  // 2) fina izbira ±4° po 1° (osnova FIKSIRANA — brez drsenja med iteracijo)
  const baseA = bestA;
  for (let d = -4; d <= 4; d += ANGLE_FINE) {
    const a = ((baseA + d) % 180 + 180) % 180;
    const prof = projectGradient(gx, gy, w, h, a);
    const sc = angleScore(prof, MIN_PITCH_PX);
    if (sc.score > bestScore) { bestScore = sc.score; bestA = a; bestDet = sc.det; bestMaxV = sc.maxV; }
  }
  if (!bestDet) {
    warnings.push('Slike nisem uspel analizirati.');
    return base;
  }
  const amplitude = bestMaxV / 255;

  // 3) pitch: ACF → vrhovi → združevanje dvojnih robov → regularna veriga
  const prof = bestDet;
  const acf = bestPeriod(prof, Math.max(8, MIN_PITCH_PX), Math.min(Math.floor(prof.length / 3), 600));
  const minDist = Math.max(MIN_PITCH_PX, acf.score > 0.15 ? Math.round(acf.lag * 0.7) : MIN_PITCH_PX);
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

  if (!pitch || pitch <= MIN_PITCH_PX || amplitude < 0.18) {
    warnings.push('Vrst desk nisem zaznal — poskusi z bolj frontno fotko terase (reže med deskami naj bodo vidne).');
    return base;
  }
  if (pitch < MIN_PITCH_PX * 1.5) warnings.push('Zelo ozki razmiki — rezultat preveri ročno (morda tekstura, ne deske).');

  // 4) širina reže: profil SVETLOSTI po istem kotu → FWHM doline na položajih rež
  const bright = projectValues(g, w, h, bestA);
  const minU = (() => {
    const th = (bestA * Math.PI) / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    return Math.min(0, w * ct, h * st, w * ct + h * st);
  })();
  const gapCandidates: number[] = [];
  for (const pk of peaks) {
    const gw = gapByValley(bright, pk.pos + minU, pitch);
    if (gw !== null) gapCandidates.push(gw);
  }
  // reža mora biti razločljiva na vsaj tretjini rež
  let gapPx: number | null = null;
  if (gapCandidates.length >= Math.max(2, Math.round(peaks.length / 3))) {
    gapPx = median(gapCandidates);
    if (gapPx < 1) gapPx = null;
  }
  if (gapPx === null) warnings.push('Reže med deskami nisem ločil — širina deske vključuje režo (predpostavka 5 mm).');

  // 5) kalibracija
  let pxPerCm = input.pxPerCm && input.pxPerCm > 0.05 && Number.isFinite(input.pxPerCm) ? input.pxPerCm : null;
  let calibSource: DeckCalibSource = pxPerCm ? 'reference' : 'none';
  if (!pxPerCm && input.knownBoardCm && input.knownBoardCm >= 5 && input.knownBoardCm <= 40 && pitch) {
    // razmerje reže/pitch v ISTI sliki je perspektivno invariantno:
    // pitchCm = boardCm / (1 − gapPx/pitchPx)
    const ratio = gapPx !== null ? gapPx / pitch : 0;
    const pitchCm = ratio > 0 && ratio < 0.9
      ? input.knownBoardCm / (1 - ratio)
      : input.knownBoardCm + 0.5;
    pxPerCm = pitch / pitchCm;
    calibSource = 'known-board';
    if (gapPx === null) warnings.push('Kalibracija po znani deski brez izmerjene reže — predpostavljena reža 5 mm.');
  }
  if (!pxPerCm) warnings.push('Brez kalibracije: izpišemo samo smer in razmerja — za cm umeri po referenčnem objektu ali vpiši znano širino deske.');

  let boardCm: number | null = null;
  let gapCm: number | null = null;
  let snap: number | null = null;
  if (pxPerCm) {
    gapCm = gapPx !== null ? gapPx / pxPerCm : 0.5;
    boardCm = (pitch - (gapPx ?? 0.5 * pxPerCm)) / pxPerCm;
    snap = snapBoard(boardCm);
    if (pxPerCm < 0.8) warnings.push('Nizka ločljivost na desko — kalibracija je ohlapna, preveri izmerjeno širino.');
  }

  // 6) smer desk + diagonalnost + predlog nosilcev
  //    bestA je NORMALA rež → smer desk = bestA + 90 (mod 180)
  const boardAngleDeg = (bestA + 90) % 180;
  const angleMod = boardAngleDeg % 90;
  const diagonal = angleMod > 12;
  // Diagonalna vgradnja ne sme pomeniti druge ROKSALove meje — za njo ni
  // objave, zato predlog ostane utemeljena vrednost iz pasu.
  const joistSpacingSuggestM = JOIST_SUGGEST_M;

  // 7) anotacije (črte rež v % slike, omejeno število)
  const clipLine = (thetaDeg: number, u: number): DeckLinePct | null => {
    const th = (thetaDeg * Math.PI) / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    const p0x = (u + minU) * ct, p0y = (u + minU) * st;
    const dx = -st, dy = ct;
    const diag = Math.hypot(w, h);
    const inR = (t: number) => {
      const x = p0x + t * dx, y = p0y + t * dy;
      return x >= 0 && x <= w && y >= 0 && y <= h;
    };
    const stepT = 4;
    let a: number | null = null;
    let b: number | null = null;
    for (let t = -diag / 2; t <= diag / 2; t += stepT) {
      if (inR(t)) { a = t; break; }
    }
    for (let t = diag / 2; t >= -diag / 2; t -= stepT) {
      if (inR(t)) { b = t; break; }
    }
    if (a === null || b === null) return null;
    const pt = (t: number) => ({ x: ((p0x + t * dx) / w) * 100, y: ((p0y + t * dy) / h) * 100 });
    const A = pt(a), B = pt(b);
    return { x1: A.x, y1: A.y, x2: B.x, y2: B.y };
  };
  const lines: DeckLinePct[] = [];
  for (const pk of peaks.slice(0, MAX_LINES)) {
    const l = clipLine(bestA, pk.pos);
    if (l) lines.push(l);
  }

  // 8) opozorila
  if (cv > 0.25) warnings.push('Neenakomerni razmaki vrst — rezultat preveri ročno (mogoče perspektiva ali mešani vzorec).');
  if (pxPerCm && boardCm !== null && snap === null) warnings.push(`Izmerjena širina ${boardCm.toFixed(1).replace('.', ',')} cm ne ujema z uveljavljenimi WPC deskami — uporabi izmerjeno ali preveri kalibracijo.`);
  if (pxPerCm && boardCm !== null && snap !== null && Math.abs(snap - 14) > 0.01) warnings.push(`Kalkulator WPC terase računa vrste z 140 mm deskami — fotka kaže ≈ ${snap * 10} mm (prilagodi širino/število vrst ročno).`);

  // 9) zanesljivost
  let conf = 30;
  if (amplitude > 0.35) conf += 15;
  else if (amplitude > 0.25) conf += 8;
  if (cv < 0.15) conf += 15;
  else if (cv < 0.3) conf += 8;
  if (peaks.length >= 5) conf += 10;
  if (pxPerCm) conf += 10;
  if (gapPx !== null) conf += 8;
  conf = Math.max(10, Math.min(97, Math.round(conf)));
  const verdict = conf >= 75 ? 'visoka' : conf >= 50 ? 'srednja' : 'nizka';

  return {
    ok: true, boardAngleDeg, pitchPx: pitch, gapPx, amplitude, pitchCv: cv,
    boardsVisible: peaks.length, lines, pxPerCm, calibSource, boardCm, gapCm,
    snapBoard: snap, diagonal, joistSpacingSuggestM, confidence: conf, verdict, warnings,
  };
}

// ─── Površina terase iz 4 oglišč ────────────────────────────

export interface DeckQuadResult {
  ok: boolean;
  /** Dolžine strani v cm (urni vrstni red) — brez kalibracije prazno. */
  sidesCm: number[];
  /** Dolžina (daljša povprečna stranica) v cm. */
  lengthCm: number | null;
  /** Širina (krajša povprečna stranica) v cm. */
  widthCm: number | null;
  /** Površina v m² (Shoelace z enotnim pxPerCm). */
  areaM2: number | null;
  warnings: string[];
}

/**
 * Površina/stranice četverokotnika terase z ENOTNIM pxPerCm (orientacijska
 * mera — napaka 2–8 % pri poševni fotki; za natančnost uporabi kalibrirano
 * Ravnino na glavnem platnu). Oglišča se samodejno uredijo v konveksni vrstni red.
 */
export function deckQuadArea(
  quadPct: XY[],
  pxPerCm: number | null,
  imgSize: ImgSize,
): DeckQuadResult {
  const warnings: string[] = [];
  const base: DeckQuadResult = { ok: false, sidesCm: [], lengthCm: null, widthCm: null, areaM2: null, warnings };
  if (quadPct.length !== 4) {
    warnings.push('Potrebna so točno 4 oglisča terase.');
    return base;
  }
  // obrambna preverba: oglisča izven slike (> 2 % toleranca) → zavrni
  // (zastarel rect / scroll med kliki lahko da koordinate > 100 %)
  if (quadPct.some((p) => p.x < -2 || p.x > 102 || p.y < -2 || p.y > 102 || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    warnings.push('Oglisča so izven slike — klikni znova 4 vogale terase.');
    return base;
  }
  const quadPx = orderQuad(quadPct.map((p) => pctToPx(p, imgSize)));
  // zavrni degenerirane štirikotnike (< 0,5 % slike)
  let px2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = quadPx[i];
    const b = quadPx[(i + 1) % 4];
    px2 += a.x * b.y - b.x * a.y;
  }
  px2 = Math.abs(px2) / 2;
  if (px2 < 0.005 * imgSize.w * imgSize.h) {
    warnings.push('Oglišča so preblizu skupaj — klikni 4 vogale terase.');
    return base;
  }
  // strani v px
  const sidesPx: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quadPx[i];
    const b = quadPx[(i + 1) % 4];
    sidesPx.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  if (!pxPerCm || pxPerCm <= 0) {
    warnings.push('Brez kalibracije: površine ne morem izmeriti — umeri po referenci ali znani deski.');
    return base;
  }
  const sidesCm = sidesPx.map((s) => Math.round((s / pxPerCm) * 10) / 10);
  // nasprotujoči si stranici povprečeni (perspektiva: bližnja je daljša)
  const pairA = (sidesCm[0] + sidesCm[2]) / 2;
  const pairB = (sidesCm[1] + sidesCm[3]) / 2;
  const lengthCm = Math.round(Math.max(pairA, pairB) * 10) / 10;
  const widthCm = Math.round(Math.min(pairA, pairB) * 10) / 10;
  const areaM2 = Math.round((px2 / (pxPerCm * pxPerCm)) / 10_000 * 100) / 100;
  if (lengthCm > 4000 || widthCm > 4000) warnings.push('Izmerjene stranice so nenavadno velike (> 40 m) — preveri kalibracijo.');
  if (lengthCm < 50 || widthCm < 50) warnings.push('Izmerjene stranice so nenavadno majhne (< 0,5 m) — preveri kalibracijo ali oglisča.');
  return { ok: true, sidesCm, lengthCm, widthCm, areaM2, warnings };
}
