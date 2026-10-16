// ─── Magnet za točke: Sobel robovi + pripenjanje klikov ─────
// Kamera "vidi robove kot človek": iz fotografije/kadra zgradimo
// Sobel karto robov (downscale za hitrost), klik blizu roba
// (okvir okna, fuga ploščice, rob stene…) se pripne na rob.
// Tako so merjene daljice natančne tudi pri hitrem tapkanju.

import type { XY } from './measure-geometry';

export interface EdgeMap {
  /** ločljivost karte robov (ohranja razmerje stranic originala) */
  w: number;
  h: number;
  /** normalizirana magnituda gradienta 0–1 */
  mag: Float32Array;
  maxMag: number;
}

/** Zgradi Sobel karto robov iz dataURL slike (downscale na maxDim px). */
export async function buildEdgeMap(dataUrl: string, maxDim = 640): Promise<EdgeMap | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(4, Math.round(bmp.width * scale));
    const h = Math.max(4, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    const mag = new Float32Array(w * h);
    let maxMag = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx =
          -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
          gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy =
          -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
          gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        const m = Math.sqrt(gx * gx + gy * gy);
        mag[i] = m;
        if (m > maxMag) maxMag = m;
      }
    }
    if (maxMag > 0) {
      for (let i = 0; i < mag.length; i++) mag[i] /= maxMag;
    }
    return { w, h, mag, maxMag };
  } catch {
    return null;
  }
}

/**
 * Pripni točko (% slike) na najmočnejši rob v radiju (v % večje
 * stranice slike). Upošteva raje bližje točke pri enaki magnitudi.
 */
export function snapPoint(
  pt: XY,
  edge: EdgeMap | null,
  radiusPct = 2.2,
): { point: XY; snapped: boolean } {
  if (!edge || edge.maxMag <= 0) return { point: pt, snapped: false };
  const r = Math.max(3, Math.round((radiusPct / 100) * Math.max(edge.w, edge.h)));
  const cx = Math.round((pt.x / 100) * edge.w);
  const cy = Math.round((pt.y / 100) * edge.h);
  const threshold = 0.18; // samo izraziti robovi
  let best = -1;
  let bx = cx;
  let by = cy;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= edge.h - 1) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= edge.w - 1) continue;
      const m = edge.mag[y * edge.w + x];
      if (m <= threshold) continue;
      const score = m - 0.12 * (Math.sqrt(dx * dx + dy * dy) / r);
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  if (best < 0) return { point: pt, snapped: false };
  return {
    point: { x: (bx / edge.w) * 100, y: (by / edge.h) * 100 },
    snapped: true,
  };
}
