// ─── Statusna pogodba meritev (ROKSAL Measurement Reliability, Faza 1+2) ──
// Samostojen modul: NIKOLI ne uvaža camera-types / measure-geometry /
// homography (preprečitev cirkularnih uvozov). Tu je enoten vir resnice za
// status meritve, metodo kalibracije in sledljivost (provenance).
//
// Osnovno pravilo pogodbe:
//  · Samodejni predlog (AUTO_SUGGESTED) NIKOLI ni potrjena mera.
//  · Manjkajoča oz. nevalidna kalibracija je EKSPPLICITNA napaka
//    (NO_CALIBRATION / DEGENERATE_REFERENCE), ne tiša zamenjava.
//  · Vsaka mera nosi izvor (provenance): skripta, metoda, status, točke,
//    referenca, transformacija.

import {
  projectStatus, geometryRank, metricRank,
  type GeometricAssurance, type MetricAssurance,
} from './assertion';

/** Verzija merilne skripte — gre v vsako provenance oznako. */
export const MEASUREMENT_SCRIPT_VERSION = '1.0.0';

/**
 * Status izvora meritve — od najslabše (groba ocena) do najboljše
 * (potrjena proizvodna mera). Urejanje je določeno s STATUS_ORDER.
 */
export type MeasurementStatus =
  | 'ESTIMATED'      // groba ocena brez reference
  | 'AUTO_SUGGESTED' // samodejni predlog skripte (npr. domnevna vrata 200 cm)
  | 'MANUAL'         // ročni vnos monterja (laser, tipkovnica, glas potrjen s klikom)
  | 'CALIBRATED'     // kalibrirano po znani referenci ALI ravninski homografiji
  | 'VERIFIED'       // preverjeno z neodvisno referenco (druga metoda / laserski merilnik)
  | 'CONFIRMED';     // potrjeno s postopkom za proizvodno mero

/**
 * Način kalibracije merila oz. izvora vrednosti.
 * 'multi-view' (Faza 3): triangulacija iz dveh fotk — merilo iz znane
 * referenčne dolžine v 3D, fokus pa iz EXIF/preset/ocenjen iz geometrije.
 */
export type CalibrationMethod =
  | 'assumed-reference'   // domnevna referenca (npr. vrata ≈ 200 cm) — NIKOLI potrjena mera
  | 'known-length'        // uporabnik vnesel znano dolžino reference
  | 'manual-measure'      // ročna izmera (trak, laser)
  | 'laser'               // zunanji laserski merilnik
  | 'plane-homography'    // 4-točkovna ravninska kalibracija (homography.ts)
  | 'multi-view';         // triangulacija iz dveh fotk (multiview-core.ts)

/** Enota izmerjene vrednosti. */
export type MeasureUnit = 'cm' | 'm2' | 'deg';

/** Sledljivost ene meritve — kdaj, kako in na čemu je bila izmerjena. */
export interface MeasurementProvenance {
  scriptVersion: string;
  method: CalibrationMethod;
  status: MeasurementStatus;
  valueCm: number | null;
  unit: MeasureUnit;
  sourcePhotoId: string | null;
  /** Točke v % slike. */
  points: { x: number; y: number }[];
  /** Referenca, po kateri je bilo merilo umerjeno (assumed = domnevna). */
  reference: { valueCm: number; label: string; assumed: boolean } | null;
  /** Geometrijska transformacija, s katero je bila vrednost izračunana.
   *  'multi-view-sfm' (Faza 5): inkrementalni SfM iz več kot 2 fotk
   *  (multiview-sfm.ts) — metoda ostane 'multi-view' (združljivost). */
  transform: 'global-px-per-cm' | 'plane-homography' | 'multi-view-triangulation' | 'multi-view-sfm' | 'none';
  /** ISO čas — podan od zunaj (funkcija ga NE generira sama, da je test determinističen). */
  createdAt: string;
  note: string | null;
}

/** Urejen seznam statusov (najslabši → najboljši). */
export const STATUS_ORDER: readonly MeasurementStatus[] = [
  'ESTIMATED',
  'AUTO_SUGGESTED',
  'MANUAL',
  'CALIBRATED',
  'VERIFIED',
  'CONFIRMED',
];

/** Rang statusa (0 = najslabši). Neznana vrednost → −1. */
export function statusRank(s: MeasurementStatus): number {
  return STATUS_ORDER.indexOf(s);
}

/**
 * Najslabši status na seznamu (undefined vnosi se preskočijo;
 * prazen seznam → null). Uporabno za agregat ("stanje celotne izmere").
 */
export function worstStatus(list: (MeasurementStatus | undefined)[]): MeasurementStatus | null {
  const present = list.filter((s): s is MeasurementStatus => s !== undefined);
  if (present.length === 0) return null;
  let worst: MeasurementStatus = present[0];
  for (const s of present) {
    if (statusRank(s) < statusRank(worst)) worst = s;
  }
  return worst;
}

/** Ali status doseže najmanjšo zahtevano raven? */
export function statusAtLeast(s: MeasurementStatus, min: MeasurementStatus): boolean {
  return statusRank(s) >= statusRank(min);
}

/** Slovenska kratka oznaka statusa (za značke in izvoze). */
export function statusLabel(s: MeasurementStatus): string {
  const LABELS: Record<MeasurementStatus, string> = {
    ESTIMATED: 'Ocena',
    AUTO_SUGGESTED: 'Samodejni predlog',
    MANUAL: 'Ročni vnos',
    CALIBRATED: 'Kalibrirano',
    VERIFIED: 'Preverjeno',
    CONFIRMED: 'Potrjeno',
  };
  return LABELS[s];
}

