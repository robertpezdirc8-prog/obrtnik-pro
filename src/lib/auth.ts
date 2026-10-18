// ─── Avtentikacija: čisto jedro (brez Next.js, brez baze) ─────
// ZAKAJ ročno in ne next-auth: aplikacija je eno-mašinska (SQLite)
// in rabi natanko en primerek — prijavo z e-pošto in geslom ter
// HttpOnly piškotek s podpisano sejo. next-auth v4 leži v
// odvisnostih, a je bil do Taska 93 neuporabljen in na App Routerju
// Next 16 prinaša integracijsko tveganje brez koristi. ~150 vrstic,
// ki jih je moč prebrati in preveriti (tests/verify/auth.ts), so
// manjše tveganje kot okvir, ki ga nihče ni preveril na tej
// različici Nexta. (issue #2 ostaja odprt za več-uporabniško
// obseganje podatkov — to je prijava, ne pravice.)
//
// NAČELA (ista kot povsod v projektu):
//  - čiste funkcije z injektirano uro → deterministične preverbe,
//    brez spanja, brez strežnika;
//  - slaben vhod NIKOLI ne meta izjeme — napaka je `null`/`false`
//    z razlogom, `verifyPassword` na pokvarjenem zapisu vrne false;
//  - nenevarne privzete vrednosti so GLASNE: brez AUTH_SECRET se
//    seje ne preživijo ponovnega zagona in auth-guard to opozori.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Ime sejnega piškotka. */
export const SESSION_COOKIE = 'obrtnik_sessija';

/** Trajanje seje v sekundah: 7 dni. Monter se ne prijavlja vsako jutro. */
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

// scrypt parametri: N=2^14, r=8, p=1, dolžina ključa 32 B —
// zmerno za eno-mašinski stroj (~50 ms na geslo), izrecno zapisano,
// ker jih ni mogoče kasneje spremeniti brez selitve zapisov.
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;
const SCRYPT_PREFIX = 'scrypt';

const toB64u = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const fromB64u = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

// ─── E-pošta in geslo: pravila vhoda ─────────────────────────

/** Normalizacija: presledki in velike črke ne ustvarjajo dvojnikov računov. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Razlog, zakaj e-pošta ni uporabna, ali null, če je. */
export function emailProblem(raw: string): string | null {
  const email = raw.trim();
  if (!email) return 'E-pošta ni vpisana.';
  if (email.length > 200) return 'E-pošta je predolga (največ 200 znakov).';
  if (!EMAIL_RE.test(email)) return 'E-pošta ni veljavna (pričakovano ime@domena.si).';
  return null;
}

/** Razlog, zakaj geslo ni uporabno, ali null, če je. Spodnja meja 8,
 *  zgornja 200 (scrypt ne sme postati orodje za zaviranje strežnika). */
export function passwordProblem(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length < 8) return 'Geslo mora imeti vsaj 8 znakov.';
  if (raw.length > 200) return 'Geslo je predolgo (največ 200 znakov).';
  return null;
}

// ─── Gesla: scrypt + naključna sol ───────────────────────────

/** Vrne "scrypt$saltB64$hashB64". Dva klica za isto geslo dva različna
 *  zapisa (sol je vedno nova) — prav, ker primerjamo z verifyPassword. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `${SCRYPT_PREFIX}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Konstantni čas primerjave, nikoli ne meta: pokvarjen/neznan zapis
 *  je preprosto napačno geslo, ne napaka strežnika. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  if (salt.length === 0 || expected.length !== SCRYPT.keyLen) return false;
  const actual = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(actual, expected);
}

// ─── Sejni žeton: payload + nonce + HMAC-SHA256 ──────────────
// Format (Task 95): `b64u(userId).expUnix.b64u(nonce).b64u(hmac)`.
// Nonce (16 naključnih bajtov) je INJEKTIRAN klicatelju — zato dve
// prijavi v isti sekundi NE oddata istega žetona in vsak žeton dobi
// svojo vrstico v bazi (Session.tokenHash). Brez knjižnic, brez
// šifriranja (vsebina ni občutljiva), samo nepodtavržen podpis.
// Ura je INJEKTIRANA (`nowMs`), potek je preverljiv brez čakanja.
// Sprememba formata (3 → 4 deli) pomeni, da žetoni iz različice
// pred Taskom 95 niso več berljivi — uporabnik se enkrat prijavi
// znova; to je zavestna, zapisana posledica preklicljivih sej.

export function createSessionToken(
  secret: string,
  userId: string,
  nowMs: number,
  ttlSec: number = SESSION_TTL_SEC,
  nonce: string = '',
): string {
  const payload = `${toB64u(userId)}.${Math.floor(nowMs / 1000) + ttlSec}.${toB64u(nonce)}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  secret: string,
  token: string,
  nowMs: number,
): { userId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userIdB64, expStr, nonceB64, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${userIdB64}.${expStr}.${nonceB64}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  // timingSafeEqual rabi enaki dolžini (sicer meta); različna dolžina
  // je vseeno pokvarjen žeton, torej isti izid: null.
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  const exp = Number(expStr);
  // Meja je ZAJEDLJIVA: točno ob exp*1000 je žeton že potekel.
  if (!Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  const userId = fromB64u(userIdB64);
  if (!userId) return null;
  // Nonce je nujen: brez njega bi dve prijavi v isti sekundi delili
  // isti žeton (in isti tokenHash v bazi) — preklic enega bi preklical
  // oba. Prazen nonce je torej pokvarjen žeton, ne dopustna oblika.
  const nonce = fromB64u(nonceB64);
  if (!nonce) return null;
  return { userId };
}

/** Potek žetona kot milisekunda (exp Unix sekund × 1000) ali null,
 *  če žetona ni mogoče prebrati — Session zapis ga shrani ob odprtju. */
