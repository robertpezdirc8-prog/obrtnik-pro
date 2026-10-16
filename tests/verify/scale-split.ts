// Diferenčni test razcepa (FAZA-8 korak 3–4): nova izvedba `validateScale`
// (sestavljena iz `validateGeometry` + `validateMetric`) se meri s SNAPSHOTOM
// HEAD obnašanja (147 kombinacij, generirano iz `git show HEAD:...`).
// Test ne trdi, da je razcep enak — trdi, da je razlika NATANČNO tista, ki jo
// napoveduje FAZA-8 §3.2.1, da je enosmerna (nikoli glasnija) in da jo
// projekcija para reprodukcira.
// Zagon: bun tests/verify/scale-split.ts
import {
  validateScale, validateGeometry, validateMetric,
  downgradeOnReferenceChange, downgradeMetricOnReferenceChange, downgradeGeometryOnQuadChange,
  type ScaleValidationInput,
} from '../../src/lib/measurement-status';
import {
  projectStatus, geometryRank, metricRank,
  GEOMETRY_ORDER, METRIC_ORDER,
  type GeometricAssurance, type MetricAssurance,
} from '../../src/lib/assertion';
import { V1_TABLE, V1_COMBO_COUNT } from '../fixtures/validate-scale-v1';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const RANK: Record<string, number> = { ESTIMATED: 0, AUTO_SUGGESTED: 1, MANUAL: 2, CALIBRATED: 3, VERIFIED: 4, CONFIRMED: 5 };

// ── 1. Diferenca proti HEAD ─────────────────────────────────
const diffs: { input: ScaleValidationInput; v1: string; v2: string }[] = [];
let identical = 0;
for (const row of V1_TABLE) {
  const input = row.input as ScaleValidationInput;
  const now = validateScale(input);
  const was = row.out;
  const same = now.ok === was.ok && now.code === was.code && now.status === was.status
    && now.message === was.message && now.nextStep === was.nextStep;
  if (same) { identical++; continue; }
  diffs.push({ input, v1: `${was.code}/${String(was.status)}`, v2: `${now.code}/${String(now.status)}` });
}

{
  console.log('diferenca proti HEAD snapshotu:');
  check('snapshot pokriva 147 kombinacij', V1_TABLE.length === 147 && V1_COMBO_COUNT === 147, String(V1_TABLE.length));
  check('enakih izhodov je 140', identical === 140, String(identical));
  check('različnih izhodov je natanko 7', diffs.length === 7, JSON.stringify(diffs));
  check('vse razlike so method=assumed-reference IN planeCalibrated=true',
    diffs.every((d) => d.input.method === 'assumed-reference' && d.input.planeCalibrated === true),
    JSON.stringify(diffs.map((d) => d.input)));
  check('nobena razlika ne nastopa brez ravnine',
    V1_TABLE.filter((r) => r.input.method === 'assumed-reference' && r.input.planeCalibrated !== true)
      .every((r) => {
        const now = validateScale(r.input as ScaleValidationInput);
        return now.code === r.out.code && now.status === r.out.status;
      }));
  check('nobena razlika NE dvigne statusa (nova izvedba je največ enako glasna)',
    diffs.every((d) => (RANK[d.v2.split('/')[1]] ?? -1) <= (RANK[d.v1.split('/')[1]] ?? -1)));
  check('HEAD je v vseh sedmih dal CALIBRATED (tihi bug, korak 3 pred metodo)',
    diffs.every((d) => d.v1 === 'OK/CALIBRATED'), JSON.stringify(diffs.map((d) => d.v1)));
  check('nova izvedba jih je sprevrgla v ASSUMED_SCALE ali DEGENERATE_REFERENCE',
    diffs.every((d) => d.v2 === 'ASSUMED_SCALE/AUTO_SUGGESTED' || d.v2 === 'DEGENERATE_REFERENCE/null'),
    JSON.stringify(diffs.map((d) => d.v2)));
  check('trije z veljavnim merilom (2, 0,01, 6000) — dva degenerirana, eden domneven',
    diffs.filter((d) => d.v2 === 'DEGENERATE_REFERENCE/null').length === 2
    && diffs.filter((d) => d.v2 === 'ASSUMED_SCALE/AUTO_SUGGESTED').length === 5);
  check('razlika NI naključna: vsaka vsebuje umerjeno ravnino in domnevno referenco',
    diffs.every((d) => d.input.planeCalibrated === true && d.input.method === 'assumed-reference'));
}

// ── 2. Sestava: status JE projekcija para ──────────────────
{
  console.log('projekcija para reprodukcira izhod:');
  let mismatch = 0;
  const bad: string[] = [];
  for (const row of V1_TABLE) {
    const input = row.input as ScaleValidationInput;
    const now = validateScale(input);
    const projected = projectStatus(validateGeometry(input).assurance, validateMetric(input).assurance);
    if (now.status !== projected) { mismatch++; if (bad.length < 3) bad.push(`${JSON.stringify(input)} → ${String(now.status)} vs ${String(projected)}`); }
  }
  check('status = projectStatus(geo, met) za vseh 147 kombinacij', mismatch === 0, bad.join(' | '));
  check('ok je res false natanko takrat, ko status projekcije ni mogoč',
    V1_TABLE.every((row) => {
      const input = row.input as ScaleValidationInput;
      const now = validateScale(input);
      return now.ok === (projectStatus(validateGeometry(input).assurance, validateMetric(input).assurance) !== null);
    }));
}

