/**
 * SONDA 4 od 4 — ZAKAJ je napaka taka, kot je. Meri LOČLJIVOST pravega roba v
 * robnem zemljevidu, ne variant predloga. Ni del sweepa (rabi fotke —
 * tests/gt/README.md).
 *
 * Zagon:  bun tests/gt/probe-rail-visibility.ts <mapa-s-fotkami> [maxSide=256]
 *
 * Sonde 1–3 so zavrnile trapež, spremembo pravila ustavljanja in pragov. Vse
 * tri so predpostavljale, da je PRAVA informacija v robnem zemljevidu in da jo
 * izbirna pravila samo napačno preberejo. To je zadnje vprašanje, ki ga je
 * treba odgovoriti, preden se sploh več dotakne iskanja:
 *
 *   Ali je DEJANSKI GT rob (merjen PO SVOJI SMERNICI, da primerjava ni
 *   krivična do nagnjenih tirnic) najmočnejša črta v iskanem pasu?
 *   Če DA: detektor zmore pravo črto, pokvarili smo samo izbiro.
 *   Če NE: napačna vrstica je v zemljevidu res bolj robata in izboljšava
 *   predloga pomeni BOLJŠI ROBNI ZEMLJEVID, ne pametnejše iskanje.
 *
 * Meri se par: SEG (GT rob po svoji smernici) proti MOD (vodoravnica, ki jo je
 * modul izbral), pri štirih tolerancah. Zadnji broj v celici je RAZLIKA
 * SEG − najmočnejša horizontalka pasu. Razlika, ne ranking: pri ±8 px se
 * skoraj vse vrstice dvignejo na 1,00, kjer je "mesto 1" brez vsebine.
 *
 * Opomba, da ponuja dve možnosti, kjer ju ni: mera "vsak stolpec sme svoj
 * navpični odmik do N px" je ISTA funkcija kot toleranca ±N, zato se ne
 * pojavi kot drugo merilo.
 *
 * IZMERJENO (2026-10-16): GT rob preseže produkcjski prag pri ±2 px v 8 od 10
 * tirnic, veĎndar izbrana vrstica ima pri ±2 px več podpore kot GT v 4 od 10,
 * in GT zmaga nad najboljšo horizontalko z razliko > 0,02 samo v 2 od 10.
 * Omejitev je torej robni zemljevid, ne iskanje.
 */
import { extractFeatures } from '../../src/lib/cv-engine';
import { BAND_LIMITS, suggestBand } from '../../src/lib/band-suggest';
import { GT_CASES } from './gt-quads';
import { header, loadRgba, maxSideFromArg, f2 } from './harness';

const maxSide = maxSideFromArg();
header('probe-rail-visibility', maxSide);

const N = BAND_LIMITS.samples;
const TOLS = [2, 4, 6, 8] as const;

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

/** Podpora HORIZONTALNE črte — produkcijska mera. */
const hSupport = (edge: Uint8Array, W: number, H: number, x0: number, x1: number, y: number, tol: number): number => {
  let hits = 0;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    if (hasEdge(edge, W, H, x, y, tol)) hits++;
  }
  return hits / (N + 1);
};

/** Podpora nagnjeni črti: referenčni y na stolpcu je interpoliran med
 *  ogliščema tirnice, ne poenoten na njuno sredino. Brez tega bi bila
 *  primerjava krivična do vseh tirnic, ki nimajo nagiba 0°. */
const segSupport = (edge: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, tol: number): number => {
  let hits = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (hasEdge(edge, W, H, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, tol)) hits++;
  }
  return hits / (N + 1);
};

console.log(`prag ${BAND_LIMITS.minSupport} | produkcjska toleranca ±${BAND_LIMITS.edgeTolerancePx} px | ${N} vzorcev`);
console.log('Celice so SEG MOD RAZLIKA, kjer je RAZLIKA = SEG − najboljša horizontalka.');
console.log('Pozitivna razlika = mera bi lahko ločila; ničelna ali negativasna = NE.\n');
console.log('datoteka              rob   nagib |      ±2       |      ±4       |      ±6       |      ±8       | sklep');

let rails = 0;
let winSomewhere = 0;
let segAbovePragAt2 = 0;
let modAboveSegAt2 = 0;
const hopeless: string[] = [];

