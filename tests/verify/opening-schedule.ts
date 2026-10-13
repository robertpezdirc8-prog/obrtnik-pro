// Task 28 — preverba popisa odprtin (čisto jedro, brez DOM)
// Poženi: bun tests/verify/opening-schedule.ts
import {
  buildOpeningSchedule, formatScheduleText, openingIoU, prefillOknaVrata,
  scheduleToCsv, type OpeningBoxInput,
} from '../../src/lib/opening-schedule';
import type { ScaleSuggestion } from '../../src/lib/camera-types';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function near(a: number | null, b: number, tol: number): boolean {
  return a !== null && Math.abs(a - b) <= tol;
}

const sugg = (
  id: string, kind: 'vrata' | 'okno', box: [number, number, number, number],
  confidence: number, assumedCm: number,
): ScaleSuggestion => ({
  id, kind, label: id, box, assumedCm, pxPerCm: 1, confidence,
  confidenceLabel: confidence >= 75 ? 'visoka' : confidence >= 55 ? 'srednja' : 'nizka',
  impliedWidthCm: 100, widthPlausible: true,
});

console.log('── 1) Osnovni popis: vrata 100×200 + 2 okni 120×120, isto merilo (2 px/cm @ 960×720) ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      // 208×400 px = 104×200 cm @ 2,0016 px/cm (412 px/206 cm ≈ 2,0)
      sugg('door-1', 'vrata', [36.67, 40.28, 21.67, 55.56], 80, 200),
      // 252×252 px = 126×126 cm
      sugg('window-1', 'okno', [8.33, 16.67, 26.25, 35.0], 70, 120),
      sugg('window-2', 'okno', [64.58, 16.67, 26.25, 35.0], 68, 120),
    ],
    naturalWidth: 960,
    naturalHeight: 720,
  });
  ok(s.calibration !== null, 'kalibracija zgrajena');
  ok(s.calibration?.refId === 'door-1', 'referenca = vrata (najboljša po sortiranju)');
  ok(near(s.calibration?.pxPerCm ?? 0, 2.0, 0.01), `pxPerCm ≈ 2,0 (${s.calibration?.pxPerCm?.toFixed(3)})`);
  ok(s.openings.length === 3, '3 odprtine, brez dedupa');
  ok(s.doorCount === 1 && s.windowCount === 2, '1 vrata + 2 okni');
  const d = s.openings.find((o) => o.id === 'door-1');
  ok(d !== undefined && d.label === 'Vrata', 'ena vrata → oznaka brez številke');
  ok(near(d?.widthCm ?? 0, 104, 1) && near(d?.heightCm ?? 0, 200, 1), `vrata 104×200 (izmerjeno ${d?.widthCm}×${d?.heightCm})`);
  const w1 = s.openings.find((o) => o.id === 'window-1');
  const w2 = s.openings.find((o) => o.id === 'window-2');
  ok(w1?.label === 'Okno 1' && w2?.label === 'Okno 2', 'okna oštevilčena po legi (levo→desno)');
  ok(near(w1?.widthCm ?? 0, 126, 1) && near(w1?.heightCm ?? 0, 126, 1), `okno 126×126 (${w1?.widthCm}×${w1?.heightCm})`);
  ok(w1?.areaM2 === 1.59, `površina okna 1,59 m² (${w1?.areaM2})`);
  ok(s.openings[0].kind === 'vrata', 'vrata na prvem mestu popisa');
  ok(near(s.windowAvgM2 ?? 0, 1.59, 0.01), 'povprečno okno 1,59 m²');
  ok(near(s.totalGlazingM2 ?? 0, 2.08 + 2 * 1.59, 0.05), `skupaj ≈ 5,26 m² (${s.totalGlazingM2})`);
  ok(s.dedupCount === 0, 'brez deduplikacij');
  ok(s.warnings.length === 0, 'brez opozoril');
  ok(d?.widthPlausible === true && w1?.widthPlausible === true, 'mere v DIN/EN pasovih → plavavost');
}

