// Verifikacija keramične mreže (bun + sharp): sintetične mreže ploščic
// (stack, running bond, diagonalno, ribja kost) + realna fotka keramike.
// Zagon: bun tests/verify/tile-grid.ts
import sharp from 'sharp';
import { analyzeTileGrid, snapTile, type RgbaImage } from '../../src/lib/tile-grid';

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const PX_PER_CM = 2; // sintetična kalibracija
const PITCH = 120;   // 60 cm ploščica @ 2 px/cm
const GROUT = 4;

// ── 1. Stack bond: ravno, zvezne fuge, 60×60 ────────────────
{
  const W = 640, H = 640;
  const buf = Buffer.alloc(W * H * 3, 220);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x % PITCH < GROUT || y % PITCH < GROUT) {
        const idx = (y * W + x) * 3;
        buf[idx] = 70; buf[idx + 1] = 70; buf[idx + 2] = 70;
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile('/tmp/t27-stack.png');
  const img = await loadRgba('/tmp/t27-stack.png');
  const r = analyzeTileGrid({ img, pxPerCm: PX_PER_CM });
  console.log('stack bond (sintetika, 60×60):');
  check('mreža zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('vzorec = ravno', r.pattern === 'ravno', `got ${r.pattern}`);
  check('kot ≈ 0', r.angleDeg <= 12, `got ${r.angleDeg}`);
  check('pitch1 ≈ 120 px', r.pitchPx1 !== null && Math.abs(r.pitchPx1 - PITCH) <= 6, `got ${r.pitchPx1}`);
  check('ploščica ≈ 60 cm', r.tileWCm !== null && Math.abs(r.tileWCm - 60) <= 3, `got ${r.tileWCm}`);
  check('snap = 60', r.snapW === 60, `got ${r.snapW}`);
  check('odpadek 10 %', r.wastePercent === 10);
  check('zveznost obe visoki', (r.continuity ?? 0) > 0.72 && (r.continuityH ?? 0) > 0.72, `got ${r.continuity}/${r.continuityH}`);
  check('anotacije: črte obeh smeri', r.lines.some((l) => l.dir === 1) && r.lines.some((l) => l.dir === 2), `lines=${r.lines.length}`);
}

// ── 2. Running bond: prekinjene vertikalne fuge ─────────────
{
  const W = 640, H = 640;
  const buf = Buffer.alloc(W * H * 3, 220);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / PITCH);
    const offset = row % 2 === 1 ? PITCH / 2 : 0;
    for (let x = 0; x < W; x++) {
      if (y % PITCH < GROUT || (x + offset) % PITCH < GROUT) {
        const idx = (y * W + x) * 3;
        buf[idx] = 70; buf[idx + 1] = 70; buf[idx + 2] = 70;
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile('/tmp/t27-running.png');
  const img = await loadRgba('/tmp/t27-running.png');
  const r = analyzeTileGrid({ img, pxPerCm: PX_PER_CM });
  console.log('running bond (sintetika, 60×60):');
  check('mreža zaznana', r.ok);
  check('vzorec = ravno (running bond NE je ribja kost)', r.pattern === 'ravno', `got ${r.pattern}`);
  check('korekcija: ploščica ≈ 60 (ne 30)', r.tileWCm !== null && Math.abs(r.tileWCm - 60) <= 4, `got ${r.tileWCm}`);
  check('snap = 60', r.snapW === 60, `got ${r.snapW}`);
  check('opozorilo o prekinjenih fugah', r.warnings.some((w) => w.includes('prekinjene')), r.warnings.join('; '));
}

// ── 3. Diagonalno: mreža zasukana 45° ───────────────────────
{
  const W = 640, H = 640;
  const buf = Buffer.alloc(W * H * 3, 220);
  const S = Math.SQRT1_2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u1 = (x + y) * S;    // normala 45 → fuge pod 135
      const u2 = (y - x) * S;    // normala 135 → fuge pod 45
      const m1 = Math.abs(u1 % PITCH); const d1 = Math.min(m1, PITCH - m1);
      const m2 = Math.abs(u2 % PITCH); const d2 = Math.min(m2, PITCH - m2);
      if (d1 < GROUT || d2 < GROUT) {
        const idx = (y * W + x) * 3;
        buf[idx] = 70; buf[idx + 1] = 70; buf[idx + 2] = 70;
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile('/tmp/t27-diag.png');
  const img = await loadRgba('/tmp/t27-diag.png');
  const r = analyzeTileGrid({ img, pxPerCm: PX_PER_CM });
  console.log('diagonalno (sintetika, 45°):');
  check('mreža zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('vzorec = diagonalno', r.pattern === 'diagonalno', `got ${r.pattern}`);
  check('kot ≈ 45 (33–57)', r.angleDeg >= 33 && r.angleDeg <= 57, `got ${r.angleDeg}`);
  check('pitch ≈ 120 px', r.pitchPx1 !== null && Math.abs(r.pitchPx1 - PITCH) <= 8, `got ${r.pitchPx1}`);
  check('odpadek 15 %', r.wastePercent === 15, `got ${r.wastePercent}`);
}

// ── 4. Ribja kost (herringbone): fuge 0/90, obe prekinjeni ──
{
  const W = 680, H = 680;
  const buf = Buffer.alloc(W * H * 3, 70); // ozadje = fuga
  const Ht = 40, Wt = 80; // ploščica 2:1 (px) → 40×20 cm @ 2px/cm
  // enote: P(i,j) = (x0 + i*Ht + j*3Ht, y0 − i*Ht + j*Ht); h(px,py) 2H×H + v(px+2H,py) H×2H
  const x0 = 60, y0 = 200;
  const fillRect = (rx0: number, ry0: number, rw: number, rh: number) => {
    for (let y = Math.max(0, ry0); y < Math.min(H, ry0 + rh); y++) {
      for (let x = Math.max(0, rx0); x < Math.min(W, rx0 + rw); x++) {
        const idx = (y * W + x) * 3;
        buf[idx] = 220; buf[idx + 1] = 220; buf[idx + 2] = 220;
      }
    }
  };
  for (let j = -14; j <= 14; j++) {
    for (let i = -40; i <= 40; i++) {
      const px = x0 + i * Ht + j * 3 * Ht;
      const py = y0 - i * Ht + j * Ht;
      const g = GROUT;
      fillRect(px + g, py + g, 2 * Ht - 2 * g, Ht - 2 * g);           // horizontalna
      fillRect(px + 2 * Ht + g, py + g, Ht - 2 * g, 2 * Ht - 2 * g);  // navpična
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile('/tmp/t27-herr.png');
  const img = await loadRgba('/tmp/t27-herr.png');
  const r = analyzeTileGrid({ img, pxPerCm: PX_PER_CM });
  console.log('ribja kost (sintetika, 2:1):');
  check('mreža zaznana', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('vzorec = ribja-kost', r.pattern === 'ribja-kost', `got ${r.pattern} (c=${r.continuity}/${r.continuityH})`);
  check('fuge 0/90 → kot ≈ 0', r.angleDeg <= 12, `got ${r.angleDeg}`);
  check('dolžina ploščice ≈ 40 cm (2× korak)', r.tileWCm !== null && r.tileWCm >= 34 && r.tileWCm <= 46, `got ${r.tileWCm}`);
  check('višina ploščice ≈ 20 cm', r.tileHCm !== null && r.tileHCm >= 16 && r.tileHCm <= 24, `got ${r.tileHCm}`);
  check('odpadek 18 %', r.wastePercent === 18, `got ${r.wastePercent}`);
}

// ── 5. Kalibracija z znano ploščico (known-tile) ────────────
{
  const img = await loadRgba('/tmp/t27-stack.png');
  const r = analyzeTileGrid({ img, knownTileCm: 60 });
  console.log('kalibracija po znani ploščici:');
  check('vir = known-tile', r.calibSource === 'known-tile', `got ${r.calibSource}`);
  check('pxPerCm ≈ 2', r.pxPerCm !== null && Math.abs(r.pxPerCm - PX_PER_CM) <= 0.12, `got ${r.pxPerCm}`);
  check('druga stranica ≈ 60 cm', r.tileHCm !== null && Math.abs(r.tileHCm - 60) <= 3, `got ${r.tileHCm}`);
  check('snap 60×60', r.snapW === 60 && r.snapH === 60, `got ${r.snapW}×${r.snapH}`);
}

// ── 6. Snap na standardne formate ───────────────────────────
{
  console.log('snap standardni formati:');
  check('59 → 60', snapTile(59) === 60, `got ${snapTile(59)}`);
  check('64 → 60', snapTile(64) === 60, `got ${snapTile(64)}`);
  check('66 → null (izven 8 %)', snapTile(66) === null, `got ${snapTile(66)}`);
  check('33.5 → 33', snapTile(33.5) === 33, `got ${snapTile(33.5)}`);
  check('120.5 → 120', snapTile(120.5) === 120, `got ${snapTile(120.5)}`);
  check('-5 → null', snapTile(-5) === null);
}

// ── 7. Brez kalibracije ─────────────────────────────────────
{
  const img = await loadRgba('/tmp/t27-stack.png');
  const r = analyzeTileGrid({ img });
  console.log('brez kalibracije:');
  check('vzorec vseeno prepoznan', r.ok && r.pattern === 'ravno');
  check('cm null', r.tileWCm === null && r.tileHCm === null);
  check('opozorilo o kalibraciji', r.warnings.some((w) => w.includes('kalibracij')));
}

// ── 8. Realna fotka (sanity: ne crasha, koherenten izhod) ───
{
  const img = await loadRgba('/home/z/my-project/public/crafts/keramika.jpg');
  const t0 = Date.now();
  const r = analyzeTileGrid({ img, pxPerCm: PX_PER_CM });
  const ms = Date.now() - t0;
  console.log(`realna fotka keramika.jpg (${ms} ms):`);
  check('izvedeno brez napak', typeof r.ok === 'boolean');
  check('hitro (< 5 s)', ms < 5000, `got ${ms} ms`);
  check('confidence v razponu 0–97', r.confidence >= 0 && r.confidence <= 97, `got ${r.confidence}`);
  console.log(`   → pattern=${r.pattern} angle=${r.angleDeg} pitch=${r.pitchPx1}/${r.pitchPx2} conf=${r.confidence} (${r.verdict})`);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
