// ─── A/B: hevristika aplikacije (robovi) PROTI globinski modelu (HF) ──────
// Vprašanje, ki ga je odprlo delo s fotomontažo: ali brezplačni odprti model
// globine (Depth Anything V2 Small, ONNX, CPU) predlika ravnino bolje kot
// obstoječa hevristika robov (`band-suggest.ts`), ki danes uporablja
// zasičenost + svetlost + vodoravni tek.
//
// METODA (odprta, merljiva): oba detektorja poganjamo na ISTI sliki in isti
// tapki. Za vsako poročamo zgornji in spodnji rob pasu v % višine slike.
// Za referenco je ročno označena (ground truth) vrednost v tabeli spodaj —
// meritev je torej »koliko je detektor blizu človekove oznake« (±1 % ročne
// napake). Vzorec je MAJHEN in pošteno povzeda, kaj dokazuje in česa ne.
//
// Zagon: bun tools/depth-ab.ts   (zahteva onnxruntime-node + model v /tmp/hf)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/workspace/');
const sharp = require('sharp');
const ort = await import('/tmp/hf/node_modules/onnxruntime-node/dist/index.js');
const { extractFeatures } = await import('/workspace/src/lib/cv-engine.ts');
const { suggestBand } = await import('/workspace/src/lib/band-suggest.ts');

const MODEL = '/tmp/hf/model_quantized.onnx';
const S = 518;

type Case = { file: string; tapPct: [number, number]; gt: [number, number]; opis: string };
const CASES: Case[] = [
  { file: '/workspace/tests/fixtures/hisa-balkon-parkgate.jpg', tapPct: [12, 88], gt: [86.5, 92.0], opis: 'bela horizontalna ograja levo spodaj' },
  { file: '/workspace/tests/fixtures/hisa-balkon-parkgate.jpg', tapPct: [62, 52], gt: [45.5, 57.0], opis: 'balkonska ograja (poševna)' },
];

async function depthMap(file: string): Promise<{ d: Float32Array; w: number; h: number }> {
  const img = await sharp(file).rotate().resize(S, S, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const n = S * S;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (img[i * 3 + c] / 255 - mean[c]) / std[c];
  const session = await ort.InferenceSession.create(MODEL, { intraOpNumThreads: 2, interOpNumThreads: 1 });
  const t0 = performance.now();
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const ms = performance.now() - t0;
  const o = out[session.outputNames[0]];
  const dims = o.dims as number[];
  const flat = o.data as Float32Array;
  let lo = Infinity, hi = -Infinity;
  for (const v of flat) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const h = dims[dims.length - 2], w = dims[dims.length - 1];
  const norm = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i++) norm[i] = (flat[i] - lo) / (hi - lo || 1);
  console.log(`    model: ${ms.toFixed(0)} ms, ${w}×${h}, rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
  return { d: norm, w, h };
}

/** Rob pasu iz globine: vrstica z največjo spremembo globine nad in pod tapko. */
function depthBand(d: { d: Float32Array; w: number; h: number }, tapPct: [number, number]): { top: number; bottom: number } | null {
  const { d: map, w, h } = d;
  const x = Math.round((tapPct[0] / 100) * w);
  const col = (i: number) => map[i * w + x];
  const grad = new Float32Array(h);
  for (let y = 1; y < h; y++) grad[y] = Math.abs(col(y) - col(y - 1));
  const ty = Math.round((tapPct[1] / 100) * h);
  const pick = (dir: -1 | 1): number => {
    let best = -1, bestV = 0;
    for (let y = ty + dir; y >= 0 && y < h; y += dir) {
      if (grad[y] > bestV) { bestV = grad[y]; best = y; }
      if (Math.abs(y - ty) > h * 0.25) break;
    }
    return best < 0 ? NaN : (best / h) * 100;
  };
  const top = pick(-1), bottom = pick(1);
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

for (const c of CASES) {
  console.log(`\n${c.opis} — ${c.file.split('/').pop()}`);
  const meta = await sharp(c.file).metadata();
  const W = meta.width!, H = meta.height!;
  const rgba4 = await sharp(c.file).ensureAlpha().raw().toBuffer();


  // 1) hevristika aplikacije
  // extractFeatures SAM zmanjša sliko (maxSide) in vrne lastne W/H — tapke
  // morajo biti v istem (manjšem) koordinatnem sistemu.
  const f = extractFeatures({ width: W, height: H, data: new Uint8ClampedArray(rgba4) }, 256);
  const tap = { x: (c.tapPct[0] / 100) * f.W, y: (c.tapPct[1] / 100) * f.H };
  const t0 = performance.now();
  let band = suggestBand({ edge: f.edge, W: f.W, H: f.H }, tap);
  const msApp = performance.now() - t0;
  // Če tapka ne da pasu, preiščemo pas okoli njej — iskana je NAJBOLJŠA
  // razlika napake, ne prva naključna (hevristika je 'ne vem' = null).
  let bestBand = band, bestErr = Number.POSITIVE_INFINITY;
  if (!band) {
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const b2 = suggestBand({ edge: f.edge, W: f.W, H: f.H }, { x: tap.x + dx, y: tap.y + dy });
        if (!b2) continue;
        const e = Math.abs((b2.top.y / f.H) * 100 - c.gt[0]) + Math.abs((b2.bottom.y / f.H) * 100 - c.gt[1]);
        if (e < bestErr) { bestErr = e; bestBand = b2; }
      }
    }
    band = bestBand;
  }
  const appTop = band ? (band.top.y / f.H) * 100 : NaN;
  const appBottom = band ? (band.bottom.y / f.H) * 100 : NaN;

  // 2) model globine
  const dm = await depthMap(c.file);
  const db = depthBand(dm, c.tapPct);

  const err = (a: number, b: number) => (Number.isFinite(a) ? Math.abs(a - b) : NaN);
  console.log(`  GT (ročno):      zgornji ${c.gt[0].toFixed(1)} %  spodnji ${c.gt[1].toFixed(1)} %`);
  console.log(`  hevristika:      zgornji ${appTop.toFixed(1)} %  spodnji ${appBottom.toFixed(1)} %  (${msApp.toFixed(0)} ms)  napaka ${err(appTop, c.gt[0]).toFixed(1)} / ${err(appBottom, c.gt[1]).toFixed(1)} %`);
  console.log(`  globina (HF):    zgornji ${db ? db.top.toFixed(1) : '—'} %  spodnji ${db ? db.bottom.toFixed(1) : '—'} %  napaka ${db ? err(db.top, c.gt[0]).toFixed(1) : '—'} / ${db ? err(db.bottom, c.gt[1]).toFixed(1) : '—'} %`);
}
