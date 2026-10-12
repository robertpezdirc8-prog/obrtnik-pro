// ─── Stopnični profil: meritvena skripta za stopnice s fotke ──
// Čisto skriptno, brez AI (raziskava: research/task26).
//  • SPREDNJI pogled: nosilci so horizontalne linije → vertikalni gradient
//    po vodoravnem pasu → projekcijski profil → vrhovi = stopnje
//    (istega izvora kot bar-count, pragojena thresholds za velike stopnice).
//  • STRANSKI pogled: uporabnik klikne vrh in dno nosilčne (stopničaste)
//    linije; vzdolž daljice vsak riser da vrh gradienta; perioda iz
//    avtokorelacije; št. stopenj = vrhovi ± kontrola po periodi.
//  • Geometrija po kalibraciji (pxPerCm iz referenčnega objekta ALI znane
//    višinske razlike): totalRise, riser, going (stranski: iz run; frontalni:
//    predlog po Blondelu), dolžina ograje po naklonu, komfort 2R+G (60–66).
//
// Vse čiste funkcije (brez DOM) — testabilno v bun (tests/verify).

import type { PctPoint, RgbaImage } from './bar-count';

export type { PctPoint, RgbaImage };

// ─── Javni tipi ─────────────────────────────────────────────

export type StairMode = 'front' | 'side';

/** Vir kalibracije: referenčni objekt, znana višinska razlika ali brez. */
export type StairCalibSource = 'reference' | 'known-rise' | 'none';

export interface StairPoint {
  x: number;
  y: number;
}

export interface StairProfileInput {
  img: RgbaImage;
  mode: StairMode;
  /** Stranski pogled: [vrh, dno] nosilčne linije (v % slike). */
  line?: [PctPoint, PctPoint];
  /** Kalibracija: pxPerCm (iz referenčnega objekta) — izbirno. */
  pxPerCm?: number | null;
  /** Znana višinska razlika v cm → interno pxPerCm. */
  knownRiseCm?: number | null;
  /** Polovična širina pasu v px (privzeto samodejno). */
  bandPx?: number;
}

export interface StairComfort {
  /** 2R + G v cm */
  value: number;
  ok: boolean;
  /** Ali je going izmerjen (stranski) ali predlog po Blondelu (frontalni). */
  goingEstimated: boolean;
}

export interface StairProfileResult {
  ok: boolean;
  mode: StairMode;
  /** Št. zaznanih stopenj (nosilcev/riserjev). */
  steps: number;
  /** Povprečni korak v px vzdolž profila. */
  pitchPx: number;
  /** Zaznane linije v % slike (za anotacijo v UI). */
  peaksPct: StairPoint[];
  /** Moč kontrasta (0–1). */
  amplitude: number;
  /** Variacijski koeficient razmakov (manjši = bolj pravilno). */
  pitchCv: number;
  confidence: number;
  verdict: 'visoka' | 'srednja' | 'nizka';
  warnings: string[];
  pxPerCm: number | null;
  calibSource: StairCalibSource;
  /** Geometrija — samo s kalibracijo. */
  totalRiseCm: number | null;
  riserCm: number | null;
  goingCm: number | null;
  railingLengthCm: number | null;
  /** Naklon stopnišča v ° (stranski pogled; frontalni null). */
  slopeDeg: number | null;
  /** Vertikalni razpon nosilcev v px (pred kalibracijo). */
  risePx: number | null;
  /** Horizontalni razpon v px (stranski). */
  runPx: number | null;
  comfort: StairComfort | null;
}

// ─── Notranje pomoćne ───────────────────────────────────────

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

/** Mediana (kopija, ker sortira). */
function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Avtokorelacija signala (0–maxLag) — vrne lag z najvišjo korelacijo. */
function bestPeriod(v: Float32Array, minLag: number, maxLag: number): { lag: number; score: number } {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= Math.max(1, v.length);
  const c = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) c[i] = v[i] - mean;
  let best = { lag: 0, score: 0 };
  for (let lag = minLag; lag <= maxLag && lag < v.length; lag++) {
    let s = 0, n = 0;
    for (let i = 0; i + lag < v.length; i++) { s += c[i] * c[i + lag]; n++; }
    const score = n > 0 ? s / n : 0;
    if (score > best.score) best = { lag, score };
  }
  return best;
}

interface Peak { pos: number; val: number }

/** Vrhovi z prominenco + najmanjšo razdaljo. */
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
  // prominenca glede na najvišji vrh
  const top = chosen[0].val;
  return chosen.filter((p) => p.val >= top * minProm);
}

