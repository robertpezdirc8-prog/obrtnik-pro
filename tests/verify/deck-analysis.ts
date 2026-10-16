// Verifikacija analize WPC desk (bun + sharp): sintetične terase (ravno,
// diagonalno, vertikalno, šum) + površina iz 4 oglišč.
// Zagon: bun tests/verify/deck-analysis.ts
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Prehodna izhodna mapa: "/tmp" je bil pot v razvojnem kontejnerju, na Windows
// bi pomenila C:\tmp in skript bi padel zaradi okolja, ne zaradi logike.
const VERIFY_OUT = join(tmpdir(), 'obrtnik-pro-verify');
mkdirSync(VERIFY_OUT, { recursive: true });
const TMP = (name: string) => join(VERIFY_OUT, name);
import {
  analyzeDeck, deckQuadArea, snapBoard, STANDARD_BOARD_CM,
  type RgbaImage,
} from '../../src/lib/deck-analysis';

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// determinističen PRNG (LCG) za šum
const rng = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

// ── sintetična terasa: deske 140 mm + reža 5 mm, pxPerCm 8 → pitch 116 px ──
const PX_PER_CM = 8;
const PITCH = 116;   // 14,5 cm (deska 14 + reža 0,5)
const GAP = 4;       // 0,5 cm

interface Opts { angleDeg?: number; noise?: number; boardToneVar?: number }
function makeDeck(W: number, H: number, opts: Opts = {}): Buffer {
  const { angleDeg = 0, noise = 0, boardToneVar = 10 } = opts;
  const buf = Buffer.alloc(W * H * 3);
  const th = (angleDeg * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x * ct + y * st;                 // koordinata pravokotno na deske
      const m = ((u % PITCH) + PITCH) % PITCH;
      const inGap = m < GAP;
      // tone vrste (vsaka vrsta svoj odtenek) + dolga vlakna vzdolž desk
      const row = Math.floor(u / PITCH);
      const boardTone = 150 + 96 * Math.sin(row * 12.9898) * 0.5 + (rng() - 0.5) * boardToneVar;
      const streak = Math.sin(x * 0.13 + row * 7.7) * 6 + Math.sin(x * 0.041 + row * 3.1) * 4;
      let v = inGap ? 62 + (rng() - 0.5) * 8 : Math.max(40, Math.min(230, boardTone + streak + (noise > 0 ? (rng() - 0.5) * 2 * noise : 0)));
      const idx = (y * W + x) * 3;
      buf[idx] = Math.round(v * 1.04 + 8);
      buf[idx + 1] = Math.round(v);
      buf[idx + 2] = Math.round(v * 0.82);
    }
  }
  return buf;
}

