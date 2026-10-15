// ─── Obdelava fotografij na strani odjemalca ────────────────
// Stiskanje/prevučitev (canvas) + kontrola kakovosti (ostrina
// prek Laplaceove variance, izpostavljenost prek klipanja
// histograma, odsevi prek povezanih komponent, ločljivost).

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface QualityCheck {
  blurScore: number;     // Laplaceova varianca — višja = ostrejše
  brightness: number;    // 0-255 (povprečje sivin)
  darkPct: number;       // % pikslov < 12 (podizpostavljeno klipanje)
  brightPct: number;     // % pikslov > 243 (prenapostavljeno klipanje)
  glarePct: number;      // največji zvezek ≥ 250 (% površine slike)
  exposureOk: boolean;
  glareOk: boolean;
  ok: boolean;
  score: number;         // 0–100 skupna ocena kakovosti
  verdict: string;       // odlično / dobro / sprejemljivo / slabo
  warnings: string[];
  tips: string[];
  resolution: { w: number; h: number; long: number } | null;
}

const MAX_DIM = 1280;
const JPEG_QUALITY = 0.82;

/** Naloži datoteko v ImageBitmap (upošteva EXIF orientacijo). */
async function loadBitmap(file: File | Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** Zmanjša in stisne fotografijo na dataURL (max 1280 px, JPEG 0,82). */
export async function processImage(file: File | Blob): Promise<ProcessedImage> {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width: w, height: h };
}

/** Stisne že pripravljen HTMLImageElement (npr. iz video posnetka). */
export function compressElement(
  el: HTMLVideoElement | HTMLImageElement,
  srcW: number,
  srcH: number,
): ProcessedImage {
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(el, 0, 0, w, h);

  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width: w, height: h };
}

// ─── Čisto jedro kakovosti (brez DOM-a — testabilno v bun) ───
// Metode po raziskavi (research/task21/findings.md):
//  • ostrina = varianca Laplaceovega odziva (VoL, Pech-Pacheco 2000)
//    na FIKSNI velikosti (240 px) — absolutne vrednosti niso prenosne
//    med ločljivostmi (Apple sample, pyimagesearch 100, blurMeter 10–150);
//  • izpostavljenost = delež klipanih pikslov (< 12 oz. > 243 — 243
//    ujame JPEG skoraj-klipanje, Wikipedija Clipping, Lightroom znak);
//  • odsevi = povezana komponenta (4-sosedska) pikslov ≥ 250; velik
//    zvezek (≥ 0,5 % površine) = odsev (endoskopija PMC11042492).
//  Ključna prednost pred konkurenco: Metashape "Estimate Image
//  Quality" enako deterministično odreže fotke < 0,5/1,0 (USGS).

export interface QualityMetrics {
  blurScore: number;   // VoL (višja = ostrejše)
  brightness: number;  // povprečje sivin 0–255
  darkPct: number;     // % pikslov < 12
  brightPct: number;   // % pikslov > 243
  glarePct: number;    // največji zvezek ≥ 250 (% površine)
}

export const QUALITY_THRESHOLDS = {
  blurBad: 35,        // < 35 = zamegljeno (kalibrirano na 240 px prek polnega cevovoda)
  blurWarn: 90,       // 35–90 = mejna ostrina
  blurSharp: 140,     // ≥ 140 = polni točki ostrine
  darkPctMax: 4,      // > 4 % pikslov < 12 = podizpostavljeno (osenčen pas do 4 % je normalno)
  brightPctMax: 6,    // > 6 % pikslov > 243 = prenapostavljeno (nebo < 6 % je normalno)
  meanDark: 50,       // povprečje < 50 = pretemno
  meanBright: 225,    // povprečje > 225 = presvetlo
  glarePctMax: 1,     // sredinski zvezek ≥ 1 % površine = odsev
  glareSat: 250,      // prag nasičenosti za odseve
  glareNoisePx: 8,    // zvezki < 8 pikslov ignoriramo (otriski)
  resMin: 800,        // dolga stran < 800 px = nizka ločljivost
} as const;

