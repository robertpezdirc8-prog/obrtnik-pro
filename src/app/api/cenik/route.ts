import { NextRequest, NextResponse } from 'next/server';
import { loadCenik, saveCenik } from '@/lib/cenik-store';
import { requireAccess } from '@/lib/auth-guard';
import { resolveOwner } from '@/lib/tenancy';

// ─── Cenik (GET/PUT) ────────────────────────────────────────
// Edini endpoint, ki piše denar. GET vrne SAMO vpisane cene — manjkajoč
// ključ v odgovoru pomeni »cena ni vpisana«, ne »cena je 0 €.«

export async function GET(req: Request) {
  const zavrnjen = await requireAccess(req, 'cenik', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    // Cenik je denar obrta (Task 94): prijavljen vidi svoje cene;
    // brez seje legacy vrstice (ownerId = null).
    const uid = await resolveOwner(req);
    const values = await loadCenik(uid);
    return NextResponse.json({ values });
  } catch (error) {
    console.error('cenik GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju cenika' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const zavrnjen = await requireAccess(req, 'cenik', 'PUT');
  if (zavrnjen) return zavrnjen;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Cenik vpišeš po ključih izdelkov.' }, { status: 400 });
    }
    const uid = await resolveOwner(req);
    const result = await saveCenik(body as Record<string, unknown>, uid);
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