export function tokenExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const exp = Number(parts[1]);
  return Number.isInteger(exp) && exp > 0 ? exp * 1000 : null;
}

// ─── Seje v bazi (Task 95): čista plast ──────────────────────
// V bazi shranjujemo SAMO SHA-256 žetona (hex), nikoli surovega —
// uhaj baze ne razkrije uporabnih žetonov. Žeton je veljaven, kadar
// je podpis ustrezen (auth-guard) IN obstaja živa vrstica: ni
// preklicana in še ni potekla.

/** SHA-256 celotnega žetona kot 64-mestni hex — ključ v tabeli Session. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Najmanjša oblika vrstice, ki jo čista logika potrebuje (baza ali preverba jo poda). */
export interface SessionRowLike {
  tokenHash: string;
  expiresAt: Date | { getTime(): number };
  revokedAt: Date | { getTime(): number } | null;
}

/** Je vrstica seje ŽIVA? Čista funkcija — preverljiva brez baze.
 *  Meja poteka je zajedljiva (isto pravilo kot pri žetonu). */
export function isLiveSessionRow(
  row: SessionRowLike | null | undefined,
  token: string,
  nowMs: number,
): boolean {
  if (!row) return false;
  if (row.tokenHash !== hashToken(token)) return false;
  if (row.revokedAt !== null && row.revokedAt !== undefined) return false;
  return row.expiresAt.getTime() > nowMs;
}

// ─── Piškotki ────────────────────────────────────────────────

/** Razčleni glavo `Cookie` na slovar. Vrednost sme vsebovati `=` —
 *  režemo na PRVEM enačaju. Pokvarjeni deli so tiho izpuščeni. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const raw of header.split(';')) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const name = raw.slice(0, eq).trim();
    if (!name) continue;
    out[name] = raw.slice(eq + 1).trim();
  }
  return out;
}

/** Set-Cookie za prijavo. `Secure` namenoma NI nastavljen: aplikacija
 *  teče tudi čez http na lokalnem omrežju (adb reverse / LAN), kjer
 *  bi ga brskalnik ignoriral in prijava ne bi delovala. Ob pravem
 *  gostovanju (https) se doda — zapisano v issue #2, ne skrito. */
export function sessionCookie(token: string, maxAgeSec: number = SESSION_TTL_SEC): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

/** Set-Cookie za odjavo: piškotek takoj izteče. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ─── Skrivnost ───────────────────────────────────────────────

export interface AuthSecret {
  secret: string;
  /** true = AUTH_SECRET ni bil nastavljen; skrivnost je naključna in
   *  živi samo do konca procesa. Glasno opozorjeno v auth-guard. */
  ephemeral: boolean;
}

/** Veljavna skrivnost ima vsaj 32 znakov (sami presledki ne štejejo).
 *  `rnd` je injektiran, da je preverba deterministična. */
export function resolveAuthSecret(
  envValue: string | undefined,
  rnd: (bytes: number) => Buffer = (n) => randomBytes(n),
): AuthSecret {
  const v = (envValue ?? '').trim();
  if (v.length >= 32) return { secret: v, ephemeral: false };
  return { secret: rnd(32).toString('base64url'), ephemeral: true };
}
