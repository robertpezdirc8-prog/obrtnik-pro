// A/B #2: SEGMENTACIJSKI model (SlimSAM 77 uniform, ONNX) proti hevristiki
// robov — isti štirikotnik in ista metrika (pokritost štirikotnika) kot pri
// `tools/depth-ab.ts`.
//
// ZANESLJIVOST: `bun add @huggingface/transformers` v POLOŽNO mapo (npr.
// /tmp/hf) in model se prenese sam (Hugging Face, brez ključa). Ta skript NI
// del aplikacije in NI odvisnost repozitorija — `tools/` je izločen iz
// tsconfig.
//
// IZID (19. 10. 2026, CPU, 4 vCPU): inferenca 20–22 s, ~2 GB RAM, pokritost
// štirikotnika 0,6 % (prompt: 4 oglišča) oz. 3,0 % (prompt: ena točka) —
// hevristika aplikacije na istem primeru daje 71 % v ~1 ms.
// SKLEP: segmentacijski model tu NI boljši in je pri taki latenci neuporaben
// za interaktivno delo; v aplikaciji ostane deterministična hevristika.
// A/B #2: segmentacijski model (SlimSAM 77, ONNX) proti hevristiki robov.
// Meritev: pokritost štirikotnika (enaka metrika kot v aplikaciji) + čas.
import { SamModel, SamProcessor, RawImage } from '@huggingface/transformers';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/');
const sharp = require('sharp');

const FILE = '/workspace/tests/fixtures/hisa-balkon-parkgate.jpg';
// Isti štirikotnik kot v E2E (desni odsek balkonske ograje), v % slike.
const QUAD = [[57.5, 50.5], [87, 45.5], [87, 52.5], [57.5, 57]];
const POINTS = [[72, 49], ...QUAD.map(([x, y]) => [x, y])]; // točka + 4 oglišča štirikotnika

const t0 = performance.now();
const model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', { dtype: 'fp32' });
const processor = await SamProcessor.from_pretrained('Xenova/slimsam-77-uniform');
console.log(`model naložen: ${Math.round(performance.now() - t0)} ms`);

const image = await RawImage.fromURL(FILE);
const inputs = await processor(image, { input_points: [POINTS], input_labels: [POINTS.map(() => 1)] });
const t1 = performance.now();
const outputs = await model(inputs);
const ms = performance.now() - t1;
const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
console.log(`inferenca: ${ms.toFixed(0)} ms · maske: ${masks.length}`);

// izberi masko z največjim pokritjem štirikotnika
const W = inputs.original_sizes[0][1], H = inputs.original_sizes[0][0];
const inQuad = (x: number, y: number): boolean => {
  const q = QUAD;
  const [tl, tr, br, bl] = q.map(([px, py]) => [px * W / 100, py * H / 100] as [number, number]);
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const s1 = cross(tl[0], tl[1], tr[0], tr[1], x, y);
  const s2 = cross(tr[0], tr[1], br[0], br[1], x, y);
  const s3 = cross(br[0], br[1], bl[0], bl[1], x, y);
  const s4 = cross(bl[0], bl[1], tl[0], tl[1], x, y);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0 && s4 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0 && s4 <= 0);
};
let quadPx = 0;
for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (inQuad(x, y)) quadPx++;
let best = 0;
for (let mi = 0; mi < masks.length; mi++) {
  const m = masks[mi];
  const d = m.data as Uint8Array;
  let hit = 0, total = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (!inQuad(x, y)) continue;
    total++;
    if (d[y * W + x] > 0) hit++;
  }
  const pok = total ? (hit / total) * 100 : 0;
  console.log(`  maska ${mi}: pokritost štirikotnika ${pok.toFixed(1)} %`);
  if (pok > best) best = pok;
}
console.log(`najboljša pokritost: ${best.toFixed(1)} % (heuristika aplikacije: 71 %)`);
console.log(`rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
