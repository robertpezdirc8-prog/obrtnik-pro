// ─── Kaj strukturni detektor pove za testne fotke ────────────
import sharp from 'sharp';
import { detectPatternInQuad } from '../../src/lib/pattern-detect';
import type { RgbaImage } from '../../src/lib/cv-engine';

async function decode(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const FILES = [
  'public/crafts/ograje.jpg',
  'public/crafts/keramika.jpg',
  'public/crafts/wpc-terasa.jpg',
  'public/crafts/fasada.jpg',
  'public/crafts/stopnice.jpg',
  'public/crafts/nadstreski.jpg',
  'public/crafts/okna-vrata.jpg',
];

const QUAD = [
  { x: 14, y: 14 }, { x: 86, y: 14 }, { x: 86, y: 86 }, { x: 14, y: 86 },
];

for (const f of FILES) {
  const img = await decode(f);
  const s = detectPatternInQuad(img, QUAD);
  console.log(
    `${f.split('/').pop()!.padEnd(18)} → ${s ? `${s.pattern.padEnd(13)} ${s.confidence.padEnd(7)} pitch=${s.pitchPx} w=${s.barWidthPx}` : 'null'}`,
  );
}
