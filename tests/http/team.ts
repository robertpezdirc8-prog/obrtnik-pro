/**
 * HTTP tek Task 97 — vloge znotraj obrta (lastnik + montir) na LOČENI
 * bazi, port 3001, AUTH_ENFORCED=1. Meri prave HTTP odgovore.
 *
 * Scenarij:
 *  1. Registracija lastnika A → ekipa prazna, ponudba A-jeva
 *  2. A ne zna dodati montirja: napačna e-pošta, sam sebe (lastnik),
 *     novega brez gesla — vsaka z lastnim, jasnim sporočilom
 *  3. Montir X (neposredno v bazi, pravo geslo) se prijavi — še brez
 *     članstva je zavrnjen ŽE pri BRANJU (403 "povabilo"), ker
 *     legacy ne-filtriran obseg ne sme pogledati prijavljenemu
 *  4. A X-a POVEŽE (e-pošta brez gesla) → X vidi A-jevo ponudbo
 *  5. A ustvari NOVEGA montirja M (geslo v obrazcu) → M se prijavi;
 *     M vidi ponudbe/ure, PIŠE ure/fotke/dnevnik, računi, cenik,
 *     nastavitve, katalog in ekipa pa so za njega 403 z matričnim
 *     besedilom — in njegova ura VSAKIČ nosi ownerId A
 *  6. A odstrani člana → član izgubi obseg TAKOJ (403), zgodovina
 *     (njegova ura) ostane v obrtu; ponovni izbris → 404
 *  7. Brez seje: /api/team → 401 (ALWAYS, ne glede na način)
 *
 * Zagon (strežnik mora teči na 3001 z isto bazo, AUTH_ENFORCED=1):
 *  DATABASE_URL=file:/tmp/team-test.db bun tests/http/team.ts
 */

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth';

const db = new PrismaClient();
const BASE = 'http://localhost:3001';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const cookieOf = (res: Response): string => {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
};
const json = async (res: Response) => { try { return await res.json(); } catch { return {}; } };
const get = async (url: string, cookie: string) =>
  fetch(`${BASE}${url}`, { headers: { cookie } });
const send = async (url: string, cookie: string, method: string, body?: unknown) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

// ── 0. Session ob zagonu ─────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/auth/session`);
  const body = await json(res);
  check('session: zaščita uklopljena', body.enforced === true);
  check('session: uporabnikov še ni', body.usersExist === false);
}

// ── 1. Registracija lastnika A ───────────────────────────────
let cookieA = '';
let aId = '';
{
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@obrt.si', name: 'Lastnik A', password: 'geslo-12345' }),
  });
  check('register A → 201', res.status === 201, String(res.status));
  cookieA = cookieOf(res);
  const a = await db.user.findUnique({ where: { email: 'a@obrt.si' } });
  aId = a?.id ?? '';
  check('A ima vlogo "owner"', a?.role === 'owner');

  // A-jeva ponudba (poslovni podatek, ki ga montir bo videl)
  await db.offer.create({
    data: {
      ownerId: aId, number: '2027-099', customerName: 'Stranka A d.o.o.',
      subtotal: 300, vatRate: 22, vatAmount: 66, total: 366,
      items: { create: { name: 'ograja alu', quantity: 1, unit: 'kos', unitPrice: 300, total: 300 } },
    },
  });

  const team = await (await get('/api/team', cookieA)).json();
  check('A: GET team → ekipa prazna', Array.isArray(team.members) && team.members.length === 0);
}

// ── 2. A ne zna (še) dodati montirja — jasna sporočila ───────
{
  let res = await send('/api/team', cookieA, 'POST', { email: 'nije-pošta' });
  check('A: e-pošta neveljavna → 400', res.status === 400, String(res.status));
  res = await send('/api/team', cookieA, 'POST', { email: 'a@obrt.si' });
  check('A: lastnika (sami sebe) → 400 z razlago', res.status === 400 &&
    (await json(res)).error?.includes('lastnik'));
  res = await send('/api/team', cookieA, 'POST', { email: 'montir@obrt.si' });
  check('A: nov montir brez gesla → 400 (geslo potreben)', res.status === 400 &&
    (await json(res)).error?.includes('geslo'));
}

// ── 3. Montir X: račun obstaja, članstva še ne → zavrnjen že pri branju ──
let cookieX = '';
let xId = '';
{
  const x = await db.user.create({
    data: { email: 'x@obrt.si', name: 'Montir X', passwordHash: hashPassword('geslo-12345'), role: 'montir' },
  });
  xId = x.id;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@obrt.si', password: 'geslo-12345' }),
  });
  check('X: prijava → 200', res.status === 200, String(res.status));
  cookieX = cookieOf(res);
  const sess = await (await get('/api/auth/session', cookieX)).json();
  check('X: seja pove vlogo "montir"', sess.user?.role === 'montir');

  const offers = await get('/api/offers', cookieX);
  const body = await json(offers);
  check('X (brez članstva): GET offers → 403 pri BRANJU (varneje kot prazno)',
    offers.status === 403, String(offers.status));
  check('X (brez članstva): sporočilo zahteva povabilo',
    body.error === 'Nisi član nobenega obrta — za uporabo podatkov potrebuješ povabilo lastnika obrta.');
  const post = await send('/api/time-entries', cookieX, 'POST',
    { day: '2027-06-01', description: 'ura brez obrta', minutes: 60, hourlyRate: 20 });
  check('X (brez članstva): POST ure → 403 (nič ne zapiše sirote)',
    post.status === 403, String(post.status));
}

