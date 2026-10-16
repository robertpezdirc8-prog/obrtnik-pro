// Diferenčni test razcepa multi-view in SfM validacij (FAZA-8 korak 5,
// odločitev §9.2: domneven fokus gre na os MERILA, ne na os geometrije).
//
// Test NE trdi, da je razcep enak — trdi, da je izhod (ok, code, status)
// dobesedno enak snapshotu HEAD obnašanja čez celo mrežo vhodov
// (150 + 162 = 312 kombinacij), in da razcep drži additionalne trditve:
//  · geometrijska funkcija nikoli ne vrne metrične kode in obratno,
//  · status ovojnice je vedno projekcija para (geo, met),
//  · pragovi (12 inlierjev, 3 px) so nespremenjeni,
//  · šibka geometrija NIKOLI ne prerazredi v mero.
// Zagon: bun tests/verify/multiview-split.ts
import {
  validateMultiView, validateMultiViewGeometry, validateMultiViewMetric,
  validateSfm, validateSfmGeometry, validateSfmMetric,
  MIN_MULTIVIEW_INLIERS, MAX_MULTIVIEW_RESIDUAL_PX,
  type MultiViewGeometryInput, type MultiViewMetricInput,
  type SfmGeometryInput, type SfmMetricInput,
} from '../../src/lib/measurement-status';
import {
  projectStatus, geometryRank, metricRank, GEOMETRY_ORDER, METRIC_ORDER,
  type GeometricAssurance, type MetricAssurance,
} from '../../src/lib/assertion';
import { MV_V1, SFM_V1, type MvInput, type SfmInput } from '../fixtures/multiview-scale-v1';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const GEO_CODES = new Set(['OK', 'PLANE_REQUIRED', 'MULTIVIEW_DEGENERATE', 'RESIDUAL_HIGH', 'SFM_REPROJECTION_HIGH']);
const MET_CODES = new Set(['OK', 'NO_CALIBRATION', 'ASSUMED_SCALE', 'DEGENERATE_REFERENCE']);

// ── 1. Diferenca proti HEAD snapshotu ───────────────────────
const mvBad: string[] = [];
for (const row of MV_V1) {
  const now = validateMultiView(row.input);
  const was = row.out;
  if (now.ok !== was.ok || now.code !== was.code || now.status !== was.status) {
    mvBad.push(`${JSON.stringify(row.input)}: ${was.code}/${String(was.status)} → ${now.code}/${String(now.status)}`);
  }
}
{
  console.log('multi-view: diferenca proti HEAD snapshotu');
  check('snapshot pokriva 150 kombinacij para fotk', MV_V1.length === 150, String(MV_V1.length));
  check('vseh 150 izhodov je identičnih (ok, code, status)', mvBad.length === 0, mvBad.slice(0, 3).join(' | '));
}

const sfmBad: string[] = [];
for (const row of SFM_V1) {
  const now = validateSfm(row.input);
  const was = row.out;
  if (now.ok !== was.ok || now.code !== was.code || now.status !== was.status) {
    sfmBad.push(`${JSON.stringify(row.input)}: ${was.code}/${String(was.status)} → ${now.code}/${String(now.status)}`);
  }
}
{
  console.log('SfM: diferenca proti HEAD snapshotu');
  check('snapshot pokriva 162 kombinacij rekonstrukcije', SFM_V1.length === 162, String(SFM_V1.length));
  check('vseh 162 izhodov je identičnih (ok, code, status)', sfmBad.length === 0, sfmBad.slice(0, 3).join(' | '));
  check('skupaj je pregledanih 312 vrstic mreže', MV_V1.length + SFM_V1.length === 312);
}