// ── 3. Lokacija kod (kdo sme napovedati kaj) ───────────────
{
  console.log('koda živi na svoji osi:');
  const geos = V1_TABLE.map((r) => validateGeometry(r.input as ScaleValidationInput));
  const mets = V1_TABLE.map((r) => validateMetric(r.input as ScaleValidationInput));
  check('validateGeometry pozna samo OK in PLANE_REQUIRED',
    geos.every((g) => g.code === 'OK' || g.code === 'PLANE_REQUIRED'));
  check('validateMetric ne pozna PLANE_REQUIRED',
    mets.every((m) => m.code !== 'PLANE_REQUIRED'));
  check('validateGeometry ne pozna DEGENERATE_REFERENCE',
    geos.every((g) => !(g.code as string).includes('DEGENERATE')));
  check('os geometrije ne pozna NO_CALIBRATION (to je vprašanje cm)',
    geos.every((g) => !(g.code as string).includes('NO_CALIBRATION')));
  check('validateGeometry iz teh vhodov NE more doseči CONSISTENT (to rabi drugi pogled)',
    geos.every((g) => g.assurance !== 'CONSISTENT'));
  check('validateMetric iz teh vhodov NE more doseči CROSS_CHECKED (to rabi drugi vir)',
    mets.every((m) => m.assurance !== 'CROSS_CHECKED'));
  check('PLANE_REQUIRED pomeni geo UNDEFINED, nikoli FITTED',
    geos.every((g) => g.code !== 'PLANE_REQUIRED' || g.assurance === 'UNDEFINED'));
  check('umerjena ravnina JE vedno FITTED',
    geos.every((g, i) => g.assurance !== 'FITTED' || V1_TABLE[i].input.planeCalibrated === true));
  check('geo UNDEFINED pomeni, da ravnina NI umerjena (nikoli obratno)',
    geos.every((g, i) => g.assurance !== 'UNDEFINED' || V1_TABLE[i].input.planeCalibrated !== true));
  check('ASSUMED nikoli ne nastopi skupaj z geo UNDEFINED (domneva rabi smer)',
    V1_TABLE.every((r) => {
      const m = validateMetric(r.input as ScaleValidationInput);
      if (m.assurance !== 'ASSUMED') return true;
      return geometryRank(validateGeometry(r.input as ScaleValidationInput).assurance) >= geometryRank('ORIENTED');
    }));
}

// ── 4. Preglednica §3.2.1 — pari, ne samo izhodi ───────────
{
  console.log('§3.2.1 pari:');
  const cases: [ScaleValidationInput, GeometricAssurance, MetricAssurance][] = [
    [{}, 'UNDEFINED', 'NONE'],
    [{ pxPerCm: 2, method: 'assumed-reference' }, 'ORIENTED', 'ASSUMED'],
    [{ pxPerCm: 2, method: 'known-length' }, 'ORIENTED', 'REFERENCED'],
    [{ pxPerCm: 2, method: 'known-length', planeCalibrated: true }, 'FITTED', 'REFERENCED'],
    [{ pxPerCm: 2, method: 'manual-measure' }, 'ORIENTED', 'MEASURED'],
    [{ method: 'laser', pxPerCm: null }, 'UNDEFINED', 'MEASURED'],
    [{ method: 'plane-homography', planeCalibrated: true }, 'FITTED', 'REFERENCED'],
    [{ method: 'plane-homography', planeCalibrated: false }, 'UNDEFINED', 'NONE'],
    [{ pxPerCm: 0.01, method: 'known-length' }, 'ORIENTED', 'NONE'],
    [{ pxPerCm: 2, method: 'assumed-reference', planeCalibrated: true }, 'FITTED', 'ASSUMED'],
  ];
  for (const [input, geo, met] of cases) {
    const g = validateGeometry(input).assurance;
    const m = validateMetric(input).assurance;
    check(`${JSON.stringify(input)} → (${geo}, ${met})`, g === geo && m === met, `dobljeno (${g}, ${m})`);
  }
  check('edina namerna razlika: FITTED + ASSUMED = AUTO_SUGGESTED (ne CALIBRATED)',
    validateScale({ pxPerCm: 2, method: 'assumed-reference', planeCalibrated: true }).status === 'AUTO_SUGGESTED');
  check('razlaga domneve ostane izpisana tudi z umerjeno ravnino',
    validateScale({ pxPerCm: 2, method: 'assumed-reference', planeCalibrated: true }).message.includes('NI potrjena'));
  check('geometrijska razlaga FITTED ostane dosegljiva (par jo prekrije, os ne)',
    validateGeometry({ pxPerCm: 2, method: 'assumed-reference', planeCalibrated: true }).message.includes('vse smeri'));
}

