// Verifikacija veriženja parov fotk (> 2 fotke) — multiview-chain (Task 42).
// Sintetična scena s ZNANO resnico: 3 kamere z znanimi pozami, znane 3D točke
// → projekcije + šum → veriga → prenos merila prek skupnih točk (Umeyama).
// Deterministično (lcg), brez canvasa/DOM/omrežja. Stil: tests/verify/multiview.ts.
import {
  measureFromChain,
  umeyamaSimilarity,
  MIN_SHARED_FOR_SCALE,
  MIN_SHARED_FOR_FULL,
  COLLINEAR_D1_TOLERANCE,
} from '../../src/lib/multiview-chain';
import { lcg, measureFromPair } from '../../src/lib/multiview-core';
import type { XY } from '../../src/lib/photo-replace-core';

let okCount = 0;
let badCount = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    okCount++;
  } else {
    badCount++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function near(a: number, b: number, tolAbs: number): boolean {
  return Math.abs(a - b) <= tolAbs;
}
function nearRel(a: number, b: number, tolRel: number): boolean {
  return Math.abs(a - b) <= tolRel * Math.abs(b);
}

// ─── Geometrijska orodja ─────────────────────────────────────────────────────

type V3 = [number, number, number];
const W = 1024, H = 768, F = 800;

/** Rodriguesova rotacija okoli osi (row-major 3×3). */
function rotAxis(axis: V3, angle: number): number[] {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  const [ax, ay, az] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
}

/** Projekcija točke X (svetovne/A-okvir, cm) v kamero (R, C) — null, če ni vidna. */
function project(R: number[], C: V3, X: V3): XY | null {
  const t: V3 = [
    -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]),
    -(R[3] * C[0] + R[4] * C[1] + R[5] * C[2]),
    -(R[6] * C[0] + R[7] * C[1] + R[8] * C[2]),
  ];
  const xc = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0];
  const yc = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1];
  const zc = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  if (zc < 30) return null;
  const u = (F * xc) / zc + W / 2;
  const v = (F * yc) / zc + H / 2;
  if (u < 6 || u > W - 6 || v < 6 || v > H - 6) return null;
  return { x: u, y: v };
}

function addNoise(p: XY, rng: () => number, ampPx: number): XY {
  return { x: p.x + (rng() - 0.5) * 2 * ampPx, y: p.y + (rng() - 0.5) * 2 * ampPx };
}

// ─── Sintetična scena ────────────────────────────────────────────────────────

const R_A = rotAxis([0, 1, 0], 0);
const C_A: V3 = [0, 0, 0];
const RX = rotAxis([1, 0, 0], 0.05);
function mul3(a: number[], b: number[]): number[] {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}
const R_Bc = mul3(RX, rotAxis([0, 1, 0], 0.18));
const C_B: V3 = [-70, 6, -55];
const R_Cc = mul3(rotAxis([1, 0, 0], 0.07), rotAxis([0, 1, 0], -0.2));
const C_C: V3 = [70, -8, -60];

// točke: zadnja stena (različne globine) + stranski zid + naključni oblak → 3D
function genPoints(): V3[] {
  const rng = lcg(7);
  const pts: V3[] = [];
  for (let i = 0; i < 26; i++) {
    // zadnja stena z globinskim šumom
    pts.push([(-140 + (280 * i) / 25) + (rng() - 0.5) * 18, -90 + rng() * 200, 290 + (rng() - 0.5) * 110]);
  }
  for (let i = 0; i < 14; i++) {
    // stranski zid (plane x ≈ 130) — daje sceni pravo globino
    pts.push([128 + (rng() - 0.5) * 16, -85 + rng() * 190, 250 + rng() * 160]);
  }
  for (let i = 0; i < 16; i++) {
    // splošen oblak
    pts.push([(rng() - 0.5) * 320, (rng() - 0.5) * 210, 250 + rng() * 170]);
  }
  return pts;
}
const PTS = genPoints();
const visA = PTS.map((p) => project(R_A, C_A, p));
const visB = PTS.map((p) => project(R_Bc, C_B, p));
const visC = PTS.map((p) => project(R_Cc, C_C, p));
const vis = (p: XY | null): p is XY => p !== null;