// ── 2. Osi sta lokalni: koda spada na svojo os ─────────────
{
  console.log('lokalnost kod po oseh');
  const geoLeak: string[] = [];
  const metLeak: string[] = [];
  const geoLeakSfm: string[] = [];
  const metLeakSfm: string[] = [];
  for (const row of MV_V1) {
    const g = validateMultiViewGeometry(row.input);
    const m = validateMultiViewMetric(row.input);
    if (!GEO_CODES.has(g.code)) geoLeak.push(`${g.code} iz geometrije`);
    if (!MET_CODES.has(m.code)) metLeak.push(`${m.code} iz merila`);
  }
  for (const row of SFM_V1) {
    const g = validateSfmGeometry(row.input);
    const m = validateSfmMetric(row.input);
    if (!GEO_CODES.has(g.code)) geoLeakSfm.push(`${g.code} iz geometrije`);
    if (!MET_CODES.has(m.code)) metLeakSfm.push(`${m.code} iz merila`);
  }
  check('geometrijska validacija para nikoli ne vrne metrične kode', geoLeak.length === 0, geoLeak[0]);
  check('metrična validacija para nikoli ne vrne geometrijske kode', metLeak.length === 0, metLeak[0]);
  check('geometrijska validacija SfM nikoli ne vrne metrične kode', geoLeakSfm.length === 0, geoLeakSfm[0]);
  check('metrična validacija SfM nikoli ne vrne geometrijske kode', metLeakSfm.length === 0, metLeakSfm[0]);

  const codes: string[] = [];
  for (const row of MV_V1) codes.push(validateMultiView(row.input).code);
  check('ovojnica para uporablja samo kode obeh osi',
    codes.every((c) => GEO_CODES.has(c) || MET_CODES.has(c)));
  const multiCodes = new Set(codes);
  check('para pozna pet različnih kod (tri geometrijske + dve metrični)',
    multiCodes.size === 5 && [...multiCodes].sort().join(',') === 'ASSUMED_SCALE,MULTIVIEW_DEGENERATE,NO_CALIBRATION,OK,RESIDUAL_HIGH',
    [...multiCodes].sort().join(','));
}

// ── 3. Projekcija: status ovojnice = projectStatus(geo, met) ─
{
  console.log('projekcija para (geo, met) → status');
  const mvProj: string[] = [];
  for (const row of MV_V1) {
    const g = validateMultiViewGeometry(row.input);
    const m = validateMultiViewMetric(row.input);
    const w = validateMultiView(row.input);
    const want = g.code !== 'OK' ? null : projectStatus(g.assurance, m.assurance);
    if (w.status !== want) mvProj.push(`${JSON.stringify(row.input)}: dobjen ${String(w.status)}, projekcija pravi ${String(want)}`);
  }
  check('status ovojnice para je vedno projekcija (razen pri odpovedi geometrije)', mvProj.length === 0, mvProj[0]);

  const sfmProj: string[] = [];
  for (const row of SFM_V1) {
    const g = validateSfmGeometry(row.input);
    const m = validateSfmMetric(row.input);
    const w = validateSfm(row.input);
    const want = g.code !== 'OK' ? null : projectStatus(g.assurance, m.assurance);
    if (w.status !== want) sfmProj.push(`${JSON.stringify(row.input)}: dobjen ${String(w.status)}, projekcija pravi ${String(want)}`);
  }
  check('status ovojnice SfM je vedno projekcija (razen pri odpovedi geometrije)', sfmProj.length === 0, sfmProj[0]);

  // Kadar geometrija odpove, ovojnica NIKOLI ne vrne mere.
  const mvSilent = MV_V1.filter((r) => validateMultiViewGeometry(r.input).code !== 'OK')
    .filter((r) => validateMultiView(r.input).ok || validateMultiView(r.input).status !== null);
  check('šibka geometrija para nikoli ne prerazredi v mero', mvSilent.length === 0, String(mvSilent.length));
  const sfmSilent = SFM_V1.filter((r) => validateSfmGeometry(r.input).code !== 'OK')
    .filter((r) => validateSfm(r.input).ok || validateSfm(r.input).status !== null);
  check('šibka geometrija SfM nikoli ne prerazredi v mero', sfmSilent.length === 0, String(sfmSilent.length));
}

