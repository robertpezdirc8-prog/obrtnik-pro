// ─── POST /api/auth/logout-all (Task 95) ──────────────────────
// »Odjavi vse naprave«: prekliče VSE žive seje prijavljenega
// uporabnika (tablični v delavnici, telefon na terenu, namizni
// računalnik) — piškotki ostanejo na napravah, a njihovi žetoni brez
// žive vrstice niso več veljavni (isti 401 kot pri odjavi).
// Za razliko od /api/auth/logout TUKAJ seja JE obvezna: brez nje ni
// uporabnika, ki bi mu preklical seje → 401, ne { ok: true }.
// Odgovor tudi izteče piškotek te naprave (drugi klijent potrebuje
// prijavo, ta naprava pa že odjavljena).

import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { sessionUser } from '@/lib/auth-guard';
import { revokeAllSessions } from '@/lib/session-store';

export async function POST(req: NextRequest) {
  try {
    const user = await sessionUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
    }
    const revoked = await revokeAllSessions(user.id, Date.now());
    const res = NextResponse.json({ ok: true, revoked });
    res.headers.append('Set-Cookie', clearSessionCookie());
    return res;
  } catch (error) {
    console.error('auth logout-all error', error);
    return NextResponse.json({ error: 'Odjava vseh naprav ni uspela.' }, { status: 500 });
  }
}
