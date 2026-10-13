// ─── Deterministični računalniški vid za analizo fotografij ───
// Čisto algoritemska skripta — brez zunanjih storitev in brez strojnega
// učenja. Vhod: surovi piksli (RGBA). Izhod: strukturirana analiza
// (PhotoAnalysis) za kalkulatorje in ponudbe.
//
// Cevovod:
//  1. Pomanjšava (box filter) na delovno ločljivost ~256 px
//  2. Sivinska statistika + RGB→HSV preslikava
//  3. Gaussovo zgladitev + Sobelovi robovi (magnitoda) + histereza
//  4. Houghova transformacija daljic (θ/ρ) + klasifikacija smeri
//  5. Profili robov + avtokorelacija → mreža ploščic / vzorec desk
//  6. Barvne maske (nebo, zelenje, rja, les, steklo, tema) + povezane
//     komponente (CC) z obsegajočimi okvirji
//  7. Zaznavanje pravokotnikov → referenčni objekt (vrata/okno) za
//     umerjanje merila
//  8. Pravilna klasifikacija obrti (točkovni sistem) + ravnine,
//     objekti, materiali, tveganja, ocena kakovosti in predpolnitve

import type { CraftCategory, DetectedObject, DetectedSurface, PhotoAnalysis, ScaleAgreement, ScaleSuggestion } from './camera-types';
import type { CraftInputs } from './types';
import { detectPatternInQuad, type PatternSuggestion } from './pattern-detect';

// ─── Javni tipi ─────────────────────────────────────────────

/** Surova slika: RGBA, 1 bajt na kanal (kot canvas ImageData). */
export interface RgbaImage {
  width: number;
  height: number;
  /** Dolžina = width * height * 4. */
  data: Uint8ClampedArray;
}

interface Blob {
  /** obsegajoči okvir v delovnih pikslih */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  fill: number;
  cx: number;
  cy: number;
  /** rob po vsaj 3 straneh obsegajočega okvirja (okvir odprtine) */
  framed: boolean;
}

interface HoughLine {
  thetaDeg: number;
  rho: number;
  votes: number;
  /** 'navpična' | 'vodoravna' | 'diagonalna' */
  kind: 'vertical' | 'horizontal' | 'diagonal';
  /** položaj v px: x za navpične, y za vodoravne, sicer null */
  pos: number | null;
  /** smer daljice v stopinjah (0–180) za diagonalne */
  dirAngle: number;
}

interface GridInfo {
  confX: number;
  confY: number;
  pitchX: number;
  pitchY: number;
  both: boolean;
  single: boolean;
}

/** Vmesne značilke slike (javne za kalibracijske skripte). */
export interface Features {
  W: number;
  H: number;
  brightness: number;
  lumaStd: number;
  edgeDensity: number;
  lapVar: number;
  skyFrac: number;
  greenFrac: number;
  woodFrac: number;
  metalFrac: number;
  darkFrac: number;
  glassFrac: number;
  rustFrac: number;
  clipped: number;
  verticals: HoughLine[];
  horizontals: HoughLine[];
  diagonals: HoughLine[];
  grid: GridInfo;
  stairPattern: boolean;
  stairSteps: number;
  skyLargestFrac: number;
  glassBlobs: Blob[];
  darkBlobs: Blob[];
  framedDark: Blob[];
  greenBlobs: Blob[];
  rustBlobs: Blob[];
  woodBlobs: Blob[];
  flatBlob: Blob | null;
  flatFrac: number;
  bestDoor: Blob | null;
  bestWindow: Blob | null;
  /** Vsi vratu-podobni kandidati (urejeni po oceni) — za predloge merila. */
  doorCands: Array<{ b: Blob; score: number }>;
  /** Vsi oknu-podobni kandidati (urejeni po oceni). */
  windowCands: Array<{ b: Blob; score: number }>;
  /** Karta robov v delovni ločljivosti (za poliranje okvirov odprtin). */
  edge: Uint8Array;
  outdoor: boolean;
}

// ─── Mali pripomočki ────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** RGB (0–255) → H (0–360), S (0–1), V (0–1). */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max <= 1e-6 ? 0 : d / max;
  return [h, s, max];
}

/** Pomanjšava z box filtrom na dolžino daljše stranice ≤ maxDim. */
function downscale(img: RgbaImage, maxDim = 256): RgbaImage {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const tw = Math.max(16, Math.round(img.width * scale));
  const th = Math.max(16, Math.round(img.height * scale));
  if (tw === img.width && th === img.height) return img;

  const out = new Uint8ClampedArray(tw * th * 4);
  const fx = img.width / tw;
  const fy = img.height / th;
  for (let ty = 0; ty < th; ty++) {
    const sy0 = Math.floor(ty * fy);
    const sy1 = Math.min(img.height, Math.max(sy0 + 1, Math.floor((ty + 1) * fy)));
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor(tx * fx);
      const sx1 = Math.min(img.width, Math.max(sx0 + 1, Math.floor((tx + 1) * fx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let idx = (sy * img.width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++, idx += 4, n++) {
          r += img.data[idx];
          g += img.data[idx + 1];
          b += img.data[idx + 2];
          a += img.data[idx + 3];
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width: tw, height: th, data: out };
}

/** Ločljivo 1D zgladitev (jedro [1,2,1]/4), dva prehoda ≈ Gaussov filter. */
function smooth1d(src: Float32Array, w: number, h: number, horizontal: boolean): Float32Array {
  let cur = src;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c0 = horizontal ? Math.max(0, x - 1) : x;
        const c2 = horizontal ? Math.min(w - 1, x + 1) : x;
        const r0 = horizontal ? y : Math.max(0, y - 1);
        const r2 = horizontal ? y : Math.min(h - 1, y + 1);
        const i = y * w + x;
        const a = cur[r0 * w + (horizontal ? c0 : x)];
        const b = cur[i];
        const c = cur[r2 * w + (horizontal ? c2 : x)];
        out[i] = (a + 2 * b + c) / 4;
      }
    }
    cur = out;
  }
  return cur;
}

// ─── Povezane komponente (8-povezanost, iterativni sklad) ───

function connectedComponents(mask: Uint8Array, w: number, h: number, minArea: number): Blob[] {
  const labels = new Int32Array(w * h).fill(-1);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (mask[start] === 0 || labels[start] !== -1) continue;
    const id = blobs.length;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    let sx = 0;
    let sy = 0;
    stack.push(start);
    labels[start] = id;

    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      area++;
      sx += px;
      sy += py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const np = ny * w + nx;
          if (mask[np] === 1 && labels[np] === -1) {
            labels[np] = id;
            stack.push(np);
          }
        }
      }
    }

    if (area >= minArea) {
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      blobs.push({
        x0,
        y0,
        x1,
        y1,
        area,
        fill: area / (bw * bh),
        cx: sx / area,
        cy: sy / area,
        framed: false,
      });
    }
  }
  return blobs.sort((a, b) => b.area - a.area);
}

/**
 * Ocena "okvirjenosti": pravi okni/vrata/stekleno polje imajo izrazit
 * rob po (skoraj) vseh straneh obsegajočega okvirja; ravna stena ga ima
 * samo na eni strani. Označi vsak blob z framed = rob na ≥ 3 straneh.
 * Maska stekla izključuje robne piksle, zato se CC erodira in pravi rob
 * okvirja pade do 1 px ZUNAJ obsegajočega okvirja — preverjamo zato
 * črte fixed−1 … fixed+1 in vzamemo najboljše pokritost.
 */
/** Pokritost robov na eni črti (vodoravni/navpični presek bloba). */
function edgeLineHit(
  edge: Uint8Array, w: number, h: number,
  horizontal: boolean, fixed: number, from: number, to: number,
): { n: number; hit: number } {
  let n = 0;
  let hit = 0;
  for (let t = from; t <= to; t++) {
    const x = horizontal ? t : fixed;
    const y = horizontal ? fixed : t;
    if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) continue;
    n++;
    if (edge[y * w + x]) hit++;
  }
  return { n, hit };
}

/**
 * Najboljša pokritost robov med črtami fixed−1 … fixed+1 (glej zgoraj).
 */
function edgeBestLineHit(
  edge: Uint8Array, w: number, h: number,
  horizontal: boolean, fixed: number, from: number, to: number,
): { n: number; hit: number } {
  let best = { n: 0, hit: 0 };
  let bestRatio = 0;
  for (const f of [fixed - 1, fixed, fixed + 1]) {
    const c = edgeLineHit(edge, w, h, horizontal, f, from, to);
    const ratio = c.n > 0 ? c.hit / c.n : 0;
    if (c.n >= 4 && ratio > bestRatio) {
      best = c;
      bestRatio = ratio;
    }
  }
  return best;
}

