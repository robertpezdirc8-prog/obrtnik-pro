/**
 * Preverja čisto jedro avtentikacije (src/lib/auth.ts) kot čiste funkcije
 * z INJEKTIRANO uro — brez strežnika, brez baze, brez spanja.
 *
 * Pokrito:
 *  - gesla: scrypt zapis, pretvorba naprej/nazaj, nova sol ob vsakem
 *    klicu, pokvarjeni zapisi NIKOLI ne metejo (vedno false)
 *  - pravila vhoda: dolžina gesla (8–200), format e-pošte, normalizacija
 *  - sejni žeton: ŠTIRI deli (userId.exp.nonce.sig, Task 95), determinizem
 *    z istim nonce-om, drugi nonce → drug žeton, napačna skrivnost,
 *    pokvarjen podpis in payload, PRAZEN in podtakanen nonce zavrnjen,
 *    potek z injektirano uro, ZAJEDLJIVA meja poteka (točno ob exp*1000
 *    je že potekel), slabi formati (tudi stari 3-delni žeton),
 *    prazen userId, tokenExpiryMs
 *  - piškotki: razčlenjevanje glave Cookie (vrednost sme vsebovati `=`),
 *    gradnja Set-Cookie (HttpOnly, SameSite=Lax, Path=/, Max-Age=7 dni),
 *    iztek piškotka (Max-Age=0)
 *  - skrivnost: resolveAuthSecret — stalna vsaj 32 znakov, obrezana,
 *    manjkajoča/kratka → začasna (ephemeral), determinizem z injektiranim rnd
 *  - pravilo prijave: AUTH_LOGIN_RATE_RULE 10/min, 11. zavrnjen,
 *    druga e-pošta na istem naslovu ni blokirana
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 */

import {
  clearSessionCookie,
  createSessionToken,
  emailProblem,
  hashPassword,
  normalizeEmail,
  parseCookies,
  passwordProblem,
  resolveAuthSecret,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  sessionCookie,
  tokenExpiryMs,
  verifyPassword,
  verifySessionToken,
} from '../../src/lib/auth';
import { AUTH_LOGIN_RATE_RULE, createRateLimiter } from '../../src/lib/rate-limit';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, info?: string): void {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    console.log('  \u2717 ' + name + (info ? ' — ' + info : ''));
  }
}

// ── 1. Gesla (scrypt) ────────────────────────────────────────
{
  const stored = hashPassword('pravo-geslo-123');
  check('zapis ima tri dele scrypt$salt$hash', stored.startsWith('scrypt$') && stored.split('$').length === 3);
  check('pravo geslo je prepoznano', verifyPassword('pravo-geslo-123', stored) === true);
  check('napačno geslo je zavrnjeno', verifyPassword('napacno-geslo', stored) === false);
  const drugi = hashPassword('pravo-geslo-123');
  check('dva zapisa istega gesla sta različna (sol)', drugi !== stored);
  check('drugi zapis je prav tako veljaven', verifyPassword('pravo-geslo-123', drugi) === true);
  // Pokvarjeni zapisi: nikoli izjema, vedno false — napaka zapisa je
  // »napačno geslo«, ne 500.
  let vsePoko = true;
  const slabi = ['', 'scrypt', 'md5$aa$bb', 'scrypt$', 'scrypt$!!!$!!!', 'scrypt$YQ$!!!'];
  try {
    for (const s of slabi) {
      if (verifyPassword('pravo-geslo-123', s) !== false) vsePoko = false;
    }
  } catch {
    vsePoko = false;
  }
  check('pokvarjeni zapisi so false, brez metanja', vsePoko);
  console.log('gesla:');
}

