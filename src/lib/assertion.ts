// ─── Dve ločeni trditvi posnetka (FAZA-8: razcep merilne pogodbe) ───
//
// Dokler je bila zanesljivost meritve ena sama lestvica, je en izraz
// (`CALIBRATED`) hkrati trdil dve različni stvari: da poznamo geometrijo
// posnetka in da poznamo merilo v cm. Vsaka od njima ima svoja vrata, zato
// morata biti ločeni. Tu je besedišče teh dveh osi.
//
// Os `geo` ni natančnost. Je DOMENA VELJAVNOSTI: kolikšno ravnino slike
// lahko z nečim obdelamo. `ORIENTED < FITTED` ne pomeni „manj natančno",
// ampak „velja samo v smeri reference, ne za vse smeri".
//
// Os `met` je vprašanje, od kod pride centimeter: iz domneve, iz dejansko
// znane dolžine, ali pa sploh ne iz fotke.
//
// `MeasurementStatus` (measurement-status.ts) je IZGUBLJENA PROJEKCIJA tega
// para — to razmerje je tu zapisano kot funkcija `projectStatus`, ne kot
// zgodovinsko naključje.
//
// Modul je list: edini uvoz je `import type`, ki ga transpiler pobriše, zato
// ne more narediti cirkularnega uvoza. Nikoli ne uvaža camera-types /
// measure-geometry / homography.

import type { MeasurementStatus } from './measurement-status';

// ─── Osi ──────────────────────────────────────────────────────────

/** Geometrijska domena veljavnosti — od najšibkejše do najširše. */
export type GeometricAssurance =
  | 'UNDEFINED'   // o geometriji posnetka ne trdimo ničesar
  | 'SUGGESTED'   // štirikotnik samodejno najden, monter ga ni potrdil
  | 'ORIENTED'    // ena smer znanega merila (global px/cm iz ene dolžine)
  | 'FITTED'      // monterjeve 4 oglišče + homografija → vse smeri v ravnini
  | 'CONSISTENT'; // FITTED + neodvisna preverba (2. pogled / pravokotno razmerje)

/** Metrični izvor centimetra — od ničesar do dveh neodvisnih virov. */
export type MetricAssurance =
  | 'NONE'          // cm ni, samo razmerja
  | 'ASSUMED'       // merilo počiva na domnevi (domnevna dolžina ALI domnevni fokus)
  | 'REFERENCED'    // vnesena dejanska znana dolžina
  | 'MEASURED'      // trak / laser — neodvisno od fotke
  | 'CROSS_CHECKED'; // dva neodvisna vira se ujemata

export const GEOMETRY_ORDER: readonly GeometricAssurance[] = [
  'UNDEFINED', 'SUGGESTED', 'ORIENTED', 'FITTED', 'CONSISTENT',
];

export const METRIC_ORDER: readonly MetricAssurance[] = [
  'NONE', 'ASSUMED', 'REFERENCED', 'MEASURED', 'CROSS_CHECKED',
];

/** Rang geometrije (0 = najšibkejša domena). Neznana vrednost → −1. */
export function geometryRank(g: GeometricAssurance): number {
  return GEOMETRY_ORDER.indexOf(g);
}

/** Rang merila (0 = nič cm). Neznana vrednost → −1. */
export function metricRank(m: MetricAssurance): number {
  return METRIC_ORDER.indexOf(m);
}

export function geometryAtLeast(g: GeometricAssurance, min: GeometricAssurance): boolean {
  return geometryRank(g) >= geometryRank(min);
}

export function metricAtLeast(m: MetricAssurance, min: MetricAssurance): boolean {
  return metricRank(m) >= metricRank(min);
}

/** Najšibkejša geometrija na seznamu (undefined preskoči; prazen → null). */
export function worstGeometry(list: (GeometricAssurance | undefined)[]): GeometricAssurance | null {
  const present = list.filter((g): g is GeometricAssurance => g !== undefined);
  if (present.length === 0) return null;
  let worst: GeometricAssurance = present[0];
  for (const g of present) if (geometryRank(g) < geometryRank(worst)) worst = g;
  return worst;
}

/** Najšibkejše merilo na seznamu (undefined preskoči; prazen → null). */
export function worstMetric(list: (MetricAssurance | undefined)[]): MetricAssurance | null {
  const present = list.filter((m): m is MetricAssurance => m !== undefined);
  if (present.length === 0) return null;
  let worst: MetricAssurance = present[0];
  for (const m of present) if (metricRank(m) < metricRank(worst)) worst = m;
  return worst;
}