function annotateFramed(blobs: Blob[], edge: Uint8Array, w: number, h: number): void {
  for (const b of blobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (bw < 6 || bh < 6) continue;
    const top = edgeBestLineHit(edge, w, h, true, b.y0, b.x0, b.x1);
    const bottom = edgeBestLineHit(edge, w, h, true, b.y1, b.x0, b.x1);
    const left = edgeBestLineHit(edge, w, h, false, b.x0, b.y0, b.y1);
    const right = edgeBestLineHit(edge, w, h, false, b.x1, b.y0, b.y1);
    let framedSides = 0;
    for (const s of [top, bottom, left, right]) {
      if (s.n >= 4 && s.hit / s.n >= 0.4) framedSides++;
    }
    b.framed = framedSides >= 3;
  }
}

// ─── Houghova transformacija daljic ─────────────────────────

function detectLines(edge: Uint8Array, w: number, h: number): HoughLine[] {
  const thetas = 180;
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoOffset = diag;
  const rhoBins = 2 * diag + 1;
  const acc = new Int32Array(thetas * rhoBins);
  const cosT = new Float32Array(thetas);
  const sinT = new Float32Array(thetas);
  for (let t = 0; t < thetas; t++) {
    cosT[t] = Math.cos((t * Math.PI) / 180);
    sinT[t] = Math.sin((t * Math.PI) / 180);
  }

  let edgeCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (edge[y * w + x] === 0) continue;
      edgeCount++;
      for (let t = 0; t < thetas; t++) {
        const rho = Math.round(x * cosT[t] + y * sinT[t]) + rhoOffset;
        acc[t * rhoBins + rho]++;
      }
    }
  }
  if (edgeCount === 0) return [];

  // Prag glasovov: sorazmeren z delovno višino (linija mora imeti
  // najmanj ~15 % krajše stranice podpore — steber/okvir jo ima,
  // šum pa ne).
  const minVotes = Math.max(6, Math.round(0.15 * Math.min(w, h)));
  const candidates: { t: number; rho: number; votes: number }[] = [];
  for (let t = 0; t < thetas; t++) {
    for (let r = 0; r < rhoBins; r++) {
      const v = acc[t * rhoBins + r];
      if (v >= minVotes) candidates.push({ t, rho: r - rhoOffset, votes: v });
    }
  }
  candidates.sort((a, b) => b.votes - a.votes);

  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= 18) break;
    let suppressed = false;
    for (const p of picked) {
      const dt = Math.min(Math.abs(c.t - p.t), thetas - Math.abs(c.t - p.t));
      const dr = Math.abs(c.rho - p.rho);
      if (dt <= 8 && dr <= 6) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) picked.push(c);
  }

  return picked.map(({ t, rho, votes }) => {
    const dirAngle = (t + 90) % 180;
    let kind: HoughLine['kind'] = 'diagonal';
    let pos: number | null = null;
    if (t <= 10 || t >= 170) {
      kind = 'vertical';
      pos = Math.abs(Math.cos((t * Math.PI) / 180)) > 1e-6 ? rho / Math.cos((t * Math.PI) / 180) : null;
    } else if (t >= 80 && t <= 100) {
      kind = 'horizontal';
      pos = Math.abs(Math.sin((t * Math.PI) / 180)) > 1e-6 ? rho / Math.sin((t * Math.PI) / 180) : null;
    }
    return { thetaDeg: t, rho, votes, kind, pos, dirAngle };
  });
}

// ─── Redovni vrhovi profila robov → mreža ploščic / vzorec desk ──
// Poišče izrazite lokalne maksimume (fuge, robovi desk) in preveri,
// ali so njihovi razmiki pravilni (nizek razpon). Deluje tudi, kadar
// mreža pokriva samo del slike — za razliko od klasične avtokorelacije.