// ── 2. Pravila vhoda (geslo, e-pošta) ────────────────────────
{
  check('geslo s 7 znaki ima razlog', passwordProblem('kratek7') !== null);
  check('geslo s 8 znaki je brez razloga', passwordProblem('osemznakov') === null);
  check('geslo s 200 znaki je brez razloga', passwordProblem('a'.repeat(200)) === null);
  check('geslo s 201 znakom ima razlog', passwordProblem('a'.repeat(201)) !== null);
  check('prazna e-pošta ima razlog', emailProblem('') !== null);
  check('e-pošta brez @ ima razlog', emailProblem('brez-afna') !== null);
  check('e-pošta brez pike v domeni ima razlog', emailProblem('a@b') !== null);
  check('veljavna e-pošta je brez razloga', emailProblem('obrtnik@example.si') === null);
  check('normalizacija: presledki in velike črke izginejo', normalizeEmail('  Obrtnik@Example.COM ') === 'obrtnik@example.com');
  console.log('pravila vhoda:');
}

// ── 3. Sejni žeton (HMAC + nonce + injektirana ura) ─────────
{
  const SK = 'skrivnost-zadolgo-vsaj-32-znakov!!';
  const tok = createSessionToken(SK, 'user_abc', 1_000_000, SESSION_TTL_SEC, 'nonce-t95');
  check('žeton ima ŠTIRI dele (userId.exp.nonce.sig)', tok.split('.').length === 4);
  check('veljaven žeton prepozna uporabnika', verifySessionToken(SK, tok, 1_000_000)?.userId === 'user_abc');
  check('isti nonce → isti žeton (determinizem)', createSessionToken(SK, 'user_abc', 1_000_000, SESSION_TTL_SEC, 'nonce-t95') === tok);
  check('drugi nonce → drug žeton', createSessionToken(SK, 'user_abc', 1_000_000, SESSION_TTL_SEC, 'drugi') !== tok);
  check('druga skrivnost → drug žeton', createSessionToken('druga-skrivnost-zadolgo-32-znakov!', 'user_abc', 1_000_000, SESSION_TTL_SEC, 'nonce-t95') !== tok);
  check('napačna skrivnost je zavrnjena', verifySessionToken('druga-skrivnost-zadolgo-32-znakov!', tok, 1_000_000) === null);

  // Potek: TTL 1 s, ura injektirana — brez spanja.
  const kratek = createSessionToken(SK, 'user_abc', 1_000, 1, 'n');
  check('žeton velja še v zadnji milisekundi', verifySessionToken(SK, kratek, 1_999) !== null);
  check('žeton po poteku je zavrnjen', verifySessionToken(SK, kratek, 2_000) === null);
  // Meja je zajedljiva: točno ob exp*1000 je žeton že potekel.
  const meja = createSessionToken(SK, 'u', 4_000, 0, 'n');
  check('točno na meji je žeton POTEKEL', verifySessionToken(SK, meja, 4_000) === null);
  check('milisekundo prej je še veljaven', verifySessionToken(SK, meja, 3_999) !== null);

  // Podtikanje: podpis in payload.
  const zamenjaj = tok.endsWith('A') ? 'B' : 'A';
  check('spremenjen podpis je zavrnjen', verifySessionToken(SK, tok.slice(0, -1) + zamenjaj, 1_000_000) === null);
  const drugPayload = `${Buffer.from('drug_uporabnik').toString('base64url')}${tok.slice(tok.indexOf('.'))}`;
  check('spremenjen payload (drugi userId) je zavrnjen', verifySessionToken(SK, drugPayload, 1_000_000) === null);

  // Task 95: nonce je NUJEN — brez njega bi dve prijavi v isti sekundi
  // delili isti tokenHash, preklic ene bi preklical obe.
  const brezNonca = createSessionToken(SK, 'user_abc', 1_000_000);
  check('prazen nonce je zavrnjen', verifySessionToken(SK, brezNonca, 1_000_000) === null);
  const potkaniNonce = `${tok.split('.')[0]}.${tok.split('.')[1]}.${Buffer.from('drug').toString('base64url')}.${tok.split('.')[3]}`;
  check('podtakanen nonce je zavrnjen (podpis pokrije nonce)', verifySessionToken(SK, potkaniNonce, 1_000_000) === null);

  check('slab format (brez pik) je zavrnjen', verifySessionToken(SK, 'abc', 0) === null);
  check('slab format (manjka tretji del) je zavrnjen', verifySessionToken(SK, 'a.b', 0) === null);
  check('slab format (stari 3-delni žeton) je zavrnjen', verifySessionToken(SK, 'dXNlcl9hYmM.123.sig-znak', 0) === null);
  check('prazen userId je zavrnjen', verifySessionToken(SK, createSessionToken(SK, '', 1_000, SESSION_TTL_SEC, 'n'), 1_000) === null);

  // tokenExpiryMs (Task 95): potek iz žetona za zapis v Session.
  check('tokenExpiryMs prebere potek', tokenExpiryMs(kratek) === 2_000);
  check('tokenExpiryMs na slabem žetonu je null', tokenExpiryMs('abc') === null);
  console.log('žetoni:');
}

