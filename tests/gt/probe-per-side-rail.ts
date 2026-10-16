/**
 * SONDA 2 od 4 — ali TRAPEŽ (ločeno izmerjen tirnici na levem in desnem delu
 * pasu) premaga dokumentirani pravokotnik? NE commita se v produkcijo; meri.
 * Ni del sweepa (rabi fotke — tests/gt/README.md).
 *
 * Zagon:  bun tests/gt/probe-per-side-rail.ts <mapa-s-fotkami> [maxSide=256]
 *
 * Zakaj sploh: izpisi sonde 1 kažeta DVE različni napaki, ki ju je treba
 * ločiti, sicer se rešuje napačna:
 *   (a) NAKLON — tirnica je pravilna na eni strani in zgrešena na drugi
 *       (04.jpg spodaj: L +0,8 % / D +8,3 % pri GT nagibu −3,2°). To bi trapež
 *       morebitni odpravil.
 *   (b) ZAMAKNJEN ZADETEK — iskanje stigne ob prvo vrstico s podporo, ki ni rob
 *       ploskve (04.jpg zgoraj: +10,1 % / +9,6 % pri 1 koraku). Tu trapež ne
 *       more pomagati.
 *
 * Odločilno vprašanje, na katerega sonda odgovori PRVA: ali DEJANSKI GT rob v
 * ozkem bočnem oknu sploh preseže prag podpore? Če ne, nobena differentna
 * strategija ustavljanja ali oblike ne more pomagati.
 *
 * IZMERJENO (2026-10-16, izpis v tests/gt/outputs/):
 *   V1 trapež: mediana 3,3 % proti 2,3 % pravokotnika → SLABŠE, zavrnjeno.
 *   GT rob v bočnem oknu pod pragom: 0,55 (04 levo), 0,77 (16 desno),
 *   0,71 (05 desno) — ožje okno ROB NI VIDLO, je pa vidno notranjo črto.
 */
import { extractFeatures } from '../../src/lib/cv-engine';
import { suggestBand, BAND_LIMITS, type BandSuggestion } from '../../src/lib/band-suggest';
import { GT_CASES, type GtCase } from './gt-quads';
import { header, loadRgba, maxSideFromArg, median, pct, f2 } from './harness';

const maxSide = maxSideFromArg();
header('probe-per-side-rail', maxSide);

const rails = (c: GtCase, W: number, H: number) => {
  const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
  const seg = (a: number, b: number) => {
    const [l, r] = p[a].x <= p[b].x ? [p[a], p[b]] : [p[b], p[a]];
    return { xl: l.x, xr: r.x, yl: l.y, yr: r.y, deg: (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI };
  };
  return { top: seg(0, 1), bottom: seg(3, 2), cx: (p[0].x + p[1].x + p[2].x + p[3].x) / 4, cy: (p[0].y + p[1].y + p[2].y + p[3].y) / 4 };
};

/** Podpora DEJANSKEGA GT roba v oknu [x0,x1] — pove, ali ga detektor vidi. */
const gtRailSupport = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, y: number): number => {
  const n = BAND_LIMITS.samples;
  let hits = 0;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    let found = false;
    for (let dy = -BAND_LIMITS.edgeTolerancePx; dy <= BAND_LIMITS.edgeTolerancePx && !found; dy++)
      for (let dx = -BAND_LIMITS.edgeTolerancePx; dx <= BAND_LIMITS.edgeTolerancePx && !found; dx++) {
        const xx = x + dx;
        const yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (edge[yy * W + xx]) found = true;
      }
    if (found) hits++;
  }
  return hits / (n + 1);
};

const search = (edge: Uint8Array, W: number, H: number, xc: number, half: number, yc: number): BandSuggestion | null =>
  suggestBand({ edge, W, H }, { x: xc, y: yc }, half);

const acc = { left: [] as number[], right: [] as number[] };
const push = (a: number[], v: number | undefined) => {
  if (v !== undefined && Number.isFinite(v)) a.push(Math.abs(v));
};

console.log(`prag podpore ${BAND_LIMITS.minSupport} | toleranca ${BAND_LIMITS.edgeTolerancePx} px`);
console.log('Bočno okno = 15 % širine ploskve, sredini pri 25 % in 75 % razteze.');

const v0Errs: number[] = [];
const v1Errs: number[] = [];
let v1Trapezoids = 0;
let v1Fallbacks = 0;

