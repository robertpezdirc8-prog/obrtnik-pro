// ─── Sejanje realističnega stanja sledenja ponudbam (demo + E2E) ────
// Enkratni skript: nastavi status + časovne žige tako, da je lijak
// realističen (poslana brez odgovora, sprejeta, zavrnjeni, osnutek
// s pretečenim opomnikom). Ročno izračunana pričakovana stanja:
//   lijak: draft 1 · sent 1 · accepted 1 · rejected 2 → decided 3
//   win-rate = 1/3 = 33,33 % · avgAccepted = 1.427,40 € (Jože)
//   za opomnik: Tanja (opomnik včeraj) pred Marijo (10 dni brez odgovora)

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

async function main() {
  const offers = await db.offer.findMany({ orderBy: { number: 'asc' } });
  const byCustomer = (name: string) => offers.find((o) => o.customerName.startsWith(name));

  const plan: Array<[string, string, Date?, Date?, Date?]> = [
    // [ime, status, sentAt, decidedAt, followUpAt]
    ['Marija', 'sent', ago(10), null, null],
    ['Jože', 'accepted', ago(9), ago(4), null],
    ['Ana', 'rejected', ago(12), ago(6), null],
    ['Rok', 'rejected', ago(8), ago(3), null],
    ['Tanja', 'draft', null, null, ago(1)],
  ];

  for (const [name, status, sentAt, decidedAt, followUpAt] of plan) {
    const o = byCustomer(name);
    if (!o) { console.error(`✗ ponudba ${name} ni najdena`); continue; }
    await db.offer.update({
      where: { id: o.id },
      data: { status, sentAt, decidedAt, followUpAt },
    });
    console.log(`✓ ${o.number} ${o.customerName} → ${status} (sent ${sentAt?.toISOString().slice(0, 10) ?? '—'}, decided ${decidedAt?.toISOString().slice(0, 10) ?? '—'}, followUp ${followUpAt?.toISOString().slice(0, 10) ?? '—'})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
