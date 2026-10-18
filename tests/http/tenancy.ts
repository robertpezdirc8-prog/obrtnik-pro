/**
 * HTTP tek Task 94 — multi-tenant obseganje na LOČENI bazi, port 3001,
 * AUTH_ENFORCED=1. Meri pravi HTTP odgovore, ne kodnih poti.
 *
 * Scenarij:
 *  1. "Zgodovinska baza" (pred prijavo): zapisi brez ownerId — direktno Prisma
 *  2. Registracija lastnika A → PREVZEM vseh ownerId=null
 *  3. A vidi svojo zgodovino
 *  4. Drug uporabnik B (direktno Prisma) s svojo ponudbo
 *  5. A NE vidi B-ja: seznami, [id] (404), račun iz tuje ponudbe (404),
 *     nastavitve, cenik — vsak obseg merjen čez HTTP
 *
 * Zagon (strežnik mora teči na 3001 z isto bazo, AUTH_ENFORCED=1):
 *  DATABASE_URL=file:/tmp/tenancy-test.db bun tests/http/tenancy.ts
 */

import { PrismaClient } from '@prisma/client';

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

// ── 0. Session ob zagonu ─────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/auth/session`);
  const body = await json(res);
  check('session: zaščita uklopljena', body.enforced === true);
  check('session: uporabnikov še ni', body.usersExist === false);
}

// ── 1. Zgodovinska baza: zapisi brez ownerId (stara instalacija) ──
{
  await db.settings.create({ data: { id: 'default', companyName: 'Stari Obrt s.p.', vatRate: 22 } });
  const hist = await db.offer.create({
    data: {
      number: '2025-001',
      customerName: 'Zgodovinski Stranka d.o.o.',
      subtotal: 100, vatRate: 22, vatAmount: 22, total: 122,
      items: { create: { name: 'Zgodovinska postavka', quantity: 1, unit: 'kos', unitPrice: 100, total: 100 } },
    },
  });
  await db.cenikPrice.create({ data: { key: 'ograje.alu', unitPrice: 99 } });
  await db.photo.create({ data: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', title: 'zgodovinska fotka' } });
  await db.timeEntry.create({ data: { day: '2025-06-01', description: 'zgodovinska ura', minutes: 60, hourlyRate: 20 } });
  await db.diaryEntry.create({ data: { day: '2025-06-01', note: 'zgodovinski dnevnik' } });
  console.log(`  · zgodovina ustvarjena (ponudba ${hist.id})`);
}

// ── 2. Registracija lastnika A → prevzem ────────────────────
let cookieA = '';
{
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@obrt.si', name: 'Lastnik A', password: 'geslo-12345' }),
  });
  check('register A → 201', res.status === 201, String(res.status));
  cookieA = cookieOf(res);
  check('register A vrne piškotek', cookieA.startsWith('obrtnik_sessija='));
  const a = await db.user.findUnique({ where: { email: 'a@obrt.si' } });
  const old = await db.offer.findUnique({ where: { number: '2025-001' } });
  const oldSettings = await db.settings.findUnique({ where: { id: 'default' } });
  const oldCenik = await db.cenikPrice.findFirst({ where: { key: 'ograje.alu' } });
  const oldPhoto = await db.photo.findFirst({ where: { title: 'zgodovinska fotka' } });
  const oldTime = await db.timeEntry.findFirst({ where: { description: 'zgodovinska ura' } });
  const oldDiary = await db.diaryEntry.findFirst({ where: { note: 'zgodovinski dnevnik' } });
  check('prevzem: ponudba ostane A-jeva', old?.ownerId === a?.id);
  check('prevzem: settings ostane A-jev', oldSettings?.ownerId === a?.id);
  check('prevzem: cenik ostane A-jev', oldCenik?.ownerId === a?.id);
  check('prevzem: fotka ostane A-jeva', oldPhoto?.ownerId === a?.id);
  check('prevzem: ura ostane A-jeva', oldTime?.ownerId === a?.id);
  check('prevzem: dnevnik ostane A-jev', oldDiary?.ownerId === a?.id);
}

// ── 3. A vidi svojo zgodovino ────────────────────────────────
{
  const res = await fetch(`${BASE}/api/offers`, { headers: { cookie: cookieA } });
  const body = await json(res);
  check('A: GET offers → 200', res.status === 200);
  check('A: vidi zgodovinsko ponudbo', body.offers?.length === 1 && body.offers[0].number === '2025-001');

  const resC = await fetch(`${BASE}/api/cenik`, { headers: { cookie: cookieA } });
  const bodyC = await json(resC);
  check('A: vidi prevzet cenik', bodyC.values?.['ograje.alu'] === 99);

  const resS = await fetch(`${BASE}/api/settings`, { headers: { cookie: cookieA } });
  const bodyS = await json(resS);
  check('A: vidi prevzete nastavitve (stari obrt)', bodyS.settings?.companyName === 'Stari Obrt s.p.');
}

