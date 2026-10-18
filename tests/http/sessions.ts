/**
 * HTTP tek Task 95 — seje v bazi na LOČENI bazi, port 3001,
 * AUTH_ENFORCED=1, STALNA AUTH_SECRET (test jo podtakne, da zna
 * kovati žetone). Meri pravi HTTP odgovore, ne kodnih poti.
 *
 * Scenarij:
 *  1. Sveža baza: session pokaže usersExist=false
 *  2. Registracija lastnika → seja A → /api/offers 200
 *  3. ODJAVA → isti piškotek ponovljen → 401 (PREKLIČEN žeton — jedro
 *     Taska 95; prej bi ostal veljaven do poteka)
 *  4. Prijava → seja B deluje; druga prijava → seja C deluje (dve napravi)
 *  5. logout-all → obe seji mrtvi (odgovori povedata, koliko je preklicanih)
 *  6. Kovan žeton s PRAVIM podpisom BREZ vrstice v bazi → 401
 *     (strogost: brez žive vrstice ni seje — stari 3-delni žetoni so mrtev)
 *  7. Prune: preklicane vrstice izginejo ob naslednji prijavi
 *  8. tokenHash v bazi je 64-mestni hex, NIKOLI surov žeton
 *
 * Zagon (strežnik mora teči na 3001 z isto bazo, AUTH_ENFORCED=1):
 *  DATABASE_URL=file:/tmp/sessions-test.db AUTH_SECRET=... bun tests/http/sessions.ts
 */

import { PrismaClient } from '@prisma/client';
import { createSessionToken } from '../../src/lib/auth';

const db = new PrismaClient();
const BASE = 'http://localhost:3001';
const SK = process.env.AUTH_SECRET ?? 'test-skrivnost-zadolgo-vsaj-32-znakov!!';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const cookieOf = (res: Response): string => {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
};
const tokenOf = (cookie: string): string => cookie.replace('obrtnik_sessija=', '');
const json = async (res: Response) => { try { return await res.json(); } catch { return {}; } };

const GET = (path: string, cookie?: string) =>
  fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });

// ── 1. Sveža baza ────────────────────────────────────────────
{
  const res = await GET('/api/auth/session');
  const body = await json(res);
  check('session: zaščita uklopljena', body.enforced === true);
  check('session: uporabnikov še ni', body.usersExist === false);
}

// ── 2. Registracija → seja A ─────────────────────────────────
let cookieA = '';
{
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lastnik@obrt.si', name: 'Lastnik', password: 'geslo-12345' }),
  });
  check('register → 201', res.status === 201, String(res.status));
  cookieA = cookieOf(res);
  check('register vrne piškotek', cookieA.startsWith('obrtnik_sessija='));
  const offers = await GET('/api/offers', cookieA);
  check('ponudbe s sejo A → 200', offers.status === 200, String(offers.status));
  const sess = await json(await GET('/api/auth/session', cookieA));
  check('session pokaže prijavljenega', sess.authenticated === true && sess.user?.email === 'lastnik@obrt.si');
}

// ── 3. ODJAVA → preklic žetona (JEDRO Taska 95) ──────────────
{
  const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieA } });
  check('logout → 200 + { ok }', res.status === 200, String(res.status));
  // ISTI piškotek, ISTA naprava, še vedno v roku 7 dni:
  const replay = await GET('/api/offers', cookieA);
  check('ISTI žeton po odjavi → 401 (preklican na strežniku)', replay.status === 401, String(replay.status));
  const err = await json(replay);
  check('401 je ISTA beseda kot pri neznanem žetonu', err.error === 'Zahtevana je prijava.');
  const sess = await json(await GET('/api/auth/session', cookieA));
  check('session pokaže ODJAVLJENEGA', sess.authenticated === false);
  // Idempotentnost: druga odjava z istim žetonom ni napaka.
  const again = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieA } });
  check('druga odjava z istim žetonom → vseeno 200', again.status === 200);
  // Odjava brez piškotka je vseeno uspešna (idempotentna ruta).
  const bare = await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
  check('odjava brez piškotka → 200', bare.status === 200);
}

