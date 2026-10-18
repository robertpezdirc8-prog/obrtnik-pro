// ─── Foto skladišče (Task 96, issue #3): binarna vsebina na DISK ──
// Prej je bila cela fotka (base64 dataURL, do ~5,5 MB) v SQLite — baza
// je rasla brez meje in vsako branje sličice je vleklo CELOTO fotko.
// Zdaj: v bazi samo ime datoteke + mala sličica (256 px, dataURL za
// sezname), polna vsebina na disku kot `photos/<id>.jpg`.
//
// NAČELA (ista kot povsod):
//  - vse funkcije sprejemajo MAPO kot parameter (injektirana pot) —
//    preverbe tečejo v /tmp, brez dotikanja prave mape;
//  - privzeta mapa je PRENOSLJIVA (Task 71): PHOTO_DIR > mapa ob
//    DATABASE_URL > <cwd>/db/photos — nič vezano na razvojni stroj;
//  - slaben vhod NIKOLI ne meta nepredvidene izjeme: decodeDataUrl vrne
//    null, pot se očisti (samo ime + znane končnice), sharpa napaka je
//    razvidna iz vrnjene vrednosti (metoda sličice je najboljše
//    prizadevanje — brez sličice fotka še vedno deluje).
//
// ISKRENO: mapa se ne brise samodejno. Orphan datoteke (baza izbrisana,
// disk ostal) počisti preverba / ročno; izgubljene datoteke (disk izbrisan,
// baza ostala) so 404 z razlogom — glej GET /api/photos/[id].

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';

/** Znane končnice (samo te smejo biti na disku). */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Privzeta mapa: PHOTO_DIR, če je nastavljen; sicer mapa ob bazi
 *  (DATABASE_URL=file:.../db/custom.db → .../db/photos); sicer
 *  <cwd>/db/photos. Vsak korak je opisaljen in preverljiv. */
export function resolvePhotoDir(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const override = (env.PHOTO_DIR ?? '').trim();
  if (override) return resolve(cwd, override);
  const url = (env.DATABASE_URL ?? '').trim();
  const m = /^file:(.+)$/.exec(url);
  if (m) {
    let p = m[1];
    // prisma: file:./db/custom.db (relativno na shemo/cwd) ali file:/abs/db/custom.db
    if (p.startsWith('./') || p.startsWith('../')) p = resolve(cwd, p);
    return join(p === '' ? cwd : p, '..', 'photos');
  }
  return join(cwd, 'db', 'photos');
}

// ─── Čisto: razčlenjevanje dataURL ───────────────────────────

export interface DecodedImage {
  mime: string;
  ext: string;
  bytes: Buffer;
  /** SHA-256 vsebine (hex) — dokaz v preverbah, ni shranjevan v bazo. */
  sha256: string;
}

/** Razčleni `data:image/<mime>;base64,<b64>`. Vrne null ob vsem slabem
 *  (napačna predpona, neznana končnica, pokvarjen base64, prazna
 *  vsebina, vsebina, ki NI res ta slika — magični bajti) — klicatelj
 *  javi 400/500, ne crash. Magični bajti so resni varnostni čuvaj:
 *  preoblečena datoteka (image/png z JPEG vsebino) ne gre skozi. */
