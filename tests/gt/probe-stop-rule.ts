/**
 * SONDA 3 od 4 — cena PRAVILA USTAVLJANJA iskanja tirnice. Meri, ne spreminja.
 * Ni del sweepa (rabi fotke — tests/gt/README.md).
 *
 * Zagon:  bun tests/gt/probe-stop-rule.ts <mapa-s-fotkami> [maxSide=256]
 *
 * Največja enotna napaka dokumentiranega predloga NI nagib: 04.jpg zgoraj
 * zgreši +10,1 % / +9,6 % pri GT nagibu 0,2°. To je ZAMAKNJEN ZADETEK —
 * iskanje se ustavi ob PRVI vrstici, ki preseže prag podpore, ta pa je notranja
 * črta panela in ne rob ploskve (podpora 0,92 pri 1 koraku).
 *
 * Sonda menja SAMO pravilo ustavljanja; vzorčenje roba je identično končnemu
 * modulu (ista toleranca, isto število vzorcev, isti centrej platoja):
 *   V0 prvi zadetek       — trenutno, v produkciji
 *   V2 zunanji zadetek    — najdlje od tapke, ki še preseže prag
 *   V3 najboljša podpora  — globalni maksimum podpore v smeri iskanja
 *
 * KLJUČNI DEL — kontrola na koncu izpisa: differentna V0 mora vrnil ENAKE
 * tirnice kot produkcijski `suggestBand`. Brez te kontrole bi primerjava
 * merila differentno, ne kode. (Prvi poskus te sonde je imel V2 pokvarjen tako,
 * da je vrnil prvi zadetek — izpis je bil identičen V0 in bi to ugledno
 * poročilo "zunanji zadetek ne spremeni ničesar" izdalo kot dokaz. Zadetek je
 * bil odkrit zato, ker je bil izpis PREVEČ enak; pravilo ustavljanja zdaj
 * ločeno shrani `last` in ga vrne.)
 *
 * IZMERJENO (2026-10-16): V0 v obsegu mediana 4,7 % / max 10,1 %;
 * V2 8,0 % / 24,3 % z dvema hudima napakama; V3 4,6 % / 24,3 % z eno hudo.
 * Oba nova pravila padeta na MAX, ne na mediani — torej obe zavrnjeni.
 */
import { extractFeatures } from '../../src/lib/cv-engine';
import { BAND_LIMITS, suggestBand, type BandLimits, type BandSuggestion } from '../../src/lib/band-suggest';
import { GT_CASES, type GtCase } from './gt-quads';
import { header, loadRgba, maxSideFromArg, median, pct } from './harness';

const maxSide = maxSideFromArg();
header('probe-stop-rule', maxSide);

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

const segSupport = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, y: number, lim: BandLimits): number => {
  let hits = 0;
  for (let i = 0; i <= lim.samples; i++) {
    const x = x0 + ((x1 - x0) * i) / lim.samples;
    if (hasEdge(edge, W, H, x, y, lim.edgeTolerancePx)) hits++;
  }
  return hits / (lim.samples + 1);
};

const plateauCentre = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, y: number, lim: BandLimits): number => {
  let lo = y;
  let hi = y;
  const reach = lim.edgeTolerancePx + 2;
  const sup = (yy: number) => segSupport(edge, W, H, x0, x1, yy, lim);
  while (lo - 1 >= 0 && lo > y - reach && sup(lo - 1) >= lim.minSupport) lo--;
  while (hi + 1 < H && hi < y + reach && sup(hi + 1) >= lim.minSupport) hi++;
  return Math.round((lo + hi) / 2);
};

type Mode = 'first' | 'outermost' | 'best';
type Rail = { y: number; support: number; steps: number };

const findRail = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, tapY: number, dir: -1 | 1, mode: Mode, lim: BandLimits): Rail | null => {
  const maxSteps = Math.round(H * lim.maxSearchFrac);
  let first: Rail | null = null;
  let last: Rail | null = null;
  let best: Rail | null = null;
  for (let step = 1; step <= maxSteps; step++) {
    const y = Math.round(tapY + dir * step);
    if (y < 0 || y >= H) break;
    if (segSupport(edge, W, H, x0, x1, y, lim) < lim.minSupport) continue;
    const c = plateauCentre(edge, W, H, x0, x1, y, lim);
    const hit = { y: c, support: segSupport(edge, W, H, x0, x1, c, lim), steps: step };
    if (mode === 'first') return hit;
    if (!first) first = hit;
    last = hit;
    if (!best || hit.support > best.support) best = hit;
  }
  return mode === 'best' ? best : mode === 'outermost' ? last : first;
};

const detect = (edge: Uint8Array, W: number, H: number, cx: number, cy: number, half: number, mode: Mode, lim: BandLimits): BandSuggestion | null => {
  const x0 = Math.max(0, cx - half);
  const x1 = Math.min(W - 1, cx + half);
  const top = findRail(edge, W, H, x0, x1, cy, -1, mode, lim);
  const bottom = findRail(edge, W, H, x0, x1, cy, +1, mode, lim);
  if (!top || !bottom) return null;
  const heightPx = bottom.y - top.y;
  if (heightPx < H * lim.minBandHeightFrac || heightPx > H * lim.maxBandHeightFrac) return null;
  return { top, bottom, halfWidth: (x1 - x0) / 2, heightPx };
};