// ── 5. Ločena downgrade (D4, pravilo 12) ──────────────────
{
  console.log('ločena downgrade:');
  // Metrika: samo fotni vir_shranjen dolžini padeta; trak/laser sta nedotaknjena.
  check('REFERENCED + sprememba reference → ASSUMED', downgradeMetricOnReferenceChange('REFERENCED', true) === 'ASSUMED');
  check('CROSS_CHECKED + sprememba → MEASURED (preverba razpade, izmera ostane)',
    downgradeMetricOnReferenceChange('CROSS_CHECKED', true) === 'MEASURED');
  check('MEASURED + sprememba → OSTANE (laser ne izhaja iz reference)',
    downgradeMetricOnReferenceChange('MEASURED', true) === 'MEASURED');
  check('ASSUMED + sprememba → OSTANE (domneva je že domneva)',
    downgradeMetricOnReferenceChange('ASSUMED', true) === 'ASSUMED');
  check('NONE + sprememba → OSTANE', downgradeMetricOnReferenceChange('NONE', true) === 'NONE');
  check('brez spremembe merilo nikoli ne padne',
    METRIC_ORDER.every((m) => downgradeMetricOnReferenceChange(m, false) === m));
  check('metrični downgrade je enosmeren (nikoli ne dvigne ranga)',
    METRIC_ORDER.every((m) => metricRank(downgradeMetricOnReferenceChange(m, true)) <= metricRank(m)));

  // Geometrija: padeta FITTED in CONSISTENT, ostali ostanejo.
  check('FITTED + nov štirikotnik → SUGGESTED', downgradeGeometryOnQuadChange('FITTED', true) === 'SUGGESTED');
  check('CONSISTENT + nov štirikotnik → SUGGESTED (drugi pogled velja za stari okvir)',
    downgradeGeometryOnQuadChange('CONSISTENT', true) === 'SUGGESTED');
  check('ORIENTED + nov štirikotnik → OSTANE (globalno merilo ne visi na ogliščih)',
    downgradeGeometryOnQuadChange('ORIENTED', true) === 'ORIENTED');
  check('SUGGESTED/UNDEFINED + nov štirikotnik → ostaneta',
    downgradeGeometryOnQuadChange('SUGGESTED', true) === 'SUGGESTED' && downgradeGeometryOnQuadChange('UNDEFINED', true) === 'UNDEFINED');
  check('brez spremembe geometrija nikoli ne padne',
    GEOMETRY_ORDER.every((g) => downgradeGeometryOnQuadChange(g, false) === g));
  check('geometrijski downgrade je enosmeren',
    GEOMETRY_ORDER.every((g) => geometryRank(downgradeGeometryOnQuadChange(g, true)) <= geometryRank(g)));

  // KLJUČNO: sprehod čez pare (pravilo 12 — ena os ne razveljavi druge).
  const start: [GeometricAssurance, MetricAssurance] = ['FITTED', 'REFERENCED'];
  const afterRef: [GeometricAssurance, MetricAssurance] = [start[0], downgradeMetricOnReferenceChange(start[1], true)];
  const afterQuad: [GeometricAssurance, MetricAssurance] = [downgradeGeometryOnQuadChange(start[0], true), start[1]];
  check('začetni par (FITTED, REFERENCED) → CALIBRATED, oba vratna pogoja',
    projectStatus(...start) === 'CALIBRATED');
  check('sprememba reference pusti RAVNINO pri miru (geo ostane FITTED)',
    afterRef[0] === 'FITTED' && afterRef[1] === 'ASSUMED');
  check('sprememba reference: izris OSTANE dovoljen, naročilnica padne',
    projectStatus(...afterRef) === 'AUTO_SUGGESTED');
  check('sprememba štirikotnika pusti MERILO pri miru (met ostane REFERENCED)',
    afterQuad[1] === 'REFERENCED' && afterQuad[0] === 'SUGGESTED');
  check('sprememba štirikotnika: izris se ZAPRE (rabi potrjen okvir)',
    projectStatus(...afterQuad) === null);
  check('DANES ena sama downgrade funkcija ne more ločiti tega para (zato ovojnica obstaja)',
    downgradeOnReferenceChange('CALIBRATED', true) === 'AUTO_SUGGESTED'
    && projectStatus(...afterQuad) !== downgradeOnReferenceChange('CALIBRATED', true));
}

// ── 6. Stara ovojnica nespremenjena ────────────────────────
{
  console.log('projekcijska ovojnica (backup, ne sme spremeniti behavior):');
  check('ovojnica ohrani vseh 6 statusov ob spremembi', (['ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED'] as const)
    .every((s) => {
      const next = downgradeOnReferenceChange(s, true);
      return (s === 'CALIBRATED' || s === 'VERIFIED' || s === 'CONFIRMED') ? next === 'AUTO_SUGGESTED' : next === s;
    }));
  check('ovojnica ob nespremembi vrne isti status',
    (['ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED'] as const)
      .every((s) => downgradeOnReferenceChange(s, false) === s));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
