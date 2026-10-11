import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';

export async function GET() {
  try {
    await ensureSeeded();
    const categories = await db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { active: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('catalog GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju kataloga' }, { status: 500 });
  }
}