// ── 4. Pragovi ostanejo identični ───────────────────────────
{
  console.log('pragovi (12 inlierjev, 3 px) — nespremenjeni');
  check('MIN_MULTIVIEW_INLIERS je 12', MIN_MULTIVIEW_INLIERS === 12);
  check('MAX_MULTIVIEW_RESIDUAL_PX je 3', MAX_MULTIVIEW_RESIDUAL_PX === 3);

  const ok: MultiViewGeometryInput = { inlierCount: 12, meanResidualPx: 3 };
  check('12 inlierjev = meja je dovoljeno (CONSISTENT)', validateMultiViewGeometry(ok).assurance === 'CONSISTENT');
  check('11 inlierjev je pod mejo (MULTIVIEW_DEGENERATE)',
    validateMultiViewGeometry({ inlierCount: 11, meanResidualPx: 0 }).code === 'MULTIVIEW_DEGENERATE');
  check('3,0 px residuala je še v pragu', validateMultiViewGeometry({ inlierCount: 50, meanResidualPx: 3 }).assurance === 'CONSISTENT');
  check('3,0001 px residuala je čez prag (RESIDUAL_HIGH)',
    validateMultiViewGeometry({ inlierCount: 50, meanResidualPx: 3.0001 }).code === 'RESIDUAL_HIGH');
  check('12 inlierjev, a slab residual → geometrija UNDEFINED',
    geometryRank(validateMultiViewGeometry({ inlierCount: 12, meanResidualPx: 9 }).assurance) === 0);
  check('premalo inlierjev ima prednost pred residualo',
    validateMultiViewGeometry({ inlierCount: 1, meanResidualPx: 99 }).code === 'MULTIVIEW_DEGENERATE');

  const sfmOk: SfmGeometryInput = { registeredCount: 2, totalImages: 2, minPerImageInliers: 12, reprojRmsPx: 3, warnings: [] };
  check('2 fotki, 12 točk, RMS 3,0 px = meja je dovoljeno', validateSfmGeometry(sfmOk).assurance === 'CONSISTENT');
  check('1 fotka registrirana → MULTIVIEW_DEGENERATE',
    validateSfmGeometry({ ...sfmOk, registeredCount: 1 }).code === 'MULTIVIEW_DEGENERATE');
  check('11 3D točk na najslabši fotki → MULTIVIEW_DEGENERATE',
    validateSfmGeometry({ ...sfmOk, minPerImageInliers: 11 }).code === 'MULTIVIEW_DEGENERATE');
  check('RMS 3,0001 px → SFM_REPROJECTION_HIGH',
    validateSfmGeometry({ ...sfmOk, reprojRmsPx: 3.0001 }).code === 'SFM_REPROJECTION_HIGH');
  check('RMS je podrejen pomanjkljivim točkam',
    validateSfmGeometry({ ...sfmOk, minPerImageInliers: 1, reprojRmsPx: 99 }).code === 'MULTIVIEW_DEGENERATE');
  check('registrirano število fotk NaN ne more roditi mere',
    validateSfmGeometry({ ...sfmOk, registeredCount: Number.NaN }).code === 'MULTIVIEW_DEGENERATE'
      && validateSfm({ ...sfmOk, registeredCount: Number.NaN, focalSource: 'known', hasScale: true }).status === null);
}

// ── 5. Položaji oseh, ki jih mreža razkrije ─────────────────
{
  console.log('položaji oseh pri para fotk');
  check('dovolj povezav, a BREZ znane reference → geometrija CONSISTENT, merilo NONE',
    validateMultiViewGeometry({ inlierCount: 50, meanResidualPx: 1 }).assurance === 'CONSISTENT'
      && validateMultiViewMetric({ focalMode: 'known', referenceKnown: false }).assurance === 'NONE');
  check('brez reference ni mere, četudi je geometrija potrjena (NO_CALIBRATION + null)',
    (() => {
      const w = validateMultiView({ inlierCount: 50, meanResidualPx: 1, focalMode: 'known', referenceKnown: false });
      return w.ok === false && w.code === 'NO_CALIBRATION' && w.status === null;
    })());
  check('domneven fokus (preset) pade na os merila → ASSUMED',
    validateMultiViewMetric({ focalMode: 'preset', referenceKnown: true }).assurance === 'ASSUMED');
  check('samokalibriran fokus (selfcal) pade na os merila → ASSUMED',
    validateMultiViewMetric({ focalMode: 'selfcal', referenceKnown: true }).assurance === 'ASSUMED');
  check('fokus NE vpliva na geometrijo para',
    (['known', 'preset', 'selfcal'] as const).every((focalMode) =>
      validateMultiViewGeometry({ inlierCount: 50, meanResidualPx: 1, focalMode, referenceKnown: true } as MultiViewGeometryInput).assurance === 'CONSISTENT'));
  check('znana referenca NI meritev — samo REFERENCED (ročna mera je drugje)',
    metricRank(validateMultiViewMetric({ focalMode: 'known', referenceKnown: true }).assurance) === metricRank('REFERENCED'));
}

