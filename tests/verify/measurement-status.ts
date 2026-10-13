// Verifikacija statusne pogodbe meritev (Task 36 — ROKSAL Faza 1+2):
// statusRank/urejanje, validateScale (vseh 5 kod), downgradeOnReferenceChange,
// makeProvenance (validacija + determinizem), izvoz z oznako statusa
// (measuresToText/measuresToCsv) in JSON round-trip PhotoMeasure.
// Zagon: bun tests/verify/measurement-status.ts
import {
  MEASUREMENT_SCRIPT_VERSION,
  STATUS_ORDER,
  statusRank, worstStatus, statusAtLeast,
  statusLabel, statusHint, statusColor,
  makeProvenance, validateScale, downgradeOnReferenceChange,
  measurementNeedsConfirmation, explainWarning,
  type MeasurementStatus,
} from '../../src/lib/measurement-status';
import { measuresToText, measuresToCsv } from '../../src/lib/measure-geometry';
import type { PhotoMeasure } from '../../src/lib/camera-types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const throws = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};

// ── 1. Urejanje statusov ────────────────────────────────────
{
  console.log('urejanje statusov:');
  check('STATUS_ORDER ima 6 statusov', STATUS_ORDER.length === 6, String(STATUS_ORDER.length));
  check('rank: ESTIMATED < AUTO_SUGGESTED < MANUAL < CALIBRATED < VERIFIED < CONFIRMED',
    statusRank('ESTIMATED') < statusRank('AUTO_SUGGESTED')
    && statusRank('AUTO_SUGGESTED') < statusRank('MANUAL')
    && statusRank('MANUAL') < statusRank('CALIBRATED')
    && statusRank('CALIBRATED') < statusRank('VERIFIED')
    && statusRank('VERIFIED') < statusRank('CONFIRMED'));
  check('rank obsega 0–5', statusRank('ESTIMATED') === 0 && statusRank('CONFIRMED') === 5);
  check('worstStatus: prazen seznam → null', worstStatus([]) === null);
  check('worstStatus: preskoči undefined', worstStatus([undefined, 'CONFIRMED', undefined]) === 'CONFIRMED');
  check('worstStatus: vrne najslabšega', worstStatus(['CONFIRMED', 'ESTIMATED', 'CALIBRATED']) === 'ESTIMATED');
  check('worstStatus: en sam vnos', worstStatus(['VERIFIED']) === 'VERIFIED');
  check('statusAtLeast: CALIBRATED doseže CALIBRATED', statusAtLeast('CALIBRATED', 'CALIBRATED'));
  check('statusAtLeast: AUTO_SUGGESTED NE doseže CALIBRATED', !statusAtLeast('AUTO_SUGGESTED', 'CALIBRATED'));
  check('statusAtLeast: MANUAL NE doseže CALIBRATED', !statusAtLeast('MANUAL', 'CALIBRATED'));
  check('statusAtLeast: CONFIRMED doseže VERIFIED', statusAtLeast('CONFIRMED', 'VERIFIED'));
}

// ── 2. Oznake, razlage, barve ───────────────────────────────
{
  console.log('oznake in barve:');
  check('statusLabel CALIBRATED = Kalibrirano', statusLabel('CALIBRATED') === 'Kalibrirano');
  check('statusLabel AUTO_SUGGESTED = Samodejni predlog', statusLabel('AUTO_SUGGESTED') === 'Samodejni predlog');
  check('statusLabel MANUAL = Ročni vnos', statusLabel('MANUAL') === 'Ročni vnos');
  check('vsi statusi imajo oznako, razlago in barvo', (STATUS_ORDER as readonly MeasurementStatus[]).every((s) => {
    const l = statusLabel(s); const h = statusHint(s); const c = statusColor(s);
    return l.length > 0 && h.length > 10 && c.badge.length > 0 && c.dot.length > 0;
  }));
  check('hint za AUTO_SUGGESTED omenja domnevno referenco', statusHint('AUTO_SUGGESTED').includes('domnevne reference'));
  check('barve: nesigurane amber', statusColor('ESTIMATED').badge.includes('amber') && statusColor('AUTO_SUGGESTED').dot.includes('amber'));
  check('barve: MANUAL stone', statusColor('MANUAL').badge.includes('stone') && statusColor('MANUAL').dot.includes('stone'));
  check('barve: CALIBRATED+ green', (['CALIBRATED', 'VERIFIED', 'CONFIRMED'] as const).every((s) => statusColor(s).badge.includes('green')));
  check('brez modro/indigo razredov', (STATUS_ORDER as readonly MeasurementStatus[]).every((s) => {
    const c = statusColor(s);
    return !c.badge.includes('blue') && !c.badge.includes('indigo') && !c.dot.includes('blue') && !c.dot.includes('indigo');
  }));
}