// ── 4. A poveže obstoječega montirja X (e-pošta, brez gesla) ──
{
  const res = await send('/api/team', cookieA, 'POST', { email: 'x@obrt.si', name: 'Montir X' });
  const body = await json(res);
  check('A: poveže X (obstoječ račun) → 201', res.status === 201, String(res.status));
  check('A: odgovor pove e-pošto in vlogo', body.member?.email === 'x@obrt.si' && body.member?.role === 'montir');
  const m = await db.member.findFirst({ where: { userId: xId } });
  check('A: članstvo kaže na A kot lastnika', m?.ownerId === aId);

  const offers = await get('/api/offers', cookieX);
  const ob = await json(offers);
  check('X (po povezavi): vidi A-jevo ponudbo', offers.status === 200 && ob.offers?.length === 1 &&
    ob.offers?.[0]?.number === '2027-099');

  const again = await send('/api/team', cookieA, 'POST', { email: 'x@obrt.si' });
  check('A: X-ja ponovno → 400 (največ en obrt)', again.status === 400 &&
    (await json(again)).error?.includes('enem obrtu'));
}

// ── 5. A ustvari NOVEGA montirja M (geslo v obrazcu) ─────────
let cookieM = '';
let mId = '';
{
  const res = await send('/api/team', cookieA, 'POST',
    { email: 'm@obrt.si', name: 'Montir M', password: 'geslo-12345' });
  check('A: nov montir M z geslom → 201', res.status === 201, String(res.status));
  const u = await db.user.findUnique({ where: { email: 'm@obrt.si' } });
  mId = u?.id ?? '';
  check('M: račun ima vlogo "montir"', u?.role === 'montir');
  const m = await db.member.findFirst({ where: { userId: mId } });
  check('M: članstvo obstaja (brez montirja brez obrta)', m?.ownerId === aId);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'm@obrt.si', password: 'geslo-12345' }),
  });
  cookieM = cookieOf(login);
  check('M: prijava → 200', login.status === 200, String(login.status));

  const again = await send('/api/team', cookieA, 'POST',
    { email: 'm@obrt.si', password: 'drugo-geslo-1' });
  check('A: M ponovno → 400 (že član)', again.status === 400);
}

// ── 6. Kaj M SME ─────────────────────────────────────────────
{
  const offers = await get('/api/offers', cookieM);
  const ob = await json(offers);
  check('M: GET offers → 200 in vidi A-jevo ponudbo', offers.status === 200 && ob.offers?.length === 1);

  const times = await get('/api/time-entries', cookieM);
  check('M: GET time-entries → 200 (prazna njegova ura)', times.status === 200);

  const post = await send('/api/time-entries', cookieM, 'POST',
    { day: '2027-06-02', description: 'montaža ograje A', minutes: 240, hourlyRate: 25, offerId: (await db.offer.findFirst({ where: { number: '2027-099' } }))?.id });
  const pb = await json(post);
  check('M: POST ura → 201', post.status === 201, String(post.status));
  const entry = await db.timeEntry.findFirst({ where: { description: 'montaža ograje A' } });
  check('M: ura nosi ownerId A (obseg obrta, ne montirja)', entry?.ownerId === aId);
  check('M: ura je vidna v A-jevem obrtu (odgovor nosi id)', typeof pb.entry?.id === 'string');

  const patch = await send(`/api/time-entries/${pb.entry?.id ?? 'x'}`, cookieM, 'PATCH', { minutes: 300 });
  check('M: PATCH svoje ure → 200', patch.status === 200, String(patch.status));
  const del = await send(`/api/time-entries/${pb.entry?.id ?? 'x'}`, cookieM, 'DELETE');
  check('M: DELETE ure → 403 (zgodovina je lastniška)', del.status === 403 &&
    (await json(del)).error === 'Za to dejanje potrebuješ vlogo lastnika obrta.');

  // Fotka: montir na terenu slika → POST sme
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const ph = await send('/api/photos', cookieM, 'POST', { dataUrl: PNG, title: 'terenska fotka' });
  const phb = await json(ph);
  check('M: POST fotka → 201', ph.status === 201, String(ph.status));
  const photoRow = phb.photo?.id ? await db.photo.findUnique({ where: { id: phb.photo.id } }) : null;
  check('M: fotka nosi ownerId A', photoRow?.ownerId === aId);
  check('M: fotka je na disku (Task 96 pot, mapa ob testni bazi)',
    Boolean(photoRow?.filePath) &&
    existsSync(join(tmpdir(), 'photos', photoRow?.filePath ?? 'ne')));
  const list = await get('/api/photos', cookieM);
  check('M: GET photos → 200 (vidi fotke obrta)', list.status === 200 &&
    (await json(list)).photos?.length === 1);
  const pdel = await send(`/api/photos/${phb.photo?.id ?? 'x'}`, cookieM, 'DELETE');
  check('M: DELETE fotka → 403', pdel.status === 403, String(pdel.status));
  const ppatch = await send(`/api/photos/${phb.photo?.id ?? 'x'}`, cookieM, 'PATCH', { title: 'x' });
  check('M: PATCH fotka → 403', ppatch.status === 403, String(ppatch.status));
}

