// ─── POST /api/auth/login ─────────────────────────────────────
// Napaka je VEDNO ista beseda (»E-pošta ali geslo ni pravilna.«) in
// vedno 401: iz odgovora ni mogoče brati, ali račun sploh obstaja.
// Ker je scrypt drag (~50 ms), neobstoječi uporabnik prav tako preveri
// geslo (proti istemu scryptu na izmišljenem zapisu) — sicer bi bila
// obstoječnost računa razbrala iz časa odgovora, ne iz besedila.

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import {
  createSessionToken,
  hashPassword,
  normalizeEmail,
  sessionCookie,
  SESSION_TTL_SEC,
  verifyPassword,
} from '@/lib/auth';
import { AUTH_LOGIN_RATE_RULE, clientKeyFromHeaders, createRateLimiter } from '@/lib/rate-limit';
import { sessionSecret } from '@/lib/auth-guard';
import { openSession, pruneSessions } from '@/lib/session-store';

const limiter = createRateLimiter(AUTH_LOGIN_RATE_RULE);

let dummy: string | null = null;
function dummyHash(): string {
  if (!dummy) dummy = hashPassword('dummy-geslo-neobstojeci-uporabnik-t93');
  return dummy;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(String(body.email ?? ''));
  const password = String(body.password ?? '');

  // Ključ je klient + e-pošta: polno okno enega računa ne blokira
  // prijave drugega z istega naslova (npr. delavniški Wi-Fi).
  const hit = limiter.hit(`${clientKeyFromHeaders(req.headers)}|${email}`, Date.now());
  if (!hit.ok) {
    return NextResponse.json(
      { error: `Preveč poskusov prijave — poskusite znova čez ${hit.retryAfterSec} s.` },
      { status: 429, headers: { 'Retry-After': String(hit.retryAfterSec) } },
    );
  }

  try {
    const user = await db.user.findUnique({ where: { email } });
    const ok = user
      ? verifyPassword(password, user.passwordHash)
      : verifyPassword(password, dummyHash());
    if (!user || !ok) {
      return NextResponse.json({ error: 'E-pošta ali geslo ni pravilna.' }, { status: 401 });
    }

    // Task 95: nonce (16 naključnih bajtov) pomeni, da sta dve prijavi
    // v isti sekundi dva različna žetona — vsak dobi svojo vrstico v
    // bazi in je preklicljiv posamezno. Ob prijavi tudi počistimo
    // iztečene in preklicane seje — tabela ostane majhna brez cron-a.
    const nonce = randomBytes(16).toString('base64url');
    const token = createSessionToken(sessionSecret(), user.id, Date.now(), SESSION_TTL_SEC, nonce);
    const nowMs = Date.now();
    await openSession(user.id, token, new Date(nowMs + SESSION_TTL_SEC * 1000));
    await pruneSessions(nowMs);
    const res = NextResponse.json({
      user: { email: user.email, name: user.name, role: user.role },
    });
    res.headers.append('Set-Cookie', sessionCookie(token));
    return res;
  } catch (error) {
    console.error('auth login error', error);
    return NextResponse.json({ error: 'Prijava ni uspela.' }, { status: 500 });
  }
}
