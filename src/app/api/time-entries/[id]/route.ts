import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';

// ─── PATCH /api/time-entries/[id] — popravki + žig obračuna ──
// billedAt/billedRef beleži STREŽNIK (klient pošlje namen, strežnik
// validira) — zgodovina obračuna se ne izmišljuje. billedAt: ISO
// ali null (razveljavi obračun). Opis/minute/postavka/dan se
// lahko popravijo (napaka pri vnosu), obračunani vnos pa se ne
// spreminja več v vsebini — najprej razveljavi žig.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'time-entries', 'PATCH');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await ctx.params;
    const uid = await resolveOwner(req);
    const existing = await db.timeEntry.findFirst({
      where: { id, ...ownScope(uid) },
      select: { billedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }

    const body = (await req.json()) as {
      description?: unknown;
      minutes?: unknown;
      hourlyRate?: unknown;
      day?: unknown;
      billedAt?: unknown;
      billedRef?: unknown;
    };

    const data: {
      description?: string;
      minutes?: number;
      hourlyRate?: number;
      day?: string;
      billedAt?: Date | null;
      billedRef?: string | null;
    } = {};

    const willUnbill = body.billedAt === null;
    if (!willUnbill && existing.billedAt !== null) {
      // Obračunan vnos se ne ureja vsebinsko (samo undo žiga).
      if (
        body.description !== undefined ||
        body.minutes !== undefined ||
        body.hourlyRate !== undefined ||
        body.day !== undefined
      ) {
        return NextResponse.json(
          { error: 'Obračunan vnos se ne ureja — najprej razveljavi obračun' },
          { status: 400 },
        );
      }
    }

    if (body.description !== undefined) {
      const d = typeof body.description === 'string' ? body.description.trim() : '';
      if (d.length < 1 || d.length > 200) {
        return NextResponse.json({ error: 'Opis mora imeti 1–200 znakov' }, { status: 400 });
      }
      data.description = d;
    }

    if (body.minutes !== undefined) {
      const m = typeof body.minutes === 'number' ? Math.round(body.minutes) : NaN;
      if (!Number.isFinite(m) || m < 1 || m > 24 * 60) {
        return NextResponse.json({ error: 'Minute morajo biti med 1 in 1440' }, { status: 400 });
      }
      data.minutes = m;
    }

    if (body.hourlyRate !== undefined) {
      const r = typeof body.hourlyRate === 'number' ? body.hourlyRate : NaN;
      if (!Number.isFinite(r) || r <= 0 || r > 1000) {
        return NextResponse.json({ error: 'Urna postavka mora biti med 0 in 1000 €/h' }, { status: 400 });
      }
      data.hourlyRate = r;
    }

    if (body.day !== undefined) {
      const day = typeof body.day === 'string' ? body.day : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())) {
        return NextResponse.json({ error: 'Dan mora biti datum v obliki YYYY-MM-DD' }, { status: 400 });
      }
      data.day = day;
    }

    if (body.billedAt !== undefined) {
      if (body.billedAt === null) {
        data.billedAt = null;
        data.billedRef = null;
      } else if (typeof body.billedAt === 'string') {
        const d = new Date(body.billedAt);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Neveljaven datum obračuna' }, { status: 400 });
        }
        data.billedAt = d;
        data.billedRef = typeof body.billedRef === 'string' && body.billedRef.trim() !== ''
          ? body.billedRef.trim().slice(0, 120)
          : 'brez ponudbe';
      } else {
        return NextResponse.json({ error: 'billedAt mora biti ISO datum ali null' }, { status: 400 });
      }
    } else if (body.billedRef !== undefined && typeof body.billedRef === 'string') {
      data.billedRef = body.billedRef.trim() !== '' ? body.billedRef.trim().slice(0, 120) : null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Ni sprememb' }, { status: 400 });
    }

    const updated = await db.timeEntry.updateMany({
      where: { id, ...ownScope(uid) },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    const entry = await db.timeEntry.findUnique({ where: { id } });
    if (!entry) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }

    return NextResponse.json({
      entry: {
        id: entry.id,
        day: entry.day,
        description: entry.description,
        minutes: entry.minutes,
        hourlyRate: entry.hourlyRate,
        customerName: entry.customerName,
        offerId: entry.offerId,
        craftId: entry.craftId,
        billedAt: entry.billedAt ? entry.billedAt.toISOString() : null,
        billedRef: entry.billedRef,
        createdAt: entry.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('PATCH /api/time-entries/[id] failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče posodobiti' }, { status: 500 });
  }
}

// ─── DELETE /api/time-entries/[id] ──────────────────────────

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'time-entries', 'DELETE');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await ctx.params;
    const uid = await resolveOwner(req);
    const del = await db.timeEntry.deleteMany({ where: { id, ...ownScope(uid) } });
    if (del.count === 0) {
      return NextResponse.json({ error: 'Vnos ne obstaja' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/time-entries/[id] failed:', err);
    return NextResponse.json({ error: 'Vnosa ni bilo mogoče izbrisati' }, { status: 500 });
  }
}
