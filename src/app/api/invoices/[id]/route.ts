import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── PATCH /api/invoices/[id] — žigi plačil ─────────────────
// dueAt in paidAt sta zabeleži STREŽNIŠKA (klient pošlje namen,
// strežnik validira in shrani) — zgodovina plačil se ne izmišljuje.
// paidAt: ISO ali null (razveljavi plačilo). dueAt: ISO ali null
// (vrne se na privzeti rok). Neveljaven datum → 400.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const existing = await db.invoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Račun ne obstaja' }, { status: 404 });
    }

    const body = (await req.json()) as { paidAt?: unknown; dueAt?: unknown };

    const data: { paidAt?: Date | null; dueAt?: Date | null } = {};

    if (body.paidAt !== undefined) {
      if (body.paidAt === null) {
        data.paidAt = null;
      } else if (typeof body.paidAt === 'string') {
        const d = new Date(body.paidAt);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Neveljaven datum plačila' }, { status: 400 });
        }
        data.paidAt = d;
      } else {
        return NextResponse.json({ error: 'paidAt mora biti ISO datum ali null' }, { status: 400 });
      }
    }

    if (body.dueAt !== undefined) {
      if (body.dueAt === null) {
        data.dueAt = null;
      } else if (typeof body.dueAt === 'string') {
        const d = new Date(body.dueAt);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Neveljaven rok plačila' }, { status: 400 });
        }
        data.dueAt = d;
      } else {
        return NextResponse.json({ error: 'dueAt mora biti ISO datum ali null' }, { status: 400 });
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Ni sprememb' }, { status: 400 });
    }

    const invoice = await db.invoice.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        number: invoice.number,
        offerId: invoice.offerId,
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
    console.error('invoices PATCH error', error);
    return NextResponse.json({ error: 'Napaka pri posodabljanju računa' }, { status: 500 });
  }
}
