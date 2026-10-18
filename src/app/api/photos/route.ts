// ─── GET/POST /api/photos — galerija zajetih fotografij ─────
// Task 96 (issue #3): polna vsebina je na DISKU (db/photos), v bazi
// samo ime datoteke + sličica (256 px). SEZNAM ne vrača dataUrl —
// vsaka vrstica nosi thumbUrl (mala sličica) in imageUrl (pot do
// polne vsebine prek /api/photos/[id]/image). Celotna fotka se naloži
// POSAMEZNO (GET /api/photos/[id]), kadar jo uporabnik res odpre.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { resolvePhotoDir, savePhoto } from '@/lib/photo-store';

export const maxDuration = 60;

const MAX_BASE64 = 7_500_000;

// GET — seznam zadnjih 24 fotografij (najnovejše naprej), BREZ polne
// vsebine: sličica + povezava do polne. Legacy vrstice (pred Taskom 96,
// še z dataUrl v bazi) imajo sličico null — seznam ostane lahkoten,
// selitev se zgodi ob prvem odpiranju fotke.
export async function GET(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const uid = await resolveOwner(req);
    const photos = await db.photo.findMany({
      where: ownScope(uid),
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        title: true,
        craftId: true,
        thumbUrl: true,
        analysis: true,
        measurements: true,
        vizState: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      photos: photos.map((p) => ({ ...p, imageUrl: `/api/photos/${p.id}/image` })),
    });
  } catch (err) {
    console.error('[photos GET]', err);
    return NextResponse.json({ error: 'Ni mogoče naložiti galerije.' }, { status: 500 });
  }
}

// POST — shrani fotografijo s samodejno analizo in merjenjem.
// Vnosni pogodba NEspremenjena (dataUrl v JSON), spremeni se shramba:
// bajti na disk, v bazi filePath + thumbUrl, dataUrl ostane null.
export async function POST(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const body = (await req.json()) as {
      title?: unknown;
      dataUrl?: unknown;
      craftId?: unknown;
      analysis?: unknown;
      measurements?: unknown;
    };

    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    if (!dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Manjka veljavna fotografija.' }, { status: 400 });
    }
    if (dataUrl.length > MAX_BASE64) {
      return NextResponse.json({ error: 'Fotografija je prevelika.' }, { status: 413 });
    }

    const uid = await resolveOwner(req);

    const photo = await db.photo.create({
      data: {
        // Galerija pripada obrtu (Task 94) — fotke so poslovni podatek.
        ownerId: uid,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null,
        craftId: typeof body.craftId === 'string' && body.craftId.trim() ? body.craftId.trim().slice(0, 40) : null,
        analysis: typeof body.analysis === 'string' ? body.analysis.slice(0, 100_000) : null,
        measurements: typeof body.measurements === 'string' ? body.measurements.slice(0, 20_000) : null,
      },
    });

    // Bajti na disk pod <id>.<ext>; če disk ne uspe, vrstica ne sme
    // ostati kot slepa — pobrišemo jo in javimo 500 (iskreno).
    try {
      const dir = resolvePhotoDir();
      const saved = await savePhoto(dataUrl, photo.id, dir);
      if (!saved) throw new Error('neveljavna vsebina za disk');
      await db.photo.update({
        where: { id: photo.id },
        data: { filePath: saved.fileName, thumbUrl: saved.thumb },
      });
    } catch (saveErr) {
      console.error('[photos POST disk]', saveErr);
      await db.photo.delete({ where: { id: photo.id } }).catch(() => {});
      return NextResponse.json({ error: 'Shranjevanje fotografije ni uspelo.' }, { status: 500 });
    }

    const stored = await db.photo.findUnique({
      where: { id: photo.id },
      select: {
        id: true,
        title: true,
        craftId: true,
        thumbUrl: true,
        analysis: true,
        measurements: true,
        vizState: true,
        createdAt: true,
      },
    });
    return NextResponse.json(
      { photo: stored ? { ...stored, imageUrl: `/api/photos/${photo.id}/image` } : { id: photo.id } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[photos POST]', err);
    return NextResponse.json({ error: 'Shranjevanje fotografije ni uspelo.' }, { status: 500 });
  }
}
