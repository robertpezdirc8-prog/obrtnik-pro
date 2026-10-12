// ─── Števec palic: projekcijski profil vzdolž traku na fotki ──
// Čisto skriptno, brez AI. Uporabnik potegni daljico čez vrsto palic
// (npr. ograjnih palic, lamele, piket); skripta:
//  1. vzdolž daljice vzorči sivinsko sliko (povprečje čez ozek pravokotni
//     pas — "projekcijski profil", ista tehnika kot pri detekciji naklona),
//  2. odstrani počasni trend (drseče povprečje) → palice izstopajo kot
//     lokalni ekstremi ne glede na osvetlitev,
//  3. samodejno zazna polariteto (temne palice na svetlem ozadju ali
//     obratno) in poravna signal, da so palice vedno vrhovi,
//  4. pošče vrhove z algoritmom vrste findpeaks (prominenca + najmanjša
//     razdalja iz avtokorelacije — ocena pričakovanega razmaka),
//  5. iz mean pitch + debeline iz FWHM izračuna cm vrednosti po
//     kalibraciji (znana realna dolžina daljice ali referenčni objekt).
//
// Izhod: št. palic, razmak (os) + debelina palice v cm, št. kosov/m,
// kakovost zaznave (amplituda kontrasta + konsistenca razmakov).

// ─── Javni tipi ─────────────────────────────────────────────

/** Surova slika: RGBA, 1 bajt na kanal (kot canvas ImageData). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Točka v odstotkih slike (0–100). */
export interface PctPoint {
  x: number;
  y: number;
}

export interface StripInput {
  img: RgbaImage;
  /** začetek traku (v % slike) */
  p0: PctPoint;
  /** konec traku (v % slike) */
  p1: PctPoint;
  /** polovična širina pasu v px (povprečje čez pravokotno smer) */
  bandPx?: number;
}

export interface StripProfile {
  /** št. zaznanih palic */
  count: number;
  /** povprečni razmak med središči palic (pitch) v px vzdolž traku */
  pitchPx: number;
  /** povprečna debelina palice v px (FWHM) */
  barWidthPx: number;
  /** dolžina traku v px */
  lengthPx: number;
  /** amplituda kontrasta (0–1, normalizirana detrendirana vrednost) */
  amplitude: number;
  /** variacijski koeficient razmakov (manjši = bolj pravilna vrsta) */
  pitchCv: number;
  /** 'temne-na-svetlem' | 'svetle-na-temnem' */
  polarity: 'dark-on-light' | 'light-on-dark';
  /** pozicije vrhov v px vzdolž traku (središča palic) */
  peaks: number[];
  /** normaliziran profil (0–1) za risanje v UI */
  profile: number[];
  /** kakovost: visoka ≥ visoka amplituda + nizek CV, nizka = nesmiselen rezultat */
  confidence: 'visoka' | 'srednja' | 'nizka';
}

export interface BarDims {
  /** št. palic znotraj traku */
  count: number;
  /** razmak os–os (pitch) v cm */
  pitchCm: number;
  /** debelina palice v cm */
  barWidthCm: number;
  /** reža med palicami v cm */
  gapCm: number;
  /** kosov na meter (100 / pitch) */
  barsPerMeter: number;
  /** cm na piksel (za povratno informacijo) */
  cmPerPx: number;
  /** kakovost zaznave (iz profila) */
  confidence: StripProfile['confidence'];
  /** položaji središč palic (frakcija 0–1 vzdolž traku) za risanje v UI */
  positions: number[];
}

/** Predlog parametrov za Vizualizer (vertikalne palice / lamele). */
export interface VizBarSuggest {
  spacingCm: number;
  elementCm: number;
  count: number;
  confidence: StripProfile['confidence'];
}

// ─── Mali pripomočki ────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function lumaAt(img: RgbaImage, x: number, y: number): number {
  const xi = clamp(Math.round(x), 0, img.width - 1);
  const yi = clamp(Math.round(y), 0, img.height - 1);
  const i = (yi * img.width + xi) * 4;
  // Rec. 709 luma
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
}

/** Drseče povprečje (za odstranitev počasnega trenda osvetlitve). */
function movingAverage(v: number[], win: number): number[] {
  const n = v.length;
  const out = new Array<number>(n);
  const w = Math.max(1, Math.min(win, n));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += v[i];
    if (i >= w) sum -= v[i - w];
    out[i] = sum / Math.min(i + 1, w);
  }
  // ravnaj zamik (okno "za") z drugim prehodom naprej
  let sum2 = 0;
  const out2 = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    sum2 += out[i];
    if (i + w < n) sum2 -= out[i + w];
    out2[i] = sum2 / Math.min(n - i, w);
  }
  return out2;
}

/** Preprost glajenje [1,2,3,2,1]. */
function smooth5(v: number[]): number[] {
  const n = v.length;
  const k = [1, 2, 3, 2, 1];
  const kw = k.reduce((a, b) => a + b, 0);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) {
      const idx = clamp(i + j, 0, n - 1);
      s += v[idx] * k[j + 2];
    }
    out[i] = s / kw;
  }
  return out;
}