// ─── Projekcija na staro lestvico ────────────────────────────────

/**
 * `MeasurementStatus` je projekcija para `(geo, met)`. Izguba informacije je
 * točka vsega: `CALIBRATED` ne ve, ali mera velja za eno smer ali za celotno
 * ravnino, ker obe ravni geometrie (`ORIENTED`, `FITTED`) mapirata nanj.
 *
 * Veji sta urejeni po poštenosti, ne po lepem vrstnem redu:
 *
 *  1) `MEASURED` / `CROSS_CHECKED` imata PREDNOST. Vrednost ne izhaja iz
 *     fotke, zato je ne sme pogojenavati geometrijska domena — to je že
 *     danes veljavno pravilo (`validateScale` korak 2). Zato par
 *     `UNDEFINED + CROSS_CHECKED` NE pade na null.
 *  2) Vse ostalo je izpeljano iz slike, zato geometrija pogojenava:
 *     pod `ORIENTED` iz posnetka ni črpati nobene številke, `NONE` pa
 *     nima centimetra (BASELINE §6 pravilo 6).
 *
 * Prag veje 2) je `ORIENTED`, ne `FITTED`. Globalno merilo iz ene znane
 * dolžine je metrična trditev, ki drži brez umerjene ravnine — samo v eni
 * smeri. Dvig praga na `FITTED` bi tiho podrl obstoječo naročniško politiko.
 *
 * `CONFIRMED` je zunaj para (proizvodni postopek, ne lastnost posnetka).
 * `ESTIMATED` nikoli ni IZHOD projekcije („kalibracije ni" zdaj nosi null),
 * je pa še vedno vhod: živi v shranjenih zapisih.
 */
export function projectStatus(geo: GeometricAssurance, met: MetricAssurance): MeasurementStatus | null {
  if (met === 'MEASURED') return 'MANUAL';
  if (met === 'CROSS_CHECKED') return 'VERIFIED';
  if (geometryRank(geo) < geometryRank('ORIENTED')) return null;
  if (met === 'NONE') return null;
  if (met === 'ASSUMED') return 'AUTO_SUGGESTED';
  return 'CALIBRATED'; // REFERENCED
}

// ─── Vratni pogoji ────────────────────────────────────────────────

/** Geometrija, ki še dopušča izris montaže (rabi ravnino za perspektivo). */
export const MIN_GEOMETRY_FOR_RENDER: GeometricAssurance = 'FITTED';
/** Geometrija, ki še dopušča naročilnico (današnji pogoj za `CALIBRATED`). */
export const MIN_GEOMETRY_FOR_ORDER: GeometricAssurance = 'ORIENTED';
/** Merilo, ki še dopušča naročilnico (dejanska znana dolžina ali bolje). */
export const MIN_METRIC_FOR_ORDER: MetricAssurance = 'REFERENCED';

/**
 * Ali sme geometrija posnetka roditi sliko? NAMENJNO ne sprašuje po
 * centimetrih: montaža je geometrijska trditev. To, da izris desk potrebuje
 * eno samo dolžino, da prešteje deske, je zmožnost, ne dovoljenje — in se
 * reši tam, kjer manjka (glej FAZA-8 §3.4).
 */
export function canRenderMontage(geo: GeometricAssurance): boolean {
  return geometryAtLeast(geo, MIN_GEOMETRY_FOR_RENDER);
}

/**
 * Ali sme par roditi naročilnico? Geometrija je pogoj SAMO tam, kjer vrednost
 * izhaja iz slike: mera s trakom ali laserjem (`MEASURED`, `CROSS_CHECKED`)
 * je od posnetka neodvisna, zato ji umerjena ravnina ni mohla biti pogoj —
 * sicer bi vrata zahtevala fotko tam, kjer je številka merjena v naravi. To
 * je ista prednost veje 1) kot pri `projectStatus`.
 *
 * Tu je po konstrukciji poštena dvotapna montaža: štirikotnik da `FITTED`,
 * katalogsko izbrana višina pa samo `ASSUMED` — slika je izrisljiva,
 * naročilnice iz nje ni, brez dodatnega zaslona in brez opozorila, ki bi
 * ga moralo nekdo prebrati.
 */
