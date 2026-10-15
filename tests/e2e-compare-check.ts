// ─── Preverba VSEBINE pravega izvoza pred/po (Task 65) ────────────────────
// Prejme PRAVO izvoženo datoteko (tests/e2e-compare-01-primerjava.png, ujeta v
// E2E pri palačinki URL.createObjectURL — ni ponovnega izrisa v testu) in preveri:
//   1) mere = formula postavitve (canvasW = 2×1280+2; višina = 41 + 890 + trak z žigom)
//   2) LEVA polovica kvadranta ≈ STARI ograji (rjava), DESNA ≈ NOVI (terakota)
//   3) spodnji trak TEMEN (žig), zgornji SVETEL (oznaki PRED/PO), ločilo TEMNO
// Pogoj: testi/e2e-compare-fixture.ts je pognan (ref povprečij v /tmp/e2e-compare-ref.json).
// Zagon: bun tests/e2e-compare-check.ts
import sharp from 'sharp';
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const ART = 'tests/e2e-compare-01-primerjava.png';
if (!existsSync(ART)) {
  console.error(`NAPAKA: ${ART} ne obstaja — najprej poženi E2E (agent-browser), ki ujame pravo izvoženo datoteko.`);
  process.exit(1);
}
const ref = JSON.parse(readFileSync('/tmp/e2e-compare-ref.json', 'utf8')) as {
  oldQuadAvg: [number, number, number]; newQuadAvg: [number, number, number]; W: number; H: number;
};

const img = sharp(ART);
const meta = await img.metadata();
const w = meta.width ?? 0;
const h = meta.height ?? 0;

console.log('Izvoz pred/po — preverba prave datoteke\n');

// 1) mere po formuli postavitve (pad 12, divider 2, lineH 17)
const canvasW = 2 * ref.W + 2;
const topH = 12 + 17 + 12;
const imgH = Math.min(ref.H, ref.H);
const stripH = h - topH - imgH;
check(`širina = PRED + ločilo + PO = ${canvasW}`, w === canvasW, String(w));
check(`višina = 41 + ${imgH} + trak ${stripH} (trak = 2×12 + n×17 + 6)`, stripH > 0 && (stripH - 6 - 24) % 17 === 0, `h=${h}, strip=${stripH}`);
const zigLines = (stripH - 6 - 24) / 17 - 1; // vrstice žiga (brez vrstice podatkov)
check(`št. vrstic žiga smiselno (1–3 na širini ${canvasW} px): ${zigLines}`, zigLines >= 1 && zigLines <= 3);

// 2) povprečja kvadrantov (preklopi v RGB)
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const px = (x: number, y: number): [number, number, number] => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const avgRegion = (x0: number, x1: number, y0: number, y1: number): [number, number, number] => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 2) { // vzorčenje vsak 2. piksel (dovolj natančno, hitro)
    for (let x = x0; x < x1; x += 2) {
      const [pr, pg, pb] = px(x, y);
      r += pr; g += pg; b += pb; n++;
    }
  }
  return [r / n, g / n, b / n];
};
const close = (a: [number, number, number], b: [number, number, number], tol: number): boolean =>
  Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol;

// kvadrant znotraj leve (PRED) slike: x 128..1152, y (41+178)..(41+712)
const leftQuad = avgRegion(128, 1152, topH + 178, topH + 712);
// kvadrant znotraj desne (PO) slike: isti izrez + odmik polovice + ločilo
const rightQuad = avgRegion(ref.W + 2 + 128, ref.W + 2 + 1152, topH + 178, topH + 712);
check(`LEVI kvadrant ≈ STARA ograja (pričakovano ${ref.oldQuadAvg.join(',')}, izmerjeno ${leftQuad.map((v) => v.toFixed(0)).join(',')})`,
  close(leftQuad, ref.oldQuadAvg, 8), JSON.stringify(leftQuad));
check(`DESNI kvadrant ≈ NOVA ograja (pričakovano ${ref.newQuadAvg.join(',')}, izmerjeno ${rightQuad.map((v) => v.toFixed(0)).join(',')})`,
  close(rightQuad, ref.newQuadAvg, 8), JSON.stringify(rightQuad));
check('levi in desni kvadrant sta RAZLIČNA (PRED ≠ PO)', !close(leftQuad, rightQuad, 20));

// 3) trakovi + ločilo
const topAvg = avgRegion(0, w, 0, topH);
const bottomAvg = avgRegion(0, w, h - stripH, h);
const dividerAvg = avgRegion(ref.W, ref.W + 2, topH, topH + 100);
check(`zgornji trak SVETEL (oznaki PRED/PO): ${topAvg.map((v) => v.toFixed(0)).join(',')}`, topAvg.every((v) => v > 200), JSON.stringify(topAvg));
check(`spodnji trak TEMEN (žig stone-800): ${bottomAvg.map((v) => v.toFixed(0)).join(',')}`, bottomAvg.every((v) => v < 70), JSON.stringify(bottomAvg));
check(`ločilo TEMNO: ${dividerAvg.map((v) => v.toFixed(0)).join(',')}`, dividerAvg.every((v) => v < 70), JSON.stringify(dividerAvg));

console.log(`\nRezultat: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
