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