// ─── SPREDNJI pogled: vertikalni projekcijski profil ────────

function frontProfile(img: RgbaImage) {
  const { width: w, height: h } = img;
  const g = toGray(img);
  // pas: sredinski 70 % širine, celotna višina (verižni filter kasneje odstrani
  // okna/stropa na vrhu — pitch konsistentnost je močnejša kot ojej višinski rez)
  const x0 = Math.round(w * 0.15);
  const x1 = Math.round(w * 0.85);
  const y0 = Math.max(1, Math.round(h * 0.06));
  const y1 = h - 2;
  const step = Math.max(1, Math.floor((x1 - x0) / 160)); // vzorči ≤ 160 stolpcev
  const prof = new Float32Array(h);
  for (let y = y0; y < y1; y++) {
    let s = 0, n = 0;
    for (let x = x0; x < x1; x += step) {
      const up = g[(y - 1) * w + x];
      const dn = g[(y + 1) * w + x];
      s += Math.abs(dn - up);
      n++;
    }
    prof[y] = n > 0 ? s / n : 0;
  }
  // detrend: odštej drseče povprečje (okno ~ 1/8 višine)
  const win = Math.max(24, Math.round(h / 8));
  const trend = movingMean(prof, win);
  const det = new Float32Array(h);
  let maxV = 0;
  for (let y = 0; y < h; y++) {
    det[y] = Math.max(0, prof[y] - trend[y]);
    if (det[y] > maxV) maxV = det[y];
  }
  if (maxV > 0) for (let y = 0; y < h; y++) det[y] /= maxV;
  return { det, y0, y1, h, w };
}

// ─── STRANSKI pogled: profil vzdolž nosilčne linije ─────────

function sideProfile(img: RgbaImage, line: [PctPoint, PctPoint], bandPx: number | undefined) {
  const { width: w, height: h } = img;
  const g = toGray(img);
  const p0 = { x: (line[0].x / 100) * w, y: (line[0].y / 100) * h };
  const p1 = { x: (line[1].x / 100) * w, y: (line[1].y / 100) * h };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 30) return null;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux; // pravokotnica
  const band = bandPx ?? 7;
  const n = Math.floor(len);
  const prof = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const cx = p0.x + ux * t;
    const cy = p0.y + uy * t;
    let m = 0;
    for (let o = -band; o <= band; o++) {
      const x = Math.round(cx + px * o);
      const y = Math.round(cy + py * o);
      if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;
      // gradient pravokotno na linijo = prehod riser/tread ob liniji
      const gx = g[y * w + x + 1] - g[y * w + x - 1];
      const gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
      const mag = Math.abs(gx * ux + gy * uy);
      if (mag > m) m = mag;
    }
    prof[t] = m;
  }
  // detrend + normalizacija
  const win = Math.max(20, Math.round(n / 7));
  const trend = movingMean(prof, win);
  const det = new Float32Array(n);
  let maxV = 0;
  for (let t = 0; t < n; t++) {
    det[t] = Math.max(0, prof[t] - trend[t]);
    if (det[t] > maxV) maxV = det[t];
  }
  if (maxV > 0) for (let t = 0; t < n; t++) det[t] /= maxV;
  return { det, len, n, p0, p1, dx, dy, w, h };
}

// ─── Glavna funkcija ────────────────────────────────────────

const MIN_PITCH_PX = 14;     // min korak stopnic v delovni sliki
const MAX_STEPS = 30;

