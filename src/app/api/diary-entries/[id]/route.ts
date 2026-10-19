import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isDiaryPhase, parseDiaryPhotos } from '@/lib/site-diary';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { loadDiaryPhotos, storeDiaryPhotos } from '@/lib/diary-photos-disk';
import { deletePhotoFile, deletePhotoFileAsync, resolvePhotoDir, safeFileName } from '@/lib/photo-store';

// ─── PATCH /api/diary-entries/[id] — urejanje vnosa ─────────
// Vsako polje je opcijsko (samo poslana se spreminjajo); ista
// validacija kot pri POST. 404 za neobstoječ vnos.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireAccess(req, 'diary-entries', 'PATCH');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const existing = await db.diaryEntry.findFirst({
      where: { id, ...ownScope(uid) },
      select: { id: true },
    });
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
        // Vezava sme iti samo na ponudbo ISTEGA obrta (Task 94).
        const offer = await db.offer.findFirst({
          where: { id: body.offerId, ...ownScope(uid) },
          select: { id: true },
        });
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
      // Task 96: bajti na DISK; STARE datoteke izginejo (zamenjava
      // celotnega polja — brez orphan datotek).
      const dir = resolvePhotoDir();
      const old = await db.diaryEntry.findUnique({
        where: { id },
        select: { photos: true },
      });
      try {
        const oldParsed = JSON.parse(old?.photos ?? '[]') as unknown;
        if (Array.isArray(oldParsed)) {
          for (const p of oldParsed) {
            if (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).file === 'string') {
              const f = (p as { file: string }).file;
              if (safeFileName(f)) await deletePhotoFileAsync(f, dir);
            }
          }
        }
      } catch {
        // pokvarjen JSON → ni starih datotek za brisanje
      }
      const { stored, error } = await storeDiaryPhotos(parsed.photos, dir);
      if (error) {
        return NextResponse.json({ error }, { status: 500 });
      }
      data.photos = JSON.stringify(stored);
    }

    const upd = await db.diaryEntry.updateMany({
      where: { id, ...ownScope(uid) },
      data,
    });
    if (upd.count === 0) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    const updated = await db.diaryEntry.findUnique({
      where: { id },
      include: { offer: { select: { number: true } } },
    });
    if (!updated) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }

    // Odgovor: fotke materializirane s diska (polne) — ista oblika
    // kot prej, vsebina pa iz datotek (Task 96).
    const { out: photos } = await loadDiaryPhotos(updated.photos, resolvePhotoDir(), true);

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
  const zavrnjen = await requireAccess(req, 'diary-entries', 'DELETE');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    // Datoteke pobere PRED brisanjem vrstice (potem jih ni več v bazi).
    const row = await db.diaryEntry.findFirst({
      where: { id, ...ownScope(uid) },
      select: { photos: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    const del = await db.diaryEntry.deleteMany({ where: { id, ...ownScope(uid) } });
    if (del.count === 0) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    // Datoteke na disku (najboljše prizadevanje — vrstica je že izbrisana).
    const dir = resolvePhotoDir();
    try {
      const parsed = JSON.parse(row.photos) as unknown;
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).file === 'string') {
            const f = (p as { file: string }).file;
            if (safeFileName(f)) await deletePhotoFileAsync(f, dir);
          }
        }
      }
    } catch {
      // pokvarjen JSON → ni datotek za brisanje
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/diary-entries/[id] failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče izbrisati' }, { status: 500 });
  }
}