/** Izračuna vse deterministične meritve kakovosti nad sivinsko sliko. */
export function qualityMetrics(gray: Float32Array, w: number, h: number): QualityMetrics {
  const total = w * h;

  // 1) Varianca Laplaceovega odziva (enovit prehod — brez vmesne tabele)
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += v;
      lapSq += v * v;
      n++;
    }
  }
  const lapMean = n > 0 ? lapSum / n : 0;
  const blurScore = n > 0 ? lapSq / n - lapMean * lapMean : 0;

  // 2) Histogram: povprečje + klipanje + maska nasičenosti (odsevi)
  let graySum = 0;
  let dark = 0;
  let bright = 0;
  const sat = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const v = gray[i];
    graySum += v;
    if (v < 12) dark++;
    if (v > 243) bright++;
    if (v >= QUALITY_THRESHOLDS.glareSat) sat[i] = 1;
  }

  // 3) Odsevi: največja povezana komponenta (iterativni DFS, 4 sosede)
  //    Zvezki, ki segajo do roba slike, NE štejejo kot odsev — svetlo
  //    nebo pride od roba (normalno na prostorskih fotkah); pravi odsev
  //    od bleska/sonca leži SREDINSKO na objektu (steklo, plošče).
  const seen = new Uint8Array(total);
  const stack: number[] = [];
  let bestBlob = 0;
  for (let i = 0; i < total; i++) {
    if (!sat[i] || seen[i]) continue;
    let size = 0;
    let minx = w, maxx = 0, miny = h, maxy = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % w;
      const py = (p - px) / w;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
      if (px > 0 && sat[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && sat[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (p - w >= 0 && sat[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (p + w < total && sat[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    const touchesBorder = minx === 0 || miny === 0 || maxx === w - 1 || maxy === h - 1;
    if (!touchesBorder && size > bestBlob) bestBlob = size;
  }
  const glarePct = bestBlob >= QUALITY_THRESHOLDS.glareNoisePx ? (100 * bestBlob) / total : 0;

  return {
    blurScore,
    brightness: graySum / total,
    darkPct: (100 * dark) / total,
    brightPct: (100 * bright) / total,
    glarePct,
  };
}

/** Skupna ocena 0–100: ostrina 50 t. + izpostavljenost 30 t. + odsevi 20 t. */
export function qualityScore(m: QualityMetrics): number {
  const t = QUALITY_THRESHOLDS;
  // ostrina: linearno med pragovoma slabo → ostro
  const b = Math.max(0, Math.min(1, (m.blurScore - t.blurBad) / (t.blurSharp - t.blurBad)));
  let s = 50 * b;
  // izpostavljenost: klipanje > 15 % pomeni 0 točk
  const clip = Math.max(m.darkPct, m.brightPct);
  s += 30 * Math.max(0, 1 - clip / 15);
  if (m.brightness < 40 || m.brightness > 228) s = Math.min(s, 18);
  // odsevi: sredinski zvezek ≥ 3 % površine = 0 točk
  s += 20 * Math.max(0, 1 - m.glarePct / 3);
  // zamegljena/ploska slika je brez vrednosti za meritve — trd strop
  if (m.blurScore < t.blurBad) s = Math.min(s, 35);
  return Math.round(Math.max(0, Math.min(100, s)));
}

/** Človeku berljiva sodba o kakovosti. */
export function qualityVerdict(score: number): string {
  if (score >= 80) return 'odlično';
  if (score >= 60) return 'dobro';
  if (score >= 40) return 'sprejemljivo';
  return 'slabo';
}

/**
 * Kontrola kakovosti: ostrina (VoL na 240 px), izpostavljenost
 * (klipanje), odsevi (povezani zvezki) in ločljivost. Samo
 * opozarja — ne blokira analize.
 */
export function checkQuality(
  dataUrl: string,
  srcW?: number,
  srcH?: number,
): Promise<QualityCheck> {
  return new Promise((resolve) => {
    const size = 240;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const gray = new Float32Array(size * size);
      for (let i = 0; i < size * size; i++) {
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }

      const m = qualityMetrics(gray, size, size);
      const t = QUALITY_THRESHOLDS;
      const score = qualityScore(m);

      const resolution =
        typeof srcW === 'number' && typeof srcH === 'number' && srcW > 0 && srcH > 0
          ? { w: srcW, h: srcH, long: Math.max(srcW, srcH) }
          : null;

      const warnings: string[] = [];
      const tips: string[] = [];

      if (m.blurScore < t.blurBad) {
        warnings.push('Fotografija je zamegljena — analiza mer iz nje je nezanesljiva.');
        tips.push('Drži telefon mirno (nasloni se na steno), tapni na objekt za fokus in posnamej znova.');
      } else if (m.blurScore < t.blurWarn) {
        warnings.push('Ostrina je mejna — meritve so lahko manj natančne.');
        tips.push('Posnamej bližje objektu in počakaj, da se avtofokus ustali.');
      }
      if (m.brightness < t.meanDark || m.darkPct > t.darkPctMax) {
        warnings.push('Pretemna scena — podrobnosti so izgubljene v senci.');
        tips.push('Pojdi podnevi ali prižgi delovno luč; ne fotografiraj proti soncu.');
      }
      if (m.brightness > t.meanBright || m.brightPct > t.brightPctMax) {
        warnings.push('Prenapostavljena scena — svetla področja so brez detajlov.');
        tips.push('Umakni se iz direktne sončne svetlobe ali spremeni kot snemanja (nebo v kadru je v redu).');
      }
      if (m.glarePct >= t.glarePctMax) {
        warnings.push(`Velik odsev na sliki (zamegli ≈ ${m.glarePct.toFixed(1).replace('.', ',')} % kadra).`);
        tips.push('Pomakni se stransko, da se sonce/bliskava ne odbija v steklo ali gladko površino.');
      }
      if (resolution && resolution.long < t.resMin) {
        warnings.push(`Nizka ločljivost (${resolution.w}×${resolution.h} px).`);
        tips.push('Fotografiraj s kraješega zavesenja ali izberi izvorno sliko večje ločljivosti.');
      }

      resolve({
        blurScore: Math.round(m.blurScore),
        brightness: Math.round(m.brightness),
        darkPct: m.darkPct,
        brightPct: m.brightPct,
        glarePct: m.glarePct,
        exposureOk: m.brightness >= t.meanDark && m.brightness <= t.meanBright &&
          m.darkPct <= t.darkPctMax && m.brightPct <= t.brightPctMax,
        glareOk: m.glarePct < t.glarePctMax,
        ok: warnings.length === 0,
        score,
        verdict: qualityVerdict(score),
        warnings,
        tips,
        resolution,
      });
    };
    img.onerror = () => resolve({
      blurScore: 0, brightness: 0, darkPct: 0, brightPct: 0, glarePct: 0,
      exposureOk: false, glareOk: false, ok: false, score: 0, verdict: 'slabo',
      warnings: ['Slike ni bilo mogoče preveriti.'], tips: [],
      resolution: null,
    });
    img.src = dataUrl;
  });
}

// ─── Naklon fotografije (deskew, deterministično) ────────────
// Metoda projekcijskega profila (klasična deskew tehnika):
//  1. Sobel robovi → ostanejo samo orientacijsko "osni" robovi
//     (gradient blizu 0°/90°, toleranca 12°) — diagonale perspektive
//     izločimo.
//  2. Za kandidate zasuka r ∈ [−10°, +10°] vržemo robove v vrstice
//     zasukanih koordinat (y' = (x−cx)·sin r + (y−cy)·cos r) in
//     izračunamo varianco vsot vrstic — največja = poravnani horizont.
//  3. Parabolično izboljšanje vrha (sub-stopinjsko) + GATING:
//     opozorimo samo, če je vrh izrazit (varianca vrha / mediana ≥ 1,8)
//     in ni na robu razpona — prepreči lažne opozorile na scenskih
//     diagonalah (perspektiva balkonov, poganjanje streh).

/**
 * Oceni zasuk fotografije v stopinjah (−45 … +45; 0 = poravnano).
 * Pozitivno = vsebina je zasukana v smeri urinega kazalca.
 * Vrne 0, kadar ni izrazitega vrha (nejasna scena) ali je naklon < 1°.
 */
export function estimateTilt(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 160;
        const scale = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
        const w = Math.max(24, Math.round(img.naturalWidth * scale));
        const h = Math.max(24, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        const gray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        }

        // Sobel magnitude
        const mag = new Float32Array(w * h);
        const mags: number[] = [];
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx =
              -gray[i - w - 1] + gray[i - w + 1] -
              2 * gray[i - 1] + 2 * gray[i + 1] -
              gray[i + w - 1] + gray[i + w + 1];
            const gy =
              -gray[i - w - 1] - gray[i - w] - gray[i - w + 1] +
              gray[i + w - 1] + gray[i + w] + gray[i + w + 1];
            const m = Math.hypot(gx, gy);
            mag[i] = m;
            if (m > 12) mags.push(m);
          }
        }
        if (mags.length < 60) { resolve(0); return; }

        // Prag: 85. percentil močnih robov
        mags.sort((a, b) => a - b);
        const thr = mags[Math.floor(mags.length * 0.85)];

        // Osnovni robovi (orientacijski filter ±12° okoli 0°/90°)
        const ORT_TOL = 12;
        const cx = w / 2;
        const cy = h / 2;
        const edges: [number, number, number][] = [];
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const m = mag[i];
            if (m < thr) continue;
            const gx =
              -gray[i - w - 1] + gray[i - w + 1] -
              2 * gray[i - 1] + 2 * gray[i + 1] -
              gray[i + w - 1] + gray[i + w + 1];
            const gy =
              -gray[i - w - 1] - gray[i - w] - gray[i - w + 1] +
              gray[i + w - 1] + gray[i + w] + gray[i + w + 1];
            let deg = (Math.atan2(gy, gx) * 180) / Math.PI;
            deg = ((deg % 180) + 180) % 180;
            const dH = Math.abs(deg - 90);
            const dV = Math.min(deg, 180 - deg);
            if (Math.min(dH, dV) <= ORT_TOL) edges.push([x, y, m]);
          }
        }
        if (edges.length < 80) { resolve(0); return; }

        // Projekcijski profil po kandidatnih zasukih
        const RANGE = 10;
        const STEP = 0.5;
        const binN = 240;
        const binOff = 120;
        const vs: { r: number; v: number }[] = [];
        for (let r = -RANGE; r <= RANGE; r += STEP) {
          const rad = (r * Math.PI) / 180;
          const s = Math.sin(rad);
          const c = Math.cos(rad);
          const rows = new Float64Array(binN);
          for (const [x, y, m] of edges) {
            const yb = Math.round((x - cx) * s + (y - cy) * c) + binOff;
            if (yb >= 0 && yb < binN) rows[yb] += m;
          }
          let sum = 0;
          let sq = 0;
          for (let i = 0; i < binN; i++) { sum += rows[i]; sq += rows[i] * rows[i]; }
          const mean = sum / binN;
          vs.push({ r, v: sq / binN - mean * mean });
        }

        let best = vs[0];
        for (const e of vs) if (e.v > best.v) best = e;
        const sortedV = vs.map((e) => e.v).sort((a, b) => a - b);
        const med = sortedV[Math.floor(sortedV.length / 2)];
        const ratio = med > 0 ? best.v / med : 0;

        // GATING: vrh mora biti izrazit in znotraj razpona
        const atEdge = Math.abs(best.r) >= RANGE - STEP / 2;
        if (ratio < 1.7 || atEdge) { resolve(0); return; }

        // Parabolično izboljšanje (±STEP)
        const at = (rr: number) => vs.find((e) => Math.abs(e.r - rr) < 0.01)?.v ?? best.v;
        const vm = at(best.r - STEP);
        const vp = at(best.r + STEP);
        const den = vm - 2 * best.v + vp;
        const delta = den !== 0 ? (0.5 * (vm - vp)) / den : 0;
        let theta = -(best.r + delta * STEP);
        theta = Math.max(-45, Math.min(45, theta));

        resolve(Math.abs(theta) < 1 ? 0 : Math.round(theta * 10) / 10);
      } catch {
        resolve(0);
      }
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

function loadImageEl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Slike ni bilo mogoče naložiti.'));
    img.src = dataUrl;
  });
}

