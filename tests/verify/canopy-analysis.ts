// Verifikacija analize nadstreška (bun + sharp): detekcija roba kritine
// (frontalna + stranska sintetika), meritev iz 2 točk, stebri, geometrija.
// Zagon: bun tests/verify/canopy-analysis.ts
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
  detectCanopyLine, measureFromPoints, refPxPerCm, suggestPosts, measureCanopy, formatCanopyText,
  type RgbaImage,
} from '../../src/lib/canopy-analysis';

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// determinističen PRNG (LCG)
const rng = (() => { let s = 7; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

interface Rect { x0: number; y0: number; x1: number; y1: number; c: [number, number, number] }
function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Frontalna fasada: stena + pas kritine (temen) s FAŠNO LENTO (najtemnejša) + vrata (kratki robovi). */
function makeFront(W: number, H: number, opts: { fascia?: Rect; roof?: Rect; door?: Rect; noise?: number; wall?: [number, number, number] } = {}): Buffer {
  const { fascia, roof, door, noise = 6, wall = [210, 203, 190] } = opts;
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c: [number, number, number] = wall;
      if (roof && inRect(roof, x, y)) c = roof.c;
      if (fascia && inRect(fascia, x, y)) c = fascia.c;
      if (door && inRect(door, x, y)) c = door.c;
      const idx = (y * W + x) * 3;
      const n = (rng() - 0.5) * 2 * noise;
      buf[idx] = Math.max(0, Math.min(255, Math.round(c[0] + n)));
      buf[idx + 1] = Math.max(0, Math.min(255, Math.round(c[1] + n)));
      buf[idx + 2] = Math.max(0, Math.min(255, Math.round(c[2] + n)));
    }
  }
  return buf;
}

/** Stranska fotka: svetla stena levo + POŠEVNI rob kritine (debel temen trak) + vodoravna tla. */
function makeSide(W: number, H: number, opts: { x0: number; y0: number; x1: number; y1: number; thick?: number; groundY?: number; wallX?: number; noise?: number }): Buffer {
  const { x0, y0, x1, y1, thick = 9, groundY, wallX = Math.round(x0 * 0.45), noise = 5 } = opts;
  const buf = Buffer.alloc(W * H * 3);
  // izven traku: daljica po (x0,y0)→(x1,y1) s polširino thick/2
  const len = Math.hypot(x1 - x0, y1 - y0);
  const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy, ny = dx;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v: number;
      if (x <= wallX) v = 214; // stena
      else if (groundY !== undefined && y >= groundY) v = 118; // tla (vodoravna črta — naj ne zmede)
      else v = 196; // nebo/ozadje
      // projekcija na daljico
      const px = x - x0, py = y - y0;
      const t = px * dx + py * dy;
      const d = Math.abs(px * nx + py * ny);
      if (t >= 0 && t <= len && d <= thick / 2) v = 38; // rob kritine
      const idx = (y * W + x) * 3;
      const n = (rng() - 0.5) * 2 * noise;
      buf[idx] = Math.max(0, Math.min(255, Math.round(v * 0.98 + n)));
      buf[idx + 1] = Math.max(0, Math.min(255, Math.round(v + n)));
      buf[idx + 2] = Math.max(0, Math.min(255, Math.round(v * 0.9 + n)));
    }
  }
  return buf;
}

async function save(buf: Buffer, W: number, H: number, path: string) {
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path);
}