export function analyzeStairProfile(input: StairProfileInput): StairProfileResult {
  const { img, mode } = input;
  const warnings: string[] = [];
  const base: StairProfileResult = {
    ok: false, mode, steps: 0, pitchPx: 0, peaksPct: [], amplitude: 0, pitchCv: 1,
    confidence: 0, verdict: 'nizka', warnings,
    pxPerCm: null, calibSource: 'none',
    totalRiseCm: null, riserCm: null, goingCm: null, railingLengthCm: null,
    slopeDeg: null, risePx: null, runPx: null, comfort: null,
  };

  let det: Float32Array | null = null;
  let risePx: number | null = null;
  let runPx: number | null = null;

  if (mode === 'front') {
    const fp = frontProfile(img);
    det = fp.det;
  } else {
    if (!input.line || input.line.length !== 2) {
      warnings.push('Stranski pogled: klikni vrh in dno stopnišča na fotki.');
      return base;
    }
    const sp = sideProfile(img, input.line, input.bandPx);
    if (!sp) {
      warnings.push('Linija je prekratka — klikni skozi celo stopnišče (vrh → dno).');
      return base;
    }
    det = sp.det;
    risePx = Math.abs(sp.dy);
    runPx = Math.abs(sp.dx);
  }
  if (!det) return base;

  // ACF perioda (za min razdaljo vrhov)
  const minLag = MIN_PITCH_PX;
  const maxLag = Math.max(minLag + 4, Math.floor(det.length / 4));
  const acf = bestPeriod(det, minLag, Math.min(maxLag, 400));
  const minDist = Math.max(MIN_PITCH_PX, acf.score > 0.15 ? Math.round(acf.lag * 0.7) : MIN_PITCH_PX);

  // vrhovi
  let peaks = findPeaks(det, minDist, 0.22);
  // združi dvojne robove (zgornji/spodnji rob istega nosilca)
  const pitchGuess = acf.score > 0.15 ? acf.lag : (peaks.length > 1 ? median(peaks.slice(1).map((p, i) => p.pos - peaks[i].pos)) : 0);
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
  if (peaks.length > MAX_STEPS) {
    peaks = peaks.slice(peaks.length - MAX_STEPS);
    warnings.push('Zaznanih zelo veliko linij — preveri izbiro pasu/linije.');
  }

  // REGULARNA VERIGA: samo vrhovi z razmaki ≈ pitch (okna, ročaji in druge
  // nepravilne linije ne sledijo aritmetični progresiji stopnic). Pri izenačeni
  // dolžini preferiramo verigo NIZKO na sliki (stopnice so v spodnjem delu).
  {
    const p0 = pitchGuess > 0 ? pitchGuess : (peaks.length > 1 ? median(peaks.slice(1).map((q, i) => q.pos - peaks[i].pos)) : 0);
    if (peaks.length > 2 && p0 > 0) {
      let bestChain: Peak[] = [];
      let cur: Peak[] = [];
      for (const p of peaks) {
        if (cur.length === 0) cur = [p];
        else {
          const g = p.pos - cur[cur.length - 1].pos;
          if (g >= p0 * 0.55 && g <= p0 * 2.1) cur.push(p);
          else {
            if (cur.length > bestChain.length ||
                (cur.length === bestChain.length && cur.length > 0 && bestChain.length > 0 &&
                 cur[cur.length - 1].pos > bestChain[bestChain.length - 1].pos)) bestChain = cur;
            cur = [p];
          }
        }
      }
      if (cur.length > bestChain.length ||
          (cur.length === bestChain.length && cur.length > 0 && bestChain.length > 0 &&
           cur[cur.length - 1].pos > bestChain[bestChain.length - 1].pos)) bestChain = cur;
      if (bestChain.length >= 3 && bestChain.length < peaks.length) {
        peaks = bestChain;
      }
    }
  }

  const steps = peaks.length;
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i].pos - peaks[i - 1].pos);
  const pitchPx = median(gaps) || pitchGuess;
  const meanPitch = gaps.length > 0 ? gaps.reduce((s, v) => s + v, 0) / gaps.length : pitchPx;
  const pitchCv = meanPitch > 0 ? Math.sqrt(gaps.reduce((s, v) => s + (v - meanPitch) ** 2, 0) / gaps.length) / meanPitch : 1;
  const amplitude = det.length > 0 ? Math.max(...Array.from(det)) : 0;

  if (steps < 2) {
    warnings.push('Stopnic ni bilo mogoče prešteti — poskusi drugi pogled ali boljšo svetlobo.');
    return { ...base, warnings, risePx, runPx };
  }

  // vertikalni razpon nosilcev — od prvega do zadnjega vrha
  if (mode === 'front') {
    risePx = peaks[peaks.length - 1].pos - peaks[0].pos; // det indeks = vrstica
  }

  // anotacije v % slike
  const peaksPct: StairPoint[] = peaks.map((p) => {
    if (mode === 'front') return { x: 50, y: (p.pos / img.height) * 100 };
    const sp = sideProfileCache(img, input.line!);
    return sp && sp.length > 0 ? sp[Math.min(p.pos, sp.length - 1)] : { x: 50, y: 50 };
  });

  // ── kalibracija ──
  let pxPerCm = input.pxPerCm && input.pxPerCm > 0.05 ? input.pxPerCm : null;
  let calibSource: StairCalibSource = pxPerCm ? 'reference' : 'none';
  if (!pxPerCm && input.knownRiseCm && knownRiseValid(risePx, input.knownRiseCm)) {
    pxPerCm = risePx! / input.knownRiseCm;
    calibSource = 'known-rise';
  }
  if (!pxPerCm) warnings.push('Brez kalibracije: izpišemo samo število stopenj — za cm umeri merilo ali vpiši znano višino.');

  // geometrija
  let totalRiseCm: number | null = null;
  let riserCm: number | null = null;
  let goingCm: number | null = null;
  let railingLengthCm: number | null = null;
  let slopeDeg: number | null = null;
  let comfort: StairComfort | null = null;

  if (pxPerCm) {
    if (risePx) totalRiseCm = risePx / pxPerCm;
    if (mode === 'side' && runPx && steps > 0) {
      const runCm = runPx / pxPerCm;
      goingCm = runCm / steps;
      slopeDeg = (Math.atan2(risePx ?? 0, runPx) * 180) / Math.PI;
      railingLengthCm = Math.hypot(runPx, risePx ?? 0) / pxPerCm;
    }
    if (totalRiseCm && steps > 0) riserCm = totalRiseCm / steps;
    else if (pitchPx && mode === 'front') riserCm = pitchPx / pxPerCm;

    if (riserCm && goingCm) {
      comfort = { value: 2 * riserCm + goingCm, ok: false, goingEstimated: false };
    } else if (riserCm) {
      // frontalni pogled: going ni viden → predlog po Blondelu (2R+G ≈ 63)
      goingCm = Math.min(32, Math.max(25, 63 - 2 * riserCm));
      comfort = { value: 2 * riserCm + goingCm, ok: false, goingEstimated: true };
    }
    if (comfort) comfort.ok = comfort.value >= 60 && comfort.value <= 66;

    // opozorila po DIN 18065 / Blondelu
    if (riserCm && (riserCm < 10 || riserCm > 25)) warnings.push(`Višina stopnice ${riserCm.toFixed(1).replace('.', ',')} cm je izven pričakovanega (14–19 cm) — preveri kalibracijo.`);
    if (goingCm && !comfort?.goingEstimated && goingCm < 24) warnings.push(`Globina teka ${goingCm.toFixed(1).replace('.', ',')} cm je pod priporočili (≥ 25–28 cm).`);
    if (comfort && !comfort.ok && !comfort.goingEstimated) {
      warnings.push(`Komfort 2R+G = ${comfort.value.toFixed(0)} cm (priporočeno 60–66 cm).`);
    }
  }

  // zanesljivost
  let conf = 40;
  if (steps >= 3) conf += 20;
  if (amplitude > 0.35) conf += 15;
  if (pitchCv < 0.15) conf += 15;
  else if (pitchCv > 0.35) conf -= 15;
  if (pxPerCm) conf += 10;
  conf = Math.max(10, Math.min(98, Math.round(conf)));
  const verdict = conf >= 75 ? 'visoka' : conf >= 50 ? 'srednja' : 'nizka';
  if (pitchCv > 0.35) warnings.push('Neenakomerni razmaki linij — rezultat preveri ročno.');
  if (mode === 'side' && Math.abs((input.line?.[1].y ?? 0) - (input.line?.[0].y ?? 0)) < 3) {
    warnings.push('Linija je vodoravna — stranski pogled potrebuje vrh in dno stopnišča.');
  }

  return {
    ok: true, mode, steps, pitchPx, peaksPct, amplitude, pitchCv,
    confidence: conf, verdict, warnings,
    pxPerCm, calibSource, totalRiseCm, riserCm, goingCm, railingLengthCm,
    slopeDeg, risePx, runPx, comfort,
  };
}

