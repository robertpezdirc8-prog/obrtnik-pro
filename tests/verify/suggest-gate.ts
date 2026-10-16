// Verifikacija VRAT za samodejni predlog ravnine (FAZA-9).
//
// Pasovni modul (band-suggest) zmere zgornjo in spodnjo tirnico, NE VE pa, ali
// je na sliki sploh ograja (izmerjeno: na fotkah izven zajema napaka predloga
// do +37 %). Zato UI sme predlog prikazati samo kot NEPOTRJEN štirikotnik —
// jedro to veze na `planeConfirmed`, ta skript pa preverja, da vrata res držijo
// in da obstoječi ročni vnosi NE spremenijo obnašanja.
//
// Zagon: bun tests/verify/suggest-gate.ts
import {
  validateGeometry, validateScale,
  type ScaleValidation,
} from '../../src/lib/measurement-status';
import {
  canRenderMontage, canExportOrder, renderPromiseOf, projectStatus,
} from '../../src/lib/assertion';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// ── 1. Nazaj skladnost: `planeConfirmed` NE sme spremeniti obstoječih vhodov ──
console.log('obstoječi vnosi (brez planeConfirmed) se ne smejo spremeniti:');
{
  const manual = validateGeometry({ method: 'plane-homography', planeCalibrated: true });
  check('planeCalibrated=true brez zastavice → FITTED', manual.assurance === 'FITTED', manual.assurance);
  check('→ izris je dovoljen', canRenderMontage(manual.assurance));
  const undef = validateGeometry({ method: 'plane-homography', planeCalibrated: false });
  check('planeCalibrated=false → UNDEFINED + PLANE_REQUIRED', undef.assurance === 'UNDEFINED' && undef.code === 'PLANE_REQUIRED', `${undef.assurance}/${undef.code}`);
}

// ── 2. Nepotrjen predlog zapre vrata ──────────────────────────────────
console.log('planeConfirmed=false (modul je predlagal, človek še ni rekel da):');
{
  const g = validateGeometry({ method: 'plane-homography', planeCalibrated: true, planeConfirmed: false });
  check('geometrija pade na SUGGESTED', g.assurance === 'SUGGESTED', g.assurance);
  check('napake NI — stanje je veljavno, samo nepotrjeno', g.code === 'OK', g.code);
  check('canRenderMontage=SUGGESTED → FALSE (izris zaprt)', !canRenderMontage(g.assurance));
  check('canExportOrder(SUGGESTED, REFERENCED) → FALSE (naročilnica zaprta)', !canExportOrder(g.assurance, 'REFERENCED'));
  check('canExportOrder(SUGGESTED, MEASURED) → TRUE (mera iz narave ne rabi fotke)',
    canExportOrder(g.assurance, 'MEASURED'));
  check('renderPromiseOf(SUGGESTED, merjena širina, vodoravni profil) → closed',
    renderPromiseOf({ geo: g.assurance, widthMeasured: true, profileOrientation: 'horizontal' }) === 'closed');
  check('projectStatus(SUGGESTED, REFERENCED) → NULL (v ponudbo ne gre)', projectStatus(g.assurance, 'REFERENCED') === null);
  check('sporočilo pove razlog (samodejni predlog, še ni potrjen)', g.message.length > 40 && /predlagan/i.test(g.message) && /ni potrdil/i.test(g.message), g.message);
  check('nextStep pove, kaj narediti', /oglišč/i.test(g.nextStep), g.nextStep);
}

// ── 3. Zastavica NE more rešiti manjkajoče ravnine ────────────────────
console.log('planeConfirmed je nevtralna, kadar ravnine ni:');
{
  const g = validateGeometry({ method: 'plane-homography', planeCalibrated: false, planeConfirmed: true });
  check('planeCalibrated=false + confirmed=true → UNDEFINED (ne FITTED)', g.assurance === 'UNDEFINED', g.assurance);
  const g2 = validateGeometry({ method: 'plane-homography', planeCalibrated: false, planeConfirmed: false });
  check('planeCalibrated=false + confirmed=false → ENAKO kot zgoraj (brez dveh poti)',
    g2.assurance === g.assurance && g2.code === g.code);
}

// ── 4. Potrditev odpre vrata (isti štirikotnik, druga odločitev človeka) ──
console.log('potrditev = EDINI način, da predlog postane FITTED:');
{
  const suggested = validateGeometry({ method: 'plane-homography', planeCalibrated: true, planeConfirmed: false });
  const confirmed = validateGeometry({ method: 'plane-homography', planeCalibrated: true, planeConfirmed: true });
  check('confirmed=true → FITTED', confirmed.assurance === 'FITTED', confirmed.assurance);
  check('par (SUGGESTED, FITTED) se LOČI — vrata niso odvisna od naključja', suggested.assurance !== confirmed.assurance);
  check('izris se odpre ŠELE ob potrditvi', !canRenderMontage(suggested.assurance) && canRenderMontage(confirmed.assurance));
}

// ── 5. validateScale posreduje zastavico (en vhod, obe osi) ───────────
console.log('validateScale (sestavljeno) ne sme izgubiti zastavice:');
{
  const input: ScaleValidation = validateScale({ method: 'plane-homography', planeCalibrated: true, planeConfirmed: false, pxPerCm: 12 });
  check('sklopljena validacija teče skozi (brez PLANE_REQUIRED)', input.code !== 'PLANE_REQUIRED', input.code);
  const manual = validateScale({ method: 'plane-homography', planeCalibrated: true, pxPerCm: 12 });
  check('manualni vnos da RAZLIČNO sporočilo kot nepotrjen predlog', manual.message !== input.message, 'ista beseda = zastavica je izgubljena');
}

// ── 6. Mutacije: dokaz, da vrata res odločajo ─────────────────────────
console.log('mutacijski preizkusi:');
{
  check('nepotrjen predlog NE more dobiti CALIBRATED statusa',
    projectStatus('SUGGESTED', 'REFERENCED') === null && projectStatus('FITTED', 'REFERENCED') === 'CALIBRATED');
  const noTilt = validateGeometry({ method: 'plane-homography', planeCalibrated: true, planeConfirmed: undefined });
  check('undefined ≡ true (sicer bi 90+391 obstoječih trditev padlo)', noTilt.assurance === 'FITTED', noTilt.assurance);
}

console.log(`\n${pass}/${pass + fail} preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
process.exit(fail === 0 ? 0 : 1);
