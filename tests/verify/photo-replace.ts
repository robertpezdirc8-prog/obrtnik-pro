// Verifikacija determinističnega fotomontažnega pogona (Task 36-b + 36-b2 —
// issue #14 FOTOZAMENJAVA BREZ AI): maske, samodejni predlog, klasični
// inpainting, perspektivna postavitev, okluzije/plasti, svetlobno ujemanje,
// metapodatki + FNV-1a + iskrenost registra ROKSAL.
// Vse slike so SINTETIČNE (ImgData = { width, height, data }) — brez canvasa.
// Zagon: bun tests/verify/photo-replace.ts
import {
  EXPORT_LABEL,
  PHOTO_REPLACE_SCRIPT_VERSION,
  ambientLightFactor,
  autoSuggestFenceMask,
  buildReplaceMetadata,
  canExportResult,
  checkMaskDims,
  computePlankLayouts,
  createMask,
  fnv1aHash,
  frontPixelsFrom,
  inpaintMask,
  maskCoverage,
  maskToPctPolys,
  orderLayers,
  paintMaskCircle,
  paintMaskRect,
  shadowEdgesFor,
  type ImgData,
  type QuadPx,
  type ReplaceLayer,
  type ReplaceMetadataInput,
} from '../../src/lib/photo-replace-core';
import { ROKSAL_ASSETS, ROKSAL_PROFILES, assetById, profileReadiness } from '../../src/lib/roksal-assets';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const throwsMsg = (fn: () => unknown): string => {
  try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};
const throws = (fn: () => unknown): boolean => throwsMsg(fn) !== '';
const eqBytes = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// ── Sintetične slike 240×180 (brez canvasa) ──────────────────
type Rgb = [number, number, number];
const IMG_W = 240, IMG_H = 180;
const makeImg = (w: number, h: number, fill: (x: number, y: number) => Rgb): ImgData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
};
const gray = (v: number): Rgb => [v, v, v];

/** Svetla stena (gradient 205–220 po x) + temne NAVPIČNE palice 8 px / razmak 14 (x 40–201, celotna višina). */
const vertPlankImg = (): ImgData => makeImg(IMG_W, IMG_H, (x) => {
  if (x >= 40 && x <= 201 && (x - 40) % 14 < 8) return gray(60);
  return gray(205 + Math.round((15 * x) / (IMG_W - 1)));
});
/** Vodoravni linearni gradient po x + stara ograja (palice 6 px) SAMO v pasu y 60–120. */
const horizGradFenceImg = (): ImgData => makeImg(IMG_W, IMG_H, (x, y) => {
  const v = 70 + Math.round((110 * x) / (IMG_W - 1));
  if (y >= 60 && y <= 120 && x >= 40 && x <= 199 && (x - 40) % 14 < 6) return gray(30);
  return gray(v);
});
/** Navpični linearni gradient po y + stara ograja (vodoravne palice 6 px) SAMO v pasu x 30–209. */
const vertGradFenceHorizImg = (): ImgData => makeImg(IMG_W, IMG_H, (x, y) => {
  const v = 80 + Math.round((100 * y) / (IMG_H - 1));
  if (x >= 30 && x <= 209 && y >= 40 && y <= 115 && (y - 40) % 14 < 6) return gray(25);
  return gray(v);
});
/** px → % slike (computePlankLayouts jemlje quadPct v %). */
const pctOf = (x: number, y: number): [number, number] => [(x / IMG_W) * 100, (y / IMG_H) * 100];

