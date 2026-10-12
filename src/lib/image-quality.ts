// ─── Obdelava fotografij na strani odjemalca ────────────────
// Stiskanje/prevučitev (canvas) + kontrola kakovosti (ostrina
// prek Laplaceove variance, svetlost, ločljivost).

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface QualityCheck {
  blurScore: number;     // Laplaceova varianca — višja = ostrejše
  brightness: number;    // 0-255
  ok: boolean;
  warnings: string[];
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

/**
 * Kontrola kakovosti: ostrina (Laplaceova varianca na sivinski
 * sliki 240 px) in svetlost. Samo opozarja — ne blokira.
 */
export function checkQuality(dataUrl: string): Promise<QualityCheck> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 240;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Sivinska matrika
      const gray = new Float32Array(size * size);
      let sum = 0;
      for (let i = 0; i < size * size; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const v = 0.299 * r + 0.587 * g + 0.114 * b;
        gray[i] = v;
        sum += v;
      }
      const brightness = sum / (size * size);

      // Laplaceov operator (3×3) — varianca odziva = merilo ostrine
      const lap: number[] = [];
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const i = y * size + x;
          const v =
            4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
          lap.push(v);
        }
      }
      const mean = lap.reduce((s, v) => s + v, 0) / lap.length;
      const variance = lap.reduce((s, v) => s + (v - mean) ** 2, 0) / lap.length;
      const blurScore = Math.round(variance);

      const warnings: string[] = [];
      if (blurScore < 25) warnings.push('Fotografija je zelo zamegljena — poskusi posnameti mirneje.');
      if (brightness < 45) warnings.push('Pretemna scena — poišči več svetlobe ali uporabi bliskavico.');
      if (brightness > 225) warnings.push('Preveč svetlobe (prenapostavljeno) — umakni se iz direktne sončne svetlobe.');

      resolve({ blurScore, brightness: Math.round(brightness), ok: warnings.length === 0, warnings });
    };
    img.onerror = () => resolve({ blurScore: 0, brightness: 0, ok: false, warnings: ['Slike ni bilo mogoče preveriti.'] });
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