/** Kratka slovenska razlaga za monterja — kaj status pomeni in kaj manjka. */
export function statusHint(s: MeasurementStatus): string {
  const HINTS: Record<MeasurementStatus, string> = {
    ESTIMATED: 'Groba ocena brez kalibracije — pred naročilom obvezno izmeri s trakom ali laserjem.',
    AUTO_SUGGESTED: 'Samodejni predlog na podlagi domnevne reference — za potrjeno mero kalibriraj po znani dolžini.',
    MANUAL: 'Ročni vnos monterja (trak, laser ali glas) — neodvisen od kalibracije fotografije.',
    CALIBRATED: 'Izmerjeno po kalibrirani referenci oz. ravnini — pri poševnem posnetku uporabi ravninsko kalibracijo (4 oglišča).',
    VERIFIED: 'Preverjeno z neodvisno referenco (druga metoda ali laserski merilnik).',
    CONFIRMED: 'Potrjeno s postopkom za proizvodno mero — primerno za izdelavo.',
  };
  return HINTS[s];
}

/** Tailwind razredi za značko + piko (brez modro/indigo). */
export function statusColor(s: MeasurementStatus): { badge: string; dot: string } {
  const COLORS: Record<MeasurementStatus, { badge: string; dot: string }> = {
    ESTIMATED: { badge: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
    AUTO_SUGGESTED: { badge: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
    MANUAL: { badge: 'bg-stone-100 text-stone-800 border-stone-300', dot: 'bg-stone-500' },
    CALIBRATED: { badge: 'bg-green-100 text-green-800 border-green-300', dot: 'bg-green-600' },
    VERIFIED: { badge: 'bg-green-100 text-green-900 border-green-400', dot: 'bg-green-700' },
    CONFIRMED: { badge: 'bg-green-200 text-green-900 border-green-500', dot: 'bg-green-800' },
  };
  return COLORS[s];
}

// ─── makeProvenance — čist konstruktor z validacijo ────────────

/** Vhod za makeProvenance (vse razen verzije skripte, ki jo doda sama). */
export interface ProvenanceInput {
  method: CalibrationMethod;
  status: MeasurementStatus;
  valueCm: number | null;
  unit?: MeasureUnit;
  sourcePhotoId?: string | null;
  points?: { x: number; y: number }[];
  reference?: { valueCm: number; label: string; assumed: boolean } | null;
  transform?: 'global-px-per-cm' | 'plane-homography' | 'multi-view-triangulation' | 'multi-view-sfm' | 'none';
  createdAt: string;
  note?: string | null;
}

const METHODS: readonly CalibrationMethod[] = [
  'assumed-reference', 'known-length', 'manual-measure', 'laser', 'plane-homography', 'multi-view',
];

/** Znane geometrijske transformacije (Faza 5: + 'multi-view-sfm'). */
const TRANSFORMS: readonly string[] = [
  'global-px-per-cm', 'plane-homography', 'multi-view-triangulation', 'multi-view-sfm', 'none',
];

/** Privzeta transformacija glede na metodo (nič tihega — izhaja iz metode). */
function defaultTransform(method: CalibrationMethod): MeasurementProvenance['transform'] {
  if (method === 'plane-homography') return 'plane-homography';
  if (method === 'multi-view') return 'multi-view-triangulation';
  if (method === 'known-length' || method === 'assumed-reference') return 'global-px-per-cm';
  return 'none';
}

/**
 * Čist konstruktor sledljivosti meritve. NE generira časa (createdAt pride
 * od zunaj — deterministično). Vrže Error ob nevalidnem vnosu:
 *  · valueCm negativna / ne-končna,
 *  · neznana metoda / status / enota,
 *  · kršitev pogodbe: assumed-reference nikoli ni MANUAL in več,
 *  · nevalidna referenca (≤ 0) ali manjkajoč createdAt.
 */
export function makeProvenance(input: ProvenanceInput): MeasurementProvenance {
  if (!METHODS.includes(input.method)) {
    throw new Error(`Nevalidna metoda kalibracije: "${String(input.method)}"`);
  }
  if (statusRank(input.status) < 0) {
    throw new Error(`Nevaliden status meritve: "${String(input.status)}"`);
  }
  // Pogodba: meritve po domnevni referenci so vedno nesigurANE.
  if (input.method === 'assumed-reference' && statusRank(input.status) >= statusRank('MANUAL')) {
    throw new Error(
      'Pogodba kršena: meritev po domnevni referenci (assumed-reference) ne sme imeti statusa MANUAL, CALIBRATED, VERIFIED ali CONFIRMED.',
    );
  }
  if (input.valueCm !== null) {
    if (!Number.isFinite(input.valueCm)) {
      throw new Error('Nevalidna meritev: vrednost mora biti končno število (brez NaN/∞).');
    }
    if (input.valueCm < 0) {
      throw new Error('Nevalidna meritev: vrednost (valueCm) ne sme biti negativna.');
    }
  }
  const unit: MeasureUnit = input.unit ?? 'cm';
  if (unit !== 'cm' && unit !== 'm2' && unit !== 'deg') {
    throw new Error(`Nevalidna enota: "${String(unit)}" (dovoljeno: cm, m2, deg).`);
  }
  // Pogodba: transformacija mora biti znana (tudi 'multi-view-sfm', Faza 5).
  if (input.transform !== undefined && !TRANSFORMS.includes(input.transform)) {
    throw new Error(`Nevalidna transformacija: "${String(input.transform)}" (dovoljene: ${TRANSFORMS.join(', ')}).`);
  }
  if (typeof input.createdAt !== 'string' || input.createdAt.trim() === '' || Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error('Nevalidna meritev: createdAt mora biti veljaven ISO časovni žig.');
  }
  if (input.reference) {
    if (!Number.isFinite(input.reference.valueCm) || input.reference.valueCm <= 0) {
      throw new Error('Nevalidna referenca: vrednost reference mora biti pozitivno končno število.');
    }
    if (typeof input.reference.label !== 'string' || input.reference.label.trim() === '') {
      throw new Error('Nevalidna referenca: oznaka reference manjka.');
    }
  }
  for (const p of input.points ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('Nevalidna točka: koordinati morata biti končni števili.');
    }
  }

  return {
    scriptVersion: MEASUREMENT_SCRIPT_VERSION,
    method: input.method,
    status: input.status,
    valueCm: input.valueCm,
    unit,
    sourcePhotoId: input.sourcePhotoId ?? null,
    points: (input.points ?? []).map((p) => ({ x: p.x, y: p.y })),
    reference: input.reference
      ? { valueCm: input.reference.valueCm, label: input.reference.label, assumed: input.reference.assumed === true }
      : null,
    transform: input.transform ?? defaultTransform(input.method),
    createdAt: input.createdAt,
    note: input.note ?? null,
  };
}

// ─── Validacija merila (eksplicitne napake, brez tihih zamenjav) ──

export interface ScaleValidation {
  ok: boolean;
  /** Vsota obeh osi — istih 8 vrednosti kot pred razcepom, brez nove kode. */
  code: GeometryCode | MetricCode;
  status: MeasurementStatus | null;
  message: string;
  nextStep: string;
}

/** Spodnja meja zanesljivega merila: 0,05 px/cm = referenca manj kot ~20 px na fotki. */
export const DEFAULT_MIN_PX_PER_CM = 0.05;
/** Zgornja meja zanesljivega merila (1 px na 2 µm — praktično napačna označba). */
export const MAX_PX_PER_CM = 5000;

/** Najmanj zanesljivih RANSAC povezav (inlierjev) med dvema fotkama za triangulacijo (Faza 3). */
export const MIN_MULTIVIEW_INLIERS = 12;
/** Največja dovoljena srednja Sampsonova residuala (px) čez vse pare za zanesljivo geometrijo. */
export const MAX_MULTIVIEW_RESIDUAL_PX = 3;

/**
 * Skupni vhod obeh osevnih validacij (in `validateScale`, ki ju sestavi).
 * `planeCalibrated` pomeni umerjeno ravnino po štirih ogliščih; `pxPerCm` je
 * globalno merilo; `method` pove, od kod je vrednost.
 */
export interface ScaleValidationInput {
  pxPerCm?: number | null;
  method?: CalibrationMethod | null;
  planeCalibrated?: boolean;
  /**
   * Je štirikotnik potrdil človek? `false` = samodejni predlog (FAZA-9), ki
   * še NIMA domene veljavnosti: geometrija pade na `SUGGESTED` in izris
   * ostane zaprt. `undefined` je NAMENJENO enako `true` — vsi obstoječi
   * vnosi (90 merilnih + 391 fotomontažnih trditev) opisujejo ročno
   * označena oglišča, zato se njihovo obnašanje ne sme spremeniti.
   */
  planeConfirmed?: boolean;
  minPxPerCm?: number;
}

/** Koda, ki jo sme napovedati GEOMETRIJSKA os. */
export type GeometryCode =
  | 'OK' | 'PLANE_REQUIRED' | 'MULTIVIEW_DEGENERATE' | 'RESIDUAL_HIGH' | 'SFM_REPROJECTION_HIGH';

/** Koda, ki jo sme napovedati METRIČNA os. */
export type MetricCode =
  | 'OK' | 'NO_CALIBRATION' | 'ASSUMED_SCALE' | 'DEGENERATE_REFERENCE';

/** Rezultat validacije GEOMETRIJSKE domene veljavnosti. */
export interface GeometryValidation {
  assurance: GeometricAssurance;
  /** Eksplicitna napaka te osi. `PLANE_REQUIRED` živi SAMO tukaj. */
  code: GeometryCode;
  message: string;
  nextStep: string;
}

/** Rezultat validacije METRIČNEga izvora centimetra. */
export interface MetricValidation {
  assurance: MetricAssurance;
  /** `DEGENERATE_REFERENCE` in `NO_CALIBRATION` živita SAMO tukaj. */
  code: MetricCode;
  message: string;
  nextStep: string;
}

/**
 * Katero DOMENO veljavnosti posnetka imamo? Samo geometrija: umerjena ravnina
 * > ena smer znanega merila > nič. Merilo, njegova domneva in njegova
 * kakovost spadajo na `validateMetric` — tu nimata besede.
 */
export function validateGeometry(input: ScaleValidationInput): GeometryValidation {
  const ppm = input.pxPerCm;
  const hasScale = typeof ppm === 'number' && Number.isFinite(ppm) && ppm > 0;
  if (input.planeCalibrated === true) {
    if (input.planeConfirmed === false) {
      return {
        assurance: 'SUGGESTED',
        code: 'OK',
        message: 'Štirikotnik je samodejno predlagan iz fotke in ga monter še ni potrdil. Perspektiva zato NI dokazana in izris montaže ni dovoljen — nobena mera se ne sme opreti nanjo.',
        nextStep: 'Potrdi ali popravi štiri oglišča',
      };
    }
    return {
      assurance: 'FITTED',
      code: 'OK',
      message: 'Ravnina je umerjena po 4 ogliščih — meritve na ravnini so korigirane za perspektivo in veljajo za vse smeri.',
      nextStep: 'Meri na umerjeni ravnini',
    };
  }
  if (input.method === 'plane-homography') {
    return {
      assurance: 'UNDEFINED',
      code: 'PLANE_REQUIRED',
      message: 'NEZADOSTNI PODATKI: ravnina ni umerjena. Za korekcijo perspektive umeri ravnino po 4 ogliščih znane ravnine (stena, fasada, tla).',
      nextStep: 'Kalibriraj ravnino (4 oglišča)',
    };
  }
  if (hasScale) {
    return {
      assurance: 'ORIENTED',
      code: 'OK',
      message: 'Poznamo eno smer merila (global px/cm); perspektiva ni korigirana, zato v drugih smereh številke ne držijo.',
      nextStep: 'Kalibriraj ravnino (4 oglišča)',
    };
  }
  return {
    assurance: 'UNDEFINED',
    code: 'OK',
    message: 'Geometrija posnetka ni umerjena.',
    nextStep: 'Umeri merilo',
  };
}

/**
 * Od kod pride centimeter? Iz domneve, iz dejansko znane dolžine, ali pa sploh
 * ne iz fotke (trak/laser — tedaj geometrija posnetka ni relevantna).
 *
 * Vrstni red je pogojen z dolžansko pogodbo: ročna izmera ima prednost pred
 * vsem, nato domnevna referenca (umerjena ravnina je NE dvigne — FAZA-8
 * §3.2.1), nato šele prisotnost in pas merila.
 */
export function validateMetric(input: ScaleValidationInput): MetricValidation {
  const ppm = input.pxPerCm;
  const hasScale = typeof ppm === 'number' && Number.isFinite(ppm) && ppm > 0;
  const plane = input.planeCalibrated === true;
  const min = input.minPxPerCm ?? DEFAULT_MIN_PX_PER_CM;

  // 1) Vrednost NE izhaja iz fotke — kalibracija (ali njena odsotnost) za to
  //    meritev ni relevantna.
  if (input.method === 'manual-measure' || input.method === 'laser') {
    return {
      assurance: 'MEASURED',
      code: 'OK',
      message: input.method === 'laser'
        ? 'Izmera z zunanjim laserskim merilnikom — neodvisna od fotografije in kalibracije.'
        : 'Ročna izmera (trak/laser) — neodvisna od fotografije in kalibracije.',
      nextStep: 'Po potrebi preveri z neodvisno metodo (VERIFIED)',
    };
  }

  // 2) Domnevna referenca ostane domneva, tudi če je ravnina umerjena —
  //    umerjena geometrija ne dvigne metrične domneve (FAZA-8 §3.2.1).
  if (input.method === 'assumed-reference') {
    if (hasScale && (ppm! < min || ppm! > MAX_PX_PER_CM)) return degenerate(ppm!, min);
    if (!hasScale && !plane) {
      return { assurance: 'NONE', code: 'NO_CALIBRATION', message: NO_SCALE_MESSAGE, nextStep: 'Umeri merilo' };
    }
    return {
      assurance: 'ASSUMED',
      code: 'ASSUMED_SCALE',
      message: 'Samodejni predlog: merilo iz domnevne reference (npr. vrata ≈ 200 cm). Mera NI potrjena in pri poševnem posnetku eno merilo ne velja za vse smeri.',
      nextStep: 'Kalibriraj ravnino (4 oglišča)',
    };
  }

  // 3) Umerjena ravnina pomeni, da sta širina in višina ravnine vneseni —
  //    merilo torej izvira iz dejansko znane dolžine, ne iz domneve.
  if (plane) {
    return {
      assurance: 'REFERENCED',
      code: 'OK',
      message: 'Merilo izhaja iz dimenzij umerjene ravnine.',
      nextStep: 'Meri na umerjeni ravnini',
    };
  }

  // 4) Brez merila → NIKOLI privzetega merila.
  if (!hasScale) {
    return { assurance: 'NONE', code: 'NO_CALIBRATION', message: NO_SCALE_MESSAGE, nextStep: 'Umeri merilo' };
  }

  // 5) Degenerirana referenca (premajhna/prevelika na fotki).
  if (ppm! < min || ppm! > MAX_PX_PER_CM) return degenerate(ppm!, min);

  // 6) Dejansko znana dolžina ALI njezen izvor (starejši zapisi).
  return input.method === 'known-length'
    ? {
        assurance: 'REFERENCED',
        code: 'OK',
        message: 'Merilo kalibrirano po znani dolžini. Merilo velja za smer reference; pri poševnem posnetku lahko ostale smeri odstopajo — za natančnost kalibriraj ravnino.',
        nextStep: 'Kalibriraj ravnino (4 oglišča)',
      }
    : {
        assurance: 'REFERENCED',
        code: 'OK',
        message: 'Merilo je umerjeno, izvor kalibracije pa ni zabeležen — za sledljivost ponovi umerjanje po znani dolžini.',
        nextStep: 'Ponovi umerjanje po znani dolžini',
      };
}

const NO_SCALE_MESSAGE = 'MERITEV NI NA VOLJO: kalibracija manjka. Vnesi znano dolžino referenčnega objekta (npr. vrata 200 cm) ali kalibriraj ravnino po 4 ogliščih.';

function degenerate(ppm: number, min: number): MetricValidation {
  return {
    assurance: 'NONE',
    code: 'DEGENERATE_REFERENCE',
    message: `NEZADOSTNI PODATKI: umerjeno merilo (${ppm.toFixed(3)} px/cm) je izven zanesljivega razpona (${min}–${MAX_PX_PER_CM}). Referenčni objekt je na fotografiji preveč majhen ali je oznaka netočna — ponovi umerjanje z večjim znanim objektom (npr. vrata 200 cm).`,
    nextStep: 'Ponovi umerjanje z večjim objektom',
  };
}

/**
 * Sestavi obe osi v staro enoletno pogodbo. Vrstni red sporočil je današnji:
 * geometrijska napaka > metrična napaka/domneva > ročna izmera > ravnina >
 * smer reference. `status` je `projectStatus` para, ne več izvirna trditev.
 *
 * NIKOLI ne vrne privzetega merila: če kalibracija manjka, je odgovor
 * eksplicitna napaka NO_CALIBRATION.
 */
export function validateScale(input: ScaleValidationInput): ScaleValidation {
  const geo = validateGeometry(input);
  const met = validateMetric(input);

  if (geo.code === 'PLANE_REQUIRED') {
    return { ok: false, code: 'PLANE_REQUIRED', status: null, message: geo.message, nextStep: geo.nextStep };
  }
  if (met.code === 'NO_CALIBRATION' || met.code === 'DEGENERATE_REFERENCE') {
    return { ok: false, code: met.code, status: null, message: met.message, nextStep: met.nextStep };
  }
  const status = projectStatus(geo.assurance, met.assurance);
  if (met.code === 'ASSUMED_SCALE') {
    return { ok: true, code: 'ASSUMED_SCALE', status, message: met.message, nextStep: met.nextStep };
  }
  if (met.assurance === 'MEASURED') {
    return { ok: true, code: 'OK', status, message: met.message, nextStep: met.nextStep };
  }
  //REFERENCED: ravnina pove svojo domeno, sicer merilo pove svojo.
  return geo.assurance === 'FITTED'
    ? { ok: true, code: 'OK', status, message: geo.message, nextStep: geo.nextStep }
    : { ok: true, code: 'OK', status, message: met.message, nextStep: met.nextStep };
}

// ─── Validacija geometrije iz dveh fotk (Faza 3: multi-view) ───

/**
 * Validacija rezultata merjenja iz para fotk (multiview-core.measureFromPair):
 * zanesljivost geometrije (inlierji, residuala), nato merilo (referenca) in
 * na koncu izvor fokusa. Nikoli NE prerazredi šibke geometrije v mero —
 * vsak primanjkljaj je eksplicitna koda z naslednjim korakom.
 *
 * Razcep (FAZA-8 §3.3): geometrijo para določata inlierjev in residuala;
 * `referenceKnown` in `focalMode` določata, od kod je cm. Fokus je tu NAMESTO
 * na geometrijski osi, ker pri triangulaciji goriščna razdalja neposredno
 * določa, kako se razmerje pretvori v centimetre — številka v cm torej počiva
 * na domnevi enako kot domnevna dolžina reference. Posledica: 292 multi-view
 * trditev (multiview 104 + chain 66 + sfm 122) ostane zelenih dobesedno.
 */
export function validateMultiView(input: MultiViewGeometryInput & MultiViewMetricInput): ScaleValidation {
  const geo = validateMultiViewGeometry(input);
  if (geo.code !== 'OK') {
    return { ok: false, code: geo.code, status: null, message: geo.message, nextStep: geo.nextStep };
  }
  const met = validateMultiViewMetric(input);
  if (met.code === 'NO_CALIBRATION') {
    return { ok: false, code: 'NO_CALIBRATION', status: null, message: met.message, nextStep: met.nextStep };
  }
  return {
    ok: true,
    code: met.code === 'ASSUMED_SCALE' ? 'ASSUMED_SCALE' : 'OK',
    status: projectStatus(geo.assurance, met.assurance),
    message: met.message,
    nextStep: met.nextStep,
  };
}

/** Vhod geometrijske validacije para fotk. */
export interface MultiViewGeometryInput {
  inlierCount: number;
  meanResidualPx: number;
  minInliers?: number;
  maxResidualPx?: number;
}

/** Vhod metrične validacije para fotk. */
export interface MultiViewMetricInput {
  focalMode: 'known' | 'preset' | 'selfcal';
  referenceKnown: boolean;
}

/** Ali par fotk sploh DOLAČA geometrijo? (pragova 12 inlierjev in 3 px ostajata) */
export function validateMultiViewGeometry(input: MultiViewGeometryInput): GeometryValidation {
  const min = input.minInliers ?? MIN_MULTIVIEW_INLIERS;
  const max = input.maxResidualPx ?? MAX_MULTIVIEW_RESIDUAL_PX;
  if (input.inlierCount < min) {
    return {
      assurance: 'UNDEFINED',
      code: 'MULTIVIEW_DEGENERATE',
      message: `NEZADOSTNI PODATKI: premalo zanesljivih povezav med fotkama (< ${min}). Ponovi posnetek z večjim prekrivanjem in večjim kotom.`,
      nextStep: 'Posnemi par fotk z večjim prekrivanjem',
    };
  }
  if (input.meanResidualPx > max) {
    return {
      assurance: 'UNDEFINED',
      code: 'RESIDUAL_HIGH',
      message: `NEZADOSTNI PODATKI: povezave med fotkama so preveč raztresene (srednja residuala ${input.meanResidualPx.toFixed(1).replace('.', ',')} px > ${max}). Geometrija ni zanesljiva.`,
      nextStep: 'Ponovi označbo povezav ali posnemi nove fotke',
    };
  }
  // Drugi pogled JE neodvisna preverba prvega — tu je CONSISTENT, ne FITTED.
  return {
    assurance: 'CONSISTENT',
    code: 'OK',
    message: 'Geometrija para fotk je preverjena z drugim pogledom (inlierji in residuala v pragu).',
    nextStep: 'Izmeri na preverjeni geometriji',
  };
}

/** Od kod je cm pri merjenju iz dveh fotk? */
export function validateMultiViewMetric(input: MultiViewMetricInput): MetricValidation {
  if (!input.referenceKnown) {
    return {
      assurance: 'NONE',
      code: 'NO_CALIBRATION',
      message: 'MERITEV NI NA VOLJO v cm: manjka znana referenčna dolžina med označenima točkama — izračunana so samo razmerja.',
      nextStep: 'Označi znani odsek (npr. vrata 80 cm)',
    };
  }
  if (input.focalMode === 'preset' || input.focalMode === 'selfcal') {
    return {
      assurance: 'ASSUMED',
      code: 'ASSUMED_SCALE',
      message: 'Fokus kamere je ocenjen (preset/iz fotk), merilo pa iz znane reference — mera je orientacijska, za proizvodno uporabi EXIF fokus ali laserski merilnik.',
      nextStep: 'Preveri mero s trakom/laserjem',
    };
  }
  return {
    assurance: 'REFERENCED',
    code: 'OK',
    message: 'Izmerjeno s triangulacijo iz dveh fotk (znani fokus + znana referenčna dolžina).',
    nextStep: 'Po potrebi preveri z neodvisno metodo (VERIFIED)',
  };
}

// ─── Validacija geometrije iz več fotk (Faza 5: SfM) ───────

/**
 * Validacija rezultata inkrementalnega SfM (multiview-sfm.runSfm): enaka
 * pogodbena oblika kot validateMultiView. CALIBRATED samo, kadar je fokus
 * znan (EXIF), obstaja merilo (znana referenčna dolžina), reprojekcijska
 * napaka je ≤ 3 px in je vsaka registrirana fotka dovolj podprta s 3D
 * točkami; preset/selfcal fokus → AUTO_SUGGESTED; vsak primanjkljaj je
 * eksplicitna koda s slovensko razlago. NIKOLI ne prerazredi šibke
 * geometrije v mero.
 *
 * Razcep (FAZA-8 §3.3): `registeredCount` / `minPerImageInliers` /
 * `reprojRmsPx` in `focalSource`-ova geometrijska posledica (ŠTEVILO fotk,
 * RMS) grejo na os geometrije, `hasScale` in domneven fokus na os merila.
 * Pragovi (12 inlierjev, 3 px) ostanejo identični.
 */
export interface SfmGeometryInput {
  registeredCount: number;
  totalImages: number;
  minPerImageInliers: number;
  reprojRmsPx: number;
  warnings: string[];
  minInliers?: number;
  maxResidualPx?: number;
}

/** Vhod metrične validacije SfM. `registeredCount`/`totalImages` sta SAMO za
 *  razlago — odločata `hasScale` in `focalSource`. */
export interface SfmMetricInput {
  focalSource: 'known' | 'preset' | 'selfcal';
  hasScale: boolean;
  registeredCount: number;
  totalImages: number;
}

export function validateSfm(input: SfmGeometryInput & SfmMetricInput): ScaleValidation {
  const geo = validateSfmGeometry(input);
  if (geo.code !== 'OK') {
    return { ok: false, code: geo.code, status: null, message: geo.message, nextStep: geo.nextStep };
  }
  const met = validateSfmMetric(input);
  if (met.code === 'NO_CALIBRATION') {
    return { ok: false, code: 'NO_CALIBRATION', status: null, message: met.message, nextStep: met.nextStep };
  }
  if (met.code === 'ASSUMED_SCALE') {
    return { ok: true, code: 'ASSUMED_SCALE', status: projectStatus(geo.assurance, met.assurance), message: met.message, nextStep: met.nextStep };
  }
  // Oboje znano: razlaga mora povedati OBOJE, zato jo sestavi ovojnica.
  return {
    ok: true,
    code: 'OK',
    status: projectStatus(geo.assurance, met.assurance),
    message: `Izmerjeno z inkrementalnim SfM iz ${input.registeredCount} fotk (znani fokus + znana referenčna dolžina, RMS ${input.reprojRmsPx.toFixed(1).replace('.', ',')} px${input.warnings.length > 0 ? `, ${input.warnings.length} opozoril` : ''}).`,
    nextStep: 'Po potrebi preveri z neodvisno metodo (VERIFIED)',
  };
}

/** Ali je rekonstrukcija iz več fotk sploh Določljiva? */
export function validateSfmGeometry(input: SfmGeometryInput): GeometryValidation {
  const min = input.minInliers ?? MIN_MULTIVIEW_INLIERS;
  const max = input.maxResidualPx ?? MAX_MULTIVIEW_RESIDUAL_PX;
  if (!Number.isFinite(input.registeredCount) || input.registeredCount < 2) {
    return {
      assurance: 'UNDEFINED',
      code: 'MULTIVIEW_DEGENERATE',
      message: `NEZADOSTNI PODATKI: registriranih je samo ${input.registeredCount} fotk (potrebnih ≥ 2) — 3D rekonstrukcija ni izvedljiva. Posnemi fotke z večjim prekrivanjem.`,
      nextStep: 'Posnemi fotke z večjim prekrivanjem',
    };
  }
  if (input.minPerImageInliers < min) {
    return {
      assurance: 'UNDEFINED',
      code: 'MULTIVIEW_DEGENERATE',
      message: `NEZADOSTNI PODATKI: najslabše podprta registrirana fotka ima samo ${input.minPerImageInliers} 3D točk (potrebnih ≥ ${min}) — geometrija ni zanesljiva. Posnemi fotke z večjim prekrivanjem, da se isti objekt vidi na več posnetkih.`,
      nextStep: 'Posnemi fotke z večjim prekrivanjem',
    };
  }
  if (input.reprojRmsPx > max) {
    return {
      assurance: 'UNDEFINED',
      code: 'SFM_REPROJECTION_HIGH',
      message: `NEZADOSTNI PODATKI: reprojekcijska napaka rekonstrukcije je prevelika (${input.reprojRmsPx.toFixed(1).replace('.', ',')} px > ${max} px) — 3D točke se ne vrnejo na svoje položaje na fotkah. Geometrija ni zanesljiva.`,
      nextStep: 'Ponovi posnetek (ostro, fiksni zoom, več prekrivanja)',
    };
  }
  return {
    assurance: 'CONSISTENT',
    code: 'OK',
    message: `Rekonstrukcija je skladna sama s seboj (${input.registeredCount}/${input.totalImages} fotk registriranih).`,
    nextStep: 'Izmeri na preverjeni geometriji',
  };
}

/** Od kod je cm pri rekonstrukciji iz več fotk? */
export function validateSfmMetric(input: SfmMetricInput): MetricValidation {
  if (!input.hasScale) {
    return {
      assurance: 'NONE',
      code: 'NO_CALIBRATION',
      message: `MERITEV NI NA VOLJO v cm: SfM je registriral ${input.registeredCount}/${input.totalImages} fotk, a manjka znana referenčna dolžina — izračunana so samo razmerja med 3D točkami.`,
      nextStep: 'Označi znani odsek (npr. vrata 80 cm) na eni od registriranih fotk',
    };
  }
  if (input.focalSource === 'preset' || input.focalSource === 'selfcal') {
    return {
      assurance: 'ASSUMED',
      code: 'ASSUMED_SCALE',
      message: `SfM iz ${input.registeredCount} fotk z ocenjenim fokusom (${input.focalSource === 'preset' ? 'preset' : 'samokalibracija'}) in merilom iz znane reference — mera je orientacijska, za proizvodno uporabi EXIF fokus ali laserski merilnik.`,
      nextStep: 'Preveri mero s trakom/laserjem',
    };
  }
  return {
    assurance: 'REFERENCED',
    code: 'OK',
    message: 'Merilo iz znane referenčne dolžine na rekonstrukciji z znanim fokusom.',
    nextStep: 'Po potrebi preveri z neodvisno metodo (VERIFIED)',
  };
}

// ─── Downgrade ob spremembi kalibracije ────────────────────────

/**
 * Če se referenca / kalibracijske točke / perspektiva spremenijo,
 * meritev ni več veljavna: CALIBRATED, VERIFIED in CONFIRMED padejo na
 * AUTO_SUGGESTED (ostanejo samo kot orientacijski predlog). Slabši
 * statusi ostanejo nespremenjeni.
 *
 * TA FUNKCIJA JE PROJEKCIJSKI OVOJ — deluje na izgubljenem statusu, zato ne
 * more vedeti, katera od dveh osi je bila prizadeta, in razveljavi tudi
 * lasersko mero. Nova klica naj uporabi `downgradeMetricOnReferenceChange`
 * in `downgradeGeometryOnQuadChange` (D4, FAZA-8 §3.3).
 */
export function downgradeOnReferenceChange(
  prev: MeasurementStatus,
  referenceChanged: boolean,
): MeasurementStatus {
  if (!referenceChanged) return prev;
  if (statusRank(prev) >= statusRank('CALIBRATED')) return 'AUTO_SUGGESTED';
  return prev;
}

/**
 * Sprememba referenčne dolžine razveljavi SAMO merilo in samo tistega, ki
 * iz fotke izhaja: REFERENCED pade na ASSUMED (še vedno vemo, kje je bila
 * noga, le števka ni več potrjena). CROSS_CHECKED pade na MEASURED —
 * preverba med dvema viri razpade, neodvisna izmera sama ostane.
 * MEASURED / ASSUMED / NONE se ne dotakne: trak in laser od reference
 * neodvisita, domneva pa je že bila domneva. Geometrija (umerjena ravnina)
 * se z novim centimetrom ne premakne — nje ta funkcija NE sme braniti.
 */
export function downgradeMetricOnReferenceChange(
  prev: MetricAssurance,
  referenceChanged: boolean,
): MetricAssurance {
  if (!referenceChanged) return prev;
  if (prev === 'REFERENCED') return 'ASSUMED';
  if (prev === 'CROSS_CHECKED') return 'MEASURED';
  return prev;
}

/**
 * Sprememba štirikotnika razveljavi SAMO geometrijo. Ročna izmera (trak,
 * laser) je od posnetka neodvisna, zato je nova oznaka oglišč ne sme
 * dotakniti. FITTED in CONSISTENT padeta na SUGGESTED (nov predlog,
 * nepotrjen); UNDEFINED in SUGGESTED ostaneta.
 */
export function downgradeGeometryOnQuadChange(
  prev: GeometricAssurance,
  quadChanged: boolean,
): GeometricAssurance {
  if (!quadChanged) return prev;
  if (geometryRank(prev) >= geometryRank('FITTED')) return 'SUGGESTED';
  return prev;
}

/** Ali meritev še potrebuje potrditev monterja? (groba ocena / samodejni predlog) */
export function measurementNeedsConfirmation(status: MeasurementStatus): boolean {
  return status === 'ESTIMATED' || status === 'AUTO_SUGGESTED';
}

/** Slovenska razlaga opozorila: kaj manjka, zakaj mera ni varna, kaj ponovno izmeriti. */
export function explainWarning(code: ScaleValidation['code']): string {
  switch (code) {
    case 'OK':
      return 'Merilo je veljavno — mera je sledljiva in varna za uporabo.';
    case 'NO_CALIBRATION':
      return 'Kalibracija popolnoma manjka, zato iz fotke NI mogoče izračunati nobene dolžine (pikseli nimajo fizičnega pomena). Privzetega merila ni dovoljeno uporabiti. Ponovno izmeri: umeri merilo na znani dolžini (npr. vrata 200 cm, ploščica 60 cm) ali umeri ravnino po 4 ogliščih.';
    case 'ASSUMED_SCALE':
      return 'Merilo izhaja iz DOMNEVNE reference (npr. "vrata so približno 200 cm"), ki ni bila dejansko izmerjena. Mera je samo orientacijska in nikoli potrjena: če je vrata drugačna (285 cm poševna, niša, podboj), je vsota merila za nekaj procentov — in pri poševnem posnetku napaka raste s kotom. Ponovno izmeri: vnesi dejansko dolžino referenčnega objekta (trak/laser) ali umeri ravnino po 4 ogliščih.';
    case 'DEGENERATE_REFERENCE':
      return 'Referenčni objekt je na fotografiji preveč majhen (manj kot ~20 pikslov) ali je izračunano merilo nenavadno veliko — vsaka napaka označbe se pomnoži v mero, zato je rezultat nezanesljiv. Ponovno izmeri: umerjanje ponovi z večjim znanim objektom (npr. vrata 200 cm namesto kartice) in preveri, da točki ležita na robovih objekta.';
    case 'PLANE_REQUIRED':
      return 'Za to meritev je obvezna ravninska kalibracija (homografija po 4 ogliščih): enotno merilo ne zadošča, ker merjenja potekajo po različnih smereh poševnega posnetka. Ponovno izmeri: klikni 4 oglišča znane ravnine in vnesi realno širino ter višino.';
    case 'MULTIVIEW_DEGENERATE':
      return 'Triangulacija iz dveh fotk ni uspela: RANSAC je našel preveč malo zanesljivih povezav (inlierjev) med fotkama, zato 3D geometrija ni določljiva — brez stabilnega para fotk NI mogoče izračunati nobene globine in vsaka številka bi bila izmišljena. Najpogostejši vzroki: premalo prekrivanja med fotkama, premajhen kot med posnetkoma (fotki skoraj iz istega mesta), mehka fotka ali ponavljajoči se vzorec (rešetke, letve), ki se ujema na napačnih mestih. Ponovno izmeri: posnemi par fotk z večjim prekrivanjem (vsaj 60 % skupnega pogleda) in večjim kotom med posnetkoma, tako da so iste točke ostro vidne na obeh fotkah.';
    case 'RESIDUAL_HIGH':
      return 'Povezave med fotkama so preveč raztresene: točke ne ležijo na svojih epipolarnih črtah (srednja residuala presega dovoljenih 3 px), kar pomeni, da se geometrija med fotkama ne sklada. Takšna geometrija da naključne 3D točke — mera iz nje NI zanesljiva in je ne izračunaj. Najpogostejši vzroki: napačno označene povezave (klik na napačno točko), objekt se je premaknil med posnetkoma, mehka/razmazana fotka ali zoom/ostrenje se je spremenilo med posnetkoma. Ponovno izmeri: ponovi označbo povezav ali posnemi nove fotke (ostro, brez premikanja objekta, fiksni zoom).';
    case 'SFM_REPROJECTION_HIGH':
      return 'Rekonstrukcija iz več fotk se ne sklada sama s seboj: 3D točke se pri projekciji nazaj na fotke ne vrnejo na svoje položaje (reprojekcijska napaka presega dovoljenih 3 px), zato so izračunane dolžine nezanesljive in jih NE uporabi. Najpogostejši vzroki: mehke/razmazane fotke, spremenjen zoom med posnetki, premalo prekrivanja med fotkami ali ponavljajoča se tekstura (rešetke, letve), ki ujemanja povezuje na napačnih mestih. Ponovno izmeri: posnemi fotke znova — ostro, s fiksnim zoomom, z večjim prekrivanjem (isti objekt na vsaj 3 fotkah) in z izrazito neperiodično teksturo.';
  }
}
