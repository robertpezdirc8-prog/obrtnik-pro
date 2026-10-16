// Verifikacija stopničnega profila (bun + sharp): sintetične stopnice
// (frontalni + stranski pogled) + realna fotka public/crafts/stopnice.jpg.
// Zagon: bun tests/verify/stair-profile.ts
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Prehodna izhodna mapa: "/tmp" je bil pot v razvojnem kontejnerju, na Windows
// bi pomenila C:\tmp in skript bi padel zaradi okolja, ne zaradi logike.
const VERIFY_OUT = join(tmpdir(), 'obrtnik-pro-verify');
mkdirSync(VERIFY_OUT, { recursive: true });
const TMP = (name: string) => join(VERIFY_OUT, name);
import { analyzeStairProfile, type RgbaImage, type PctPoint } from '../../src/lib/stair-profile';

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// ── 1. Sintetične stopnice, frontalni pogled ────────────────
// 8 nosilcev, vsak 40 px višine (pitch 40), slika 640×520.
{
  const W = 640, H = 520;
  const buf = Buffer.alloc(W * H * 3, 235);
  const risers = 8, pitch = 40, topY = 80;
  for (let i = 0; i < risers; i++) {
    const y = topY + i * pitch;
    // temna nosilčna linija (4 px) + svetlejši ploski pas pod njo
    for (let dy = 0; dy < 4; dy++) {
      for (let x = Math.round(W * 0.1); x < Math.round(W * 0.9); x++) {
        const idx = ((y + dy) * W + x) * 3;
        buf[idx] = 60; buf[idx + 1] = 60; buf[idx + 2] = 60;
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t26-front.png'));
  const img = await loadRgba(TMP('t26-front.png'));
  const r = analyzeStairProfile({ img, mode: 'front' });
  console.log('frontalni (sintetika, 8 stopnic):');
  check('prešteje 8 stopnic', r.ok && r.steps === 8, `got ${r.steps}`);
  check('pitch ≈ 40 px', Math.abs(r.pitchPx - 40) <= 3, `got ${r.pitchPx.toFixed(1)}`);
  check('risePx ≈ 280', r.risePx !== null && Math.abs(r.risePx - 280) <= 6, `got ${r.risePx}`);
  check('brez kalibracije = samo števec + opozorilo', r.pxPerCm === null && r.warnings.some((w) => w.includes('kalibracij')));
  // kalibracija z znano višinsko razliko 160 cm → riser = 160/8 = 20 cm
  const r2 = analyzeStairProfile({ img, mode: 'front', knownRiseCm: 160 });
  check('known-rise 160 cm → riser 20 cm', r2.riserCm !== null && Math.abs(r2.riserCm - 20) < 0.6, `got ${r2.riserCm}`);
  check('known-rise → Blondel going ≈ 23→oameženo 25', r2.goingCm !== null && r2.goingCm >= 25 && r2.goingCm <= 32, `got ${r2.goingCm}`);
  check('kalib vir = known-rise', r2.calibSource === 'known-rise');
}

// ── 2. Sintetične stopnice, stranski pogled ─────────────────
// Stopničasta polilinja: 10 riserjev po 30 px dviga in 40 px teka.
{
  const W = 720, H = 480;
  const buf = Buffer.alloc(W * H * 3, 240);
  const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const idx = ((y + dy) * W + (x + dx)) * 3;
        if (idx < buf.length - 3) { buf[idx] = 40; buf[idx + 1] = 40; buf[idx + 2] = 40; }
      }
    }
  };
  let x = 60, y = 80;
  const riser = 30, going = 40, N = 10;
  for (let i = 0; i < N; i++) {
    drawLine(x, y, x, y + riser);      // riser (navpična)
    drawLine(x, y + riser, x + going, y + riser); // tread (vodoravna)
    x += going; y += riser;
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(TMP('t26-side.png'));
  const img = await loadRgba(TMP('t26-side.png'));
  // linija skozi notranjost stopničaste diagonale (vrh zgornji nosilec → dno)
  const line: [PctPoint, PctPoint] = [
    { x: (60 / W) * 100, y: (80 / H) * 100 },
    { x: ((60 + N * going) / W) * 100, y: ((80 + N * riser) / H) * 100 },
  ];
  const pxPerCm = 2; // 2 px = 1 cm (sintetično znanje)
  const r = analyzeStairProfile({ img, mode: 'side', line, pxPerCm });
  console.log('stranski (sintetika, 10 stopnic, kalibracija 2 px/cm):');
  check('prešteje 9–11 stopnic', r.ok && r.steps >= 9 && r.steps <= 11, `got ${r.steps}`);
  check('totalRise ≈ 150 cm (300 px / 2)', r.totalRiseCm !== null && Math.abs(r.totalRiseCm - 150) <= 8, `got ${r.totalRiseCm}`);
  check('going ≈ 20±4 cm', r.goingCm !== null && Math.abs(r.goingCm - 20) <= 4, `got ${r.goingCm}`);
  check('railing ≈ hypot(400,300)/2 = 250 cm', r.railingLengthCm !== null && Math.abs(r.railingLengthCm - 250) <= 12, `got ${r.railingLengthCm}`);
  check('naklon ≈ 36,9°', r.slopeDeg !== null && Math.abs(r.slopeDeg - 36.87) < 4, `got ${r.slopeDeg}`);
  check('komfort izračunan (going izmerjen)', r.comfort !== null && !r.comfort.goingEstimated);
}

// ── 3. Realna fotka: public/crafts/stopnice.jpg ─────────────
{
  const img = await loadRgba('public/crafts/stopnice.jpg');
  const r = analyzeStairProfile({ img, mode: 'front' });
  console.log('realna stopnice.jpg (frontalni):');
  check('najde 3–24 linij', r.ok && r.steps >= 3 && r.steps <= 24, `got ${r.steps}`);
  check('konsistenca pitch (CV < 0,6)', r.pitchCv < 0.6, `got ${r.pitchCv.toFixed(2)}`);
  console.log(`    steps=${r.steps} pitchPx=${r.pitchPx.toFixed(1)} amp=${r.amplitude.toFixed(2)} cv=${r.pitchCv.toFixed(2)} conf=${r.confidence} (${r.verdict})`);
  console.log(`    peaks y% = ${r.peaksPct.map((p) => p.y.toFixed(0)).join(', ')}`);
}

console.log(`\nRezultat: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
