// ─── Priprava DEKA dekorjev iz ORIGINALNE ROKSAL barvne lestvice ──
//
// VIR (roksal-original, preneseno z uradne strani roksal.com —
// stran "Barvni odtenki", razdelek TERASNI profil):
// public/roksal/deka/barvna-lestvica-deka.png
// = BARVNA_LESTVICA_1-terasa4.png (2560×680), uradna paleta odtenkov
// terasnih desk (alt: "Barvna paleta odtenkov WPC desk za desko 150").
// Lestvica prikazuje TOČNO 7 dekorjev (krogi na črnem ozadju) BREZ
// besedilnih oznak → dekorje označujemo ISKRENO po položaju (1–7, z
// leve), imen NE izmišljamo (uradni opis: "sedmimi barvnimi odtenki in
// tremi površinami"; KLASIK = 5 odtenkov, RUSTIC = "izgled staran les").
//
// POSTOPEK (povsem determinističen, sharp — že odvisnost, 0 novih):
//  1. detekcija krogov: stolpci z zadostnim številom svetlih pikslov
//     (lum > 16) v regiji pod okrasnima črtama (y ≥ 160) → 7 zveznih
//     razponov; natančen y-obseg iz svetlih vrstic znotraj razpona.
//  2. izrez: VPISANI kvadrat kroga (rob = d×0,66 — varnostna lauf
//     pred črnim ozadjem), da je tile čista dekor površina.
//  3. žira: energija gradientov |dx| vs |dy| — žira na lestvici je
//     VODORAVNA (rebra) → zavrti 90°, ker tlaki v rendererju (viz.ts
//     applyTextureFill) imajo konvencijo NAVPIČNE žire — vodoravne
//     deke ('terasa') renderer zasuka sam (rotate90).
//  4. ENOJNI NEPREKINJEN izrez → 256×256 (lanczos3): tile NE vsebuje
//     notranjega zrcaljenja — zrcalno tlakovanje zagotavlja izključno
//     renderer (drawMirroredTexture). (Poučeno iz KUBO: pečeno 2×2
//     zrcaljenje ustvari metuljasto simetrijo, ki jo renderer še
//     enkrat zrcali → dvojna simetrija vidna v žiri upodobitve.)
//  5. neodvisna preverba: 256×256, 0 skoraj-črnih pikslov, žira
//     navpična, NI notranje zrcalne simetrije (lev/des + zgornj/spod
//     ≥ 6/255), povprečne barve po dekorju (PROFILE_COLOR_ID).
//
// Zagon: bun tests/make-deka-tiles.ts

import sharp from 'sharp';

const SRC = 'public/roksal/deka/barvna-lestvica-deka.png';
const OUT_DIR = 'public/roksal/deka';
const LUM_THRESHOLD = 16;
const MIN_COL_BRIGHT = 30;   // min svetlih pikslov v stolpcu, da je del kroga
const MIN_RUN_WIDTH = 150;   // min širina razpona (krog ≈ 300 px @ 2560 širine)
const TOP_REGION = 160;      // pod okrasnimi črtami (merjeno: črti pri y ≈ 114–122)

// ── 1. ravninske piksle ──
const { data, info } = await sharp(SRC).flatten({ background: { r: 0, g: 0, b: 0 } }).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
console.log(`vir: ${W}×${H}, kanali ${C}`);
if (W < 2000 || H < 500) throw new Error(`Vir premajhen: ${W}×${H} — pričakovana polna lestvica 2560×680.`);

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
if (circles.length !== 7) throw new Error(`Pričakovano TOČNO 7 dekorjev (uradni opis TERASNI profil: "sedmimi barvnimi odtenki"), najdenih ${circles.length} — ročno preveri vir.`);

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
    // izključene s TOP_REGION
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

// ── 4. žira + zasuk (konvencija rendererja: tlak NAVPIČNA žira) ──
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
  console.log(`dekor ${t.idx}: žira na lestvici ${horizontal ? 'VODORAVNA (|dx|=' + ex.toFixed(0) + ' < |dy|=' + ey.toFixed(0) + ') → zasuk 90° (konvencija tlakov: navpična žira)' : 'navpična (|dx|=' + ex.toFixed(0) + ' ≥ |dy|=' + ey.toFixed(0) + ') — brez zasuka'} → po pripravi |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)} (mora biti |dx|>|dy|)`);
  if (ex2 <= ey2) throw new Error(`dekor ${t.idx}: žira po zasuku NI navpična.`);
  processed.push(prepped);
}

