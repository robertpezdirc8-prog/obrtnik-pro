// ─── GET /api/photos/[id]/image (Task 96) ─────────────────────
// SUROVA vsebina s diska (bytes + Content-Type) — za <img src> brez
// base64 razpenjanja v JSON. Vsebina fotke je nespremenljiva (PATCH
// ureja meritve/viz-stanje, ne slike), zato sme odgovor biti
// predpomnjen. Tuj zapis → 404 (obstoj tujega zapisa ni berljiv).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { mimeOfFileName, readPhotoBytes, resolvePhotoDir } from '@/lib/photo-store';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireAccess(req, 'photos', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const row = await db.photo.findFirst({
      where: { id, ...ownScope(uid) },
      select: { filePath: true },
    });
    if (!row?.filePath) {
      return NextResponse.json({ error: 'Fotografija ne obstaja.' }, { status: 404 });
    }
    const bytes = readPhotoBytes(row.filePath, resolvePhotoDir());
    if (!bytes) {
      return NextResponse.json({ error: 'Vsebina fotografije manjka.' }, { status: 404 });
    }
    const mime = mimeOfFileName(row.filePath) ?? 'application/octet-stream';
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch (err) {
    console.error('[photos image GET]', err);
    return NextResponse.json({ error: 'Nalaganje fotografije ni uspelo.' }, { status: 500 });
  }
}
