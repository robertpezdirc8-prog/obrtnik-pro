// ─── Surove značilke po fotki (debug klasifikacije) ──────────
import sharp from 'sharp';
import { extractFeatures, type RgbaImage } from '../../src/lib/cv-engine';

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

for (const f of FILES) {
  const img = await decode(f);
  const F = extractFeatures(img);
  const N = F.W * F.H;
  const wideGlass = F.glassBlobs.some((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    return bw > F.W * 0.35 && bh > F.H * 0.12 && bh < F.H * 0.55 && b.fill > 0.55;
  });
  const wins = F.glassBlobs.filter((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const ar = bh / bw, af = b.area / N;
    return ar >= 0.55 && ar <= 1.9 && af >= 0.012 && af <= 0.35 && b.fill >= 0.5;
  }).length;
  console.log(
    `${f.split('/').pop()!.padEnd(18)} v=${F.verticals.length} h=${F.horizontals.length} dg=${F.diagonals.length} ` +
    `glass=${F.glassFrac.toFixed(2)}(${F.glassBlobs.length},wide=${wideGlass}) win=${wins} ` +
    `sky=${F.skyFrac.toFixed(2)} green=${F.greenFrac.toFixed(2)} wood=${F.woodFrac.toFixed(2)} metal=${F.metalFrac.toFixed(2)} ` +
    `flat=${F.flatFrac.toFixed(2)} dark=${F.darkFrac.toFixed(2)} out=${F.outdoor ? 1 : 0} ` +
    `grid=${F.grid.both ? 'oba' : F.grid.single ? 'ena' : '-'} stairs=${F.stairPattern ? 1 : 0} door=${F.bestDoor ? 1 : 0}`,
  );
}
