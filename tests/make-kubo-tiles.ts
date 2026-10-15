// ─── Priprava KUBO dekorjev iz ORIGINALNE ROKSAL barvne lestvice ──
//
// VIR (roksal-original, preneseno z uradne strani roksal.com —
// stran "Barvni odtenki"): public/roksal/kubo/barvna-lestvica-kubo.png
// = BARVNA_LESTVICA_5-kubo4.png (2217×675), uradna paleta dekorjev
// profila KUBO 80/42. Lestvica prikazuje TOČNO 4 dekorja (krogi na
// črnem ozadju) BREZ besedilnih oznak → dekorje označujemo ISKRENO po
// položaju (1–4, z leve), imen NE izmišljujemo (čaka ROKSAL katalog).
//
// POSTOPEK (povsem determinističen, sharp — že odvisnost, 0 novih):
//  1. detekcija krogov: stolpci z zadostnim številom svetlih pikslov
//     (lum > 16) v regiji pod okrasnimi črtami (y ≥ 110) → 4 zvezne
//     razpone; natančen y-obseg iz svetlih vrstic znotraj razpona.
//  2. izrez: VPISANI kvadrat kroga (rob = d×0,66 — varnostna lauf
//     pred črnim ozadjem), da je tile čista dekor površina.
//  3. žira: energija gradientov |dx| vs |dy| — če je žira na lestvici
//     VODORAVNA (|dy|>|dx|), zavrti 90° (KUBO se vgrajuje POKONČNO →
//     žira mora slediti smeri deske, kot pri wpc-siva v registru).
//  4. zrcalno tlakovanje 2×2 (izmenično flop/flip — brez vidnih šivov)
//     → 608×608 → 512×512 (downscale = čistost, merilo ohranjeno znotraj
//     faktorja resize, realCm v registru je označen kot privzetek —
//     lestvica NE objavlja fizičnega merila).
//  5. neodvisna preverba: 512×512, 0 temnih kanalov, žira navpična,
//     povprečne barve po dekorju (za PROFILE_COLOR_ID in teste).
//
// Zagon: bun tests/make-kubo-tiles.ts

import sharp from 'sharp';

const SRC = 'public/roksal/kubo/barvna-lestvica-kubo.png';
const OUT_DIR = 'public/roksal/kubo';
const LUM_THRESHOLD = 16;
const MIN_COL_BRIGHT = 30;   // min svetlih pikslov v stolpcu, da je del kroga
const MIN_RUN_WIDTH = 120;   // min širina razpona (krog ≈ 332 px)
const TOP_REGION = 130;      // pod okrasnimi črtami (merjeno: črti pri y ≈ 106–112)

// ── 1. ravninske piksle ──
const { data, info } = await sharp(SRC).flatten({ background: { r: 0, g: 0, b: 0 } }).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
console.log(`vir: ${W}×${H}, kanali ${C}`);
if (W < 800 || H < 400) throw new Error(`Vir premajhen: ${W}×${H}`);

const lum = (i: number): number => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

// ── 2. stolpci krogov (regija pod okrasnimi črtami) ──
const colCount = new Int32Array(W);
for (let x = 0; x < W; x++) {
  let n = 0;
  for (let y = TOP_REGION; y < H; y++) {
    if (lum((y * W + x) * C) > LUM_THRESHOLD) n++;
  }
  colCount[x] = n;
}
const runs: [number, number][] = [];
for (let x = 0; x < W; x++) {
  if (colCount[x] < MIN_COL_BRIGHT) continue;
  const last = runs[runs.length - 1];
  if (last && x - last[1] <= 3) last[1] = x;
  else runs.push([x, x]);
}
const circles = runs.filter(([a, b]) => b - a >= MIN_RUN_WIDTH);
console.log(`stolpčni razponi (≥${MIN_RUN_WIDTH} px): ${runs.length}, krogov: ${circles.length}`);
if (circles.length !== 4) throw new Error(`Pričakovano TOČNO 4 dekorje (uradna lestvica KUBO), najdenih ${circles.length} — ročno preveri vir.`);