console.log('── 2) Kalibracija po oknu (druga referenca) ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [36.67, 40.28, 21.67, 55.56], 80, 200),
      sugg('window-1', 'okno', [8.33, 16.67, 26.25, 35.0], 70, 120),
    ],
    naturalWidth: 960,
    naturalHeight: 720,
    refId: 'window-1',
  });
  ok(s.calibration?.refId === 'window-1', 'izbrana referenca = okno');
  ok(near(s.calibration?.pxPerCm ?? 0, 2.1, 0.01), 'pxPerCm = 252/120 = 2,1');
  const d = s.openings.find((o) => o.id === 'door-1');
  // vrata: 400 px / 2,1 = 190 cm visoka, 208/2,1 = 99 cm široka
  ok(near(d?.heightCm ?? 0, 190, 1) && near(d?.widthCm ?? 0, 99, 1), `vrata premerjena na oknovem merilu: ${d?.widthCm}×${d?.heightCm}`);
}

console.log('── 3) Deduplikacija: ista odprtina kot vrata + okno (IoU ≥ 0,5) ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [30, 30, 20, 55], 75, 200),
      sugg('window-1', 'okno', [31, 32, 19, 54], 60, 120), // prekrivanje > 0,9
      sugg('window-2', 'okno', [70, 30, 20, 30], 65, 120), // ločeno okno
    ],
    naturalWidth: 1000,
    naturalHeight: 800,
  });
  ok(s.openings.length === 2, `dedup: 3 kandidati → 2 odprtini (${s.openings.length})`);
  ok(s.dedupCount === 1, '1 deduplikacija');
  ok(s.openings.some((o) => o.id === 'door-1'), 'ostala so vrata (višja zanesljivost)');
  ok(s.warnings.some((w) => w.includes('dvakrat')), 'opozorilo o duplikatu');
  // ročna odprtina premaga samodejno
  const s2 = buildOpeningSchedule({
    suggestions: [sugg('door-1', 'vrata', [30, 30, 20, 55], 75, 200)],
    naturalWidth: 1000,
    naturalHeight: 800,
    manual: [{ id: 'manual-1', kind: 'okno', box: [31, 32, 19, 54], confidence: 80, source: 'rocno' }],
  });
  ok(s2.openings.length === 1 && s2.openings[0].source === 'rocno' && s2.openings[0].kind === 'okno',
    'ročna odprtina premaga prekrivajočo se samodejno');
}

console.log('── 4) Izključitve in povzetek ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [36.67, 40.28, 21.67, 55.56], 80, 200),
      sugg('window-1', 'okno', [8.33, 16.67, 26.25, 35.0], 70, 120),
      sugg('window-2', 'okno', [64.58, 16.67, 26.25, 35.0], 68, 120),
    ],
    naturalWidth: 960,
    naturalHeight: 720,
    excludedIds: ['window-2'],
  });
  ok(s.openings.length === 3, 'izključena ostane vidna v tabeli');
  const w2 = s.openings.find((o) => o.id === 'window-2');
  ok(w2?.included === false, 'window-2 izključena');
  ok(s.windowCount === 1 && s.doorCount === 1, 'povzetek šteje samo vključene');
  const pf = prefillOknaVrata(s);
  ok(pf.windowCount === 1 && pf.doorCount === 1 && near(pf.windowSize ?? 0, 1.59, 0.01),
    `prefill: 1 okno @ ${pf.windowSize} m², 1 vrata`);
  // vse izključene → prazen prefill
  const s2 = buildOpeningSchedule({
    suggestions: [sugg('window-1', 'okno', [8.33, 16.67, 26.25, 35.0], 70, 120)],
    naturalWidth: 960, naturalHeight: 720,
    excludedIds: ['window-1'],
  });
  ok(Object.keys(prefillOknaVrata(s2)).length === 0, 'vse izključene → prazen prefill');
}