for (const c of GT_CASES) {
  const rgba = await loadRgba(c.file);
  const { W, H, edge } = extractFeatures(rgba, maxSide);
  const g = rails(c, W, H);
  const span = g.top.xr - g.top.xl;
  const half = Math.abs(span) * 0.3;
  const sideHalf = span * 0.15;
  const xl = g.top.xl + span * 0.25;
  const xr = g.top.xl + span * 0.75;

  const v0 = search(edge, W, H, g.cx, half, g.cy);
  const L = search(edge, W, H, xl, sideHalf, g.cy);
  const R = search(edge, W, H, xr, sideHalf, g.cy);

  const supW = gtRailSupport(edge, W, H, g.cx - half, g.cx + half, g.top.yl);
  const supL = gtRailSupport(edge, W, H, xl - sideHalf, xl + sideHalf, g.top.yl);
  const supR = gtRailSupport(edge, W, H, xr - sideHalf, xr + sideHalf, g.top.yr);

  console.log(`\n${c.inScope ? 'v obsegu' : 'IZVEN '} ${c.file.padEnd(22)} GT top ${pct(g.top.deg)}° bottom ${pct(g.bottom.deg)}°`);
  console.log(
    `  GT rob podporen?  celotno okno ${f2(supW)} | levo ${f2(supL)} | desno ${f2(supR)}` +
      `   (pod ${BAND_LIMITS.minSupport.toFixed(2)} = detektor ga NE vidi)`,
  );
  if (!v0) {
    console.log('  V0 pravokotnik: ZAVRNJEN (brez pasu) → trapež na tej fotki ni kaj definirati');
    continue;
  }
  const e0 = [
    ((v0.top.y - g.top.yl) / H) * 100,
    ((v0.bottom.y - g.bottom.yl) / H) * 100,
    ((v0.top.y - g.top.yr) / H) * 100,
    ((v0.bottom.y - g.bottom.yr) / H) * 100,
  ];
  for (const e of e0) push(v0Errs, e);
  console.log(
    `  V0 pravokotnik  L ${pct(e0[0])}/${pct(e0[1])}  D ${pct(e0[2])}/${pct(e0[3])}  (podpora ${f2(v0.top.support)}/${f2(v0.bottom.support)}, koraka ${v0.top.steps}/${v0.bottom.steps})`,
  );

  if (L && R) {
    v1Trapezoids++;
    const e1 = [
      ((L.top.y - g.top.yl) / H) * 100,
      ((L.bottom.y - g.bottom.yl) / H) * 100,
      ((R.top.y - g.top.yr) / H) * 100,
      ((R.bottom.y - g.bottom.yr) / H) * 100,
    ];
    push(acc.left, e1[0]);
    push(acc.left, e1[1]);
    push(acc.right, e1[2]);
    push(acc.right, e1[3]);
    for (const e of e1) push(v1Errs, e);
    const rel = e1.map((e, i) => (Math.abs(e) < Math.abs(e0[i]) ? 'boljše' : Math.abs(e) > Math.abs(e0[i]) ? 'SLABŠE' : 'enako'));
    console.log(
      `  V1 TRAPEZ       L ${pct(e1[0])}/${pct(e1[1])}  D ${pct(e1[2])}/${pct(e1[3])}  (podpora ${f2(L.top.support)}/${f2(L.bottom.support)} | ${f2(R.top.support)}/${f2(R.bottom.support)})  vs V0: ${rel.join(', ')}`,
    );
  } else {
    v1Fallbacks++;
    // Pošteno: kjer ena stran odpove, V1 pade NA V0 rezultat — coverage ostane
    // enak, a napaka na tistem oglišču ostane cena pravokotnika.
    push(acc.left, e0[0]);
    push(acc.left, e0[1]);
    push(acc.right, e0[2]);
    push(acc.right, e0[3]);
    for (const e of e0) push(v1Errs, e);
    console.log(`  V1 → PADEC NA V0 (levo ${L ? 'ok' : 'ni pasu'}, desno ${R ? 'ok' : 'ni pasu'}) — enako kot danes`);
  }
}

const fmt = (a: number[]) => (a.length ? `mediana ${median(a).toFixed(1)} %, max ${Math.max(...a).toFixed(1)} %, n=${a.length}` : 'prazno');
console.log('\n──────── Povzetek (prispevki v obsegu in izven, kot v sondi 1) ────────');
console.log(`V0 pravokotnik         ${fmt(v0Errs)}`);
console.log(`V1 trapež+kombinacija  ${fmt(v1Errs)}   (trapezov ${v1Trapezoids}, padcev ${v1Fallbacks})`);
console.log(`  V1 leva oglišča      ${fmt(acc.left)}`);
console.log(`  V1 desna oglišča     ${fmt(acc.right)}`);
console.log('\nODLOČITEV enaka kot pri nagibu: meritev se zavrne, če sta MEDIANA ali MAX');
console.log('slabša. Trapež, ki zgreši večje, je dražji od pravokotnika, ker ga mora');
console.log('monter popravljati na dveh točkah namesto na eni.');