// ── 3. po krogu: y-obseg + vpisani kvadrat ──
const tiles: { idx: number; left: number; top: number; size: number; buf: Buffer }[] = [];
for (let k = 0; k < circles.length; k++) {
  const [xa, xb] = circles[k];
  const cx = Math.round((xa + xb) / 2);
  const d = xb - xa + 1;
  // y-obseg: svetle vrstice znotraj stolpcev kroga
  let ya = H, yb = -1;
  for (let y = TOP_REGION; y < H; y++) {
    let n = 0;
    for (let x = xa; x <= xb; x += 2) {
      if (lum((y * W + x) * C) > LUM_THRESHOLD) n++;
    }
    // tetiva kroga (vzorčenje x+=2 → maksimum d/2); okrasne črte so že
    // izključene s TOP_REGION (merjeno: črti pri y ≈ 106–112 < 130)
    if (n > (d / 4)) { if (y < ya) ya = y; if (y > yb) yb = y; }
  }
  if (yb < ya) throw new Error(`Krog ${k + 1}: y-obseg prazen.`);
  const cy = Math.round((ya + yb) / 2);
  const dy = yb - ya + 1;
  const diam = Math.min(d, dy);
  // vpisani kvadrat z varnostno laufjo (0,66× premer — ostane znotraj kroga)
  const size = Math.round(diam * 0.66);
  const left = cx - Math.floor(size / 2), top = cy - Math.floor(size / 2);
  if (left < 0 || top < 0 || left + size > W || top + size > H) throw new Error(`Krog ${k + 1}: izrez izven slike.`);
  console.log(`krog ${k + 1}: x ${xa}–${xb} (d=${d}), y ${ya}–${yb} (dy=${dy}), vpisani kvadrat ${size}×${size} @ (${left},${top})`);
  const buf = await sharp(SRC).flatten({ background: { r: 0, g: 0, b: 0 } }).extract({ left, top, width: size, height: size }).png().toBuffer();
  tiles.push({ idx: k + 1, left, top, size, buf });
}

// ── 4. žira + zasuk po potrebi ──
async function grainEnergies(b: Buffer): Promise<[number, number]> {
  const { data: rd, info: ri } = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const w = ri.width, h = ri.height, c = ri.channels;
  let ex = 0, ey = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * c;
      const l = 0.2126 * rd[i] + 0.7152 * rd[i + 1] + 0.0722 * rd[i + 2];
      const ir = (y * w + x + 1) * c;
      const r = 0.2126 * rd[ir] + 0.7152 * rd[ir + 1] + 0.0722 * rd[ir + 2];
      const id = ((y + 1) * w + x) * c;
      const dn = 0.2126 * rd[id] + 0.7152 * rd[id + 1] + 0.0722 * rd[id + 2];
      ex += Math.abs(r - l); ey += Math.abs(dn - l);
    }
  }
  return [ex, ey];
}

const processed: Buffer[] = [];
for (const t of tiles) {
  const [ex, ey] = await grainEnergies(t.buf);
  const horizontal = ey > ex; // vodoravna žira = močnejši gradienti v smeri y
  const prepped = horizontal ? await sharp(t.buf).rotate(90).toBuffer() : t.buf;
  const [ex2, ey2] = await grainEnergies(prepped);
  console.log(`dekor ${t.idx}: žira na lestvici ${horizontal ? 'VODORAVNA (|dx|=' + ex.toFixed(0) + ' < |dy|=' + ey.toFixed(0) + ') → zasuk 90°' : 'navpična (|dx|=' + ex.toFixed(0) + ' ≥ |dy|=' + ey.toFixed(0) + ')'} → po pripravi |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)} (mora biti |dx|>|dy|)`);
  if (ex2 <= ey2) throw new Error(`dekor ${t.idx}: žira po zasuku NI navpična.`);
  processed.push(prepped);
}