interface Row {
  c: GtCase;
  W: number;
  H: number;
  cx: number;
  cy: number;
  half: number;
  gtTopL: number;
  gtTopR: number;
  gtBotL: number;
  gtBotR: number;
  visTop: number;
  visBot: number;
  edge: Uint8Array;
}

const rows: Row[] = [];
for (const c of GT_CASES) {
  const rgba = await loadRgba(c.file);
  const { W, H, edge } = extractFeatures(rgba, maxSide);
  const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
  const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
  const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
  const half = Math.abs(p[1].x - p[0].x) * 0.3;
  const lim = { ...BAND_LIMITS };
  const x0 = Math.max(0, cx - half);
  const x1 = Math.min(W - 1, cx + half);
  rows.push({
    c,
    W,
    H,
    cx,
    cy,
    half,
    edge,
    gtTopL: (c.quad[0][1] / 100) * H,
    gtTopR: (c.quad[1][1] / 100) * H,
    gtBotL: (c.quad[3][1] / 100) * H,
    gtBotR: (c.quad[2][1] / 100) * H,
    visTop: segSupport(edge, W, H, x0, x1, (c.quad[0][1] / 100) * H, lim),
    visBot: segSupport(edge, W, H, x0, x1, (c.quad[3][1] / 100) * H, lim),
  });
}

const MODES: Array<[string, Mode]> = [
  ['V0 prvi zadetek (produkcija)', 'first'],
  ['V2 zunanji zadetek', 'outermost'],
  ['V3 najboljša podpora', 'best'],
];

console.log(`prag ${BAND_LIMITS.minSupport} | tol ${BAND_LIMITS.edgeTolerancePx} px | vzorcev ${BAND_LIMITS.samples}`);
console.log('VIDNOST = podpora DEJANSKEGA GT roba v istem oknu. Pod pragom = nobeno');
console.log('pravilo ustavljanja ga ne more najti.\n');

for (const [label, mode] of MODES) {
  const eIn: number[] = [];
  const eAll: number[] = [];
  let found = 0;
  let refused = 0;
  let severe = 0;
  console.log(`======== ${label} ========`);
  const lim = { ...BAND_LIMITS };
  for (const r of rows) {
    const b = detect(r.edge, r.W, r.H, r.cx, r.cy, r.half, mode, lim);
    if (!b) {
      refused++;
      console.log(`${r.c.inScope ? 'v obsegu' : 'IZVEN '} ${r.c.file.padEnd(22)} → ZAVRNJENO (vidnost GT zgoraj/spodaj ${r.visTop.toFixed(2)}/${r.visBot.toFixed(2)})`);
      continue;
    }
    found++;
    const e = [
      ((b.top.y - r.gtTopL) / r.H) * 100,
      ((b.bottom.y - r.gtBotL) / r.H) * 100,
      ((b.top.y - r.gtTopR) / r.H) * 100,
      ((b.bottom.y - r.gtBotR) / r.H) * 100,
    ];
    for (const v of e) eAll.push(Math.abs(v));
    if (r.c.inScope) for (const v of e) eIn.push(Math.abs(v));
    if (Math.max(...e.map(Math.abs)) > 15) severe++;
    console.log(
      `${r.c.inScope ? 'v obsegu' : 'IZVEN '} ${r.c.file.padEnd(22)} vidnost ${r.visTop.toFixed(2)}/${r.visBot.toFixed(2)} | podpora ${b.top.support.toFixed(2)}/${b.bottom.support.toFixed(2)} koraka ${b.top.steps}/${b.bottom.steps} | višina ${((b.heightPx / r.H) * 100).toFixed(0)} % | L ${pct(e[0])}/${pct(e[1])} D ${pct(e[2])}/${pct(e[3])}`,
    );
  }
  console.log(`→ najdenih ${found}, zavrnjenih ${refused} | V OBSEGU: mediana ${median(eIn).toFixed(1)} %, max ${Math.max(...eIn).toFixed(1)} % (n=${eIn.length}) | VSE: mediana ${median(eAll).toFixed(1)} %, max ${Math.max(...eAll).toFixed(1)} % | hudih (>15 %): ${severe}`);
  console.log('');
}

console.log('=== kontrola: differentna V0 mora biti ENAKA produkcijskemu modulu ===');
let same = 0;
let diff = 0;
for (const r of rows) {
  const mine = detect(r.edge, r.W, r.H, r.cx, r.cy, r.half, 'first', { ...BAND_LIMITS });
  const theirs = suggestBand({ edge: r.edge, W: r.W, H: r.H }, { x: r.cx, y: r.cy }, r.half);
  const eq = (mine?.top.y ?? -1) === (theirs?.top.y ?? -1) && (mine?.bottom.y ?? -1) === (theirs?.bottom.y ?? -1);
  if (eq) same++;
  else {
    diff++;
    console.log(`  RAZLIKA ${r.c.file}: moj ${mine ? `${mine.top.y}/${mine.bottom.y}` : 'null'} vs modul ${theirs ? `${theirs.top.y}/${theirs.bottom.y}` : 'null'}`);
  }
}
console.log(`  enako v ${same} od ${rows.length} primerov (razlik ${diff})`);
console.log('\nODLOČITEV: odloča MEDIANA in MAX v obsegu, ne število najdenih pasov.');