// ── 1. Osnovne operacije na maskah ───────────────────────────
{
  console.log('maske (createMask/paintMaskRect/paintMaskCircle/pokritost/poligoni):');
  const m0 = createMask(4, 3);
  check('createMask: dimenzije in dolžina bufferja', m0.w === 4 && m0.h === 3 && m0.data.length === 12);
  check('createMask: vse vrednosti 0', m0.data.every((v) => v === 0));
  check('createMask: neveljavne dimenzije vržejo napako',
    throws(() => createMask(0, 3)) && throws(() => createMask(2.5, 3)) && throws(() => createMask(4, -1)));

  const m = createMask(5, 5);
  paintMaskRect(m, 1, 1, 3, 3, 255);
  check('paintMaskRect: vključno z mejami (9 pikslov)', m.data.filter((v) => v === 255).length === 9);
  check('maskCoverage: 9/25 natančno', maskCoverage(m) === 9 / 25, String(maskCoverage(m)));
  paintMaskRect(m, -5, -5, 100, 100, 255);
  check('paintMaskRect: orez izven slike → pokritost 1', maskCoverage(m) === 1);
  paintMaskRect(m, 2, 2, 2, 2, 0);
  check('paintMaskRect: obrnjene koordinate + brisanje (vrednost 0) → 24/25', maskCoverage(m) === 24 / 25);

  const c = createMask(11, 11);
  paintMaskCircle(c, 5, 5, 2.5, 255);
  check('paintMaskCircle: točno 21 pikslov (r = 2,5)', c.data.filter((v) => v === 255).length === 21);
  const cc = createMask(5, 5);
  paintMaskCircle(cc, 0, 0, 2, 255);
  check('paintMaskCircle: orez na robu → 6 pikslov', cc.data.filter((v) => v === 255).length === 6);
  check('paintMaskCircle: negativen radij vrže napako', throws(() => paintMaskCircle(c, 5, 5, -1, 255)));

  const p = createMask(10, 10);
  paintMaskRect(p, 2, 2, 5, 7, 255);
  const polys = maskToPctPolys(p);
  check('maskToPctPolys: en sam trak', polys.length === 1, JSON.stringify(polys));
  check('maskToPctPolys: koordinate znotraj [0, 100]', polys.flat(2).every((v) => v >= 0 && v <= 100));
  const polyArea = (poly: number[][]): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };
  const areaSum = polys.reduce((s, q) => s + polyArea(q), 0) / 10000;
  check('maskToPctPolys: ploščina pokrije pobarvano območje (0,24)',
    Math.abs(areaSum - maskCoverage(p)) < 1e-9, `got ${areaSum} vs ${maskCoverage(p)}`);

  const p2 = createMask(10, 10);
  paintMaskRect(p2, 0, 0, 1, 9, 255);
  paintMaskRect(p2, 5, 5, 9, 9, 255);
  const polys2 = maskToPctPolys(p2);
  check('maskToPctPolys: dve ločeni regiji → 2 poligona', polys2.length === 2, String(polys2.length));
  const area2 = polys2.reduce((s, q) => s + polyArea(q), 0) / 10000;
  check('maskToPctPolys: skupna ploščina 0,45', Math.abs(area2 - 0.45) < 1e-9, String(area2));

  const img6 = makeImg(6, 4, () => gray(10));
  check('checkMaskDims: neujemane dimenzije → napaka z "Maska in slika"',
    throwsMsg(() => checkMaskDims(createMask(5, 5), img6)).includes('Maska in slika'));
  check('checkMaskDims: ujemajoče dimenzije ne vržejo', !throws(() => checkMaskDims(createMask(6, 4), img6)));
}

// ── 2. Samodejni predlog maske stare ograje ──────────────────
{
  console.log('autoSuggestFenceMask (navpične temne palice na svetli steni):');
  const quad: QuadPx = { tl: { x: 30, y: 30 }, tr: { x: 210, y: 30 }, br: { x: 210, y: 150 }, bl: { x: 30, y: 150 } };
  const r1 = autoSuggestFenceMask(vertPlankImg(), quad);
  check('pokritost znotraj štirikotnika med 0.4 in 0.95',
    r1.confidence >= 0.4 && r1.confidence <= 0.95, `got ${r1.confidence}`);
  check('stenska točka (x=108, y=35) ni pobarvana', r1.mask.data[35 * IMG_W + 108] === 0);
  check('palica (x=43, y=90) je pobarvana', r1.mask.data[90 * IMG_W + 43] === 255);
  check('opomba je neprazen slovenski niz', typeof r1.note === 'string' && r1.note.length > 0, r1.note);
  const r2 = autoSuggestFenceMask(vertPlankImg(), quad);
  check('determinizem: dva teka → identični bajti maske',
    eqBytes(r1.mask.data, r2.mask.data) && r1.confidence === r2.confidence);
}

