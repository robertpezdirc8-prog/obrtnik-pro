// ─── Testi: Časovnica (time-tracking / Zeiterfassung) ───────
// Vse pričakovane vrednosti so IZRAČUNANE ROČNO:
//  • billableHours(100) = 100/60 = 1,6667 h → na 0,25 h bližje 1,75
//  • teden 2026-02-11 (sreda) se začne v ponedeljek 2026-02-09
//  • neobračunana zapadlost: 1,5·30 + 2·30 + 5·30 + 1·35 = 290 €
// Poženi: bun run tests/verify/time-tracking.ts

import {
  billableHours,
  computeTimeStats,
  formatHours,
  formatMinutesHM,
  hoursToInvoiceItems,
  isValidDay,
  todayDay,
  weekStartDay,
  addDays,
  BILLABLE_ROUNDING_H,
  MIN_BILLABLE_H,
  MIN_DAYS_FOR_AVG,
  type TimeEntryInput,
} from '../../src/lib/time-tracking';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass += 1; }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, g === w ? undefined : `dobil ${g}, pričakovano ${w}`);
}

function approx(name: string, got: number, want: number, eps = 1e-9) {
  ok(name, Math.abs(got - want) < eps, `dobil ${got}, pričakovano ${want} (±${eps})`);
}

/** Fiksni "zdaj" — sreda 2026-02-11 12:00 UTC (deterministični testi). */
const NOW = new Date('2026-02-11T12:00:00.000Z');

let seq = 0;
function entry(p: Partial<TimeEntryInput> & { day: string; minutes: number }): TimeEntryInput {
  seq += 1;
  return {
    id: `T${seq}`,
    description: p.description ?? `Delo ${seq}`,
    hourlyRate: p.hourlyRate ?? 30,
    customerName: p.customerName ?? null,
    offerId: p.offerId ?? null,
    craftId: p.craftId ?? null,
    billedAt: p.billedAt ?? null,
    billedRef: p.billedRef ?? null,
    createdAt: p.createdAt ?? '2026-02-11T08:00:00.000Z',
    day: p.day,
    minutes: p.minutes,
  };
}

// ─── 1. Obračunljive ure (na 0,25 h, polovice gor, min 0,25) ─

approx('1.1  60 min = 1 h', billableHours(60), 1);
approx('1.2  90 min = 1,5 h', billableHours(90), 1.5);
approx('1.3  95 min → 1,5 (bližje 1,5 kot 1,75)', billableHours(95), 1.5);
approx('1.4  100 min → 1,75 (1,6667 h)', billableHours(100), 1.75);
approx('1.5  105 min = 1,75 točno', billableHours(105), 1.75);
approx('1.6  110 min → 1,75 (1,8333)', billableHours(110), 1.75);
approx('1.7  82,5 min = točno na polovici → gor na 1,5', billableHours(82.5), 1.5);
approx('1.8  38 min → 0,75 (0,6333; do 0,75 je bližje)', billableHours(38), 0.75);
approx('1.9  25 min → 0,5', billableHours(25), 0.5);
approx('1.10 10 min → 0,25 (najbližja četrtina)', billableHours(10), 0.25);
approx('1.11 5 min → 0,25 (min scroll', billableHours(5), MIN_BILLABLE_H);
approx('1.12 2 min → 0,25 (nikoli nič)', billableHours(2), 0.25);
approx('1.13 480 min = 8 h', billableHours(480), 8);
eq('1.14 konstanta zaokroževanja 0,25', BILLABLE_ROUNDING_H, 0.25);
eq('1.15 MIN_DAYS_FOR_AVG = 3', MIN_DAYS_FOR_AVG, 3);

// ─── 2. Dnevi in tedni ──────────────────────────────────────

eq('2.1 todayDay(NOW) = 2026-02-11', todayDay(NOW), '2026-02-11');
eq('2.2 teden srede 11. 2. se začne 9. 2. (ponedeljek)', weekStartDay('2026-02-11'), '2026-02-09');
eq('2.3 nedelja 15. 2. spada v teden od 9. 2.', weekStartDay('2026-02-15'), '2026-02-09');
eq('2.4 ponedeljek je svoj začetek', weekStartDay('2026-02-09'), '2026-02-09');
eq('2.5 sobota 14. 2. še isti teden', weekStartDay('2026-02-14'), '2026-02-09');
eq('2.6 ponedeljek 16. 2. = nov teden', weekStartDay('2026-02-16'), '2026-02-16');
eq('2.7 addDays(+6) = nedelja', addDays('2026-02-09', 6), '2026-02-15');
eq('2.8 addDays(-7) = prejšnji teden', addDays('2026-02-11', -7), '2026-02-04');
eq('2.9 addDays čez mesec', addDays('2026-01-30', 3), '2026-02-02');
ok('2.10 veljaven dan', isValidDay('2026-02-11'));
ok('2.11 napačen format (2026-2-11) zavrnjen', !isValidDay('2026-2-11'));
ok('2.12 mesec 13 ne obstaja', !isValidDay('2026-13-01'));
ok('2.13 30. februar ne obstaja', !isValidDay('2026-02-30'));
ok('2.14 prestopno leto 29. 2. 2024 velja', isValidDay('2024-02-29'));

