// ─── DELETE /api/photos/[id] — brisanje fotografije ─────────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── PATCH /api/photos/[id] — posodobi meritve ──────────────

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { measurements?: unknown };
    if (typeof body.measurements !== 'string') {
      return NextResponse.json({ error: 'Manjkajo meritve (JSON niz).' }, { status: 400 });
    }
    await db.photo.update({
      where: { id },
      data: { measurements: body.measurements.slice(0, 20_000) },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Posodabljanje ni uspelo.' }, { status: 404 });
  }
}

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
