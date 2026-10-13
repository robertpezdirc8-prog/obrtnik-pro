// Verifikacija meritvene skripte FASADE (bun + sharp): linije obloge,
// rez poligona (Sutherland–Hodgman), površina stene − odprtine, prefill.
// Zagon: bun tests/verify/fasada-analysis.ts
import sharp from 'sharp';
import {
  analyzeFasadaLines, clipPolygonRect, fasadaWallArea, fasadaPrefill,
  type RgbaImage, type FasadaOpeningPx,
} from '../../src/lib/fasada-analysis';
import type { XY } from '../../src/lib/measure-geometry';

async function loadRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ─── 1) Sutherland–Hodgman: rez poligona ────────────────────
console.log('— Rez poligona (clipPolygonRect) —');
{
  const sq: XY[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const a1 = clipPolygonRect(sq, { x0: 5, y0: 5, x1: 20, y1: 20 });
  const area1 = Math.abs(a1.reduce((s, p, i) => {
    const q = a1[(i + 1) % a1.length];
    return s + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
  check('kvadrat ∩ kvadrant = 25', near(area1, 25, 0.01), `area=${area1}`);

  const a2 = clipPolygonRect(sq, { x0: -5, y0: -5, x1: 20, y1: 20 });
  check('popolnoma znotraj → nespremenjen (100)', near(a2.length ? Math.abs(a2.reduce((s, p, i) => {
    const q = a2[(i + 1) % a2.length];
    return s + p.x * q.y - q.x * p.y;
  }, 0)) / 2 : 0, 100, 0.01));

  const a3 = clipPolygonRect(sq, { x0: 20, y0: 20, x1: 30, y1: 30 });
  check('popolnoma zunaj → < 3 točk', a3.length < 3);

  const a4 = clipPolygonRect(sq, { x0: 5, y0: -100, x1: 15, y1: 100 });
  check('polovica → 50', near(a4.length ? Math.abs(a4.reduce((s, p, i) => {
    const q = a4[(i + 1) % a4.length];
    return s + p.x * q.y - q.x * p.y;
  }, 0)) / 2 : 0, 50, 0.01));
}

// ─── 2) Sintetična fotka: linije obloge ─────────────────────
console.log('— analyzeFasadaLines (sintetika 960×720, pitch 30 px) —');
const img = await loadRgba('/home/z/my-project/tests/task32-fasada.jpg');
{
  const r = analyzeFasadaLines(img);
  check('ok', r.ok);
  check('smer ≈ 0° (vodoravna obloga)', near(r.cladAngleDeg, 0, 6) || near(r.cladAngleDeg, 180, 6), `angle=${r.cladAngleDeg}`);
  check('orientacija vodoravno', r.orientation === 'vodoravno', r.orientation);
  check('pitch ≈ 30 px', r.pitchPx !== null && near(r.pitchPx, 30, 3), `pitch=${r.pitchPx}`);
  check('≥ 12 vidnih linij', (r.linesVisible ?? 0) >= 12, `n=${r.linesVisible}`);
  check('zanesljivost ≥ 60', r.confidence >= 60, `conf=${r.confidence}`);
  check('anotacije ≥ 10', r.lines.length >= 10, `lines=${r.lines.length}`);
}

// ─── 3) Stena: površina − odprtine ──────────────────────────
console.log('— fasadaWallArea (stena 7,2 × 5,0 m; odprtine 5,44 m²) —');
{
  // delovna slika = polovica (480×360) — kot v panelu (scale 900/max)
  const W = img.width / 2, H = img.height / 2;
  const quadPct: XY[] = [
    { x: (120 / 960) * 100, y: (120 / 720) * 100 },
    { x: (840 / 960) * 100, y: (120 / 720) * 100 },
    { x: (840 / 960) * 100, y: (620 / 720) * 100 },
    { x: (120 / 960) * 100, y: (620 / 720) * 100 },
  ];
  const pxPerCm = 0.5; // vrata 200 px @ izvirnik = 200 cm → delovna slika (polovica): 100 px / 200 cm
  const rects = (imgW: number, imgH: number): FasadaOpeningPx[] => [
    { rect: { x0: (424 / 960) * imgW, y0: (420 / 720) * imgH, x1: (524 / 960) * imgW, y1: (620 / 720) * imgH }, label: 'Vrata' },
    { rect: { x0: (200 / 960) * imgW, y0: (200 / 720) * imgH, x1: (320 / 960) * imgW, y1: (300 / 720) * imgH }, label: 'Okno 1' },
    { rect: { x0: (600 / 960) * imgW, y0: (180 / 720) * imgH, x1: (760 / 960) * imgW, y1: (320 / 720) * imgH }, label: 'Okno 2' },
    { rect: { x0: 0.9 * imgW, y0: 0.9 * imgH, x1: 0.99 * imgW, y1: 0.99 * imgH }, label: 'zunaj' },
  ];
  const r = fasadaWallArea(quadPct, pxPerCm, { w: W, h: H }, rects(W, H));
  check('ok', r.ok);
  check('širina ≈ 720 cm', r.wallWidthCm !== null && near(r.wallWidthCm, 720, 8), `w=${r.wallWidthCm}`);
  check('višina ≈ 500 cm', r.wallHeightCm !== null && near(r.wallHeightCm, 500, 8), `h=${r.wallHeightCm}`);
  check('bruto ≈ 36 m²', r.grossM2 !== null && near(r.grossM2, 36, 0.4), `gross=${r.grossM2}`);
  check('odprtine ≈ 5,44 m²', near(r.openingsM2, 5.44, 0.15), `open=${r.openingsM2}`);
  check('3 odprtini znotraj', r.openingsCount === 3, `n=${r.openingsCount}`);
  check('1 izven (preskočena)', r.openingsOutside === 1, `out=${r.openingsOutside}`);
  check('neto ≈ 30,56 m²', r.netM2 !== null && near(r.netM2, 30.56, 0.3), `net=${r.netM2}`);

  const pf = fasadaPrefill(r);
  check('prefill facadePerimeter ≈ 7,2 m', pf.facadePerimeter !== undefined && near(pf.facadePerimeter, 7.2, 0.05), `${pf.facadePerimeter}`);
  check('prefill facadeHeight ≈ 5,0 m', pf.facadeHeight !== undefined && near(pf.facadeHeight, 5.0, 0.05), `${pf.facadeHeight}`);
  check('prefill openingsM2 ≈ 5,44', pf.openingsM2 !== undefined && near(pf.openingsM2, 5.44, 0.1), `${pf.openingsM2}`);
}

// ─── 4) Ozka (višja kot širša) stena — klasifikacija parov ──
console.log('— Ozka stena (1,5 × 4,0 m) —');
{
  const quadPct: XY[] = [
    { x: (400 / 960) * 100, y: (80 / 720) * 100 },
    { x: (550 / 960) * 100, y: (80 / 720) * 100 },
    { x: (550 / 960) * 100, y: (680 / 720) * 100 },
    { x: (400 / 960) * 100, y: (680 / 720) * 100 },
  ];
  const r = fasadaWallArea(quadPct, 1, { w: 960, h: 720 }, []);
  check('ok', r.ok);
  check('širina ≈ 150 cm < višina ≈ 600 cm', r.wallWidthCm !== null && r.wallHeightCm !== null && r.wallWidthCm < r.wallHeightCm && near(r.wallWidthCm, 150, 6) && near(r.wallHeightCm, 600, 8), `w=${r.wallWidthCm} h=${r.wallHeightCm}`);
  check('bruto ≈ 9 m²', r.grossM2 !== null && near(r.grossM2, 9, 0.3), `gross=${r.grossM2}`);
}

// ─── 5) Poševna stena (perspektiva) — orientacijska mera ────
console.log('— Poševna stena (trapez) —');
{
  const quadPct: XY[] = [
    { x: (200 / 960) * 100, y: (160 / 720) * 100 },
    { x: (760 / 960) * 100, y: (120 / 720) * 100 },
    { x: (820 / 960) * 100, y: (560 / 720) * 100 },
    { x: (160 / 960) * 100, y: (600 / 720) * 100 },
  ];
  const r = fasadaWallArea(quadPct, 0.6, { w: 960, h: 720 }, []);
  check('ok', r.ok);
  check('širina 300–1100 cm (ohlapno)', r.wallWidthCm !== null && r.wallWidthCm > 300 && r.wallWidthCm < 1100, `w=${r.wallWidthCm}`);
  check('višina 250–800 cm (ohlapno)', r.wallHeightCm !== null && r.wallHeightCm > 250 && r.wallHeightCm < 800, `h=${r.wallHeightCm}`);
}

// ─── 6) Brez kalibracije + degenerirani vnosi ───────────────
console.log('— Obramba —');
{
  const quadPct: XY[] = [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }];
  const r1 = fasadaWallArea(quadPct, null, { w: 960, h: 720 }, []);
  check('brez kalibracije → !ok + opozorilo', !r1.ok && r1.warnings.some((w) => w.includes('kalibracij')), r1.warnings[0]);

  const r2 = fasadaWallArea(quadPct.slice(0, 3), 1, { w: 960, h: 720 }, []);
  check('3 oglisča → !ok', !r2.ok);

  const r3 = fasadaWallArea([{ x: 10, y: 10 }, { x: 11, y: 11 }, { x: 10.5, y: 12 }, { x: 10.2, y: 11.5 }], 1, { w: 960, h: 720 }, []);
  check('degeneriran štirikotnik → !ok', !r3.ok);

  const r4 = fasadaWallArea([{ x: -20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }], 1, { w: 960, h: 720 }, []);
  check('oglišče izven slike → !ok', !r4.ok);

  const pf = fasadaPrefill({ ok: false, wallWidthCm: null, wallHeightCm: null, grossM2: null, openingsM2: 0, openingsCount: 0, openingsOutside: 0, netM2: null, warnings: [] });
  check('prefill !ok → {}', Object.keys(pf).length === 0);
}

console.log(`\nFASADA VERIFY: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
