import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isDiaryPhase, parseDiaryPhotos } from '@/lib/site-diary';
import { requireSession } from '@/lib/auth-guard';

// ─── PATCH /api/diary-entries/[id] — urejanje vnosa ─────────
// Vsako polje je opcijsko (samo poslana se spreminjajo); ista
// validacija kot pri POST. 404 za neobstoječ vnos.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const existing = await db.diaryEntry.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }

    const body = (await req.json()) as {
      day?: unknown;
      phase?: unknown;
      note?: unknown;
      offerId?: unknown;
      objectLabel?: unknown;
      photos?: unknown;
    };

    const data: {
      day?: string;
      phase?: string;
      note?: string;
      offerId?: string | null;
      objectLabel?: string | null;
      photos?: string;
    } = {};

    if (body.day !== undefined) {
      const day = typeof body.day === 'string' ? body.day : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())) {
        return NextResponse.json({ error: 'Dan mora biti datum v obliki YYYY-MM-DD' }, { status: 400 });
      }
      data.day = day;
    }

    if (body.phase !== undefined) {
      if (!isDiaryPhase(body.phase)) {
        return NextResponse.json({ error: 'Faza mora biti ena od znanih faz dela' }, { status: 400 });
      }
      data.phase = body.phase;
    }

    if (body.note !== undefined) {
      if (typeof body.note !== 'string') {
        return NextResponse.json({ error: 'Opis mora biti besedilo' }, { status: 400 });
      }
      const note = body.note.trim().slice(0, 500);
      data.note = note;
    }

    if (body.offerId !== undefined) {
      if (body.offerId === null || body.offerId === '') {
        data.offerId = null;
      } else if (typeof body.offerId === 'string') {
        const offer = await db.offer.findUnique({ where: { id: body.offerId }, select: { id: true } });
        if (!offer) {
          return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 400 });
        }
        data.offerId = body.offerId;
      } else {
        return NextResponse.json({ error: 'Ponudba mora biti ID ali null' }, { status: 400 });
      }
    }

    if (body.objectLabel !== undefined) {
      if (body.objectLabel === null || (typeof body.objectLabel === 'string' && body.objectLabel.trim() === '')) {
        data.objectLabel = null;
      } else if (typeof body.objectLabel === 'string') {
        data.objectLabel = body.objectLabel.trim().slice(0, 80);
      } else {
        return NextResponse.json({ error: 'Oznaka objekta mora biti besedilo ali null' }, { status: 400 });
      }
    }

    if (body.photos !== undefined) {
      const parsed = parseDiaryPhotos(body.photos);
      if (parsed.error) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      data.photos = JSON.stringify(
        parsed.photos.map((p) => ({ dataUrl: p.dataUrl, thumb: p.thumb, caption: p.caption })),
      );
    }

    const updated = await db.diaryEntry.update({
      where: { id },
      data,
      include: { offer: { select: { number: true } } },
    });

    let photos: { dataUrl: string; thumb: string | null; caption: string | null }[] = [];
    try {
      const parsed = JSON.parse(updated.photos) as unknown;
      if (Array.isArray(parsed)) {
        photos = parsed
          .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
          .map((p) => ({
            dataUrl: typeof p.dataUrl === 'string' ? p.dataUrl : '',
            thumb: typeof p.thumb === 'string' ? p.thumb : null,
            caption: typeof p.caption === 'string' ? p.caption : null,
          }))
          .filter((p) => p.dataUrl !== '');
      }
    } catch {
      // pokvarjen JSON → prazno
    }

    return NextResponse.json({
      entry: {
        id: updated.id,
        day: updated.day,
        phase: updated.phase,
        note: updated.note,
        offerId: updated.offerId,
        offerNumber: updated.offer?.number ?? null,
        objectLabel: updated.objectLabel,
        createdAt: updated.createdAt.toISOString(),
        photos,
      },
    });
  } catch (err) {
    console.error('PATCH /api/diary-entries/[id] failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče posodobiti' }, { status: 500 });
  }
}

// ─── DELETE /api/diary-entries/[id] ─────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const existing = await db.diaryEntry.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    await db.diaryEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/diary-entries/[id] failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče izbrisati' }, { status: 500 });
  }
}
