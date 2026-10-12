// ─── Keramična mreža: samodejna analiza ploščic s fotke ──────
// Čisto skriptno, brez AI (raziskava: research/task27).
//  • Fuge = pravilna mreža črt → projekcija gradientov po kandidatnih
//    kotih (Radon po redkih kotih, korak 5°); moč mreže v kotu = ACF
//    vrhov profila × amplituda. Dominanten par (θ, θ+90°) = smeri fug.
//  • Pitch (korak mreže = ploščica + fuga) iz ACF + regularne verige
//    vrhov (dokazano v Task 26 — odporno na okna/ročaje/kopalniške
//    dodatke).
//  • Vzorec polaganja: dominanta ≈ 0/90° → fuge so 0/90 — ravno, running
//    bond ALI ribja kost. Razlikovanje po ZVEZNOSTI fug (delež pokritosti
//    linije fuge): stack → obe smeri zvezni; running bond → horizontalna
//    zvezna, vertikalna prekinjena; herringbone → OBE smeri prekinjene
//    (~50 %, ker fuge pripadajo izmenično h/v ploščicam). Dominanta ≈ 45°
//    → zasukana mreža = diagonalno (ribja kost nima zasukanih fug).
//  • Kalibracija: referenčni objekt (pxPerCm) ALI znana ploščica
//    (obratno: pxPerCm = pitchPx / tileCm) → izmerjene stranice + snap
//    na standardne formate (EN 14411 tržna praksa, toleranca 8 %).
//  • Odpadek IZHAJA iz vzorca (ravno 10 / diagonalno 15 / ribja kost
//    18 %) — en sam vir resnice ostane pricing.ts.
//
// Vse čiste funkcije (brez DOM) — testabilno v bun (tests/verify).

import type { RgbaImage } from './bar-count';

export type { RgbaImage };

// ─── Javni tipi ─────────────────────────────────────────────

export type TilePattern = 'ravno' | 'diagonalno' | 'ribja-kost';

export type TileCalibSource = 'reference' | 'known-tile' | 'none';

export interface TileGridInput {
  img: RgbaImage;
  /** Kalibracija iz referenčnega objekta (delovni px na cm) — izbirno. */
  pxPerCm?: number | null;
  /** Znana velikost ploščice v cm (npr. 60) → obratna kalibracija. */
  knownTileCm?: number | null;
}

export interface TileLinePct {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 1 = primarna smer, 2 = ortogonalna smer. */
  dir: 1 | 2;
}

export interface TileGridResult {
  ok: boolean;
  pattern: TilePattern;
  /** Ali vzorec dvomi (herringbone vs ravno blizu mej). */
  patternDoubtful: boolean;
  /** Kot mreže mod 90° (0 = ravno, 45 = zasukana). */
  angleDeg: number;
  /** Kot ortogonalne smeri (angleDeg + 90). */
  angleDeg2: number;
  /** Korak mreže (ploščica + fuga) v px po obeh smereh. */
  pitchPx1: number | null;
  pitchPx2: number | null;
  /** Moč mreže (0–1). */
  amplitude: number;
  /** Variacijski koeficient razmakov (manjši = bolj pravilno). */
  pitchCv: number;
  /** Zveznost primarne smeri fug (0–1). */
  continuity: number | null;
  /** Zveznost ortogonalne smeri fug (0–1). */
  continuityH: number | null;
  /** Anotacije fug na sliki (v % — za SVG overlay). */
  lines: TileLinePct[];
  pxPerCm: number | null;
  calibSource: TileCalibSource;
  /** Izmerjen korak mreže (ploščica + fuga) v cm. */
  tileWCm: number | null;
  tileHCm: number | null;
  /** Snap na standardni format (ali null, če izven tolerance 8 %). */
  snapW: number | null;
  snapH: number | null;
  /** Približno št. vidnih ploščic (fuge × fuge). */
  tilesVisible: number | null;
  /** Priporočen odpadek po vzorcu (odvaja pricing.ts iz tilePattern). */
  wastePercent: number;
  confidence: number;
  verdict: 'visoka' | 'srednja' | 'nizka';
  warnings: string[];
}

// ─── Notranje pomoč (ista družina kot stair-profile) ────────

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