// ── 4. Prijava na dveh napravah ──────────────────────────────
let cookieB = '', cookieC = '';
{
  const login = async (): Promise<string> => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lastnik@obrt.si', password: 'geslo-12345' }),
    });
    check(`prijava → 200 (${res.status})`, res.status === 200, String(res.status));
    return cookieOf(res);
  };
  cookieB = await login();
  cookieC = await login();
  check('naprava B deluje', (await GET('/api/offers', cookieB)).status === 200);
  check('naprava C deluje', (await GET('/api/offers', cookieC)).status === 200);
  check('žetona B in C sta RAZLIČNA (nonce)', tokenOf(cookieB) !== tokenOf(cookieC));
}

// ── 5. Odjavi vse naprave ────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/auth/logout-all`, {
    method: 'POST', headers: { cookie: cookieC },
  });
  const body = await json(res);
  check('logout-all → 200', res.status === 200, String(res.status));
  check('logout-all pove, koliko je preklicanih (≥ 2)', typeof body.revoked === 'number' && body.revoked >= 2, JSON.stringify(body));
  check('naprava B je po logout-all MRTVA', (await GET('/api/offers', cookieB)).status === 401);
  check('naprava C je po logout-all MRTVA', (await GET('/api/offers', cookieC)).status === 401);
  // Brez seje logout-all zavrne (ni komu preklicati).
  const anon = await fetch(`${BASE}/api/auth/logout-all`, { method: 'POST' });
  check('logout-all brez seje → 401', anon.status === 401, String(anon.status));
}

// ── 6. Kovan žeton z PRAVIM podpisom, BREZ vrstice ───────────
{
  const userId = (await db.user.findFirst())?.id ?? '';
  const forged = createSessionToken(SK, userId, Date.now(), 60 * 60, 'kovan-brez-vrstice');
  const forgedCookie = `obrtnik_sessija=${forged}`;
  check('kovan žeton ima pravilen 4-delni format', forged.split('.').length === 4);
  check('kovan žeton brez vrstice → 401 na /api/offers', (await GET('/api/offers', forgedCookie)).status === 401);
  const sess = await json(await GET('/api/auth/session', forgedCookie));
  check('session ga zavrne (authenticated=false)', sess.authenticated === false);
}

// ── 7. Prune: preklicane vrstice izginejo ob prijavi ─────────
{
  // (Seja A je bila preklicana ZGODAJ; prijava B jo je že POČISTILA —
  //  to je delujoč prune, izmerjen posredno: ostalo je 2 preklicanih,
  //  toliko kot živih sej pred logout-all.)
  const beforeRevoked = await db.session.count({ where: { revokedAt: { not: null } } });
  check('po logout-all ostanejo preklicane vrstice (A je prune že pobral)', beforeRevoked >= 2, String(beforeRevoked));
  const beforeLive = await db.session.count({ where: { revokedAt: null } });
  check('po logout-all ni več ŽIVIH sej', beforeLive === 0, String(beforeLive));
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lastnik@obrt.si', password: 'geslo-12345' }),
  });
  check('nova prijava → 200', res.status === 200, String(res.status));
  const afterRevoked = await db.session.count({ where: { revokedAt: { not: null } } });
  check('prune: preklicane vrstice so IZGINILE ob prijavi', afterRevoked === 0, String(afterRevoked));
  const fresh = cookieOf(res);
  check('sveža seja deluje', (await GET('/api/offers', fresh)).status === 200);
  const live = await db.session.count();
  check('v bazi je točno ENA živa seja', live === 1, String(live));
}

// ── 8. V bazi je SAMO hash, nikoli surov žeton ───────────────
{
  const rows = await db.session.findMany();
  const hexOnly = rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash));
  check(`vseh ${rows.length} vrstic nosi 64-mestni hex hash`, hexOnly && rows.length > 0);
  check('nobena vrstica ne vsebuje pike (format žetona)', rows.every((r) => !r.tokenHash.includes('.')));
}

console.log('seje (HTTP):');
if (fail > 0) {
  console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
  process.exit(1);
} else {
  console.log(`REZULTAT: ${pass} OK, 0 NAPAK`);
}
await db.$disconnect();