// ─── 3. Statistika z ročno resnico ──────────────────────────
// A danes 11. 2.: 90 min × 30 (neobračunano) → 1,5 h = 45 €
// B včeraj 10. 2.: 120 min × 30 (neobračunano) → 2 h = 60 €
// C ponedeljek 9. 2.: 45 min × 32 (OBRAČUNANO) → izpadlo iz neobračunanih
// D 5. 2. (prejšnji teden): 300 min × 30 (neobračunano) → 5 h = 150 €
// E 28. 1. (prejšnji mesec): 60 min × 35 (neobračunano) → 1 h = 35 €
const A = entry({ day: '2026-02-11', minutes: 90, hourlyRate: 30, customerName: 'Ana Kovač', description: 'Montaža ograje' });
const B = entry({ day: '2026-02-10', minutes: 120, hourlyRate: 30, customerName: 'Ana Kovač', description: 'Dostava materiala' });
const C = entry({ day: '2026-02-09', minutes: 45, hourlyRate: 32, customerName: 'Bojan P.', billedAt: '2026-02-10T10:00:00.000Z', billedRef: 'osnutek ponudbe' });
const D = entry({ day: '2026-02-05', minutes: 300, hourlyRate: 30, customerName: 'Bojan P.', description: 'Keramika' });
const E = entry({ day: '2026-01-28', minutes: 60, hourlyRate: 35, customerName: 'Cika d.o.o.', description: 'Fasada' });

const s = computeTimeStats([A, B, C, D, E], NOW);

eq('3.1 skupaj minut 90+120+45+300+60 = 615', s.totalMinutes, 615);
eq('3.2 danes = 90', s.todayMinutes, 90);
eq('3.3 teden (9.–15. 2.) = A+B+C = 255', s.weekMinutes, 255);
eq('3.4 mesec februar = A+B+C+D = 555', s.monthMinutes, 555);
eq('3.5 neobračunano = A+B+D+E = 570', s.unbilledMinutes, 570);
approx('3.6 neobračunane obračunljive ure = 1,5+2+5+1 = 9,5', s.unbilledBillableHours, 9.5);
approx('3.7 neobračunani zaslužek = 45+60+150+35 = 290', s.unbilledEarned, 290);
eq('3.8 dni z delom = 5', s.daysWithWork, 5);
approx('3.9 povprečje 615/5/60 = 2,05 h', s.avgHoursPerDay ?? 0, 2.05);

// Iskrenost: pod 3 dnevi ni povprečja
const s2 = computeTimeStats([A, B], NOW);
eq('3.10 2 dneva → povprečje null (se ne trdi)', s2.avgHoursPerDay, null);
eq('3.11 prazen nabor → vse ničle', JSON.stringify(computeTimeStats([], NOW)), JSON.stringify({
  totalMinutes: 0, todayMinutes: 0, weekMinutes: 0, monthMinutes: 0,
  unbilledMinutes: 0, unbilledBillableHours: 0, unbilledEarned: 0,
  daysWithWork: 0, avgHoursPerDay: null, byCustomer: [], last7Days: computeTimeStats([], NOW).last7Days,
}));

// Neobračunano po strankah (minut padajoče):
// Bojan P. (D) 300 · Ana Kovač (A+B) 210 · Cika (E) 60; obračunani C IZPADL
eq('3.12 stranke po minutah padajoče', s.byCustomer.map((c) => `${c.customerName}:${c.minutes}`), ['Bojan P.:300', 'Ana Kovač:210', 'Cika d.o.o.:60']);
approx('3.13 Ana obračunljive 3,5 h', s.byCustomer[1].billableHours, 3.5);
approx('3.14 Ana zaslužek 105 €', s.byCustomer[1].earned, 105);
approx('3.15 Bojan 5 h / 150 €', s.byCustomer[0].billableHours, 5);
approx('3.16 Bojan zaslužek 150 €', s.byCustomer[0].earned, 150);

// Zadnjih 7 dni: 5. 2. = 300, 9. 2. = 45, 10. 2. = 120, 11. 2. = 90, ostalo 0
eq('3.17 zadnjih 7 dni od najstarejšega', s.last7Days.map((d) => `${d.day.slice(8, 10)}:${d.minutes}`),
  ['05:300', '06:0', '07:0', '08:0', '09:45', '10:120', '11:90']);