function profilePeriodicity(profile: Float32Array): { conf: number; pitch: number } {
  const n = profile.length;

  // Lahka zgladitev (drseče povprečje po 3)
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = profile[Math.max(0, i - 1)];
    const c = profile[Math.min(n - 1, i + 1)];
    p[i] = (a + profile[i] + c) / 3;
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += p[i];
  mean /= n;
  if (mean < 0.5) return { conf: 0, pitch: 0 };

  // Zaznaj izrazite vrhove (nad 1,45× povprečje, lokalni maksimum)
  const peaks: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (
      p[i] > mean * 1.45 &&
      p[i] >= p[i - 1] &&
      p[i] >= p[i + 1] &&
      p[i] >= p[i - 2] &&
      p[i] >= p[i + 2]
    ) {
      // združi vrhove bližje od 4 px (obdrži močnejšega)
      if (peaks.length > 0 && i - peaks[peaks.length - 1] < 4) {
        if (p[i] > p[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      } else {
        peaks.push(i);
      }
    }
  }
  if (peaks.length < 4) return { conf: 0, pitch: 0 };

  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted[Math.floor(sorted.length / 2)];
  if (medianGap < 5) return { conf: 0, pitch: 0 };

  // Razmaki blizu mediane = "pravilni" del mreže
  const good = gaps.filter((g) => Math.abs(g - medianGap) <= 0.35 * medianGap);
  if (good.length < 3) return { conf: 0, pitch: 0 };

  const peakHeights = peaks.map((i) => p[i]);
  const medianPeak = [...peakHeights].sort((a, b) => a - b)[Math.floor(peakHeights.length / 2)];
  const prominence = medianPeak / Math.max(1e-6, mean);
  const conf = clamp(
    (0.28 + 0.1 * Math.min(good.length, 8)) * clamp((prominence - 1.1) / 0.9, 0.35, 1),
    0,
    1,
  );
  return { conf, pitch: Math.round(medianGap) };
}

// ─── Izvlečenje vseh značilk iz slike ───────────────────────

export function extractFeatures(img: RgbaImage): Features {
  const ds = downscale(img, 256);
  const W = ds.width;
  const H = ds.height;
  const N = W * H;

  // Sivinska + HSV značilke
  const gray = new Float32Array(N);
  const hue = new Float32Array(N);
  const sat = new Float32Array(N);
  const val = new Float32Array(N);
  let lumaSum = 0;
  let clipped = 0;
  for (let i = 0; i < N; i++) {
    const r = ds.data[i * 4];
    const g = ds.data[i * 4 + 1];
    const b = ds.data[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = l;
    lumaSum += l;
    if (l < 6 || l > 249) clipped++;
    const [h, s, v] = rgbToHsv(r, g, b);
    hue[i] = h;
    sat[i] = s;
    val[i] = v;
  }
  const brightness = lumaSum / N;
  let varSum = 0;
  for (let i = 0; i < N; i++) varSum += (gray[i] - brightness) ** 2;
  const lumaStd = Math.sqrt(varSum / N);

  const sm = smooth1d(gray, W, H, true);
  const blurred = smooth1d(sm, W, H, false);

  // Laplaceova varianca (ostrina)
  let lapSum = 0;
  let lapSum2 = 0;
  let lapN = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const v = 4 * blurred[i] - blurred[i - 1] - blurred[i + 1] - blurred[i - W] - blurred[i + W];
      lapSum += v;
      lapSum2 += v * v;
      lapN++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapN);
  const lapVar = lapSum2 / Math.max(1, lapN) - lapMean * lapMean;

  // Sobel
  const mag = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx =
        -blurred[i - W - 1] - 2 * blurred[i - 1] - blurred[i + W - 1] +
        blurred[i - W + 1] + 2 * blurred[i + 1] + blurred[i + W + 1];
      const gy =
        -blurred[i - W - 1] - 2 * blurred[i - W] - blurred[i - W + 1] +
        blurred[i + W - 1] + 2 * blurred[i + W] + blurred[i + W + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  let magSum = 0;
  let magSum2 = 0;
  for (let i = 0; i < N; i++) {
    magSum += mag[i];
    magSum2 += mag[i] * mag[i];
  }
  const magMean = magSum / N;
  const magStd = Math.sqrt(Math.max(0, magSum2 / N - magMean * magMean));

  // Histereza robov
  const tHigh = magMean + 1.1 * magStd;
  const tLow = magMean + 0.35 * magStd;
  const edge = new Uint8Array(N);
  const stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mag[i] > tHigh) {
      edge[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const px = p % W;
    const py = (p - px) / W;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        if (nx < 0 || nx >= W) continue;
        const np = ny * W + nx;
        if (edge[np] === 0 && mag[np] > tLow) {
          edge[np] = 1;
          stack.push(np);
        }
      }
    }
  }
  let edgeCount = 0;
  for (let i = 0; i < N; i++) edgeCount += edge[i];
  const edgeDensity = edgeCount / N;

  // Barvne maske
  const skyMask = new Uint8Array(N);
  const greenMask = new Uint8Array(N);
  const woodMask = new Uint8Array(N);
  const metalMask = new Uint8Array(N);
  const darkMask = new Uint8Array(N);
  const glassMask = new Uint8Array(N);
  const rustMask = new Uint8Array(N);
  let skyC = 0;
  let greenC = 0;
  let woodC = 0;
  let metalC = 0;
  let darkC = 0;
  let glassC = 0;
  let rustC = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = hue[i];
      const s = sat[i];
      const v = val[i];
      // Nebo = modri toni (h 185–260°). Bele stene/odsevi imajo nizko
      // nasičenost — prej so lažno šteli kot nebo (vse fotke "outdoor").
      if (y < H * 0.75 && h >= 185 && h <= 260 && s > 0.15 && v > 0.35) {
        skyMask[i] = 1;
        skyC++;
      }
      if (h >= 65 && h <= 165 && s > 0.22 && v > 0.12) {
        greenMask[i] = 1;
        greenC++;
      }
      if (h >= 8 && h <= 48 && s >= 0.12 && s <= 0.68 && v >= 0.2 && v <= 0.95) {
        woodMask[i] = 1;
        woodC++;
      }
      if (s < 0.18 && v >= 0.3 && v <= 0.82) {
        metalMask[i] = 1;
        metalC++;
      }
      if (v < 0.22) {
        darkC++;
        darkMask[i] = 1;
      }
      if (s < 0.14 && v >= 0.42 && v <= 0.97 && (edge[i] === 0)) {
        glassMask[i] = 1;
        glassC++;
      }
      if (h >= 5 && h <= 45 && s > 0.35 && v >= 0.18 && v <= 0.78) {
        rustMask[i] = 1;
        rustC++;
      }
    }
  }

  // Povezane komponente po maskah
  const minBlob = Math.max(24, Math.round(N * 0.004));
  const glassRaw = connectedComponents(glassMask, W, H, minBlob);
  const darkRaw = connectedComponents(darkMask, W, H, minBlob);
  const greenBlobs = connectedComponents(greenMask, W, H, minBlob * 2);
  const rustBlobs = connectedComponents(rustMask, W, H, minBlob);
  const woodBlobs = connectedComponents(woodMask, W, H, minBlob * 2);

  // Okvirjenost: samo obrobe z robom po ≥ 3 straneh so prave
  // odprtine (okna, vrata, polja ograje) — ravne stene odpadejo.
  annotateFramed(glassRaw, edge, W, H);
  annotateFramed(darkRaw, edge, W, H);
  const glassBlobs = glassRaw.filter((b) => b.framed && b.area / N >= 0.008);
  const framedDark = darkRaw.filter((b) => b.framed && !touchesAllBorders(b, W, H));
  const darkBlobs = darkRaw.filter((b) => !touchesAllBorders(b, W, H));

  // "Ravna" območja (nizka gostota robov) → fasada/stena
  const win = Math.max(10, Math.round(W / 16));
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += edge[y * W + x];
      integral[(y + 1) * (W + 1) + (x + 1)] = integral[y * (W + 1) + (x + 1)] + rowSum;
    }
  }
  const flatMask = new Uint8Array(N);
  let flatC = 0;
  for (let y = 0; y < H; y++) {
    const yy0 = Math.max(0, y - win);
    const yy1 = Math.min(H - 1, y + win);
    for (let x = 0; x < W; x++) {
      const xx0 = Math.max(0, x - win);
      const xx1 = Math.min(W - 1, x + win);
      const area = (xx1 - xx0 + 1) * (yy1 - yy0 + 1);
      const sum =
        integral[(yy1 + 1) * (W + 1) + (xx1 + 1)] -
        integral[yy0 * (W + 1) + (xx1 + 1)] -
        integral[(yy1 + 1) * (W + 1) + xx0] +
        integral[yy0 * (W + 1) + xx0];
      if (sum / area < 0.08) {
        flatMask[y * W + x] = 1;
        flatC++;
      }
    }
  }
  const flatBlobs = connectedComponents(flatMask, W, H, Math.round(N * 0.05));
  const flatBlob = flatBlobs[0] ?? null;
  const flatFrac = flatC / N;

  // Hough daljice
  const lines = detectLines(edge, W, H);
  const verticals = lines.filter((l) => l.kind === 'vertical' && l.pos !== null && l.pos > W * 0.04 && l.pos < W * 0.96);
  const horizontals = lines.filter((l) => l.kind === 'horizontal' && l.pos !== null && l.pos > H * 0.04 && l.pos < H * 0.96);
  const diagonals = lines.filter(
    (l) => l.kind === 'diagonal' && ((l.dirAngle >= 15 && l.dirAngle <= 75) || (l.dirAngle >= 105 && l.dirAngle <= 165)),
  );

  // Profili robov + avtokorelacija (mreža ploščic / vzorec desk)
  const colProfile = new Float32Array(W);
  const rowProfile = new Float32Array(H);
  const x0 = Math.round(W * 0.05);
  const x1 = Math.round(W * 0.95);
  const y0 = Math.round(H * 0.05);
  const y1 = Math.round(H * 0.95);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (edge[y * W + x]) {
        colProfile[x]++;
        rowProfile[y]++;
      }
    }
  }
  const perX = profilePeriodicity(colProfile);
  const perY = profilePeriodicity(rowProfile);
  const grid: GridInfo = {
    confX: perX.conf,
    confY: perY.conf,
    pitchX: perX.pitch,
    pitchY: perY.pitch,
    both: perX.conf > 0.45 && perY.conf > 0.45 && perX.pitch > 5 && perY.pitch > 5,
    single: (perX.conf > 0.4 && perX.pitch > 5) !== (perY.conf > 0.4 && perY.pitch > 5),
  };

  // Vzorec stopnic: sklad vodoravnih linij + diagonale
  const lowerHorizontals = horizontals.filter((l) => l.pos !== null && l.pos > H * 0.28).map((l) => l.pos!);
  lowerHorizontals.sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const y of lowerHorizontals) {
    if (clusters.length === 0 || y - clusters[clusters.length - 1] > 6) clusters.push(y);
  }
  const gaps: number[] = [];
  for (let i = 1; i < clusters.length; i++) gaps.push(clusters[i] - clusters[i - 1]);
  const consistentGaps =
    gaps.length >= 3 &&
    gaps.every((g) => g >= 6 && g <= H * 0.18) &&
    Math.max(...gaps) / Math.max(1, Math.min(...gaps)) < 2.6;
  const stairPattern = clusters.length >= 4 && consistentGaps && diagonals.length >= 2;
  const stairSteps = stairPattern ? clamp(clusters.length + 1, 2, 24) : 0;

  // Referenčni kandidati: vrata (temna/steklena visoka odprtina) in okna.
  // Vrata se morajo končati blizu tal slike (dno znotraj spodnjih 18 %)
  // — tako polje ograje ali okno ne more biti zamenjano za vrata.
  const openingBlobs = [...glassBlobs, ...framedDark];
  const doorCands: Array<{ b: Blob; score: number }> = [];
  for (const b of openingBlobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const aspect = bh / bw;
    if (aspect < 1.2 || aspect > 4.2) continue;
    if (bh < H * 0.25 || bw < W * 0.07) continue;
    if (b.y1 < H * 0.82) continue;
    if (b.fill < 0.55) continue;
    const areaFrac = b.area / N;
    if (areaFrac < 0.015) continue;
    // bližina standardnim vratom (razmerje ≈ 2), s spodnjim pragom —
    // tudi ozka/tall vrata morajo ostati kandidat
    const aspectCloseness = Math.max(0.25, 1 - Math.min(1, Math.abs(aspect - 2) / 1.8));
    const score = b.fill * aspectCloseness * clamp(areaFrac / 0.06, 0, 1);
    doorCands.push({ b, score });
  }
  doorCands.sort((a, z) => z.score - a.score);
  // dvojniki (iste odprtine v stekleni IN temni maski) — IoU > 0,6
  const doorDedup: Array<{ b: Blob; score: number }> = [];
  for (const c of doorCands) {
    if (doorDedup.every((d) => blobIoU(d.b, c.b) < 0.6)) doorDedup.push(c);
  }
  const bestDoor = doorDedup[0]?.b ?? null;
  const windowCands: Array<{ b: Blob; score: number }> = [];
  for (const b of glassBlobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const aspect = bh / bw;
    if (aspect < 0.55 || aspect > 1.9) continue;
    const areaFrac = b.area / N;
    if (areaFrac < 0.012 || areaFrac > 0.35) continue;
    if (b.fill < 0.5) continue;
    const aspectCloseness = 1 - Math.min(1, Math.abs(aspect - 1) / 0.9);
    const score = b.fill * aspectCloseness * clamp(areaFrac / 0.04, 0, 1);
    windowCands.push({ b, score });
  }
  windowCands.sort((a, z) => z.score - a.score);
  const bestWindow = windowCands[0]?.b ?? null;

  const skyFrac = skyC / N;
  // Največji povezani nebni blob (odsevi neba v oknih so mali CC-ji —
  // pravo nebo je ena velika regija na vrhu slike).
  const skyBlobs = connectedComponents(skyMask, W, H, Math.round(N * 0.02));
  const skyLargestFrac = (skyBlobs[0]?.area ?? 0) / N;
  // Zunanjost = velika nebna regija (modri toni) ALI veliko zelenja.
  const outdoor = skyLargestFrac > 0.06 || greenC / N > 0.1;

  return {
    W,
    H,
    brightness,
    lumaStd,
    edgeDensity,
    lapVar,
    skyFrac,
    greenFrac: greenC / N,
    woodFrac: woodC / N,
    metalFrac: metalC / N,
    darkFrac: darkC / N,
    glassFrac: glassC / N,
    rustFrac: rustC / N,
    clipped: clipped / N,
    verticals,
    horizontals,
    diagonals,
    grid,
    stairPattern,
    stairSteps,
    skyLargestFrac,
    glassBlobs,
    darkBlobs,
    framedDark,
    greenBlobs,
    rustBlobs,
    woodBlobs,
    flatBlob,
    flatFrac,
    bestDoor,
    bestWindow,
    doorCands: doorDedup,
    windowCands,
    edge,
    outdoor,
  };
}

