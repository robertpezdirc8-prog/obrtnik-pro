// ─── Generator: public/textures/ral-7016.png ─────────────────
// Raven barvni vzorec RAL 7016 (antracitno siva) — RGB(56, 62, 66),
// najbolj razširjena javno objavljena sRGB pretvorba (Wikipedija
// »List of RAL colours«: RGB 56/62/66; enaka vrednost kot riše
// viz.ts 'ral-7016'). RAL ne objavlja uradne sRGB pretvorbe —
// objavljene vrednosti nekoliko variirajo (npr. ralcolorchart.com
// objavi #3B4044); izbrana je vrednost, ki jo DEJANSKO riše
// vizualizator, da register dokumentira resnično upodobljeno barvo.
//
// 0 AI, 0 odvisnosti: PNG je ročno kodiran (IHDR/IDAT/IEND,
// node:zlib deflate) — deterministično, enak zagon → enak bajt.
// Uporaba: bun run tests/make-ral-swatch.ts

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 256;
const H = 256;
const R = 56;
const G = 62;
const B = 66; // RAL 7016 — glej opombo zgoraj

// ── CRC-32 (IEEE 802.3, tabela, standard PNG) ────────────────
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(out.buffer, 4, 4 + data.length);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

// ── Surovi podatki: vrstični filter 0 + RGB (8 bit/kanal) ────
const stride = 1 + W * 3;
const raw = new Uint8Array(H * stride);
for (let y = 0; y < H; y++) {
  const off = y * stride;
  raw[off] = 0; // filter: None (ravna barva — brez predikcije)
  for (let x = 0; x < W; x++) {
    const i = off + 1 + x * 3;
    raw[i] = R;
    raw[i + 1] = G;
    raw[i + 2] = B;
  }
}

const idat = deflateSync(raw, { level: 9 });

const ihdr = new Uint8Array(13);
const dv = new DataView(ihdr.buffer);
dv.setUint32(0, W);
dv.setUint32(4, H);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor (RGB)
// [10] compression 0, [11] filter 0, [12] interlace 0

const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = new Uint8Array(
  sig.length + (12 + 13) + (12 + idat.length) + 12,
);
let p = 0;
for (const part of [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]) {
  png.set(part, p);
  p += part.length;
}

const dest = join(process.cwd(), 'public', 'textures', 'ral-7016.png');
writeFileSync(dest, png);
console.log(`OK: ${dest} (${png.length} bajtov, ${W}×${H}, RGB ${R}/${G}/${B} = #${[R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('')})`);
