// Verifikacija na REALNIH fotkah (sharp → raw RGBA → detectPatternInQuad)
import sharp from 'sharp';
import { detectPatternInQuad, type PatternSuggestion } from '../../src/lib/pattern-detect';

async function loadRgba(path: string) {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const results: { name: string; got: PatternSuggestion | null }[] = [];

// ograje.jpg — balkonska ograja (steklo + vertikalni stebri + horizontalni ročaji)
{
  const img = await loadRgba('public/crafts/ograje.jpg');
  // osrednje območje ograje
  const got = detectPatternInQuad(img, [
    { x: 20, y: 45 }, { x: 80, y: 45 }, { x: 80, y: 80 }, { x: 20, y: 80 },
  ]);
  results.push({ name: 'ograje.jpg (osrednje območje)', got });
}

// keramika.jpg — ploščice (mreža fug)
{
  const img = await loadRgba('public/crafts/keramika.jpg');
  const got = detectPatternInQuad(img, [
    { x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 },
  ]);
  results.push({ name: 'keramika.jpg (ploščice)', got });
}

// wpc-terasa.jpg — deske (horizontalne lamele)
{
  const img = await loadRgba('public/crafts/wpc-terasa.jpg');
  const got = detectPatternInQuad(img, [
    { x: 20, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 75 }, { x: 20, y: 75 },
  ]);
  results.push({ name: 'wpc-terasa.jpg (deske)', got });
}

for (const r of results) {
  console.log(`${r.name}: ${r.got ? `${r.got.pattern} (${r.got.confidence}) pitch=${r.got.pitchPx} width=${r.got.barWidthPx} dir=${r.got.direction}` : 'null'}`);
}
console.log('DONE');