// bazne zadeve: par A–B (vidna v A in B), par B–C (vidna v B in C), skupne (vseh 3)
interface Built {
  ptsA: XY[]; ptsB: XY[];
  ptsB2: XY[]; ptsC: XY[];
  abIndexOf: number[];   // ptsIndex[i] = indeks točke PTS v paru A–B
  bcIndexOf: number[];
  shared: { abIdx: number; bcIdx: number }[];
}
function buildBase(noiseAmp: number): Built {
  const rng = lcg(11);
  const ptsA: XY[] = [], ptsB: XY[] = [], ptsB2: XY[] = [], ptsC: XY[] = [];
  const abIndexOf: number[] = [], bcIndexOf: number[] = [];
  const shared: { abIdx: number; bcIdx: number }[] = [];
  for (let i = 0; i < PTS.length; i++) {
    const inAB = vis(visA[i]) && vis(visB[i]);
    const inBC = vis(visB[i]) && vis(visC[i]);
    const a = visA[i], b = visB[i], c = visC[i];
    if (inAB) {
      abIndexOf[i] = ptsA.length;
      ptsA.push(addNoise(a as XY, rng, noiseAmp));
      ptsB.push(addNoise(b as XY, rng, noiseAmp));
    }
    if (inBC) {
      bcIndexOf[i] = ptsB2.length;
      ptsB2.push(addNoise(b as XY, rng, noiseAmp));
      ptsC.push(addNoise(c as XY, rng, noiseAmp));
    }
    if (inAB && inBC) shared.push({ abIdx: abIndexOf[i], bcIdx: bcIndexOf[i] });
  }
  return { ptsA, ptsB, ptsB2, ptsC, abIndexOf, bcIndexOf, shared };
}

// ─── 1) Umeyamova podobnostna transformacija ────────────────────────────────

