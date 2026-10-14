// ─── Sejanje realističnega stanja terjatev (demo + E2E) ─────
// Idempotenten skript: pobriše prejšnje demo račune (RAC-2026-90x)
// in ustvari nov nabor z živi datumi glede na "zdaj" — da je demo
// vedno v istem stanju: 3 zapadle (1./2./3. opomnik), 1 rok se
// izteka, 3 plačane (povprečje je pošteno prikazano, ker je 3 ≥ MIN_PAID).
// Pričakovano ob zagonu izpiše za E2E preverjanje.

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DAY = 86_400_000;
// Osnovni čas PRIDOBIMO ENKRAT — vsi žigi imajo isto časovno izhodišče,
// sicer se med evalvacijo nabora in vstavljanjem izgubijo milisekunde
// (24 d − 6 ms → floor 23) in pričakovana statistika ne ustreza.
const T0 = Date.now();
const ago = (d: number) => new Date(T0 - d * DAY);
const ahead = (d: number) => new Date(T0 + d * DAY);

async function main() {
  const offers = await db.offer.findMany({ where: { status: 'accepted' }, orderBy: { number: 'asc' } });
  if (offers.length < 2) {
    console.error('✗ potreboval bi vsaj 2 sprejeti ponudbi (poženi tests/seed-pipeline-demo.ts)');
    process.exit(1);
  }
  const [o1, o2] = offers;

  // počisti prejšnje demo račune
  const old = await db.invoice.findMany({ where: { number: { startsWith: 'RAC-2026-90' } } });
  for (const inv of old) await db.invoice.delete({ where: { id: inv.id } });

  // [št, ponudba, dueAt, paidAt, createdAtAgo]
  const rows = [
    { n: '901', offer: o1, due: ago(10), paid: null, created: 48 },  // zapadla 10 dni → 1. opomnik
    { n: '902', offer: o2, due: ago(25), paid: null, created: 46 },  // zapadla 25 dni → 2. opomnik
    { n: '903', offer: o1, due: ago(45), paid: null, created: 44 },  // zapadla 45 dni → 3. opomnik (najslabša)
    { n: '904', offer: o2, due: ahead(3), paid: null, created: 42 }, // rok čez 3 dni → rok se izteka
    { n: '905', offer: o1, due: ago(46), paid: ago(16), created: 40 }, // plačana: 40−16 = 24 dni do plačila
    { n: '906', offer: o2, due: ago(40), paid: ago(10), created: 38 }, // plačana: 38−10 = 28 dni
    { n: '907', offer: o1, due: ago(52), paid: ago(22), created: 36 }, // plačana: 36−22 = 14 dni
  ];

  for (const r of rows) {
    await db.invoice.create({
      data: {
        number: `RAC-2026-${r.n}`,
        offerId: r.offer.id,
        customerName: r.offer.customerName,
        subtotal: Math.round((r.offer.total / 1.22) * 100) / 100,
        vatRate: 22,
        vatAmount: Math.round((r.offer.total - r.offer.total / 1.22) * 100) / 100,
        total: r.offer.total,
        dueAt: r.due,
        paidAt: r.paid,
        createdAt: ago(r.created),
      },
    });
    console.log(`✓ RAC-2026-${r.n} ${r.offer.customerName} ${r.offer.total.toFixed(2)} € due=${r.due.toISOString().slice(0, 10)} paid=${r.paid?.toISOString().slice(0, 10) ?? '—'}`);
  }

  // ročno izračunano pričakovanje (za E2E):
  // Odprto: 4 računi · 2388,15+1427,40+2388,15+1427,40 = 7.631,10 €
  // Zapadle: 3 računi · najdaljša 45 dni · 2388,15+1427,40+2388,15 = 6.203,70 €
  // Povprečno plačilo: (24+28+14)/3 = 22,0 dni (3 plačane → pošteno prikazano)
  // Za plačilo: RAC-903 (zapadla pred 45, 3. opomnik) → RAC-902 (25, 2.) →
  //             RAC-901 (10, 1.) → RAC-904 (rok čez 3, Rok se izteka)
  const outstanding = o1.total + o2.total + o1.total + o2.total;
  const overdueTotal = o1.total + o2.total + o1.total;
  console.log('\n── pričakovano na dashboardu ──');
  console.log(`Odprto: 4 računi · ${outstanding.toFixed(2).replace('.', ',')} €`);
  console.log(`Zapadle: 3 računi · najdaljša 45 dni · ${overdueTotal.toFixed(2).replace('.', ',')} €`);
  console.log('Povprečno plačilo: 22,0 dni — razlika createdAt→paidAt je EXACTNO 24/28/14 dni (isti T0)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
