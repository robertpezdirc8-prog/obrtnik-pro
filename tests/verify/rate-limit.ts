/**
 * Preverja omejevalnik zahtev (src/lib/rate-limit.ts) kot čisto funkcijo
 * z INJEKTIRANO uro — brez spanja, brez mreže, brez strežnika.
 *
 * Pokrito:
 *  - dovoljuje natanko `max` zadetkov v oknu, (max+1)-ti je zavrnjen
 *  - `remaining` se pravilno šteje navzdol in je 0 pri zavrnitvi
 *  - `retryAfterSec` je vsaj 1 in PADA, ko se čas približuje koncu okna
 *  - okno se ponastavi po `windowMs` (nov zadetek je dovoljen)
 *  - ključi so izolirani (polno okno enega ne blokira drugega)
 *  - pranje: nad `maxKeys` se iztekli ključi počistijo (pomnilnik raste
 *    omejeno — preverjeno z `size()`)
 *  - `clientKeyFromHeaders`: prvi vnos x-forwarded-for, presledki,
 *    več vnosov, manjkajoča glava → 'local'
 *  - determinizem: isti niz klicev da ISTO vrsto odločitev (2× ponovljen)
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 */

import { createRateLimiter, clientKeyFromHeaders, type RateLimitDecision } from '../../src/lib/rate-limit';

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

const RULE = { windowMs: 60_000, max: 3 };

// ── 1. Osnovno okno: dovoljuje do max, nato zavrača ─────────
{
  const limiter = createRateLimiter(RULE);
  const d1 = limiter.hit('k1', 0);
  const d2 = limiter.hit('k1', 1_000);
  const d3 = limiter.hit('k1', 2_000);
  const d4 = limiter.hit('k1', 3_000);
  check('1. zadetek dovoljen, remaining = max-1', d1.ok && d1.remaining === 2);
  check('2. zadetek dovoljen, remaining = 1', d2.ok && d2.remaining === 1);
  check('3. zadetek dovoljen, remaining = 0', d3.ok && d3.remaining === 0);
  check('4. zadetek ZAVRNJEN', !d4.ok);
  check('zavrnitev nosi retryAfterSec \u2265 1', d4.retryAfterSec >= 1, String(d4.retryAfterSec));
  check('zavrnitev ima remaining 0', d4.remaining === 0);
  console.log('osnovno okno:');
}

// ── 2. retryAfterSec PADA, ko se približuje konec okna ──────
{
  const limiter = createRateLimiter(RULE);
  limiter.hit('k', 0);
  limiter.hit('k', 1_000);
  limiter.hit('k', 2_000);
  const zgodaj = limiter.hit('k', 3_000).retryAfterSec;
  const pozno = limiter.hit('k', 59_000).retryAfterSec;
  check('na začetku okna je čakanje točno preostanek okna (57 s)', zgodaj === 57, String(zgodaj));
  check('blizu konca okna je čakanje 1 s', pozno === 1, String(pozno));
  check('retryAfter pada s časom', pozno < zgodaj);
  console.log('retryAfter:');
}

// ── 3. Ponastavitev okna po windowMs ────────────────────────
{
  const limiter = createRateLimiter(RULE);
  for (let i = 0; i < 3; i++) limiter.hit('k', i);
  const zavrnjen = limiter.hit('k', 4_000);
  const poOknu = limiter.hit('k', 60_000);
  check('znotraj okna 4. zadetek zavrnjen', !zavrnjen.ok);
  check('po oknu je spet dovoljen', poOknu.ok);
  check('po oknu je remaining spet max-1', poOknu.remaining === 2, String(poOknu.remaining));
  console.log('ponastavitev:');
}

// ── 4. Izolacija ključev ────────────────────────────────────
{
  const limiter = createRateLimiter(RULE);
  for (let i = 0; i < 3; i++) limiter.hit('poln', i);
  const drug = limiter.hit('drug', 5_000);
  check('polno okno ključa A ne blokira ključa B', drug.ok && drug.remaining === 2);
  const okni2 = limiter.size();
  check('števec ključev je natančen', okni2 === 2, String(okni2));
  console.log('izolacija:');
}

// ── 5. Pranje izteklih ključev (omejena rast pomnilnika) ────
{
  const limiter = createRateLimiter({ windowMs: 1_000, max: 1, maxKeys: 5 });
  for (let i = 0; i < 5; i++) limiter.hit(`star-${i}`, 0);
  check('meja ključev dosežena', limiter.size() === 5, String(limiter.size()));
  // Nov zadetek s staro uro sproži pranje, ker je velikost nad mejo.
  limiter.hit('nov', 10_000);
  check('iztekli ključi so počisčeni, nov je notri', limiter.size() === 1, String(limiter.size()));
  console.log('pranje:');
}

// ── 6. clientKeyFromHeaders ─────────────────────────────────
{
  const mk = (fwd: string | null): Headers => {
    const h = new Headers();
    if (fwd !== null) h.set('x-forwarded-for', fwd);
    return h;
  };
  check('prvi vnos je klient', clientKeyFromHeaders(mk('1.2.3.4, 10.0.0.1')) === '1.2.3.4');
  check('presledki okoli IP so odstranjeni', clientKeyFromHeaders(mk('  5.6.7.8 , 10.0.0.2')) === '5.6.7.8');
  check('en sam vnos brez vejice', clientKeyFromHeaders(mk('9.9.9.9')) === '9.9.9.9');
  check('manjkajoča glava → local (iskreno, brez izmišljevanja)', clientKeyFromHeaders(mk(null)) === 'local');
  check('prazna glava → local', clientKeyFromHeaders(mk('')) === 'local');
  console.log('clientKey:');
}

// ── 7. Determinizem: isti niz klicev → ista vrsta odločitev ─
{
  const potek = (): boolean[] => {
    const limiter = createRateLimiter(RULE);
    const rez: boolean[] = [];
    for (let t = 0; t <= 61_000; t += 5_000) rez.push(limiter.hit('d', t).ok);
    return rez;
  };
  const a = potek();
  const b = potek();
  const enako = a.length === b.length && a.every((v, i) => v === b[i]);
  check('isti niz klicev da isto vrsto odločitev', enako, JSON.stringify({ a, b }));
  check('v poteku so DOVOLJENE in ZAVRNJENE odločitve', a.some((v) => v) && a.some((v) => !v));
  console.log('determinizem:');
}

// ── 8. ANALYZE_RATE_RULE ────────────────────────────────────
{
  const { ANALYZE_RATE_RULE } = await import('../../src/lib/rate-limit');
  check('pravilo za analizo: okno 60 s', ANALYZE_RATE_RULE.windowMs === 60_000);
  check('pravilo za analizo: 30 na okno', ANALYZE_RATE_RULE.max === 30);
  const limiter = createRateLimiter(ANALYZE_RATE_RULE);
  let zadnja: RateLimitDecision | null = null;
  for (let i = 0; i < 30; i++) zadnja = limiter.hit('monter', 0);
  check('30 analiz poštenega dela je dovoljenih', zadnja?.ok === true);
  check('31. analiza je zavrnjena', !limiter.hit('monter', 1_000).ok);
  console.log('pravilo analize:');
}

console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