// ── 3. Klasični inpainting ───────────────────────────────────
{
  console.log('inpaintMask (navpične palice, vodoravni gradient):');
  const img = horizGradFenceImg();
  const before = new Uint8ClampedArray(img.data);
  const mask = createMask(IMG_W, IMG_H);
  for (let k = 0; k < 12; k++) {
    const x0 = 40 + 14 * k;
    paintMaskRect(mask, x0, 60, x0 + 5, 120, 255);
  }
  const res = inpaintMask(img, mask);
  check('status = ok', res.status === 'ok', res.status);
  check('repairedPx > 0', res.repairedPx === 12 * 6 * 61, String(res.repairedPx));
  check('coverage ≈ 4392/43200', Math.abs(res.coverage - (12 * 6 * 61) / (IMG_W * IMG_H)) < 1e-9, String(res.coverage));
  const cx = 126, cy = 90; // sredina palice k=6
  const exp = 70 + Math.round((110 * cx) / (IMG_W - 1));
  const i = (cy * IMG_W + cx) * 4;
  check('osrednji piksel ≤ 12/kanal od pričakovane interpolacije',
    Math.abs(res.image.data[i] - exp) <= 12
    && Math.abs(res.image.data[i + 1] - exp) <= 12
    && Math.abs(res.image.data[i + 2] - exp) <= 12,
    `got ${res.image.data[i]},${res.image.data[i + 1]},${res.image.data[i + 2]} — pričakovano ~${exp}`);
  check('originalni img NI spremenjen', eqBytes(img.data, before));

  const res2 = inpaintMask(img, mask);
  check('determinizem: identični bajti slike', eqBytes(res.image.data, res2.image.data));
  check('determinizem: identičen status', res.status === res2.status);
}
{
  console.log('inpaintMask (velika maska → ročno obvezno):');
  const img = makeImg(IMG_W, IMG_H, () => gray(128));
  const before = new Uint8ClampedArray(img.data);
  const mask = createMask(IMG_W, IMG_H);
  paintMaskRect(mask, 0, 0, IMG_W - 1, 89, 255); // 50 % slike
  const res = inpaintMask(img, mask);
  check('status = manual-required', res.status === 'manual-required', res.status);
  check('slika NI spremenjena (ozadja NI izmišljenega)', eqBytes(res.image.data, before));
  check('ročni namig je neprazen slovenski niz',
    typeof res.manualHint === 'string' && res.manualHint.length > 0, res.manualHint ?? 'null');
}
{
  console.log('inpaintMask (maska na robu slike → partial):');
  const img = horizGradFenceImg();
  const mask = createMask(IMG_W, IMG_H);
  paintMaskRect(mask, 10, 0, 20, 100, 255); // run se začne v vrstici 0 → manjka zgornja meja
  const res = inpaintMask(img, mask);
  check('status = partial', res.status === 'partial', res.status);
  check('ročni namig prisoten', res.manualHint !== null && res.manualHint.length > 0);
  check('repairedPx > 0', res.repairedPx > 0, String(res.repairedPx));
}
{
  console.log('inpaintMask (VODORAVNE palice, navpični gradient — obratna smer):');
  const img = vertGradFenceHorizImg();
  const mask = createMask(IMG_W, IMG_H);
  for (let k = 0; k < 6; k++) {
    const y0 = 40 + 14 * k;
    paintMaskRect(mask, 30, y0, 209, y0 + 5, 255);
  }
  const res = inpaintMask(img, mask);
  check('status = ok', res.status === 'ok', res.status);
  const cy = 42, cx = 120;
  const exp = 80 + Math.round((100 * cy) / (IMG_H - 1));
  const i = (cy * IMG_W + cx) * 4;
  check('osrednji piksel ≤ 12/kanal od pričakovanega gradienta',
    Math.abs(res.image.data[i] - exp) <= 12
    && Math.abs(res.image.data[i + 1] - exp) <= 12
    && Math.abs(res.image.data[i + 2] - exp) <= 12,
    `got ${res.image.data[i]} — pričakovano ~${exp}`);
}

