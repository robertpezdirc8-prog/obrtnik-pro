// ─── Priprava teksture wpc-tikovina (brez AI, brez novih odvisnosti) ──
//
// PROBLEM (najden z analizo stebrične svetilnosti): originalna fotka
// Pexels 326311 (512×512) prikazuje ~6 pravih desk S TEMNIMI SPOJI
// med njimi (stebrična svetilnost pade pod povprečje−12 pri x ≈ 9,
// 96, 183, 271, 359, 448). Vizualizator (viz.ts) za vodoravne deke
// (vzorec 'terasa') zavrne tile za 90° → spoji iz vira postanejo
// VODORAVNE temne črte SREDI deke = videti kot zložene kratke deske
// (neresnično). Enako pri fotomenjavi (wpc-deka-140).
//
// REŠITEV: izreži ENO čisto desko (stebrični razpon brez spojev),
// jo zrcalno tlakuj 6× (izmenično flop — zrna se staknejo brez šivov),
// spet 512×512 → tile ohrani MERILO (6 desk ≈ 45 cm, realCm 45 v
// registru ostane veljaven), brez spojev. Povsem deterministično
// (sharp, že odvisnost — 0 novih). Original ostane v git zgodovini.
//
// Zagon: bun tests/make-tikovina-tile.ts
// Neodvisna preverba izpiše: mere, stebrično svetilnost (brez skupin
// pod povprečje−12 na notranjosti), energijo gradientov (žira).

import sharp from 'sharp';

const SRC = 'public/textures/wpc-tikovina.jpg';
const OUT = 'public/textures/wpc-tikovina.jpg';

// ── 1. izvor: meri spoje (enaka metoda kot analiza zgoraj) ──
const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
if (W !== 512 || H !== 512) throw new Error(`Pričakovano 512×512, dejansko ${W}×${H}`);

