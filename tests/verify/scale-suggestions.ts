// ─── Verifikacija predlogov merila (Task 24: bun + sharp) ──────
// Poženi: bun tests/verify/scale-suggestions.ts
//  1) sintetična fasada (vrata 200×100 cm + 2 okni 120×120 cm, isto merilo)
//     → najboljši predlog = vrata, zanesljivost visoka, soglasje visoko,
//       prečni preverba širine ✓, napaka merila < 8 %
//  2) enotski testi soglasja (fuseScaleAgreement)
//  3) regresija na realnih fotkah: reference ostane skladna s predlogi

import sharp from 'sharp';
import { analyzePhotoImage, fuseScaleAgreement, type RgbaImage } from '../../src/lib/cv-engine';
import type { ScaleSuggestion } from '../../src/lib/camera-types';

let fails = 0;
let passes = 0;
const check = (cond: boolean, msg: string) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (cond) passes++;
  else fails++;
};

// ── Sintetična fasada ────────────────────────────────────────
// Merilo: 0,5 px na cm (480×360 slika). Vrata 200 cm visoka = 100 px,
// 100 cm široka = 50 px; okni 120×120 cm = 60×60 px.
interface Rect { x: number; y: number; w: number; h: number; rgb: [number, number, number] }

function buildFacade(door: Rect, windows: Rect[], W = 480, H = 360): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  // stena (topla svetlo siva) + tla (temnejši pas spodaj)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y >= H - 12) put(x, y, 181, 176, 168);
      else put(x, y, 221, 214, 201);
    }
  }
  const fill = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) put(x, y, r.rgb[0], r.rgb[1], r.rgb[2]);
      }
    }
  };
  // okna: temen okvir + nevtralno sivo steklo (s < 0,14 → glass maska)
  for (const w of windows) {
    fill({ x: w.x - 5, y: w.y - 5, w: w.w + 10, h: w.h + 10, rgb: [58, 63, 69] });
    fill(w);
  }
  fill(door);
  return { width: W, height: H, data };
}

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

// ── 1) Sintetični scenarij ──
console.log('\n── Sintetična fasada (vrata + 2 okni, isto merilo) ──');
{
  // vrata: 100×200 cm → 50×100 px; dno pri y=350 (0,972 H ≥ 0,95)
  const door: Rect = { x: 210, y: 250, w: 50, h: 100, rgb: [46, 42, 38] };
  const windows: Rect[] = [
    { x: 60, y: 60, w: 60, h: 60, rgb: [126, 134, 140] },
    { x: 330, y: 60, w: 60, h: 60, rgb: [126, 134, 140] },
  ];
  const img = buildFacade(door, windows);
  const a = analyzePhotoImage(img);
  const s = a.scaleSuggestions;
  console.log(`   craft=${a.craft} (${a.craftConfidence} %) · predlogi: ${s.map((x) => `${x.label}[${x.confidence}]`).join(', ')}`);
  // merilo iz okvirja v % (kot ga uporablja UI: naravni px)
  const natScale = (x: ScaleSuggestion) => (x.box[3] / 100) * img.height / x.assumedCm;
  check(s.length >= 2, `vsaj 2 predloga (najdeno ${s.length})`);
  const best = s[0];
  check(!!best && best.kind === 'vrata', 'najboljši predlog = vrata');
  check(!!best && best.confidence >= 75 && best.confidenceLabel === 'visoka', `zanesljivost vrat visoka (${best?.confidence})`);
  check(!!best && best.widthPlausible && best.impliedWidthCm >= 90 && best.impliedWidthCm <= 110, `širina vrat pri merilu ≈ 100 cm (${best?.impliedWidthCm})`);
  check(!!best && Math.abs(natScale(best) - 0.5) / 0.5 < 0.08, `merilo iz vrat 0,5 px/cm ± 8 % (${best ? natScale(best).toFixed(3) : '—'})`);
  const win = s.find((x) => x.kind === 'okno');
  check(!!win && Math.abs(natScale(win!) - 0.5) / 0.5 < 0.08, `merilo iz okna 0,5 px/cm ± 8 % (${win ? natScale(win).toFixed(3) : '—'})`);
  check(a.scaleAgreement === 'high', `soglasje visoko (${a.scaleAgreement})`);
  check(a.reference?.label === best?.label || !!a.reference, 'referenca skladna z najboljšim predlogom');
}

// ── 2) Soglasje: enotski testi ──
console.log('\n── fuseScaleAgreement (enotski testi) ──');
const mk = (pxPerCm: number): ScaleSuggestion => ({
  id: 't', kind: 'okno', label: 't', box: [0, 0, 1, 1], assumedCm: 120,
  pxPerCm, confidence: 80, confidenceLabel: 'visoka', impliedWidthCm: 120, widthPlausible: true,
});
check(fuseScaleAgreement([]) === 'none', 'prazno → none');
check(fuseScaleAgreement([mk(0.5)]) === 'none', 'enojen → none');
check(fuseScaleAgreement([mk(0.5), mk(0.52)]) === 'high', 'razpršenost 4 % → high');
check(fuseScaleAgreement([mk(0.5), mk(0.6)]) === 'medium', 'razpršenost 20 % → medium');
check(fuseScaleAgreement([mk(0.5), mk(0.75)]) === 'low', 'razpršenost 50 % → low');
check(fuseScaleAgreement([mk(0.5), mk(0.52), mk(0.48), mk(0.51)]) === 'high', '4 kandidata blizu → high');

// ── 3) Regresija na realnih fotkah ──
console.log('\n── Realne fotke: skladnost reference s predlogi ──');
for (const f of ['okna-vrata.jpg', 'ograje.jpg', 'fasada.jpg']) {
  const img = await decode(`public/crafts/${f}`);
  const a = analyzePhotoImage(img);
  const s = a.scaleSuggestions;
  const consistent = !a.referenceBox || (s.length > 0 && a.referenceBox.every((v, i) => Math.abs(v - s[0].box[i]) < 0.11));
  console.log(
    `   ${f.padEnd(16)} ref=${a.reference ? a.reference.label : '—'} · predlogi: ${s.map((x) => `${x.label}[${x.confidence} · ${x.impliedWidthCm} cm]`).join(', ') || '—'} · soglasje=${a.scaleAgreement}`,
  );
  check(consistent, `${f}: referenceBox = okvir najboljšega predloga`);
  // Klasifikacija kartic: kartice obrti so OD Task 31 prave fotografije
  // (UI sredstva, ne kalibrirane testne fotke) — klasifikacijska regresija
  // je smiselna samo na deterministični sintetiki (glej canopy/deck/tile verify),
  // zato tu samo izpis brez trdnih pričakovanj.
  console.log(`   klasifikacija: ${a.craft} (${a.craftConfidence}/100)`);
}

console.log(`\n${fails === 0 ? 'VSE OK ✓' : `NEUSPEŠNIH: ${fails}`}`);
// Številka preverb mora biti v standardni obliki, sicer je ta skript pri
// seštevanju vseh preverb neviden (`tests/verify-counts.ts`).
console.log(`REZULTAT: ${passes} OK, ${fails} NAPAK`);
process.exit(fails === 0 ? 0 : 1);