// ── 4. Perspektivna postavitev elementov ─────────────────────
type LayoutArgs = Parameters<typeof computePlankLayouts>[0];
const frontalLayoutArgs = (): LayoutArgs => ({
  quadPct: [pctOf(20, 20), pctOf(220, 20), pctOf(220, 160), pctOf(20, 160)],
  imgSize: { w: IMG_W, h: IMG_H },
  planeCm: { wCm: 200, hCm: 140 },
  plankCm: 14, gapCm: 0.4,
  orientation: 'horizontal', postCm: 6, postEveryCm: null,
});
{
  console.log('computePlankLayouts (frontalni pravokotnik 200×200 px → 200×140 cm):');
  const layout = computePlankLayouts(frontalLayoutArgs());
  check('planks niso prazni', layout.planks.length > 0);
  check('št. plankov = floor((140+0.4)/14.4) = 9 (dostikoli 9–11)',
    layout.planks.length >= 9 && layout.planks.length <= 11, String(layout.planks.length));
  const first = layout.planks[0].quad;
  check('zgornji rob prvega planka y ≈ 20 (tol. 2)',
    Math.abs(first.tl.y - 20) <= 2 && Math.abs(first.tr.y - 20) <= 2, `${first.tl.y}/${first.tr.y}`);
  check('zgornji rob prvega planka x ≈ 20…220 (tol. 2)',
    Math.abs(first.tl.x - 20) <= 2 && Math.abs(first.tr.x - 220) <= 2, `${first.tl.x}…${first.tr.x}`);
  check('scaleCmPerPxAtQuad.top ≈ 1,0 (tol. 0,05)',
    Math.abs(layout.scaleCmPerPxAtQuad.top - 1.0) <= 0.05, String(layout.scaleCmPerPxAtQuad.top));
  check('frontalni pogled: brez opozoril', layout.warnings.length === 0, layout.warnings.join('; '));
  check('reže: ena manj kot elementov (gapCm > 0)', layout.gaps.length === layout.planks.length - 1);
}
{
  console.log('computePlankLayouts (trapez — zgornji rob ožji):');
  const layout = computePlankLayouts({
    quadPct: [pctOf(60, 20), pctOf(180, 20), pctOf(220, 160), pctOf(20, 160)],
    imgSize: { w: IMG_W, h: IMG_H },
    planeCm: { wCm: 200, hCm: 140 },
    plankCm: 14, gapCm: 0.4,
    orientation: 'horizontal', postCm: 6, postEveryCm: null,
  });
  check('planks niso prazni', layout.planks.length > 0);
  const topEdgeWidth = (q: QuadPx): number => Math.hypot(q.tr.x - q.tl.x, q.tr.y - q.tl.y);
  const wTop = topEdgeWidth(layout.planks[0].quad);
  const wBottom = topEdgeWidth(layout.planks[layout.planks.length - 1].quad);
  check(`zgornji plank merljivo ožji od spodnjega (${wTop.toFixed(1)} < ${wBottom.toFixed(1)})`,
    wTop + 10 < wBottom, `${wTop} vs ${wBottom}`);
  check('ne vrže napake; warnings so tabela nizov',
    Array.isArray(layout.warnings) && layout.warnings.every((w) => typeof w === 'string'));
}
{
  console.log('computePlankLayouts (vmesni stebri, postEveryCm = 60):');
  const layout = computePlankLayouts({ ...frontalLayoutArgs(), postEveryCm: 60 });
  check('posts.length ≥ 2', layout.posts.length >= 2, String(layout.posts.length));
  const inside = (q: QuadPx): boolean => [q.tl, q.tr, q.br, q.bl].every(
    (pt) => pt.x >= -1e-6 && pt.x <= IMG_W + 1e-6 && pt.y >= -1e-6 && pt.y <= IMG_H + 1e-6);
  check('vsi stebri znotraj meja slike in isPost', layout.posts.every((p) => p.isPost && inside(p.quad)));
  check('planki imajo isPost = false', layout.planks.every((p) => !p.isPost));
}
{
  console.log('computePlankLayouts (degeneriran štirikotnik):');
  const msg = throwsMsg(() => computePlankLayouts({
    quadPct: [[10, 50], [40, 50], [70, 50], [20, 50]],
    imgSize: { w: IMG_W, h: IMG_H },
    planeCm: { wCm: 200, hCm: 140 },
    plankCm: 14, gapCm: 0.4,
    orientation: 'horizontal', postCm: 6, postEveryCm: null,
  }));
  check('vrže Error z "NEZADOSTNI PODATKI"', msg.includes('NEZADOSTNI PODATKI'), msg || 'ni napake');
}

