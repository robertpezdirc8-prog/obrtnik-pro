// ─── Stabilnost kadra: auto-zajem ob mirovanju ──────────────
// Deterministični skript (0 AI): dva zaporedna kadra video pretvorimo
// v majhno sivinsko sliko (64×48) in izračunamo povprečno absolutno
// razliko. Če je kadr dovolj dolgo MIRUJOČ (pod pragom, s histerezo),
// je pravi trenutek za oster posnetek — monter drži telefon z eno roko,
// tresenje je glavni vzrok zavrnjenih (zabrisanih) fotk.

/** Sivine 0–255 iz ImageData (rz: 0.299 R + 0.587 G + 0.114 B). */
export function grayFromImageData(data: Uint8ClampedArray): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

/** Povprečna absolutna razlika dveh sivinskih slik (0–255). */
export function meanAbsDiff(a: Float32Array | null, b: Float32Array): number {
  if (!a || a.length !== b.length) return 255; // brez predhodnika = gibanje
  let sum = 0;
  for (let i = 0; i < b.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / b.length;
}

export interface StabilityOptions {
  /** pod to povprečno razliko je kadr "stabilen" (0–255) */
  stableBelow?: number;
  /** nad to vrednostjo je kadr takoj "v gibanju" (histereza) */
  movingAbove?: number;
  /** št. zaporednih stabilnih vzorcev za potrditev (interval 250 ms → 5 = 1,25 s) */
  needFrames?: number;
}

export interface StabilityTracker {
  /** Vnesi nov diff → true, če je mirovanje zdaj potrjeno (sproži posnetek). */
  push(diff: number): boolean;
  /** Ali je kadr TRENUTNO stabilen (za indikator v živem predogledu). */
  readonly isStable: boolean;
  /** Koliko zaporednih stabilnih vzorcev je nabranih. */
  readonly streak: number;
  reset(): void;
}

/**
 * Histereza: pod `stableBelow` štejemo zaporedne stabilne vzorce,
 * nad `movingAbove` takoj izničimo. Pri `needFrames` zaporednih
 * vrne true ENKRAT (mreža se samodejno izniči, da ne sproži nenehno).
 */
export function makeStabilityTracker(opts: StabilityOptions = {}): StabilityTracker {
  const stableBelow = opts.stableBelow ?? 2.4;
  const movingAbove = opts.movingAbove ?? 4.2;
  const needFrames = opts.needFrames ?? 5;
  let streak = 0;
  let armed = true; // false tik po sprožitvi, dokler kadr ne "zamakne"
  return {
    push(diff: number): boolean {
      if (diff >= movingAbove) {
        streak = 0;
        armed = true;
        return false;
      }
      if (diff <= stableBelow) {
        streak += 1;
        if (armed && streak >= needFrames) {
          armed = false; // en posnetek na mirovanje
          return true;
        }
        return false;
      }
      // siva cona: ne šteje niti kot gibanje niti napredek
      return false;
    },
    get isStable(): boolean {
      return streak >= 2;
    },
    get streak(): number {
      return streak;
    },
    reset(): void {
      streak = 0;
      armed = true;
    },
  };
}
