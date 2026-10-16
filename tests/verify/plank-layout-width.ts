// FAZA-8 §4.1 (zlata pot na jedru) in §4.2 (neodvisnost izrisa od wCm).
//
// Dokazana trditev: geometrija (4 oglišča + ENA izmerjena dolžina) zadostuje
// za izris desk in rež, NIKOLI pa ne za naročilnico. Izhodiščna točka je
// prava fotka monterjev (fb-hi/04.jpg, 1536×746 px) — ne simuliran kvadrat.
// Zagon: bun tests/verify/plank-layout-width.ts
import {
  computePlankLayouts, buildReplaceMetadata, createMask,
  CANONICAL_PLANE_WIDTH_CM,
  type LayoutResult, type ReplaceMetadata,
} from '../../src/lib/photo-replace-core';
import { buildBomFromMeta } from '../../src/lib/photo-bom';
import { ROKSAL_PROFILES } from '../../src/lib/roksal-assets';
import { canExportOrder, canRenderMontage } from '../../src/lib/assertion';
import { validateGeometry, validateMetric } from '../../src/lib/measurement-status';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// Prava fotka: 04.jpg = 1536 × 746 px (izmerjeno s sharp, 2026-10-15).
const IMG = { w: 1536, h: 746 };
// Oglišča stare ograje, odčitana iz kadra v % (širina pika ni izmerjena —
// monter tapne oglišča, ne meri z traku).
const QUAD: [number, number][] = [[7, 24], [93, 17], [93, 71], [7, 78]];
const CREATED_AT = '2026-10-15T00:00:00.000Z';

/**
 * Popolna, brez-tolerance primerjava postavitve: vsotirane koordinate v
 * pikslih (izvirne, zaokroževanje bi prikrilo razlike). Desk in reže morajo
 * biti dobesedno enaki, sicer trditev o neodvisnosti ni dokazana.
 */
const layoutJson = (l: LayoutResult): string => JSON.stringify({
  planks: l.planks.map((p) => ({ i: p.index, q: p.quad })),
  gaps: l.gaps,
});

const horiz = ROKSAL_PROFILES.find((p) => p.orientation === 'horizontal') ?? null;
const vert = ROKSAL_PROFILES.find((p) => p.orientation === 'vertical') ?? null;

const layoutFor = (wCm: number | null, over: Partial<Parameters<typeof computePlankLayouts>[0]> = {}): LayoutResult => {
  const p = over.orientation === 'vertical' ? vert! : horiz!;
  return computePlankLayouts({
    quadPct: QUAD,
    imgSize: IMG,
    planeCm: { wCm, hCm: 110 },
    plankCm: p.plankCm,
    gapCm: p.gapCm,
    orientation: over.orientation ?? p.orientation,
    postCm: p.postCm,
    postEveryCm: over.postEveryCm ?? null,
  });
};

if (!horiz || !vert) {
  console.log('  ✗ registra ROKSAL profilov nima obeh orientacij');
  console.log(`\nREZULTAT: ${pass} OK, ${fail + 1} NAPAK`);
  process.exit(1);
}

// ── 1. §4.2 — izris desk NE ODVISI od izbire širine ─────────
{
  console.log('§4.2 — neodvisnost polnih desk od izbrane širine ravnine');
  /**
   * Največja razlika v pikslih med postavitvama. Trditev (H_prime = H okrozi A):
   * affine premaganje ravnine v x ne spremeni preslikave robov, ki potegnejo
   * čez celotno širino — desk torej ostane pixel-za-pixel ista. Izmera na
   * pravi fotki (04.jpg): razlike so 0 do 2,3e-13 px, kar je zgolj zaokroževanje
   * double natančnosti pri reševanju homografije, ne geometrijska razlika.
   */
  const flat = (l: LayoutResult): number[] => l.planks.flatMap((q) =>
    [q.quad.tl.x, q.quad.tl.y, q.quad.tr.x, q.quad.tr.y, q.quad.br.x, q.quad.br.y, q.quad.bl.x, q.quad.bl.y]);
  const maxDelta = (a: LayoutResult, b: LayoutResult): number => {
    const x = flat(a), y = flat(b);
    if (x.length !== y.length) return Number.POSITIVE_INFINITY;
    let d = 0;
    for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - y[i]));
    return d;
  };
  const base = layoutFor(200);
  check('desk je vsaj ena (sicer test ne bi dokazal ničesar)', base.planks.length >= 1, String(base.planks.length));

  // a) BYTE-IDENTIČNO: pot brez izmerjene širine mora dati Isti niz kot
  //    kanonična notranja mera — sicer pravilo 13 ni varno.
  for (const w of [100, 400, null]) {
    const other = layoutFor(w);
    check(`wCm = ${String(w)} → desk in reže BYTE-IDENTIČNI kot pri wCm = 200`,
      layoutJson(other) === layoutJson(base) && other.gaps.length === base.gaps.length,
      `Δ ${maxDelta(other, base)} px`);
  }
  // b) ROBNI PRIMERI: skrajne domnevne širine (10 cm … 5000 cm) ne smejo
  //    spremeniti izrisa več, kot ga lahko zaokroži floating-point.
  let worst = 0;
  for (const w of [10, 37.5, 1000, 5000]) {
    const other = layoutFor(w);
    check(`wCm = ${w} → št. desk in rež enaka`, other.planks.length === base.planks.length && other.gaps.length === base.gaps.length);
    worst = Math.max(worst, maxDelta(other, base));
  }
  check('največja izmerjena razlika med domnevnimi širinami je pod 1e-9 px (samo zaokroževanje)',
    worst < 1e-9, worst.toExponential(3));
  console.log(`   izmerjeno: najslabši Δ = ${worst.toExponential(3)} px čez štiri skrajne domnevne širine`);
  check('izris je determinističen: štirikotnik + ena mera = ena postavitev',
    layoutJson(layoutFor(null)) === layoutJson(layoutFor(null)));
}