// ── 5. Okluzije: plasti + front piksli ───────────────────────
{
  console.log('orderLayers (vrstni red plasti):');
  const img = makeImg(8, 8, () => gray(100));
  const m = createMask(8, 8);
  paintMaskRect(m, 0, 0, 3, 3, 255);
  const layers: ReplaceLayer[] = [
    { kind: 'front', image: img, mask: m },
    { kind: 'background', image: img },
    { kind: 'fence', render: 'viz-drawLayersOnQuad' },
  ];
  const sorted = orderLayers(layers);
  check('background → fence → front',
    sorted.map((l) => l.kind).join(',') === 'background,fence,front', sorted.map((l) => l.kind).join(','));
  const withShadow = orderLayers([
    { kind: 'front', image: img, mask: m },
    { kind: 'shadow', strength: 1, side: 'top' },
    { kind: 'background', image: img },
    { kind: 'fence', render: 'viz-drawLayersOnQuad' },
  ]);
  const kinds = withShadow.map((l) => l.kind).join(',');
  check('senca med fence in front', kinds === 'background,fence,shadow,front', kinds);
  const msg = throwsMsg(() => orderLayers([{ kind: 'neznana' } as unknown as ReplaceLayer]));
  check('neznana plast vrže napako', msg.includes('Neznana plast'), msg || 'ni napake');
}
{
  console.log('frontPixelsFrom (originalni piksli pred ograjo):');
  const img = makeImg(4, 2, (x, y) => [10 + 30 * x, 20 + 50 * y, 40] as Rgb);
  const fm = createMask(4, 2);
  paintMaskRect(fm, 1, 0, 2, 1, 255);
  const front = frontPixelsFrom(img, fm);
  let opaqueOk = true, transparentOk = true;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      if (fm.data[y * 4 + x] === 255) {
        if (front.data[i] !== img.data[i] || front.data[i + 1] !== img.data[i + 1]
          || front.data[i + 2] !== img.data[i + 2] || front.data[i + 3] !== 255) opaqueOk = false;
      } else if (front.data[i + 3] !== 0) transparentOk = false;
    }
  }
  check('maska = 255 → RGBA bajti enaki vhodu', opaqueOk);
  check('maska = 0 → alpha 0', transparentOk);
}

