// ─── Dnevniške fotke na disku (Task 96, issue #3) ────────────
// DiaryEntry.photos je JSON niz. PREJ: celotni dataURL (do ~5 MB) v
// vsaki vrstici. ZDAJ: `{ file, thumb, caption }` — polna vsebina na
// disku, v bazi samo ime datoteke + mala sličica.
//
// VNOSNA pogodba ostaja ista (klient pošlje dataUrl) — transformacijo
// dela ta plast. Legacy vnosi (dataUrl v JSON) se LENO selijo ob
// prvem branju: selitev je idempotentna, pri neuspehu diska se vnosi
// še vedno POKAŽEJO (starejše vedenje), samo selitev se ne zgodi.

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { readPhotoAsDataUrl, readPhotoAsDataUrlAsync, safeFileName, savePhoto, type SavedPhoto } from '@/lib/photo-store';
import type { DiaryPhoto } from '@/lib/site-diary';

/** Oblika zapisa v bazi (Task 96). */
export interface StoredDiaryPhoto {
  file: string;
  thumb: string | null;
  caption: string | null;
}

/** Oblika v odgovoru (ista kot prej — klient se ne meni). */
export interface DiaryPhotoOut {
  dataUrl: string;
  thumb: string | null;
  caption: string | null;
}

/** Shrani vnosne fotke (dataUrl) na disk. Vrne zapise za bazo ali
 *  razlog (isti odgovor 400/500 kot doslej — brez tihih usekov). */
export async function storeDiaryPhotos(
  photos: DiaryPhoto[],
  dir: string,
): Promise<{ stored: StoredDiaryPhoto[]; error: string | null }> {
  const stored: StoredDiaryPhoto[] = [];
  for (const p of photos) {
    const name = randomBytes(12).toString('hex');
    const saved: SavedPhoto | null = await savePhoto(p.dataUrl, name, dir);
    if (!saved) {
      return { stored: [], error: 'Shranjevanje fotografije ni uspelo.' };
    }
    stored.push({ file: saved.fileName, thumb: p.thumb ?? saved.thumb, caption: p.caption });
  }
  return { stored, error: null };
}

interface RawDiaryPhoto {
  file?: unknown;
  dataUrl?: unknown;
  thumb?: unknown;
  caption?: unknown;
}

/** Preberi vnose fotk iz JSON niza baze + LENA SELITEV legacy zapisov.
 *  Vrne fotke za odgovor (`withPhotos` → polne dataURL s diska, sicer
 *  samo sličice) in po potrebi novi JSON za zapis (selitev). */
export async function loadDiaryPhotos(
  json: string,
  dir: string,
  withPhotos: boolean,
): Promise<{ out: DiaryPhotoOut[]; migrated: string | null }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { out: [], migrated: null }; // pokvarjen JSON → kot brez fotk (isto kot doslej)
  }
  if (!Array.isArray(parsed)) return { out: [], migrated: null };

  const migrated: StoredDiaryPhoto[] = [];
  const out: DiaryPhotoOut[] = [];
  let needsMigration = false;

  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as RawDiaryPhoto;
    const thumb = typeof p.thumb === 'string' ? p.thumb : null;
    const caption = typeof p.caption === 'string' ? p.caption : null;

    // NOVA oblika: file na disku
    if (typeof p.file === 'string' && safeFileName(p.file) !== null) {
      const full = withPhotos ? await readPhotoAsDataUrlAsync(p.file, dir) ?? '' : '';
      migrated.push({ file: p.file, thumb, caption });
      // Isti odgovor kot doslej: privzeti seznam nosi SLIČICO v dataUrl
      // (klient pokaže, kar ima), ?photos=1 pa polno fotko.
      out.push({ dataUrl: withPhotos ? full : (thumb ?? ''), thumb, caption });
      continue;
    }

    // LEGATA: dataUrl v JSON → selitev na disk (idempotentna, brez
    // podvajanj: drugi obisk najde file namesto dataUrl).
    if (typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image/')) {
      const saved = await savePhoto(p.dataUrl, randomBytes(12).toString('hex'), dir);
      if (saved) {
        needsMigration = true;
        migrated.push({ file: saved.fileName, thumb: thumb ?? saved.thumb, caption });
        out.push({
          dataUrl: withPhotos ? p.dataUrl : (thumb ?? saved.thumb ?? ''),
          thumb: thumb ?? saved.thumb,
          caption,
        });
        continue;
      }
      // disk ne uspe → legacy fotka ostane v odgovoru, selitev ne gre
      migrated.push({ file: '', thumb, caption });
      out.push({ dataUrl: withPhotos ? p.dataUrl : (thumb ?? ''), thumb, caption });
      continue;
    }
    // pokvarjen vnos → izpuščen (isto pravilo kot doslej)
  }

  if (needsMigration) {
    // Za zapis samo zvesti zapisi (file ne sme biti prazen).
    const clean = migrated.filter((m) => m.file !== '');
    return { out, migrated: JSON.stringify(clean) };
  }
  return { out, migrated: null };
}

/** Zapiši selitev nazaj (najboljše prizadevanje — branje ne sme pasti). */
export async function persistDiaryMigration(id: string, photosJson: string): Promise<void> {
  await db.diaryEntry.update({ where: { id }, data: { photos: photosJson } }).catch(() => {});
}
