import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';
import { createWithUniqueNumber } from '@/lib/numbering';

// ─── Računi — iz sprejete ponudbe ───────────────────────────
// Raziskava (ambrook, projul, contractorforeman): najboljši
// workflow je »estimate converts directly to invoice« — sprejeta
// ponudba je komercialna osnova računa. Številčenje je
// deterministično in strežniško: RAC-LETO-NNN.
// Task 44: žigi plačil (dueAt/paidAt) dodeljuje STREŽNIK — klient
// ne more izmisliti zgodovine plačil (isti vzorec kot pri ponudbah).
// Task 49: ob izdaji se postavke ponudbe ZAPIEJEJO kot snapshot
// (InvoiceItem) — e-račun (EN 16931, ZIERDED od 2028) zahteva vrstice
// (BR-16) in zgodovina računa ne sme slediti poznejšim spremembam ponudbe.

import { readSettings } from '@/lib/settings-inputs';

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  try {
    await ensureSeeded();
    const invoices = await db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        offer: { select: { number: true } },
        _count: { select: { items: true } },
      },
    });
    return NextResponse.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        offerId: i.offerId,
        offerNumber: i.offer.number,
        customerName: i.customerName,
        subtotal: i.subtotal,
        vatRate: i.vatRate,
        vatAmount: i.vatAmount,
        total: i.total,
        dueAt: i.dueAt ? i.dueAt.toISOString() : null,
        paidAt: i.paidAt ? i.paidAt.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
        // Task 49: št. postavk v snapshotu (0 = starejši račun brez snapshotov)
        itemCount: i._count.items,
      })),
    });
  } catch (error) {
    console.error('invoices GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju računov' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const body = await req.json();
    const offerId = typeof body.offerId === 'string' ? body.offerId : '';
    if (!offerId) {
      return NextResponse.json({ error: 'Manjka ID ponudbe' }, { status: 400 });
    }

    const offer = await db.offer.findUnique({
      where: { id: offerId },
      include: { items: true },
    });
    if (!offer) {
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }
    if (offer.items.length === 0) {
      return NextResponse.json({ error: 'Ponudba je brez postavk' }, { status: 400 });
    }

    // Deterministično številčenje: RAC-LETO-NNN. Izračun številke je v
    // generate, da ga ob P2002 (dva sočasna izdajanja iz iste ponudbe)
    // lahko jedro ponovi — zahteva ne pade s 500
    // (glej src/lib/numbering.ts in tests/verify/numbering-retry.ts).
    const year = new Date().getFullYear();
    const nextNumber = async (): Promise<string> => {
      const count = await db.invoice.count({
        where: { number: { startsWith: `RAC-${year}-` } },
      });
      return `RAC-${year}-${String(count + 1).padStart(3, '0')}`;
    };

    // Rok plačila: SHRANJENA nastavitev, skozi ISTO okno kot račun v PDF in
    // evidenca terjatev. Prej je bil tu hardcodiran 30 dni, PDF pa je pisal
    // iz paymentDays (in ob prazni nastavitvi iz 15) — isti račun je imel dva
    // datuma zapadlosti. Če vnos ni veljaven, rok OSTANE prazen; ga ne izmislimo.
    const settingsRow = await db.settings.findUnique({ where: { id: 'default' } });
    const rok = readSettings(settingsRow ?? {}).paymentDays;
    const due = rok.problem ? null : new Date(Date.now() + rok.value * 86_400_000);

    const { value: invoice } = await createWithUniqueNumber(nextNumber, (number) =>
      db.invoice.create({
        data: {
          number,
          offerId: offer.id,
          customerName: offer.customerName,
          subtotal: r2(offer.subtotal),
          vatRate: offer.vatRate,
          vatAmount: r2(offer.vatAmount),
          total: r2(offer.total),
          dueAt: due,
          // Snapshot postavk — pravi zgodovinski dokaz za e-račun (BR-16)
          items: {
            create: [...offer.items]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((it) => ({
                name: it.name,
                description: it.description,
                quantity: it.quantity,
                unit: it.unit,
                unitPrice: it.unitPrice,
                total: it.total,
                sortOrder: it.sortOrder,
              })),
          },
        },
        include: { _count: { select: { items: true } } },
      }),
    );

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        number: invoice.number,
        offerId: invoice.offerId,
        offerNumber: offer.number,
        customerName: invoice.customerName,
        subtotal: invoice.subtotal,
        vatRate: invoice.vatRate,
        vatAmount: invoice.vatAmount,
        total: invoice.total,
        dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
        paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
        createdAt: invoice.createdAt.toISOString(),
        itemCount: invoice._count.items,
      },
    });
  } catch (error) {
    console.error('invoices POST error', error);
    return NextResponse.json({ error: 'Napaka pri izdaji računa' }, { status: 500 });
  }
}
