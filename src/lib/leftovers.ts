// ─── Sklad ostankov — deterministično povezovanje ───────────
// Monterji ostanke profilov/desk vozijo po kombiju in jih pozabijo.
// Ta skripta iz skladišča ostankov (localStorage) poišče, katere
// zahtevane kose rezalnega načrta jih pokrije (best-fit), koliko
// nabave se prihrani in kaj ostane v skladišču.

export interface LeftoverItem {
  id: string;
  craft: string;
  /** Dolžina ostanka v metrih. */
  lengthM: number;
  label: string;
  createdAt: string;
}

export interface LeftoverMatch {
  /** Koliko zahtevanih kosov skladišče pokrije. */
  covered: number;
  /** Skupno št. zahtevanih kosov. */
  total: number;
  /** Prihranek v lm nove nabave. */
  savedLM: number;
  /** "Ostanek 2,4 m → kos 2,3 m". */
  details: string[];
  /** Preostale dolžine v skladišču po dodelitvi. */
  remainingM: number[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Best-fit dodelitev: zahtevane kose uredi padajoče, vsakega
 *  spravi v NAJMANJŠI ostanek, ki ga še poboje (da velike
 *  ostanejo za velike kose). Deterministično.
 *  Pool lahko vsebuje ponovitve (isti kos večkrat). */
export function matchLeftovers(piecesM: number[], poolM: number[]): LeftoverMatch {
  const pool = poolM.filter((p) => p > 0.001).sort((a, b) => a - b); // naraščajoče
  const pieces = piecesM.filter((p) => p > 0.001).sort((a, b) => b - a); // padajoče
  const used = new Set<number>();
  const details: string[] = [];
  let covered = 0;
  let savedLM = 0;

  for (const piece of pieces) {
    // Najmanjši neuporabljen ostanek, ki pokrije kos
    let bestIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      if (pool[i] >= piece - 0.0005) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      covered += 1;
      savedLM += piece;
      details.push(`ostanek ${pool[bestIdx].toFixed(2).replace('.', ',')} m → kos ${piece.toFixed(2).replace('.', ',')} m`);
    }
  }

  return {
    covered,
    total: pieces.length,
    savedLM: r2(savedLM),
    details,
    remainingM: pool.filter((_, i) => !used.has(i)).map(r2),
  };
}

/** Natanko zaokroži za prikaz: "2,4 m". */
export function fmtLen(n: number): string {
  return `${n.toFixed(2).replace('.', ',')} m`;
}
