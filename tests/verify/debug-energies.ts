// Debug: smerne energije + periodičnost za sintetične primere
import type { RgbaImage, PctPoint } from '../../src/lib/bar-count';

function makeImage(w: number, h: number, base: number, draw: (x: number, y: number) => number | null): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = draw(x, y) ?? base;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const quad: [number, number][] = [[10, 10], [90, 10], [90, 90], [10, 90]];

// ponovi notranjo analizo: maska + Sobel
function energies(img: RgbaImage, quad: [number, number][]) {
  const poly = quad.map(([px, py]) => ({ x: (px / 100) * (img.width - 1), y: (py / 100) * (img.height - 1) }));
  const w = img.width, h = img.height;
  const gray = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      gray[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      // even-odd
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const yi = poly[a].y, yj = poly[b].y;
        if (yi > y !== yj > y && x < ((poly[b].x - poly[a].x) * (y - yi)) / (yj - yi + 1e-12) + poly[a].x) inside = !inside;
      }
      if (inside) mask[y * w + x] = 1;
    }
  }
  let vert = 0, horiz = 0, d45 = 0, d135 = 0, n = 0;
  const c = Math.SQRT1_2;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      const at = (xx: number, yy: number) => gray[yy * w + xx];
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      vert += Math.abs(gx); horiz += Math.abs(gy);
      d45 += Math.abs(gx * c + gy * c); d135 += Math.abs(gx * c - gy * c);
      n++;
    }
  }
  console.log(`  vert=${(vert / n).toFixed(1)} horiz=${(horiz / n).toFixed(1)} d45=${(d45 / n).toFixed(1)} d135=${(d135 / n).toFixed(1)}`);
}

console.log('MREŽA (x%16<5 || y%16<5):');
energies(makeImage(200, 200, 210, (x, y) => (x % 16 < 5 || y % 16 < 5 ? 50 : null)), quad);

console.log('DIAGONALA 45° ((x+y)/18):');
energies(makeImage(240, 240, 225, (x, y) => (Math.floor((x + y) / 18) % 2 === 0 ? 45 : null)), quad);

console.log('VERTIKALNE (x%20<8):');
energies(makeImage(200, 200, 220, (x) => (x % 20 < 8 ? 40 : null)), quad);