// ── 6. Svetlobno ujemanje + stična senca ─────────────────────
{
  console.log('ambientLightFactor (obroč okoli štirikotnika):');
  const quad: QuadPx = { tl: { x: 30, y: 30 }, tr: { x: 210, y: 30 }, br: { x: 210, y: 150 }, bl: { x: 30, y: 150 } };
  const dark = ambientLightFactor(makeImg(IMG_W, IMG_H, () => gray(90)), quad, 8);
  const bright = ambientLightFactor(makeImg(IMG_W, IMG_H, () => gray(230)), quad, 8);
  check('temna slika → faktor < 1', dark.factor < 1, String(dark.factor));
  check('svetla slika → faktor > 1', bright.factor > 1, String(bright.factor));
  check('faktor vedno znotraj [0.72, 1.4]',
    dark.factor >= 0.72 && dark.factor <= 1.4 && bright.factor >= 0.72 && bright.factor <= 1.4,
    `${dark.factor}/${bright.factor}`);
  check('sampleCount > 0', dark.sampleCount > 0 && bright.sampleCount > 0, `${dark.sampleCount}/${bright.sampleCount}`);
}
{
  console.log('shadowEdgesFor (stična senca):');
  const q: QuadPx = { tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 }, br: { x: 100, y: 50 }, bl: { x: 0, y: 50 } };
  const s1 = shadowEdgesFor(q, 1);
  check('strength 1 → topAlpha ≈ 0.18', Math.abs(s1.topAlpha - 0.18) <= 0.005, String(s1.topAlpha));
  check('strength 1 → bottomAlpha ≈ 0.10', Math.abs(s1.bottomAlpha - 0.10) <= 0.005, String(s1.bottomAlpha));
  const s0 = shadowEdgesFor(q, 0);
  check('strength 0 → obe 0', s0.topAlpha === 0 && s0.bottomAlpha === 0);
}

// ── 7. Iskrenost registra ROKSAL ─────────────────────────────
{
  console.log('roksal-assets (iskrenost registra in profilov):');
  const missing = ROKSAL_ASSETS.filter((a) => a.verification === 'missing');
  check('vsak "missing" asset ima src = null',
    missing.length > 0 && missing.every((a) => a.src === null), `${missing.length} manjkajočih`);
  const present = ROKSAL_ASSETS.filter((a) => a.src !== null);
  check('vsak asset z virom ima origin real-photo/user-upload/standard-reference in neprazno licenco',
    present.length > 0 && present.every((a) =>
      (a.origin === 'real-photo' || a.origin === 'user-upload' || a.origin === 'standard-reference') && a.license.length > 0));
  // standard-reference: javni standard, NE fotografija, NE original — izrecna kategorija
  const standard = ROKSAL_ASSETS.filter((a) => a.origin === 'standard-reference');
  check('standard-reference asseti: grain none + note izrecno zanika original + verification unverified',
    standard.length > 0 && standard.every((a) =>
      a.grain === 'none' && a.verification === 'unverified' && typeof a.note === 'string' && a.note.includes('NI original ROKSAL')),
    standard.map((a) => a.id).join(','));
  const alu = ROKSAL_PROFILES.find((pr) => pr.id === 'alu-palice-18')!;
  const rdAlu = profileReadiness(alu);
  check('alu-palice-18 (standardna RAL referenca) → canRender TRUE', rdAlu.canRender, JSON.stringify(rdAlu));
  check('… in NI original (isOriginal false) ter oznaka omenja standardno referenco in "ni original"',
    !rdAlu.isOriginal && rdAlu.honestyLabel.includes('Standardna') && rdAlu.honestyLabel.toLowerCase().includes('ni original'), rdAlu.honestyLabel);
  const mreza = ROKSAL_PROFILES.find((pr) => pr.id === 'mreza-3d-125')!;
  const rdMreza = profileReadiness(mreza);
  check('mreza-3d-125 (tex-roksal-ral-7016 še vedno manjka) → canRender false', !rdMreza.canRender, JSON.stringify(rdMreza));
  check('… in oznaka iskrenosti vsebuje "manjk"',
    rdMreza.honestyLabel.toLowerCase().includes('manjk'), rdMreza.honestyLabel);
  const wpc = ROKSAL_PROFILES.find((pr) => pr.id === 'wpc-deka-140')!;
  const rdWpc = profileReadiness(wpc);
  check('profil z obstoječo teksturo → canRender true', rdWpc.canRender);
  check('… in NI original (isOriginal false, oznaka neprazna)',
    !rdWpc.isOriginal && rdWpc.honestyLabel.length > 0, rdWpc.honestyLabel);
  check('assetById za neznan/prazen id → null', assetById('ne-obstaja') === null && assetById('') === null);
  check('assetById najde obstoječi asset', assetById('tex-wpc-tikovina')?.id === 'tex-wpc-tikovina');
  check('assetById najde standardno referenco', assetById('tex-ral-7016-standard')?.origin === 'standard-reference');

  // ── Barvni vzorec PNG: bajtno dekodiran in preverjen ────────
  // register trdi: raven RGB(56,62,66) — to se DEJANSKO preveri
  // (zlib inflate vseh IDAT-ov, filter 0, vsak piksel točno 56/62/66).
  const sw = assetById('tex-ral-7016-standard');
  if (sw?.src) {
    const { readFileSync } = await import('node:fs');
    const { inflateSync } = await import('node:zlib');
    const path = `${process.cwd()}/public${sw.src}`;
    const d = new Uint8Array(readFileSync(path));
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    check('ral-7016.png: PNG podpis', pngSig.every((b, i) => d[i] === b));
    // IHDR: width/height big-endian na offsetu 16/20, bitdepth 8, colortype 2
    const w = (d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19];
    const h = (d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23];
    check('ral-7016.png: 256×256, 8 bit, truecolor', w === 256 && h === 256 && d[24] === 8 && d[25] === 2, `${w}×${h} bit ${d[24]} ct ${d[25]}`);
    let idat = new Uint8Array(0);
    let i = 8;
    while (i < d.length) {
      const dv = new DataView(d.buffer, d.byteOffset + i, 8);
      const ln = dv.getUint32(0);
      const type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
      if (type === 'IDAT') {
        const next = new Uint8Array(idat.length + ln);
        next.set(idat); next.set(d.subarray(i + 8, i + 8 + ln), idat.length);
        idat = next;
      }
      i += 12 + ln;
    }
    const raw = new Uint8Array(inflateSync(idat));
    const stride = 1 + w * 3;
    let allExact = raw.length === h * stride;
    if (allExact) {
      for (let y = 0; y < h && allExact; y++) {
        const off = y * stride;
        if (raw[off] !== 0) { allExact = false; break; }
        for (let x = 0; x < w; x++) {
          const j = off + 1 + x * 3;
          if (raw[j] !== 56 || raw[j + 1] !== 62 || raw[j + 2] !== 66) { allExact = false; break; }
        }
      }
    }
    check('ral-7016.png: vsak piksel točno RGB(56,62,66), filter 0 (zlib dekodiran)', allExact);
    // konsistentnost z viz.ts: isti hex kot riše vizualizator
    const vizSrc = new TextDecoder().decode(readFileSync(`${process.cwd()}/src/lib/viz.ts`));
    check('register (#383E42) = barva, ki jo riše viz.ts ral-7016',
      vizSrc.includes("id: 'ral-7016'") && vizSrc.includes("'#383E42'"));
  } else {
    check('ral-7016.png dekodiranje', false, 'standardna referenca nima vira');
  }
}