/** Pearsonova avtokorelacija (normalizirana [-1,1] — deluje tudi za ozke vrhove).
 *  Vrne NAJMANJŠI lag z korelacijo ≥ 0,8× maksimuma (pri running bond je
 *  polovična perioda fug skoraj enako močna — naj jo podvojitveno pravilo
 *  pretvori v ploščico; pri stack je polovica slabo korelirana in ne zmoti). */
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

/** Pearsonova ACF vrednost pri danem lagu (za primerjavo 2× periode). */
function acfAt(v: Float32Array, lag: number): number {
  if (lag <= 0 || lag >= v.length) return 0;
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= Math.max(1, v.length);
  let sumSqAll = 0;
  for (let i = 0; i < v.length; i++) { const d = v[i] - mean; sumSqAll += d * d; }
  let s = 0, sumSqTail = 0;
  for (let i = 0; i + lag < v.length; i++) {
    s += (v[i] - mean) * (v[i + lag] - mean);
    sumSqTail += (v[i + lag] - mean) ** 2;
  }
  const denom = Math.sqrt(sumSqAll * sumSqTail) || 1;
  return s / denom;
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

// ─── Projekcija gradientov po kotih (Radon po redkih kotih) ──

interface AngleProfile {
  thetaDeg: number;
  det: Float32Array;
  score: number;
  maxV: number;
}

/**
 * Za kot θ (normala na fugo) zgradi profil: bin u = x·cosθ + y·sinθ,
 * vrednost = |projekcija gradienta na smer normale| (fuga je temna črta,
 * gradient je najmočnejši pravokotno nanjo).
 */
function projectAngle(gx: Float32Array, gy: Float32Array, w: number, h: number, thetaDeg: number): Float32Array {
  const th = (thetaDeg * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  // u = x·ct + y·st ∈ [0, w·ct + h·st] — za ct/st < 0 premakni offset
  const minU = Math.min(0, w * ct, h * st, w * ct + h * st);
  const maxU = Math.max(0, w * ct, h * st, w * ct + h * st);
  const nBins = Math.max(8, Math.ceil(maxU - minU) + 1);
  const sum = new Float32Array(nBins);
  const cnt = new Float32Array(nBins);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // projekcija gradienta na normalo (θ): |gx·cosθ + gy·sinθ|
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

// ─── Zveznost fuge (razlikovanje diagonalno vs ribja kost) ──

/**
 * Delež pokritosti linij fug (smer θ, položaji u iz vrhov profila):
 * vzorči gradient VZDOLŽ linije — zvezna fuga (diagonalna mreža) =
 * visok delež, prekinjene fuge (herringbone — ploščice sekajo) ~ 0,5.
 */
function groutContinuity(gx: Float32Array, gy: Float32Array, w: number, h: number, thetaDeg: number, peaks: Peak[]): number {
  if (peaks.length === 0) return 0;
  const th = (thetaDeg * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  const minU = Math.min(0, w * ct, h * st, w * ct + h * st);
  const diag = Math.hypot(w, h);
  // prag gradienta: 0,85 × MEDIANA POZITIVNIH gradientov (ravna notranjost
  // ploščic = 0 gradienta, zato percentili po celotni sliki ne delujejo;
  // korak 2, da robovi fug niso preskočeni — robovi so na posameznih px)
  const sample: number[] = [];
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const m = Math.hypot(gx[i], gy[i]);
      if (m > 1) sample.push(m);
    }
  }
  sample.sort((a, b) => a - b);
  const thr = sample.length > 0 ? median(sample) * 0.85 : Infinity;
  const coverages: number[] = [];
  for (const pk of peaks.slice(0, 12)) {
    const u = pk.pos + minU;
    const p0x = u * ct, p0y = u * st;
    let hit = 0, tot = 0;
    for (let t = -diag / 2; t < diag / 2; t += 2) {
      const x = Math.round(p0x - t * st);
      const y = Math.round(p0y + t * ct);
      if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;
      const i = y * w + x;
      tot++;
      if (Math.hypot(gx[i], gy[i]) >= thr) hit++;
    }
    if (tot >= 30) coverages.push(hit / tot);
  }
  if (coverages.length === 0) return 0;
  return median(coverages);
}

// ─── Snap na standardne formate (EN 14411 / tržna praksa) ───

export const STANDARD_TILE_CM = [10, 15, 20, 25, 30, 33, 40, 45, 50, 60, 75, 80, 90, 120, 160, 180, 240, 260, 320];
export const SNAP_TOLERANCE = 0.08;

export function snapTile(cm: number): number | null {
  if (!Number.isFinite(cm) || cm <= 0) return null;
  let best: { value: number; err: number } | null = null;
  for (const s of STANDARD_TILE_CM) {
    const err = Math.abs(cm - s) / s;
    if (!best || err < best.err) best = { value: s, err };
  }
  return best && best.err <= SNAP_TOLERANCE ? best.value : null;
}

// ─── Glavna funkcija ────────────────────────────────────────

const ANGLE_STEP = 5;          // iskanje kota po 5°
const MIN_PITCH_PX = 14;       // min korak mreže v delovni sliki
const MAX_LINES_PER_DIR = 22;  // anotacij na smer

export function analyzeTileGrid(input: TileGridInput): TileGridResult {
  const { img } = input;
  const { width: w, height: h } = img;
  const warnings: string[] = [];
  const base: TileGridResult = {
    ok: false, pattern: 'ravno', patternDoubtful: false, angleDeg: 0, angleDeg2: 90,
    pitchPx1: null, pitchPx2: null, amplitude: 0, pitchCv: 1, continuity: null, continuityH: null, lines: [],
    pxPerCm: null, calibSource: 'none', tileWCm: null, tileHCm: null, snapW: null, snapH: null,
    tilesVisible: null, wastePercent: 10, confidence: 0, verdict: 'nizka', warnings,
  };
  if (w < 80 || h < 80) {
    warnings.push('Slika je premajhna za analizo mreže.');
    return base;
  }

  // gradienti (centralne diference)
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

  // 1) projekcija po vseh kotih
  const minPitch = MIN_PITCH_PX;
  const profiles: AngleProfile[] = [];
  for (let a = 0; a < 180; a += ANGLE_STEP) {
    const prof = projectAngle(gx, gy, w, h, a);
    const sc = angleScore(prof, minPitch);
    profiles.push({ thetaDeg: a, det: sc.det, score: sc.score, maxV: sc.maxV });
  }

  // 2) dominanten ortogonalen par (θ, θ+90)
  let bestPair = { a: 0, sum: -1 };
  for (const p of profiles) {
    const partner = profiles.find((q) => q.thetaDeg === (p.thetaDeg + 90) % 180);
    const sum = p.score + (partner?.score ?? 0);
    if (sum > bestPair.sum) bestPair = { a: p.thetaDeg, sum };
  }
  const theta1 = bestPair.a;                                  // normala primarne smeri
  const theta2 = (theta1 + 90) % 180;                         // normala ortogonalne smeri
  const p1 = profiles.find((q) => q.thetaDeg === theta1)!;
  const p2 = profiles.find((q) => q.thetaDeg === theta2)!;
  const amplitude = Math.max(p1.maxV, p2.maxV) / 255; // relativna moč mreže (0–1)

  // 3) pitch po obeh smereh (ACF → vrhovi → regularna veriga)
  const extractPitch = (prof: Float32Array): { pitch: number | null; peaks: Peak[]; cv: number; score: number; score2x: number } => {
    const acf = bestPeriod(prof, Math.max(8, minPitch), Math.min(Math.floor(prof.length / 3), 600));
    const minDist = Math.max(minPitch, acf.score > 0.15 ? Math.round(acf.lag * 0.7) : minPitch);
    let peaks = findPeaks(prof, minDist, 0.22);
    const pitchGuess = acf.score > 0.15 ? acf.lag : (peaks.length > 1 ? median(peaks.slice(1).map((q, i) => q.pos - peaks[i].pos)) : 0);
    if (peaks.length > 2 && pitchGuess > 0) {
      // združi dvojne robove
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
    const score2x = acf.score > 0 && acf.lag * 2 < prof.length ? acfAt(prof, acf.lag * 2) : 0;
    return { pitch: pitch > minPitch ? pitch : null, peaks, cv, score: acf.score, score2x };
  };

  const r1 = extractPitch(p1.det);
  const r2 = extractPitch(p2.det);

  // šibka ortogonalna smer: ne vsiljuj pitch2 (npr. samo tekstura/robovi)
  let pitch2 = r2.pitch;
  if (pitch2 && p2.maxV < 0.45 * p1.maxV) {
    pitch2 = null;
    warnings.push('Ortogonalna smer mreže ni izrazita — izmerjena je samo primarna stranica.');
  }

  if (!r1.pitch || amplitude < 0.18) {
    warnings.push('Mreže ploščic nisem zaznal — poskusi z bolj frontno fotko ploščic (fuge vidne).');
    return base;
  }

  // 4) vzorec polaganja
  const angle1 = theta1 % 90;                                  // mod 90
  const angle2 = (theta1 % 90) === 0 ? 0 : ((theta1 + 90) % 90);
  const angleMod = Math.min(angle1, angle2);                   // 0…45
  let pattern: TilePattern;
  let patternDoubtful = false;
  let continuity: number | null = null;
  let continuityH: number | null = null;
  if (angleMod > 12) {
    // zasukana mreža (fuge pod 45/135 ali drugim zasukom) → diagonalno
    // (ribja kost ima fuge izključno 0/90 — zasukana mreža je vedno diagonalno)
    pattern = 'diagonalno';
  } else {
    // fuge 0/90 — stack / running bond / herringbone
    continuity = groutContinuity(gx, gy, w, h, theta1, r1.peaks);   // primarna smer
    continuityH = pitch2 ? groutContinuity(gx, gy, w, h, theta2, r2.peaks) : null;  // ortogonalna
    const cMin = Math.min(continuity, continuityH ?? continuity);
    const cMax = Math.max(continuity, continuityH ?? 0);
    const cDiff = Math.abs(continuity - (continuityH ?? continuity));
    if (pitch2 && cMax <= 0.78 && cDiff < 0.15) {
      // OBE smeri podobno prekinjeni → herringbone (fuge pripadajo izmenično
      // h/v ploščicam); running bond ima eno smer zvezno (velika razlika)
      pattern = 'ribja-kost';
    } else {
      pattern = 'ravno';
      if (pitch2 && cMax <= 0.88 && cDiff < 0.15) {
        patternDoubtful = true;
        warnings.push('Vzorec ni povsem jasen (ravno ali ribja kost) — potrdi ročno.');
      }
      // running bond (ena smer zvezna, druga prekinjena) — odpadek enak ravno
    }
  }

  // 4b) dolžina ploščice pri PREKINJENIH fugah primarne smeri (running bond /
  // ribja kost): perioda fug je lahko 1/m ploščice (faze zamaknjene po vrstah).
  //   ribja kost (obe smeri prekinjeni): 2:1 herringbone → ploščica = 2× korak fug
  //   running bond (ena smer zvezna): m = razmerje pitch2/pitchFug (1–3;
  //     pol zamik → 2, tretjina → 3), pri stack brez korekcije (m = 1)
  let pitch1 = r1.pitch;
  if (pitch1 && r1.pitch && pitch2) {
    let mult = 1;
    if (pattern === 'ribja-kost') {
      mult = 2;
    } else if (continuity !== null && continuity <= 0.78) {
      mult = Math.max(1, Math.min(3, Math.round(pitch2 / r1.pitch)));
    }
    if (mult > 1) {
      pitch1 = r1.pitch * mult;
      warnings.push(`Fuge primarne smeri so prekinjene (running bond / ribja kost) — dolžina ploščice ocenjena na ${mult}× koraka fug.`);
    }
  }

  // 5) kalibracija
  let pxPerCm = input.pxPerCm && input.pxPerCm > 0.05 && Number.isFinite(input.pxPerCm) ? input.pxPerCm : null;
  let calibSource: TileCalibSource = pxPerCm ? 'reference' : 'none';
  if (!pxPerCm && input.knownTileCm && input.knownTileCm >= 5 && input.knownTileCm <= 400 && pitch1) {
    pxPerCm = pitch1 / input.knownTileCm;
    calibSource = 'known-tile';
  }
  if (!pxPerCm) warnings.push('Brez kalibracije: izpišemo samo vzorec in razmerje — za cm umeri po referenčnem objektu ali vpiši znano ploščico.');

  let tileWCm: number | null = null;
  let tileHCm: number | null = null;
  let snapW: number | null = null;
  let snapH: number | null = null;
  if (pxPerCm) {
    tileWCm = pitch1! / pxPerCm;
    tileHCm = pitch2 !== null ? pitch2 / pxPerCm : null;
    snapW = snapTile(tileWCm);
    snapH = tileHCm !== null ? snapTile(tileHCm) : null;
    if (pxPerCm < 0.8) warnings.push('Nizka ločljivost na ploščico — kalibracija je ohlapna, preveri izmerjeno velikost.');
  }

  // 6) anotacije (črte fug v % slike, omejeno število)
  const clipLine = (thetaDeg: number, u: number, dir: 1 | 2): TileLinePct | null => {
    const th = (thetaDeg * Math.PI) / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    const minU = Math.min(0, w * ct, h * st, w * ct + h * st);
    const p0x = (u + minU) * ct, p0y = (u + minU) * st;
    const dx = -st, dy = ct;
    const diag = Math.hypot(w, h);
    let t0 = -diag / 2, t1 = diag / 2;
    // poenostavljen clip: vzorči in poišči prvi/zadnji v okvirju
    const inR = (t: number) => {
      const x = p0x + t * dx, y = p0y + t * dy;
      return x >= 0 && x <= w && y >= 0 && y <= h;
    };
    const stepT = 4;
    let a: number | null = null;
    let b: number | null = null;
    for (let t = t0; t <= t1; t += stepT) {
      if (inR(t)) { a = t; break; }
    }
    for (let t = t1; t >= t0; t -= stepT) {
      if (inR(t)) { b = t; break; }
    }
    if (a === null || b === null) return null;
    const pt = (t: number) => ({ x: ((p0x + t * dx) / w) * 100, y: ((p0y + t * dy) / h) * 100 });
    const A = pt(a), B = pt(b);
    return { x1: A.x, y1: A.y, x2: B.x, y2: B.y, dir };
  };
  const lines: TileLinePct[] = [];
  for (const pk of r1.peaks.slice(0, MAX_LINES_PER_DIR)) {
    const l = clipLine(theta1, pk.pos, 1); // clipLine pričakuje NORMALO smeri
    if (l) lines.push(l);
  }
  if (pitch2) {
    for (const pk of r2.peaks.slice(0, MAX_LINES_PER_DIR)) {
      const l = clipLine(theta2, pk.pos, 2);
      if (l) lines.push(l);
    }
  }

  // 7) št. vidnih ploščic + odpadek po vzorcu
  const tilesVisible = pitch2
    ? Math.max(1, r1.peaks.length) * Math.max(1, r2.peaks.length)
    : null;
  const wastePercent = pattern === 'ribja-kost' ? 18 : pattern === 'diagonalno' ? 15 : 10;

  // 8) opozorila
  if (r1.cv > 0.25 || (pitch2 && r2.cv > 0.25)) warnings.push('Neenakomerni razmaki fug — rezultat preveri ročno (mogoče mešani vzorec ali perspektiva).');
  if (pxPerCm && tileWCm !== null && snapW === null) warnings.push(`Izmerjena stranica ${tileWCm.toFixed(1).replace('.', ',')} cm ne ujema z uveljavljenim formatom — uporabi izmerjeno ali preveri kalibracijo.`);

  // 9) zanesljivost
  let conf = 35;
  if (amplitude > 0.35) conf += 15;
  else if (amplitude > 0.25) conf += 8;
  if (r1.cv < 0.15 && pitch2 && r2.cv < 0.15) conf += 15;
  else if (r1.cv < 0.3 && pitch2 && r2.cv < 0.3) conf += 8;
  if (r1.peaks.length >= 5 && (!pitch2 || r2.peaks.length >= 5)) conf += 10;
  if (pxPerCm) conf += 10;
  if (pattern === 'ravno') conf += 5;
  else if (!patternDoubtful) conf += 8;
  else conf -= 5;
  conf = Math.max(10, Math.min(97, Math.round(conf)));
  const verdict = conf >= 75 ? 'visoka' : conf >= 50 ? 'srednja' : 'nizka';

  return {
    ok: true, pattern, patternDoubtful, angleDeg: angleMod, angleDeg2: (angleMod + 90) % 180,
    pitchPx1: pitch1, pitchPx2: pitch2, amplitude, pitchCv: pitch2 ? Math.max(r1.cv, r2.cv) : r1.cv,
    continuity, continuityH, lines, pxPerCm, calibSource, tileWCm, tileHCm, snapW, snapH,
    tilesVisible, wastePercent, confidence: conf, verdict, warnings,
  };
}
