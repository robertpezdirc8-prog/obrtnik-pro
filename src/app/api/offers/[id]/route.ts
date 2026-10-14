import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { nextStatusData } from '@/lib/offer-pipeline';
import type { OfferStatus } from '@/lib/types';

const VALID_STATUS = ['draft', 'sent', 'accepted', 'rejected'];

const toDateOrNull = (v: unknown): Date | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : undefined;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const offer = await db.offer.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!offer) {
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }
    return NextResponse.json({ offer });
  } catch (error) {
    console.error('offer GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju ponudbe' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const existing = await db.offer.findUnique({
      where: { id },
      select: { sentAt: true, decidedAt: true, followUpAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }

    // Časovni žigi in opomnik — nastavlja strežnik po pogodbi prehodov.
    let data: {
      status?: string;
      sentAt?: Date | null;
      decidedAt?: Date | null;
      followUpAt?: Date | null;
    } = {};

    if (body.status !== undefined) {
      if (!VALID_STATUS.includes(body.status)) {
        return NextResponse.json({ error: 'Neveljaven status' }, { status: 400 });
      }
      const stamps = nextStatusData(
        body.status as OfferStatus,
        { sentAt: existing.sentAt?.toISOString(), decidedAt: existing.decidedAt?.toISOString() },
      );
      data = { status: body.status, ...stamps };
    }

    // Ročni opomnik (Wiedervorlage) — neodvisno od statusa.
    if (body.followUpAt !== undefined) {
      const fu = toDateOrNull(body.followUpAt);
      if (fu === undefined) {
        return NextResponse.json({ error: 'Neveljaven datum opomnika' }, { status: 400 });
      }
      data.followUpAt = fu;
    }

    const offer = await db.offer.update({
      where: { id },
      data,
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return NextResponse.json({ offer });
  } catch (error) {
    console.error('offer PATCH error', error);
    return NextResponse.json({ error: 'Napaka pri posodabljanju ponudbe' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.offer.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('offer DELETE error', error);
    return NextResponse.json({ error: 'Napaka pri brisanju ponudbe' }, { status: 500 });
  }
}
