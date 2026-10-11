// ─── Privzete vrednosti kalkulatorjev (skupen vir) ──────────
// Uporabljajo jih komponente kalkulatorjev in projekt-godron
// (seštevek fotografij) — en sam vir resnice.

import type { CraftInputs } from './types';

export const CRAFT_INPUT_DEFAULTS: CraftInputs = {
  // Ograje
  length: 6, height: 1.1, material: 'alu', gates: 0,
  // Stopnice
  steps: 12, stepWidth: 1.1, stepMaterial: 'wpc', railingNeeded: true,
  // Keramika
  floorLength: 4, floorWidth: 3, wallHeight: 0, tilePricePerM2: 24, reservePercent: 10,
  // WPC terasa
  deckLength: 4, deckWidth: 3, joistSpacing: 0.4, boardPricePerM: 12.5,
  // Okna/vrata
  windowCount: 3, windowSize: 2, windowMaterial: 'pvc', doorCount: 1, removeOld: true,
  // Nadstrešek
  canopyWidth: 5, canopyDepth: 3, canopyCover: 'ploc', canopyPosts: 2, waterDrain: true,
  // Fasada
  facadePerimeter: 36, facadeHeight: 2.8, openingsM2: 12, cladding: 'wpc',
};