{
  console.log('— Umeyama: točna obnova iz znane transformacije');
  const RTrue = mul3(rotAxis([1, 2, 3], 0.7), rotAxis([0, 1, 0], 1.9));
  const sTrue = 3.7;
  const tTrue: V3 = [12, -5, 8];
  // jasno nekoplanarni oblak (oglji škatle + notranje točke + zunanji par)
  const xs: V3[] = [
    [0, 0, 0], [20, 0, 0], [0, 15, 0], [0, 0, 10], [20, 15, 0],
    [20, 0, 10], [0, 15, 10], [20, 15, 10], [5, 7, 3], [-8, 12, 6],
  ];
  const ys = xs.map((p) => {
    const rx = RTrue[0] * p[0] + RTrue[1] * p[1] + RTrue[2] * p[2];
    const ry = RTrue[3] * p[0] + RTrue[4] * p[1] + RTrue[5] * p[2];
    const rz = RTrue[6] * p[0] + RTrue[7] * p[1] + RTrue[8] * p[2];
    return [sTrue * rx + tTrue[0], sTrue * ry + tTrue[1], sTrue * rz + tTrue[2]] as V3;
  });
  const um = umeyamaSimilarity(xs, ys);
  check('umeyama: rezultat obstaja', um !== null);
  if (um) {
    check('umeyama: merilo točno', near(um.s, sTrue, 1e-8), `s=${um.s}`);
    let maxRDiff = 0;
    for (let k = 0; k < 9; k++) maxRDiff = Math.max(maxRDiff, Math.abs(um.R[k] - RTrue[k]));
    check('umeyama: rotacija točna', maxRDiff < 1e-8, `maxΔR=${maxRDiff}`);
    check('umeyama: prevod točen', near(um.t[0], tTrue[0], 1e-7) && near(um.t[1], tTrue[1], 1e-7) && near(um.t[2], tTrue[2], 1e-7));
    check('umeyama: ostanek ≈ 0', um.residualMax < 1e-7, `${um.residualMax}`);
    const det = um.R[0] * (um.R[4] * um.R[8] - um.R[5] * um.R[7]) - um.R[1] * (um.R[3] * um.R[8] - um.R[5] * um.R[6]) + um.R[2] * (um.R[3] * um.R[7] - um.R[4] * um.R[6]);
    check('umeyama: det(R) = +1 (prava rotacija)', Math.abs(det - 1) < 1e-9, `${det}`);
    check('umeyama: d1Ratio velik (nekolinearne)', um.d1Ratio > 0.3, `${um.d1Ratio}`);
  }

  console.log('— Umeyama: kolinearne točke → d1Ratio nizek, merilo pravilno');
  const xsLin: V3[] = [[0, 0, 0], [10, 2, 1], [20, 4, 2], [30, 6, 3]];
  const sLin = 2.5;
  const ysLin = xsLin.map((p) => [sLin * p[0], sLin * p[1], sLin * p[2]] as V3);
  const umLin = umeyamaSimilarity(xsLin, ysLin);
  check('umeyama kolinear: rezultat obstaja', umLin !== null);
  if (umLin) {
    check('umeyama kolinear: merilo točno', near(umLin.s, sLin, 1e-8), `s=${umLin.s}`);
    check('umeyama kolinear: d1Ratio ≈ 0', umLin.d1Ratio < COLLINEAR_D1_TOLERANCE, `${umLin.d1Ratio}`);
    check('umeyama kolinear: ostanek ≈ 0', umLin.residualMax < 1e-7, `${umLin.residualMax}`);
  }

  console.log('— Umeyama: zavrnitve');
  check('umeyama: < 3 točke → null', umeyamaSimilarity([[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [2, 0, 0]]) === null);
  check('umeyama: vse točke iste → null', umeyamaSimilarity([[1, 1, 1], [1, 1, 1], [1, 1, 1]], [[2, 2, 2], [2, 2, 2], [2, 2, 2]]) === null);
}

// ─── 2) Polna veriga: 3 fotke, prenos merila, prečne razdalje ───────────────

{
  console.log('— Veriga: polni potek (known fokus, mode full)');
  const base = buildBase(0.3);
  check('scena: dovolj točk v obeh parih', base.ptsA.length >= 12 && base.ptsB2.length >= 12, `AB=${base.ptsA.length}, BC=${base.ptsB2.length}`);
  check('scena: dovolj skupnih točk', base.shared.length >= 5, `${base.shared.length}`);

  // referenca: dve točki iz para A–B z znano razdaljo
  const ref1 = 0;
  const ref2 = 1;
  const refCmTrue = Math.hypot(
    PTS[base.abIndexOf.indexOf(ref1)][0] - PTS[base.abIndexOf.indexOf(ref2)][0],
    PTS[base.abIndexOf.indexOf(ref1)][1] - PTS[base.abIndexOf.indexOf(ref2)][1],
    PTS[base.abIndexOf.indexOf(ref1)][2] - PTS[base.abIndexOf.indexOf(ref2)][2],
  );
  const refCm = Math.round(refCmTrue * 10) / 10;

  // dodatni točki na A (veriga M1–M2) + poizvedba
  const abExtraPts = [2, 3].map((k) => base.abIndexOf.indexOf(k));
  const abExtras: { a: XY; b: XY }[] = [
    { a: visA[abExtraPts[0]] as XY, b: visB[abExtraPts[0]] as XY },
    { a: visA[abExtraPts[1]] as XY, b: visB[abExtraPts[1]] as XY },
  ];
  const ptsA = [...base.ptsA, ...abExtras.map((e) => e.a)];
  const ptsB = [...base.ptsB, ...abExtras.map((e) => e.b)];
  const abExtraIdx = (k: number) => base.ptsA.length + k;
  const abQ = [{ pair: 'ab' as const, ai: abExtraIdx(0), bi: abExtraIdx(1) }];

  // dodatni točki na C (veriga C1–C2) + poizvedba — točki vidni v B in C
  const bcExtraWorld: number[] = [];
  for (let i = 0; i < PTS.length && bcExtraWorld.length < 2; i++) {
    if (vis(visB[i]) && vis(visC[i]) && base.bcIndexOf[i] !== undefined && bcExtraWorld.indexOf(i) < 0) {
      bcExtraWorld.push(i);
    }
  }
  const bcExtras: { b: XY; c: XY }[] = bcExtraWorld.map((i) => ({
    b: visB[i] as XY,
    c: visC[i] as XY,
  }));
  const ptsB2 = [...base.ptsB2, ...bcExtras.map((e) => e.b)];
  const ptsC = [...base.ptsC, ...bcExtras.map((e) => e.c)];
  const bcExtraIdx = (k: number) => base.ptsB2.length + k;
  const bcQ = [{ pair: 'bc' as const, ai: bcExtraIdx(0), bi: bcExtraIdx(1) }];

  // prečna poizvedba: AB dodaten M1 ↔ BC bazična točka
  const crossWorldAB = abExtraPts[0];
  const crossWorldBC = bcExtraWorld[0];
  const crossQ = [{ abIdx: abExtraIdx(0), bcIdx: base.bcIndexOf[crossWorldBC] }];
  const crossTruth = Math.hypot(
    PTS[crossWorldAB][0] - PTS[crossWorldBC][0],
    PTS[crossWorldAB][1] - PTS[crossWorldBC][1],
    PTS[crossWorldAB][2] - PTS[crossWorldBC][2],
  );

  // svež RANSAC seme za VSAK klic (pogodba: enak seed od začetka = enak izid)
  const makeInput = () => ({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA, ptsB, ptsB2, ptsC,
    rand: lcg(42),
    focalMode: 'known' as const,
    focalPx: F,
    reference: { ai: ref1, bi: ref2, cm: refCm },
    sharedTracks: base.shared,
    queries: [...abQ, ...bcQ],
    crossQueries: crossQ,
  });
  const res = measureFromChain(makeInput());

  check('veriga: ok', res.ok, `code=${res.code}`);
  check('veriga: code OK', res.code === 'OK');
  check('veriga: mode full', res.mode === 'full', `mode=${res.mode}`);
  check('veriga: ab del uspešen', res.ab.ok);
  check('veriga: bc diag uspešen', res.bc?.ok === true);
  check('veriga: skupne uporabljene = pričakovane', res.shared?.used === base.shared.length, `used=${res.shared?.used}, pričakovano=${base.shared.length}`);
  check('veriga: ratioMedian obstaja', res.shared?.ratioMedian !== null && res.shared?.ratioMedian !== undefined);
  check('veriga: d1Ratio velik (nekolinearne)', (res.shared?.d1Ratio ?? 0) > 0.3, `${res.shared?.d1Ratio}`);

  // pravo merilo para B–C = baza med kamerama B in C (t normaliziran |t| = 1)
  const baselineBCTrue = Math.hypot(C_B[0] - C_C[0], C_B[1] - C_C[1], C_B[2] - C_C[2]);
  check('veriga: Umeyamovo merilo ≈ baza B–C', nearRel(res.shared?.umeyamaScale ?? 0, baselineBCTrue, 0.04), `s=${res.shared?.umeyamaScale}, prava=${baselineBCTrue.toFixed(2)}`);
  check('veriga: mediana razmerij ≈ baza B–C', nearRel(res.shared?.ratioMedian ?? 0, baselineBCTrue, 0.04), `r=${res.shared?.ratioMedian}`);
  check('veriga: scaleCmPerUnitBC = Umeyamovo merilo', nearRel(res.scaleCmPerUnitBC ?? 0, res.shared?.umeyamaScale ?? -1, 1e-9));
  check('veriga: ostanek transformacije majhen', (res.shared?.residualMaxCm ?? 1e9) < 5, `${res.shared?.residualMaxCm}`);

  // AB veriga: M1–M2 proti resnici
  const abTruth = Math.hypot(
    PTS[abExtraPts[0]][0] - PTS[abExtraPts[1]][0],
    PTS[abExtraPts[0]][1] - PTS[abExtraPts[1]][1],
    PTS[abExtraPts[0]][2] - PTS[abExtraPts[1]][2],
  );
  const abDist = res.distancesCm?.find((d) => d.pair === 'ab');
  check('veriga: AB razdalja prisotna', abDist !== undefined);
  if (abDist) check('veriga: AB razdalja ≈ resnica (2,5 %)', nearRel(abDist.cm, abTruth, 0.025), `${abDist.cm} vs ${abTruth.toFixed(1)}`);

  // BC veriga: C1–C2 proti resnici
  const bcTruth = Math.hypot(
    PTS[bcExtraWorld[0]][0] - PTS[bcExtraWorld[1]][0],
    PTS[bcExtraWorld[0]][1] - PTS[bcExtraWorld[1]][1],
    PTS[bcExtraWorld[0]][2] - PTS[bcExtraWorld[1]][2],
  );
  const bcDist = res.distancesCm?.find((d) => d.pair === 'bc');
  check('veriga: BC razdalja prisotna', bcDist !== undefined);
  if (bcDist) check('veriga: BC razdalja ≈ resnica (4 %)', nearRel(bcDist.cm, bcTruth, 0.04), `${bcDist.cm} vs ${bcTruth.toFixed(1)}`);

  // prečna razdalja (čez "vogal")
  const crossDist = res.distancesCm?.find((d) => d.pair === 'cross');
  check('veriga: prečna razdalja prisotna (mode full)', crossDist !== undefined);
  if (crossDist) check('veriga: prečna razdalja ≈ resnica (4 %)', nearRel(crossDist.cm, crossTruth, 0.04), `${crossDist.cm} vs ${crossTruth.toFixed(1)}`);

  // opozorila: ne sme biti napak NEZADOSTNI PODATKI pri uspehu
  check('veriga: brez NEZADOSTNI PODATKI opozoril ob uspehu', !res.warnings.some((w) => w.startsWith('NEZADOSTNI PODATKI')), res.warnings.join(' | '));

  // skladje z neodvisnim measureFromPair na paru A–B (isti vhodi, isti seed)
  const abStandalone = measureFromPair({
    wA: W, hA: H, wB: W, hB: H, ptsA, ptsB,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: ref1, bi: ref2, cm: refCm }, queries: abQ,
  });
  check('veriga: AB del = samostojni measureFromPair (determinizem)', JSON.stringify(res.ab.distancesCm) === JSON.stringify(abStandalone.distancesCm) && res.ab.scaleCmPerUnit === abStandalone.scaleCmPerUnit);

  // determinizem celotne verige
  const res2 = measureFromChain(makeInput());
  check('veriga: determinizem (dva klica = enak izid)', JSON.stringify(res) === JSON.stringify(res2));

  // ── 2b) selfcal pot ──
  console.log('— Veriga: selfcal fokus');
  const resSelf = measureFromChain({ ...makeInput(), focalMode: 'selfcal', focalPx: null });
  check('veriga selfcal: ok', resSelf.ok, `code=${resSelf.code}`);
  check('veriga selfcal: mode full', resSelf.mode === 'full');
  check('veriga selfcal: bc samokalibracija označena', resSelf.bc?.focalSelfCal === true);
  check('veriga selfcal: opozorilo o samokalibraciji', resSelf.warnings.some((w) => w.toLowerCase().includes('samokalibracija')));
  const abSelf = resSelf.distancesCm?.find((d) => d.pair === 'ab');
  if (abSelf) check('veriga selfcal: AB razdalja v razumu (7 %)', nearRel(abSelf.cm, abTruth, 0.07), `${abSelf.cm} vs ${abTruth.toFixed(1)}`);
  const crossSelf = resSelf.distancesCm?.find((d) => d.pair === 'cross');
  if (crossSelf) check('veriga selfcal: prečna razdalja v razumu (7 %)', nearRel(crossSelf.cm, crossTruth, 0.07), `${crossSelf.cm} vs ${crossTruth.toFixed(1)}`);
}