export function canExportOrder(geo: GeometricAssurance, met: MetricAssurance): boolean {
  if (!metricAtLeast(met, MIN_METRIC_FOR_ORDER)) return false;
  if (metricRank(met) >= metricRank('MEASURED')) return true;
  return geometryAtLeast(geo, MIN_GEOMETRY_FOR_ORDER);
}

// ─── Besedišče za UI ──────────────────────────────────────────────

export function geometryLabel(g: GeometricAssurance): string {
  const LABELS: Record<GeometricAssurance, string> = {
    UNDEFINED: 'Brez geometrije',
    SUGGESTED: 'Predlagana geometrija',
    ORIENTED: 'Umerjena ena smer',
    FITTED: 'Umerjena ravnina',
    CONSISTENT: 'Preverjena geometrija',
  };
  return LABELS[g];
}

export function metricLabel(m: MetricAssurance): string {
  const LABELS: Record<MetricAssurance, string> = {
    NONE: 'Brez merila',
    ASSUMED: 'Domnevno merilo',
    REFERENCED: 'Merilo po znani dolžini',
    MEASURED: 'Izmerjeno s trakom ali laserjem',
    CROSS_CHECKED: 'Preverjeno z dvema viroma',
  };
  return LABELS[m];
}

/** Razlaga, ki pove, KAJ MANJKA na tej osi — ne splošnega strahu. */
export function geometryHint(g: GeometricAssurance): string {
  const HINTS: Record<GeometricAssurance, string> = {
    UNDEFINED: 'Geometrija posnetka ni znana — perspektiva ni korigirana in izris na fotko ni mogoč.',
    SUGGESTED: 'Štirikotnik je samodejno predlagan, monter ga ni potrdil. Potrdi ali popravi štiri oglišča.',
    ORIENTED: 'Merilo poznamo samo v smeri reference. V drugih smereh poševnega posnetka številke ne držijo in perspektiva ni korigirana — umeri ravnino po štirih ogliščih.',
    FITTED: 'Ravnina je umerjena po štirih ogliščih — geometrija velja za vse smeri v tej ravnini.',
    CONSISTENT: 'Geometrija je preverjena z neodvisnim drugim pogledom in velja za vse smeri v ravnini.',
  };
  return HINTS[g];
}

export function metricHint(m: MetricAssurance): string {
  const HINTS: Record<MetricAssurance, string> = {
    NONE: 'Na sliki ni nobene centimeterske trditve — izračunana so samo razmerja. Dolžine v cm iz nje ni mogoče dobiti.',
    ASSUMED: 'Merilo počiva na domnevi: domnevna referenčna dolžina ali ocenjen fokus kamere. Številka je orientacijska in nikoli potrjena mera.',
    REFERENCED: 'Merilo izhaja iz dejansko znane dolžine, ki jo je nekdo vnesel — ne iz domneve.',
    MEASURED: 'Vrednost je izmerjena s trakom ali laserjem in ne izhaja iz fotografije, zato geometrija posnetka nanjo ne vpliva.',
    CROSS_CHECKED: 'Dva neodvisna vira (npr. fotka in laser) se ujemata.',
  };
  return HINTS[m];
}

export type AssuranceColor = { badge: string; dot: string };

export function geometryColor(g: GeometricAssurance): AssuranceColor {
  const COLORS: Record<GeometricAssurance, AssuranceColor> = {
    UNDEFINED: { badge: 'bg-stone-100 text-stone-700 border-stone-300', dot: 'bg-stone-400' },
    SUGGESTED: { badge: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
    ORIENTED: { badge: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
    FITTED: { badge: 'bg-green-100 text-green-800 border-green-300', dot: 'bg-green-600' },
    CONSISTENT: { badge: 'bg-green-100 text-green-900 border-green-400', dot: 'bg-green-700' },
  };
  return COLORS[g];
}

export function metricColor(m: MetricAssurance): AssuranceColor {
  const COLORS: Record<MetricAssurance, AssuranceColor> = {
    NONE: { badge: 'bg-red-50 text-red-800 border-red-300', dot: 'bg-red-500' },
    ASSUMED: { badge: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
    REFERENCED: { badge: 'bg-green-100 text-green-800 border-green-300', dot: 'bg-green-600' },
    MEASURED: { badge: 'bg-stone-100 text-stone-800 border-stone-300', dot: 'bg-stone-500' },
    CROSS_CHECKED: { badge: 'bg-green-100 text-green-900 border-green-400', dot: 'bg-green-700' },
  };
  return COLORS[m];
}
