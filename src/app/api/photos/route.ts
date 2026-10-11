// ─── GET/POST /api/photos — galerija zajetih fotografij ─────

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const maxDuration = 60;

const MAX_BASE64 = 7_500_000;

// GET — seznam zadnjih 24 fotografij (najnovejše naprej)
export async function GET() {
  try {
    const photos = await db.photo.findMany({
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    return NextResponse.json({ photos });
  } catch (err) {
    console.error('[photos GET]', err);
    return NextResponse.json({ error: 'Ni mogoče naložiti galerije.' }, { status: 500 });
  }
}

// POST — shrani fotografijo z AI analizo in merjenjem
export async function POST(req: Request) {
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

    const photo = await db.photo.create({
      data: {
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
