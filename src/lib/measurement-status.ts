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

/** Način kalibracije merila oz. izvora vrednosti. */
export type CalibrationMethod =
  | 'assumed-reference'   // domnevna referenca (npr. vrata ≈ 200 cm) — NIKOLI potrjena mera
  | 'known-length'        // uporabnik vnesel znano dolžino reference
  | 'manual-measure'      // ročna izmera (trak, laser)
  | 'laser'               // zunanji laserski merilnik
  | 'plane-homography';   // 4-točkovna ravninska kalibracija (homography.ts)

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
  /** Geometrijska transformacija, s katero je bila vrednost izračunana. */
  transform: 'global-px-per-cm' | 'plane-homography' | 'none';
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
  transform?: 'global-px-per-cm' | 'plane-homography' | 'none';
  createdAt: string;
  note?: string | null;
}

const METHODS: readonly CalibrationMethod[] = [
  'assumed-reference', 'known-length', 'manual-measure', 'laser', 'plane-homography',
];

/** Privzeta transformacija glede na metodo (nič tihega — izhaja iz metode). */
function defaultTransform(method: CalibrationMethod): MeasurementProvenance['transform'] {
  if (method === 'plane-homography') return 'plane-homography';
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
  code: 'OK' | 'NO_CALIBRATION' | 'ASSUMED_SCALE' | 'DEGENERATE_REFERENCE' | 'PLANE_REQUIRED';
  status: MeasurementStatus | null;
  message: string;
  nextStep: string;
}

/** Spodnja meja zanesljivega merila: 0,05 px/cm = referenca manj kot ~20 px na fotki. */
export const DEFAULT_MIN_PX_PER_CM = 0.05;
/** Zgornja meja zanesljivega merila (1 px na 2 µm — praktično napačna označba). */
export const MAX_PX_PER_CM = 5000;

/**
 * Validacija merila glede na metodo izvora. Nikoli NE vrne privzetega
 * merila: če kalibracija manjka, je odgovor eksplicitna napaka
 * NO_CALIBRATION. Ravninska kalibracija (4 oglišča) ima prednost pred
 * globalnim merilom in velja za vse smeri.
 */