// ── 4. Uporabnik B (direktno Prisma) s svojo ponudbo ─────────
let offerB = '';
{
  const b = await db.user.create({
    data: { email: 'b@obrt.si', name: 'Obrt B', passwordHash: 'scrypt$YQ$YQ', role: 'owner' },
  });
  const ob = await db.offer.create({
    data: {
      ownerId: b.id, number: '2025-002', customerName: 'Stranka B',
      subtotal: 50, vatRate: 22, vatAmount: 11, total: 61,
      items: { create: { name: 'postavka B', quantity: 1, unit: 'kos', unitPrice: 50, total: 50 } },
    },
  });
  offerB = ob.id;
  console.log(`  · uporabnik B s ponudbo ${offerB}`);
}

// ── 5. Obseg: A ne vidi B-ja ─────────────────────────────────
{
  const res = await fetch(`${BASE}/api/offers`, { headers: { cookie: cookieA } });
  const body = await json(res);
  check('A: GET offers vidi SAMO svoje (1, ne 2)', body.offers?.length === 1);

  const resId = await fetch(`${BASE}/api/offers/${offerB}`, { headers: { cookie: cookieA } });
  check('A: GET tuja ponudba → 404', resId.status === 404, String(resId.status));

  const resPatch = await fetch(`${BASE}/api/offers/${offerB}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ status: 'sent' }),
  });
  check('A: PATCH tuja ponudba → 404', resPatch.status === 404, String(resPatch.status));

  const resDel = await fetch(`${BASE}/api/offers/${offerB}`, {
    method: 'DELETE', headers: { cookie: cookieA },
  });
  check('A: DELETE tuja ponudba → 404 (in ne izbriše)', resDel.status === 404);
  check('B: ponudba še obstaja', await db.offer.findUnique({ where: { id: offerB } }) !== null);

  const resInv = await fetch(`${BASE}/api/invoices`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ offerId: offerB }),
  });
  check('A: račun iz TUJE ponudbe → 404', resInv.status === 404, String(resInv.status));

  const resTe = await fetch(`${BASE}/api/time-entries`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ day: '2026-01-10', description: 'ura na tujem', minutes: 30, hourlyRate: 20, offerId: offerB }),
  });
  check('A: ura vezana na tujo ponudbo → 400', resTe.status === 400, String(resTe.status));
}

// ── 6. Nastavitve in cenik — vsak svoj ───────────────────────
{
  // A spremeni ime podjetja — prijava si popravi SVOJO vrstico.
  const resPut = await fetch(`${BASE}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ companyName: 'Novi Obrt A s.p.' }),
  });
  check('A: PUT nastavitve → 200', resPut.status === 200);
  const aRow = await db.settings.findFirst({ where: { companyName: 'Novi Obrt A s.p.' } });
  const aUser = await db.user.findUnique({ where: { email: 'a@obrt.si' } });
  check('A: nastavitve so A-jeva vrstica (id "default" je prevzet)', aRow !== null && aRow?.ownerId === aUser?.id);
  check('legacy vrstica NE obstaja kot brez lastnika',
    (await db.settings.findUnique({ where: { id: 'default' } }))?.ownerId === aUser?.id);

  // Cenik: A shrani novo ceno → vrstica z A ownerId.
  const resCen = await fetch(`${BASE}/api/cenik`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ 'ograje.inox': 140 }),
  });
  check('A: PUT cenik → 200', resCen.status === 200);
  const inox = await db.cenikPrice.findFirst({ where: { key: 'ograje.inox' } });
  check('nova cenik vrstica nosi ownerId A', inox?.ownerId === aUser?.id);
  const aluRows = await db.cenikPrice.findMany({ where: { key: 'ograje.alu' } });
  check('prevzeta cenik vrstica ostane SAMO ENA (duplikat ni nastal)',
    aluRows.length === 1 && aluRows[0].ownerId === aUser?.id);

  // Brez seje: čuvaj prej kot obseg — 401, ne podatkov.
  const resCenNoSession = await fetch(`${BASE}/api/cenik`);
  check('cenik brez seje v AUTH_ENFORCED → 401 (čuvaj prej kot obseg)',
    resCenNoSession.status === 401, String(resCenNoSession.status));
}

// ── 7. Nova ponudba A nosi ownerId ───────────────────────────
{
  const res = await fetch(`${BASE}/api/offers`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({
      customerName: 'Nova Stranka',
      vatRate: 22,
      items: [{ name: 'nova postavka', quantity: 2, unit: 'm', unitPrice: 30 }],
    }),
  });
  check('A: POST nova ponudba → 201', res.status === 201, String(res.status));
  const body = await json(res);
  const row = await db.offer.findUnique({ where: { id: body.offer.id } });
  const aUser = await db.user.findUnique({ where: { email: 'a@obrt.si' } });
  check('nova ponudba nosi ownerId A', row?.ownerId === aUser?.id);
}

await db.$disconnect();
console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
