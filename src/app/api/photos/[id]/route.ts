// ─── DELETE /api/photos/[id] — brisanje fotografije ─────────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── PATCH /api/photos/[id] — posodobi meritve / viz-stanje ──

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { measurements?: unknown; vizState?: unknown };
    const measurements = typeof body.measurements === 'string' ? body.measurements.slice(0, 20_000) : undefined;
    const vizState = typeof body.vizState === 'string' ? body.vizState.slice(0, 40_000) : undefined;
    if (measurements === undefined && vizState === undefined) {
      return NextResponse.json({ error: 'Manjkajo meritve ali viz-stanje (JSON niz).' }, { status: 400 });
    }
    await db.photo.update({
      where: { id },
      data: {
        ...(measurements !== undefined ? { measurements } : {}),
        ...(vizState !== undefined ? { vizState } : {}),
      },
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
