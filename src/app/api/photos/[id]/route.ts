// ─── DELETE /api/photos/[id] — brisanje fotografije ─────────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await db.photo.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Brisanje ni uspelo (fotografija morda že ne obstaja).' }, { status: 404 });
  }
}
