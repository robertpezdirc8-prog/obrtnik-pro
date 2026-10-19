// ─── GET/PATCH/DELETE /api/photos/[id] ───────────────────────
// GET (Task 96): celotna fotka — vsebina s diska kot dataURL. LEGATA
// vrstica (dataUrl še v bazi) se tu LENO SELI na disk: prvi odpiranje
// zapiše datoteko, nastavi filePath + thumbUrl in izprazne dataUrl.
// Selitev je idempotentna in ne spremeni odgovora.
// PATCH: meritve / viz-stanje (nespremenjeno).
// DELETE: vrstica + DATOTEKA na disku (najboljše prizadevanje).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { deletePhotoFile, deletePhotoFileAsync, readPhotoAsDataUrl, readPhotoAsDataUrlAsync, resolvePhotoDir, savePhoto } from '@/lib/photo-store';

/** Materializiraj polno fotko iz OBSEGANE vrstice (vrstico je GET že
 *  prebral z ownScope — tukaj se nikoli ne dostopa po id na slepo):
 *  disk → dataURL; legacy vrstica → lena selitev na disk. Vrne
 *  { dataUrl, thumbUrl } ali null (vsebina manjka na obeh mestih). */
async function materializeDataUrl(
  row: { id: string; filePath: string | null; dataUrl: string | null; thumbUrl: string | null },
): Promise<{ dataUrl: string; thumbUrl: string | null } | null> {
  const dir = resolvePhotoDir();
  if (row.filePath) {
    const dataUrl = await readPhotoAsDataUrlAsync(row.filePath, dir);
    if (dataUrl) return { dataUrl, thumbUrl: row.thumbUrl };
    // Datoteka manjka, legacy vsebina pa je morda še v bazi — poskusi.
    if (row.dataUrl) return { dataUrl: row.dataUrl, thumbUrl: row.thumbUrl };
    return null;
  }
  if (!row.dataUrl) return null;
  // LENA SELITEV (idempotentna): baza → disk → ČIST zapis (dataUrl
  // izpraznjen — baza ne sme še enkrat nositi vsebine).
  const saved = await savePhoto(row.dataUrl, row.id, dir);
  if (!saved) {
    // disk ne uspe → starejše vedenje (fotka iz baze), brez crash
    return { dataUrl: row.dataUrl, thumbUrl: row.thumbUrl };
  }
  const thumbUrl = row.thumbUrl ?? saved.thumb;
  await db.photo.update({
    where: { id: row.id },
    data: { filePath: saved.fileName, thumbUrl, dataUrl: null },
  });
  return { dataUrl: row.dataUrl, thumbUrl };
}

// GET — celotna fotka (meta + dataUrl s diska). Tuj zapis je 404
// (obstoj tujega zapisa ni berljiv — Task 94). Prvi stik z bazo je
// OBSEGAN (findFirst z ownScope) — vrstica gre v materializacijo.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireAccess(req, 'photos', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const photo = await db.photo.findFirst({
      where: { id, ...ownScope(uid) },
      select: {
        id: true,
        title: true,
        craftId: true,
        thumbUrl: true,
        analysis: true,
        measurements: true,
        vizState: true,
        createdAt: true,
        filePath: true,
        dataUrl: true,
      },
    });
    if (!photo) {
      return NextResponse.json({ error: 'Fotografija ne obstaja.' }, { status: 404 });
    }
    const materialized = await materializeDataUrl(photo);
    if (!materialized) {
      // Registr pravi, da fotka obstaja, disk pa je izgubil vsebino —
      // iskreno 404 z razlogom, ne prazna slika.
      return NextResponse.json({ error: 'Vsebina fotografije manjka.' }, { status: 404 });
    }
    const { dataUrl, thumbUrl } = materialized;
    return NextResponse.json({
      photo: {
        id: photo.id,
        title: photo.title,
        craftId: photo.craftId,
        thumbUrl,
        analysis: photo.analysis,
        measurements: photo.measurements,
        vizState: photo.vizState,
        createdAt: photo.createdAt,
        dataUrl,
        imageUrl: `/api/photos/${photo.id}/image`,
      },
    });
  } catch (err) {
    console.error('[photos GET id]', err);
    return NextResponse.json({ error: 'Nalaganje fotografije ni uspelo.' }, { status: 500 });
  }
}

// PATCH — posodobi meritve / viz-stanje ──────────────────────

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireAccess(req, 'photos', 'PATCH');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const body = (await req.json()) as { measurements?: unknown; vizState?: unknown };
    const measurements = typeof body.measurements === 'string' ? body.measurements.slice(0, 20_000) : undefined;
    const vizState = typeof body.vizState === 'string' ? body.vizState.slice(0, 40_000) : undefined;
    if (measurements === undefined && vizState === undefined) {
      return NextResponse.json({ error: 'Manjkajo meritve ali viz-stanje (JSON niz).' }, { status: 400 });
    }
    // updateMany z obsegom: tuj zapis ostane nedotaknjen in javi 404.
    const upd = await db.photo.updateMany({
      where: { id, ...ownScope(uid) },
      data: {
        ...(measurements !== undefined ? { measurements } : {}),
        ...(vizState !== undefined ? { vizState } : {}),
      },
    });
    if (upd.count === 0) {
      return NextResponse.json({ error: 'Posodabljanje ni uspelo (fotografija ne obstaja).' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Posodabljanje ni uspelo.' }, { status: 404 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireAccess(req, 'photos', 'DELETE');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    // filePath poberemo PRED brisanjem (po brisanju vrstice ne moremo).
    const row = await db.photo.findFirst({
      where: { id, ...ownScope(uid) },
      select: { id: true, filePath: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'Brisanje ni uspelo (fotografija morda že ne obstaja).' }, { status: 404 });
    }
    await db.photo.delete({ where: { id: row.id } });
    if (row.filePath) await deletePhotoFileAsync(row.filePath, resolvePhotoDir());
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Brisanje ni uspelo (fotografija morda že ne obstaja).' }, { status: 404 });
  }
}