// ── 3. validateScale — vseh 5 kod ───────────────────────────
{
  console.log('validateScale:');

  // NO_CALIBRATION — NIKOLI privzetega merila
  const none = validateScale({});
  check('brez kalibracije → NO_CALIBRATION', !none.ok && none.code === 'NO_CALIBRATION', JSON.stringify(none));
  check('NO_CALIBRATION: status null', none.status === null);
  check('NO_CALIBRATION: sporočilo oziroma MERITEV NI NA VOLJO', none.message.includes('MERITEV NI NA VOLJO'));
  check('NO_CALIBRATION: nextStep = Umeri merilo', none.nextStep === 'Umeri merilo');
  const zero = validateScale({ pxPerCm: 0 });
  check('pxPerCm = 0 → NO_CALIBRATION (ne privzetka)', zero.code === 'NO_CALIBRATION');
  const neg = validateScale({ pxPerCm: -2 });
  check('pxPerCm negativen → NO_CALIBRATION', neg.code === 'NO_CALIBRATION');
  const nan = validateScale({ pxPerCm: NaN });
  check('pxPerCm NaN → NO_CALIBRATION', nan.code === 'NO_CALIBRATION');

  // ASSUMED_SCALE — orientacijsko dovoljeno, status AUTO_SUGGESTED
  const assumed = validateScale({ pxPerCm: 2, method: 'assumed-reference' });
  check('assumed-reference → ASSUMED_SCALE, ok true', assumed.ok && assumed.code === 'ASSUMED_SCALE');
  check('ASSUMED_SCALE → status AUTO_SUGGESTED', assumed.status === 'AUTO_SUGGESTED');
  check('ASSUMED_SCALE: mera NI potrjena', assumed.message.includes('NI potrjena'));
  check('ASSUMED_SCALE: poševni posnetek — eno merilo ne velja za vse smeri', assumed.message.includes('ne velja za vse smeri'));
  check('ASSUMED_SCALE: nextStep = Kalibriraj ravnino (4 oglišča)', assumed.nextStep === 'Kalibriraj ravnino (4 oglišča)');

  // known-length ± plane
  const known = validateScale({ pxPerCm: 2, method: 'known-length' });
  check('known-length brez plane → CALIBRATED', known.ok && known.status === 'CALIBRATED', JSON.stringify(known));
  check('known-length brez plane: opozorilo o smeri reference', known.message.includes('smer reference') && known.message.includes('ravnino'));
  const knownPlane = validateScale({ pxPerCm: 2, method: 'known-length', planeCalibrated: true });
  check('known-length + plane → CALIBRATED (ravnina velja za vse smeri)', knownPlane.ok && knownPlane.status === 'CALIBRATED' && knownPlane.message.includes('vse smeri'));

  // manual-measure / laser → MANUAL
  const manual = validateScale({ pxPerCm: 2, method: 'manual-measure' });
  check('manual-measure → MANUAL', manual.ok && manual.status === 'MANUAL');
  const laser = validateScale({ method: 'laser', pxPerCm: null });
  check('laser brez pxPerCm → MANUAL (neodvisen od fotke)', laser.ok && laser.status === 'MANUAL', JSON.stringify(laser));

  // plane-homography
  const plane = validateScale({ method: 'plane-homography', planeCalibrated: true });
  check('plane-homography → CALIBRATED', plane.ok && plane.status === 'CALIBRATED');
  const planeMissing = validateScale({ method: 'plane-homography', planeCalibrated: false });
  check('plane-homography brez plane → PLANE_REQUIRED (eksplicitno)', !planeMissing.ok && planeMissing.code === 'PLANE_REQUIRED' && planeMissing.status === null);
  check('PLANE_REQUIRED: NEZADOSTNI PODATKI', planeMissing.message.includes('NEZADOSTNI PODATKI'));

  // ravnina ima prednost, tudi ko globalno merilo manjka
  const planeOnly = validateScale({ pxPerCm: null, method: 'plane-homography', planeCalibrated: true });
  check('samo ravnina (pxPerCm null) → CALIBRATED', planeOnly.ok && planeOnly.status === 'CALIBRATED', JSON.stringify(planeOnly));

  // DEGENERATE_REFERENCE — premajhna/velika referenca
  const tiny = validateScale({ pxPerCm: 0.01, method: 'known-length' });
  check('pxPerCm 0,01 → DEGENERATE_REFERENCE', !tiny.ok && tiny.code === 'DEGENERATE_REFERENCE' && tiny.status === null, JSON.stringify(tiny));
  const huge = validateScale({ pxPerCm: 6000, method: 'known-length' });
  check('pxPerCm 6000 → DEGENERATE_REFERENCE', !huge.ok && huge.code === 'DEGENERATE_REFERENCE');
  check('DEGENERATE_REFERENCE: ponovi z večjim objektom', tiny.message.includes('večjim') && tiny.nextStep.includes('Ponovi umerjanje'));
  const okEdge = validateScale({ pxPerCm: 0.05, method: 'known-length' });
  check('pxPerCm = min meja (0,05) je še vedno OK', okEdge.ok, JSON.stringify(okEdge));
  const customMin = validateScale({ pxPerCm: 0.3, minPxPerCm: 0.5 });
  check('lastni minPxPerCm upoštevan', !customMin.ok && customMin.code === 'DEGENERATE_REFERENCE');
}

