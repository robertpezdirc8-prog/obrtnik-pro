// ─── Debug točkovanja klasifikacije (rezervirano za razvoj) ───
import sharp from 'sharp';
import { extractFeatures, classifyCraft, type RgbaImage } from '../../src/lib/cv-engine';
import { detectPatternInQuad } from '../../src/lib/pattern-detect';

async function decode(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const ARGS = process.argv.slice(2);
const FILES = ARGS.filter((a) => !a.startsWith('-')).length
  ? ARGS.filter((a) => !a.startsWith('-'))
  : [
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
  const F = extractFeatures(img);
  const S = detectPatternInQuad(img, QUAD);
  const cs = classifyCraft(F, S);
  const N = F.W * F.H;
  const isWin = (b: { x1: number; x0: number; y1: number; y0: number; area: number; fill: number }) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const ar = bh / bw, af = b.area / N;
    return ar >= 0.55 && ar <= 1.9 && af >= 0.012 && af <= 0.35 && b.fill >= 0.5;
  };
  const winG = F.glassBlobs.filter(isWin).length;
  const winD = F.framedDark.filter(isWin).length;
  console.log(`\n■ ${f.split('/').pop()} → ${cs.craft} (${cs.confidence}%)  strukt=${S ? S.pattern + '/' + S.confidence : 'null'}`);
  const top = Object.entries(cs.scores).sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  točke: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(
    `  v=${F.verticals.length} h=${F.horizontals.length} dg=${F.diagonals.length} sky=${F.skyFrac.toFixed(2)} green=${F.greenFrac.toFixed(2)} wood=${F.woodFrac.toFixed(2)} metal=${F.metalFrac.toFixed(2)} glass=${F.glassFrac.toFixed(2)} out=${F.outdoor ? 1 : 0} stairs=${F.stairPattern ? 1 : 0} door=${F.bestDoor ? 1 : 0} win(g/d)=${winG}/${winD}`,
  );
  if (ARGS.includes('-v')) {
    for (const b of F.framedDark.slice(0, 6)) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      console.log(`    dark: box=(${b.x0},${b.y0},${bw}x${bh}) ar=${(bh / bw).toFixed(2)} af=${(b.area / N).toFixed(3)} fill=${b.fill.toFixed(2)}`);
    }
  }
}