/**
 * Izravna fotografijo za `rollDeg` stopinj (rotacija −naklon) in
 * obreže na največji notranji pravokotnik (bisekcija + test
 * točka-v-zasukanem-pravokotniku). Vrne stisnjeno sliko (max 1280 px).
 */
export async function autoLevel(dataUrl: string, rollDeg: number): Promise<ProcessedImage> {
  const img = await loadImageEl(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const angle = (-rollDeg * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const W2 = Math.ceil(Math.abs(W * cosA) + Math.abs(H * sinA));
  const H2 = Math.ceil(Math.abs(W * sinA) + Math.abs(H * cosA));
  const rot = document.createElement('canvas');
  rot.width = W2;
  rot.height = H2;
  const rctx = rot.getContext('2d')!;
  rctx.translate(W2 / 2, H2 / 2);
  rctx.rotate(angle);
  rctx.drawImage(img, -W / 2, -H / 2, W, H);

  // Največji poravnan pravokotnik (isto razmerje stranic) znotraj zasukane fotke
  const aspect = H / W;
  const inside = (w: number, h: number): boolean => {
    const pts: [number, number][] = [
      [w / 2, h / 2], [-w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2],
    ];
    for (const [px, py] of pts) {
      const qx = px * cosA + py * sinA;
      const qy = -px * sinA + py * cosA;
      if (Math.abs(qx) > W / 2 - 0.5 || Math.abs(qy) > H / 2 - 0.5) return false;
    }
    return true;
  };
  let lo = 0.3;
  let hi = 1;
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2;
    const w = mid * W;
    if (inside(w, w * aspect)) lo = mid;
    else hi = mid;
  }
  const cw = Math.max(16, Math.floor(lo * W));
  const ch = Math.max(16, Math.floor(cw * aspect));

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(rot, (W2 - cw) / 2, (H2 - ch) / 2, cw, ch, 0, 0, cw, ch);

  // Stiskanje na standard (enako kot processImage)
  const scale = Math.min(1, MAX_DIM / Math.max(cw, ch));
  const fw = Math.max(1, Math.round(cw * scale));
  const fh = Math.max(1, Math.round(ch * scale));
  const final = document.createElement('canvas');
  final.width = fw;
  final.height = fh;
  final.getContext('2d')!.drawImage(out, 0, 0, fw, fh);
  return { dataUrl: final.toDataURL('image/jpeg', JPEG_QUALITY), width: fw, height: fh };
}

/**
 * Male sličice za sezname (dnevnik): slika z dolgo stranjo ≤ `max`
 * (privzeto 320 px, JPEG 0,7). Uporabno, kadar seznam pokaže veliko
 * fotografij in polnih 1280 px ni treba prenašati.
 */
export async function makeThumbnail(dataUrl: string, max = 320): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7);
}