function touchesAllBorders(b: Blob, w: number, h: number): boolean {
  return b.x0 <= 1 && b.x1 >= w - 2 && b.y0 <= 1 && b.y1 >= h - 2;
}

/** Prekrivanje dveh blolobov (IoU) — za odstranjevanje dvojnikov. */
function blobIoU(a: Blob, b: Blob): number {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  const iw = ix1 - ix0 + 1;
  const ih = iy1 - iy0 + 1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / (a.area + b.area - inter);
}

// ─── Predlogi merila iz referenčnih objektov (Task 24) ──────

const DOOR_CM = 200;
const WINDOW_CM = 120;

/**
 * Razširi erodirani okvir odprtine do pravega roba po karti robov.
 * Barvne maske (steklo/tema) izključujejo robne piksle, zato je bbox
 * CC-ja za 1–3 px manjši od prave odprtine na vsako stran — kar bi
 * merilo zmotilo za ~10 %. Robni prstan je debel (Sobel + histereza),
 * zato ne hodimo navzven do zadnje črte nad pragom, ampak vzamemo
 * črto z največjo pokritostjo v oknu 1–4 px (središče prstana =
 * prava meja). Če je najboljša pokritost < 0,35, strane ne premaknemo.
 */
function refineOpeningBox(b: Blob, edge: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const lineCov = (horizontal: boolean, fixed: number, from: number, to: number): number => {
    let n = 0;
    let hit = 0;
    for (let t = from; t <= to; t++) {
      const x = horizontal ? t : fixed;
      const y = horizontal ? fixed : t;
      if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) continue;
      n++;
      if (edge[y * w + x]) hit++;
    }
    return n > 0 ? hit / n : 0;
  };
  // odmik prstana robov: tehtani centroid pokritosti pri 1–4 px navzven
  // (argmax bi pri tankem prstanu ostal prekratek, pri debelom prelongiran)
  const ringOffset = (horizontal: boolean, dir: 1 | -1, base: number, from: number, to: number): number => {
    let sum = 0;
    let wsum = 0;
    for (let d = 1; d <= 4; d++) {
      const cov = lineCov(horizontal, base + dir * d, from, to);
      if (cov < 0.2) break; // prstan se je končal
      sum += d * cov;
      wsum += cov;
    }
    if (wsum === 0) return 0;
    return Math.max(1, Math.round(sum / wsum));
  };
  let { x0, y0, x1, y1 } = b;
  const dTop = ringOffset(true, -1, y0, x0, x1);
  if (dTop > 0) y0 -= dTop;
  const dBottom = ringOffset(true, 1, y1, x0, x1);
  if (dBottom > 0) y1 += dBottom;
  const dLeft = ringOffset(false, -1, x0, y0, y1);
  if (dLeft > 0) x0 -= dLeft;
  const dRight = ringOffset(false, 1, x1, y0, y1);
  if (dRight > 0) x1 += dRight;
  return { x0, y0, x1, y1 };
}

/**
 * Zgradi VSE predloge merila iz zaznanih kandidatov (vrata + okna).
 * Vsak predlog nosi deterministično oceno zanesljivosti 0–100:
 * bližina razmerju stranic standardu, lega dna (vrata pri tleh),
 * zapolnjenost okvirja, velikost v sliki in prečni preverba širine
 * (DIN 18101 / EN 14351-1: vrata 70–110 cm, okno 60–180 cm).
 * Merilo je v delovnih pikslih analize na 1 cm — za soglasje in
 * ocene površin; UI ga preslika v naravne piksle prek okvirja v %.
 */
export function buildScaleSuggestions(f: Features): ScaleSuggestion[] {
  const out: ScaleSuggestion[] = [];
  const W = f.W;
  const H = f.H;

  f.doorCands.slice(0, 2).forEach((c, i) => {
    const b = c.b;
    const r = refineOpeningBox(b, f.edge, W, H);
    const bwPx = r.x1 - r.x0 + 1;
    const bhPx = r.y1 - r.y0 + 1;
    const aspect = bhPx / bwPx;
    const pxPerCm = bhPx / DOOR_CM;
    const impliedWidthCm = Math.round(bwPx / pxPerCm);
    const widthPlausible = impliedWidthCm >= 70 && impliedWidthCm <= 110;

    let conf = 0;
    // 1) razmerje stranic blizu 2,0 (do 35 t.)
    conf += 35 * Math.max(0.15, 1 - Math.min(1, Math.abs(aspect - 2) / 1.8));
    // 2) dno pri tleh (do 15 t.)
    conf += b.y1 >= H * 0.95 ? 15 : b.y1 >= H * 0.88 ? 10 : 5;
    // 3) zapolnjenost (do 15 t.)
    conf += b.fill >= 0.8 ? 15 : b.fill >= 0.65 ? 10 : 5;
    // 4) velikost v sliki (do 15 t.)
    const areaFrac = b.area / (W * H);
    conf += areaFrac >= 0.03 && areaFrac <= 0.3 ? 15 : areaFrac >= 0.015 && areaFrac <= 0.45 ? 8 : 3;
    // 5) prečni preverba širine (do 20 t.)
    conf += widthPlausible ? 20 : impliedWidthCm >= 55 && impliedWidthCm <= 140 ? 10 : 0;
    // majhna/daleč vrata so manj zanesljiva
    if (bhPx < H * 0.35) conf -= 10;

    const confidence = Math.round(clamp(conf, 5, 95));
    out.push({
      id: `door-${i + 1}`,
      kind: 'vrata',
      label: i === 0 ? 'Vrata / vhodna odprtina' : `Vrata ${i + 1}`,
      box: [
        round1(clamp((r.x0 / W) * 100, 0, 100)),
        round1(clamp((r.y0 / H) * 100, 0, 100)),
        round1(clamp(((r.x1 - r.x0 + 1) / W) * 100, 0, 100)),
        round1(clamp(((r.y1 - r.y0 + 1) / H) * 100, 0, 100)),
      ],
      assumedCm: DOOR_CM,
      pxPerCm,
      confidence,
      confidenceLabel: confidence >= 75 ? 'visoka' : confidence >= 55 ? 'srednja' : 'nizka',
      impliedWidthCm,
      widthPlausible,
    });
  });

  f.windowCands.slice(0, 3).forEach((c, i) => {
    const b = c.b;
    const r = refineOpeningBox(b, f.edge, W, H);
    const bwPx = r.x1 - r.x0 + 1;
    const bhPx = r.y1 - r.y0 + 1;
    const aspect = bhPx / bwPx;
    const pxPerCm = bhPx / WINDOW_CM;
    const impliedWidthCm = Math.round(bwPx / pxPerCm);
    const widthPlausible = impliedWidthCm >= 60 && impliedWidthCm <= 180;

    let conf = 0;
    // 1) razmerje stranic blizu 1,0 (do 30 t.)
    conf += 30 * Math.max(0.1, 1 - Math.min(1, Math.abs(aspect - 1) / 0.9));
    // 2) zapolnjenost (do 20 t.)
    conf += b.fill >= 0.7 ? 20 : b.fill >= 0.55 ? 12 : 5;
    // 3) velikost v sliki (do 20 t.)
    const areaFrac = b.area / (W * H);
    conf += areaFrac >= 0.02 && areaFrac <= 0.2 ? 20 : areaFrac >= 0.012 && areaFrac <= 0.35 ? 10 : 3;
    // 4) prečni preverba širine (do 20 t.)
    conf += widthPlausible ? 20 : impliedWidthCm >= 40 && impliedWidthCm <= 250 ? 10 : 0;
    // 5) sorodniki: druga okna z podobnim merilom (do 10 t. na par, max 20)
    const peers = f.windowCands.filter((o) => o !== c).filter((o) => {
      const obh = o.b.y1 - o.b.y0 + 1;
      const oScale = obh / WINDOW_CM;
      return Math.abs(oScale - pxPerCm) / Math.max(1e-6, pxPerCm) <= 0.12;
    }).length;
    conf += Math.min(20, peers * 10);

    const confidence = Math.round(clamp(conf, 5, 95));
    out.push({
      id: `window-${i + 1}`,
      kind: 'okno',
      label: i === 0 ? 'Okno' : `Okno ${i + 1}`,
      box: [
        round1(clamp((r.x0 / W) * 100, 0, 100)),
        round1(clamp((r.y0 / H) * 100, 0, 100)),
        round1(clamp(((r.x1 - r.x0 + 1) / W) * 100, 0, 100)),
        round1(clamp(((r.y1 - r.y0 + 1) / H) * 100, 0, 100)),
      ],
      assumedCm: WINDOW_CM,
      pxPerCm,
      confidence,
      confidenceLabel: confidence >= 75 ? 'visoka' : confidence >= 55 ? 'srednja' : 'nizka',
      impliedWidthCm,
      widthPlausible,
    });
  });

  // najzanesljivejši predlog na vrh; vrata imajo prednost pred okni
  // (višina vrat je standardizirana, okna pa se močno razlikujejo),
  // razen če je okno bistveno zanesljivejše (+ 15 t.)
  out.sort((a, z) => {
    if (a.kind !== z.kind) {
      const door = a.kind === 'vrata' ? a : z;
      const win = a.kind === 'vrata' ? z : a;
      if (win.confidence >= door.confidence + 15) return win.id === a.id ? -1 : 1;
      return door.id === a.id ? -1 : 1;
    }
    return z.confidence - a.confidence;
  });
  return out.slice(0, 4);
}

