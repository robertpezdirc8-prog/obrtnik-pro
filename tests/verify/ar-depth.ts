// Numerična verifikacija ar-depth (bun, brez brskalnika) — Task 46
// Iskrena klasifikacija globine ARCore Depth API prek WebXR depth-sensing.
// Robne meje 0,5 m in 5 m so iz raziskave (developers.google.com/ar/develop/depth).
import {
  classifyDepth,
  depthDiscrepancyM,
  DEPTH_DISCREPANCY_WARN_M,
  DEPTH_OPTIMAL_MAX_M,
  DEPTH_OPTIMAL_MIN_M,
  formatDepthM,
} from '../../src/lib/ar-depth';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(got)}`);
  }
}

// 1) Konstante iz raziskave
check('konstante: min 0,5 m', DEPTH_OPTIMAL_MIN_M === 0.5, DEPTH_OPTIMAL_MIN_M);
check('konstante: max 5 m', DEPTH_OPTIMAL_MAX_M === 5, DEPTH_OPTIMAL_MAX_M);
check('konstante: prag razlike 0,5 m', DEPTH_DISCREPANCY_WARN_M === 0.5, DEPTH_DISCREPANCY_WARN_M);

// 2) formatDepthM — sl-SI vejica, 2 decimalki
check('format: 2.34 → "2,34 m"', formatDepthM(2.34) === '2,34 m', formatDepthM(2.34));
check('format: 0.5 → "0,50 m"', formatDepthM(0.5) === '0,50 m', formatDepthM(0.5));
check('format: 5 → "5,00 m"', formatDepthM(5) === '5,00 m', formatDepthM(5));

// 3) classifyDepth — optimalni pas (meje vključene)
{
  const g = classifyDepth(2.34);
  check('2,34 m: optimalno', g?.zone === 'optimal', g);
  check('2,34 m: tone ok', g?.tone === 'ok', g?.tone);
  check('2,34 m: label', g?.label === '2,34 m', g?.label);
  check('0,5 m: še optimalno (spodnja meja)', classifyDepth(0.5)?.zone === 'optimal', classifyDepth(0.5));
  check('5 m: še optimalno (zgornja meja)', classifyDepth(5)?.zone === 'optimal', classifyDepth(5));
}
// 4) classifyDepth — izven pasu = iskreno opozorilo (nikoli popavek)
{
  const near = classifyDepth(0.49);
  check('0,49 m: too-close', near?.zone === 'too-close', near);
  check('0,49 m: tone warn', near?.tone === 'warn', near?.tone);
  const far = classifyDepth(5.01);
  check('5,01 m: far', far?.zone === 'far', far);
  check('5,01 m: tone warn', far?.tone === 'warn', far?.tone);
  check('10 m: far', classifyDepth(10)?.zone === 'far', classifyDepth(10));
  check('opozorilo far omenja laser', classifyDepth(7)?.note.includes('laser') === true, classifyDepth(7)?.note);
}
// 5) classifyDepth — neuporabne vrednosti → null (ne prikazuj ničesar)
check('null → null', classifyDepth(null) === null, classifyDepth(null));
check('undefined → null', classifyDepth(undefined) === null, classifyDepth(undefined));
check('NaN → null', classifyDepth(NaN) === null, classifyDepth(NaN));
check('Infinity → null', classifyDepth(Infinity) === null, classifyDepth(Infinity));
check('0 → null', classifyDepth(0) === null, classifyDepth(0));
check('−1 → null', classifyDepth(-1) === null, classifyDepth(-1));

// 6) depthDiscrepancyM — ročno izračunane razlike
check('razlika |2,0−2,3| = 0,3', depthDiscrepancyM(2.0, 2.3) !== null && Math.abs((depthDiscrepancyM(2.0, 2.3) as number) - 0.3) < 1e-9, depthDiscrepancyM(2.0, 2.3));
check('razlika |3,2−2,0| = 1,2', depthDiscrepancyM(3.2, 2.0) !== null && Math.abs((depthDiscrepancyM(3.2, 2.0) as number) - 1.2) < 1e-9, depthDiscrepancyM(3.2, 2.0));
check('razlika |2,0−2,0| = 0', depthDiscrepancyM(2.0, 2.0) === 0, depthDiscrepancyM(2.0, 2.0));
check('hitDist null → null', depthDiscrepancyM(null, 2) === null, depthDiscrepancyM(null, 2));
check('depth null → null', depthDiscrepancyM(2, null) === null, depthDiscrepancyM(2, null));
check('NaN → null', depthDiscrepancyM(NaN, 2) === null, depthDiscrepancyM(NaN, 2));
check('Infinity → null', depthDiscrepancyM(2, Infinity) === null, depthDiscrepancyM(2, Infinity));

// 7) Skupna logika: namig se pokaže le, ko je razlika nad pragom
{
  const d = depthDiscrepancyM(2.0, 2.7); // 0,7 m > prag 0,5 m
  check('0,7 m razlike presega prag (opozorilo)', d !== null && d > DEPTH_DISCREPANCY_WARN_M, d);
  const d2 = depthDiscrepancyM(2.0, 2.4); // 0,4 m < prag
  check('0,4 m razlike ne presega prag (brez opozorila)', d2 !== null && d2 <= DEPTH_DISCREPANCY_WARN_M, d2);
}

console.log(`\nRezultat: ${pass} uspešnih, ${fail} neuspešnih`);
if (fail > 0) process.exit(1);