export function decodeDataUrl(raw: string): DecodedImage | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (!raw.startsWith('data:')) return null; // surov base64: brez MIME ni znane končnice
  const comma = raw.indexOf(',');
  const semi = raw.indexOf(';');
  const header = semi > 5 ? raw.slice(5, semi) : '';
  if (!header.startsWith('image/')) return null;
  if (!raw.slice(0, comma + 1).includes('base64')) return null;
  const mime = header;
  let bytes: Buffer;
  // base64/base64url sicer Node tiho preskoči neznane znake — neveljavna
  // vsebina bi nemoteno prešla; stroga maska jo ujame ZDAJ.
  const cleaned = raw.slice(comma + 1).replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned)) return null;
  try {
    bytes = Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const ext = EXT_BY_MIME[mime];
  if (!ext) return null;
  if (!magicMatches(bytes, mime)) return null;
  return { mime, ext, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Preveri podpis slike (magic bytes) ZA PRIPONKO, ki jo nosi MIME.
 *  Prenkratken/pokvarjen zapis je null — na disk gre samo res slika. */
function magicMatches(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return bytes.length >= 12 &&
      bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
  }
  return false;
}

/** Samo ime datoteke z znano končnico: brez poti, brez `..`, brez
 *  podmap. Vrne null ob vsem drugem — pot na disk je ZVEDENA. */
export function safeFileName(name: string): string | null {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (name !== name.trim() || name.startsWith('.')) return null;
  const ext = extname(name).toLowerCase();
  if (!MIME_BY_EXT[ext]) return null;
  // ime: cuid/hex, brez presledkov in posebnih znakov
  if (!/^[\w-]+$/.test(name.slice(0, name.length - ext.length))) return null;
  return name;
}

/** MIME iz imena datoteke (za Content-Type). Neznana → null. */
export function mimeOfFileName(name: string): string | null {
  const ext = extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

// ─── Sličica: 256 px, JPEG, dataURL ──────────────────────────

/** Širina sličice za sezname. Izrecno, ker je del zapisanega načrta. */
export const THUMB_WIDTH = 256;

/** Sličica je najboljše prizadevanje: padec sharpa NE spodnese
 *  shranjevanja — seznam brez sličice pokaže placeholder, fotka pa
 *  je še vedno na disku. Vrne dataURL ali null. */
export async function makeThumb(bytes: Buffer): Promise<string | null> {
  try {
    const out = await sharp(bytes)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Disk: shrani / preberi / izbriši ────────────────────────

export interface SavedPhoto {
  /** Samo ime datoteke (`<id>.jpg`) — gre v bazo (Photo.filePath). */
  fileName: string;
  /** Sličica kot dataURL (ali null, če sharpa ni uspel). */
  thumb: string | null;
  sha256: string;
}

/** Shrani vsebino na disk pod `<id><ext>` in vrne ime + sličico.
 *  Mapa se po potrebi ustvari (mkdirSync recursive). */
export async function savePhoto(
  dataUrl: string,
  id: string,
  dir: string,
): Promise<SavedPhoto | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const fileName = `${id}${decoded.ext}`;
  if (!safeFileName(fileName)) return null;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), decoded.bytes);
  const thumb = await makeThumb(decoded.bytes);
  return { fileName, thumb, sha256: decoded.sha256 };
}

/** Preberi datoteko nazaj kot dataURL. Vrne null, če datoteka
 *  manjka ali ime ni varno (pot ne more uiti mapi). */
export function readPhotoAsDataUrl(fileName: string, dir: string): string | null {
  const safe = safeFileName(fileName);
  if (!safe) return null;
  try {
    const bytes = readFileSync(join(dir, safe));
    const mime = mimeOfFileName(safe);
    if (!mime) return null;
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Preberi SUROVE bajte (za /api/photos/[id]/image). */
export function readPhotoBytes(fileName: string, dir: string): Buffer | null {
  const safe = safeFileName(fileName);
  if (!safe) return null;
  try {
    return readFileSync(join(dir, safe));
  } catch {
    return null;
  }
}

/** Izbriši datoteko (najboljše prizadevanje): ENOENT je tiho OK —
 *  cilj je, da je ni. Vrne true, če je bila (ali že ni) na disku. */
export function deletePhotoFile(fileName: string, dir: string): boolean {
  const safe = safeFileName(fileName);
  if (!safe) return false;
  try {
    rmSync(join(dir, safe), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Seznam imen datotek v mapi (samo DEJANSKE datoteke z znanimi
 *  končnicami — za preverbo registry ↔ disk). Manjkajoča mapa →
 *  prazen seznam, brez metanja. */
export function listPhotoFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && safeFileName(e.name) !== null)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
