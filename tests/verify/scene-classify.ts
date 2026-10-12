// ─── Bazna meritev klasifikacije dejavnosti na realnih fotkah ──
// Poženi: bun tests/verify/scene-classify.ts [pred|po]
// Izpiše craft + zanesljivost + strukturo za vsako fotko iz public/crafts.

import sharp from 'sharp';
import { analyzePhotoImage, type RgbaImage } from '../../src/lib/cv-engine';

async function decode(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
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

for (const f of FILES) {
  try {
    const img = await decode(f);
    const a = analyzePhotoImage(img);
    const ref = a.reference ? `${a.reference.label} ${a.reference.assumedCm}cm` : '—';
    const objs = a.objects.map((o) => o.label).slice(0, 3).join(' | ');
    console.log(`${f.split('/').pop()!.padEnd(18)} → ${a.craft.padEnd(12)} (${a.craftConfidence}%)  ref=${ref}`);
    console.log(`  objekti: ${objs}`);
  } catch (e) {
    console.log(`${f} → NAPAKA ${(e as Error).message}`);
  }
}