// ── 4. Piškotki ──────────────────────────────────────────────
{
  check('manjkajoča glava → prazen slovar', Object.keys(parseCookies(null)).length === 0);
  check('prazna glava → prazen slovar', Object.keys(parseCookies('')).length === 0);
  const c = parseCookies('a=1; obrtnik_sessija=tok.123.sig; b=2');
  check('piškotki so razčlenjeni po ključih', c['a'] === '1' && c['b'] === '2' && c[SESSION_COOKIE] === 'tok.123.sig');
  check('vrednost z `=` se reže samo na prvem enačaju', parseCookies('a=b=c')['a'] === 'b=c');
  const sc = sessionCookie('tok123');
  check('sejni piškotek nosi ime in vrednost', sc.startsWith(`${SESSION_COOKIE}=tok123;`));
  check('piškotek je HttpOnly', sc.includes('HttpOnly'));
  check('piškotek je SameSite=Lax', sc.includes('SameSite=Lax'));
  check('piškotek ima Path=/', sc.includes('Path=/'));
  check('piškotek ima Max-Age=604800 (7 dni)', sc.includes('Max-Age=604800'));
  check('iztek piškotka ima Max-Age=0', clearSessionCookie().includes('Max-Age=0'));
  check('konstanti: ime in trajanje', SESSION_COOKIE === 'obrtnik_sessija' && SESSION_TTL_SEC === 604800);
  console.log('piškotki:');
}

// ── 5. Skrivnost (resolveAuthSecret) ─────────────────────────
{
  const veljavna = 'x'.repeat(32);
  check('32 znakov → stalna skrivnost', resolveAuthSecret(veljavna).ephemeral === false);
  check('stalna skrivnost je obrezana', resolveAuthSecret(`  ${veljavna}  `).secret === veljavna);
  const rnd = (n: number) => Buffer.alloc(n, 7);
  check('manjkajoča → začasna (ephemeral)', resolveAuthSecret(undefined, rnd).ephemeral === true);
  check('kratka → začasna (ephemeral)', resolveAuthSecret('prekratko', rnd).ephemeral === true);
  check('začasna je deterministična z injektiranim rnd', resolveAuthSecret(undefined, rnd).secret === Buffer.alloc(32, 7).toString('base64url'));
  console.log('skrivnost:');
}

// ── 6. Pravilo prijave (AUTH_LOGIN_RATE_RULE) ────────────────
{
  check('pravilo prijave: okno 60 s', AUTH_LOGIN_RATE_RULE.windowMs === 60_000);
  check('pravilo prijave: 10 poskusov na okno', AUTH_LOGIN_RATE_RULE.max === 10);
  const limiter = createRateLimiter(AUTH_LOGIN_RATE_RULE);
  let zadnji = true;
  for (let i = 0; i < 10; i++) zadnji = limiter.hit('k|a@b.si', 0).ok;
  check('10 poskusov je dovoljenih', zadnji);
  check('11. poskus je zavrnjen', !limiter.hit('k|a@b.si', 1).ok);
  check('druga e-pošta na istem naslovu ni blokirana', limiter.hit('k|druga@b.si', 2).ok);
  console.log('pravilo prijave:');
}

console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
