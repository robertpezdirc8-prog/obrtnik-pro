// ─── /api/team/[id] — odstrani člana ekipe (Task 97) ──────────
// Izbris članstva = takojšnja izguba obsega: montirjev naslednji
// klic reši resolveOwner → brez Member vrstice → null → PRAZNI
// seznami in 403 na pisanje. Račun montirja NE izgine (ostane za
// ponovno vključitev po e-pošti); njegovi vnosi (ure, dnevnik,
// fotke) ostanejo v obrtu — zgodovina je dokaz, ne kazen.
// Samo lastnik (403 za montirja, 401 brez seje — ALWAYS, kot GET/POST).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionUser } from '@/lib/auth-guard';
import { normalizeRole, MONTIR_FORBIDDEN_MESSAGE } from '@/lib/permissions';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
  }
  if (normalizeRole(user.role) !== 'owner') {
    return NextResponse.json({ error: MONTIR_FORBIDDEN_MESSAGE }, { status: 403 });
  }
  try {
    const { id } = await params;
    // deleteMany z obsegom: tuj ali neobstoječ član je enak odgovor
    // (404) — iz odgovora ni razbrati, čigav član je bil id.
    const n = await db.member.deleteMany({ where: { id, ownerId: user.id } });
    if (n.count === 0) {
      return NextResponse.json({ error: 'Člana ni bilo mogoče najti.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/team/[id] failed:', error);
    return NextResponse.json({ error: 'Člana ni bilo mogoče odstraniti.' }, { status: 500 });
  }
}
