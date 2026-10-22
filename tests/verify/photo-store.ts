/**
 * Preverja foto skladišče na disku (Task 96, issue #3 — src/lib/
 * photo-store.ts + diary-photos-disk.ts): čiste funkcije z INJEKTIRANO
 * mapo (vse v os.tmpdir()) + STATIČNA pokritost rut in klienta.
 *
 * Pokrito:
 *  - resolvePhotoDir: PHOTO_DIR > mapa ob DATABASE_URL > cwd/db/photos —
 *    PRENOSLJIVE poti (Task 71), nič vezano na razvojni stroj
 *  - decodeDataUrl: veljavni jpeg/png/webp, surov base64, NEVELJAVNI
 *    vhodi (napačen predpona, ne-slika, brez base64, prazna vsebina,
 *    odpadki) — nikoli metanje, vedno null
 *  - safeFileName: brez poti, brez `..`, samo znane končnice
 *  - save/read/delete krog v tmp mapi: bajti 1:1 (sha256), sličica
 *    (JPEG, ≤ 256 px širine), brisanje, manjkajoča datoteka → null
 *  - makeThumb: odpadki → null (najboljše prizadevanje, ne crash)
 *  - listPhotoFiles: samo znane končnice, urejeno, manjkajoča mapa → []
 *  - STATIČNO: rute (POST disk + rollback, seznam BREZ dataUrl, GET [id]
 *    z leno selitvijo, /image z bajti, DELETE briše datoteko), dnevnik
 *    (store/load + selitev + brisanje datotek), shema, klient
 *    (sličica v galeriji, polna fotka posamezno)
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 *
 * Zagon: bun tests/verify/photo-store.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeDataUrl,
  deletePhotoFile,
  listPhotoFiles,
  makeThumb,
  mimeOfFileName,
  readPhotoAsDataUrl,
  readPhotoBytes,
  resolvePhotoDir,
  THUMB_WIDTH,
  safeFileName,
  savePhoto,
} from '../../src/lib/photo-store';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('../../', import.meta.url));

// 1×1 rdeč piksel PNG (znana vsebina — sha je resnica v preverbah)
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_SHA = createHash('sha256').update(Buffer.from(PNG_1X1.split(',')[1], 'base64')).digest('hex');
const JPEG_1X1 =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDX/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const tmpDir = (name: string): string => {
  const d = join(tmpdir(), `obrtnik-t96-${name}-${randomBytes(4).toString('hex')}`);
  rmSync(d, { recursive: true, force: true });
  return d;
};

// ── 1. resolvePhotoDir — prenosljive poti ────────────────────
{
  check('PHOTO_DIR ima prednost (absolutna)',
    resolvePhotoDir({ PHOTO_DIR: join(tmpdir(), 'foto-x'), DATABASE_URL: 'file:/nekaj/drugo.db' }, '/nevažno') === join(tmpdir(), 'foto-x'));
  check('PHOTO_DIR sme biti relativen (rešen na cwd)',
    resolvePhotoDir({ PHOTO_DIR: 'podatki/foto' }, '/projekt') === '/projekt/podatki/foto');
  check('DATABASE_URL absoluten → mapa photos ob bazi',
    resolvePhotoDir({ DATABASE_URL: 'file:/data/db/custom.db' }, '/x') === '/data/db/photos');
  check('DATABASE_URL relativen (file:./db/custom.db) → cwd/db/photos',
    resolvePhotoDir({ DATABASE_URL: 'file:./db/custom.db' }, '/projekt') === '/projekt/db/photos');
  // NADGRADNJA: pot iz DATABASE_URL ne sme pobegniti iz projekta (EACCES).
  check('DATABASE_URL z `..` ne pobegne iz projekta',
    resolvePhotoDir({ DATABASE_URL: 'file:../db/custom.db' }, '/projekt') === '/projekt/db/photos',
    resolvePhotoDir({ DATABASE_URL: 'file:../db/custom.db' }, '/projekt'));
  check('absolutna pot ob bazi ostane absolutna',
    resolvePhotoDir({ DATABASE_URL: 'file:/data/db/custom.db' }, '/projekt') === '/data/db/photos');
  check('brez obojega → cwd/db/photos',
    resolvePhotoDir({}, '/projekt') === '/projekt/db/photos');
  check('nobena pot ni vezana na razvojni stroj (/home/z ali C:\\)',
    !JSON.stringify([
      resolvePhotoDir({ DATABASE_URL: 'file:./db/custom.db' }, '/p'),
      resolvePhotoDir({}, '/p'),
    ]).includes('/home/z'));
}

// ── 2. decodeDataUrl — vrata za vsebino ─────────────────────
{
  const png = decodeDataUrl(PNG_1X1);
  check('veljaven PNG: mime, končnica, bajti', png !== null && png.mime === 'image/png' && png.ext === '.png' && png.bytes.length > 0);
  check('sha256 je resnica vsebine', png?.sha256 === PNG_SHA);
  check('veljaven JPEG', decodeDataUrl(JPEG_1X1)?.ext === '.jpg');
  const slabi = ['', 'data:', 'data:text/plain;base64,SGVsbG8=', 'data:image/png;base64', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png,nekaj-brez-base64', 'data:image/png;base64,!!!!ne-base64!!!!', PNG_1X1.slice(0, 30)];
  let vsiNull = true;
  for (const s of slabi) {
    if (decodeDataUrl(s) !== null) { vsiNull = false; break; }
  }
  check('slabi vhodi so VSI null, brez metanja', vsiNull);
  check('prazna vsebina (samo predpona) je null', decodeDataUrl('data:image/png;base64,') === null);
}

// ── 3. safeFileName — pot ne more uiti ──────────────────────
{
  check('običajno ime z cuid je veljavno', safeFileName('cm8x2k9abc123.jpg') !== null);
  check('ime s pomišnjajem je veljavno', safeFileName('aux-01-a.png') !== null);
  const slabi = ['', 'podmapa/x.jpg', '..%2Fx.jpg', '../x.jpg', 'a\\b.jpg', 'x.jpg/../../y.jpg', '.skrito.jpg',
    'x.exe', 'x.php', 'x.JPG.exe', 'x ', ' x.jpg', 'x y.jpg'];
  let vsiNull = true;
  for (const s of slabi) {
    if (safeFileName(s) !== null) { vsiNull = false; break; }
  }
  check('slaba imena so VSI null (tudi \\ in ..)', vsiNull);
  check('mime iz .jpg je image/jpeg', mimeOfFileName('a.jpg') === 'image/jpeg');
  check('mime iz neznane končnice je null', mimeOfFileName('a.gif') === null);
}

// ── 4. save/read/delete krog (tmp mapa) ─────────────────────
{
  const dir = tmpDir('krog');
  const saved = await savePhoto(PNG_1X1, 'foto1', dir);
  check('savePhoto vrne ime + sličico + sha', saved !== null && saved.fileName === 'foto1.png' && saved.thumb !== null && saved.sha256 === PNG_SHA);
  const savedThumb = saved?.thumb ?? null;
  check('datoteka obstaja na disku', existsSync(join(dir, 'foto1.png')));
  check('sličica je JPEG dataURL', savedThumb?.startsWith('data:image/jpeg;base64,') === true);
  const back = readPhotoAsDataUrl('foto1.png', dir);
  check('readPhotoAsDataUrl vrne ISTO vsebino (sha 1:1)', back !== null && decodeDataUrl(back)?.sha256 === PNG_SHA);
  const bytes = readPhotoBytes('foto1.png', dir);
  check('surovi bajti se ujemajo', bytes !== null && createHash('sha256').update(bytes).digest('hex') === PNG_SHA);
  check('read po pote je null, brez metanja', readPhotoAsDataUrl('manjka.png', dir) === null);
  check('read z nevarnim imenom je null (pot ne uide)', readPhotoAsDataUrl('../izven.jpg', dir) === null);
  check('deletePhotoFile izbriše', deletePhotoFile('foto1.png', dir) === true && !existsSync(join(dir, 'foto1.png')));
  check('drugi delete je tiho OK (force)', deletePhotoFile('foto1.png', dir) === true);
  check('savePhoto z neveljavno vsebino je null in NE piše datoteke',
    (await savePhoto('data:image/gif;base64,R0lGOD=', 'x', dir)) === null && listPhotoFiles(dir).length === 0);
  rmSync(dir, { recursive: true, force: true });
}

// ── 5. Sličica — najboljše prizadevanje ─────────────────────
{
  const thumb = await makeThumb(Buffer.from(PNG_1X1.split(',')[1], 'base64'));
  check('sličica obstaja in je JPEG dataURL', thumb?.startsWith('data:image/jpeg;base64,') === true);
  check('širina sličice je zapisana (256)', THUMB_WIDTH === 256);
  const bad = await makeThumb(Buffer.from('to ni slika'));
  check('odpadki → null, brez metanja', bad === null);
}

// ── 6. listPhotoFiles — registar mape ───────────────────────
{
  const dir = tmpDir('seznam');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'b.jpg'), 'x');
  writeFileSync(join(dir, 'a.png'), 'x');
  writeFileSync(join(dir, 'slaba.txt'), 'x');
  // map z imenom datoteke: readdirSync jo vrne, ampak ni veljavna fotka
  mkdirSync(join(dir, 'podmapa.jpg'), { recursive: true });
  check('seznam: samo znane končnice, urejeno', JSON.stringify(listPhotoFiles(dir)) === JSON.stringify(['a.png', 'b.jpg']));
  check('manjkajoča mapa → prazen seznam, brez metanja', JSON.stringify(listPhotoFiles(tmpDir('ni-je'))) === '[]');
  rmSync(dir, { recursive: true, force: true });
}

// ── 7. STATIČNO: rute ───────────────────────────────────────
{
  const SRC = (p: string) => readFileSync(join(HERE, p), 'utf8');

  const list = SRC('src/app/api/photos/route.ts');
  const getBlock = list.slice(list.indexOf('export async function GET'), list.indexOf('export async function POST'));
  check('seznam NE vrača polnega dataUrl (select brez dataUrl: true)', !getBlock.includes('dataUrl: true'));
  check('seznam vrača thumbUrl + imageUrl', getBlock.includes('thumbUrl: true') && getBlock.includes('imageUrl'));
  check('POST piše na disk (savePhoto) in na napaki POBRIŠE vrstico', list.includes('savePhoto') && list.includes('db.photo.delete'));
  check('POST obdrži zgornjo mejo velikosti (413)', list.includes('MAX_BASE64') && list.includes('413'));

  const idRoute = SRC('src/app/api/photos/[id]/route.ts');
  check('GET [id] je obsegani (findFirst + ownScope)', /materializeDataUrl|findFirst[\s\S]*ownScope/.test(idRoute) && idRoute.includes('ownScope'));
  check('GET [id] dela LENO SELITEV (save + update + dataUrl: null)', idRoute.includes('LENA SELITEV') && idRoute.includes('filePath: saved.fileName'));
  check('manjkajoča vsebina je iskreno 404 z razlogom', idRoute.includes('Vsebina fotografije manjka.'));
  check('DELETE briše tudi DATOTEKO (deletePhotoFile)', idRoute.includes('deletePhotoFile'));

  const imgRoute = SRC('src/app/api/photos/[id]/image/route.ts');
  check('/image vrne bajte s pravim MIME', imgRoute.includes('readPhotoBytes') && imgRoute.includes('mimeOfFileName'));
  check('/image je obsegani (ownScope)', imgRoute.includes('ownScope'));
  check('/image sme biti predpomnjen (nespremenljiva vsebina)', imgRoute.includes('immutable'));

  // dnevnik
  const diaryStore = SRC('src/lib/diary-photos-disk.ts');
  check('dnevnik: storeDiaryPhotos piše na disk', diaryStore.includes('savePhoto'));
  check('dnevnik: loadDiaryPhotos materializira + seli legacy', diaryStore.includes('readPhotoAsDataUrl') && diaryStore.includes('needsMigration'));
  const diaryList = SRC('src/app/api/diary-entries/route.ts');
  check('dnevnik POST/GET uporabljata novo plast', diaryList.includes('storeDiaryPhotos') && diaryList.includes('loadDiaryPhotos'));
  const diaryId = SRC('src/app/api/diary-entries/[id]/route.ts');
  check('dnevnik PATCH briše stare datoteke (brez orphan)', diaryId.includes('deletePhotoFile'));
  check('dnevnik DELETE briše datoteke', /DELETE[\s\S]*deletePhotoFile/.test(diaryId));

  // shema
  const schema = SRC('prisma/schema.prisma');
  check('shema: Photo.filePath + thumbUrl, dataUrl nullable', /filePath\s+String\?/.test(schema) && /thumbUrl\s+String\?/.test(schema) && /dataUrl\s+String\?/.test(schema));
}

// ── 8. STATIČNO: klient ─────────────────────────────────────
{
  const SRC = (p: string) => readFileSync(join(HERE, p), 'utf8');
  const cam = SRC('src/components/camera/camera-view.tsx');
  check('galerija pokaže SLIČICO (thumbUrl prvi)', cam.includes('rec.thumbUrl ?? rec.dataUrl'));
  check('odpiranje fotke pobere CELOTO po id (photoFullDataUrl)', cam.includes('photoFullDataUrl') && cam.includes('`/api/photos/${id}`'));
  check('fotomontaža (buildProjectPairs) tudi gre po celoti', /buildProjectPairs[\s\S]*photoFullDataUrl/.test(cam));
}

console.log('foto skladišče:');
if (fail > 0) {
  console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
  process.exit(1);
} else {
  console.log(`REZULTAT: ${pass} OK, 0 NAPAK`);
}