/**
 * Soglasje meril med kandidati (fotogrametrijska kontrola kakovosti):
 * razpršenost (max−min)/mediana ≤ 10 % = visoko, ≤ 25 % = srednje,
 * sicer nizko (opozorilo). Enojni kandidat = 'none'.
 */
export function fuseScaleAgreement(s: ScaleSuggestion[]): ScaleAgreement {
  if (s.length < 2) return 'none';
  const scales = s.map((x) => x.pxPerCm).sort((a, b) => a - b);
  const mid = Math.floor(scales.length / 2);
  const med = scales.length % 2 === 1 ? scales[mid] : (scales[mid - 1] + scales[mid]) / 2;
  if (med <= 0) return 'none';
  const spread = (scales[scales.length - 1] - scales[0]) / med;
  if (spread <= 0.1) return 'high';
  if (spread <= 0.25) return 'medium';
  return 'low';
}

// ─── Pravilna klasifikacija obrti (točkovni sistem) ─────────

interface CraftScores {
  craft: CraftCategory;
  confidence: number;
  scores: Record<CraftCategory, number>;
}

/**
 * Število okenih odprtin: stekleni IN temni CC z okenskim razmerjem
 * stranic. Temne odprtine so ključne na svetlih fasadah (okna izgledajo
 * temno, ne steklo) — prej jih klasifikacija sploh ni videla.
 */
function countWindows(f: Features): number {
  const isWin = (b: Blob, minAf: number) => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const aspect = bh / bw;
    const areaFrac = b.area / (f.W * f.H);
    return aspect >= 0.55 && aspect <= 1.9 && areaFrac >= minAf && areaFrac <= 0.35 && b.fill >= 0.5;
  };
  // Temna okna imajo nižji prag (okna na daljših fasadah so na delovni
  // ločljivosti majhna — 0,8 % slike je še veljavno okno).
  return f.glassBlobs.filter((b) => isWin(b, 0.012)).length + f.framedDark.filter((b) => isWin(b, 0.007)).length;
}

export function classifyCraft(f: Features, structure: PatternSuggestion | null): CraftScores {
  const scores: Record<CraftCategory, number> = {
    'ograje': 0,
    'stopnice': 0,
    'keramika': 0,
    'wpc-terasa': 0,
    'okna-vrata': 0,
    'nadstreški': 0,
    'fasada': 0,
    'drugo': 0,
  };

  const vCount = f.verticals.length;
  const hCount = f.horizontals.length;
  const dgCount = f.diagonals.length;
  const windowCount = countWindows(f);
  const wideGlass = f.glassBlobs.some((b) => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    return bw > f.W * 0.35 && bh > f.H * 0.12 && bh < f.H * 0.55 && b.fill > 0.55;
  });
  const N = f.W * f.H;

  // ── Struktura (detektor vzorcev): kvazi-periodična tekstura ──
  // Standardni pristop za ograje/mreže ("fence-like quasi-periodic texture").
  // Samo srednje/visoke zaznave štejejo — nizke pomenijo iskreno "ne vem".
  const structStrong =
    structure?.confidence === 'visoka' ? 2 : structure?.confidence === 'srednja' ? 1 : 0;
  if (structure && structStrong > 0) {
    if (structure.pattern === 'vertikalne') {
      if (f.outdoor) scores['ograje'] += 10 + 4 * structStrong;
      else scores['okna-vrata'] += 4;
    } else if (structure.pattern === 'horizontalne') {
      if (f.woodFrac > 0.3 && !f.stairPattern) scores['wpc-terasa'] += 8 + 8 * structStrong;
      else if (f.outdoor && f.woodFrac <= 0.3) scores['ograje'] += 7 * structStrong;
    } else if (structure.pattern === 'mreza') {
      if (f.outdoor) scores['ograje'] += 6 * structStrong;
      else scores['keramika'] += 8 * structStrong;
    } else if (structure.pattern === 'vozlik') {
      if (f.outdoor) scores['ograje'] += 6 * structStrong;
    } else if (structure.pattern === 'lamele45') {
      if (f.outdoor) scores['nadstreški'] += 5 * structStrong;
    } else if (structure.pattern === 'panel') {
      if (f.outdoor) scores['fasada'] += 4 * structStrong;
    }
  }

  // Keramika: pravilna mreža na obeh oseh (fuge), notranji prostor
  if (f.grid.both) {
    scores['keramika'] += 40 + 22 * Math.min(f.grid.confX, f.grid.confY);
    if (!f.outdoor) scores['keramika'] += 12;
  }
  // Velikformatne ploščice/obloge: množica navpičnih fug, malo horizontalnih
  // (perspektiva poševnega pogleda), svetla nevtralna površina, brez lesa
  if (vCount >= 8 && hCount <= 3 && dgCount <= 6 && f.glassFrac > 0.4 && f.woodFrac < 0.08) {
    scores['keramika'] += 26 + (f.glassFrac > 0.5 ? 14 : 0) + (vCount >= 12 ? 8 : 0);
  }

  // WPC / lesena terasa: topla barva + vzporedne črte
  const lowerWood = f.woodBlobs.reduce((s, b) => {
    const bh = b.y1 - b.y0 + 1;
    return s + (b.cy > f.H * 0.4 ? b.area : b.area * 0.4);
  }, 0) / N;
  if (lowerWood > 0.22) {
    scores['wpc-terasa'] += 28 + 22 * Math.min(1, (lowerWood - 0.22) * 2);
    if (f.grid.single) scores['wpc-terasa'] += 18;
    if (f.outdoor) scores['wpc-terasa'] += 8;
  }

  // Ograje: navpični stebri/letve. Zmerna osnova — vertikale so POVSYOD
  // (okvirji oken, fuge), zato računamo samo s kontekstom: zunanjost,
  // široko stekleno polje ali izrazita perioda (struktura zgoraj).
  if (vCount >= 4) scores['ograje'] += 8 + 2 * Math.min(vCount, 8);
  if (vCount >= 4 && f.outdoor) scores['ograje'] += 12;
  if (vCount >= 4 && hCount >= 1 && hCount <= 4) scores['ograje'] += 8;
  if (wideGlass && vCount >= 2) scores['ograje'] += 26;
  if (wideGlass && f.outdoor) scores['ograje'] += 8;
  // Steklena balkonska ograja/balustrada: veliko stekla + kovinski profili +
  // diagonalna perspektiva ročajev, brez zelenja in brez vrata v kadru
  // (nadstrešek nad vhodom ima prav vrata pod steklom — to ločimo).
  if (dgCount >= 8 && f.glassFrac > 0.25 && f.metalFrac > 0.4 && f.greenFrac < 0.05 && !f.bestDoor) {
    scores['ograje'] += 30;
  }

  // Stopnice: vzorec stopenj (sklad horizontalnih linij + diagonale);
  // lesene v zaprtih prostorih (brez neba) so neambivalentne
  if (f.stairPattern) {
    scores['stopnice'] += 58;
    if (f.woodFrac > 0.25 && f.metalFrac > 0.25 && f.skyLargestFrac < 0.06) scores['stopnice'] += 34;
  }

  // Okna/vrata: zaznane odprtine (steklo IN temne). Pri nadstrešku nad
  // vhodom (canopyEvidence — veliko stekla + diagonale + vrata pod njim)
  // so "okna" v resnici stekleni paneli nadstreška — ne štej jih kot
  // dokaz za okna/vrata.
  const canopyEvidence = dgCount >= 6 && f.glassFrac > 0.3 && !!f.bestDoor;
  // kopalnica z velikimi ploščicami/prho: veliko navpičnih fug + steklo
  // — "okna" so steklo prhe/ogledala, polovična teža
  const keramikaEvidence = vCount >= 8 && hCount <= 3 && f.glassFrac > 0.4 && f.woodFrac < 0.08;
  if (windowCount >= 1 && !canopyEvidence) {
    scores['okna-vrata'] += keramikaEvidence
      ? 9 + 4 * Math.min(windowCount, 4)
      : 18 + 7 * Math.min(windowCount, 4);
  }
  if (f.bestDoor) scores['okna-vrata'] += f.bestDoor.fill >= 0.7 ? 12 : 4;
  if (windowCount >= 2 && !f.outdoor && !f.bestDoor) scores['okna-vrata'] += 10;
  // Okenska stena: množica vertikalnih + horizontalnih okvirjev, svetla
  // površina (steklo/odsev), skoraj brez diagonal
  if (vCount >= 5 && hCount >= 4 && dgCount <= 3 && f.glassFrac > 0.35) {
    scores['okna-vrata'] += 34;
  }

  // Nadstreški: diagonale + nebo skozi konstrukcijo; ALI steklo nad vrati
  if (dgCount >= 3 && f.outdoor && f.skyFrac > 0.15) scores['nadstreški'] += 22;
  // Nadstrešek nad vhodom: veliko stekla + diagonale (robovi strehe)
  // + vrata pod njim; več stekla = močnejši dokaz
  if (dgCount >= 6 && f.glassFrac > 0.3 && f.bestDoor) {
    scores['nadstreški'] += 40 + (f.glassFrac > 0.4 ? 8 : 0);
  }
  if (f.outdoor && hCount >= 1 && vCount >= 3 && f.skyFrac > 0.12) scores['nadstreški'] += 14;

  // Fasada: okna/odprtine + zunanjost. Vrata na fasadi ne pokvarijo
  // pravila (vhodna vrata so del fasade) — izključi samo primer
  // nadstreška nad vhodom (canopyEvidence: steklo + diagonale + vrata).
  // Na svetli fasadi so okna temne odprtine — countWindows jih šteje.
  if (windowCount >= 1 && f.outdoor && !canopyEvidence && dgCount >= 2) {
    scores['fasada'] += 24 + 8 * Math.min(windowCount, 5);
  }
  if (f.flatFrac > 0.5) scores['fasada'] += 10;
  if (f.outdoor && f.edgeDensity < 0.05 && windowCount >= 1) scores['fasada'] += 10;
  // Fasadna obloga: horizontalne lamele NA STENI z odprtino (vrata/okno).
  // Odprtina je ključni razločevalnik proti terasi — deka nima vrat, stena
  // z oblogo pa skoraj vedno pokaže vrata ali okno. Odločilna teža, ker
  // sicer struktura 'horizontalne' privleče wpc-teraso (Task 33).
  if (
    structure?.pattern === 'horizontalne' && structStrong > 0 &&
    (f.bestDoor || windowCount >= 1) && f.flatFrac >= 0.2 && !canopyEvidence
  ) {
    scores['fasada'] += 60 + 10 * structStrong;
  }

  let best: CraftCategory = 'drugo';
  let bestScore = 0;
  let second = 0;
  for (const k of Object.keys(scores) as CraftCategory[]) {
    if (scores[k] > bestScore) {
      second = bestScore;
      bestScore = scores[k];
      best = k;
    } else if (scores[k] > second) {
      second = scores[k];
    }
  }

  if (bestScore < 24) {
    return { craft: 'drugo', confidence: clamp(Math.round(30 + bestScore), 30, 45), scores };
  }
  const dominance = bestScore / Math.max(1, bestScore + second);
  const confidence = clamp(Math.round(40 + 55 * dominance), 40, 93);
  return { craft: best, confidence, scores };
}

