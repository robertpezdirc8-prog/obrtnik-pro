// ─── Tipi za pametno kamero (AI analiza fotografije) ────────

import type { CraftId, CraftInputs } from './types';

export const AI_CRAFTS = [
  'ograje',
  'stopnice',
  'keramika',
  'wpc-terasa',
  'okna-vrata',
  'nadstreški',
  'fasada',
  'drugo',
] as const;

export type AICraft = (typeof AI_CRAFTS)[number];

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

/** Polna AI analiza fotografije – vrne jo /api/analyze-photo. */
export interface PhotoAnalysis {
  craft: AICraft;
  craftConfidence: number;
  sceneDescription: string;
  objects: DetectedObject[];
  reference: ReferenceObject | null;
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

/** Vrsta meritve: daljica, površina, kot, laserski izmer, glasovni vnos. */
export type MeasureKind = 'length' | 'area' | 'angle' | 'laser' | 'voice';

/** Ena izmerjena vrednost (kalibrirano merilo ali vnos). */
export interface PhotoMeasure {
  id: string;
  label: string;
  kind: MeasureKind;
  /** Točke v % slike: daljica 2 · kot 3 (oglišče sredi) · površina N oglišč · laser/glas prazno. */
  points: [number, number][];
  /** dolžina/laser/glas: cm · površina: m² · kot: stopinje */
  value: number | null;
  /** dolžine strani poligona v cm (samo površina) */
  sides?: number[];
}

/** Predpolnitev iz kamere za kalkulator. */
export interface CameraPrefill {
  craft: CraftId;
  inputs: Partial<CraftInputs>;
  photoTitle?: string;
}

export const CRAFT_LABELS: Record<AICraft, string> = {
  'ograje': 'Ograje',
  'stopnice': 'Stopnice',
  'keramika': 'Keramika',
  'wpc-terasa': 'WPC terasa',
  'okna-vrata': 'Okna in vrata',
  'nadstreški': 'Nadstreški',
  'fasada': 'Fasada',
  'drugo': 'Neopredeljeno',
};
