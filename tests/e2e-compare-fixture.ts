// ─── Generator sintetičnih E2E podatkov za izvoz pred/po (Task 65) ─────────
// Določi deterministično sintetično fotko „stare ograje" (1280×890, rjave deske
// na nebu/tleh) + ista fotka s „ novo ograjo" (terakota deske) v istem kvadrantu
// (10–90 % × 20–80 % — isti kvadrant kot v verify fixture) in sestavi DVE
// shranjeni različici (localStorage zapis, enak FormatRec kot foto-replace.tsx):
//   v1: polna-100 z OVERJENO teksturo → izvoz dovoljen
//   v2: polna-100 brez teksture (texture: null) → izvoz BLOKIRAN (iskrenost)
// OBJE so sintetične fixture ( jasno dokumentirano) — dokazujeta MEHANIZEM izvoza
// (levo = pravi PRED piksli, desno = pravi PO piksli, žig), ne upodobitvene
// kakovosti (tisto pokrijejo photo-replace verify 391 preverb + E2E e2e-final).
// Izhod: /tmp/e2e-compare-before.b64 (PNG base64 za brskalnik), /tmp/e2e-compare-versions.json,
//        /tmp/e2e-compare-ref.json (pričakovane povprečne barve za nadaljnjo preverbo)
// Zagon: bun tests/e2e-compare-fixture.ts
import sharp from 'sharp';
import * as __vfyFs from 'node:fs';
import * as __vfyOs from 'node:os';
import * as __vfyPath from 'node:path';
// Izhodna mapa je odvedena iz os.tmpdir(): '/tmp' je veljala samo v razvojnem
// kontejnerju, na Windows bi pomenila C:\tmp in script bi padel zaradi okolja.
// Uvozi so prostorno poimenovani, da ne morejo zadniti obstojecega uvoza istih
// imen (tri od teh datotek ze uvozijo 'join' iz node:path).
const __vfyOutDir = __vfyPath.join(__vfyOs.tmpdir(), 'obrtnik-pro-e2e');
__vfyFs.mkdirSync(__vfyOutDir, { recursive: true });
const TMP = (name: string) => __vfyPath.join(__vfyOutDir, name);
import { buildReplaceMetadata, computePlankLayouts, createMask } from '../src/lib/photo-replace-core';

const W = 1280;
const H = 890;
const CREATED_AT = '2026-10-16T09:00:00.000Z';

const inQuad = (x: number, y: number): boolean => x >= 128 && x < 1152 && y >= 178 && y < 712;

function basePixel(x: number, y: number): [number, number, number] {
  if (y < 400) return [205 - Math.floor(y * 0.04), 215, 226]; // nebo
  return [152, 141, 104]; // tla
}
function oldPixel(x: number, y: number): [number, number, number] {
  if (inQuad(x, y)) {
    const m = x % 72;
    if (m < 62) {
      const edge = Math.min(m, 62 - m);
      const d = edge < 4 ? -22 : 0;
      return [139 + d, 90 + d, 43 + d]; // rjava deska
    }
    return [95, 63, 30]; // reža
  }
  return basePixel(x, y);
}
function newPixel(x: number, y: number): [number, number, number] {
  if (inQuad(x, y)) {
    const m = x % 72;
    if (m < 62) {
      const edge = Math.min(m, 62 - m);
      const d = edge < 4 ? -20 : 0;
      return [196 + d, 128 + d, 88 + d]; // terakota „nova" deska
    }
    return [150, 100, 70];
  }
  return basePixel(x, y);
}

const renderRaw = (px: (x: number, y: number) => [number, number, number]): Buffer => {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * W + x) * 3;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
    }
  }
  return buf;
};

const oldBuf = renderRaw(oldPixel);
const newBuf = renderRaw(newPixel);

// PRED: PNG (za nalaganje skozi realni processImage pipeline v brskalniku)
const beforePng = await sharp(oldBuf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
await __vfyFs.promises.writeFile(TMP('e2e-compare-before.b64'), beforePng.toString('base64'));

// PO: JPEG 0,92 (enako kot app: comp.toDataURL('image/jpeg', 0.92)) → dataUrl
const afterJpeg = await sharp(newBuf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer(); // ≈ canvas toDataURL('image/jpeg', 0.92)
const afterDataUrl = `data:image/jpeg;base64,${afterJpeg.toString('base64')}`;

// povprečja kvadranta (za kasnejšo preverbo izvoza) — iz RAW (brez stiskanja)
const avgOf = (buf: Buffer, pred: (x: number, y: number) => boolean): [number, number, number] => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!pred(x, y)) continue;
      const i = (y * W + x) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
};
const oldQuadAvg = avgOf(oldBuf, inQuad);
const newQuadAvg = avgOf(newBuf, inQuad);
console.log(`star kvadrant avg: ${oldQuadAvg.join(',')} | nov kvadrant avg: ${newQuadAvg.join(',')}`);

// metapodatki (isti vzorec kot tests/verify/photo-compare.ts) — pravi profil iz registra
const planeCm = { wCm: 200, hCm: 95 };
const layout = computePlankLayouts({
  quadPct: [[10, 20], [90, 20], [90, 80], [10, 80]],
  imgSize: { w: W, h: H },
  planeCm, plankCm: 10, gapCm: 2, orientation: 'vertical', postCm: 6, postEveryCm: null,
});
const metaBase = {
  profileId: 'polna-100',
  profileLabel: 'ROKSAL polna deska 100 (pokončno) — dekor 1/8 uradne lestvice',
  catalogSku: null,
  planeCm,
  params: {
    pattern: 'vertikalne',
    elementCm: 10,
    spacingCm: 2,
    quadWidthCm: 200,
    postEveryCm: 'null',
    materialHonesty: 'ROKSAL original (neoverjena zaslonska reprodukcija)',
  },
  mask: createMask(W, H),
  layout,
  imgSize: { w: W, h: H },
  inpaint: 'ok' as const,
  warnings: [],
  createdAt: CREATED_AT,
};
const metaOk = buildReplaceMetadata({
  ...metaBase,
  texture: { id: 'tex-roksal-polna100-dekor-1', src: '/roksal/ograje/polna-100/dekor-1.png', origin: 'roksal-original', verification: 'verified', realCm: 45 },
});
const metaBrezTeksture = buildReplaceMetadata({ ...metaBase, texture: null });

const aux = { factor: 0.9, samples: 100, topAlpha: 0.2, bottomAlpha: 0.25, warnings: [], scaleTop: 0.156, scaleBottom: 0.213 };
const versions = [
  { id: 'e2e-compare-1', createdAt: CREATED_AT, profileLabel: metaOk.profileLabel, meta: metaOk, aux, dataUrl: afterDataUrl },
  { id: 'e2e-compare-2', createdAt: CREATED_AT, profileLabel: metaBrezTeksture.profileLabel, meta: metaBrezTeksture, aux, dataUrl: afterDataUrl },
];
await __vfyFs.promises.writeFile(TMP('e2e-compare-versions.json'), JSON.stringify(versions));
await __vfyFs.promises.writeFile(TMP('e2e-compare-ref.json'), JSON.stringify({ oldQuadAvg, newQuadAvg, W, H, created: CREATED_AT }));
console.log(`fixture zapisan: ${versions.length} različici (v1 overjena → izvoz, v2 brez teksture → blokada), PNG ${(beforePng.length / 1024).toFixed(0)} KB, JSON ${(JSON.stringify(versions).length / 1024).toFixed(0)} KB`);