// ─── Pomožno: blob → okvir v % slike ────────────────────────

function blobToBox(b: Blob, W: number, H: number): [number, number, number, number] {
  const x = (b.x0 / W) * 100;
  const y = (b.y0 / H) * 100;
  const bw = ((b.x1 - b.x0 + 1) / W) * 100;
  const bh = ((b.y1 - b.y0 + 1) / H) * 100;
  return [round1(clamp(x, 0, 100)), round1(clamp(y, 0, 100)), round1(clamp(bw, 0, 100)), round1(clamp(bh, 0, 100))];
}

function boxQuad(box: [number, number, number, number]): [number, number][] {
  const [x, y, w, h] = box;
  return [
    [round1(x), round1(y)],
    [round1(x + w), round1(y)],
    [round1(x + w), round1(y + h)],
    [round1(x), round1(y + h)],
  ];
}

function centralQuad(xm = 12, yt = 18, yb = 88): [number, number][] {
  return [
    [xm, yt],
    [100 - xm, yt],
    [100 - xm, yb],
    [xm, yb],
  ];
}

// ─── Glavna analiza ─────────────────────────────────────────

/**
 * Popolnoma deterministična analiza fotografije: računalniški vid v
 * čistih skriptah (robovi, daljice, mreže, barvne maske, pravila).
 * Ne glede na zunanje storitve — deluje vedno in povsod.
 */