// ── 8. Metapodatki + iskrenost izvoza ────────────────────────
{
  console.log('metapodatki + izvozni varovali:');
  const layout = computePlankLayouts(frontalLayoutArgs());
  const mask = createMask(IMG_W, IMG_H);
  paintMaskRect(mask, 30, 30, 209, 149, 255);
  const tex = assetById('tex-wpc-tikovina')!;
  const input: ReplaceMetadataInput = {
    profileId: 'wpc-deka-140',
    profileLabel: 'WPC deka 140 mm (vodoravno)',
    catalogSku: null,
    texture: { id: tex.id, src: tex.src, origin: tex.origin, verification: tex.verification, realCm: tex.realCm },
    planeCm: { wCm: 200, hCm: 140 },
    params: { plankCm: 14, gapCm: 0.4 },
    mask,
    layout,
    imgSize: { w: IMG_W, h: IMG_H },
    inpaint: 'ok',
    warnings: [],
    createdAt: '2024-05-01T10:00:00.000Z',
  };
  const meta1 = buildReplaceMetadata(input);
  const meta2 = buildReplaceMetadata(input);
  check('determinizem: isti vhodi (isti createdAt) → identičen JSON',
    JSON.stringify(meta1) === JSON.stringify(meta2));
  check('scriptVersion se ujema', meta1.scriptVersion === PHOTO_REPLACE_SCRIPT_VERSION);
  check('exportLabel = EXPORT_LABEL', meta1.exportLabel === EXPORT_LABEL);
  const mask2 = createMask(IMG_W, IMG_H);
  paintMaskRect(mask2, 30, 30, 209, 149, 255);
  paintMaskRect(mask2, 0, 0, 0, 0, 255); // en dodan bajt
  const meta3 = buildReplaceMetadata({ ...input, mask: mask2 });
  check('sprememba enega bajta maske → drugačen maskHash', meta1.maskHash !== meta3.maskHash);
  check('maskHash je 16-mestni hex', /^[0-9a-f]{16}$/.test(meta1.maskHash), meta1.maskHash);
  const noRender = canExportResult(meta1, { canRender: false });
  check('canRender false → izvoz prepovedan z neprazno razlogo',
    !noRender.allowed && typeof noRender.reason === 'string' && noRender.reason.length > 0, noRender.reason ?? '');
  const okRender = canExportResult(meta1, { canRender: true });
  check('canRender true → izvoz dovoljen, razlog null', okRender.allowed && okRender.reason === null);
  // standard-reference origin: veljaven vhod za metapodatke (nov origin 2026)
  const ralTex = assetById('tex-ral-7016-standard')!;
  const metaRal = buildReplaceMetadata({
    ...input,
    profileId: 'alu-palice-18',
    profileLabel: 'Vertikalne alu palice 18 mm (razmak 11 cm)',
    texture: { id: ralTex.id, src: ralTex.src, origin: ralTex.origin, verification: ralTex.verification, realCm: ralTex.realCm },
    params: { plankCm: 1.8, gapCm: 11 },
  });
  check('metapodatki sprejmejo origin standard-reference', metaRal.texture?.origin === 'standard-reference' && metaRal.texture.src === '/textures/ral-7016.png');
  const badOrigin = throws(() => buildReplaceMetadata({
    ...input,
    texture: { id: ralTex.id, src: ralTex.src, origin: 'izmisljen-origin' as 'real-photo', verification: ralTex.verification, realCm: ralTex.realCm },
  }));
  check('neznan origin → zavrnjen', badOrigin);
}

