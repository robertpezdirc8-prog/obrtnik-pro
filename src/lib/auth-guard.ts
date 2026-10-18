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
import { canAccess, MONTIR_FORBIDDEN_MESSAGE, MONTIR_NO_OBRT_MESSAGE, normalizeRole } from '@/lib/permissions';
import type { Method, Resource } from '@/lib/permissions';

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

// ─── Vloge znotraj obrta (Task 97) ──────────────────────────

/** Čuvaj poslovnih rut: seja + vloga V ENEM prehodu (sessionUser enkrat,
 *  ne dvakrat — vsak klic je en SELECT). Vrne:
 *  · null — naprej (lastnik, montir z dovoljenjem ali zaščita ni uklopljena);
 *  · 401 — brez veljavne seje (ISTA beseda kot requireSession);
 *  · 403 — prijavljen montir brez dovoljenja (besedilo iz matrike)
 *          ali brez članstva v obrtu (MONTIR_NO_OBRT_MESSAGE).
 *  Ko zaščita NI uklopljena (AUTH_ENFORCED≠1): VEDNO null — lokalni
 *  način ostane odprt, kot do zdaj (koda čuva, namestitev odloča).
 *  Matrika dovoljenj je v src/lib/permissions.ts (deny-by-default). */
export async function requireAccess(
  req: Request,
  resource: Resource,
  method: Method,
): Promise<NextResponse | null> {
  if (!isAuthEnforced()) return null;
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
  }
  const role = normalizeRole(user.role);
  if (!canAccess(resource, method, role)) {
    return NextResponse.json({ error: MONTIR_FORBIDDEN_MESSAGE }, { status: 403 });
  }
  // Montir brez članstva (Task 97): zavrnjen ŽE pri branju. Zakaj ne
  // "prazni seznami": obseg je filter, ne čuvaj — brez članstva ni
  // ownerId, legacy vedenje obsega pa ne-filtrira ({}) in bi montir
  // videl TUJE podatke. Varneje je zavreti z jasnimi besedami.
  if (role === 'montir') {
    const m = await db.member.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!m) {
      return NextResponse.json({ error: MONTIR_NO_OBRT_MESSAGE }, { status: 403 });
    }
  }
  return null;
}
