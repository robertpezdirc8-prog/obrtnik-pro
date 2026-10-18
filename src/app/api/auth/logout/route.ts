// ─── POST /api/auth/logout (Task 95: preklic žetona) ─────────
// Prej (Task 93) je odjava samo iztekla piškotek na klientu — žeton
// bi ostal veljaven do poteka (7 dni). Zdaj je vsak žeton vezan na
// vrstico v tabeli Session (src/lib/session-store.ts), odjava pa
// vrstico PREKLIČE: podpisan žeton brez žive vrstice je po Tasku 95
// enakovreden neznanemu (isti 401, ista beseda). Piškotek kljub vsemu
// tudi izteče — klient naj ne uganja, strežnik je resnica.
// Odjava je IDEMPOTENTNA: brez/piškotka/neznan žeton → vseeno { ok: true }.

import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, parseCookies, SESSION_COOKIE } from '@/lib/auth';
import { revokeSession } from '@/lib/session-store';

export async function POST(req: NextRequest) {
  const cookies = parseCookies(req.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (token) {
    // Preklic je najboljše prizadevanje: če bi baza padla, piškotek
    // VSEENO izteče (klient je odjavljen; vrstica se počisti v prune).
    try {
      await revokeSession(token, Date.now());
    } catch (error) {
      console.error('auth logout revoke error', error);
    }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}