// ─── 3) Kolinearne skupne točke → mode 'scale', prečne zavrnjene ────────────

{
  console.log('— Veriga: kolinearne skupne točke (samo merilo)');
  // lastna scena: skupne točke NA PREMICI + ne-skupne točke drugje
  const rng = lcg(31);
  const ptsW: V3[] = [];
  // 4 kolinearne točke (vogalna linija robnika)
  for (let k = 0; k < 4; k++) ptsW.push([-60 + k * 45, 40 + k * 8, 320 + k * 10]);
  // 12 točk v osrednjem pasu (vidne v B in C, večinoma tudi v A — niso označene kot skupne)
  for (let k = 0; k < 12; k++) ptsW.push([-110 + (220 * k) / 11 + (rng() - 0.5) * 14, -70 + rng() * 150, 285 + rng() * 90]);
  // 8 točk bolj stransko (desni del scene)
  for (let k = 0; k < 8; k++) ptsW.push([95 + rng() * 35, -80 + rng() * 170, 280 + rng() * 110]);
  const vA = ptsW.map((p) => project(R_A, C_A, p));
  const vB = ptsW.map((p) => project(R_Bc, C_B, p));
  const vC = ptsW.map((p) => project(R_Cc, C_C, p));
  const rngN = lcg(13);
  const ptsA: XY[] = [], ptsB: XY[] = [], ptsB2: XY[] = [], ptsC: XY[] = [];
  const abIndexOf: number[] = [], bcIndexOf: number[] = [];
  const shared: { abIdx: number; bcIdx: number }[] = [];
  for (let i = 0; i < ptsW.length; i++) {
    const inAB = vA[i] !== null && vB[i] !== null;
    const inBC = vB[i] !== null && vC[i] !== null;
    if (inAB) {
      abIndexOf[i] = ptsA.length;
      ptsA.push(addNoise(vA[i] as XY, rngN, 0.3));
      ptsB.push(addNoise(vB[i] as XY, rngN, 0.3));
    }
    if (inBC) {
      bcIndexOf[i] = ptsB2.length;
      ptsB2.push(addNoise(vB[i] as XY, rngN, 0.3));
      ptsC.push(addNoise(vC[i] as XY, rngN, 0.3));
    }
    if (inAB && inBC && i < 4) shared.push({ abIdx: abIndexOf[i], bcIdx: bcIndexOf[i] });
  }
  check('kolinearna scena: 4 skupne, dovolj baznih', shared.length === 4 && ptsA.length >= 10 && ptsB2.length >= 10, `shared=${shared.length}, AB=${ptsA.length}, BC=${ptsB2.length}`);

  const refCm = Math.round(Math.hypot(
    ptsW[abIndexOf.indexOf(0)][0] - ptsW[abIndexOf.indexOf(1)][0],
    ptsW[abIndexOf.indexOf(0)][1] - ptsW[abIndexOf.indexOf(1)][1],
    ptsW[abIndexOf.indexOf(0)][2] - ptsW[abIndexOf.indexOf(1)][2],
  ) * 10) / 10;
  const res = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA, ptsB, ptsB2, ptsC,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: abIndexOf.indexOf(0), bi: abIndexOf.indexOf(1), cm: refCm },
    sharedTracks: shared,
    queries: [],
    crossQueries: [{ abIdx: 0, bcIdx: 0 }],
  });
  check('kolinearna: ok (samo merilo je veljavna mera)', res.ok, `code=${res.code}`);
  check('kolinearna: mode scale', res.mode === 'scale');
  check('kolinearna: d1Ratio nizek', (res.shared?.d1Ratio ?? 1) < COLLINEAR_D1_TOLERANCE, `${res.shared?.d1Ratio}`);
  check('kolinearna: opozorilo o kolinearnosti', res.warnings.some((w) => w.includes('kolinearne')));
  check('kolinearna: prečne razdalje zavrnjene', !res.distancesCm?.some((d) => d.pair === 'cross'));
  check('kolinearna: opozorilo o izpuščenih prečnih', res.warnings.some((w) => w.includes('Prečne razdalje')));
  const baselineBCTrue = Math.hypot(C_B[0] - C_C[0], C_B[1] - C_C[1], C_B[2] - C_C[2]);
  check('kolinearna: mediana razmerij ≈ baza B–C (6 %)', nearRel(res.shared?.ratioMedian ?? 0, baselineBCTrue, 0.06), `${res.shared?.ratioMedian} vs ${baselineBCTrue.toFixed(1)}`);
}

