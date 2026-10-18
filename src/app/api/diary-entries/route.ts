import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isDiaryPhase, parseDiaryPhotos } from '@/lib/site-diary';
import { requireSession } from '@/lib/auth-guard';

// ─── GET /api/diary-entries — seznam dnevniških vnosov ──────
// ?offerId=... filtrira po ponudbi; ?photos=1 vrne tudi polne
// slike (privzeto samo male sličice — seznami ostanejo hitri).
// Vrstni red: dan padajoče, znotraj dneva createdAt padajoče.

export async function GET(req: NextRequest) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const offerId = req.nextUrl.searchParams.get('offerId') ?? null;
    const withPhotos = req.nextUrl.searchParams.get('photos') === '1';

    const rows = await db.diaryEntry.findMany({
      where: offerId ? { offerId } : {},
      orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: { offer: { select: { number: true } } },
    });

    const entries = rows.map((e) => {
      let photos: { dataUrl: string; thumb: string | null; caption: string | null }[] = [];
      try {
        const parsed = JSON.parse(e.photos) as unknown;
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
        // pokvarjen JSON → kot brez fotografij (iskreno, brez crasha)
      }
      return {
        id: e.id,
        day: e.day,
        phase: e.phase,
        note: e.note,
        offerId: e.offerId,
        offerNumber: e.offer?.number ?? null,
        objectLabel: e.objectLabel,
        createdAt: e.createdAt.toISOString(),
        photos: withPhotos
          ? photos
          : photos.map((p) => ({ dataUrl: p.thumb ?? '', thumb: p.thumb, caption: p.caption })),
      };
    });

    return NextResponse.json({ entries });
  } catch (err) {
    console.error('GET /api/diary-entries failed:', err);
    return NextResponse.json({ error: 'Dnevnika ni bilo mogoče naložiti' }, { status: 500 });
  }
}

// ─── POST /api/diary-entries — nov vnos ─────────────────────
// Validacija je stroga in neodvisna od klienta: dan "YYYY-MM-DD",
// znana faza, opis 0–500, ponudba mora obstajati, fotke ≤ 6 dataURL.

export async function POST(req: NextRequest) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const body = (await req.json()) as {
      day?: unknown;
      phase?: unknown;
      note?: unknown;
      offerId?: unknown;
      objectLabel?: unknown;
      photos?: unknown;
    };

    const day = typeof body.day === 'string' ? body.day : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())) {
      return NextResponse.json({ error: 'Dan mora biti datum v obliki YYYY-MM-DD' }, { status: 400 });
    }

    if (!isDiaryPhase(body.phase)) {
      return NextResponse.json({ error: 'Faza mora biti ena od znanih faz dela' }, { status: 400 });
    }
    const phase = body.phase;

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (note.length > 500) {
      return NextResponse.json({ error: 'Opis sme imeti največ 500 znakov' }, { status: 400 });
    }

    let offerId: string | null = null;
    if (body.offerId !== null && body.offerId !== undefined && body.offerId !== '') {
      if (typeof body.offerId !== 'string') {
        return NextResponse.json({ error: 'Ponudba mora biti ID ali null' }, { status: 400 });
      }
      const offer = await db.offer.findUnique({ where: { id: body.offerId }, select: { id: true } });
      if (!offer) {
        return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 400 });
      }
      offerId = body.offerId;
    }

    let objectLabel: string | null = null;
    if (typeof body.objectLabel === 'string' && body.objectLabel.trim() !== '') {
      objectLabel = body.objectLabel.trim().slice(0, 80);
    }

    const parsed = parseDiaryPhotos(body.photos);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const photosJson = JSON.stringify(
      parsed.photos.map((p) => ({ dataUrl: p.dataUrl, thumb: p.thumb, caption: p.caption })),
    );

    const created = await db.diaryEntry.create({
      data: { day, phase, note, offerId, objectLabel, photos: photosJson },
      include: { offer: { select: { number: true } } },
    });

    return NextResponse.json({
      entry: {
        id: created.id,
        day: created.day,
        phase: created.phase,
        note: created.note,
        offerId: created.offerId,
        offerNumber: created.offer?.number ?? null,
        objectLabel: created.objectLabel,
        createdAt: created.createdAt.toISOString(),
        photos: parsed.photos,
      },
    });
  } catch (err) {
    console.error('POST /api/diary-entries failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče shraniti' }, { status: 500 });
  }
}
