import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { nextStatusData } from '@/lib/offer-pipeline';
import type { OfferStatus } from '@/lib/types';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';

const VALID_STATUS = ['draft', 'sent', 'accepted', 'rejected'];

const toDateOrNull = (v: unknown): Date | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : undefined;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'offers', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    // findFirst (ne findUnique): obseg po lastniku je del where —
    // tuj zapis je 404 ("ne obstaja"), ne 403 ("obstaja, a ni tvoj"),
    // ker obstoj tujega zapisa ne sme biti berljiv iz odgovora.
    const offer = await db.offer.findFirst({
      where: { id, ...ownScope(uid) },
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
  const zavrnjen = await requireAccess(req, 'offers', 'PATCH');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const body = await req.json();
    const uid = await resolveOwner(req);

    const existing = await db.offer.findFirst({
      where: { id, ...ownScope(uid) },
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

    const offer = await db.offer.updateMany({
      where: { id, ...ownScope(uid) },
      data,
    });
    if (offer.count === 0) {
      // Med preverbo in zapisom izginilo (brisanje/obseg) — pošteno 404.
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }
    const fresh = await db.offer.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!fresh) {
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }
    return NextResponse.json({ offer: fresh });
  } catch (error) {
    console.error('offer PATCH error', error);
    return NextResponse.json({ error: 'Napaka pri posodabljanju ponudbe' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'offers', 'DELETE');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    // deleteMany z obsegom: brise SAMO svoj zapis; tuji (ali že
    // izginili) zapis pusti count=0 → 404. deleteMany ne metejo
    // P2025 (record not found) kot delete.
    const result = await db.offer.deleteMany({ where: { id, ...ownScope(uid) } });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('offer DELETE error', error);
    return NextResponse.json({ error: 'Napaka pri brisanju ponudbe' }, { status: 500 });
  }
}
