import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const VALID_STATUS = ['draft', 'sent', 'accepted', 'rejected'];

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
    if (body.status && !VALID_STATUS.includes(body.status)) {
      return NextResponse.json({ error: 'Neveljaven status' }, { status: 400 });
    }
    const offer = await db.offer.update({
      where: { id },
      data: { status: body.status },
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
