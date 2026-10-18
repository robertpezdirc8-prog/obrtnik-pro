// ─── GET/POST /api/photos — galerija zajetih fotografij ─────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';

export const maxDuration = 60;

const MAX_BASE64 = 7_500_000;

// GET — seznam zadnjih 24 fotografij (najnovejše naprej)
export async function GET(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const uid = await resolveOwner(req);
    const photos = await db.photo.findMany({
      where: ownScope(uid),
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    return NextResponse.json({ photos });
  } catch (err) {
    console.error('[photos GET]', err);
    return NextResponse.json({ error: 'Ni mogoče naložiti galerije.' }, { status: 500 });
  }
}

// POST — shrani fotografijo s samodejno analizo in merjenjem
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
        dataUrl,
        analysis: typeof body.analysis === 'string' ? body.analysis.slice(0, 100_000) : null,
        measurements: typeof body.measurements === 'string' ? body.measurements.slice(0, 20_000) : null,
      },
    });

    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    console.error('[photos POST]', err);
    return NextResponse.json({ error: 'Shranjevanje fotografije ni uspelo.' }, { status: 500 });
  }
}
