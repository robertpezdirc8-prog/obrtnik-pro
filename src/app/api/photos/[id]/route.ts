// ─── DELETE /api/photos/[id] — brisanje fotografije ─────────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';

// ─── PATCH /api/photos/[id] — posodobi meritve / viz-stanje ──

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const zavrnjen = await requireSession(req);
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
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const del = await db.photo.deleteMany({ where: { id, ...ownScope(uid) } });
    if (del.count === 0) {
      return NextResponse.json({ error: 'Brisanje ni uspelo (fotografija morda že ne obstaja).' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Brisanje ni uspelo (fotografija morda že ne obstaja).' }, { status: 404 });
  }
}