const colLum = new Float64Array(W);
for (let x = 0; x < W; x++) {
  let s = 0;
  for (let y = 0; y < H; y++) {
    const i = (y * W + x) * C;
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  colLum[x] = s / H;
}
const mean = colLum.reduce((a, b) => a + b, 0) / W;

// spoji = kratke skupine (< 4 px) stebričev pod povprečje−12;
// širše temne regije so senca lesa (ne spoj) — ignoriramo.
const isJoint = (x: number): boolean => colLum[x] < mean - 12;
const jointGroups: [number, number][] = [];
for (let x = 0; x < W; x++) {
  if (!isJoint(x)) continue;
  const last = jointGroups[jointGroups.length - 1];
  if (last && x - last[1] <= 2 && (x - last[0]) < 4) last[1] = x;
  else jointGroups.push([x, x]);
}
const joints = jointGroups.filter(([a, b]) => b - a < 4);
console.log(`izvor: ${W}×${H}, povprečna svetilnost ${mean.toFixed(1)}`);
console.log(`spoji (skupine < 4 px pod povprečje−12): ${joints.map(([a, b]) => `${a}-${b}`).join(', ')}`);

// ── 2. izberi najširši razpon BREZ spojev (deterministično) ──
const spans: [number, number][] = [];
let start = joints.length > 0 && joints[0][0] === 0 ? joints[0][1] + 1 : 0;
for (const [a, b] of joints) {
  if (a - 1 >= start) spans.push([start, a - 1]);
  start = b + 1;
}
if (start <= W - 1) spans.push([start, W - 1]);
// odstrani robne razpone (< 40 px — morda odrezana deska na robovih fotke)
const inner = spans.filter(([a, b]) => b - a >= 40);
if (inner.length === 0) throw new Error('Ni dovolj širokega čistega razpona — ročno prilagodi.');
// izberi razpon z NAJBOLJ ENOTNO svetilnostjo (min varianca) — deterministično
let best = inner[0], bestVar = Infinity;
for (const [a, b] of inner) {
  const vals = colLum.slice(a, b + 1);
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  const v = vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length;
  if (v < bestVar) { bestVar = v; best = [a, b]; }
}
const [x0, x1] = best;
// 2 px varnostni rob od spojev
const left = x0 + 2, width = x1 - x0 + 1 - 4;
console.log(`izrez: x=${left}, širina=${width} (razpon ${x0}-${x1}, varianca ${bestVar.toFixed(1)})`);
if (width < 40) throw new Error('Izrez preozek.');

// ── 3. izrez + zrcalno tlakovanje 6× (izmenično flop) ──
// rob fotke: zgornje vrstice vsebujejo temen rob/senco — prestavimo
// izrez pod njega, sicer se temni vozli/rob zrcalno ponovijo na
// vrhu vsake kopije. Število vrstic merimo deterministično:
// vrstice, katerih svetilnost pade > 12 pod povprečje stolpcev,
// se štejejo za rob (od zgoraj, zaporedoma).
const rowLum = new Float64Array(H);
for (let y = 0; y < H; y++) {
  let s = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C;
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  rowLum[y] = s / W;
}
const rowMean = rowLum.reduce((a, b) => a + b, 0) / H;
let TOP_SKIP = 0;
while (TOP_SKIP < 40 && rowLum[TOP_SKIP] < rowMean - 12) TOP_SKIP++;
console.log(`rob: zgornjih ${TOP_SKIP} vrstic pod povprečje−12 (povprečje vrstic ${rowMean.toFixed(1)}) → preskočenih`);
const strip = await sharp(SRC).extract({ left, top: TOP_SKIP, width, height: H - TOP_SKIP }).toBuffer();
const COPIES = 6;
const composites: sharp.OverlayOptions[] = [];
for (let i = 0; i < COPIES; i++) {
  let tileBuf = strip;
  if (i % 2 === 1) tileBuf = await sharp(strip).flop().toBuffer();
  composites.push({ input: tileBuf, left: i * width, top: 0 });
}
const totalW = COPIES * width;
const stripH = H - TOP_SKIP;
const tiled = await sharp({
  create: { width: totalW, height: stripH, channels: 3, background: { r: 128, g: 128, b: 128 } },
}).composite(composites).jpeg({ quality: 100 }).toBuffer();

// ── 4. končna velikost 512×512 (merilo ohranjeno: 6 desk ≈ 45 cm) ──
await sharp(tiled).resize(512, 512, { fit: 'fill' }).jpeg({ quality: 92 }).toFile(OUT);
console.log(`zapisano: ${OUT} (${totalW}×${stripH} → 512×512, ${COPIES} zrcalnih kopij izreza)`);

// ── 5. neodvisna preverba zapisanega ──
const out = await sharp(OUT).raw().toBuffer({ resolveWithObject: true });
const OW = out.info.width, OH = out.info.height, OC = out.info.channels;
if (OW !== 512 || OH !== 512) throw new Error(`izhod ni 512×512: ${OW}×${OH}`);
const oLum = new Float64Array(OW);
for (let x = 0; x < OW; x++) {
  let s = 0;
  for (let y = 0; y < OH; y++) {
    const i = (y * OW + x) * OC;
    s += 0.2126 * out.data[i] + 0.7152 * out.data[i + 1] + 0.0722 * out.data[i + 2];
  }
  oLum[x] = s / OH;
}
const oMean = oLum.reduce((a, b) => a + b, 0) / OW;
// spoji v izhodu: samo ROBJI zrcaljenja (vsakih ~width px po resize) so
// kontinuiteta zrna — NE sme biti ozkih TEMNIH kanalov (padec > 18 pod
// sosedov povprečje v oknu ±6 px je spoj);
let darkChannels = 0;
for (let x = 6; x < OW - 6; x++) {
  const nb = (oLum[x - 6] + oLum[x + 6]) / 2;
  if (oLum[x] < nb - 18) darkChannels++;
}
console.log(`izhod: ${OW}×${OH}, povprečje ${oMean.toFixed(1)}, temnih kanalov (spojev) = ${darkChannels}`);
if (darkChannels > 4) throw new Error(`Izhod še vedno vsebuje ${darkChannels} temnih kanalov — tlakovanje ni očistilo spojev.`);

// energija gradientov: žira mora ostati NAVPIČNA (|dx| > |dy|, kot v registru)
let ex = 0, ey = 0;
for (let y = 1; y < OH - 1; y += 2) {
  for (let x = 1; x < OW - 1; x += 2) {
    const i = (y * OW + x) * OC;
    const l = 0.2126 * out.data[i] + 0.7152 * out.data[i + 1] + 0.0722 * out.data[i + 2];
    const ir = (y * OW + x + 1) * OC;
    const r = 0.2126 * out.data[ir] + 0.7152 * out.data[ir + 1] + 0.0722 * out.data[ir + 2];
    const id = ((y + 1) * OW + x) * OC;
    const d = 0.2126 * out.data[id] + 0.7152 * out.data[id + 1] + 0.0722 * out.data[id + 2];
    ex += Math.abs(r - l); ey += Math.abs(d - l);
  }
}
console.log(`energija gradientov: |dx|=${ex.toFixed(0)} vs |dy|=${ey.toFixed(0)} → žira ${ex > ey ? 'NAVPIČNA' : 'NI navpična!'}`);
if (ex <= ey) throw new Error('Žira po obdelavi NI več navpična — register bi bil napačen.');

console.log('V REDU — tile brez spojev, navpična žira, merilo ohranjeno.');
