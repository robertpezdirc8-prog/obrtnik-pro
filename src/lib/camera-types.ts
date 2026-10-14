// ─── Tipi za pametno kamero (samodejna skriptna analiza) ────

import type { CraftId, CraftInputs } from './types';
// Statusna pogodba meritev (Task 36) — samo tipi, brez cirkularnega uvoza
// (measurement-status NE uvaža camera-types).
import type { CalibrationMethod, MeasurementStatus } from './measurement-status';

export const CRAFT_CATEGORIES = [
  'ograje',
  'stopnice',
  'keramika',
  'wpc-terasa',
  'okna-vrata',
  'nadstreški',
  'fasada',
  'drugo',
] as const;

export type CraftCategory = (typeof CRAFT_CATEGORIES)[number];

/** En zaznani objekt na fotografiji (z okvirjem v % slike). */
export interface DetectedObject {
  label: string;
  count: number;
  /** [x, y, width, height] v procentih slike (0–100) ali null */
  box: [number, number, number, number] | null;
  estWidthCm: number | null;
  estHeightCm: number | null;
  note?: string;
}

/** Referenčni objekt za umerjanje merila (npr. vrata ≈ 200 cm). */
export interface ReferenceObject {
  label: string;
  assumedCm: number;
  explanation: string;
}

/**
 * Predlog merila iz enega referenčnega objekta (Task 24).
 * Zanesljivost je deterministična ocena 0–100; soglasje pa pove,
 * kako se merila več kandidatov ujemajo.
 */
export interface ScaleSuggestion {
  id: string;
  kind: 'vrata' | 'okno';
  label: string;
  /** Okvir referenčnega objekta v % slike [x, y, w, h]. */
  box: [number, number, number, number];
  /** Predpostavljena višina objekta v cm (vrata 200, okno 120). */
  assumedCm: number;
  /** Merilo: naravnih pikslov slike na 1 cm (iz navpične stranice). */
  pxPerCm: number;
  /** Zanesljivost predloga 0–100. */
  confidence: number;
  /** Verdict zanesljivosti (visoka / srednja / nizka). */
  confidenceLabel: 'visoka' | 'srednja' | 'nizka';
  /** Širina okvirja pri tem merilu (cm) — prečni preverba. */
  impliedWidthCm: number;
  /** Ali prečni preverba pasti v pričakovani pas. */
  widthPlausible: boolean;
}

/** Soglasje meril med kandidati (razpršenost). */
export type ScaleAgreement = 'high' | 'medium' | 'low' | 'none';

/** Ravnina, ki jo je skripta zaznala (stena, tla, terasa…) z oglišči v %. */
export interface DetectedSurface {
  label: string;
  /** 4 oglišča v % slike (urnjeni po obodu) ali null */
  quad: [number, number][] | null;
  estAreaM2: number | null;
  note?: string;
}

/** Polna analiza fotografije – vrne jo /api/analyze-photo. */
export interface PhotoAnalysis {
  craft: CraftCategory;
  craftConfidence: number;
  sceneDescription: string;
  objects: DetectedObject[];
  reference: ReferenceObject | null;
  /** Okvir referenčnega objekta v % (za enoklikovno umerjanje). */
  referenceBox: [number, number, number, number] | null;
  /** Vsi predlogi merila (vrata + okna) z zanesljivostjo (Task 24). */
  scaleSuggestions: ScaleSuggestion[];
  /** Soglasje meril med kandidati (razpršenost / mediana). */
  scaleAgreement: ScaleAgreement;
  /** Zaznane ravnine (stene, tla…) — uporabne za perspektivno kalibracijo. */
  surfaces: DetectedSurface[];
  /** Materiali, ki jih je skripta zaznala (steklo, aluminij, keramika…). */
  materials: string[];
  /** Napake / tveganja na objektu (rja, vlaga, poškodbe…). */
  hazards: string[];
  /** Kaj bi delo obsegalo (1–2 povedi). */
  scope: string;
  estimatedAreaM2: number | null;
  measurementsNeeded: string[];
  condition: { score: number; notes: string };
  recommendations: string;
  /** Predpolnjene vrednosti za kalkulator (že preslikane na CraftInputs). */
  prefill: Partial<CraftInputs>;
}