console.log('── 5) Brez kalibracije ──');
{
  const s = buildOpeningSchedule({
    suggestions: [],
    naturalWidth: 960, naturalHeight: 720,
    manual: [{ id: 'manual-1', kind: 'okno', box: [10, 10, 25, 30], confidence: 80, source: 'rocno' }],
  });
  ok(s.calibration === null, 'brez referenc → brez kalibracije');
  const o = s.openings[0];
  ok(o.widthCm === null && o.heightCm === null && o.areaM2 === null, 'mere null');
  ok(s.warnings.some((w) => w.includes('kalibracij')), 'opozorilo o kalibraciji');
  const pf = prefillOknaVrata(s);
  ok(pf.windowCount === 1 && pf.windowSize === undefined, 'brez kalibracije: štetje velja, mere ne');
}

console.log('── 6) Plavavost: nerealne mere → opozorilo ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [36.7, 39.7, 22.1, 57.2], 80, 200),
      // "okno" 30 cm široko (pod 60 cm EN pasom) pri istem merilu:
      // 30 cm @ 2 px/cm = 60 px = 6,25 % od 960
      sugg('window-1', 'okno', [3.0, 20.0, 6.25, 15.0], 40, 120),
    ],
    naturalWidth: 960,
    naturalHeight: 720,
  });
  const w = s.openings.find((o) => o.id === 'window-1');
  ok(w?.widthPlausible === false, 'okno 30 cm → nepričakovano');
  ok(s.warnings.some((x) => x.includes('Nepričakovane mere')), 'opozorilo o nepričakovani meri');
}

console.log('── 7) Soglasje nizko → opozorilo; neveljavni boxi preskočeni ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [36.7, 39.7, 22.1, 57.2], 80, 200),
      sugg('window-1', 'okno', [8.3, 16.7, 26.3, 35.0], 70, 120),
    ],
    naturalWidth: 960, naturalHeight: 720,
    agreement: 'low',
  });
  ok(s.warnings.some((w) => w.includes('NE ujemajo')), 'opozorilo o nesoglasju meril');
  const s2 = buildOpeningSchedule({
    suggestions: [sugg('bad', 'okno', [10, 10, 0, 0], 70, 120)],
    naturalWidth: 960, naturalHeight: 720,
  });
  ok(s2.openings.length === 0, 'box z ničelno širino preskočen');
  ok(s2.calibration === null, 'brez kalibracije, ko ni veljavnih kandidatov');
}

console.log('── 8) IoU funkcija ──');
{
  ok(openingIoU([0, 0, 10, 10], [0, 0, 10, 10]) === 1, 'identična boxa → IoU 1');
  ok(openingIoU([0, 0, 10, 10], [20, 20, 10, 10]) === 0, 'razmaknjena → 0');
  const iou = openingIoU([0, 0, 10, 10], [5, 0, 10, 10]); // presek 5×10, unija 150
  ok(Math.abs(iou - 50 / 150) < 1e-9, `delno prekrivanje = 1/3 (${iou.toFixed(3)})`);
}

console.log('── 9) Izvoz: besedilo + CSV ──');
{
  const s = buildOpeningSchedule({
    suggestions: [
      sugg('door-1', 'vrata', [36.67, 40.28, 21.67, 55.56], 80, 200),
      sugg('window-1', 'okno', [8.33, 16.67, 26.25, 35.0], 70, 120),
    ],
    naturalWidth: 960, naturalHeight: 720,
  });
  const txt = formatScheduleText(s);
  ok(txt.includes('Popis odprtin'), 'naslov');
  ok(txt.includes('Vrata;Vrata;104;200'), 'vrstica vrat v tabeli (2,08 m²)');
  ok(txt.includes('Okno;Okno;126;126'), 'vrstica okna');
  ok(txt.includes('1,59'), 'decimalna vejica v m²');
  ok(txt.includes('≈ 200 cm'), 'merilo (referenca) v povzetku');
  const csv = scheduleToCsv(s, 'Fasada');
  ok(csv.split('\n')[0].includes('"Popis odprtin","Fasada"'), 'CSV glava z oznako');
  ok(csv.includes('"vrata","Vrata",104,200,2,08'), 'CSV vrstica vrat (decimalna vejica)');
  ok(csv.includes('"okno","Okno",126,126,1,59'), 'CSV vrstica okna');
  ok(/,1$/.test(csv.trim()), 'vključeno = 1');
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
