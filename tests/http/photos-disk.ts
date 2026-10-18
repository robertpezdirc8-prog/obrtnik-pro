/**
 * HTTP tek Task 96 — fotke na DISKU (issue #3) na LOČENI bazi, port
 * 3001, AUTH_ENFORCED=1, PHOTO_DIR na /tmp (env override — prenosljive
 * poti se izmerijo v praksi). Meri prave datoteke na disku, ne kodnih
 * poti.
 *
 * Scenarij:
 *  1. POST fotka → 201; na DISKU datoteka obstaja; v bazi filePath +
 *     thumbUrl, dataUrl je NULL (baza ne raste z vsebino)
 *  2. SEZNAM → brez polnega dataUrl, s sličico + imageUrl
 *  3. GET [id] → celotna fotka (dataUrl 1:1 s poslano, sha256)
 *  4. GET [id]/image → SUROVI bajti 1:1 + pravi Content-Type
 *  5. TENANCY: tuja fotka je 404 (in njen zapis preživi)
 *  6. IZGUBLJENA datoteka → iskreno 404 z razlogom
 *  7. LEGACY vrstica (dataUrl v bazi, brez datoteke) → LENA SELITEV ob
 *     prvem branju: datoteka nastane, baza se počisti
 *  8. DELETE → vrstica IN datoteka izgineta
 *  9. DNEVNIK: fotka na disk, privzeti seznam = sličice, ?photos=1 =
 *     polne; PATCH zamenja fotke (stare datoteke izginejo); DELETE
 *     počisti datoteke
 * 10. REGISTAR ↔ DISK 1:1 (brez orphan datotek na koncu)
 *
 * Zagon (strežnik mora teči na 3001 z isto bazo in isto mapo,
 * AUTH_ENFORCED=1):
 *  DATABASE_URL=file:<tmpdir>/photos-t96.db PHOTO_DIR=<tmpdir>/photos-t96 bun tests/http/photos-disk.ts
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3001';
// ISTA mapa, ki jo nosi strežnik (PHOTO_DIR v env) — prenosljivo (Task 71).
const PHOTO_DIR = process.env.PHOTO_DIR ?? join(tmpdir(), 'photos-t96');

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_SHA = (b: Buffer | string): string =>
  createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'base64') : b).digest('hex');
const PNG_B64 = PNG_1X1.split(',')[1];

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const json = async (res: Response) => { try { return await res.json(); } catch { return {}; } };
const GET = (path: string, cookie?: string) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });

// ── 0. čista mapa ────────────────────────────────────────────
rmSync(PHOTO_DIR, { recursive: true, force: true });

// ── 1. prijava ───────────────────────────────────────────────
let cookie = '';
{
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'foto@obrt.si', password: 'geslo-12345' }),
  });
  check('register → 201', res.status === 201, String(res.status));
  cookie = cookieOf(res);
}

// ── 2. POST → disk, ne baza ──────────────────────────────────
let photoId = '';
{
  const res = await fetch(`${BASE}/api/photos`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: 'Testna fotka', craftId: 'ograje', dataUrl: PNG_1X1 }),
  });
  check('POST fotka → 201', res.status === 201, String(res.status));
  const body = await json(res);
  photoId = body.photo?.id ?? '';
  check('odgovor nosi id + thumbUrl (sličica)', photoId !== '' && typeof body.photo?.thumbUrl === 'string' && body.photo.thumbUrl.startsWith('data:image/jpeg;base64,'));
  const row = await db.photo.findUnique({ where: { id: photoId } });
  check('baza: filePath nastavljen ("<id>.png")', row?.filePath === `${photoId}.png`, row?.filePath ?? 'null');
  check('baza: dataUrl je NULL (vsebina NE v bazi)', row?.dataUrl === null);
  check('baza: thumbUrl je sličica', row?.thumbUrl?.startsWith('data:image/jpeg;base64,') === true);
  const p = join(PHOTO_DIR, row?.filePath ?? '');
  check('datoteka OBSTAJA na disku', existsSync(p));
  check('bajti na disku 1:1 (sha256)', existsSync(p) && PNG_SHA(readFileSync(p)) === PNG_SHA(PNG_B64));
}

// ── 3. SEZNAM: lahkoten ──────────────────────────────────────
{
  const res = await GET('/api/photos', cookie);
  const body = await json(res);
  const p = (body.photos ?? [])[0] ?? {};
  check('seznam → 200 z 1 vrstico', res.status === 200 && (body.photos ?? []).length === 1);
  check('seznam NE nosi polnega dataUrl', !('dataUrl' in p));
  check('seznam nosi thumbUrl + imageUrl', typeof p.thumbUrl === 'string' && p.imageUrl === `/api/photos/${photoId}/image`);
}

// ── 4. GET [id]: celotna fotka ───────────────────────────────
{
  const res = await GET(`/api/photos/${photoId}`, cookie);
  const body = await json(res);
  check('GET [id] → 200', res.status === 200);
  check('dataUrl 1:1 s poslano (sha256)', PNG_SHA(body.photo?.dataUrl?.split(',')[1] ?? '') === PNG_SHA(PNG_B64));
  check('nosí tudi imageUrl', body.photo?.imageUrl === `/api/photos/${photoId}/image`);
}

// ── 5. GET [id]/image: surovi bajti ──────────────────────────
{
  const res = await GET(`/api/photos/${photoId}/image`, cookie);
  const buf = Buffer.from(await res.arrayBuffer());
  check('image → 200 + image/png', res.status === 200 && res.headers.get('content-type') === 'image/png');
  check('bajti 1:1', PNG_SHA(buf) === PNG_SHA(PNG_B64));
  check('Cache-Control: immutable (vsebina nespremenljiva)', (res.headers.get('cache-control') ?? '').includes('immutable'));
}

// ── 6. TENANCY: tuja fotka ───────────────────────────────────
{
  const other = await db.user.create({ data: { email: 'tujec@obrt.si', passwordHash: 'x', name: 'Tujec' } });
  const foreignId = 'cmforeignphoto000000000000';
  await db.photo.create({ data: { id: foreignId, ownerId: other.id, filePath: `${foreignId}.png`, thumbUrl: null } });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(PHOTO_DIR, `${foreignId}.png`), Buffer.from(PNG_B64, 'base64'));
  check('tuja fotka → 404', (await GET(`/api/photos/${foreignId}`, cookie)).status === 404);
  check('tuj /image → 404', (await GET(`/api/photos/${foreignId}/image`, cookie)).status === 404);
  const alive = await db.photo.findUnique({ where: { id: foreignId } });
  check('tuj zapis PREŽIVI (nismo ga pobrisali z bralnim klicem)', alive !== null);
  await db.photo.delete({ where: { id: foreignId } });
  await db.user.delete({ where: { id: other.id } });
  rmSync(join(PHOTO_DIR, `${foreignId}.png`), { force: true }); // testova datoteka tudi
}

// ── 7. IZGUBLJENA datoteka → iskreno 404 ─────────────────────
{
  const ghostId = 'cmghostphoto00000000000000';
  await db.photo.create({ data: { id: ghostId, ownerId: (await db.user.findFirst())!.id, filePath: `${ghostId}.png` } });
  const res = await GET(`/api/photos/${ghostId}`, cookie);
  const body = await json(res);
  check('registr brez datoteke → 404 z razlogom', res.status === 404 && body.error === 'Vsebina fotografije manjka.');
  await db.photo.delete({ where: { id: ghostId } });
}

// ── 8. LENA SELITEV legacy vrstice ───────────────────────────
{
  const legacyId = 'cmlegacyphoto0000000000000';
  await db.photo.create({
    data: {
      id: legacyId, ownerId: (await db.user.findFirst())!.id,
      dataUrl: PNG_1X1, // stara instalacija: vsebina še v bazi
    },
  });
  const res = await GET(`/api/photos/${legacyId}`, cookie);
  const body = await json(res);
  check('legacy → 200 in polna fotka v odgovoru', res.status === 200 && PNG_SHA(body.photo?.dataUrl?.split(',')[1] ?? '') === PNG_SHA(PNG_B64));
  const row = await db.photo.findUnique({ where: { id: legacyId } });
  check('selitev: datoteka nastala na disku', row?.filePath === `${legacyId}.png` && existsSync(join(PHOTO_DIR, row.filePath)));
  check('selitev: baza počista dataUrl (NULL)', row?.dataUrl === null);
  check('selitev: thumbUrl izpolnjen', row?.thumbUrl?.startsWith('data:image/jpeg;base64,') === true);
}

// ── 9. DELETE → vrstica IN datoteka ──────────────────────────
{
  const del = await fetch(`${BASE}/api/photos/${photoId}`, { method: 'DELETE', headers: { cookie } });
  check('DELETE → 200', del.status === 200);
  check('vrstica izgine iz baze', (await db.photo.findUnique({ where: { id: photoId } })) === null);
  check('datoteka izgine z diska', !existsSync(join(PHOTO_DIR, `${photoId}.png`)));
  check('drugi DELETE → 404', (await fetch(`${BASE}/api/photos/${photoId}`, { method: 'DELETE', headers: { cookie } })).status === 404);
}

// ── 10. DNEVNIK ──────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/diary-entries`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ day: '2026-10-18', phase: 'priprava', note: 'test fotk', photos: [{ dataUrl: PNG_1X1, caption: 'polje' }] }),
  });
  check('dnevnik POST → 200 (vnos je bil vedno 200, ne 201)', res.status === 200, String(res.status));
  const { entry } = await json(res);
  const row = await db.diaryEntry.findUnique({ where: { id: entry.id } });
  const parsed = JSON.parse(row?.photos ?? '[]') as { file?: string; dataUrl?: string }[];
  check('dnevnik: v bazi IME datoteke, NE dataUrl', typeof parsed[0]?.file === 'string' && parsed[0]?.dataUrl === undefined);
  check('dnevnik: datoteka na disku', typeof parsed[0]?.file === 'string' && existsSync(join(PHOTO_DIR, parsed[0].file)));
  const sličice = await json(await GET('/api/diary-entries', cookie));
  const defaultPhoto = (sličice.entries ?? [])[0]?.photos?.[0];
  check('dnevnik privzeti seznam: SLIČICA v dataUrl', typeof defaultPhoto?.dataUrl === 'string' && defaultPhoto.dataUrl.startsWith('data:image/jpeg;base64,'));
  const polne = await json(await GET('/api/diary-entries?photos=1', cookie));
  const fullPhoto = (polne.entries ?? [])[0]?.photos?.[0];
  check('dnevnik ?photos=1: POLNA fotka 1:1', PNG_SHA(fullPhoto?.dataUrl?.split(',')[1] ?? '') === PNG_SHA(PNG_B64));

  // PATCH zamenja fotke → stara datoteka izgine
  const staraFile = parsed[0]?.file ?? '';
  const patch = await fetch(`${BASE}/api/diary-entries/${entry.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ photos: [{ dataUrl: PNG_1X1, caption: 'nova' }] }),
  });
  check('dnevnik PATCH → 200', patch.status === 200);
  check('stara datoteka izgine (brez orphan)', staraFile !== '' && !existsSync(join(PHOTO_DIR, staraFile)));

  const del = await fetch(`${BASE}/api/diary-entries/${entry.id}`, { method: 'DELETE', headers: { cookie } });
  check('dnevnik DELETE → 200', del.status === 200);
  const novaRow = await db.diaryEntry.findUnique({ where: { id: entry.id } });
  check('dnevniška vrstica po DELETE izgine', novaRow === null);
}

// ── 11. REGISTAR ↔ DISK 1:1 (brez orphan) ────────────────────
{
  const rows = await db.photo.findMany({ select: { filePath: true } });
  const files = readdirSync(PHOTO_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
  const dbFiles = rows.map((r) => r.filePath).filter((f): f is string => f !== null).sort();
  check('fotografije: datoteke na disku == filePath v bazi',
    JSON.stringify(dbFiles) === JSON.stringify([...files].sort()),
    `disk=${JSON.stringify(files)} baza=${JSON.stringify(dbFiles)}`);
  // počisti legacy fotko iz koraka 8 za čist konec
  const legacy = await db.photo.findMany({ where: { filePath: { not: null } }, select: { id: true, filePath: true } });
  for (const r of legacy) {
    if (r.filePath) rmSync(join(PHOTO_DIR, r.filePath), { force: true });
    await db.photo.delete({ where: { id: r.id } });
  }
}

console.log('fotke na disku (HTTP):');
if (fail > 0) {
  console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
  process.exit(1);
} else {
  console.log(`REZULTAT: ${pass} OK, 0 NAPAK`);
}
await db.$disconnect();
