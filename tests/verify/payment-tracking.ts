// ─── Testi: Sledenje plačilom (payment-tracking) ────────────
// Vse pričakovane vrednosti so IZRAČUNANE ROČNO (npr. D: rok
// 2026-02-01, zdaj 2026-02-11 → 10 dni zapadla; avg (16+28+10)/3
// = 18). Poženi: bun run tests/verify/payment-tracking.ts

import {
  computeReceivables,
  dunningLevel,
  effectiveDueAt,
  formatDueRelative,
  paymentStatus,
  actionableInvoices,
  daysBetween,
  suggestDueIso,
  DEFAULT_DUE_DAYS,
  DUE_SOON_DAYS,
  MIN_PAID_FOR_AVG,
  type PaymentInvoice,
} from '../../src/lib/payment-tracking';

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

/** Fiksni "zdaj" — sreda 2026-02-11 12:00 UTC (deterministični testi). */
const NOW = new Date('2026-02-11T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

function inv(p: Partial<PaymentInvoice> & { id: string }): PaymentInvoice {
  return {
    number: `RAC-2026-${p.id}`,
    customerName: `Stranka ${p.id}`,
    total: 1000,
    createdAt: daysAgo(20),
    dueAt: null,
    paidAt: null,
    ...p,
  };
}

// ─── 1) daysBetween + konstante ─────────────────────────────
{
  eq('daysBetween 10 dni nazaj', daysBetween(new Date(daysAgo(10)), NOW), 10);
  eq('daysBetween 10 dni naprej (negativno)', daysBetween(NOW, new Date(daysAgo(10))), -10);
  eq('daysBetween isti trenutek', daysBetween(NOW, NOW), 0);
  eq('DEFAULT_DUE_DAYS', DEFAULT_DUE_DAYS, 30);
  eq('DUE_SOON_DAYS', DUE_SOON_DAYS, 5);
  eq('MIN_PAID_FOR_AVG', MIN_PAID_FOR_AVG, 3);
}

// ─── 2) effectiveDueAt: izrecen vs privzet ──────────────────
{
  const explicit = inv({ id: 'D', dueAt: '2026-02-01T12:00:00.000Z' });
  const e = effectiveDueAt(explicit);
  eq('effectiveDueAt izrecen', e.iso, '2026-02-01T12:00:00.000Z');
  eq('effectiveDueAt izrecen flag', e.explicit, true);

  // createdAt = NOW − 30 dni → privzeti rok = točno NOW
  const def = inv({ id: 'I', createdAt: daysAgo(30), dueAt: null });
  const d = effectiveDueAt(def);
  eq('effectiveDueAt privzet = createdAt+30', d.iso, daysAgo(0));
  eq('effectiveDueAt privzet flag', d.explicit, false);

  // ročno: 2025-12-20 + 30 dni = 2026-01-19 (ist čas)
  const dec = inv({ id: 'A', createdAt: '2025-12-20T12:00:00.000Z', dueAt: null });
  eq('effectiveDueAt dec+jan', effectiveDueAt(dec).iso, '2026-01-19T12:00:00.000Z');
}

// ─── 3) paymentStatus: posamezni primeri (ročno) ────────────
{
  // paid — status neodvisen od roka
  const paid = paymentStatus(inv({ id: 'A', paidAt: daysAgo(2), dueAt: daysAgo(20) }), NOW);
  eq('plačan → paid', paid.status, 'paid');
  eq('plačan brez dni zapadlosti', paid.daysOverdue, null);

  // overdue 10 dni (rok 2026-02-01, zdaj 2026-02-11)
  const od = paymentStatus(inv({ id: 'D', dueAt: '2026-02-01T12:00:00.000Z' }), NOW);
  eq('D zapadla', od.status, 'overdue');
  eq('D zapadlost 10 dni', od.daysOverdue, 10);
  eq('D izrecen rok', od.dueExplicit, true);

  // privzeti rok: createdAt 2026-01-12 + 30 = 2026-02-11 (rok DANES) → due-soon, 0
  const today = paymentStatus(inv({ id: 'I', createdAt: '2026-01-12T12:00:00.000Z' }), NOW);
  eq('I rok danes', today.status, 'due-soon');
  eq('I dni do roka 0', today.daysLeft, 0);
  eq('I privzet rok', today.dueExplicit, false);

  // due-soon 3 dni
  const soon = paymentStatus(inv({ id: 'H', dueAt: daysAhead(3) }), NOW);
  eq('H rok se izteka', soon.status, 'due-soon');
  eq('H 3 dni do roka', soon.daysLeft, 3);

  // meja: 5 dni = še vedno due-soon; 6 dni = že pending
  const edge5 = paymentStatus(inv({ id: 'H2', dueAt: daysAhead(5) }), NOW);
  eq('meja 5 dni → due-soon', edge5.status, 'due-soon');
  const edge6 = paymentStatus(inv({ id: 'H3', dueAt: daysAhead(6) }), NOW);
  eq('meja 6 dni → pending', edge6.status, 'pending');
  eq('pending brez daysLeft', edge6.daysLeft, null);

  // rok jutri
  const tomorrow = paymentStatus(inv({ id: 'H4', dueAt: daysAhead(1) }), NOW);
  eq('rok jutri → due-soon', tomorrow.status, 'due-soon');
  eq('1 dan do roka', tomorrow.daysLeft, 1);

  // prihodnji rok 20 dni
  const pend = paymentStatus(inv({ id: 'G', dueAt: daysAhead(20) }), NOW);
  eq('G v roku', pend.status, 'pending');
}

// ─── 4) dunningLevel: poštene stopnje ───────────────────────
{
  eq('level 0 plačano', dunningLevel(inv({ id: 'x', paidAt: daysAgo(1) }), NOW).level, 0);
  eq('label plačano', dunningLevel(inv({ id: 'x', paidAt: daysAgo(1) }), NOW).label, 'Plačano');
  eq('level 0 v roku', dunningLevel(inv({ id: 'y', dueAt: daysAhead(20) }), NOW).label, 'V roku');
  eq('level 0 rok se izteka', dunningLevel(inv({ id: 'z', dueAt: daysAhead(2) }), NOW).label, 'Rok se izteka');

  const l1 = dunningLevel(inv({ id: 'D', dueAt: daysAgo(10) }), NOW);
  eq('10 dni → level 1', l1.level, 1);
  eq('10 dni → 1. opomnik', l1.label, '1. opomnik');
  ok('1. opomnik sporočilo vsebuje prijazen ton', l1.message.includes('ušel'));

  const l1e = dunningLevel(inv({ id: 'D2', dueAt: daysAgo(14) }), NOW);
  eq('14 dni → še level 1', l1e.level, 1);
  const l2 = dunningLevel(inv({ id: 'E', dueAt: daysAgo(15) }), NOW);
  eq('15 dni → level 2', l2.level, 2);
  eq('15 dni → 2. opomnik', l2.label, '2. opomnik');
  const l2e = dunningLevel(inv({ id: 'E2', dueAt: daysAgo(30) }), NOW);
  eq('30 dni → še level 2', l2e.level, 2);
  const l3 = dunningLevel(inv({ id: 'F', dueAt: daysAgo(31) }), NOW);
  eq('31 dni → level 3', l3.level, 3);
  eq('31 dni → 3. opomnik', l3.label, '3. opomnik');
  ok('3. opomnik omenja ukrepe', l3.message.includes('odvetniku'));
}

// ─── 5) computeReceivables: glavni nabor (ročno preštet) ────
// A: plačan 2026-01-05 (januar — NI ta mesec), 16 dni do plačila
// B: plačan 2026-02-02 (februar — ta mesec), 28 dni do plačila
// C: plačan 2026-02-09 (februar), 10 dni do plačila
// D: zapadla 10 dni (rok 2026-02-01), 1.499 €
// E: zapadla 25 dni (rok 2026-01-17), 850 €
// F: zapadla 45 dni (rok 2025-12-28), 2.499 €
// G: v roku (rok 2026-03-03), 1.234 €
// H: rok se izteka (rok 2026-02-14), 700 €
const DATASET: PaymentInvoice[] = [
  inv({ id: 'A', total: 1210, createdAt: '2025-12-20T12:00:00.000Z', paidAt: '2026-01-05T12:00:00.000Z' }),
  inv({ id: 'B', total: 968, createdAt: '2026-01-05T12:00:00.000Z', paidAt: '2026-02-02T12:00:00.000Z' }),
  inv({ id: 'C', total: 610, createdAt: '2026-01-30T12:00:00.000Z', paidAt: '2026-02-09T12:00:00.000Z' }),
  inv({ id: 'D', total: 1499, dueAt: '2026-02-01T12:00:00.000Z' }),
  inv({ id: 'E', total: 850, dueAt: '2026-01-17T12:00:00.000Z' }),
  inv({ id: 'F', total: 2499, dueAt: '2025-12-28T12:00:00.000Z' }),
  inv({ id: 'G', total: 1234, dueAt: '2026-03-03T12:00:00.000Z' }),
  inv({ id: 'H', total: 700, dueAt: '2026-02-14T12:00:00.000Z' }),
];

{
  const r = computeReceivables(DATASET, NOW);
  eq('counts plačanih', r.counts.paid, 3);
  eq('counts neplačanih', r.counts.unpaid, 5);
  eq('counts zapadlih', r.counts.overdue, 3);
  // odprto: 1499 + 850 + 2499 + 1234 + 700 = 6782
  eq('odprte terjatve', r.outstandingTotal, 6782);
  // zapadlo: 1499 + 850 + 2499 = 4848
  eq('zapadle terjatve', r.overdueTotal, 4848);
  // ta mesec: B 968 + C 610 = 1578 (A je januar → izključena)
  eq('plačano ta mesec', r.paidThisMonthTotal, 1578);
  // avg: (16 + 28 + 10) / 3 = 18
  eq('povprečje dni do plačila', r.avgDaysToPay, 18);
  // starostna struktura: 1–7:0 · 8–14:1(D) · 15–30:1(E) · 30+:1(F)
  eq('aging 1–7', r.aging.d1_7, 0);
  eq('aging 8–14', r.aging.d8_14, 1);
  eq('aging 15–30', r.aging.d15_30, 1);
  eq('aging 30+', r.aging.d30plus, 1);
  eq('najdaljša zapadlost', r.worstOverdueDays, 45);
}

// ─── 6) iskrenost: < 3 plačanih → brez povprečja ────────────
{
  const two = computeReceivables(DATASET.slice(3), NOW); // D–H: nič plačanih
  eq('nič plačanih → avg null', two.avgDaysToPay, null);
  eq('nič plačanih → plačano ta mesec 0', two.paidThisMonthTotal, 0);
  eq('nič plačanih → counts', two.counts.paid, 0);

  const twoPaid: PaymentInvoice[] = [
    inv({ id: 'B', total: 968, createdAt: '2026-01-05T12:00:00.000Z', paidAt: '2026-02-02T12:00:00.000Z' }),
    inv({ id: 'C', total: 610, createdAt: '2026-01-30T12:00:00.000Z', paidAt: '2026-02-09T12:00:00.000Z' }),
    inv({ id: 'G', total: 1234, dueAt: '2026-03-03T12:00:00.000Z' }),
  ];
  const r2p = computeReceivables(twoPaid, NOW);
  eq('2 plačana → avg null (iskrenost)', r2p.avgDaysToPay, null);
  eq('2 plačana → ta mesec 1578', r2p.paidThisMonthTotal, 1578);
}

// ─── 7) prazen nabor ────────────────────────────────────────
{
  const r = computeReceivables([], NOW);
  eq('prazno: counts', r.counts, { paid: 0, unpaid: 0, overdue: 0 });
  eq('prazno: odprto', r.outstandingTotal, 0);
  eq('prazno: zapadlo', r.overdueTotal, 0);
  eq('prazno: avg', r.avgDaysToPay, null);
  eq('prazno: worst', r.worstOverdueDays, null);
  eq('prazno: aging', r.aging, { d1_7: 0, d8_14: 0, d15_30: 0, d30plus: 0 });
}

// ─── 8) actionableInvoices: vrstni red akcije ───────────────
{
  const list = actionableInvoices(DATASET, NOW);
  eq('akcija: 4 računov', list.length, 4);
  // zapadle po padajoči zapadlosti: F(45) E(25) D(10), nato due-soon: H(3) I? — I ni v naboru → samo H
  eq('akcija vrstni red', list.map((x) => x.inv.id), ['F', 'E', 'D', 'H']);
  eq('F info zapadlost', list[0].info.daysOverdue, 45);
  eq('H info daysLeft', list[3].info.daysLeft, 3);
}

// ─── 9) formatDueRelative ───────────────────────────────────
{
  const overdue = paymentStatus(inv({ id: 'D', dueAt: daysAgo(10) }), NOW);
  eq('format zapadla pred 10 dni', formatDueRelative(overdue, NOW), 'zapadla pred 10 dni');
  const today = paymentStatus(inv({ id: 'I', createdAt: daysAgo(30) }), NOW);
  eq('format rok danes', formatDueRelative(today, NOW), 'rok danes');
  const tomorrow = paymentStatus(inv({ id: 'T', dueAt: daysAhead(1) }), NOW);
  eq('format rok jutri', formatDueRelative(tomorrow, NOW), 'rok jutri');
  const soon = paymentStatus(inv({ id: 'H', dueAt: daysAhead(3) }), NOW);
  eq('format rok čez 3 dni', formatDueRelative(soon, NOW), 'rok čez 3 dni');
  const future = paymentStatus(inv({ id: 'G', dueAt: daysAhead(20) }), NOW);
  eq('format rok čez 20 dni', formatDueRelative(future, NOW), 'rok čez 20 dni');
  const paid = paymentStatus(inv({ id: 'A', paidAt: daysAgo(1) }), NOW);
  eq('format plačana', formatDueRelative(paid, NOW), 'plačana');
}

// ─── 10) suggestDueIso ──────────────────────────────────────
{
  eq('rok +30 dni privzeto', suggestDueIso('2026-02-11T12:00:00.000Z'), '2026-03-13T12:00:00.000Z');
  eq('rok +7 dni', suggestDueIso('2026-02-11T12:00:00.000Z', 7), '2026-02-18T12:00:00.000Z');
}

// ─── 11) determinizem: isti vnos → isti izhod ───────────────
{
  const a = computeReceivables(DATASET, NOW);
  const b = computeReceivables(DATASET, NOW);
  eq('determinizem', JSON.stringify(a), JSON.stringify(b));
}

console.log(`\n═══ payment-tracking: ${pass} OK, ${fail} NAPAK ═══`);
if (fail > 0) {
  console.log('Neuspehi:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
