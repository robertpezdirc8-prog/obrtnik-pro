// ─── ARCore Depth API prek WebXR depth-sensing — iskrena klasifikacija ───
// ARCore Depth API (glej developers.google.com/ar/develop/depth) da najbolj
// zanesljive globine v pasu ~0,5–5 m; zunaj pasu podatek obstaja, vendar je
// manj natančen. Tu NE popravljamo meritev (nikoli množimo s faktorji
// zaupanja, kot to počne True Scale — glej baseline §6) — samo iskreno
// povemo monterju, kako zanesljiv je podatek, ki ga vidi.

/** Optimalen pas globine ARCore Depth API (m) — glej raziskavo Task 46. */
export const DEPTH_OPTIMAL_MIN_M = 0.5;
/** Zgornja meja optimalnega pasu (m). */
export const DEPTH_OPTIMAL_MAX_M = 5;
/** Prag razlike hit-test točke in globine (m) nad katerim opozorimo. */
export const DEPTH_DISCREPANCY_WARN_M = 0.5;

export type DepthZone = 'too-close' | 'optimal' | 'far';
export type DepthTone = 'ok' | 'warn';

export interface DepthGuidance {
  zone: DepthZone;
  /** Izmerjena globina v metrih (že očiščena). */
  meters: number;
  /** Oblikovan prikaz sl-SI, npr. "2,34 m". */
  label: string;
  /** Kratek slovenski namig za monterja. */
  note: string;
  tone: DepthTone;
}

/** Oblikuj globino sl-SI (vejica, 2 decimalki), npr. 2.34 → "2,34 m". */
export function formatDepthM(m: number): string {
  return `${m.toFixed(2).replace('.', ',')} m`;
}

/**
 * Klasificiraj globino v iskren namig. Vrne null za neuporabne vrednosti
 * (null/NaN/∞/≤0) — klicatelj naj potem podatek sploh ne prikaže.
 */
export function classifyDepth(m: number | null | undefined): DepthGuidance | null {
  if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0) return null;
  const label = formatDepthM(m);
  if (m < DEPTH_OPTIMAL_MIN_M) {
    return {
      zone: 'too-close',
      meters: m,
      label,
      note: `Pod ${formatDepthM(DEPTH_OPTIMAL_MIN_M)} — najnatančneje od ${formatDepthM(DEPTH_OPTIMAL_MIN_M)} naprej.`,
      tone: 'warn',
    };
  }
  if (m > DEPTH_OPTIMAL_MAX_M) {
    return {
      zone: 'far',
      meters: m,
      label,
      note: `Nad ${formatDepthM(DEPTH_OPTIMAL_MAX_M)} — globina je manj natančna, zapri bližje ali uporabi laser.`,
      tone: 'warn',
    };
  }
  return {
    zone: 'optimal',
    meters: m,
    label,
    note: 'V optimalnem pasu (0,5–5 m) — globina zanesljiva.',
    tone: 'ok',
  };
}

/**
 * Razlika med razdaljo do hit-test točke in globino na sredini zaslona.
 * Vrne |razliko| v metrih ali null, če kateri podatek manjka — nikoli
 * ne tihajmo, ko se svetova ne skladata.
 */
export function depthDiscrepancyM(
  hitDistM: number | null | undefined,
  depthM: number | null | undefined,
): number | null {
  if (
    typeof hitDistM !== 'number' || !Number.isFinite(hitDistM) ||
    typeof depthM !== 'number' || !Number.isFinite(depthM)
  ) {
    return null;
  }
  return Math.abs(hitDistM - depthM);
}