// ── 5. zrcalno tlakovanje 2×2 → 512×512 ──
for (let k = 0; k < processed.length; k++) {
  const src = processed[k];
  const m = await sharp(src).metadata();
  const s = m.width ?? 0;
  if (s < 120) throw new Error(`dekor ${k + 1}: izrez preozek (${s}).`);
  const tl = src;
  const tr = await sharp(src).flop().toBuffer();                      // zrcali vodoravno
  const bl = await sharp(src).flip().toBuffer();                      // zrcali navpično
  const br = await sharp(src).flop().flip().toBuffer();               // obe
  const tiled = await sharp({
    create: { width: s * 2, height: s * 2, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).composite([
    { input: tl, left: 0, top: 0 }, { input: tr, left: s, top: 0 },
    { input: bl, left: 0, top: s }, { input: br, left: s, top: s },
  ]).png().toBuffer();
  const out = `${OUT_DIR}/dekor-${k + 1}.png`;
  await sharp(tiled).resize(512, 512, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(out);

  // ── 6. neodvisna preverba zapisanega ──
  const { data: od, info: oi } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const OW = oi.width, OH = oi.height, OC = oi.channels;
  if (OW !== 512 || OH !== 512) throw new Error(`dekor ${k + 1}: izhod ni 512×512 (${OW}×${OH}).`);
  // (a) ČRNO OZADJE: piksli z lum < 10 so ozadje lestvice — v vpisanem
  //     kvadratu jih NI smeti biti (naravna dekor barva dekora 1 je temno
  //     siva, povprečje lum ≈ 87, min je nad 10).
  let nearBlack = 0;
  // (b) SPOJI (zrcaljenje/ozadje): TEMNA ČRTA čez > 70 % višine —
  //     naravna žira WPC je delna (ne s̆teva), prava fuga/šiv je polna.
  let fullDarkLines = 0;
  for (let x = 6; x < OW - 6; x++) {
    let darkRows = 0;
    for (let y = 0; y < OH; y++) {
      const i = (y * OW + x) * OC;
      const l = lum2(od, i, OC);
      if (l < 10) nearBlack++;
      const il = (y * OW + x - 6) * OC;
      const ir = (y * OW + x + 6) * OC;
      const nb = (lum2(od, il, OC) + lum2(od, ir, OC)) / 2;
      if (l < nb - 18) darkRows++;
    }
    if (darkRows > OH * 0.7) fullDarkLines++;
  }
  const [ex2, ey2] = await grainEnergies(await sharp(out).png().toBuffer());
  // povprečna barva (za PROFILE_COLOR_ID + teste)
  let R = 0, G = 0, B = 0;
  const n = OW * OH;
  for (let i = 0; i < n; i++) { R += od[i * OC]; G += od[i * OC + 1]; B += od[i * OC + 2]; }
  R = Math.round(R / n); G = Math.round(G / n); B = Math.round(B / n);
  console.log(`dekor ${k + 1}: ${out} — skoraj-črnih pikslov ${nearBlack}, polnih temnih črt ${fullDarkLines}, žira |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)}, povprečje RGB(${R},${G},${B})`);
  if (nearBlack > 0) throw new Error(`dekor ${k + 1}: ${nearBlack} skoraj-črnih pikslov — črno ozadje lestvice je zašlo v izrez.`);
  if (fullDarkLines > 2) throw new Error(`dekor ${k + 1}: ${fullDarkLines} polnih temnih črt — vidni šivi zrcaljenja/ozadja.`);
  if (ex2 <= ey2) throw new Error(`dekor ${k + 1}: žira v zapisani datoteki NI navpična.`);
}

function lum2(d: Buffer, i: number, _c: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

console.log('V REDU — 4 KUBO dekorji iz uradne lestvice: 512×512, brez črnega ozadja, navpična žira.');
