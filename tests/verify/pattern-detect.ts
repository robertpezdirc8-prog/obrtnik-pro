// Numerična verifikacija pattern-detect (bun, brez brskalnika)
import { detectPatternInQuad, type PatternSuggestion } from '../../src/lib/pattern-detect';
import type { RgbaImage } from '../../src/lib/bar-count';

function makeImage(w: number, h: number, base: number, draw: (x: number, y: number) => number | null): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = draw(x, y) ?? base;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const quad: { x: number; y: number }[] = [
  { x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 },
];

let pass = 0;
let fail = 0;
function check(name: string, got: PatternSuggestion | null, expectPattern: string, expectPitch: number | null = null, pitchTol = 2.5) {
  if (!got) {
    console.log(`✗ ${name}: null (pričakovano ${expectPattern})`);
    fail++;
    return;
  }
  const okPattern = got.pattern === expectPattern;
  const okPitch = expectPitch === null || (got.pitchPx !== null && Math.abs(got.pitchPx - expectPitch) <= pitchTol);
  const ok = okPattern && okPitch;
  if (ok) pass++; else fail++;
  console.log(
    `${ok ? '✓' : '✗'} ${name}: ${got.pattern} (${got.confidence}) pitch=${got.pitchPx} width=${got.barWidthPx} — pričakovano ${expectPattern}${expectPitch ? ` pitch≈${expectPitch}` : ''}`,
  );
}

// 1. Vertikalne palice: temne palice širine 8 px vsakih 20 px
{
  const img = makeImage(200, 200, 220, (x) => (x % 20 < 8 ? 40 : null));
  check('vertikalne palice (pitch 20)', detectPatternInQuad(img, quad), 'vertikalne', 20);
}

// 2. Horizontalne lamele: temne vrstice širine 10 px vsakih 25 px
{
  const img = makeImage(200, 200, 230, (_x, y) => (y % 25 < 10 ? 30 : null));
  check('horizontalne lamele (pitch 25)', detectPatternInQuad(img, quad), 'horizontalne', 25);
}

// 3. Mreža: periodično v obeh smereh (pitch 16)
{
  const img = makeImage(200, 200, 210, (x, y) => (x % 16 < 5 || y % 16 < 5 ? 50 : null));
  check('mreža (pitch 16 v obeh smereh)', detectPatternInQuad(img, quad), 'mreza', 16);
}

// 4. Panel: enakomerno siva
{
  const img = makeImage(200, 200, 128, () => 128);
  check('polna plošča', detectPatternInQuad(img, quad), 'panel');
}

// 5. Diagonalne lamele 45°
{
  const img = makeImage(240, 240, 225, (x, y) => (Math.floor((x + y) / 18) % 2 === 0 ? 45 : null));
  check('diagonalne lamele 45°', detectPatternInQuad(img, quad), 'lamele45');
}

// 6. Vozlik: obe diagonali (križ) — sprejemljivo vozlik/lamele45/mreza
{
  const img = makeImage(240, 240, 225, (x, y) => (Math.floor((x + y) / 14) % 2 === 0 || Math.floor((x - y + 480) / 14) % 2 === 0 ? 60 : null));
  const got = detectPatternInQuad(img, quad);
  console.log(`vozlik → ${got?.pattern} (${got?.confidence})`);
  if (got && ['vozlik', 'lamele45', 'mreza'].includes(got.pattern)) pass++; else fail++;
}

// 7. Zanesljivost: čista vertikalna vrsta = visoka/srednja
{
  const img = makeImage(200, 200, 220, (x) => (x % 20 < 8 ? 40 : null));
  const got = detectPatternInQuad(img, quad)!;
  console.log(`zanesljivost vertikalnih: ${got.confidence}`);
  if (['visoka', 'srednja'].includes(got.confidence)) pass++; else fail++;
}

// 8. Degenerirani vhod: premajhen quad → null
{
  const img = makeImage(200, 200, 128, () => 128);
  const tiny: { x: number; y: number }[] = [
    { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }, { x: 10, y: 11 },
  ];
  const got = detectPatternInQuad(img, tiny);
  if (got === null) {
    console.log('✓ premajhen quad → null');
    pass++;
  } else {
    console.log('✗ premajhen quad vrnil rezultat');
    fail++;
  }
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