// ── 1. Frontalna fotka: pas kritine + fašna lenta + vrata (kratek rob ne sme zmagati) ──
{
  const W = 960, H = 720;
  // kritina: x 260–740 (48 % širine), fašna lenta y 240–254 najtemnejša, streha y 200–240 srednje temna
  const roof: Rect = { x0: 260, y0: 196, x1: 740, y1: 240, c: [138, 132, 122] };
  const fascia: Rect = { x0: 260, y0: 240, x1: 740, y1: 256, c: [43, 40, 35] };
  const door: Rect = { x0: 430, y0: 480, x1: 546, y1: 680, c: [72, 60, 52] };
  await save(makeFront(W, H, { roof, fascia, door }), W, H, TMP('t30-front.png'));
  const img = await loadRgba(TMP('t30-front.png'));
  const r = detectCanopyLine(img, 'width');
  console.log('frontalna sintetika (kritina 480 px, fašna lenta, vrata):');
  check('zaznana črta', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('kot ≈ 0° (≤ 1,5°)', r.angleDeg !== null && r.angleDeg <= 1.5, `got ${r.angleDeg}`);
  check('span ≥ 44 % širine', r.spanPct !== null && r.spanPct >= 44, `got ${r.spanPct}`);
  check('levi konec ≈ 27 % (25–29 %)', r.seg !== null && Math.min(r.seg.x1, r.seg.x2) >= 25 && Math.min(r.seg.x1, r.seg.x2) <= 29, `got ${r.seg?.x1},${r.seg?.x2}`);
  check('desni konec ≈ 77 % (75–79 %)', r.seg !== null && Math.max(r.seg.x1, r.seg.x2) >= 75 && Math.max(r.seg.x1, r.seg.x2) <= 79, `got ${r.seg?.x1},${r.seg?.x2}`);
  check('črta je v pasu kritine (y 31–38 %)', r.seg !== null && [r.seg.y1, r.seg.y2].every((v) => v >= 31 && v <= 38), `got ${r.seg?.y1},${r.seg?.y2}`);
  check('trdost ≥ 0,45', r.strength >= 0.45, `got ${r.strength}`);
  check('ni opozoril o ne-vodoravnosti', !r.warnings.some((w) => w.includes('vodoraven')), r.warnings.join('; '));
}

// ── 2. Meritev širine iz zaznanih točk (kalibracija po vratah 200 cm) ──
{
  const W = 960, H = 720;
  const scale = Math.min(1, 900 / Math.max(W, H));
  const work = { w: Math.round(W * scale), h: Math.round(H * scale) };
  // vrata: y 480–680 → 200 naravnih px visoka = 200 cm (1 px/cm naravno)
  const ppc = refPxPerCm(200, 200, scale);
  check('merilo iz reference ≈ workScale (±5 %)', ppc !== null && Math.abs(ppc - scale) / scale < 0.05, `got ${ppc}, scale ${scale}`);
  if (ppc) {
    const m = measureFromPoints({ x: 27.1, y: 24 }, { x: 76.9, y: 24 }, work, ppc);
    check('širina ≈ 480 cm (465–495)', m.lenCm !== null && m.lenCm >= 465 && m.lenCm <= 495, `got ${m.lenCm}`);
    check('kot ≈ 0', m.angleDeg <= 0.5, `got ${m.angleDeg}`);
    check('brez merila: lenCm null, kot ostane', measureFromPoints({ x: 0, y: 50 }, { x: 100, y: 50 }, work, null).lenCm === null);
  }
  const m45 = measureFromPoints({ x: 10, y: 10 }, { x: 60, y: 60 }, { w: 800, h: 800 }, 2);
  check('diagonala 45°: kot 45 (±0,1)', Math.abs(m45.angleDeg - 45) < 0.1, `got ${m45.angleDeg}`);
  check('diagonala: horiz = len·cos45', m45.lenCm !== null && Math.abs(m45.horizCm! - m45.lenCm! * Math.SQRT1_2) < 0.01, `got ${m45.horizCm}`);
}

// ── 3. Stranska fotka: poševni rob kritine 12,2° + vodoravna tla (ne sme zmagati) ──
{
  const W = 960, H = 720;
  // rob: (220,240)→(700,340) → kot = atan2(100,480) = 11,77°
  await save(makeSide(W, H, { x0: 220, y0: 240, x1: 700, y1: 340, groundY: 620 }), W, H, TMP('t30-side.png'));
  const img = await loadRgba(TMP('t30-side.png'));
  const r = detectCanopyLine(img, 'depth');
  console.log('stranska sintetika (rob kritine ≈ 11,8°, tla vodoravno):');
  check('zaznana črta', r.ok, `warnings: ${r.warnings.join('; ')}`);
  check('kot ≈ 11,8° (10–14°)', r.angleDeg !== null && r.angleDeg >= 10 && r.angleDeg <= 14, `got ${r.angleDeg}`);
  check('span ≥ 42 % širine', r.spanPct !== null && r.spanPct >= 42, `got ${r.spanPct}`);
  check('levi konec pri steni (x 19–25 %)', r.seg !== null && Math.min(r.seg.x1, r.seg.x2) >= 19 && Math.min(r.seg.x1, r.seg.x2) <= 25, `got ${r.seg?.x1},${r.seg?.x2}`);
  check('desni konec (x 70–76 %)', r.seg !== null && Math.max(r.seg.x1, r.seg.x2) >= 70 && Math.max(r.seg.x1, r.seg.x2) <= 76, `got ${r.seg?.x1},${r.seg?.x2}`);
  // meritev globine iz zaznanih točk (kalibracija: referenca na stranski fotki — nazorna 200 cm = 200 px)
  const scale = Math.min(1, 900 / Math.max(W, H));
  const work = { w: Math.round(W * scale), h: Math.round(H * scale) };
  const ppc = refPxPerCm(200, 200, scale);
  if (r.ok && ppc) {
    const a = { x: r.seg!.x1, y: r.seg!.y1 }, b = { x: r.seg!.x2, y: r.seg!.y2 };
    const m = measureFromPoints(a, b, work, ppc);
    check('poševna dolžina ≈ 490 cm (460–520)', m.lenCm !== null && m.lenCm >= 460 && m.lenCm <= 520, `got ${m.lenCm}`);
    check('naklon ≈ 11,8° (10–14)', m.angleDeg >= 10 && m.angleDeg <= 14, `got ${m.angleDeg}`);
    check('globina = horiz ≈ 480 cm (450–510)', m.horizCm !== null && m.horizCm >= 450 && m.horizCm <= 510, `got ${m.horizCm}`);
    check('dvig ≈ 100 cm (75–125)', m.riseCm !== null && m.riseCm >= 75 && m.riseCm <= 125, `got ${m.riseCm}`);
  }
}

// ── 4. Neuspešne zaznave ──
{
  const W = 640, H = 480;
  await save(makeFront(W, H, {}), W, H, TMP('t30-flat.png'));
  const flat = await loadRgba(TMP('t30-flat.png'));
  const r1 = detectCanopyLine(flat, 'width');
  check('ravna stena: ni črte', !r1.ok, `got ${r1.ok}`);
  check('opozorilo o manjkajočih robovih', r1.warnings.length > 0);

  // prekratek rob (12 % širine) v načinu width
  const short: Rect = { x0: 280, y0: 200, x1: 360, y1: 214, c: [50, 46, 40] };
  await save(makeFront(W, H, { fascia: short }), W, H, TMP('t30-short.png'));
  const r2 = detectCanopyLine(await loadRgba(TMP('t30-short.png')), 'width');
  check('prekratek rob: zavrnjen', !r2.ok, `got ok=${r2.ok} span=${r2.spanPct}`);
  check('opozorilo o prekratku', r2.warnings.some((w) => w.includes('prekratek')), r2.warnings.join('; '));

  // prešibek kontrast (Δ ≈ 10) — pod pragom gradienta 16
  const faintRoof: Rect = { x0: 160, y0: 200, x1: 560, y1: 244, c: [200, 193, 180] };
  const faintFascia: Rect = { x0: 160, y0: 244, x1: 560, y1: 258, c: [198, 191, 178] };
  await save(makeFront(W, H, { roof: faintRoof, fascia: faintFascia, noise: 2 }), W, H, TMP('t30-faint.png'));
  const r3 = detectCanopyLine(await loadRgba(TMP('t30-faint.png')), 'width');
  check('prešibek kontrast: zavrnjen', !r3.ok, `got ok=${r3.ok}`);

  // premajhna slika
  const tiny = { width: 90, height: 70, data: new Uint8ClampedArray(90 * 70 * 4).fill(128) };
  check('premajhna slika: zavrnjena', !detectCanopyLine(tiny, 'width').ok);

  // depth na frontalni fotki: vodoravnih črt ne sme izbrati (range θ 2–46°)
  const rFront = detectCanopyLine(await loadRgba(TMP('t30-front.png')), 'depth');
  check('depth na fronti: zavrnjena', !rFront.ok, `got ok=${rFront.ok} angle=${rFront.angleDeg} span=${rFront.spanPct}`);
}

// ── 5. Stebri po razponu ──
{
  console.log('št. stebrov (jeklo 80×80, praksa ≤ 3,5 m):');
  check('3,0 m → 2', suggestPosts(3.0) === 2, `got ${suggestPosts(3.0)}`);
  check('3,5 m → 2', suggestPosts(3.5) === 2, `got ${suggestPosts(3.5)}`);
  check('3,6 m → 3', suggestPosts(3.6) === 3, `got ${suggestPosts(3.6)}`);
  check('7,0 m → 3', suggestPosts(7.0) === 3, `got ${suggestPosts(7.0)}`);
  check('7,1 m → 4', suggestPosts(7.1) === 4, `got ${suggestPosts(7.1)}`);
}

// ── 6. Geometrija: measureCanopy ──
{
  console.log('geometrija nadstreška (W 4,8 × D 3,0, naklon 12,2°):');
  const m = measureCanopy({ widthM: 4.8, depthM: 3.0, slopeDeg: 12.2 });
  check('ok', m.ok);
  check('površina 14,4 m²', m.areaM2 === 14.4, `got ${m.areaM2}`);
  const expRoof = 14.4 / Math.cos(12.2 * Math.PI / 180);
  check('kritina po naklonu ≈ 14,73 m² (±0,02)', m.roofAreaM2 !== null && Math.abs(m.roofAreaM2 - expRoof) < 0.02, `got ${m.roofAreaM2}`);
  check('stebri: predlog 3 (4,8 m > 3,5)', m.posts === 3, `got ${m.posts}`);
  check('dvig ≈ 65 cm (3,0·tan 12,2°)', m.riseCm !== null && Math.abs(m.riseCm - 65) <= 1.5, `got ${m.riseCm}`);
  check('brez opozoril o naklonu', !m.warnings.some((w) => w.includes('> 20°')), m.warnings.join('; '));

  const m2 = measureCanopy({ widthM: 2.4, depthM: 1.2 });
  check('brez naklona: roofArea null, dvig null', m2.ok && m2.roofAreaM2 === null && m2.riseCm === null);
  check('stebri: 2 (2,4 m)', m2.posts === 2, `got ${m2.posts}`);

  const m3 = measureCanopy({ widthM: 8.0, depthM: 3.0, slopeDeg: 8 });
  check('8 m → 4 stebri', m3.posts === 4, `got ${m3.posts}`);

  const m4 = measureCanopy({ widthM: 5, depthM: 2.5, slopeDeg: 26 });
  check('naklon 26°: opozorilo', m4.warnings.some((w) => w.includes('> 20°')), m4.warnings.join('; '));

  const e1 = measureCanopy({ widthM: 0, depthM: 0 });
  check('brez mer: !ok + opozorilo', !e1.ok && e1.warnings.length > 0);
  const e2 = measureCanopy({ widthM: 4, depthM: 0 });
  check('samo širina: !ok + opozorilo o globini', !e2.ok && e2.warnings.some((w) => w.includes('globina')), e2.warnings.join('; '));

  const m5 = measureCanopy({ widthM: 4, depthM: 2, posts: 5 });
  check('ročna izbira stebrov spoštovana', m5.posts === 5, `got ${m5.posts}`);
}

// ── 7. Povzetek ──
{
  const m = measureCanopy({ widthM: 4.8, depthM: 3.0, slopeDeg: 12.2 });
  const txt = formatCanopyText({ ...m, widthM: 4.8, depthM: 3.0, slopeDeg: 12.2 });
  check('povzetek vsebuje širino z vejico', txt.includes('4,80 m'), txt.split('\n')[1]);
  check('povzetek vsebuje naklon', txt.includes('12,2°'));
  check('povzetek vsebuje stebre', txt.includes('3 kosov'));
  check('povzetek vsebuje disclaimer', txt.includes('laserjem'));
}

console.log(`\n${pass}/${pass + fail} ✓`);
if (fail > 0) process.exit(1);