// ── 1. Ravna terasa (deske vodoravne → reže horizontalne → normala 90°) ──
{
  const W = 800, H = 600;
  await sharp(makeDeck(W, H, { angleDeg: 90 }), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-flat.png'));
  const img = await loadRgba(TMP('t29-flat.png'));
  const r = analyzeDeck({ img, pxPerCm: PX_PER_CM });
  console.log('ravna terasa (sintetika, deske 140 + reža 5):');
  check('zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('smer desk ≈ 0° (vodoravno)', r.boardAngleDeg <= 12 || r.boardAngleDeg >= 168, `got ${r.boardAngleDeg}`);
  check('pitch ≈ 116 px', r.pitchPx !== null && Math.abs(r.pitchPx - PITCH) <= 6, `got ${r.pitchPx}`);
  check('reža ≈ 4 px (2–9)', r.gapPx !== null && r.gapPx >= 2 && r.gapPx <= 9, `got ${r.gapPx}`);
  check('deska ≈ 14 cm (13–15,2)', r.boardCm !== null && r.boardCm >= 13 && r.boardCm <= 15.2, `got ${r.boardCm}`);
  check('snap = 14', r.snapBoard === 14, `got ${r.snapBoard}`);
  check('reža ≈ 0,5 cm (0,2–1,2)', r.gapCm !== null && r.gapCm >= 0.2 && r.gapCm <= 1.2, `got ${r.gapCm}`);
  check('ni diagonalno', !r.diagonal, `got ${r.diagonal}`);
  check('nosilci: predlog 0,4 m', r.joistSpacingSuggestM === 0.4, `got ${r.joistSpacingSuggestM}`);
  check('anotacije rež (≥ 3, ≤ 24)', r.lines.length >= 3 && r.lines.length <= 24, `lines=${r.lines.length}`);
  check('anotacije znotraj slike', r.lines.every((l) => [l.x1, l.x2].every((v) => v >= 0 && v <= 100) && [l.y1, l.y2].every((v) => v >= 0 && v <= 100)));
  check('zanesljivost ≥ 70', r.confidence >= 70, `got ${r.confidence}`);
}

// ── 2. Diagonalna terasa 45° ───────────────────────────────
{
  const W = 640, H = 640;
  await sharp(makeDeck(W, H, { angleDeg: 45 }), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-diag.png'));
  const img = await loadRgba(TMP('t29-diag.png'));
  const r = analyzeDeck({ img, pxPerCm: PX_PER_CM });
  console.log('diagonalna terasa (45°):');
  check('zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('smer desk ≈ 45° (33–57 ali 123–147)', (r.boardAngleDeg >= 33 && r.boardAngleDeg <= 57) || (r.boardAngleDeg >= 123 && r.boardAngleDeg <= 147), `got ${r.boardAngleDeg}`);
  check('diagonalno', r.diagonal, `got ${r.diagonal}`);
  check('nosilci: predlog 0,3 m', r.joistSpacingSuggestM === 0.3, `got ${r.joistSpacingSuggestM}`);
  check('deska ≈ 14 cm (12,8–15,4)', r.boardCm !== null && r.boardCm >= 12.8 && r.boardCm <= 15.4, `got ${r.boardCm}`);
}

// ── 3. Vertikalne deske (reže vertikalne → normala 0°) ─────
{
  const W = 600, H = 800;
  await sharp(makeDeck(W, H, { angleDeg: 0 }), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-vert.png'));
  const img = await loadRgba(TMP('t29-vert.png'));
  const r = analyzeDeck({ img, pxPerCm: PX_PER_CM });
  console.log('vertikalne deske:');
  check('zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('smer desk ≈ 90° (78–102)', r.boardAngleDeg >= 78 && r.boardAngleDeg <= 102, `got ${r.boardAngleDeg}`);
  check('ni diagonalno (mod 90 = 0)', !r.diagonal, `got ${r.diagonal}`);
}

// ── 4. Kalibracija po znani deski (brez reference) ─────────
{
  const W = 800, H = 600;
  await sharp(makeDeck(W, H), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-known.png'));
  const img = await loadRgba(TMP('t29-known.png'));
  const r = analyzeDeck({ img, knownBoardCm: 14 });
  console.log('kalibracija po znani deski (14 cm):');
  check('zaznana', r.ok);
  check('vir = known-board', r.calibSource === 'known-board', `got ${r.calibSource}`);
  // pitchCm = 14/(1 − 4/116) = 14,5 → pxPerCm = 116/14,5 = 8
  check('pxPerCm ≈ 8 (7,4–8,6)', r.pxPerCm !== null && r.pxPerCm >= 7.4 && r.pxPerCm <= 8.6, `got ${r.pxPerCm}`);
  check('deska ≈ 14 cm', r.boardCm !== null && Math.abs(r.boardCm - 14) <= 0.8, `got ${r.boardCm}`);
  check('snap = 14', r.snapBoard === 14, `got ${r.snapBoard}`);
}

// ── 5. Brez kalibracije ────────────────────────────────────
{
  const W = 800, H = 600;
  await sharp(makeDeck(W, H), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-nocal.png'));
  const img = await loadRgba(TMP('t29-nocal.png'));
  const r = analyzeDeck({ img });
  console.log('brez kalibracije:');
  check('zaznana (smer/razmerja)', r.ok);
  check('vir = none', r.calibSource === 'none');
  check('deska null', r.boardCm === null, `got ${r.boardCm}`);
  check('opozorilo o kalibraciji', r.warnings.some((w) => w.includes('kalibracij')), r.warnings.join('; '));
  check('diagonalnost še vedno določena', r.diagonal === false);
}

// ── 6. Šum (±14) ───────────────────────────────────────────
{
  const W = 800, H = 600;
  await sharp(makeDeck(W, H, { noise: 14 }), { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t29-noise.png'));
  const img = await loadRgba(TMP('t29-noise.png'));
  const r = analyzeDeck({ img, pxPerCm: PX_PER_CM });
  console.log('šum ±14:');
  check('zaznana kljub šumu', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('pitch ≈ 116 (108–124)', r.pitchPx !== null && r.pitchPx >= 108 && r.pitchPx <= 124, `got ${r.pitchPx}`);
  check('snap še vedno 14', r.snapBoard === 14, `got ${r.snapBoard}`);
}

// ── 7. Premajhna slika → ok=false ──────────────────────────
{
  const img: RgbaImage = { width: 60, height: 60, data: new Uint8ClampedArray(60 * 60 * 4).fill(200) };
  const r = analyzeDeck({ img, pxPerCm: PX_PER_CM });
  console.log('premajhna slika:');
  check('ok=false', !r.ok);
  check('opozorilo', r.warnings.length > 0);
}

// ── 8. Snap enote ──────────────────────────────────────────
{
  console.log('snapBoard enote:');
  check('13,5 → 13,5', snapBoard(13.5) === 13.5);
  check('14,3 → 14,5 (bližje)', snapBoard(14.3) === 14.5, `got ${snapBoard(14.3)}`);
  check('15,8 → 16 (1,25 %)', snapBoard(15.8) === 16);
  check('17 → 16 (6,25 %)', snapBoard(17) === 16, `got ${snapBoard(17)}`);
  check('17,8 → null (izven 8 %)', snapBoard(17.8) === null, `got ${snapBoard(17.8)}`);
  check('0 → null', snapBoard(0) === null);
  check('−3 → null', snapBoard(-3) === null);
  check('standardi vsebujejo 14', STANDARD_BOARD_CM.includes(14));
}

// ── 9. Površina iz 4 oglišč ────────────────────────────────
{
  console.log('deckQuadArea:');
  // pravokotnik 80×60 cm @ 8 px/cm = 640×480 px na sliki 800×600
  const q = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
  const r = deckQuadArea(q, PX_PER_CM, { w: 800, h: 600 });
  check('ok', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('dolžina ≈ 80 cm', r.lengthCm !== null && Math.abs(r.lengthCm - 80) <= 1.5, `got ${r.lengthCm}`);
  check('širina ≈ 60 cm', r.widthCm !== null && Math.abs(r.widthCm - 60) <= 1.5, `got ${r.widthCm}`);
  check('površina ≈ 0,48 m²', r.areaM2 !== null && Math.abs(r.areaM2 - 0.48) <= 0.02, `got ${r.areaM2}`);
  check('4 stranice', r.sidesCm.length === 4);

  // zasukana oglisča (pentlja) → orderQuad uredi
  const q2 = [{ x: 10, y: 10 }, { x: 10, y: 90 }, { x: 90, y: 90 }, { x: 90, y: 10 }];
  const r2 = deckQuadArea(q2, PX_PER_CM, { w: 800, h: 600 });
  check('pentlja → ista površina', r2.ok && r2.areaM2 !== null && Math.abs(r2.areaM2 - 0.48) <= 0.02, `got ${r2.areaM2}`);

  // brez kalibracije → mere null + opozorilo
  const r3 = deckQuadArea(q, null, { w: 800, h: 600 });
  check('brez kalibracije → ok=false + opozorilo', !r3.ok && r3.warnings.length > 0);

  // degeneriran (vse točke isti vogal) → zavrnjen
  const r4 = deckQuadArea([{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }, { x: 10, y: 11 }], PX_PER_CM, { w: 800, h: 600 });
  check('degeneriran → ok=false', !r4.ok);

  // napačno št. oglisč
  const r5 = deckQuadArea([{ x: 10, y: 10 }, { x: 90, y: 90 }], PX_PER_CM, { w: 800, h: 600 });
  check('2 oglisči → ok=false', !r5.ok);

  // oglisče izven slike (zastarel rect / scroll) → zavrnjeno
  const r6 = deckQuadArea([{ x: 10, y: 10 }, { x: 90, y: 6 }, { x: 90, y: 108.6 }, { x: 10, y: 108.6 }], PX_PER_CM, { w: 800, h: 600 });
  check('oglisče na 108 % → ok=false + opozorilo', !r6.ok && r6.warnings.some((w) => w.includes('izven slike')), JSON.stringify(r6.warnings));
}

console.log(`\nRezultat: ${pass} OK / ${fail} FAIL`);
if (fail > 0) process.exit(1);