/** Normaliziraj na 0–1 (min–max). */
function normalize01(v: number[]): number[] {
  let mn = Infinity;
  let mx = -Infinity;
  for (const x of v) {
    if (x < mn) mn = x;
    if (x > mx) mx = x;
  }
  const d = mx - mn;
  if (d < 1e-9) return v.map(() => 0.5);
  return v.map((x) => (x - mn) / d);
}

// ─── 1. Projekcijski profil vzdolž traku ────────────────────

/** Vzorči sivine vzdolž daljice (povprečje čez pravokoten pas) + trend. */
function sampleStrip(img: RgbaImage, p0: PctPoint, p1: PctPoint, bandPx: number) {
  const ax = (p0.x / 100) * (img.width - 1);
  const ay = (p0.y / 100) * (img.height - 1);
  const bx = (p1.x / 100) * (img.width - 1);
  const by = (p1.y / 100) * (img.height - 1);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const n = Math.max(16, Math.min(2400, Math.round(len)));
  const ux = dx / len;
  const uy = dy / len;
  // pravokotna smer (za pas)
  const px = -uy;
  const py = ux;
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * len;
    const cx = ax + ux * t;
    const cy = ay + uy * t;
    let s = 0;
    let wsum = 0;
    for (let b = -bandPx; b <= bandPx; b++) {
      // trikotna utež pasu (robi manj štejejo)
      const w = 1 - Math.abs(b) / (bandPx + 1);
      s += lumaAt(img, cx + px * b, cy + py * b) * w;
      wsum += w;
    }
    raw[i] = s / Math.max(1e-6, wsum);
  }
  return { raw, len, n };
}

// ─── 2. Detekcija vrhov (vrste findpeaks) ───────────────────

/**
 * Poišče lokalne maksimume s prominenco in najmanjšo razdaljo.
 * `minDist` iz avtokorelacije (pričakovani pitch), `prominenceFrac`
 * del amplitude, pod katerim vrh odpade.
 */
function findPeaks(v: number[], minDist: number, prominenceFrac: number): number[] {
  const n = v.length;
  // 1) vsi lokalni maksimumi (plato-varno)
  const cand: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (v[i] > v[i - 1] && v[i] >= v[i + 1]) cand.push(i);
  }
  if (cand.length === 0) return [];

  // 2) prominanca vsakega kandidata: višina nad višjim od dveh
  //    najnižjih "dolin" do naslednjega višjega vrha (poenostavljeno:
  //    do robov signala)
  const prom = cand.map((i) => {
    // levo
    let leftMin = v[i];
    for (let j = i - 1; j >= 0 && v[j] <= v[i]; j--) leftMin = Math.min(leftMin, v[j]);
    // desno
    let rightMin = v[i];
    for (let j = i + 1; j < n && v[j] <= v[i]; j++) rightMin = Math.min(rightMin, v[j]);
    return v[i] - Math.max(leftMin, rightMin);
  });

  const maxProm = Math.max(...prom);
  const thr = maxProm * prominenceFrac;

  // 3) razvrsti po višini in upoštevaj minDist (poželjivo izločanje)
  const order = cand
    .map((p, idx) => ({ p, h: v[p], pr: prom[idx] }))
    .filter((c) => c.pr >= thr)
    .sort((a, b) => b.h - a.h);
  const taken: number[] = [];
  for (const c of order) {
    if (taken.every((t) => Math.abs(t - c.p) >= minDist)) taken.push(c.p);
  }
  return taken.sort((a, b) => a - b);
}

/** Pričakovani pitch (px) = lag z najvišjo avtokorelacijo + parabolično rafiniranje. */
function dominantPitch(v: number[]): number | null {
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const c = v.map((x) => x - mean);
  const minLag = 4;
  const maxLag = Math.min(Math.floor(n / 2) - 1, Math.max(minLag + 1, Math.round(n / 3)));
  if (maxLag <= minLag) return null;

  // polna avtokorelacija; globalni maksimum = osnovna perioda
  // (pri periodičnem signalu upada z lagom, podharmonikov ni)
  let bestVal = -Infinity;
  let bestIdx = -1;
  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += c[i] * c[i + lag];
    const norm = s / (n - lag);
    ac.push(norm);
    if (norm > bestVal) {
      bestVal = norm;
      bestIdx = lag;
    }
  }
  if (bestIdx < 0 || bestVal <= 1e-6) return null;

  // parabolično rafiniranje vrha (podpikslna natančnost)
  const i0 = bestIdx - minLag;
  const yL = ac[Math.max(0, i0 - 1)];
  const y0 = ac[i0];
  const yR = ac[Math.min(ac.length - 1, i0 + 1)];
  const denom = yL - 2 * y0 + yR;
  const off = denom !== 0 ? clamp(0.5 * (yL - yR) / denom, -0.5, 0.5) : 0;
  return bestIdx + off;
}

// ─── Glavna analiza traku ───────────────────────────────────

