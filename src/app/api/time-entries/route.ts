import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth-guard';

// ─── GET /api/time-entries — seznam vnosov časovnice ────────
// Vrstni red: dan padajoče, nato createdAt padajoče (najnovejši
// vnos dneva zgoraj). Omejitev 500 vnosov (zadostno za sezname).

export async function GET(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const rows = await db.timeEntry.findMany({
      orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const entries = rows.map((e) => ({
      id: e.id,
      day: e.day,
      description: e.description,
      minutes: e.minutes,
      hourlyRate: e.hourlyRate,
      customerName: e.customerName,
      offerId: e.offerId,
      craftId: e.craftId,
      billedAt: e.billedAt ? e.billedAt.toISOString() : null,
      billedRef: e.billedRef,
      createdAt: e.createdAt.toISOString(),
    }));
    return NextResponse.json({ entries });
  } catch (err) {
    console.error('GET /api/time-entries failed:', err);
    return NextResponse.json({ error: 'Vnosov ni bilo mogoče naložiti' }, { status: 500 });
  }
}

// ─── POST /api/time-entries — nov vnos ──────────────────────
// Validacija je stroga in neodvisna od klienta: dan "YYYY-MM-DD",
// opis 1–200 znakov, minute 1–1440, urna postavka > 0.

export async function POST(req: NextRequest) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const body = (await req.json()) as {
      day?: unknown;
      description?: unknown;
      minutes?: unknown;
      hourlyRate?: unknown;
      customerName?: unknown;
      offerId?: unknown;
      craftId?: unknown;
    };

    const day = typeof body.day === 'string' ? body.day : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())) {
      return NextResponse.json({ error: 'Dan mora biti datum v obliki YYYY-MM-DD' }, { status: 400 });
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 1 || description.length > 200) {
      return NextResponse.json({ error: 'Opis mora imeti 1–200 znakov' }, { status: 400 });
    }

    const minutes = typeof body.minutes === 'number' ? Math.round(body.minutes) : NaN;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
      return NextResponse.json({ error: 'Minute morajo biti med 1 in 1440' }, { status: 400 });
    }

    const hourlyRate = typeof body.hourlyRate === 'number' ? body.hourlyRate : NaN;
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || hourlyRate > 1000) {
      return NextResponse.json({ error: 'Urna postavka mora biti med 0 in 1000 €/h' }, { status: 400 });
    }

    const customerName = typeof body.customerName === 'string' && body.customerName.trim() !== ''
      ? body.customerName.trim().slice(0, 120)
      : null;

    let offerId: string | null = null;
    if (typeof body.offerId === 'string' && body.offerId.trim() !== '') {
      const offer = await db.offer.findUnique({ where: { id: body.offerId } });
      if (!offer) {
        return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 400 });
      }
      offerId = offer.id;
    }

    const craftId = typeof body.craftId === 'string' && body.craftId.trim() !== ''
      ? body.craftId.trim()
      : null;

    const entry = await db.timeEntry.create({
      data: { day, description, minutes, hourlyRate, customerName, offerId, craftId },
    });

    return NextResponse.json({
      entry: {
        id: entry.id,
        day: entry.day,
        description: entry.description,
        minutes: entry.minutes,
        hourlyRate: entry.hourlyRate,
        customerName: entry.customerName,
        offerId: entry.offerId,
        craftId: entry.craftId,
        billedAt: null,
        billedRef: null,
        createdAt: entry.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err) {
    console.error('POST /api/time-entries failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče shraniti' }, { status: 500 });
  }
}
