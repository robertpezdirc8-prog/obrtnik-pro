/**
 * SONDA 5 od 5 — ali je DELA VNA LOČLJIVOST (maxSide) tisti, ki drži napako
 * dvotapnega predloga. Ni del sweepa (rabi fotke — tests/gt/README.md).
 *
 * Zagon:  bun tests/gt/probe-resolution.ts <mapa-s-fotkami>
 *
 * Hipoteza, vredna preizkusa: pri 256 delovnih pikih je toleranca ±2 px =
 * 0,78 % višine slike. Za tanko tirnico je to lahko preozko, zato naj bi
 * višja ločljivost (več pikov na rob) pomenila boljšo podporo in manjšo
 * napako. Proti tej hipotezi: z višjo ločljivostjo se absolutna toleranca
 * zmajša v deležu slike, torej POSTANE strožja — mogoče je 256 optimalen
 * ravno zato, ker je tam toleranca najboljše uravnotežena.
 *
 * Meri se ENAK produkcijski modul (suggestBand, BAND_LIMITS nespremenjeni) pri
 * petih ločljivostih, odločajoče pa sta MEDIANA in MAX napake v obsegu.
 *
 * IZMERJENO (2026-10-16): 256 px je optimalen (mediana 2,3 %); 192 → 5,5 %,
 * 384 → 6,5 %, 512 → 13,2 %. Višja ločljivost NAPAKO POVEČA, ne zmanjša, in
 * dodatno zmanjša pokritost (pri 512 odpade tudi 16.jpg). Privzetih 256 px
 * torej ni obrambni kompromis, je izmerjeni optimum.
 */
import { extractFeatures } from '../../src/lib/cv-engine';
import { suggestBand, BAND_LIMITS } from '../../src/lib/band-suggest';
import { GT_CASES } from './gt-quads';
import { header, loadRgba, median } from './harness';

header('probe-resolution');
const SIZES = [192, 256, 320, 384, 512];

const CACHE = new Map<string, { width: number; height: number; data: Uint8ClampedArray }>();
for (const c of GT_CASES) if (!CACHE.has(c.file)) CACHE.set(c.file, await loadRgba(c.file));

console.log(`prag ${BAND_LIMITS.minSupport} | toleranca ±${BAND_LIMITS.edgeTolerancePx} px | vzorcev ${BAND_LIMITS.samples}`);
console.log('pri vsaki ločljivosti je nespremenjen ISTI modul in ISTI GT.');
console.log('Toleranca ±2 px je v deležu višine slike odvisna od ločljivosti, zato');
console.log('spodnji stolpec pove, kako stroga je produkcijska mera pri njej:');
console.log('maxSide | ±2 px kot % višine | najdenih | zavrnjenih | mediana v obsegu | max v obsegu');

for (const maxSide of SIZES) {
  const eIn: number[] = [];
  let found = 0;
  let refused = 0;
  let Href = 0;
  for (const c of GT_CASES) {
    const { W, H, edge } = extractFeatures(CACHE.get(c.file)!, maxSide);
    Href = Math.max(Href, H);
    const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
    const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
    const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
    const half = Math.abs(p[1].x - p[0].x) * 0.3;
    const b = suggestBand({ edge, W, H }, { x: cx, y: cy }, half);
    if (!b) {
      refused++;
      continue;
    }
    found++;
    if (!c.inScope) continue;
    // Le oglišče, kot v sondi 1 — primerjava med ločljivostmi mora ista merilo.
    const yl = (c.quad[0][1] / 100) * H;
    const ybl = (c.quad[3][1] / 100) * H;
    eIn.push(Math.abs(((b.top.y - yl) / H) * 100), Math.abs(((b.bottom.y - ybl) / H) * 100));
  }
  const frac = ((BAND_LIMITS.edgeTolerancePx / Math.max(1, Href)) * 100).toFixed(2);
  const med = eIn.length ? median(eIn).toFixed(1) : '—';
  const mx = eIn.length ? Math.max(...eIn).toFixed(1) : '—';
  console.log(`${String(maxSide).padStart(5)} |              ${frac} %   |    ${found}     |     ${refused}      |          ${med} %          |      ${mx} %`);
}

console.log('\nODLOČITEV: izbrana je ločljivost z najmanjšo MEDIANO in MAX napako v');
console.log('obsegu, ne tista z največjim številom najdenih pasov. Pokritost je');
console.log('posledica, ne cilj.');
