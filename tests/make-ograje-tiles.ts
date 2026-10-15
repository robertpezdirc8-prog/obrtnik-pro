// ─── Priprava OGRAJNIH dekorjev iz ORIGINALNIH ROKSAL barvne lestvice ──
//
// VIRI (roksal-original, prenešeno z uradnih strani roksal.com prek CDP,
// tests/make-ograje-fetch.ts):
//  - public/roksal/ograje/romb-67/barvna-lestvica-romb.png
//    = BARVNA_LESTVICA_3-rombi4.png (2560×669) — uradna lestvica ROMB
//    DESKA-67 (67×26×5800, Z ALU CEVJO): "sedmimi barvami" → TOČNO 7 krogov.
//  - public/roksal/ograje/polna-100/barvna-lestvica-polna.png
//    = BARVNA_LESTVICA_2_polna.png (2560×600) — uradna lestvica POLNA
//    DESKA-100 (100×12×5800, samo pokončno): "osmimi barvami" → TOČNO 8 krogov.
//  - public/roksal/ograje/polna-128/barvna-lestvica-polna-128.png
//    = BARVNA_LESTVICA_4-polna-128-4.png (2560×683) — uradna lestvica POLNA
//    DESKA-128 (128×16×2200, pokončno + prečno): "šestimi barvami" → TOČNO 6 krogov.
//
// Lestvice prikazujejo dekorje (krogi na črnem ozadju) BREZ besedilnih
// oznak → dekorje označujemo ISKRENO po položaju (z leve), imen NE
// izmišljamo. OPOZORILO o parjenju: uradna stran za POLNA DESKA-57/32
// uporablja KUBO lestvico (BARVNA_LESTVICA_5-kubo4) → 57/32 variante
// naslavljajo obstoječe tex-roksal-kubo-dekor-1..4 (ločena tlakovanja
// niso potrebna; glej register).
//
// POSTOPEK (povsem determinističen, sharp — že odvisnost, 0 novih):
//  1. detekcija okrasnih črt (tanke vodoravne črte zgoraj — pri teh
//     lestvicah pri y ≈ 90–110) → regija krogov pod njimi.
//  2. detekcija krogov: stolpci z zadostnim številom svetlih pikslov
//     (lum > 16) → zvezni razponi; natančen y-obseg iz svetlih vrstic.
//  3. izrez: VPISANI kvadrat kroga (rob = d×0,66 — varnostna lauf pred
//     črnim ozadjem), da je tile čista dekor površina.
//  4. žira: energija gradientov |dx| vs |dy| — žira na lestvici je
//     VODORAVNA (rebra) → zavrti 90°, ker tlaki v rendererju (viz.ts
//     applyTextureFill) imajo konvencijo NAVPIČNE žire — pokončne deske
//     ('vertikalne') renderer riše z žiro vzdolž deske (navpično);
//     vodoravne ('horizontalne', 'terasa') zasuka sam (rotate90).
//  5. ENOJNI NEPREKINJEN izrez → 256×256 (lanczos3): tile NE vsebuje
//     notranjega zrcaljenja — zrcalno tlakovanje zagotavlja izključno
//     renderer (drawMirroredTexture). (Poučeno iz KUBO: pečeno 2×2
//     zrcaljenje ustvari metuljasto simetrijo.)
//  6. neodvisna preverba: 256×256, 0 skoraj-črnih pikslov, žira
//     navpična, NI notranje zrcalne simetrije (lev/des + zgornj/spod
//     ≥ 6/255), povprečne barve po dekorju (PROFILE_COLOR_ID).
//
// Zagon: bun tests/make-ograje-tiles.ts

import sharp from 'sharp';

const LUM_THRESHOLD = 16;
const MIN_COL_BRIGHT = 30;   // min svetlih pikslov v stolpcu, da je del kroga
const MIN_RUN_WIDTH = 150;   // min širina razpona (krog ≈ 200–300 px @ 2560)

const SOURCES: Array<{ src: string; outDir: string; expected: number; name: string }> = [
  { src: 'public/roksal/ograje/romb-67/barvna-lestvica-romb.png', outDir: 'public/roksal/ograje/romb-67', expected: 7, name: 'ROMB DESKA-67' },
  { src: 'public/roksal/ograje/polna-100/barvna-lestvica-polna.png', outDir: 'public/roksal/ograje/polna-100', expected: 8, name: 'POLNA DESKA-100' },
  { src: 'public/roksal/ograje/polna-128/barvna-lestvica-polna-128.png', outDir: 'public/roksal/ograje/polna-128', expected: 6, name: 'POLNA DESKA-128' },
];

