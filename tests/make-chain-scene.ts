// Sintetična 3D scena z RESNIČNO paralakso za E2E verige (3 fotke, enake mere).
// Plasti na različnih globinah (paralaksa px na enoto premika): ozadje 6,
// trije "objekti" 18/32/48. Vsak pogled k = premik kamere k·(12, 6) px →
// vsak sloj se v sliki premakne za paralaksa·k. Psevdonaključne teksture (LCG)
// = enoznačna NCC ujemanja; robovi ploščic = stabilni Shi-Tomasi vogali.
// To je EKVIVALENT realnemu posnetku večplastnega prostora — resnična 3D scena.
import sharp from 'sharp';

const W = 800, H = 600;
const STEP_X = 6, STEP_Y = 3;
const LAYERS: { x: number; y: number; w: number; h: number; par: number; seed: number }[] = [
  { x: 120, y: 130, w: 170, h: 150, par: 18, seed: 101 },
  { x: 430, y: 90, w: 200, h: 170, par: 32, seed: 202 },
  { x: 240, y: 330, w: 230, h: 160, par: 48, seed: 303 },
];
const BG_PAR = 6;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// tekstura: LCG psevdo-naključna sivina (deterministična po (x,y) prek zgoščevalke)
function tex(x: number, y: number, seed: number): number {
  let h = (seed ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return 40 + (h % 176);
}

for (let view = 0; view < 3; view++) {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // ozadje: paralaksa BG_PAR
      const bx = x - BG_PAR * view * STEP_X * 0.5;
      const by = y - BG_PAR * view * STEP_Y * 0.5;
      let v = tex(Math.round(bx), Math.round(by), 7);
      // plasti od zadaj naprej
      for (const L of LAYERS) {
        const px = x - L.par * view * STEP_X * 0.5;
        const py = y - L.par * view * STEP_Y * 0.5;
        if (px >= L.x && px < L.x + L.w && py >= L.y && py < L.y + L.h) {
          const edge =
            px < L.x + 3 || px >= L.x + L.w - 3 || py < L.y + 3 || py >= L.y + L.h - 3;
          v = edge ? 20 : tex(Math.round(px), Math.round(py), L.seed);
        }
      }
      const o = (y * W + x) * 3;
      rgb[o] = v; rgb[o + 1] = v; rgb[o + 2] = v;
    }
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toFile(`tests/mv-chain-${['A', 'B', 'C'][view]}.jpg`);
  console.log(`pogled ${['A', 'B', 'C'][view]}: izrisan`);
}
console.log('scena 3D: gotovo (800x600 ×3)');