{
  console.log('položaji oseh pri SfM');
  const base: SfmGeometryInput & SfmMetricInput = {
    registeredCount: 5, totalImages: 5, minPerImageInliers: 40, reprojRmsPx: 1,
    warnings: [], focalSource: 'known', hasScale: true,
  };
  check('SfM brez merila → geometrija CONSISTENT, merilo NONE, brez statusa',
    validateSfmGeometry(base).assurance === 'CONSISTENT'
      && validateSfmMetric({ ...base, hasScale: false }).assurance === 'NONE'
      && validateSfm({ ...base, hasScale: false }).status === null);
  check('SfM z ocenjenim fokusom → ASSUMED → AUTO_SUGGESTED',
    (() => {
      const w = validateSfm({ ...base, focalSource: 'selfcal' });
      return w.code === 'ASSUMED_SCALE' && w.status === 'AUTO_SUGGESTED';
    })());
  check('SfM znan fokus + znano merilo → CALIBRATED',
    (() => {
      const w = validateSfm(base);
      return w.ok === true && w.code === 'OK' && w.status === 'CALIBRATED';
    })());
  check('fokalna izbira NE vpliva na geometrijo SfM',
    (['known', 'preset', 'selfcal'] as const).every((focalSource) =>
      validateSfmGeometry({ ...base, focalSource }).assurance === 'CONSISTENT'));
  check('hasScale NE vpliva na geometrijo SfM',
    validateSfmGeometry({ ...base, hasScale: false }).assurance === 'CONSISTENT');
  check('razlaga ob CALIBRATED pove ŠTEVILO fotk in RMS (ovojnica ju sestavi)',
    validateSfm({ ...base, warnings: ['a', 'b'] }).message.includes('5 fotk')
      && validateSfm({ ...base, warnings: ['a', 'b'] }).message.includes('2 opozoril'));
  check('brez opozoril razlaga NE omenja opozoril',
    !validateSfm({ ...base, warnings: [] }).message.includes('opozoril'));
}

// ── 6. Sporočila so ohranjena beseda-beseda ─────────────────
{
  console.log('sporočila ovojnice = sporočila osi (brez pisave na novo)');
  const mvMsgOk = MV_V1.every((row) => {
    const g = validateMultiViewGeometry(row.input);
    const m = validateMultiViewMetric(row.input);
    const w = validateMultiView(row.input);
    const source = g.code !== 'OK' ? g : m;
    return w.message === source.message && w.nextStep === source.nextStep;
  });
  check('para: ovojnica vrne besedo osi, ki je odločila', mvMsgOk);

  const sfmMsgOk = SFM_V1.every((row) => {
    const g = validateSfmGeometry(row.input);
    const m = validateSfmMetric(row.input);
    const w = validateSfm(row.input);
    if (g.code !== 'OK') return w.message === g.message && w.nextStep === g.nextStep;
    if (m.code !== 'OK') return w.message === m.message && w.nextStep === m.nextStep;
    return w.nextStep === 'Po potrebi preveri z neodvisno metodo (VERIFIED)';
  });
  check('SfM: ovojnica vrne besedo osi, razen pri oboje-znanem izhodu', sfmMsgOk);

  check('edino sestavljeno sporočilo je SfM CALIBRATED in je enako kot na HEAD',
    validateSfm({
      registeredCount: 5, totalImages: 5, minPerImageInliers: 40, reprojRmsPx: 1.5,
      warnings: ['x'], focalSource: 'known', hasScale: true,
    }).message === 'Izmerjeno z inkrementalnim SfM iz 5 fotk (znani fokus + znana referenčna dolžina, RMS 1,5 px, 1 opozoril).');
}

// ── 7. Vrata se sklepajo po paru, ne po statusu (pravilo 14) ─
{
  console.log('posledica za vrata (pravilo 14)');
  const rows: { geo: GeometricAssurance; met: MetricAssurance }[] = [];
  for (const g of GEOMETRY_ORDER) for (const m of METRIC_ORDER) rows.push({ geo: g, met: m });
  check('vsa možna geometrija para je samo UNDEFINED ali CONSISTENT',
    MV_V1.map((r) => validateMultiViewGeometry(r.input).assurance).every((a) => a === 'UNDEFINED' || a === 'CONSISTENT'));
  check('vsa možna geometrija SfM je samo UNDEFINED ali CONSISTENT',
    SFM_V1.map((r) => validateSfmGeometry(r.input).assurance).every((a) => a === 'UNDEFINED' || a === 'CONSISTENT'));
  check('merilo para je eno od NONE / ASSUMED / REFERENCED',
    MV_V1.map((r) => validateMultiViewMetric(r.input).assurance).every((a) => a === 'NONE' || a === 'ASSUMED' || a === 'REFERENCED'));
  check('projekcija para fotk znan fokus + referenca = CALIBRATED in sme na videz',
    projectStatus('CONSISTENT', 'REFERENCED') === 'CALIBRATED' && rows.length === 25);
  check('domneven fokus odpre vrata za videz, zapre vrata za naročilnico',
    (() => {
      const geo = validateMultiViewGeometry({ inlierCount: 40, meanResidualPx: 1 }).assurance;
      const met = validateMultiViewMetric({ focalMode: 'preset', referenceKnown: true }).assurance;
      const st = projectStatus(geo, met);
      return geo === 'CONSISTENT' && met === 'ASSUMED' && st === 'AUTO_SUGGESTED';
    })());
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