// ─── 4) Neuspehi: iskrene zavrnitve ─────────────────────────────────────────

{
  console.log('— Veriga: iskrene zavrnitve');
  const base = buildBase(0.3);
  const refCm = 100;

  // 4a) brez skupnih točk
  const resNoShared = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA: base.ptsA, ptsB: base.ptsB, ptsB2: base.ptsB2, ptsC: base.ptsC,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: 0, bi: 1, cm: refCm },
    sharedTracks: [],
  });
  check('0 skupnih: ok=false', resNoShared.ok === false);
  check('0 skupnih: code SHARED_INSUFFICIENT', resNoShared.code === 'SHARED_INSUFFICIENT');
  check('0 skupnih: opozorilo omejuje skupne točke', resNoShared.warnings.some((w) => w.includes('skupnimi točkami')));
  check('0 skupnih: brez razdalj', resNoShared.distancesCm === null);

  // 4b) ena sama skupna točka
  const resOne = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA: base.ptsA, ptsB: base.ptsB, ptsB2: base.ptsB2, ptsC: base.ptsC,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: 0, bi: 1, cm: refCm },
    sharedTracks: [base.shared[0]],
  });
  check('1 skupna: ok=false', resOne.ok === false);
  check('1 skupna: code SHARED_INSUFFICIENT', resOne.code === 'SHARED_INSUFFICIENT');
  check(`1 skupna: konstanta MIN_SHARED_FOR_SCALE=${MIN_SHARED_FOR_SCALE}`, MIN_SHARED_FOR_SCALE === 2);

  // 4c) neuspešen osnovni par (slaba referenca)
  const resBadAb = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA: base.ptsA, ptsB: base.ptsB, ptsB2: base.ptsB2, ptsC: base.ptsC,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: -1, bi: -1, cm: refCm },
    sharedTracks: base.shared,
  });
  check('slab AB: ok=false', resBadAb.ok === false);
  check('slab AB: code AB_FAILED', resBadAb.code === 'AB_FAILED');
  check('slab AB: bc ni računan', resBadAb.bc === null);

  // 4d) neuspešen par B–C (premalo točk)
  const resBadBc = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA: base.ptsA, ptsB: base.ptsB,
    ptsB2: base.ptsB2.slice(0, 5), ptsC: base.ptsC.slice(0, 5),
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: 0, bi: 1, cm: refCm },
    sharedTracks: base.shared,
  });
  check('slab BC: ok=false', resBadBc.ok === false);
  check('slab BC: code BC_FAILED', resBadBc.code === 'BC_FAILED');
  check('slab BC: ab ohranjen', resBadBc.ab.ok === true);

  // 4e) pokvarjena korespondenca skupne točke → veriga neskladna
  const corrupted = { ptsB2: [...base.ptsB2], ptsC: [...base.ptsC] };
  const victim = base.shared[1].bcIdx;
  corrupted.ptsC[victim] = { x: corrupted.ptsC[victim].x + 150, y: corrupted.ptsC[victim].y - 120 };
  const resCorrupt = measureFromChain({
    wA: W, hA: H, wB: W, hB: H, wC: W, hC: H,
    ptsA: base.ptsA, ptsB: base.ptsB, ptsB2: corrupted.ptsB2, ptsC: corrupted.ptsC,
    rand: lcg(42), focalMode: 'known', focalPx: F,
    reference: { ai: 0, bi: 1, cm: refCm },
    sharedTracks: base.shared,
  });
  check('pokvarjena skupna: ok=false (iskreno zavrnjena)', resCorrupt.ok === false, `code=${resCorrupt.code}, ok=${resCorrupt.ok}`);
  // iskrena zavrnitev: pokvarjena korespondenca NIKOLI ne da ok=true brez
  // opozoril — ali je residuala prevelika (BC_FAILED) ali se merila ne skladajo
  // (SCALE_INCONSISTENT) ali je transformacija neskladna (CHAIN_INCONSISTENT).
  check(
    'pokvarjena skupna: iskren code (BC/SCALE/CHAIN)',
    resCorrupt.code === 'BC_FAILED' || resCorrupt.code === 'SCALE_INCONSISTENT' || resCorrupt.code === 'CHAIN_INCONSISTENT',
    `code=${resCorrupt.code}`,
  );
  check(`konstanta MIN_SHARED_FOR_FULL=${MIN_SHARED_FOR_FULL}`, MIN_SHARED_FOR_FULL === 3);
}

console.log(`REZULTAT: ${okCount} OK, ${badCount} NAPAK`);
if (badCount > 0) process.exit(1);