export interface SuggestedProduct {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
}

export interface AnalyzeResponse {
  analysis: PhotoAnalysis;
  suggestedProducts: SuggestedProduct[];
}

/**
 * Zapolni privzete vrednosti za polja, ki jih starejše shranjene
 * analize (pred nadgradnjo) nimajo — prepreči crk UI-ja.
 */
export function normalizePhotoAnalysis(raw: unknown): PhotoAnalysis {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<PhotoAnalysis>;
  return {
    craft: a.craft ?? 'drugo',
    craftConfidence: typeof a.craftConfidence === 'number' ? a.craftConfidence : 50,
    sceneDescription: a.sceneDescription ?? 'Fotografija je bila analizirana.',
    objects: Array.isArray(a.objects) ? a.objects : [],
    reference: a.reference ?? null,
    referenceBox: a.referenceBox ?? null,
    scaleSuggestions: Array.isArray(a.scaleSuggestions) ? a.scaleSuggestions : [],
    scaleAgreement: a.scaleAgreement ?? 'none',
    surfaces: Array.isArray(a.surfaces) ? a.surfaces : [],
    materials: Array.isArray(a.materials) ? a.materials : [],
    hazards: Array.isArray(a.hazards) ? a.hazards : [],
    scope: a.scope ?? '',
    estimatedAreaM2: a.estimatedAreaM2 ?? null,
    measurementsNeeded: Array.isArray(a.measurementsNeeded) ? a.measurementsNeeded : [],
    condition: a.condition ?? { score: 60, notes: '' },
    recommendations: a.recommendations ?? '',
    prefill: (a.prefill ?? {}) as Partial<CraftInputs>,
  };
}

/** Vrsta meritve: daljica, površina, kot, veriga (naklon), laser, glas, pravi 3D AR (WebXR). */
export type MeasureKind = 'length' | 'area' | 'angle' | 'chain' | 'laser' | 'voice' | 'xr' | 'model3d';

/** Ena izmerjena vrednost (kalibrirano merilo ali vnos). */
export interface PhotoMeasure {
  id: string;
  label: string;
  kind: MeasureKind;
  /** Točke v % slike: daljica 2 · kot 3 (oglišče sredi) · površina N oglišč · veriga N točk vzdolž trase · laser/glas prazno. */
  points: [number, number][];
  /** dolžina/laser/glas/veriga: cm (veriga = skupni tek) · površina: m² · kot: stopinje */
  value: number | null;
  /** dolžine strani poligona v cm (površina) ali dolžine odsekov verige (chain) */
  sides?: number[];
  /** terenski dvig na odsek verige v cm, pozitivno = navzgor (chain) — profil za razpored stebrov */
  segmentsDrop?: number[];
  /** naklon verige (chain) v stopinjah — orientacijsko, iz fotke/ravnine */
  slopeDeg?: number;
  /** Status izvora meritve (Task 36) — opcijsko: starejši zapisi brez oznake ostanejo veljavni. */
  status?: MeasurementStatus;
  /** Način kalibracije oz. izvora vrednosti (Task 36) — opcijsko, kot status. */
  method?: CalibrationMethod;
}

/** Predpolnitev iz kamere za kalkulator. */
export interface CameraPrefill {
  craft: CraftId;
  inputs: Partial<CraftInputs>;
  photoTitle?: string;
}

export const CRAFT_LABELS: Record<CraftCategory, string> = {
  'ograje': 'Ograje',
  'stopnice': 'Stopnice',
  'keramika': 'Keramika',
  'wpc-terasa': 'WPC terasa',
  'okna-vrata': 'Okna in vrata',
  'nadstreški': 'Nadstreški',
  'fasada': 'Fasada',
  'drugo': 'Neopredeljeno',
};
