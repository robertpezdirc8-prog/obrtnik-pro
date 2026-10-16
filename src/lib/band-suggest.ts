// ─── Samodejni predlog namestitvenega pasu (FAZA-9) ──────────
//
// DOKUMENTIRANE ODLOČITVE (2026-10-16, meritve na ročno prebranem ground
// truthu 10 fotk Ograje Lozar — baseline/gt-quads.ts + probe-band-module.ts):
//
//  1. ŠTIRI robovi štirikotnika NISO enakovredni. Zgornji in spodnji rob
//     namesitvene ploskve sta v robnem zemljevidu resnična črta (podpora
//     0,83–1,00, iz tapke se najdeta znotraj ≤ 4 % višine slike v 8 od 10
//     meritev). Levi in desni rob pa nista rob predmeta: ograja se vodoravno
//     nadaljuje, njen "kot" v kadru je rob slike ali okluzija (podpora
//     0,16–1,00, iskanje zgreši v 4 od 5). Zato ta modul išče SAMO pas (dve
//     tirnici) — vodoravno raztezo določi monter z drugo tapko.
//
//  2. NAKLONA modul NE OCENJUJE. Tri variante (iskanje po nagibu, residualna
//     prefinitev ±8° s prostim radijem, ista z radijem 3 in pragom koristi) so
//     izmerjene proti ground truthu: mediana napake POLOŽAJA tirnice na
//     oglišču kvadrata je 2,3 % višine slike BREZ nagiba in 5,1–6,4 % Z NJEM.
//     Tirnice v obsegu imajo dejanski nagib 0–3°, pripeti nagib pa zgreši za
//     2,8–19,1° in vmes tudi NAPAČEN PREDZNAK (16.jpg: GT +1,2° → napoved
//     −2,5°). Napačen nagib se ekstrapolira do oglišča in uniči položaj, ki je
//     edino, kar homografija v tej fazi potrebuje. Nagib je informacija
//     monitorja (potrdi ali povleče oglišče), ne meritev.
//
//  3. Modul NE more sam sebe potrditi. Na fotkah izven obsega (odrezan rob,
//     stropna podoba, tla pod kotom, drogom prekrit pogled) je enako
//     samozavestno trdil napačno črto — npr. +37 % višine slike. Zato je
//     rezultat VEDNO samo predlog: `planeConfirmed: false` v
//     measurement-status.ts ga drži na stopnji SUGGESTED, izris pa ostane
//     zaprt, dokler ga človek ne potrdi.
//
//  4. Pokritost, izmerjena na korpusu: od 5 primerov V OBSEGU je pas najden v
//     3 (04 spodnja terasa, 16 delavnica, 05 fasada); pri 04#zgoraj in 15
//     ena od tirnic nima podpore → null. Null ni napaka, je pravilen izhod
//     "ne vem" in UI takrat ostane pri ročnem označevanju.
//
// Čiste funkcije, deterministično, brez AI in brez novih odvisnosti.

import { extractFeatures, type RgbaImage } from './cv-engine';

export interface BandPoint {
  x: number;
  y: number;
}

/** Najdena tirnica: položaj, podpora in koliko iskanja je bilo potrebnega. */
export interface BandRail {
  /** y tirnice (delovni piksli) */
  y: number;
  /** delež vzorcev vzdolž črte, ki imajo rob (0..1) */
  support: number;
  /** koliko korakov od tapke je bilo potrebnih */
  steps: number;
}

export interface BandSuggestion {
  top: BandRail;
  bottom: BandRail;
  /** polovična širina iskanega pasu v delovnih pikslih */
  halfWidth: number;
  /** višina pasu (delovni piksli) */
  heightPx: number;
}

export const BAND_LIMITS = {
  /** Najmanjša sprejeta podpora tirnice. 0,85 je izmerjen prag: pod njim
   *  detektor na pravih fotkah začne najati notranje spoje med lamelami. */
  minSupport: 0.85,
  /** Koliko sme iskati stran od tapke, kot delež višine slike. */
  maxSearchFrac: 0.45,
  /** Najmanjši smiseln pas: pod tem je verjetneje spoj kot ploskev. */
  minBandHeightFrac: 0.04,
  /** Največji smiseln pas: nad tem je tapka verjetno izven ploskve. */
  maxBandHeightFrac: 0.95,
  /** Toleranca pri preverjanju roba (delovni piksli). */
  edgeTolerancePx: 2,
  /** Število vzorcev vzdolž črte. */
  samples: 64,
} as const;

export type BandLimits = { [K in keyof typeof BAND_LIMITS]: number };

const hasEdge = (edge: Uint8Array, W: number, H: number, x: number, y: number, tol: number): boolean => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  for (let dy = -tol; dy <= tol; dy++) {
    const yy = yi + dy;
    if (yy < 0 || yy >= H) continue;
    const row = yy * W;
    for (let dx = -tol; dx <= tol; dx++) {
      const xx = xi + dx;
      if (xx < 0 || xx >= W) continue;
      if (edge[row + xx]) return true;
    }
  }
  return false;
};

/** Delež vzorcev na vodoravnici y med x0 in x1, ki imajo rob. */
const segmentSupport = (
  edge: Uint8Array,
  W: number,
  H: number,
  x0: number,
  x1: number,
  y: number,
  samples: number,
  tol: number,
): number => {
  let hits = 0;
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples;
    if (hasEdge(edge, W, H, x, y, tol)) hits++;
  }
  return hits / (samples + 1);
};

