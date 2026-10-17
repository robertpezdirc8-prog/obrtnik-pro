import { NextRequest, NextResponse } from 'next/server';
import { loadCenik, saveCenik } from '@/lib/cenik-store';

// ─── Cenik (GET/PUT) ────────────────────────────────────────
// Edini endpoint, ki piše denar. GET vrne SAMO vpisane cene — manjkajoč
// ključ v odgovoru pomeni »cena ni vpisana«, ne »cena je 0 €.«

export async function GET() {
  try {
    const values = await loadCenik();
    return NextResponse.json({ values });
  } catch (error) {
    console.error('cenik GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju cenika' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Cenik vpišeš po ključih izdelkov.' }, { status: 400 });
    }
    const result = await saveCenik(body as Record<string, unknown>);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.refused.map((r) => r.reason).join(' '),
          refused: result.refused,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ values: result.values });
  } catch (error) {
    console.error('cenik PUT error', error);
    return NextResponse.json({ error: 'Napaka pri shranjevanju cenika' }, { status: 500 });
  }
}