/**
 * Projekcijski profil + štetje palic vzdolž traku. Deluje pri poljubnem
 * naklonu traku; najboljše rezultate da trak približno pravokoten na
 * palice, potekajoč čez vsaj 3–4 palice.
 */
export function analyzeBarStrip(input: StripInput): StripProfile {
  const { img, p0, p1 } = input;
  const bandPx = clamp(Math.round(input.bandPx ?? Math.min(img.width, img.height) * 0.012), 1, 40);

  const { raw, len } = sampleStrip(img, p0, p1, bandPx);
  const n = raw.length;

  // odstrani trend (okno ≈ 1/10 traku, min 6 vzorcev)
  const trend = movingAverage(raw, Math.max(6, Math.round(n / 10)));
  let det = raw.map((x, i) => x - trend[i]);
  const detRange = Math.max(...det) - Math.min(...det);
  if (detRange < 1e-6) {
    return {
      count: 0, pitchPx: 0, barWidthPx: 0, lengthPx: len,
      amplitude: 0, pitchCv: 1, polarity: 'dark-on-light',
      peaks: [], profile: det.map(() => 0.5), confidence: 'nizka',
    };
  }

  // polariteta: če so globi (negativni ekstremi) izrazitejši kot vrhovi,
  // so palice temne — obrni signal, da so palice vedno vrhovi
  let maxPos = 0;
  let maxNeg = 0;
  for (const x of det) {
    if (x > maxPos) maxPos = x;
    if (-x > maxNeg) maxNeg = -x;
  }
  const polarity: StripProfile['polarity'] = maxNeg > maxPos ? 'dark-on-light' : 'light-on-dark';
  if (polarity === 'dark-on-light') det = det.map((x) => -x);

  const norm = normalize01(smooth5(det));
  const amplitude = (Math.max(maxPos, maxNeg) * 2) / 255; // 0–1 relativno na sivine

  // pričakovani pitch iz avtokorelacije → min razdalja med vrhovi
  const pitchGuess = dominantPitch(det);
  const minDist = clamp(Math.round((pitchGuess ?? Math.max(4, n / 64)) * 0.6), 3, Math.round(n / 2));

  const peaks = findPeaks(norm, minDist, 0.25);

  // pitch: povprečna razdalja med sosednjimi vrhovi
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  const pitchPx = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const mean = pitchPx || 1;
  const pitchCv = gaps.length > 0
    ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) / mean
    : 1;

  // debelina palice: FWHM okoli vsakega vrha (50 % med vrhom in sosedo)
  const widths: number[] = [];
  for (const p of peaks) {
    const half = norm[p] * 0.5;
    let lo = p;
    while (lo > 0 && norm[lo] > half) lo--;
    let hi = p;
    while (hi < n - 1 && norm[hi] > half) hi++;
    const w = hi - lo;
    if (w > 0 && w < pitchPx * 0.8) widths.push(w);
  }
  const barWidthPx = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;

  // kakovost: amplituda kontrasta + konsistenca razmakov
  const consistent = peaks.length >= 2 && pitchCv <= 0.45;
  const strong = amplitude >= 0.05;
  const confidence: StripProfile['confidence'] =
    strong && consistent && peaks.length >= 3
      ? 'visoka'
      : (strong || consistent) && peaks.length >= 2
        ? 'srednja'
        : 'nizka';

  return {
    count: peaks.length,
    pitchPx,
    barWidthPx,
    lengthPx: len,
    amplitude,
    pitchCv,
    polarity,
    peaks,
    profile: norm,
    confidence,
  };
}

// ─── Kalibracija v cm ───────────────────────────────────────

/**
 * Pretvori profil traku v realne mere. `realCm` = znana dolžina traku
 * (med točkama, ki ju je uporabnik označil) ali dolžina, izračunana iz
 * referenčnega objekta analize.
 */
export function calibrateStrip(prof: StripProfile, realCm: number): BarDims {
  const safeCm = Math.max(1, realCm);
  const cmPerPx = safeCm / Math.max(1, prof.lengthPx);
  const pitchCm = prof.pitchPx * cmPerPx;
  const barWidthCm = prof.barWidthPx * cmPerPx;
  const n = Math.max(2, prof.profile.length);
  return {
    count: prof.count,
    pitchCm,
    barWidthCm,
    gapCm: Math.max(0, pitchCm - barWidthCm),
    barsPerMeter: pitchCm > 0.5 ? 100 / pitchCm : 0,
    cmPerPx,
    confidence: prof.confidence,
    positions: prof.peaks.map((p) => p / (n - 1)),
  };
}

/** Predlog za Vizualizer: razmak (reža) + debelina palice, omejena na razpone drsnikov. */
export function suggestVizParams(dims: BarDims): VizBarSuggest {
  const spacingCm = clamp(Math.round(dims.gapCm * 2) / 2, 5, 20);
  const elementCm = clamp(Math.round(dims.barWidthCm * 10) / 10, 1, 6);
  return { spacingCm, elementCm, count: dims.count, confidence: dims.confidence };
}