// Teden se konča z nedeljo — delo v nedeljo 15. 2. je še "ta teden"
const SUN = new Date('2026-02-15T12:00:00.000Z');
const F = entry({ day: '2026-02-15', minutes: 60 });
const sSun = computeTimeStats([F], SUN);
eq('3.18 nedeljske ure so v tednu', sSun.weekMinutes, 60);
// ponedeljek 16. 2. je NOV teden — izven tedna srede 11. 2.
const MON = entry({ day: '2026-02-16', minutes: 60 });
eq('3.19 ponedeljek 16. 2. ni v tednu srede 11. 2.', computeTimeStats([MON], NOW).weekMinutes, 0);
// 1. februar je izven tedna 9.–15.
const G = entry({ day: '2026-02-01', minutes: 60 });
eq('3.20 prvi dan meseca ni v tem tednu', computeTimeStats([G], NOW).weekMinutes, 0);

// ─── 4. Postavke za osnutek (grupiranje po postavki) ────────

// 4a: Ana (A+B, isti tečaj 30) → ENA postavka, količina 3,5 ur
const itemsA = hoursToInvoiceItems([A, B]);
eq('4.1 isti tečaj → ena postavka', itemsA.length, 1);
eq('4.2 ime z stranko', itemsA[0].name, 'Delo — Ana Kovač');
approx('4.3 količina 1,5+2 = 3,5 ur', itemsA[0].quantity, 3.5);
eq('4.4 enota ur', itemsA[0].unit, 'ur');
approx('4.5 cena 30 €/h', itemsA[0].unitPrice, 30);
ok('4.6 opis vsebuje obe opravili in izrecno "0,25 h"',
  itemsA[0].description.includes('Montaža ograje') &&
  itemsA[0].description.includes('Dostava materiala') &&
  itemsA[0].description.includes('0,25 h'));
ok('4.7 opis vsebuje datuma 11.02. in 10.02.',
  itemsA[0].description.includes('11.02.') && itemsA[0].description.includes('10.02.'));

// 4b: E ima tečaj 35 → dve postavki, padajoče po tečaju (35 pred 30)
const itemsMix = hoursToInvoiceItems([A, B, E]);
eq('4.8 različni tečaji → dve postavki', itemsMix.length, 2);
approx('4.9 višji tečaj 35 najprej', itemsMix[0].unitPrice, 35);
approx('4.10 količina E = 1 h', itemsMix[0].quantity, 1);
approx('4.11 nato tečaj 30 s 3,5 h', itemsMix[1].unitPrice, 30);
approx('4.12 …količina 3,5', itemsMix[1].quantity, 3.5);

// 4c: obračunan vnos C se ne obračuna znova
const itemsC = hoursToInvoiceItems([C]);
eq('4.13 obračunan vnos → nič postavk', itemsC.length, 0);

// 4d: vnos brez stranke → ime "Delo"
const X = entry({ day: '2026-02-11', minutes: 60 });
eq('4.14 brez stranke → "Delo"', hoursToInvoiceItems([X])[0].name, 'Delo');

// 4e: determinističen vrstni red po dnevih (naraščajoče) znotraj skupine
const Y1 = entry({ day: '2026-02-12', minutes: 30, customerName: 'Ana Kovač', description: 'bbb' });
const Y2 = entry({ day: '2026-02-11', minutes: 30, customerName: 'Ana Kovač', description: 'aaa' });
const itemsOrd = hoursToInvoiceItems([Y1, Y2]);
ok('4.15 dnevi v opisu naraščajoče (11. pred 12.)',
  itemsOrd[0].description.indexOf('11.02.') < itemsOrd[0].description.indexOf('12.02.'));

// ─── 5. Formatiranje (sl-SI) ────────────────────────────────

eq('5.1 formatHours(90) = "1,5 h"', formatHours(90), '1,5 h');
eq('5.2 formatHours(60) = "1 h"', formatHours(60), '1 h');
eq('5.3 formatHours(45) = "0,75 h"', formatHours(45), '0,75 h');
eq('5.4 formatHours(0) = "0 h"', formatHours(0), '0 h');
eq('5.5 formatMinutesHM(105) = "1 h 45 min"', formatMinutesHM(105), '1 h 45 min');
eq('5.6 formatMinutesHM(45) = "45 min"', formatMinutesHM(45), '45 min');
eq('5.7 formatMinutesHM(120) = "2 h"', formatMinutesHM(120), '2 h');
eq('5.8 formatMinutesHM(0) = "0 min"', formatMinutesHM(0), '0 min');

// ─── 6. Determinizem ────────────────────────────────────────

const sAgain = computeTimeStats([A, B, C, D, E], NOW);
eq('6.1 dva klica = enak JSON', JSON.stringify(sAgain), JSON.stringify(s));
const itemsAgain = hoursToInvoiceItems([A, B, E]);
eq('6.2 postavke deterministične', JSON.stringify(itemsAgain), JSON.stringify(itemsMix));

// ─── Rezultat ───────────────────────────────────────────────

console.log(`\nČasovnica: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) {
  console.log('Napake:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log('Vsi testi z ročno resnico so zeleni.');
}