export function analyzePhotoImage(img: RgbaImage): PhotoAnalysis {
  const f = extractFeatures(img);
  // Strukturni pregled osrednjega območja (detektor vzorcev — kvazi-
  // periodična tekstura, orientacijski histogram + avtokorelacija).
  // Podpira klasifikacijo in dokumentira, KAJ je na fotki.
  const structure = detectPatternInQuad(img, [
    { x: 14, y: 14 },
    { x: 86, y: 14 },
    { x: 86, y: 86 },
    { x: 14, y: 86 },
  ]);
  const { craft, confidence } = classifyCraft(f, structure);
  const N = f.W * f.H;
  const windowCount = countWindows(f);

  // ── Predlogi merila (Task 24): vrata + okna z zanesljivostjo ──
  const scaleSuggestions = buildScaleSuggestions(f);
  const scaleAgreement = fuseScaleAgreement(scaleSuggestions);
  const bestSuggestion = scaleSuggestions[0] ?? null;
  let reference: PhotoAnalysis['reference'] = null;
  let referenceBox: PhotoAnalysis['referenceBox'] = null;
  let pxPerCm = 0;
  if (bestSuggestion) {
    reference = {
      label: bestSuggestion.kind === 'vrata' ? 'Vrata / vhodna odprtina' : 'Okno',
      assumedCm: bestSuggestion.assumedCm,
      explanation:
        bestSuggestion.kind === 'vrata'
          ? 'Skripta je zaznala visoko pravokotno odprtino z razmerjem stranic typičnim za vrata — standardna vrata so visoka ≈ 200 cm.'
          : 'Skripta je zaznala okensko odprtino z okvirjem — standardno okno meri ≈ 120 cm na višjo stranico.',
    };
    referenceBox = bestSuggestion.box;
    pxPerCm = bestSuggestion.pxPerCm;
  }

  const blobAreaM2 = (b: Blob): number | null => {
    if (pxPerCm <= 0) return null;
    const bw = (b.x1 - b.x0 + 1) / pxPerCm;
    const bh = (b.y1 - b.y0 + 1) / pxPerCm;
    // korekcija perspektive: površina je v povprečju ~85 % kvadrata
    // obsegajočega okvirja zaradi nagiba ravnine
    return round2((bw * bh * 0.85) / 10_000);
  };
  const blobLenCm = (px: number): number | null => (pxPerCm > 0 ? Math.round(px / pxPerCm) : null);

  // ── Ravnine ──
  const surfaces: DetectedSurface[] = [];
  const addSurface = (label: string, quad: [number, number][], area: number | null, note: string) => {
    if (surfaces.length >= 3) return;
    surfaces.push({ label, quad, estAreaM2: area, note });
  };

  switch (craft) {
    case 'keramika': {
      const b = f.flatBlob ?? null;
      const box: [number, number, number, number] = b && b.area / N > 0.12 ? blobToBox(b, f.W, f.H) : ([12, 30, 76, 55] as [number, number, number, number]);
      addSurface('Tla / površina s ploščicami', boxQuad(box), b && b.area / N > 0.12 ? blobAreaM2(b) : null, f.grid.both ? `Zaznana pravilna mreža (korak ≈ ${f.grid.pitchX}×${f.grid.pitchY} px).` : 'Mreža ploščic ni povsem izrazita.');
      break;
    }
    case 'wpc-terasa': {
      const b = f.woodBlobs[0] ?? null;
      const box: [number, number, number, number] = b ? blobToBox(b, f.W, f.H) : ([8, 45, 84, 45] as [number, number, number, number]);
      addSurface('Terasa / talna površina', boxQuad(box), b ? blobAreaM2(b) : null, 'Talna površina v toplem lesnem tonu.');
      break;
    }
    case 'fasada': {
      const b = f.flatBlob ?? null;
      const box: [number, number, number, number] = b ? blobToBox(b, f.W, f.H) : ([10, 10, 80, 70] as [number, number, number, number]);
      addSurface('Fasadna stena', boxQuad(box), b ? blobAreaM2(b) : null, 'Velika ravna površina z malo robovi.');
      break;
    }
    case 'ograje': {
      const wide = f.glassBlobs.find((b) => {
        const bw = b.x1 - b.x0 + 1;
        const bh = b.y1 - b.y0 + 1;
        return bw > f.W * 0.3 && bh > f.H * 0.1 && b.fill > 0.5;
      });
      if (wide) {
        addSurface('Polje ograje (steklo/polnilo)', boxQuad(blobToBox(wide, f.W, f.H)), blobAreaM2(wide), 'Široko ravninsko polje med stebri.');
      } else {
        addSurface('Polje ograje', centralQuad(8, 30, 82), null, 'Ocena polja med stebri — umeri merilo za m².');
      }
      break;
    }
    case 'stopnice': {
      addSurface('Stopnišče (v spodnjem delu)', centralQuad(15, 45, 92), null, 'Stopnice so v spodnjem delu slike — umeri za natančne mere.');
      break;
    }
    case 'okna-vrata': {
      const b = f.bestDoor ?? f.bestWindow;
      if (b) addSurface('Odprtina', boxQuad(blobToBox(b, f.W, f.H)), blobAreaM2(b), 'Zaznana odprtina za okno/vrata.');
      break;
    }
    case 'nadstreški': {
      addSurface('Nadstrešek / streha (zgornji del)', centralQuad(8, 8, 45), null, 'Konstrukcija v zgornjem delu slike.');
      break;
    }
    default: {
      const b = f.flatBlob && f.flatBlob.area / N > 0.2 ? f.flatBlob : null;
      if (b) addSurface('Ravna površina', boxQuad(blobToBox(b, f.W, f.H)), blobAreaM2(b), 'Največja ravna površina v sceni.');
      else addSurface('Osrednja površina', centralQuad(), null, 'Groba ocena osrednjega dela slike.');
      break;
    }
  }

  // ── Objekti ──
  const objects: DetectedObject[] = [];
  const push = (o: DetectedObject) => {
    if (objects.length < 8) objects.push(o);
  };

  let windowIdx = 0;
  for (const b of f.glassBlobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const aspect = bh / bw;
    const areaFrac = b.area / N;
    if (aspect >= 0.55 && aspect <= 1.9 && areaFrac >= 0.012 && areaFrac <= 0.35 && b.fill >= 0.5 && windowIdx < 3) {
      windowIdx++;
      push({
        label: 'Okno / steklena površina',
        count: 1,
        box: blobToBox(b, f.W, f.H),
        estWidthCm: blobLenCm(bw),
        estHeightCm: blobLenCm(bh),
        note: 'Zaznano po svetli, malo nasičeni površini z robom.',
      });
    }
  }
  if (f.bestDoor) {
    const bw = f.bestDoor.x1 - f.bestDoor.x0 + 1;
    const bh = f.bestDoor.y1 - f.bestDoor.y0 + 1;
    push({
      label: 'Vrata / vhod',
      count: 1,
      box: blobToBox(f.bestDoor, f.W, f.H),
      estWidthCm: blobLenCm(bw),
      estHeightCm: blobLenCm(bh),
      note: 'Visoka pravokotna odprtina — uporabna referenca za umerjanje.',
    });
  }
  if (f.verticals.length >= 3) {
    push({
      label: 'Stebri / navpični profili',
      count: f.verticals.length,
      box: null,
      estWidthCm: null,
      estHeightCm: null,
      note: `Houghova transformacija je zaznala ${f.verticals.length} izrazitih navpičnih linij.`,
    });
  }
  if (craft === 'keramika' && f.grid.both) {
    push({
      label: 'Polje ploščic',
      count: 1,
      box: [12, 30, 76, 55],
      estWidthCm: null,
      estHeightCm: null,
      note: `Pravilna mreža na obeh oseh (korak ≈ ${f.grid.pitchX}×${f.grid.pitchY} delovnih px).`,
    });
  }
  if (craft === 'wpc-terasa' && f.woodBlobs[0]) {
    const b = f.woodBlobs[0];
    push({
      label: 'Talna obloga (deske)',
      count: 1,
      box: blobToBox(b, f.W, f.H),
      estWidthCm: blobLenCm(b.x1 - b.x0 + 1),
      estHeightCm: blobLenCm(b.y1 - b.y0 + 1),
      note: f.grid.single ? 'Vzporedne črte — tipičen vzorec desk.' : 'Toplejši ton v spodnjem delu slike.',
    });
  }
  if (f.stairPattern) {
    push({
      label: 'Stopnice',
      count: 1,
      box: null,
      estWidthCm: null,
      estHeightCm: null,
      note: `Vzorec stopnic: ${f.stairSteps} zaznanih stopenj (vodoravne linije + diagonale).`,
    });
  }
  if (f.greenBlobs[0] && f.greenBlobs[0].area / N > 0.04) {
    push({
      label: 'Zelenje / rastlinje',
      count: 1,
      box: blobToBox(f.greenBlobs[0], f.W, f.H),
      estWidthCm: null,
      estHeightCm: null,
      note: 'Zelena rastlinje v okolici objekta.',
    });
  }
  if (f.rustBlobs[0] && f.rustBlobs[0].area / N > 0.008) {
    push({
      label: 'Rja / korozija',
      count: 1,
      box: blobToBox(f.rustBlobs[0], f.W, f.H),
      estWidthCm: null,
      estHeightCm: null,
      note: 'Rjasto obarvano območje — preveri kovinske elemente.',
    });
  }

  // Temne okenske odprtine (svetla fasada) — prej nevidne v objektih
  let darkWinIdx = 0;
  for (const b of f.framedDark) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const aspect = bh / bw;
    const areaFrac = b.area / N;
    if (aspect >= 0.55 && aspect <= 1.9 && areaFrac >= 0.012 && areaFrac <= 0.35 && b.fill >= 0.5 && darkWinIdx < 2) {
      darkWinIdx++;
      push({
        label: 'Okno / temna odprtina',
        count: 1,
        box: blobToBox(b, f.W, f.H),
        estWidthCm: blobLenCm(bw),
        estHeightCm: blobLenCm(bh),
        note: 'Temna pravokotna odprtina z okvirjem — tipično okno na fasadi.',
      });
    }
  }

  // Struktura površine (detektor vzorcev) — dokumentira obstoječi vzorec
  if (structure && structure.confidence !== 'nizka') {
    let pitchNote = `Zanesljivost: ${structure.confidence}.`;
    if (structure.pitchPx !== null) {
      const pxPerCmFull = pxPerCm * (img.width / f.W);
      const pitchCm = pxPerCmFull > 0 ? Math.round((structure.pitchPx / pxPerCmFull) * 10) / 10 : null;
      pitchNote =
        pitchCm !== null && pitchCm >= 3 && pitchCm <= 60
          ? `Zanesljivost: ${structure.confidence} · razmak elementov ≈ ${pitchCm.toLocaleString('sl-SI')} cm.`
          : `Zanesljivost: ${structure.confidence} · perioda ≈ ${structure.pitchPx} px.`;
    }
    push({
      label: `Vzorec: ${structure.detail}`,
      count: 1,
      box: null,
      estWidthCm: null,
      estHeightCm: null,
      note: pitchNote,
    });
  }

  // Steklena balustrada (dokaz za ograde)
  const glassBalustrade =
    f.diagonals.length >= 8 && f.glassFrac > 0.25 && f.metalFrac > 0.4 && f.greenFrac < 0.05 && !f.bestDoor;
  if (craft === 'ograje' && glassBalustrade) {
    push({
      label: 'Steklena ograja / balustrada',
      count: 1,
      box: null,
      estWidthCm: null,
      estHeightCm: null,
      note: 'Veliko prozornih površin + kovinski profili + diagonalna perspektiva ročajev.',
    });
  }

  // ── Materiali ──
  const materials: string[] = [];
  if (f.woodFrac > 0.18) materials.push('les / WPC');
  if (f.glassBlobs.length >= 1 && f.glassFrac > 0.02) materials.push('steklo');
  if (f.metalFrac > 0.08 && f.verticals.length >= 3) materials.push('kovina (alu / inox)');
  if (craft === 'keramika' && f.grid.both) materials.push('keramika');
  if (f.flatFrac > 0.45 && f.metalFrac > 0.3) materials.push('omet / beton');
  if (f.rustFrac > 0.015) materials.push('rja');
  if (f.greenFrac > 0.15) materials.push('zelenje (okolica)');
  if (materials.length === 0) materials.push('neopredeljeno');

  // ── Tveganja ──
  const hazards: string[] = [];
  if (f.rustFrac > 0.015) hazards.push('Možna rja/korozija — preveri kovinske elemente in pritrditve.');
  const centralDark = f.darkBlobs.find((b) => {
    const cx = b.cx / f.W;
    const cy = b.cy / f.H;
    return cx > 0.2 && cx < 0.8 && cy > 0.2 && cy < 0.85 && b.area / N > 0.03;
  });
  if (centralDark) hazards.push('Temni predeli v osrednjem delu — možna vlaga, plesen ali poškodba.');
  if (f.greenFrac > 0.2) hazards.push('Rastlinje v stiku z objektom — preveri vlago in odvodnjavanje.');
  const structured = f.lumaStd > 10;
  if (structured && f.lapVar < 20) {
    hazards.push('Slika je zamegljena — ocena mer je manj zanesljiva, posnemi ostrejšo fotografijo.');
  }
  if (!structured) {
    hazards.push('Slika je skoraj brez struktur — analiza je omejena, fotografiraj objekt iz bližje.');
  }
  if (f.brightness < 45) hazards.push('Slaba osvetlitev — analiza je omejena.');

  // ── Besedila po obrti ──
  const MEASUREMENTS: Record<CraftCategory, string[]> = {
    'ograje': ['Skupna dolžina ograje', 'Višina ograje', 'Razpon med stebri', 'Širina vhodnih vrat (če obstajajo)'],
    'stopnice': ['Širina stopnic', 'Višina in globina ene stopnje', 'Skupno število stopnic', 'Dolžina ograje stopnic (če je)'],
    'keramika': ['Dolžina in širina tal / stene', 'Velikost ene ploščice', 'Višina stenskih oblog', 'Kvadratura odprtin'],
    'wpc-terasa': ['Dolžina in širina terase', 'Smer polaganja desk', 'Višina podesta (če obstaja)'],
    'okna-vrata': ['Širina in višina vsake odprtine', 'Število okenskih in vratnih kosov', 'Globina odprtine'],
    'nadstreški': ['Širina in globina nadstreška', 'Višina pritrditve na objekt', 'Razdalja med nosilci'],
    'fasada': ['Obseg fasade', 'Višina fasade', 'Kvadratura odprtin (okna/vrata)'],
    'drugo': ['Ključne dolžine objekta', 'Višine', 'Površine'],
  };
  const SCOPE: Record<CraftCategory, string> = {
    'ograje': 'Izdelava in montaža ograje: stebri, polnila, pritrditveni material in zaključni profili po izmeri na terenu.',
    'stopnice': 'Izdelava/montaža stopnic ali obnova: stopnice, podest, ograja in pritrditve po natančni izmeri.',
    'keramika': 'Polaganje ploščic: priprava podlage, lepljenje, fugiranje in silikoniranje po kvadraturi.',
    'wpc-terasa': 'Izdelava terase: nosilna konstrukcija, WPC/lesene deske, zaključni profili in odvodnjavanje.',
    'okna-vrata': 'Menjava/vgradnja oken ali vrat: izmera odprtin, montaža, Tesnila in zaključni obrobi.',
    'nadstreški': 'Izdelava nadstreška: nosilci, konstrukcija, strešna obloga in pritrditev na objekt.',
    'fasada': 'Fasada: priprava podlage, obloga/omet in zaključni profili po kvadraturi brez odprtin.',
    'drugo': 'Obseg dela se določi po natančni izmeri na terenu.',
  };

  // ── Predpolnitve kalkulatorja (v metrih / kosih) ──
  const prefill: Partial<CraftInputs> = {};
  const setP = (k: keyof CraftInputs, v: number | string | null | undefined) => {
    if (v !== null && v !== undefined) (prefill as Record<string, unknown>)[k as string] = v;
  };
  switch (craft) {
    case 'okna-vrata': {
      const nWin = Math.min(9, windowCount);
      if (nWin >= 1) setP('windowCount', nWin);
      if (f.bestDoor) setP('doorCount', 1);
      break;
    }
    case 'keramika': {
      const s = surfaces[0]?.estAreaM2 ?? null;
      if (s && s > 0.5) {
        const box = surfaces[0]?.quad;
        const aspect =
          box ? Math.max(0.4, Math.min(2.5, (box[1][0] - box[0][0]) / Math.max(1, box[3][1] - box[0][1]))) : 1.4;
        const L = Math.sqrt(s * aspect);
        setP('floorLength', round2(clamp(L, 0.5, 100)));
        setP('floorWidth', round2(clamp(s / L, 0.5, 100)));
      }
      break;
    }
    case 'wpc-terasa': {
      const s = surfaces[0]?.estAreaM2 ?? null;
      if (s && s > 0.5) {
        const L = Math.sqrt(s * 1.5);
        setP('deckLength', round2(clamp(L, 0.5, 100)));
        setP('deckWidth', round2(clamp(s / L, 0.5, 100)));
      }
      break;
    }
    case 'ograje': {
      const wideGlassB = f.glassBlobs.find((b) => (b.x1 - b.x0 + 1) > f.W * 0.35);
      if (wideGlassB) setP('material', 'steklo');
      else if (f.metalFrac > 0.3 && f.woodFrac < 0.1) setP('material', 'alu');
      if (pxPerCm > 0) {
        const bandW = blobLenCm(f.W * 0.7);
        if (bandW) setP('length', round2(clamp(bandW / 100, 1, 80)));
        if (wideGlassB) {
          const h = blobLenCm(wideGlassB.y1 - wideGlassB.y0 + 1);
          if (h) setP('height', round2(clamp(h / 100, 0.9, 3)));
        }
      }
      break;
    }
    case 'stopnice': {
      if (f.stairSteps >= 2) setP('steps', f.stairSteps);
      break;
    }
    case 'fasada': {
      if (pxPerCm > 0 && f.flatBlob) {
        const h = blobLenCm(f.flatBlob.y1 - f.flatBlob.y0 + 1);
        if (h) setP('facadeHeight', round2(clamp(h / 100, 1, 60)));
      }
      if (pxPerCm > 0 && windowCount >= 1) {
        const total = f.glassBlobs
          .filter((b) => {
            const bw = b.x1 - b.x0 + 1;
            const bh = b.y1 - b.y0 + 1;
            const aspect = bh / bw;
            const areaFrac = b.area / N;
            return aspect >= 0.55 && aspect <= 1.9 && areaFrac >= 0.012 && areaFrac <= 0.35 && b.fill >= 0.5;
          })
          .reduce((s, b) => s + (blobAreaM2(b) ?? 0), 0);
        if (total > 0) setP('openingsM2', round2(clamp(total, 0.1, 500)));
      }
      break;
    }
    default:
      break;
  }

  // ── Opis scene, kakovost, priporočila ──
  const descParts: string[] = [];
  descParts.push(f.outdoor ? 'Zunanja scena (zaznano nebo ali odprt prostor).' : 'Notranja / zaprta scena.');
  if (f.grid.both) descParts.push(`Zaznana pravilna mreža na obeh oseh (korak ≈ ${f.grid.pitchX}×${f.grid.pitchY} px) — tipično ploščice.`);
  else if (f.grid.single) descParts.push('Zaznane vzporedne črte — tipično deske ali letve.');
  if (f.verticals.length >= 3) descParts.push(`${f.verticals.length} izrazitih navpičnih struktur (stebri/okvirji).`);
  if (f.stairPattern) descParts.push(`Vzorec stopnic z ≈ ${f.stairSteps} stopnjami.`);
  if (structure && structure.confidence !== 'nizka') {
    descParts.push(`Vzorčna skripta: ${structure.detail.toLowerCase()} (zanesljivost ${structure.confidence}).`);
  }
  if (craft === 'ograje' && f.diagonals.length >= 8 && f.glassFrac > 0.25 && f.metalFrac > 0.4 && f.greenFrac < 0.05 && !f.bestDoor) {
    descParts.push('Skripta prepozna stekleno ograjo/balustrado (steklo + kovina + diagonalni ročaji).');
  }
  if (reference) descParts.push(`Referenca za merilo: ${reference.label.toLowerCase()} (${reference.assumedCm} cm).`);
  else descParts.push('Zanesljive reference za umerjanje ni — umeri merilo ročno (znana dolžina).');
  const sceneDescription = descParts.join(' ');

  let sharpScore = clamp(f.lapVar / 1.1, 0, 100);
  if (f.brightness < 45 || f.brightness > 225) sharpScore -= 25;
  if (f.clipped > 0.2) sharpScore -= 15;
  if (!structured) sharpScore = Math.min(sharpScore, 45); // ploska scena brez struktur
  const conditionScore = Math.round(clamp(sharpScore, 5, 98));
  const conditionNotes = [
    `Ostrina (Laplaceova varianca): ${Math.round(f.lapVar)}.`,
    `Svetlost: ${Math.round(f.brightness)}/255.`,
    reference
      ? 'Merilo se lahko umeri samodejno po zaznani referenci.'
      : 'Priporočen ročni vnos znane dolžine za umerjanje.',
  ].join(' ');

  const recParts: string[] = [];
  recParts.push('Izmeri ključne dimenzije na terenu (laser ali merilni trak) in potrdi površine pred ponudbo.');
  if (f.rustFrac > 0.015) recParts.push('Rjasta območja predelaj (brusenje + zaščita) ali vključi menjavo elementov v ponudbo.');
  if (centralDark) recParts.push('Temne predele preveri za vlago/plesen in jih upoštevaj v pripravi podlage.');
  if (craft === 'keramika') recParts.push('Preveri ravnost podlage in načrtuj fuge glede na velikost ploščic.');
  if (craft === 'wpc-terasa') recParts.push('Zagotovi padec tal ≈ 1–2 % za odvodnjavanje in ustrezno razmik med deskami.');
  const recommendations = recParts.slice(0, 3).join(' ');

  return {
    craft,
    craftConfidence: confidence,
    sceneDescription,
    objects,
    reference,
    referenceBox,
    scaleSuggestions,
    scaleAgreement,
    surfaces,
    materials,
    hazards,
    scope: SCOPE[craft],
    estimatedAreaM2: surfaces[0]?.estAreaM2 ?? null,
    measurementsNeeded: MEASUREMENTS[craft],
    condition: { score: conditionScore, notes: conditionNotes },
    recommendations,
    prefill,
  };
}
