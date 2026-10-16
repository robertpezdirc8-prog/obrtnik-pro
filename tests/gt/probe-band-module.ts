/**
 * SONDA 1 od 4 — izhodiščna mera DVOTAPNEGA predloga na ročno prebranem GT.
 * NIKOLI ne spreminja kode; samo meri in izpiše. Ni del sweepa `tests/verify`
 * (rabi fotke, ki niso v repozitoriju — tests/gt/README.md).
 *
 * Zagon:  bun tests/gt/probe-band-module.ts <mapa-s-fotkami> [maxSide=256]
 *
 * Predmet meritve je `src/lib/band-suggest.ts` NESPREMENJEN. Izhod pove:
 *   - kolikor primerov modul najde in kolikor jih zavrne,
 *   - napako POLOŽAJA tirnice na levem in desnem oglišču (v % višine slike),
 *   - napako, ki jo povzroči ODLOČITEV 2 (modul ne ocenuje nagiba): desno
 *     oglišče zgreši toliko, kolikor znaša GT nagib × širina pasu.
 *
 * Odločitveno pravilo (iz dokumentirane prakse): prag se izbere po MEDIANI in
 * MAX napaki v obsegu, ne po številu najdenih pasov — napačen pas, ki ga mora
 * monter popravljati, je dražji od zavrnitve.
 */
import { extractFeatures } from '../../src/lib/cv-engine';
import { suggestBand, BAND_LIMITS, type BandLimits } from '../../src/lib/band-suggest';
import { GT_CASES, type GtCase } from './gt-quads';
import { header, loadRgba, maxSideFromArg, median, pct } from './harness';

const maxSide = maxSideFromArg();
header('probe-band-module', maxSide);

/** GT tirnici: y na levem in desnem x + nagib. */
const rails = (c: GtCase, W: number, H: number) => {
  const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
  const seg = (a: number, b: number) => {
    const [l, r] = p[a].x <= p[b].x ? [p[a], p[b]] : [p[b], p[a]];
    return { xl: l.x, xr: r.x, yl: l.y, yr: r.y, deg: (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI };
  };
  return { top: seg(0, 1), bottom: seg(3, 2) };
};

/** Ali posamezna vodoravnica y preseže prag — diagnostika zavrnitev. */
const scan = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, tapY: number, dir: -1 | 1, lim: BandLimits) => {
  const sup = (y: number) => {
    let h = 0;
    for (let i = 0; i <= lim.samples; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / lim.samples);
      const yy = Math.round(y);
      let hit = false;
      for (let dy = -lim.edgeTolerancePx; dy <= lim.edgeTolerancePx && !hit; dy++)
        for (let dx = -lim.edgeTolerancePx; dx <= lim.edgeTolerancePx && !hit; dx++) {
          const px = x + dx;
          const py = yy + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          if (edge[py * W + px]) hit = true;
        }
      if (hit) h++;
    }
    return h / (lim.samples + 1);
  };
  let bestY = -1;
  let bestSup = 0;
  let firstHit = -1;
  for (let step = 1; step <= Math.round(H * lim.maxSearchFrac); step++) {
    const y = Math.round(tapY + dir * step);
    if (y < 0 || y >= H) break;
    const s = sup(y);
    if (s > bestSup) {
      bestSup = s;
      bestY = y;
    }
    if (s >= lim.minSupport && firstHit < 0) firstHit = y;
  }
  return { firstHit, bestY, bestSup };
};

const VARIANTS: Array<[string, BandLimits]> = [
  ['končni modul (brez ocene nagiba)', { ...BAND_LIMITS }],
  ['prag podpore 0,80', { ...BAND_LIMITS, minSupport: 0.8 }],
  ['prag podpore 0,90', { ...BAND_LIMITS, minSupport: 0.9 }],
  ['toleranca roba ±3 px', { ...BAND_LIMITS, edgeTolerancePx: 3 }],
];

for (const [label, lim] of VARIANTS) {
  const ePosIn: number[] = [];
  const ePosOutIn: number[] = [];
  let found = 0;
  let refused = 0;
  console.log(`\n======== ${label} ========`);
  for (const c of GT_CASES) {
    const rgba = await loadRgba(c.file);
    const { W, H, edge } = extractFeatures(rgba, maxSide);
    const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
    const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
    const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
    const half = Math.abs(p[1].x - p[0].x) * 0.3;
    const gt = rails(c, W, H);
    const b = suggestBand({ edge, W, H }, { x: cx, y: cy }, half, lim);
    if (!b) {
      refused++;
      const x0 = Math.max(0, cx - half);
      const x1 = Math.min(W - 1, cx + half);
      const up = scan(edge, W, H, x0, x1, cy, -1, lim);
      const dn = scan(edge, W, H, x0, x1, cy, +1, lim);
      console.log(
        `${c.inScope ? 'v obsegu' : 'IZVEN '} ${c.file.padEnd(22)} → ZAVRNJENO  ` +
          `(zgoraj prvi zadetek ${up.firstHit < 0 ? 'ni' : up.firstHit}, najboljša podpora ${up.bestSup.toFixed(2)}; ` +
          `spodaj ${dn.firstHit < 0 ? 'ni' : dn.firstHit}, ${dn.bestSup.toFixed(2)})`,
      );
      continue;
    }
    found++;
    const eL = [((b.top.y - gt.top.yl) / H) * 100, ((b.bottom.y - gt.bottom.yl) / H) * 100];
    const eR = [((b.top.y - gt.top.yr) / H) * 100, ((b.bottom.y - gt.bottom.yr) / H) * 100];
    for (const v of eL) {
      ePosOutIn.push(Math.abs(v));
      if (c.inScope) ePosIn.push(Math.abs(v));
    }
    console.log(
      `${c.inScope ? 'v obsegu' : 'IZVEN '} ${c.file.padEnd(22)} podpora ${b.top.support.toFixed(2)}/${b.bottom.support.toFixed(2)} ` +
        `koraka ${b.top.steps}/${b.bottom.steps} | oglišče L ${eL.map(pct).join('/')}% ` +
        `D ${eR.map(pct).join('/')}% (GT nagib ${gt.top.deg.toFixed(1)}/${gt.bottom.deg.toFixed(1)}°)`,
    );
  }
  console.log(
    `→ najdenih ${found}, zavrnjenih ${refused} | V OBSEGU levo oglišče: mediana ${median(ePosIn).toFixed(1)} %, max ${Math.max(...ePosIn).toFixed(1)} % | VSE: mediana ${median(ePosOutIn).toFixed(1)} %`,
  );
}
console.log('\nODLOČITEV: prag izbere po MEDIANI in MAX napaki v obsegu, ne po številu');
console.log('najdenih pasov — napačen pas, ki ga mora monter popravljati, je dražji kot');
console.log('zavrnitev. Desno oglišče meri ceno ničelnega nagiba: toliko mora monter povleči.');
