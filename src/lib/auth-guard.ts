// ─── Strežniški čuvaj sej (Next.js plast nad src/lib/auth.ts) ──
// STIKALO AUTH_ENFORCED: zaščita se uklopi SAMO z AUTH_ENFORCED=1.
// ZAKAJ stikalo in ne takoj prisilna prijava: 56 verify skript in
// E2E preverbe kličejo API neposredno brez seje; prisilna prijava bi
// jih vse utišala z 401. Uveljavljanje je torej odločitev NAMESTITVE
// (env), ne kode — koda čuva, namestitev odloča. Privzeto OFF:
// lokalni razvoj, E2E in tablica brez .env sprememb ostanejo kot so.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseCookies, resolveAuthSecret, SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { isSessionLive } from '@/lib/session-store';

export function isAuthEnforced(): boolean {
  return process.env.AUTH_ENFORCED === '1';
}

// Skrivnost se razreši ENKRAT na proces (env se med zagonom ne menja)
// in je zapisana tudi v register/login rutah prek sessionSecret().
let cachedSecret: ReturnType<typeof resolveAuthSecret> | null = null;
let warnedEphemeral = false;

function resolveOnce(): ReturnType<typeof resolveAuthSecret> {
  if (!cachedSecret) cachedSecret = resolveAuthSecret(process.env.AUTH_SECRET);
  return cachedSecret;
}

/** Skrivnost za podpis žetonov — enoten vir za guard in auth rute. */
export function sessionSecret(): string {
  const resolved = resolveOnce();
  if (resolved.ephemeral && !warnedEphemeral) {
    warnedEphemeral = true;
    console.warn(
      '[auth] AUTH_SECRET ni nastavljen — seje ne bodo preživele ponovnega zagona. ' +
        'Ustvari ga z: bun -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return resolved.secret;
}

function tokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req.headers.get('cookie'));
  return cookies[SESSION_COOKIE] ?? null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** null = dovoljeno naprej; NextResponse (401) = klient mora ustaviti.
 *  Ko zaščita ni uklopljena, je odgovor VEDNO null — nič se ne spremeni.
 *  Task 95: poleg podpisa se preveri tudi ŽIVOST seje (tabela Session,
 *  src/lib/session-store.ts) — odjava prekliče žeton tudi na strežniku. */
export async function requireSession(req: Request): Promise<NextResponse | null> {
  if (!isAuthEnforced()) return null;
  const token = tokenFromRequest(req);
  const session = token ? verifySessionToken(sessionSecret(), token, Date.now()) : null;
  if (!token || !session) {
    return NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
  }
  // Podpisan žeton brez žive vrstice = odjavljen/stari žeton: isti 401
  // in ISTA beseda kot pri neznanem žetonu (iz odgovora ni razbrati
  // razlike — isto pravilo kot pri prijavi).
  if (!(await isSessionLive(token, Date.now()))) {
    return NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
  }
  return null;
}

/** Uporabnik iz sejnega piškotka ali null. Za /api/auth/session in za
 *  zvoke lastnika (multi-tenant obseganje, issue #2).
 *  Ne glede na AUTH_ENFORCED: veljaven piškotek je veljaven seans —
 *  Task 95: TUDI živa vrstica v Session (stare 3-delne žetone po
 *  selitvi vrne kot odjavljene; uporabnik se enkrat prijavi znova). */
export async function sessionUser(req: Request): Promise<SessionUser | null> {
  const token = tokenFromRequest(req);
  const session = token ? verifySessionToken(sessionSecret(), token, Date.now()) : null;
  if (!token || !session) return null;
  if (!(await isSessionLive(token, Date.now()))) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true },
  });
  return user ?? null;
}