// ── 7. Kaj M NE SME (denar in pogodba) ───────────────────────
{
  const offerId = (await db.offer.findFirst({ where: { number: '2027-099' } }))?.id ?? 'x';
  const cases: Array<[string, string, unknown, string]> = [
    ['GET invoices', 'GET', undefined, '/api/invoices'],
    ['POST invoices', 'POST', {}, '/api/invoices'],
    ['POST offers', 'POST', { customerName: 'x' }, '/api/offers'],
    ['PATCH offers/[id]', 'PATCH', { status: 'sent' }, `/api/offers/${offerId}`],
    ['DELETE offers/[id]', 'DELETE', undefined, `/api/offers/${offerId}`],
    ['GET cenik', 'GET', undefined, '/api/cenik'],
    ['PUT cenik', 'PUT', {}, '/api/cenik'],
    ['GET settings', 'GET', undefined, '/api/settings'],
    ['PUT settings', 'PUT', {}, '/api/settings'],
    ['GET catalog', 'GET', undefined, '/api/catalog'],
    ['GET team', 'GET', undefined, '/api/team'],
    ['POST team', 'POST', { email: 'nekdo@obrt.si' }, '/api/team'],
  ];
  for (const [name, method, body, url] of cases) {
    const res = await send(url, cookieM, method, body);
    const b = await json(res);
    check(`M: ${name} → 403 (matrika)`, res.status === 403 &&
      b.error === 'Za to dejanje potrebuješ vlogo lastnika obrta.',
      `${res.status} ${JSON.stringify(b).slice(0, 60)}`);
  }
  // A-jeva ponudba preživi vse M-jeve poskuse
  const still = await db.offer.findUnique({ where: { number: '2027-099' } });
  check('A-jeva ponudba preživi (nič izbrisanega/spremenjenega)', still?.ownerId === aId &&
    still?.status === 'draft');
}

// ── 8. Odstranitev člana = takojšnja izguba obsega ───────────
{
  const mx = await db.member.findFirst({ where: { userId: mId } });
  const xx = await db.member.findFirst({ where: { userId: xId } });

  const gone = await send(`/api/team/${mx?.id ?? 'x'}`, cookieM, 'DELETE');
  check('M: ne more odstraniti sebe/ekipe → 403', gone.status === 403, String(gone.status));

  const resX = await send(`/api/team/${xx?.id ?? 'x'}`, cookieA, 'DELETE');
  check('A: odstrani X → 200', resX.status === 200, String(resX.status));
  const xOffers = await get('/api/offers', cookieX);
  check('X: TAKOJ po odstranitvi GET offers → 403 (izguba obsega)',
    xOffers.status === 403, String(xOffers.status));

  const again = await send(`/api/team/${xx?.id ?? 'x'}`, cookieA, 'DELETE');
  check('A: ponovni izbris istega → 404', again.status === 404, String(again.status));

  const resM = await send(`/api/team/${mx?.id ?? 'x'}`, cookieA, 'DELETE');
  check('A: odstrani M → 200', resM.status === 200, String(resM.status));
  const mOffers = await get('/api/offers', cookieM);
  check('M: TAKOJ po odstranitvi → 403', mOffers.status === 403, String(mOffers.status));
  check('M: zgodovina (ura) ostane v A-jevem obrtu',
    (await db.timeEntry.findFirst({ where: { description: 'montaža ograje A' } }))?.ownerId === aId);
  const team = await (await get('/api/team', cookieA)).json();
  check('A: ekipa je spet prazna', team.members?.length === 0);
}

// ── 9. Brez seje: ekipa je ALWAYS zaščitena ──────────────────
{
  const g = await fetch(`${BASE}/api/team`);
  check('brez seje: GET team → 401', g.status === 401, String(g.status));
  const p = await fetch(`${BASE}/api/team`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'kdo@obrt.si' }),
  });
  check('brez seje: POST team → 401', p.status === 401, String(p.status));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