function lumOf(d: Buffer, i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

async function grainEnergies(b: Buffer): Promise<[number, number]> {
  const { data: rd, info: ri } = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const w = ri.width, h = ri.height, c = ri.channels;
  let ex = 0, ey = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * c;
      const l = lumOf(rd, i);
      const ir = (y * w + x + 1) * c;
      const r = lumOf(rd, ir);
      const id = ((y + 1) * w + x) * c;
      const dn = lumOf(rd, id);
      ex += Math.abs(r - l); ey += Math.abs(dn - l);
    }
  }
  return [ex, ey];
}

const allAverages: string[] = [];

for (const SRC of SOURCES) {
  console.log(`\n══ ${SRC.name} (${SRC.src}, pričakovano ${SRC.expected} dekorjev) ══`);
  const { data, info } = await sharp(SRC.src).flatten({ background: { r: 0, g: 0, b: 0 } }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log(`vir: ${W}×${H}, kanali ${C}`);
  if (W < 2000 || H < 500) throw new Error(`Vir premajhen: ${W}×${H} — pričakovana polna lestvica ~2560×600.`);
  const lum = (i: number): number => lumOf(data, i);

  // ── 1. okrasne črte zgoraj (tanke vodoravne črte, y < 200) ──
  let topRegion = 0;
  for (let y = 0; y < 200; y++) {
    let bright = 0;
    for (let x = 0; x < W; x += 4) {
      if (lum((y * W + x) * C) > LUM_THRESHOLD) bright++;
    }
    const frac = bright / Math.ceil(W / 4);
    if (frac > 0.5) topRegion = y + 1; // zadnja vrstica črte
  }
  topRegion += 12; // varnostna lauf
  console.log(`okrasne črte do y=${topRegion - 12}, regija krogov: y ≥ ${topRegion}`);

  // ── 2. stolpci krogov ──
  const colCount = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = topRegion; y < H; y++) {
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
  if (circles.length !== SRC.expected) {
    throw new Error(`${SRC.name}: pričakovano TOČNO ${SRC.expected} dekorjev (uradni opis roksal.com), najdenih ${circles.length} — ročno preveri vir.`);
  }

  // ── 3. po krogu: y-obseg + vpisani kvadrat ──
  const tiles: { idx: number; buf: Buffer }[] = [];
  for (let k = 0; k < circles.length; k++) {
    const [xa, xb] = circles[k];
    const cx = Math.round((xa + xb) / 2);
    const d = xb - xa + 1;
    let ya = H, yb = -1;
    for (let y = topRegion; y < H; y++) {
      let n = 0;
      for (let x = xa; x <= xb; x += 2) {
        if (lum((y * W + x) * C) > LUM_THRESHOLD) n++;
      }
      if (n > (d / 4)) { if (y < ya) ya = y; if (y > yb) yb = y; }
    }
    if (yb < ya) throw new Error(`Krog ${k + 1}: y-obseg prazen.`);
    const cy = Math.round((ya + yb) / 2);
    const dy = yb - ya + 1;
    const diam = Math.min(d, dy);
    const size = Math.round(diam * 0.66);
    const left = cx - Math.floor(size / 2), top = cy - Math.floor(size / 2);
    if (left < 0 || top < 0 || left + size > W || top + size > H) throw new Error(`Krog ${k + 1}: izrez izven slike.`);
    console.log(`krog ${k + 1}: x ${xa}–${xb} (d=${d}), y ${ya}–${yb} (dy=${dy}), vpisani kvadrat ${size}×${size} @ (${left},${top})`);
    const buf = await sharp(SRC.src).flatten({ background: { r: 0, g: 0, b: 0 } }).extract({ left, top, width: size, height: size }).png().toBuffer();
    tiles.push({ idx: k + 1, buf });
  }

  // ── 4. žira + zasuk (konvencija rendererja: tlak NAVPIČNA žira) ──
  const processed: Buffer[] = [];
  for (const t of tiles) {
    const [ex, ey] = await grainEnergies(t.buf);
    const horizontal = ey > ex; // vodoravna žira = močnejši gradienti v smeri y
    const prepped = horizontal ? await sharp(t.buf).rotate(90).toBuffer() : t.buf;
    const [ex2, ey2] = await grainEnergies(prepped);
    console.log(`dekor ${t.idx}: žira na lestvici ${horizontal ? 'VODORAVNA (|dx|=' + ex.toFixed(0) + ' < |dy|=' + ey.toFixed(0) + ') → zasuk 90° (konvencija tlakov: navpična žira)' : 'navpična (|dx|=' + ex.toFixed(0) + ' ≥ |dy|=' + ey.toFixed(0) + ') — brez zasuka'} → po pripravi |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)} (mora biti |dx|>|dy|)`);
    if (ex2 <= ey2) throw new Error(`dekor ${t.idx}: žira po zasuku NI navpična.`);
    processed.push(prepped);
  }

  // ── 5. enojni neprekinjen izrez → 256×256 + ── 6. neodvisna preverba ──
  for (let k = 0; k < processed.length; k++) {
    const src = processed[k];
    const m = await sharp(src).metadata();
    const s = m.width ?? 0;
    if (s < 120) throw new Error(`dekor ${k + 1}: izrez preozek (${s}).`);
    const out = `${SRC.outDir}/dekor-${k + 1}.png`;
    await sharp(src).resize(256, 256, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(out);

    const { data: od, info: oi } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const OW = oi.width, OH = oi.height, OC = oi.channels;
    if (OW !== 256 || OH !== 256) throw new Error(`dekor ${k + 1}: izhod ni 256×256 (${OW}×${OH}).`);
    let symX = 0, symY = 0;
    for (let x = 0; x < OW; x++) {
      let d = 0;
      for (let y = 0; y < OH; y++) {
        const ia = (y * OW + x) * OC;
        const ib = (y * OW + (OW - 1 - x)) * OC;
        d += Math.abs(od[ia] - od[ib]) + Math.abs(od[ia + 1] - od[ib + 1]) + Math.abs(od[ia + 2] - od[ib + 2]);
      }
      symX += d / (OH * 3);
    }
    for (let y = 0; y < OH; y++) {
      let d = 0;
      for (let x = 0; x < OW; x++) {
        const ia = (y * OW + x) * OC;
        const ib = (((OH - 1 - y) * OW) + x) * OC;
        d += Math.abs(od[ia] - od[ib]) + Math.abs(od[ia + 1] - od[ib + 1]) + Math.abs(od[ia + 2] - od[ib + 2]);
      }
      symY += d / (OW * 3);
    }
    symX /= OW; symY /= OH;
    if (symX < 6 || symY < 6) throw new Error(`dekor ${k + 1}: tile je notranje zrcaljen (symX=${symX.toFixed(1)}, symY=${symY.toFixed(1)}) — pričakovano enojni ne-simetričen izrez.`);
    let nearBlack = 0;
    for (let i = 0; i < OW * OH; i++) {
      if (lumOf(od, i * OC) < 10) nearBlack++;
    }
    let R = 0, G = 0, B = 0;
    const n = OW * OH;
    for (let i = 0; i < n; i++) { R += od[i * OC]; G += od[i * OC + 1]; B += od[i * OC + 2]; }
    R = Math.round(R / n); G = Math.round(G / n); B = Math.round(B / n);
    const [ex2, ey2] = await grainEnergies(await sharp(out).png().toBuffer());
    allAverages.push(`${SRC.outDir.split('/').pop()}/dekor-${k + 1}: RGB(${R},${G},${B})`);
    console.log(`dekor ${k + 1}: ${out} — skoraj-črnih ${nearBlack}, žira |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)}, simetrija lev/des ${symX.toFixed(1)} zgornj/spod ${symY.toFixed(1)} (≥ 6), povprečje RGB(${R},${G},${B})`);
    if (nearBlack > 0) throw new Error(`dekor ${k + 1}: ${nearBlack} skoraj-črnih pikslov — črno ozadje lestvice je zašlo v izrez.`);
    if (ex2 <= ey2) throw new Error(`dekor ${k + 1}: žira v zapisani datoteki NI navpična.`);
  }
}

console.log('\nV REDU — 21 OGRAJNIH dekorjev iz uradnih lestvic: 256×256 enojni ne-zrcaljen izrez, brez črnega ozadja, navpična žira (konvencija rendererja).');
console.log('POVPREČJA za PROFILE_COLOR_ID:');
allAverages.forEach((a) => console.log('  ' + a));