for (const c of GT_CASES) {
  if (!c.inScope) continue;
  const rgba = await loadRgba(c.file);
  const { W, H, edge } = extractFeatures(rgba, maxSide);
  const p = c.quad.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H }));
  const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
  const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
  const half = Math.abs(p[1].x - p[0].x) * 0.3;
  const x0 = Math.max(0, cx - half);
  const x1 = Math.min(W - 1, cx + half);
  const b = suggestBand({ edge, W, H }, { x: cx, y: cy }, half);
  const maxSteps = Math.round(H * BAND_LIMITS.maxSearchFrac);

  for (const [name, ai, bi, yMod, dir] of [
    ['zgoraj', 0, 1, b?.top.y, -1],
    ['spodaj', 3, 2, b?.bottom.y, +1],
  ] as const) {
    rails++;
    const [A, B] = p[ai].x <= p[bi].x ? [p[ai], p[bi]] : [p[bi], p[ai]];
    const deg = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
    const yAt = (x: number) => A.y + ((B.y - A.y) * (x - A.x)) / (B.x - A.x);
    const cells: string[] = [];
    let anyWin = false;
    let seg2 = 0;
    let mod2 = NaN;
    for (const tol of TOLS) {
      const seg = segSupport(edge, W, H, x0, yAt(x0), x1, yAt(x1), tol);
      if (tol === 2) seg2 = seg;
      const mod = yMod === undefined ? NaN : hSupport(edge, W, H, x0, x1, yMod, tol);
      if (tol === 2) mod2 = mod;
      let best = 0;
      for (let step = 1; step <= maxSteps; step++) {
        const y = Math.round(cy + dir * step);
        if (y < 0 || y >= H) break;
        const v = hSupport(edge, W, H, x0, x1, y, tol);
        if (v > best) best = v;
      }
      const margin = seg - best;
      // Razlika mora biti OBČUTNA, sicer šteje saturacija (±8 px = vse 1,00).
      if (margin > 0.02) anyWin = true;
      cells.push(`${f2(seg)} ${f2(mod)} ${(margin >= 0 ? '+' : '') + margin.toFixed(2)}`);
    }
    if (seg2 >= BAND_LIMITS.minSupport) segAbovePragAt2++;
    if (Number.isFinite(mod2) && mod2 > seg2) modAboveSegAt2++;
    if (anyWin) winSomewhere++;
    else hopeless.push(`${c.file} ${name}`);
    console.log(`${c.file.padEnd(21)} ${name.padEnd(7)} ${(deg >= 0 ? '+' : '') + deg.toFixed(1)}° |  ${cells.join('  |  ')}  | ${anyWin ? 'MERA BI LAHKO POPRAVILA' : 'NELOČLJIVO z toleranco'}`);
  }
}

console.log(`\nV obsegu premerjenih tirnic: ${rails}.`);
console.log(`- GT rob (po svoji smernici) preseže prag pri ±2 px: ${segAbovePragAt2} od ${rails}`);
console.log(`- izbrana vrstica ima pri ±2 px VEČ podpore kot GT rob: ${modAboveSegAt2} od ${rails}`);
console.log(`- GT zmaga nad najboljšo horizontalko z razliko > 0,02 pri vsaj eni toleranci: ${winSomewhere} od ${rails}`);
if (hopeless.length) console.log(`- neločljive: ${hopeless.join('; ')}`);
console.log(
  winSomewhere === 0
    ? '\nZAKLJUČEK: napaka NI v strategiji iskanja — pri nobeni toleranci pravi rob ni' +
      '\nnajmočnejša črta pasu. Robni zemljevid ga res podpira šibkeje od notranje črte,' +
      '\nin izboljšava predloga = BOLJŠI ROBNI ZEMLJEVID (barvni/svetlobni prehod' +
      '\nnamesto Sobelovih pikslov), ne pametnejše iskanje.'
    : `\nZAKLJUČEK: samo pri ${winSomewhere} od ${rails} tirnic bi višja toleranca res odločila v` +
      '\nprid pravega roba; ostale so neločljive z mero toleranco. Tudi tam, kjer je' +
      '\nmera odločila, je cena večje tolerance (sonda 3, ±3 px: mediana 16,2 %)' +
      '\nvečja kot korist — robni zemljevid ostane omejitev.',
);
