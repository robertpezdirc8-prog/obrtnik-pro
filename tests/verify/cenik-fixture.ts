// ─── Skupni cenik za testne skripte (Task 88) ───────────────
// Kalkulator ne pozna nobene cene. Test, ki hoče denar, mora cenik prinesiti
// sam. Vsak ključ dobi svojo vrednost, zato napačen pripet ključ takoj pade
// na vsoti. Sam ne preverja ničesar — samo podatki in pripenjanje.

import {
  CENIK_KEYS, applyCenik, readCenik, type CenikValues, type PriceKey,
} from '../../src/lib/cenik';
import type { CalcLine } from '../../src/lib/types';

/** Registriran vrstni red da ceno 1 €, 2 €, 3 € … nobena se ne ponovi. */
export function fixtureCenik(): CenikValues {
  const v = {} as Record<PriceKey, number>;
  CENIK_KEYS.forEach((k, i) => {
    v[k] = i + 1;
  });
  return v;
}

/** Količine dobijo ceno po isti poti kot aplikacija: applyCenik + readCenik. */
export function zCenikom(lines: readonly CalcLine[], values: CenikValues = fixtureCenik()): CalcLine[] {
  return applyCenik(lines, readCenik(values));
}

/** Cena pripeta na določen ključ, ali null, če vrstica ni v seznamu. */
export function cenaVrslice(lines: readonly CalcLine[], key: PriceKey): number | null {
  const l = lines.find((x) => x.priceKey === key);
  return l ? l.unitPrice : null;
}

/** Vsota brez DDV. Ena vrstica brez cene naredi CELOTNO vsoto NaN — ne delno. */
export function vsota(lines: readonly CalcLine[]): number {
  return lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? Number.NaN), 0);
}
