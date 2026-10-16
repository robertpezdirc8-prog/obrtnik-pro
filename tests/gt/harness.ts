/**
 * Skupna oprema za GT sonde (tests/gt/).
 *
 * GT sonde NISO del sweepa `tests/verify/` — potrebujejo fotokorpus, ki NAMENNO
 * NI v repozitoriju (fotke monterjevih izvedenih delih kažejo tuje hiše in
 * okolico; objava v repozitoriju je odločitev lastnika, ne teknica). Zato ta
 * oprema fotke vzame iz argumenta ali spremenljivke okolja in, če jih ni,
 * ZANNI z jasnim sporočilom.
 *
 * Pravilo, ki ga je leta 2026-10-16 plačalo z lažnim zelenim izhodom:
 * manjkajoč dokaz je NAPAKA, ne tiha ničla. Sonde zato ne vračajo praznega
 * seznama in ne nadaljujejo z delno mero.
 */
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const photosDirRaw = (): string => {
  const d = process.argv[2] ?? process.env.ROKSAL_GT_PHOTOS ?? '';
  if (!d) {
    console.error(
      '\nMANJKA FOTOKORPUS. Pot do map s fotkami je obvezna:\n' +
        '  bun tests/gt/<sonda>.ts <mapa-s-fotkami> [maxSide]\n' +
        'ali  ROKSAL_GT_PHOTOS=<mapa-s-fotkami> bun tests/gt/<sonda>.ts\n' +
        'Sonde brez fotk ne merijo ničesar in zato ne izpišejo ničesar.\n',
    );
    process.exit(2);
  }
  return d;
};

/** `file` v gt-quads.ts je zapisan kot v izvirni merivi ('../fb-hi/04.jpg#zgoraj');
 *  tu se imenuje samo datoteka, regijo pa nosi kvadrat sam. */
export const photoPath = (file: string): string => join(photosDirRaw(), basename(file.split('#')[0]));

export async function loadRgba(file: string): Promise<RgbaImageLite> {
  const p = photoPath(file);
  if (!existsSync(p)) {
    console.error(`\nFOTKA MANJKA: ${p}\nSonda ne more meriti brez nje — to ni napaka kode, je razlog, da ta mapa Ni v sweepu.\n`);
    process.exit(2);
  }
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(p).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

export interface RgbaImageLite {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const median = (a: number[]): number => (a.length === 0 ? NaN : a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]);

/** Podpisan odstotek (višina slike je enota vseh teh meritev). */
export const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
export const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '  — ');

/** Skupna glava izpisa, da je vseh pet izpisov med seboj primerljivih. */
export const header = (what: string, maxSide?: number): void => {
  console.log(`\n===== tests/gt/${what}${maxSide ? ` | maxSide ${maxSide}` : ''} =====`);
  console.log(`fotokorpus: ${photosDirRaw()}`);
};

/** argv[2] je mapa fotk, argv[3] delovna ločljivost (privzeto 256, izmerjeno
 *  optimalno — tests/gt/outputs/2026-10-16-sonda5-resolucija.txt). */
export const maxSideFromArg = (fallback = 256): number => {
  const n = Number(process.argv[3]);
  return Number.isFinite(n) && n > 8 ? n : fallback;
};

