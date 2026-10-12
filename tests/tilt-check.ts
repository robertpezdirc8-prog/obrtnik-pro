// Verifikacija estimateTilt algoritma na sintetiki in realni fotki.
import sharp from 'sharp';

const BINS = 36;
function estimateTiltRaw(gray: Float32Array, w: number, h: number): { theta: number; top: [number, number][]; nEdges?: number } {
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
  if (mags.length < 60) return { theta: 0, top: [] };
  mags.sort((a, b) => a - b);
  const thr = mags[Math.floor(mags.length * 0.85)];
  const hist = new Float64Array(BINS);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mag[i] < thr) continue;
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] -
        2 * gray[i - 1] + 2 * gray[i + 1] -
        gray[i + w - 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + gray[i + w] + gray[i + w + 1];
      let deg = (Math.atan2(gy, gx) * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180;
      const bin = Math.min(BINS - 1, Math.floor(deg / 5));
      hist[bin] += mag[i];
    }
  }
  // Varianta D: projekcijski profil + orientacijski filter.
  // Gradientna orientacija (mod 180) mora biti blizu 0° (navpični rob)
  // ali 90° (vodoravni rob) — diagonale perspektive izločimo.
  const cx = w / 2;
  const cy = h / 2;
  const edges: [number, number, number][] = [];
  mags.sort((a, b) => b - a);
  const cap = Math.min(mags.length, 6000);
  const capThr = mags[cap - 1];
  const ORT_TOL = 25;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < capThr || m <= 0) continue;
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
      if (edges.length >= cap) break;
    }
    if (edges.length >= cap) break;
  }
  const binN = 240;
  const binOff = 120;
  let bestR = 0;
  let bestV = -1;
  const vs: { r: number; v: number }[] = [];
  for (let r = -12; r <= 12; r += 0.5) {
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
    const v = sq / binN - mean * mean;
    vs.push({ r, v });
    if (v > bestV) { bestV = v; bestR = r; }
  }
  // parabolično izboljšanje (±0,5°)
  const at = (rr: number) => vs.find((e) => Math.abs(e.r - rr) < 0.01)?.v ?? bestV;
  const vm = at(bestR - 0.5);
  const v0 = at(bestR);
  const vp = at(bestR + 0.5);
  const den = vm - 2 * v0 + vp;
  const delta = den !== 0 ? (0.5 * (vm - vp)) / den : 0;
  const rStar = bestR + delta * 0.5;
  let theta = -rStar;
  theta = Math.max(-45, Math.min(45, theta));
  const top = vs.sort((a, b) => b.v - a.v).slice(0, 3).map((e) => [e.r, Math.round(e.v / 1000)] as [number, number]);
  return { theta: Math.abs(theta) < 1 ? 0 : Math.round(theta * 10) / 10, top, nEdges: edges.length };
}

async function grayOf(input: Buffer | string): Promise<{ g: Float32Array; w: number; h: number }> {
  const maxSide = 160;
  const meta = await sharp(input).metadata();
  const scale = maxSide / Math.max(meta.width!, meta.height!);
  const w = Math.max(24, Math.round(meta.width! * scale));
  const h = Math.max(24, Math.round(meta.height! * scale));
  const raw = await sharp(input).resize(w, h).greyscale().raw().toBuffer();
  return { g: new Float32Array(raw), w, h };
}

async function main() {
  // 1) Sintetika: vertikalne črne palice na belem
  const barImg = Buffer.from(
    `<svg width="400" height="400"><rect x="0" y="0" width="400" height="400" fill="white"/>${[...Array(10)].map((_, i) => `<rect x="${i * 40 + 8}" y="0" width="8" height="400" fill="black"/>`).join('')}<rect x="0" y="0" width="400" height="8" fill="black"/></svg>`,
  );
  for (const angle of [0, 8, -8, 15]) {
    const rot = angle === 0 ? barImg : await sharp(barImg).rotate(angle, { background: '#ffffff' }).png().toBuffer();
    const { g, w, h } = await grayOf(rot);
    const r = estimateTiltRaw(g, w, h);
    console.log(`sintetika ${angle}° → ocena ${r.theta}°  (vrhovi: ${r.top.map(([d, v]) => `${d}°:${Math.round(v)}`).join(' ')})`);
  }

  // 2) Realna fotka: osnovna + 8° rotirana
  for (const [name, file] of [['ograje osnovna', 'public/crafts/ograje.jpg'], ['ograje rot8', 'tests/tilt8.jpg']] as const) {
    const { g, w, h } = await grayOf(file);
    const r = estimateTiltRaw(g, w, h);
    console.log(`${name} → ocena ${r.theta}°  (vrhovi: ${r.top.map(([d, v]) => `${d}°:${Math.round(v)}`).join(' ')})`);
  }
}

void main();
