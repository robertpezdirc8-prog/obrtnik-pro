// ─── URADNI PODATKI O PRITRJEVANJU (roksal.com) ──────────────────────────
// Vse številke so DOBESEDNO iz ROKSALovih strani (prebrano 2026-10-19):
//   »Načini pritrjevanja« — roksal.com/woodcore-wpc-deske/nacini-pritrjevanja/
//   »WPC deske za pokončno ograjo« — …/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/
//
// TI podatki omogočajo, da render prikaže DEJANSKO konstrukcijo: vodoravne
// cevi (nosilci) na uradnem razmaku, vidne vijake na uradnem odmiku od roba
// reza in stebre na uradnem razmaku. Prej je bila ograja le barvni pas.

import type { RoksalProfileKind } from './roksal-span-rules';

export interface FasteningSpec {
  /** profil (družina) */
  kind: RoksalProfileKind;
  /** URADNO: največji razmak med vodoravnima cevema (nosilci) v cm */
  railSpacingCmMax: number;
  /** URADNO: največji razmak med stebri v cm (null = ni objavljeno) */
  postSpacingCmMax: number | null;
  /** največji razmak med stebri pri OGRADAH, VIŠJIH OD 150 cm (null = ni objavljeno) */
  postSpacingCmMaxHighFence: number | null;
  /** ali so vijaki vidni z lica */
  screwsVisible: boolean;
  /** najmanjši odmik vijaka od roba reza (cm) */
  screwEdgeMinCm: number;
  /** največji odmik vijaka od roba reza pri konstrukciji na plošči (balkon) */
  screwEdgeMaxCm: number;
  /** dobesedni citat o razmaku nosilcev */
  quote: string;
  /** dobesedni citat o stebrih */
  quotePosts: string;
  source: string;
}

const SOURCE_FASTENING = 'roksal.com/woodcore-wpc-deske/nacini-pritrjevanja/';
const SOURCE_VERTICAL = 'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/';

/** URADNI podatki po družini profilov (vse številke so citirane). */
export const FASTENING_SPECS: Record<string, FasteningSpec> = {
  'polna-57-32': {
    kind: 'polna-57-32',
    railSpacingCmMax: 100,
    postSpacingCmMax: 150,
    postSpacingCmMaxHighFence: null,
    screwsVisible: false,
    screwEdgeMinCm: 3,
    screwEdgeMaxCm: 15,
    quote: 'Maksimalni razmak med vodoravnima cevema je 100 cm .',
    quotePosts: 'Maksimalni razmak med stebrički je 150 cm ne glede na višino ograje.',
    source: `${SOURCE_FASTENING} · ${SOURCE_VERTICAL}`,
  },
  'polna-100': {
    kind: 'polna-100',
    railSpacingCmMax: 80,
    postSpacingCmMax: 180,
    postSpacingCmMaxHighFence: 150,
    screwsVisible: true,
    screwEdgeMinCm: 3,
    screwEdgeMaxCm: 15,
    quote: 'Maksimalni razmak med vodoravnima cevema je 80 cm .',
    quotePosts:
      'Maksimalni razmak med stebrički je 180 cm pri ograjah, ki so visoke do 150 cm višine. ' +
      'Pri višjih ograjah pa je maksimalni razmak med stebrički 150 cm.',
    source: `${SOURCE_FASTENING} · ${SOURCE_VERTICAL}`,
  },
  'polna-128': {
    kind: 'polna-128',
    railSpacingCmMax: 100,
    postSpacingCmMax: 180,
    postSpacingCmMaxHighFence: 150,
    screwsVisible: true,
    screwEdgeMinCm: 3,
    screwEdgeMaxCm: 15,
    quote: 'Maksimalni razmak med vodoravnima cevema je 100 cm .',
    quotePosts:
      'Maksimalni razmak med stebrički je 180 cm pri ograjah, ki so visoke do 150 cm višine. ' +
      'Pri višjih ograjah pa je maksimalni razmak med stebrički 150 cm.',
    source: `${SOURCE_FASTENING} · ${SOURCE_VERTICAL}`,
  },
  'romb-67': {
    kind: 'romb-67',
    railSpacingCmMax: 110,
    postSpacingCmMax: 145,
    postSpacingCmMaxHighFence: 145,
    screwsVisible: false,
    screwEdgeMinCm: 3,
    screwEdgeMaxCm: 15,
    quote: 'Maksimalni razmak med vodoravnima cevema je 110 cm .',
    quotePosts: 'Maksimalna razdalja med stebrički z L-kotniki je 145 cm je možna samo v primeru ko je kotnik na stebru levo in desno.',
    source: `${SOURCE_FASTENING} · ${SOURCE_VERTICAL}`,
  },
};

/** Odmik vijaka od roba reza — dobesedno z ROKSALove strani. */
export const SCREW_EDGE_QUOTE =
  'Minimalen odmik vijaka od roba reza je 3 cm. ' +
  'Pri konstrukciji montirani na ploščo (balkon, dvoriščna ograja) je maksimalen odmik vijaka od roba reza 15 cm.';

/** Spec za profil; null, če za to družino ni objavljenih podatkov. */
export function fasteningSpec(kind: RoksalProfileKind | null): FasteningSpec | null {
  if (!kind) return null;
  return FASTENING_SPECS[kind] ?? null;
}

/**
 * Največji dovoljeni razmak med stebri za to ograjo. Višina ograje vpliva
 * (nad 150 cm je meja strožja) — zato je parameter.
 */
export function maxPostSpacingCm(spec: FasteningSpec | null, fenceHeightCm: number | null): number | null {
  if (!spec) return null;
  if (spec.postSpacingCmMax === null) return null;
  if (spec.postSpacingCmMaxHighFence !== null && fenceHeightCm !== null && fenceHeightCm > 150) {
    return spec.postSpacingCmMaxHighFence;
  }
  return spec.postSpacingCmMax;
}
