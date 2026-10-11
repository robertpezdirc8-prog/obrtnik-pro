import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';

export async function GET() {
  try {
    await ensureSeeded();
    let settings = await db.settings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      settings = await db.settings.create({ data: { id: 'default' } });
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('settings GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju nastavitev' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const allowed = [
      'companyName', 'ownerName', 'address', 'phone', 'email',
      'taxNumber', 'iban', 'vatRate', 'laborRate', 'quoteValidDays', 'logoUrl',
    ] as const;

    const data: Record<string, string | number | null> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = key === 'vatRate' || key === 'laborRate' || key === 'quoteValidDays'
          ? Number(body[key])
          : body[key];
      }
    }

    const settings = await db.settings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data },
    });
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('settings PUT error', error);
    return NextResponse.json({ error: 'Napaka pri shranjevanju nastavitev' }, { status: 500 });
  }
}