function knownRiseValid(risePx: number | null, knownCm: number): boolean {
  return risePx !== null && risePx > 10 && knownCm >= 20 && knownCm <= 1200;
}

// ─── Pomoč za anotacije (stranski pogled: t → % slike) ─────

const sideCache = new WeakMap<RgbaImage, { line: string; pts: StairPoint[] }>();

function sideProfileCache(img: RgbaImage, line: [PctPoint, PctPoint]): StairPoint[] {
  const key = `${line[0].x},${line[0].y},${line[1].x},${line[1].y}`;
  const c = sideCache.get(img);
  if (c && c.line === key) return c.pts;
  const { width: w, height: h } = img;
  const p0 = { x: (line[0].x / 100) * w, y: (line[0].y / 100) * h };
  const p1 = { x: (line[1].x / 100) * w, y: (line[1].y / 100) * h };
  const n = Math.floor(Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const pts: StairPoint[] = new Array(Math.max(0, n));
  for (let t = 0; t < n; t++) {
    const x = p0.x + ((p1.x - p0.x) * t) / n;
    const y = p0.y + ((p1.y - p0.y) * t) / n;
    pts[t] = { x: (x / w) * 100, y: (y / h) * 100 };
  }
  sideCache.set(img, { line: key, pts });
  return pts;
}
