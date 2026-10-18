/**
 * Preverja seje v bazi (Task 95 — src/lib/session-store.ts + model
 * Session) kot ČISTE funkcije + STATIČNO pokritost vseh stikov:
 * prijava odpre, čuvaj preveri živost, odjava prekliče, »Odjavi vse
 * naprave« prekliče vse, prijava tudi počisti iztečene.
 *
 * Pokrito:
 *  - hashToken: determinizem, 64-mestni hex, razlika po žetonih,
 *    ni primerljiv z žetonom (surovi žeton NE gre v bazo)
 *  - isLiveSessionRow: null vrstica, napačen hash (žeton brez vrstice),
 *    preklicana (revokedAt), iztekla (zajedljiva meja), živa
 *  - STATIČNO shema: model Session, tokenHash @unique, revokedAt,
 *    onDelete Cascade (izbris uporabnika počisti seje)
 *  - STATIČNO session-store: open (create), isSessionLive (findUnique),
 *    revoke (updateMany), revokeAll (userId + revokedAt null),
 *    prune (deleteMany izteklih IN preklicanih)
 *  - STATIČNO auth-guard: requireSession IN sessionUser preverjata
 *    živost (isSessionLive) — podpis sam ni dovolj
 *  - STATIČNO rute: login (openSession + pruneSessions + nonce iz
 *    randomBytes), register (openSession), logout (revokeSession +
 *    idempotentnost), logout-all (sessionUser → 401 brez seje)
 *  - STATIČNO UI: lebdeči gumb je IZGINIL, kontekst je ponujen
 *    (useSessionGate + Provider), AppShell ga porabi in nosi
 *    »Odjavi vse naprave«
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 *
 * Zagon: bun tests/verify/sessions.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionToken, hashToken, isLiveSessionRow, SESSION_TTL_SEC, tokenExpiryMs } from '../../src/lib/auth';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

// ── 1. hashToken — ključ vrstice v bazi ──────────────────────
{
  const SK = 'skrivnost-zadolgo-vsaj-32-znakov!!';
  const t1 = createSessionToken(SK, 'u1', 1_000, SESSION_TTL_SEC, 'nonce-a');
  const t2 = createSessionToken(SK, 'u1', 1_000, SESSION_TTL_SEC, 'nonce-b');
  check('hashToken je determinističen', hashToken(t1) === hashToken(t1));
  check('hash ima 64 znakov (SHA-256 hex)', /^[0-9a-f]{64}$/.test(hashToken(t1)));
  check('drugi žeton → drug hash', hashToken(t1) !== hashToken(t2));
  check('hash NI žeton (surov ne gre v bazo)', !hashToken(t1).includes('.'));
  check('hash praznega žetona je vseeno določen', /^[0-9a-f]{64}$/.test(hashToken('')));
}

// ── 2. isLiveSessionRow — čista logika živosti ───────────────
{
  const SK = 'skrivnost-zadolgo-vsaj-32-znakov!!';
  const tok = createSessionToken(SK, 'u1', 1_000, SESSION_TTL_SEC, 'n1');
  const h = hashToken(tok);
  const now = 50_000;
  const exp = 1_000 + SESSION_TTL_SEC * 1000; // iz žetona

  check('null vrstica NI živa (žeton brez zapisa)', isLiveSessionRow(null, tok, now) === false);
  check('vrstica za DRUG žeton NI živa (hash se ne ujema)',
    isLiveSessionRow({ tokenHash: hashToken('drugi'), expiresAt: new Date(exp), revokedAt: null }, tok, now) === false);
  check('živa vrstica (ni preklicana, ni potekla) JE živa',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(exp), revokedAt: null }, tok, now) === true);
  check('preklicana vrstica NI živa',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(exp), revokedAt: new Date(10) }, tok, now) === false);
  check('iztekla vrstica NI živa',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(now - 1), revokedAt: null }, tok, now) === false);
  check('meja poteka je ZAJEDLJIVA (točno ob izteku NI živa)',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(now), revokedAt: null }, tok, now) === false);
  check('milisekundo pred iztekom JE še živa',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(now + 1), revokedAt: null }, tok, now) === true);
  check('preklicana tudi s potečenim iztekom ostaje NEživa',
    isLiveSessionRow({ tokenHash: h, expiresAt: new Date(exp), revokedAt: new Date(exp + 5) }, tok, exp + 10) === false);
  check('tokenExpiryMs je vir poteka za zapis', tokenExpiryMs(tok) === exp);
}

// ── 3. STATIČNO: shema (prisma/schema.prisma) ────────────────
{
  const schema = SRC('prisma/schema.prisma');
  const m = schema.indexOf('model Session {');
  const end = m >= 0 ? schema.indexOf('}', m) : -1;
  check('shema ima model Session', m >= 0);
  if (m >= 0 && end > m) {
    const body = schema.slice(m, end);
    check('Session.tokenHash je @unique (en žeton = ena vrstica)', body.includes('tokenHash String    @unique'));
    check('Session ima revokedAt (preklic)', body.includes('revokedAt'));
    check('Session ima expiresAt (potek)', body.includes('expiresAt'));
    check('Session ima indeks po userId', body.includes('@@index([userId])'));
  }
  check('User → Session je onDelete Cascade (izbris uporabnika počisti seje)',
    /model User \{[\s\S]*?sessions\s+Session\[\][\s\S]*?\}/.test(schema) &&
    /onDelete:\s*Cascade/.test(schema.slice(schema.indexOf('model Session {'), schema.indexOf('@@index([userId])'))));
  check('surov žeton ni shranjevan (komentar zavezuje)', /NIKOLI ne shranjujemo|NIKOLI ne shranjujemo/.test(schema.slice(m >= 0 ? m - 600 : 0, m >= 0 ? m : 0) + schema.slice(m >= 0 ? m : 0)));
}

// ── 4. STATIČNO: session-store.ts ────────────────────────────
{
  const store = SRC('src/lib/session-store.ts');
  check('openSession ustvarja vrstico (db.session.create)', store.includes('db.session.create'));
  check('openSession rešuje P2002 (podvojeni klic ne ruši prijave)', store.includes("code === 'P2002'"));
  check('isSessionLive bere po tokenHash (findUnique)', store.includes('db.session.findUnique') && store.includes('hashToken(token)'));
  check('revokeSession je updateMany po hashu', store.includes('db.session.updateMany') && store.includes('tokenHash: hashToken(token)'));
  check('revokeAllSessions je updateMany po userId (samo žive)', store.includes('where: { userId, revokedAt: null }'));
  check('pruneSessions briše iztekle IN preklicane', store.includes('deleteMany') && store.includes('revokedAt: { not: null }'));
  check('živost gre skozi čisto logiko (isLiveSessionRow)', store.includes('isLiveSessionRow'));
}

// ── 5. STATIČNO: auth-guard (čuvaj + sessionUser) ────────────
{
  const guard = SRC('src/lib/auth-guard.ts');
  check('requireSession preverja živost seje', /requireSession[\s\S]*?isSessionLive/.test(guard));
  check('sessionUser preverja živost seje', /sessionUser\(req[\s\S]*?isSessionLive/.test(guard));
  check('401 je ISTA beseda pri neznanem in odjavljenem žetonu', guard.includes('Zahtevana je prijava.'));
  check('guard še vedno hodi čez verifySessionToken (podpis pred bazo)', guard.indexOf('verifySessionToken') < guard.indexOf('isSessionLive'));
}

// ── 6. STATIČNO: rute (login, register, logout, logout-all) ──
{
  const login = SRC('src/app/api/auth/login/route.ts');
  check('login odpre sejo v bazi', login.includes('openSession'));
  check('login pri prijavi počisti iztekle/preklicane (prune)', login.includes('pruneSessions'));
  check('login uporabi nonce iz randomBytes', login.includes('randomBytes(16)'));
  check('login odgovor ostaja { user } + Set-Cookie', login.includes('user: { email: user.email, name: user.name, role: user.role }'));

  const register = SRC('src/app/api/auth/register/route.ts');
  check('register odpre sejo v bazi (registracija je prijava)', register.includes('openSession'));

  const logout = SRC('src/app/api/auth/logout/route.ts');
  check('logout prekliče žeton (revokeSession)', logout.includes('revokeSession'));
  check('logout ostane idempotenten ({ ok: true })', logout.includes('ok: true'));
  check('logout preživi padec baze (preklic je najboljše prizadevanje)', logout.includes('catch'));

  const logoutAll = SRC('src/app/api/auth/logout-all/route.ts');
  check('logout-all obstaja in prekliče VSE seje', logoutAll.includes('revokeAllSessions'));
  check('logout-all zahteva prijavo (sessionUser → 401)', logoutAll.includes('sessionUser') && logoutAll.includes('401'));
  check('logout-all tudi izteče piškotek te naprave', logoutAll.includes('clearSessionCookie'));
}

// ── 7. STATIČNO: UI (LoginGate kontekst + AppShell meni) ─────
{
  const gate = SRC('src/components/auth/login-gate.tsx');
  check('lebdeči gumb iz Taret 93 je IZGINIL', !gate.includes('fixed bottom-2'));
  check('LoginGate ponuja kontekst seje', gate.includes('SessionGateContext.Provider') && gate.includes('export function useSessionGate'));
  check('kontekst nosi oba sklepa (odjava + odjaviVse)', gate.includes('odjava') && gate.includes('odjaviVse'));

  const shell = SRC('src/components/app-shell.tsx');
  check('AppShell porabi kontekst (useSessionGate)', shell.includes('useSessionGate()'));
  check('AppShell nosi »Odjavi vse naprave«', shell.includes('Odjavi vse naprave'));
  check('meni je v glavi (DropdownMenu), ne lebdeč', shell.includes('DropdownMenu'));
  check('privzeti način ne izriše menija (sessionGate && )', shell.includes('{sessionGate && ('));
}

console.log('seje:');
if (fail > 0) {
  console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
  process.exit(1);
} else {
  console.log(`REZULTAT: ${pass} OK, 0 NAPAK`);
}