export function validateScale(input: {
  pxPerCm?: number | null;
  method?: CalibrationMethod | null;
  planeCalibrated?: boolean;
  minPxPerCm?: number;
}): ScaleValidation {
  const ppm = input.pxPerCm;
  const hasScale = typeof ppm === 'number' && Number.isFinite(ppm) && ppm > 0;
  const plane = input.planeCalibrated === true;
  const min = input.minPxPerCm ?? DEFAULT_MIN_PX_PER_CM;

  // 1) Metoda zahteva ravnino, a ravnina ni umerjena → eksplicitna napaka.
  if (input.method === 'plane-homography' && !plane) {
    return {
      ok: false,
      code: 'PLANE_REQUIRED',
      status: null,
      message: 'NEZADOSTNI PODATKI: ravnina ni umerjena. Za korekcijo perspektive umeri ravnino po 4 ogliščih znane ravnine (stena, fasada, tla).',
      nextStep: 'Kalibriraj ravnino (4 oglišča)',
    };
  }

  // 2) Ročna izmera / laser — vrednost NE izhaja iz fotke, zato kalibracija
  //    (ali njena odsotnost) za to meritev ni relevantna.
  if (input.method === 'manual-measure' || input.method === 'laser') {
    return {
      ok: true,
      code: 'OK',
      status: 'MANUAL',
      message: input.method === 'laser'
        ? 'Izmera z zunanjim laserskim merilnikom — neodvisna od fotografije in kalibracije.'
        : 'Ročna izmera (trak/laser) — neodvisna od fotografije in kalibracije.',
      nextStep: 'Po potrebi preveri z neodvisno metodo (VERIFIED)',
    };
  }

  // 3) Ravninska kalibracija — velja za VSE smeri (single-view metrology).
  if (plane) {
    return {
      ok: true,
      code: 'OK',
      status: 'CALIBRATED',
      message: 'Ravnina je umerjena po 4 ogliščih — meritve na ravnini so korigirane za perspektivo in veljajo za vse smeri.',
      nextStep: 'Meri na umerjeni ravnini',
    };
  }

  // 4) Brez kalibracije → NIKOLI privzetega merila.
  if (!hasScale) {
    return {
      ok: false,
      code: 'NO_CALIBRATION',
      status: null,
      message: 'MERITEV NI NA VOLJO: kalibracija manjka. Vnesi znano dolžino referenčnega objekta (npr. vrata 200 cm) ali kalibriraj ravnino po 4 ogliščih.',
      nextStep: 'Umeri merilo',
    };
  }

  // 5) Degenerirana referenca (premajhna/prevelika na fotki).
  if (ppm! < min || ppm! > MAX_PX_PER_CM) {
    return {
      ok: false,
      code: 'DEGENERATE_REFERENCE',
      status: null,
      message: `NEZADOSTNI PODATKI: umerjeno merilo (${ppm!.toFixed(3)} px/cm) je izven zanesljivega razpona (${min}–${MAX_PX_PER_CM}). Referenčni objekt je na fotografiji preveč majhen ali je oznaka netočna — ponovi umerjanje z večjim znanim objektom (npr. vrata 200 cm).`,
      nextStep: 'Ponovi umerjanje z večjim objektom',
    };
  }

  // 6) Po metodi izvora.
  switch (input.method) {
    case 'assumed-reference':
      return {
        ok: true,
        code: 'ASSUMED_SCALE',
        status: 'AUTO_SUGGESTED',
        message: 'Samodejni predlog: merilo iz domnevne reference (npr. vrata ≈ 200 cm). Mera NI potrjena in pri poševnem posnetku eno merilo ne velja za vse smeri.',
        nextStep: 'Kalibriraj ravnino (4 oglišča)',
      };
    case 'plane-homography':
      // Ravnina bi morala biti zajeta v koraku 3; doseženo le pri
      // nedoslednem vnosu — tukaj je zato varen CALIBRATED izhod.
      return {
        ok: true,
        code: 'OK',
        status: 'CALIBRATED',
        message: 'Ravninska kalibracija (homografija) — meritve korigirane za perspektivo.',
        nextStep: 'Meri na umerjeni ravnini',
      };
    case 'known-length':
      return {
        ok: true,
        code: 'OK',
        status: 'CALIBRATED',
        message: 'Merilo kalibrirano po znani dolžini. Merilo velja za smer reference; pri poševnem posnetku lahko ostale smeri odstopajo — za natančnost kalibriraj ravnino.',
        nextStep: 'Kalibriraj ravnino (4 oglišča)',
      };
    default:
      // Merilo obstaja, izvor ni zabeležen (starejši zapisi brez sledljivosti).
      return {
        ok: true,
        code: 'OK',
        status: 'CALIBRATED',
        message: 'Merilo je umerjeno, izvor kalibracije pa ni zabeležen — za sledljivost ponovi umerjanje po znani dolžini.',
        nextStep: 'Ponovi umerjanje po znani dolžini',
      };
  }
}

// ─── Downgrade ob spremembi kalibracije ────────────────────────

/**
 * Če se referenca / kalibracijske točke / perspektiva spremenijo,
 * meritev ni več veljavna: CALIBRATED, VERIFIED in CONFIRMED padejo na
 * AUTO_SUGGESTED (ostanejo samo kot orientacijski predlog). Slabši
 * statusi ostanejo nespremenjeni.
 */
export function downgradeOnReferenceChange(
  prev: MeasurementStatus,
  referenceChanged: boolean,
): MeasurementStatus {
  if (!referenceChanged) return prev;
  if (statusRank(prev) >= statusRank('CALIBRATED')) return 'AUTO_SUGGESTED';
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
  }
}
