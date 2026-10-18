import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isDiaryPhase, parseDiaryPhotos } from '@/lib/site-diary';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { loadDiaryPhotos, persistDiaryMigration, storeDiaryPhotos } from '@/lib/diary-photos-disk';
import { resolvePhotoDir } from '@/lib/photo-store';

// ─── GET /api/diary-entries — seznam dnevniških vnosov ──────
// ?offerId=... filtrira po ponudbi; ?photos=1 vrne tudi polne
// slike (privzeto samo male sličice — seznami ostanejo hitri).
// Task 96: polne fotke so na DISKU — ?photos=1 jih materializira
// iz datotek; legacy vnosi se ob branju LENO selijo na disk.
// Vrstni red: dan padajoče, znotraj dneva createdAt padajoče.

export async function GET(req: NextRequest) {
  const zavrnjen = await requireAccess(req, 'diary-entries', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const offerId = req.nextUrl.searchParams.get('offerId') ?? null;
    const withPhotos = req.nextUrl.searchParams.get('photos') === '1';
    const uid = await resolveOwner(req);

    // Obseg (Task 94) + filter po ponudbi; tuj offerId prijavi
    // PRAZEN seznam, ne tujih vnosov (id ne sme biti bralni ključ).
    const rows = await db.diaryEntry.findMany({
      where: {
        ...ownScope(uid),
        ...(offerId ? { offerId } : {}),
      },
      orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: { offer: { select: { number: true } } },
    });

    const dir = resolvePhotoDir();
    const entries: {
      id: string;
      day: string;
      phase: string;
      note: string;
      offerId: string | null;
      offerNumber: string | null;
      objectLabel: string | null;
      createdAt: string;
      photos: { dataUrl: string; thumb: string | null; caption: string | null }[];
    }[] = [];
    for (const e of rows) {
      const { out: photos, migrated } = await loadDiaryPhotos(e.photos, dir, withPhotos);
      if (migrated) await persistDiaryMigration(e.id, migrated);
      entries.push({
        id: e.id,
        day: e.day,
        phase: e.phase,
        note: e.note,
        offerId: e.offerId,
        offerNumber: e.offer?.number ?? null,
        objectLabel: e.objectLabel,
        createdAt: e.createdAt.toISOString(),
        photos,
      });
    }

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
  const zavrnjen = await requireAccess(req, 'diary-entries', 'POST');
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
      const uid = await resolveOwner(req);
      // Samo ponudba ISTEGA obrta sme biti vezava (Task 94).
      const offer = await db.offer.findFirst({
        where: { id: body.offerId, ...ownScope(uid) },
        select: { id: true },
      });
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
    // Task 96: bajti na DISK, v bazi ime datoteke + sličica.
    const dir = resolvePhotoDir();
    const { stored, error } = await storeDiaryPhotos(parsed.photos, dir);
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    const photosJson = JSON.stringify(stored);

    const uid = await resolveOwner(req);
    const created = await db.diaryEntry.create({
      data: { ownerId: uid, day, phase, note, offerId, objectLabel, photos: photosJson },
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