// ── 9. FNV-1a hash proti neodvisni referenčni implementaciji ─
{
  console.log('fnv1aHash (neodvisna referenčna implementacija z BigInt):');
  const fnvRef = (bytes: Uint8Array): string => {
    // BigInt konstruktorsko (ne literali) — cilj prevajalnika je ES2017 (enako kot jedro).
    const prime = BigInt('0x100000001b3');
    const mask64 = (BigInt(1) << BigInt(64)) - BigInt(1);
    let h = BigInt('0xcbf29ce484222325');
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = (h * prime) & mask64;
    }
    return h.toString(16).padStart(16, '0');
  };
  const enc = new TextEncoder();
  let s = 42 >>> 0; // determinističen PRNG (LCG), seed 42
  const rnd = new Uint8Array(1000);
  for (let i = 0; i < rnd.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; rnd[i] = s & 0xff; }
  const a = enc.encode('a');
  const hw = enc.encode('hello world');
  check('prazen vhod = offset basis (cbf29ce484222325)',
    fnv1aHash(new Uint8Array(0)) === 'cbf29ce484222325', fnv1aHash(new Uint8Array(0)));
  check('"a" se ujema z referenco', fnv1aHash(a) === fnvRef(a), `${fnv1aHash(a)} vs ${fnvRef(a)}`);
  check('"hello world" se ujema z referenco', fnv1aHash(hw) === fnvRef(hw), `${fnv1aHash(hw)} vs ${fnvRef(hw)}`);
  check('1000 bajtov PRNG (seed 42) se ujema z referenco',
    fnv1aHash(rnd) === fnvRef(rnd), `${fnv1aHash(rnd)} vs ${fnvRef(rnd)}`);
  check('determinizem: isti vhod → isti hash',
    fnv1aHash(rnd) === fnv1aHash(rnd) && fnv1aHash(a) === fnv1aHash(a));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
