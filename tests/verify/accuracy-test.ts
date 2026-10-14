// Numerična verifikacija accuracy-test (bun, brez brskalnika) — Faza 7
// Ročno izračunana resnica: napake, mediana, P95 (linearna interpolacija),
// delež v toleranci, sodbe (pogodba: < 5 meritev = nezadostno).
import {
  entryError,
  aggregateStats,
  statsToCsv,
  type AccuracyEntry,
} from '../../src/lib/accuracy-test';

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
const close = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const mk = (id: string, trueCm: number, measuredCm: number, method = 'foto-mera'): AccuracyEntry => ({
  id,
  label: `Test ${id}`,
  method: method as AccuracyEntry['method'],
  trueCm,
  measuredCm,
  recordedAt: '2026-01-01T10:00:00.000Z',
});

// 1) Napaka zapiska: 200 merjeno 201 → 1 cm, 0,5 %
{
  const e = entryError(mk('a', 200, 201), 2);
  check('napaka: abs 1 cm', close(e.absCm, 1), e.absCm);
  check('napaka: 0,5 %', close(e.pct, 0.5), e.pct);
  check('napaka: v toleranci 2 %', e.pass === true, e.pass);
  const e2 = entryError(mk('b', 200, 195), 2);
  check('napaka: 2,5 % nad toleranco', close(e2.pct, 2.5) && e2.pass === false, e2);
  const e3 = entryError(mk('c', 0, 100), 2);
  check('napaka: resnica 0 → Inf, ne DA', e3.pct === Infinity && e3.pass === false, e3);
}

// 2) Sodba: < 5 meritev = NEZADOSTNO (pogodba — nič ne trdimo)
{
  const s = aggregateStats([mk('a', 200, 202), mk('b', 200, 198), mk('c', 100, 101), mk('d', 100, 99)], 2);
  check('4 meritve: nezadostno', s.verdict === 'nezadostno', s.verdict);
  check('4 meritve: n=4', s.n === 4, s.n);
  // napake: 1, 1, 1, 1 % → mediana 1, P95 = interpolacija med 1 in 1 = 1
  check('4 meritve: mediana 1 %', close(s.medianPct, 1), s.medianPct);
  check('4 meritve: P95 1 % (konstantni niz)', close(s.p95Pct, 1), s.p95Pct);
}

// 3) Statistika 5 meritev z znano razporeditvijo
// napake %: 0.5, 1.0, 1.5, 2.0, 2.5 → mediana 1.5; P95 = 0.5 + (2.5-0.5)*(0.95*4 - 0) = 0.5+2*3.8 = 2.3? NE:
// idx = (5-1)*0.95 = 3.8 → lo=3 (2.0), hi=4 (2.5) → P95 = 2.0 + 0.5*0.8 = 2.4
{
  const es = [
    mk('a', 200, 201), // 0.5 %
    mk('b', 200, 202), // 1.0 %
    mk('c', 200, 203), // 1.5 %
    mk('d', 100, 102), // 2.0 %
    mk('e', 100, 102.5), // 2.5 %
  ];
  const s = aggregateStats(es, 2);
  check('5 meritev: mediana 1,5 %', close(s.medianPct, 1.5), s.medianPct);
  check('5 meritev: P95 2,4 % (linearna interp.)', close(s.p95Pct, 2.4), s.p95Pct);
  check('5 meritev: max 2,5 %', close(s.maxPct, 2.5), s.maxPct);
  check('5 meritev: povprečje 1,5 %', close(s.meanPct, 1.5), s.meanPct);
  check('5 meritev: delež v toleranci 4/5', close(s.passRate, 0.8), s.passRate);
  check('5 meritev: mediana ≤ tol, P95 nad → osnovno', s.verdict === 'osnovno', s.verdict);
}

// 4) Vse v toleranci → zanesljivo
{
  const es = [
    mk('a', 200, 202), // 1 %
    mk('b', 200, 198), // 1 %
    mk('c', 100, 101), // 1 %
    mk('d', 100, 99), // 1 %
    mk('e', 300, 303), // 1 %
  ];
  const s = aggregateStats(es, 2);
  check('vsi 1 %: zanesljivo', s.verdict === 'zanesljivo', s.verdict);
  check('vsi 1 %: passRate 1', s.passRate === 1, s.passRate);
  check('vsi 1 %: P95 1 %', close(s.p95Pct, 1), s.p95Pct);
}

// 5) Mediana nad toleranco → potrebna izboljšava
{
  const es = [
    mk('a', 100, 110), // 10 %
    mk('b', 100, 112), // 12 %
    mk('c', 100, 108), // 8 %
    mk('d', 100, 111), // 11 %
    mk('e', 100, 109), // 9 %
  ];
  const s = aggregateStats(es, 2);
  check('visoke napake: potrebna izboljšava', s.verdict === 'potrebna-izboljsava', s.verdict);
  check('visoke napake: mediana 10 %', close(s.medianPct, 10), s.medianPct);
  check('visoke napake: passRate 0', s.passRate === 0, s.passRate);
}

// 6) Prazen nabor
{
  const s = aggregateStats([], 2);
  check('prazno: nezadostno', s.verdict === 'nezadostno', s.verdict);
  check('prazno: n=0', s.n === 0, s.n);
  check('prazno: hint o 5 testih', s.verdictHint.includes('5'), s.verdictHint);
}

// 7) Sodba nebesedilna: 5 meritev, 2 od 5 v toleranci → delež 0,4
{
  const es = [
    mk('a', 100, 100.5), // 0.5 %
    mk('b', 100, 99.5), // 0.5 %
    mk('c', 100, 104), // 4 %
    mk('d', 100, 105), // 5 %
    mk('e', 100, 104.5), // 4.5 %
  ];
  const s = aggregateStats(es, 2);
  check('mešano: passRate 0,4', close(s.passRate, 0.4), s.passRate);
  check('mešano: mediana 4 % → izboljšava', s.verdict === 'potrebna-izboljsava', s.verdict);
}

// 8) CSV: BOM, glava, ločila, Decimalna vejica
{
  const csv = statsToCsv([mk('a;posebno', 200, 201, 'laser')], 2);
  check('csv: BOM', csv.charCodeAt(0) === 0xfeff, csv.charCodeAt(0));
  check('csv: glava v_toleranci', csv.includes('v_toleranci'), csv.split('\n')[0]);
  check('csv: podpičje v oznaki zamenjano', csv.includes('a,posebno'), csv);
  check('csv: metoda label', csv.includes('Laser (kontrola)'), csv);
  check('csv: DA v toleranci', csv.includes(';DA;'), csv);
  check('csv: vejica 0,50', csv.includes('0,50'), csv);
}

// 9) P95 z 20 meritvami (idx = 19*0.95 = 18.05 → lo=18, hi=19)
{
  const es = Array.from({ length: 20 }, (_, i) => mk(`t${i}`, 100, 100 + i * 0.1)); // napake 0–1.9 %
  const s = aggregateStats(es, 5);
  // sorted napake: 0, 0.1, ..., 1.9 → P95 = 1.8 + (1.9-1.8)*0.05 = 1.805
  check('20 meritev: P95 1,805 %', close(s.p95Pct, 1.805, 0.001), s.p95Pct);
  check('20 meritev: mediana 0.9/0.95 → 0.95', close(s.medianPct, 0.95, 0.001), s.medianPct);
  check('20 meritev: zanesljivo', s.verdict === 'zanesljivo', s.verdict);
}

console.log(`\n${pass}/${pass + fail} testov uspešnih`);
if (fail > 0) process.exit(1);