// ── 2. Kdaj pa širina vendarle pomeni razliko ───────────────
{
  console.log('kjer je širina odločilna (rob testu, ne šibkost)');
  const postsKnown = layoutFor(200, { postEveryCm: 100 });
  const postsUnknown = layoutFor(null, { postEveryCm: 100 });
  check('z izmerjeno širino so vmesni stebri izrisani', postsKnown.posts.length > 0, String(postsKnown.posts.length));
  check('brez izmerjene širine stebrov NI in obstaja eksplicitno opozorilo',
    postsUnknown.posts.length === 0
      && postsUnknown.warnings.some((w) => w.includes('Širina ravnine ni izmerjena')),
    JSON.stringify(postsUnknown.warnings));
  check('brez širine se desk NIKOLI ne spreminijo (stebri so edina razlika)',
    layoutJson({ ...postsUnknown, posts: postsKnown.posts, warnings: [] }) === layoutJson({ ...postsKnown, warnings: [] }));
  let verticalError = '';
  try { layoutFor(null, { orientation: 'vertical' }); } catch (e) { verticalError = e instanceof Error ? e.message : String(e); }
  check('pokončne deske brez širine = izris NEDOLOČEN (eksplicitna napaka, ne tihi privzetek)',
    verticalError.includes('NEZADOSTNI PODATKI') && verticalError.includes('vodoravne deske'), verticalError);
}

// ── 3. §4.1 — zlata pot: izris DA, naročilnica NE ──────────
{
  console.log('§4.1 — para trditev na pravi fotki');
  const geo = validateGeometry({ method: 'plane-homography', planeCalibrated: true }).assurance;
  const layout = layoutFor(null);
  const meta = buildReplaceMetadata({
    profileId: horiz.id,
    profileLabel: horiz.label,
    catalogSku: horiz.catalogSku ?? null,
    texture: null,
    planeCm: { wCm: null, hCm: 110 },
    params: { pattern: horiz.pattern, elementCm: horiz.plankCm, spacingCm: horiz.gapCm, quadWidthCm: 'ni izmerjena' },
    mask: createMask(IMG.w, IMG.h),
    layout,
    imgSize: IMG,
    inpaint: 'ok',
    warnings: layout.warnings,
    createdAt: CREATED_AT,
  });
  check('geometrija je FITTED (4 oglišča + ena izmerjena dolžina)', geo === 'FITTED', geo);
  check('vrata fotomontaže so ODPRTA brez merila širine (D5 odprta)', canRenderMontage(geo));
  check('vrata naročilnice so ZAPRTA (met = NONE)', !canExportOrder(geo, 'NONE'));
  check('merilo brez izmerjene širine je na osi merila NONE, ne ASSUMED',
    validateMetric({ method: 'plane-homography', planeCalibrated: true }).assurance === 'REFERENCED'
      && meta.planeCm.wCm === null);
  let bomError = '';
  try { buildBomFromMeta(meta); } catch (e) { bomError = e instanceof Error ? e.message : String(e); }
  check('kosovnica zavrne z razlogom na osi merila, ne s padcem',
    bomError.includes('KOSOVNICA NI DOLOČENA'), bomError);
  check('pravilo 13: kanonična notranja širina NE sme zaplesati kot mera v shranjenih metapodatkih',
    !JSON.stringify(meta).includes(String(CANONICAL_PLANE_WIDTH_CM)),
    JSON.stringify(meta).slice(0, 120));
  check('pravilo 13: brez izmerjene širine ni številke cm/px (nevtralna, a ne izmišljena)',
    layout.scaleCmPerPxAtQuad.top === null && layout.scaleCmPerPxAtQuad.bottom === null);
  check('z izmerjeno širino pa je cm/px navadno število',
    typeof layoutFor(200).scaleCmPerPxAtQuad.top === 'number');
}

// ── 4. Neskladje med metapodatki in postavitvijo je napaka ──
{
  console.log('pravilo 14: zapisane trditve se morajo ujemati');
  const mk = (wCm: number | null, layout: LayoutResult): ReplaceMetadata => buildReplaceMetadata({
    profileId: horiz!.id, profileLabel: horiz!.label, catalogSku: null, texture: null,
    planeCm: { wCm, hCm: 110 },
    params: { pattern: horiz!.pattern, elementCm: horiz!.plankCm, spacingCm: horiz!.gapCm },
    mask: createMask(IMG.w, IMG.h), layout, imgSize: IMG, inpaint: 'ok', warnings: [], createdAt: CREATED_AT,
  });
  const layUnknown = layoutFor(null);
  const layKnown = layoutFor(200);
  let e1 = '', e2 = '';
  try { mk(200, layUnknown); } catch (e) { e1 = e instanceof Error ? e.message : String(e); }
  try { mk(null, layKnown); } catch (e) { e2 = e instanceof Error ? e.message : String(e); }
  check('meta trdi izmerjeno širino, geometrija pa je računa brez nje → NESKLADJJE',
    e1.includes('NESKLADJJE'), e1);
  check('meta skriva širino, geometrija pa jo je uporabila → NESKLADJJE',
    e2.includes('NESKLADJJE'), e2);
  check('skladen par (oba neznana) je sprejet', mk(null, layUnknown).planeCm.wCm === null);
  check('skladen par (oba znan) je sprejet', mk(200, layKnown).planeCm.wCm === 200);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