// ── 5. enojni neprekinjen izrez → 256×256 (brez notranjega zrcaljenja) ──
const averages: string[] = [];
for (let k = 0; k < processed.length; k++) {
  const src = processed[k];
  const m = await sharp(src).metadata();
  const s = m.width ?? 0;
  if (s < 120) throw new Error(`dekor ${k + 1}: izrez preozek (${s}).`);
  const out = `${OUT_DIR}/dekor-${k + 1}.png`;
  await sharp(src).resize(256, 256, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(out);

  // ── 6. neodvisna preverba zapisanega ──
  const { data: od, info: oi } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const OW = oi.width, OH = oi.height, OC = oi.channels;
  if (OW !== 256 || OH !== 256) throw new Error(`dekor ${k + 1}: izhod ni 256×256 (${OW}×${OH}).`);
  // (c) NOTRANJA ZRCALNA SIMETRIJA: enojni izrez mora biti naravno
  //     ne-simetričen (zrcaljen tile bi imel ~0). Meja 6/255 nad šumom.
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
  // (a) ČRNO OZADJE lestvice NE sme zaiti v izrez.
  let nearBlack = 0;
  // (b) REBRA vs ŠIVI: TEMNA ČRTA čez > 70 % višine je pri DEKA
  //     AVTENTIČNO rebro površine KLASIK deske (uradna lestvica ga
  //     prikazuje — rebra tečejo vzdolž deske; pri KUBO jih ni, zato
  //     je KUBO preverba strožja). Pravi šiv zrcaljenja/ozadja bi bil
  //     IZOLIRAN (enojen, neperiodičen) — rebra pa so na deski
  //     ENAKOMERNO razmaknjena. Preverba: če je črt > 2, morajo biti
  //     razmiki med njimi periodični (≥ 80 % znotraj ±25 % mediane,
  //     mediana ≥ 12 px).
  let fullDarkLines = 0;
  const darkCols: number[] = [];
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
    if (darkRows > OH * 0.7) { fullDarkLines++; darkCols.push(x); }
  }
  if (fullDarkLines > 2) {
    // sosednje zastavljene stolpce združi v SOGE (razmak ≤ 3 px), soge v
    // GROZDE (razmak med sogami ≤ 24 px = ENA fuga/utore — fuga na
    // uradni lestvici ima dva temna robova), grozdi pa so na deski
    // ENAKOMERNO razmaknjeni (pitch reber)
    const bands: [number, number][] = [];
    for (const x of darkCols) {
      const last = bands[bands.length - 1];
      if (last && x - last[1] <= 3) last[1] = x;
      else bands.push([x, x]);
    }
    const clusters: [number, number][] = [];
    for (const [a, b] of bands) {
      const last = clusters[clusters.length - 1];
      if (last && a - last[1] <= 24) last[1] = b;
      else clusters.push([a, b]);
    }
    const widths = clusters.map(([a, b]) => b - a + 1);
    const centers = clusters.map(([a, b]) => (a + b) / 2);
    const spac: number[] = [];
    for (let i = 1; i < centers.length; i++) spac.push(centers[i] - centers[i - 1]);
    const sorted = [...spac].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const okPeriod = med >= 12
      && spac.filter((s) => Math.abs(s - med) <= med * 0.25).length >= spac.length * 0.8
      && widths.every((w) => w <= 24);
    if (!okPeriod) throw new Error(`dekor ${k + 1}: ${fullDarkLines} temnih črt / ${clusters.length} grozdov z NEperiodičnimi razmiki (sirine ${widths.join(',')}, razmiki ${spac.map((s) => Math.round(s)).join(',')}) — sum šiva, ne reber.`);
    console.log(`  rebra: ${clusters.length} fug (grozdi), sirine ${widths.join('/')}, pitch ~${med.toFixed(0)} px (periodična — avtentična površina)`);
  }
  const [ex2, ey2] = await grainEnergies(await sharp(out).png().toBuffer());
  // povprečna barva (za PROFILE_COLOR_ID + teste)
  let R = 0, G = 0, B = 0;
  const n = OW * OH;
  for (let i = 0; i < n; i++) { R += od[i * OC]; G += od[i * OC + 1]; B += od[i * OC + 2]; }
  R = Math.round(R / n); G = Math.round(G / n); B = Math.round(B / n);
  averages.push(`dekor-${k + 1}: RGB(${R},${G},${B})`);
  console.log(`dekor ${k + 1}: ${out} — skoraj-črnih pikslov ${nearBlack}, temnih črt ${fullDarkLines}${fullDarkLines > 2 ? ' (periodična rebra — avtentična površina)' : ''}, žira |dx|=${ex2.toFixed(0)} vs |dy|=${ey2.toFixed(0)}, simetrija lev/des ${symX.toFixed(1)} zgornj/spod ${symY.toFixed(1)} (mora biti ≥ 6), povprečje RGB(${R},${G},${B})`);
  if (nearBlack > 0) throw new Error(`dekor ${k + 1}: ${nearBlack} skoraj-črnih pikslov — črno ozadje lestvice je zašlo v izrez.`);
  if (ex2 <= ey2) throw new Error(`dekor ${k + 1}: žira v zapisani datoteki NI navpična.`);
}

function lum2(d: Buffer, i: number, _c: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

console.log('V REDU — 7 DEKA dekorjev iz uradne lestvice: 256×256 enojni ne-zrcaljen izrez, brez črnega ozadja, navpična žira (konvencija rendererja), rebra preverjena kot periodična (avtentična površina).');
console.log('POVPREČJA za PROFILE_COLOR_ID:');
averages.forEach((a) => console.log('  ' + a));
