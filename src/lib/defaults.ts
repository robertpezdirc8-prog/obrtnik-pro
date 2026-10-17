// ─── Privzete vrednosti kalkulatorjev (skupen vir) ──────────
// Uporabljajo jih komponente kalkulatorjev in projekt-godron
// (seštevek fotografij) — en sam vir resnice.
//
// TU NI CEN. `tilePricePerM2: 24` in `boardPricePerM: 12.5` sta bili doslej
// edini cene, ki ju je kalkulator vprašal kar kot mero — monter ju je videl
// predvpisani in je mislil, da so njegove. Od Task 88 naprej cena ni več
// meritev: je podatek Cenika, ki ga obrtnik vpiše sam, kalkulator pa izbere
// samo KAKOVOSTNI RAZRED (std / format / premium).

import type { CraftInputs } from './types';

export const CRAFT_INPUT_DEFAULTS: CraftInputs = {
  // Ograje
  length: 6, height: 1.1, material: 'alu', gates: 0,
  // Stopnice
  steps: 12, stepWidth: 1.1, stepMaterial: 'wpc', railingNeeded: true, totalRiseCm: 0,
  // Keramika
  floorLength: 4, floorWidth: 3, wallHeight: 0, tileGrade: 'std', reservePercent: 10, tilePattern: 'ravno',
  // WPC terasa — razmak nosilcev 0,33 m = SPODNJI rob ROKSALovega objavljenega
  // pasu za podložne letve terase (33–35 cm center, `roksal-span-rules`
  // `terasa-battens-33-35`). Prejšnji privzetek 0,4 m je bil ugiban in je že
  // sam sprožil lastno opozorilo »preširoko«.
  deckLength: 4, deckWidth: 3, joistSpacing: 0.33, boardGrade: 'klasicna', boardLengthM: 4, sideGapMm: 5, endGapMm: 4,
  // Okna/vrata
  windowCount: 3, windowSize: 2, windowMaterial: 'pvc', doorCount: 1, removeOld: true,
  // Nadstrešek
  canopyWidth: 5, canopyDepth: 3, canopyCover: 'ploc', canopyPosts: 2, waterDrain: true,
  // Fasada
  facadePerimeter: 36, facadeHeight: 2.8, openingsM2: 12, cladding: 'wpc',
};
