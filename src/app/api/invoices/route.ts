import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';

// ─── Računi — iz sprejete ponudbe ───────────────────────────
// Raziskava (ambrook, projul, contractorforeman): najboljši
// workflow je »estimate converts directly to invoice« — sprejeta
// ponudba je komercialna osnova računa. Številčenje je
// deterministično in strežniško: RAC-LETO-NNN.
// Task 44: žigi plačil (dueAt/paidAt) dodeljuje STREŽNIK — klient
// ne more izmisliti zgodovine plačil (isti vzorec kot pri ponudbah).

import { DEFAULT_DUE_DAYS } from '@/lib/payment-tracking';

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  try {
    await ensureSeeded();
    const invoices = await db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: { offer: { select: { number: true } } },
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

    // Deterministično številčenje: RAC-LETO-NNN
    const year = new Date().getFullYear();
    const count = await db.invoice.count({
      where: { number: { startsWith: `RAC-${year}-` } },
    });
    const number = `RAC-${year}-${String(count + 1).padStart(3, '0')}`;

    // Privzeti rok: DEFAULT_DUE_DAYS od izdaje (dodeli strežnik).
    const due = new Date();
    due.setDate(due.getDate() + DEFAULT_DUE_DAYS);

    const invoice = await db.invoice.create({
      data: {
        number,
        offerId: offer.id,
        customerName: offer.customerName,
        subtotal: r2(offer.subtotal),
        vatRate: offer.vatRate,
        vatAmount: r2(offer.vatAmount),
        total: r2(offer.total),
        dueAt: due,
      },
    });

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
      },
    });
  } catch (error) {
    console.error('invoices POST error', error);
    return NextResponse.json({ error: 'Napaka pri izdaji računa' }, { status: 500 });
  }
}