// ── 4. downgradeOnReferenceChange + potrditev ───────────────
{
  console.log('downgrade ob spremembi reference:');
  check('CONFIRMED + sprememba → AUTO_SUGGESTED', downgradeOnReferenceChange('CONFIRMED', true) === 'AUTO_SUGGESTED');
  check('VERIFIED + sprememba → AUTO_SUGGESTED', downgradeOnReferenceChange('VERIFIED', true) === 'AUTO_SUGGESTED');
  check('CALIBRATED + sprememba → AUTO_SUGGESTED', downgradeOnReferenceChange('CALIBRATED', true) === 'AUTO_SUGGESTED');
  check('ESTIMATED + sprememba → ostane ESTIMATED', downgradeOnReferenceChange('ESTIMATED', true) === 'ESTIMATED');
  check('AUTO_SUGGESTED + sprememba → ostane', downgradeOnReferenceChange('AUTO_SUGGESTED', true) === 'AUTO_SUGGESTED');
  check('MANUAL + sprememba → ostane MANUAL', downgradeOnReferenceChange('MANUAL', true) === 'MANUAL');
  check('brez spremembe → status ohranjen', downgradeOnReferenceChange('CONFIRMED', false) === 'CONFIRMED');

  check('potrditev potrebna: ESTIMATED in AUTO_SUGGESTED', measurementNeedsConfirmation('ESTIMATED') && measurementNeedsConfirmation('AUTO_SUGGESTED'));
  check('potrditev NI potrebna: MANUAL+', !(('MANUAL CALIBRATED VERIFIED CONFIRMED'.split(' ')) as MeasurementStatus[]).some((s) => measurementNeedsConfirmation(s)));
}