/**
 * Iz tapke znotraj ploskve poišči zgornji in spodnji rob.
 *
 * `halfWidth` je polovična širina iskanega pasu — monter jo dobi iz druge
 * tapke (razdalja med tapkama), privzeto pa je tretjina širine slike.
 *
 * Vrne null, kadar katerekoli tirnice ni mogoče najti z zadostno podporo,
 * kadar je najden pas nesmiselno majhen/velik, ali kadar tapka ni znotraj
 * delovne slike. Null je pomemben izhod: pomeni "ne vem", in UI mora takrat
 * ostati pri ročnem označevanju.
 */
export function suggestBand(
  input: { edge: Uint8Array; W: number; H: number },
  tap: BandPoint,
  halfWidth?: number,
  limits: BandLimits = { ...BAND_LIMITS },
): BandSuggestion | null {
  const { edge, W, H } = input;
  if (!(W > 8 && H > 8)) return null;
  if (!Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;
  if (tap.x < 0 || tap.x >= W || tap.y < 0 || tap.y >= H) return null;

  const half = Math.max(4, Math.min(W / 2, halfWidth ?? W / 3));
  const x0 = Math.max(0, tap.x - half);
  const x1 = Math.min(W - 1, tap.x + half);
  if (x1 - x0 < 4) return null;

  const maxSteps = Math.round(H * limits.maxSearchFrac);
  const tol = limits.edgeTolerancePx;

  const search = (dir: -1 | 1): BandRail | null => {
    const sup = (y: number) => segmentSupport(edge, W, H, x0, x1, y, limits.samples, tol);
    for (let step = 1; step <= maxSteps; step++) {
      const y = Math.round(tap.y + dir * step);
      if (y < 0 || y >= H) return null;
      if (sup(y) < limits.minSupport) continue;
      // Toleranca pri tipanju roba pomeni, da je PRVA vrstica, ki zadene,
      // zamaknjena od dejanske črte za toliko, kolikor je toleranca. Rob je na
      // SREDINI platoja vrstic z enako podporo — brez tega koraka bi bil vsak
      // predlog zamaknjen za ±tol px (izmerjeno: 22 namesto 20).
      let lo = y;
      let hi = y;
      const reach = tol + 2;
      while (lo - 1 >= 0 && lo > y - reach && sup(lo - 1) >= limits.minSupport) lo--;
      while (hi + 1 < H && hi < y + reach && sup(hi + 1) >= limits.minSupport) hi++;
      const center = Math.round((lo + hi) / 2);
      return { y: center, support: sup(center), steps: step };
    }
    return null;
  };

  const top = search(-1);
  const bottom = search(+1);
  if (!top || !bottom) return null;

  const heightPx = bottom.y - top.y;
  if (heightPx < H * limits.minBandHeightFrac) return null;
  if (heightPx > H * limits.maxBandHeightFrac) return null;

  return { top, bottom, halfWidth: (x1 - x0) / 2, heightPx };
}

/**
 * Pas + monitorjeva razteza (x levi, x desni) → štirikotnik v delovnih
 * pikslih, pripravljen za obstoječo homografijo. Pravokotnik, ne paralelogram:
 * modul nagiba ne ocenjuje (odločitev 2 zgoraj).
 */
export function bandToQuad(
  band: BandSuggestion,
  xLeft: number,
  xRight: number,
  W: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  const xl = Math.max(0, Math.min(W - 1, Math.min(xLeft, xRight)));
  const xr = Math.max(0, Math.min(W - 1, Math.max(xLeft, xRight)));
  return [
    [xl, band.top.y],
    [xr, band.top.y],
    [xr, band.bottom.y],
    [xl, band.bottom.y],
  ];
}

/**
 * Celotna pot za UI: slika + DVE tapki v ODDSTOTIH slike → predlagan
 * štirikotnik v odstotkih (isti konvenciji kot `quadPct` in `calibratePlane`).
 *
 * Monter tapne dvakrat ZNOTRAJ ploskve, levo in desno mejo. Iz razdalje med
 * tapkama dobi iskalno širino, iz njuni sredini y išče gor in dol. Razlog, da
 * je vhod v odstotkih: delovna ločljivost (`maxSide`) je interna podrobnost
 * detektorja in noben UI je ne sme poznati — mešanje enot je bil način, kako
 * so takšni predlogi nekoč zgrešili za fiksni number pikslov.
 */
export function suggestBandQuadPct(
  img: RgbaImage,
  tapA: { xPct: number; yPct: number },
  tapB: { xPct: number; yPct: number },
  limits: BandLimits = { ...BAND_LIMITS },
): { quadPct: [number, number][]; band: BandSuggestion; W: number; H: number } | null {
  if (![tapA.xPct, tapA.yPct, tapB.xPct, tapB.yPct].every((v) => Number.isFinite(v))) return null;
  const f = extractFeatures(img);
  const { W, H, edge } = f;
  const ax = (tapA.xPct / 100) * W;
  const ay = (tapA.yPct / 100) * H;
  const bx = (tapB.xPct / 100) * W;
  const by = (tapB.yPct / 100) * H;
  if (ax < 0 || ax >= W || ay < 0 || ay >= H || bx < 0 || bx >= W || by < 0 || by >= H) return null;
  const xLeft = Math.min(ax, bx);
  const xRight = Math.max(ax, bx);
  // Iskalna sredina = sredina med tapkama; polovična širina = njuna razdalja.
  const band = suggestBand({ edge, W, H }, { x: (xLeft + xRight) / 2, y: (ay + by) / 2 }, (xRight - xLeft) / 2, limits);
  if (!band) return null;
  const quad = bandToQuad(band, xLeft, xRight, W);
  return {
    quadPct: quad.map(([x, y]) => [(x / W) * 100, (y / H) * 100] as [number, number]),
    band,
    W,
    H,
  };
}