// ── 5. makeProvenance — konstruktor + validacija ────────────
{
  console.log('makeProvenance:');
  const p = makeProvenance({
    method: 'known-length',
    status: 'CALIBRATED',
    valueCm: 250,
    points: [{ x: 10, y: 20 }, { x: 60, y: 20 }],
    reference: { valueCm: 200, label: 'Vrata', assumed: false },
    createdAt: '2025-01-15T08:30:00.000Z',
  });
  check('scriptVersion vstavljen', p.scriptVersion === MEASUREMENT_SCRIPT_VERSION && MEASUREMENT_SCRIPT_VERSION === '1.0.0');
  check('privzeta enota cm + transform global-px-per-cm', p.unit === 'cm' && p.transform === 'global-px-per-cm');
  check('photoId/note privzeto null', p.sourcePhotoId === null && p.note === null);
  check('točke prekopirane', p.points.length === 2 && p.points[0].x === 10);
  check('plane-homography → transform plane-homography', makeProvenance({ method: 'plane-homography', status: 'CALIBRATED', valueCm: null, createdAt: '2025-01-15T08:30:00.000Z' }).transform === 'plane-homography');
  check('laser → transform none', makeProvenance({ method: 'laser', status: 'MANUAL', valueCm: 180, createdAt: '2025-01-15T08:30:00.000Z' }).transform === 'none');

  check('negativna valueCm → Error', throws(() => makeProvenance({ method: 'known-length', status: 'CALIBRATED', valueCm: -1, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('NaN valueCm → Error', throws(() => makeProvenance({ method: 'known-length', status: 'CALIBRATED', valueCm: NaN, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('neznana metoda → Error', throws(() => makeProvenance({ method: 'magic' as never, status: 'CALIBRATED', valueCm: 1, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('neznana enota → Error', throws(() => makeProvenance({ method: 'laser', status: 'MANUAL', valueCm: 1, unit: 'km' as never, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('manjkajoč createdAt → Error', throws(() => makeProvenance({ method: 'laser', status: 'MANUAL', valueCm: 1, createdAt: '' })));
  check('ne-ISO createdAt → Error', throws(() => makeProvenance({ method: 'laser', status: 'MANUAL', valueCm: 1, createdAt: 'ni-cas' })));
  check('referenca ≤ 0 → Error', throws(() => makeProvenance({ method: 'assumed-reference', status: 'AUTO_SUGGESTED', valueCm: 5, reference: { valueCm: 0, label: 'Vrata', assumed: true }, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('POGODBA: assumed-reference + CONFIRMED → Error', throws(() => makeProvenance({ method: 'assumed-reference', status: 'CONFIRMED', valueCm: 250, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('POGODBA: assumed-reference + CALIBRATED → Error', throws(() => makeProvenance({ method: 'assumed-reference', status: 'CALIBRATED', valueCm: 250, createdAt: '2025-01-15T08:30:00.000Z' })));
  check('valueCm 0 je dovoljena (kot, 0 cm)', !throws(() => makeProvenance({ method: 'laser', status: 'MANUAL', valueCm: 0, createdAt: '2025-01-15T08:30:00.000Z' })));

  // determinizem: ista vhoda → identičen JSON (createdAt od zunaj!)
  const input = {
    method: 'assumed-reference' as const,
    status: 'AUTO_SUGGESTED' as const,
    valueCm: 250,
    points: [{ x: 5.5, y: 10.25 }, { x: 55.5, y: 10.25 }],
    reference: { valueCm: 200, label: 'Vrata 200', assumed: true },
    createdAt: '2025-01-15T08:30:00.000Z',
  };
  check('determinizem: identičen JSON.stringify', JSON.stringify(makeProvenance(input)) === JSON.stringify(makeProvenance(input)));
  check('determinizem: znani izpis', JSON.stringify(makeProvenance(input)) === JSON.stringify({
    scriptVersion: '1.0.0', method: 'assumed-reference', status: 'AUTO_SUGGESTED', valueCm: 250, unit: 'cm',
    sourcePhotoId: null, points: [{ x: 5.5, y: 10.25 }, { x: 55.5, y: 10.25 }],
    reference: { valueCm: 200, label: 'Vrata 200', assumed: true }, transform: 'global-px-per-cm',
    createdAt: '2025-01-15T08:30:00.000Z', note: null,
  }));
}

// ── 6. Izvoz: besedilo + CSV z oznako statusa ───────────────
{
  console.log('izvoz meritve:');
  const plain: PhotoMeasure[] = [
    { id: 'm1', label: 'Mer 1', kind: 'length', value: 250, points: [[10, 20], [60, 20]] },
  ];
  const tagged: PhotoMeasure[] = [
    { id: 'm2', label: 'Mer 1', kind: 'length', value: 250, points: [[10, 20], [60, 20]], status: 'CALIBRATED', method: 'known-length' },
  ];

  // regresija: brez statusa je besedilo NESPREMENJENO
  check('measuresToText brez statusa: nespremenjen', measuresToText(plain) === 'Mer 1: 2,50 m', measuresToText(plain));
  check('measuresToText s statusom: oznaka v oklepaju', measuresToText(tagged) === 'Mer 1: 2,50 m (kalibrirano)', measuresToText(tagged));

  const areaPlain: PhotoMeasure[] = [{ id: 'a1', label: 'Površina 1', kind: 'area', value: 12.5, points: [[0, 0], [50, 0], [50, 25]], sides: [250, 125] }];
  const areaTagged: PhotoMeasure[] = [{ ...areaPlain[0], id: 'a2', status: 'AUTO_SUGGESTED', method: 'assumed-reference' }];
  check('measuresToText površina brez statusa: nespremenjena', measuresToText(areaPlain) === 'Površina 1 (površina): 12,5 m²', measuresToText(areaPlain));
  check('measuresToText površina s statusom: (samodejni predlog)', measuresToText(areaTagged).endsWith('(samodejni predlog)'), measuresToText(areaTagged));

  // CSV: status stolpec na KONCU, obstoječi stolpci ostanejo
  const csvPlain = measuresToCsv(plain);
  const csvTagged = measuresToCsv(tagged);
  check('CSV glava ima status kot zadnji stolpec', csvPlain.split('\n')[0] === 'vrsta,oznaka,vrednost,enota,opomba,status', csvPlain.split('\n')[0]);
  check('CSV brez statusa: prazno polje, obstoječi stolpci enaki', csvPlain.split('\n')[1] === '"Dolžina","Mer 1",250,cm,,', csvPlain.split('\n')[1]);
  check('CSV s statusom: Kalibrirano na koncu', csvTagged.split('\n')[1] === '"Dolžina","Mer 1",250,cm,,Kalibrirano', csvTagged.split('\n')[1]);
  // opomba v CSV NI escapana (obstoječe vedenje) — vejice znotraj opombe
  // so obstoječa značilnost izhoda; status je VEDNO zadnje polje vrstice
  check('CSV površina s statusom: Samodejni predlog', measuresToCsv(areaTagged).split('\n')[1] === '"Površina","Površina 1",12,5,m²,strani: 2,50 m + 1,25 m,Samodejni predlog', measuresToCsv(areaTagged).split('\n')[1]);

  // veriga: oznaka na koncu vrstice
  const chain: PhotoMeasure[] = [{ id: 'c1', label: 'Veriga 1', kind: 'chain', value: 350, points: [[0, 0], [30, 5]], sides: [200, 150], slopeDeg: 12.5, status: 'CALIBRATED', method: 'plane-homography' }];
  const chainTxt = measuresToText(chain);
  check('measuresToText veriga: oznaka na koncu', chainTxt.endsWith('(kalibrirano)') && chainTxt.includes('naklon'), chainTxt);

  // angle
  const angle: PhotoMeasure[] = [{ id: 'g1', label: 'Kot 1', kind: 'angle', value: 90, points: [[0, 0], [10, 0], [0, 10]], status: 'MANUAL', method: 'manual-measure' }];
  check('measuresToText kot: (ročni vnos)', measuresToText(angle) === 'Kot 1 (kot): 90° (ročni vnos)', measuresToText(angle));
}

// ── 7. PhotoMeasure JSON round-trip ─────────────────────────
{
  console.log('serializacija:');
  const m: PhotoMeasure = {
    id: 'm9', label: 'Mer 9', kind: 'length', value: 123.4,
    points: [[1.5, 2.5], [45.5, 2.5]], status: 'AUTO_SUGGESTED', method: 'assumed-reference',
  };
  const rt = JSON.parse(JSON.stringify(m)) as PhotoMeasure;
  check('round-trip ohrani status in metodo', rt.status === 'AUTO_SUGGESTED' && rt.method === 'assumed-reference');
  check('round-trip ohrani obstoječa polja', rt.id === 'm9' && rt.value === 123.4 && rt.points.length === 2);
  const noStatus = JSON.parse(JSON.stringify({ id: 'x', label: 'x', kind: 'length', value: null, points: [] } satisfies PhotoMeasure)) as PhotoMeasure;
  check('meritev brez statusa se serializira brez ključev', noStatus.status === undefined && noStatus.method === undefined);
}

// ── 8. explainWarning — vsaka koda ima slovensko razlago ───
{
  console.log('razlage opozoril:');
  const codes = ['OK', 'NO_CALIBRATION', 'ASSUMED_SCALE', 'DEGENERATE_REFERENCE', 'PLANE_REQUIRED'] as const;
  check('vsaka koda ima neprazno razlago', codes.every((c) => explainWarning(c).length > 20));
  check('NO_CALIBRATION razlaga: kaj naj monter ponovno izmeri', explainWarning('NO_CALIBRATION').includes('umeri merilo'));
  check('ASSUMED_SCALE razlaga omenja procentsko napako domneve', explainWarning('ASSUMED_SCALE').includes('DOMNEVNE'));
  check('DEGENERATE razlaga omenja ~20 pikslov', explainWarning('DEGENERATE_REFERENCE').includes('pikslov'));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
