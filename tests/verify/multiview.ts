// Verifikacija klasične fotogrametrije iz več fotk (multiview-core, Faza 3)
// + razširitve statusne pogodbe (measurement-status: 'multi-view').
// Deterministično: sintetične scene z ZNANO resnico, brez canvasa/DOM/omrežja.
// Stil: tests/verify/photo-replace.ts (check helper, 'REZULTAT: N OK, N NAPAK').
import {
  MULTIVIEW_SCRIPT_VERSION,
  toGrayscale,
  findCorners,
  buildDescriptors,
  matchFeatures,
  lcg,
  sampsonResidualPx,
  estimateFundamental,
  focalCandidatesFromF,
  projectionMatrix,
  triangulateDLT,
  relativePose,
  matchPointOnEpipolar,
  measureFromPair,
} from '../../src/lib/multiview-core';
import type { XY, ImgData } from '../../src/lib/photo-replace-core';
import {
  validateMultiView,
  makeProvenance,
  explainWarning,
  MIN_MULTIVIEW_INLIERS,
  MAX_MULTIVIEW_RESIDUAL_PX,
} from '../../src/lib/measurement-status';

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
  return Number.isFinite(a) && Math.abs(a - b) <= tolAbs;
}

// ─── Sintetična scena z ZNANO resnico (ne-ravninska: globine 300–700 cm) ──

const FOC = 800;
const W = 800;
const H = 600;
const cx0 = W / 2;
const cy0 = H / 2;
const Kinv = [1 / FOC, 0, -cx0 / FOC, 0, 1 / FOC, -cy0 / FOC, 0, 0, 1];

function mul3d(a: number[], b: number[]): number[] {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}
function transpose3d(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

const th8 = (8 * Math.PI) / 180;
const R_TRUE = [Math.cos(th8), 0, Math.sin(th8), 0, 1, 0, -Math.sin(th8), 0, Math.cos(th8)];
const C2 = [70, 0, 0];
const T_TRUE = [
  -(R_TRUE[0] * C2[0] + R_TRUE[1] * C2[1] + R_TRUE[2] * C2[2]),
  -(R_TRUE[3] * C2[0] + R_TRUE[4] * C2[1] + R_TRUE[5] * C2[2]),
  -(R_TRUE[6] * C2[0] + R_TRUE[7] * C2[1] + R_TRUE[8] * C2[2]),
];
const skew3 = (t: number[]): number[] => [0, -t[2], t[1], t[2], 0, -t[0], -t[1], t[0], 0];
const E_TRUE = mul3d(skew3(T_TRUE), R_TRUE);
const F_TRUE = mul3d(transpose3d(Kinv), mul3d(E_TRUE, Kinv));

/** 3D točke v cm: mreža 6×5, globine 300–700 (izrazito ne-ravninsko). */
const X_TRUE: [number, number, number][] = [];
{
  const rr = lcg(11);
  for (let iv = 0; iv < 5; iv++) {
    for (let iu = 0; iu < 6; iu++) {
      const u = -120 + 48 * iu;
      const v = -95 + 47.5 * iv;
      const z = 300 + ((iu * 7 + iv * 13) % 5) * 100 + (rr() - 0.5) * 20;
      X_TRUE.push([u, v, z]);
    }
  }
}
function projPt(P: number[], X: [number, number, number]): XY {
  const d = P[8] * X[0] + P[9] * X[1] + P[10] * X[2] + P[11];
  return { x: (P[0] * X[0] + P[1] * X[1] + P[2] * X[2] + P[3]) / d, y: (P[4] * X[0] + P[5] * X[1] + P[6] * X[2] + P[7]) / d };
}
const P1_TRUE = projectionMatrix(FOC, W, H, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
const P2_TRUE = projectionMatrix(FOC, W, H, R_TRUE, T_TRUE);
const PA_EXACT = X_TRUE.map((X) => projPt(P1_TRUE, X));
const PB_EXACT = X_TRUE.map((X) => projPt(P2_TRUE, X));

const REF_PAIR = { ai: 0, bi: 5, cm: Math.hypot(
  X_TRUE[5][0] - X_TRUE[0][0], X_TRUE[5][1] - X_TRUE[0][1], X_TRUE[5][2] - X_TRUE[0][2]) };
const QUERIES = [
  { ai: 1, bi: 7 }, { ai: 2, bi: 13 }, { ai: 3, bi: 9 }, { ai: 11, bi: 25 }, { ai: 6, bi: 22 },
];
function gtDistanceCm(i: number, j: number): number {
  return Math.hypot(X_TRUE[j][0] - X_TRUE[i][0], X_TRUE[j][1] - X_TRUE[i][1], X_TRUE[j][2] - X_TRUE[i][2]);
}

// ─── 1) Osnovna geometrija na natančnih podatkih ─────────────
console.log('1) Natančna sintetična scena (znana resnica)');

{
  const fr = estimateFundamental(W, H, W, H, PA_EXACT, PB_EXACT, lcg(42));
  check('F ocenjena (30/30 točk)', fr !== null);
  if (fr) {
    check('vsi pari so inlierji', fr.inliers.length === 30, `inliers=${fr.inliers.length}`);
    check('srednja residuala ≈ 0', fr.meanResidualPx < 0.01, String(fr.meanResidualPx));
    const maxSamp = Math.max(...PA_EXACT.map((p, i) => sampsonResidualPx(fr.F, p, PB_EXACT[i])));
    check('max Sampsonova residuala < 0.01 px', maxSamp < 0.01, String(maxSamp));
    // F ≈ ±F_true (normalizirano)
    const nf = (F: number[]) => {
      const n = Math.hypot(...F);
      const out = F.map((v) => v / n);
      let mi = 0;
      for (let i = 1; i < 9; i++) if (Math.abs(out[i]) > Math.abs(out[mi])) mi = i;
      if (out[mi] < 0) for (let i = 0; i < 9; i++) out[i] = -out[i];
      return out;
    };
    const a = nf(fr.F);
    const b = nf(F_TRUE);
    const d = Math.hypot(...a.map((v, i) => v - b[i]));
    check('F se ujema z resnico (± skala)', d < 1e-6, String(d));

    // fokus iz F
    const cands = focalCandidatesFromF(fr.F, W, H);
    check('fokus: vsaj 1 kandidat', cands.length >= 1, JSON.stringify(cands.map((f) => Math.round(f))));
    const has800 = cands.some((f) => Math.abs(f - FOC) < 0.03 * FOC);
    check(`fokus ${FOC} px med kandidati (±3 %)`, has800);
    const candsTrue = focalCandidatesFromF(F_TRUE, W, H);
    check('fokus iz natačne F_true', candsTrue.some((f) => Math.abs(f - FOC) < 0.03 * FOC));

    // poza
    const pose = relativePose(fr.F, FOC, FOC, W, H, W, H, PA_EXACT, PB_EXACT, fr.inliers);
    check('relativna poza obstaja', pose !== null);
    if (pose) {
      let tr = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += pose.R[j * 3 + i] * R_TRUE[j * 3 + i];
      const rotDeg = (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
      check('rotacijska napaka < 0,1°', rotDeg < 0.1, `${rotDeg.toFixed(4)}°`);
      const nt = Math.hypot(...pose.t);
      const tcos = (pose.t[0] * T_TRUE[0] + pose.t[1] * T_TRUE[1] + pose.t[2] * T_TRUE[2]) / (nt * Math.hypot(...T_TRUE));
      check('smer translacije (cos > 0.9999)', Math.abs(tcos) > 0.9999, String(tcos));
    }

    // triangulacija
    const pose2 = relativePose(fr.F, FOC, FOC, W, H, W, H, PA_EXACT, PB_EXACT, fr.inliers);
    if (pose2) {
      const P2e = projectionMatrix(FOC, W, H, pose2.R, pose2.t);
      const tri = triangulateDLT(P1_TRUE, P2e, PA_EXACT[0], PB_EXACT[0]);
      check('triangulacija uspešna', tri !== null);
      if (tri) {
        check('reprojekcijska napaka < 0.01 px', tri.errPx < 0.01, String(tri.errPx));
        // X v enotah |t|: GT deljeno z |T_TRUE| = 70
        const s = Math.hypot(...T_TRUE);
        const dx = Math.abs(tri.X[0] - X_TRUE[0][0] / s);
        const dy = Math.abs(tri.X[1] - X_TRUE[0][1] / s);
        const dz = Math.abs(tri.X[2] - X_TRUE[0][2] / s);
        check('3D točka ≈ resnica/|t| (±0.02)', dx < 0.02 && dy < 0.02 && dz < 0.02, `d=(${dx.toFixed(4)},${dy.toFixed(4)},${dz.toFixed(4)})`);
      }
    }
  }
}

// ─── 2) measureFromPair: znani fokus + referenca ─────────────
console.log('2) measureFromPair — znani fokus + referenca');

{
  const res = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    reference: REF_PAIR,
    queries: QUERIES,
  });
  check('ok = true, code OK', res.ok && res.code === 'OK', res.code);
  check('F prisotna', res.F !== null && res.F.length === 9);
  check('inlierjev 30', res.inliers.length === 30);
  check('fokus uporabljen = 800', res.focalPx === FOC);
  check('fokus NI samokalibriran', res.focalSelfCal === false);
  check('poza prisotna', res.R !== null && res.t !== null);
  check('points3D prisotni', res.points3D !== null && res.points3D.length >= 30);
  check('scaleCmPerUnit > 0', res.scaleCmPerUnit !== null && res.scaleCmPerUnit > 0);
  check('brez opozorila o ravninski sceni', !res.warnings.some((w) => w.includes('ravninsk')), res.warnings.join(' | '));
  if (res.distancesCm) {
    check('število razdalj = queries', res.distancesCm.length === QUERIES.length);
    let maxRel = 0;
    for (let k = 0; k < QUERIES.length; k++) {
      const gt = gtDistanceCm(QUERIES[k].ai, QUERIES[k].bi);
      const got = res.distancesCm[k]?.cm ?? NaN;
      maxRel = Math.max(maxRel, Math.abs(got - gt) / gt);
    }
    check('razdalje ±1,5 % od resnice', maxRel < 0.015, `maxRel=${(maxRel * 100).toFixed(3)} %`);
  } else {
    check('razdalje prisotne', false);
  }
  // determinizem
  const res2 = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    reference: REF_PAIR,
    queries: QUERIES,
  });
  check('determinizem (identičen JSON)', JSON.stringify(res) === JSON.stringify(res2));
}

// ─── 3) measureFromPair: samokalibracija fokusa ──────────────
console.log('3) measureFromPair — samokalibracija (selfcal)');

{
  const res = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'selfcal',
    reference: REF_PAIR,
    queries: QUERIES,
  });
  check('ok = true', res.ok, res.code);
  check('fokus samokalibriran', res.focalSelfCal === true);
  check('fokus ≈ 800 (±3 %)', res.focalPx !== null && Math.abs(res.focalPx - FOC) < 0.03 * FOC, String(res.focalPx));
  check('opozorilo o ocenjenem fokusu', res.warnings.some((w) => w.includes('samokalibracija') || w.includes('ocenjen')));
  if (res.distancesCm) {
    let maxRel = 0;
    for (let k = 0; k < QUERIES.length; k++) {
      const gt = gtDistanceCm(QUERIES[k].ai, QUERIES[k].bi);
      const got = res.distancesCm[k]?.cm ?? NaN;
      maxRel = Math.max(maxRel, Math.abs(got - gt) / gt);
    }
    check('razdalje ±3 % od resnice', maxRel < 0.03, `maxRel=${(maxRel * 100).toFixed(3)} %`);
  } else {
    check('razdalje prisotne (selfcal)', false);
  }
}

// ─── 4) Šum ±0.7 px na vseh točkah ───────────────────────────
console.log('4) Robustnost na šum (±0,7 px)');

{
  const rr = lcg(7);
  const jitter = () => (rr() - 0.5) * 1.4;
  const pA = PA_EXACT.map((p) => ({ x: p.x + jitter(), y: p.y + jitter() }));
  const pB = PB_EXACT.map((p) => ({ x: p.x + jitter(), y: p.y + jitter() }));
  const fr = estimateFundamental(W, H, W, H, pA, pB, lcg(42));
  check('F pri šumu obstaja', fr !== null);
  if (fr) {
    check('inlierjev ≥ 26/30', fr.inliers.length >= 26, String(fr.inliers.length));
    check('srednja residuala < 1,5 px', fr.meanResidualPx < 1.5, String(fr.meanResidualPx));
    const res = measureFromPair({
      wA: W, hA: H, wB: W, hB: H,
      ptsA: pA, ptsB: pB,
      rand: lcg(42),
      focalMode: 'known', focalPx: FOC,
      reference: REF_PAIR,
      queries: QUERIES,
    });
    check('ok pri šumu', res.ok, res.code);
    if (res.distancesCm) {
      let maxRel = 0;
      for (let k = 0; k < QUERIES.length; k++) {
        const gt = gtDistanceCm(QUERIES[k].ai, QUERIES[k].bi);
        const got = res.distancesCm[k]?.cm ?? NaN;
        maxRel = Math.max(maxRel, Math.abs(got - gt) / gt);
      }
      check('razdalje ±6 % od resnice pri šumu (globine 300–700 cm)', maxRel < 0.06, `maxRel=${(maxRel * 100).toFixed(3)} %`);
    } else {
      check('razdalje prisotne pri šumu', false);
    }
  }
}

// ─── 5) Iskreni neuspehi (eksplicitne napake, nič tihega) ────
console.log('5) Iskreni neuspehi');

{
  const resFew = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT.slice(0, 5), ptsB: PB_EXACT.slice(0, 5),
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    reference: REF_PAIR,
  });
  check('5 parov → NO_MATCHES', !resFew.ok && resFew.code === 'NO_MATCHES', resFew.code);
  check('opozorilo o premalo parih', resFew.warnings.some((w) => w.includes('premalo')));
  check('brez merila (scaleCmPerUnit null)', resFew.scaleCmPerUnit === null);

  // kolinearne točke → degenerirana geometrija
  const lineA: XY[] = [];
  const lineB: XY[] = [];
  for (let i = 0; i < 12; i++) {
    lineA.push({ x: 100 + 40 * i, y: 200 + 30 * i });
    lineB.push({ x: 130 + 40 * i, y: 220 + 30 * i });
  }
  const resLine = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: lineA, ptsB: lineB,
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    reference: { ai: 0, bi: 1, cm: 100 },
  });
  check('kolinearne točke → ok:false', !resLine.ok, resLine.code);

  // prevelika residuala: polovica parov pomaknjena za 12 px
  const pBbad = PB_EXACT.map((p, i) => (i % 2 === 0 ? { x: p.x + 12, y: p.y + 12 } : p));
  const resBad = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: pBbad,
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    reference: REF_PAIR,
    queries: QUERIES,
  });
  check('raztresena ujemanja → RESIDUAL_HIGH', !resBad.ok && resBad.code === 'RESIDUAL_HIGH', resBad.code);
  check('brez mere ob RESIDUAL_HIGH', resBad.distancesCm === null && resBad.scaleCmPerUnit === null);

  // brez reference → NO_REFERENCE, a geometrija ostane
  const resNoRef = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'known', focalPx: FOC,
    queries: QUERIES,
  });
  check('brez reference → NO_REFERENCE', !resNoRef.ok && resNoRef.code === 'NO_REFERENCE', resNoRef.code);
  check('geometrija obstaja (points3D ≠ null)', resNoRef.points3D !== null);
  check('razdalje NI (distancesCm null)', resNoRef.distancesCm === null);
  check('merilo NI (scaleCmPerUnit null)', resNoRef.scaleCmPerUnit === null);
  check('opozorilo o razmerjih', resNoRef.warnings.some((w) => w.includes('razmerja')));

  // nevalidni fokus
  const resFoc1 = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'known', focalPx: NaN,
    reference: REF_PAIR,
  });
  check('fokus NaN → DEGENERATE_GEOMETRY', !resFoc1.ok && resFoc1.code === 'DEGENERATE_GEOMETRY', resFoc1.code);
  const resFoc2 = measureFromPair({
    wA: W, hA: H, wB: W, hB: H,
    ptsA: PA_EXACT, ptsB: PB_EXACT,
    rand: lcg(42),
    focalMode: 'preset', focalPx: 10,
    reference: REF_PAIR,
  });
  check('fokus 10 px (izven razpona) → DEGENERATE_GEOMETRY', !resFoc2.ok && resFoc2.code === 'DEGENERATE_GEOMETRY', resFoc2.code);

  // naključna (ne-esencialna) F → brez kandidatov za fokus (iskreno prazno)
  const rr = lcg(5);
  const rndF = Array.from({ length: 9 }, () => rr() - 0.5);
  const candsRnd = focalCandidatesFromF(rndF, W, H);
  check('naključna F → brez kandidatov fokusa', candsRnd.length === 0, JSON.stringify(candsRnd));

  // fokus selfcal na naključnem paru → DEGENERATE_GEOMETRY z opozorilom
  // (zgradimo pare, kjer F ocena uspe, a fokus ne: kolinearni + šum)
}

// ─── 6) Vogalne točke + ujemanje na sintetični sliki ─────────
console.log('6) Shi-Tomasi + NCC ujemanje (sintetična slika)');

/** Deskasta tekstura: NEperiodični trakovi + spoji (unikatni vogali) + determinističen šum. */
function makePlankImg(shiftX: number, shiftY: number, rotDeg: number): ImgData {
  const w = 240, h = 180;
  // neperiodični trakovi po y: širine/intenzitete iz determinističnega LCG
  // (modularni vzorci %N so periodični in povzročijo NCC ambiguitete!)
  const bands: { y0: number; y1: number; base: number }[] = [];
  {
    const rb = lcg(7);
    let y = 0;
    while (y < h) {
      const bw = 10 + Math.floor(rb() * 13);
      bands.push({ y0: y, y1: y + bw, base: 90 + Math.floor(rb() * 120) });
      y += bw;
    }
  }
  // neperiodični spoji po x
  const seams: { x: number; dark: number }[] = [];
  {
    const rs = lcg(9);
    let x = 0;
    while (x < w) {
      seams.push({ x, dark: -30 - Math.floor(rs() * 40) });
      x += 20 + Math.floor(rs() * 25);
    }
  }
  const noise = new Float64Array(w * h);
  {
    const rr = lcg(123);
    for (let i = 0; i < w * h; i++) noise[i] = (rr() - 0.5) * 24;
  }
  // gladen osvetljevalni gradient (kot na resnični fotografiji) — vsaka lokacija
  // dobi lokalni gradient, ki razlikuje sicer podobne strukture (band + spoj)
  const grad = (x: number, y: number): number => 30 * Math.sin(x / 37) * Math.cos(y / 23);
  const tex = (x: number, y: number, px: number): number => {
    let base = 128;
    for (const b of bands) if (y >= b.y0 && y < b.y1) { base = b.base; break; }
    let dark = 0;
    for (const s of seams) if (x >= s.x && x < s.x + 2) { dark = s.dark; break; }
    return base + dark + grad(x, y) + noise[px];
  };
  const data = new Uint8ClampedArray(w * h * 4);
  const cosr = Math.cos((rotDeg * Math.PI) / 180);
  const sinr = Math.sin((rotDeg * Math.PI) / 180);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - shiftX - w / 2;
      const dy = y - shiftY - h / 2;
      const sx = cosr * dx + sinr * dy + w / 2;
      const sy = -sinr * dx + cosr * dy + h / 2;
      const j = (y * w + x) * 4;
      let val: number;
      if (sx < 1 || sy < 1 || sx > w - 2 || sy > h - 2) {
        val = 128; // izven izvornika — sivi rob
      } else {
        val = tex(Math.round(sx), Math.round(sy), y * w + x);
      }
      data[j] = val; data[j + 1] = val; data[j + 2] = val; data[j + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

{
  const imgA = makePlankImg(0, 0, 0);
  const grayA = toGrayscale(imgA);
  const cornersA = findCorners(grayA, 240, 180);
  check('siva slika: prave dimenzije', grayA.length === 240 * 180);
  check('vogalov ≥ 40', cornersA.length >= 40, String(cornersA.length));
  check('vogalov ≤ maxCorners (600)', cornersA.length <= 600);
  check('vogali znotraj robov', cornersA.every((c) => c.x >= 1 && c.y >= 1 && c.x < 239 && c.y < 179));
  const cornersA2 = findCorners(toGrayscale(makePlankImg(0, 0, 0)), 240, 180);
  check('vogali deterministični', JSON.stringify(cornersA) === JSON.stringify(cornersA2));

  // pomaknjena + rahlo zasukana kopija
  const imgB = makePlankImg(6, 4, 1.5);
  const grayB = toGrayscale(imgB);
  const cornersB = findCorners(grayB, 240, 180);
  check('vogalov v B ≥ 40', cornersB.length >= 40, String(cornersB.length));

  const descA = buildDescriptors(grayA, 240, 180, cornersA, 9);
  const descB = buildDescriptors(grayB, 240, 180, cornersB, 9);
  // majhna baza (zasuk 1,5° + zamik ~7 px) → pričakovano omejitev premika 10 %
  const matches = matchFeatures(cornersA, descA, cornersB, descB, { width: 240, height: 180 }, { width: 240, height: 180 }, { maxDisplacementPct: 10 });
  check('ujemanj ≥ 10 (ratio test + omejitev premika)', matches.length >= 10, String(matches.length));
  // pričakovani premik per-corner iz znane afine preslikave: B je vzorčena z
  // INVERZNO preslikavo (zasuk +1,5° + zamik), zato je delegana preslikava
  // A→B zasuk −1,5° okoli središča + zamik (6,4)
  const c1p5 = Math.cos((1.5 * Math.PI) / 180);
  const s1p5 = -Math.sin((1.5 * Math.PI) / 180);
  const expectedB = (x: number, y: number): XY => ({
    x: c1p5 * (x - 120) + s1p5 * (y - 90) + 120 + 6,
    y: -s1p5 * (x - 120) + c1p5 * (y - 90) + 90 + 4,
  });
  const dispOk = matches.filter((m) => {
    const a = cornersA[m.ai];
    const b = cornersB[m.bi];
    const e = expectedB(a.x, a.y);
    return Math.hypot(b.x - e.x, b.y - e.y) < 3.5;
  });
  check('≥ 60 % ujemanj z pravilno afino preslikavo ±3,5 (kvantizacija vogalov)', matches.length > 0 && dispOk.length >= 0.6 * matches.length, `${dispOk.length}/${matches.length}`);
  // pravilna ujemanja so podpikselno natančna
  const dispTight = matches.filter((m) => {
    const a = cornersA[m.ai];
    const b = cornersB[m.bi];
    const e = expectedB(a.x, a.y);
    return Math.hypot(b.x - e.x, b.y - e.y) < 1.5;
  });
  check('vsaj 8 ujemanj podpikselno (±1,5)', dispTight.length >= 8, String(dispTight.length));
  check('NCC vseh ujemanj ≥ 0.86', matches.every((m) => m.ncc >= 0.86));
  // mutual best: brez duplikatov po bi
  const bis = new Set(matches.map((m) => m.bi));
  check('medsebojni najboljši (unikatni bi)', bis.size === matches.length);
  // prag
  const matchesStrict = matchFeatures(cornersA, descA, cornersB, descB, { width: 240, height: 180 }, { width: 240, height: 180 }, { minNcc: 0.999 });
  check('strožji prag → manj ali enako ujemanj', matchesStrict.length <= matches.length);

  // F iz slikovnih ujemanj (RANSAC odstrani morebitne izstopnike)
  const pA = dispOk.map((m) => ({ x: cornersA[m.ai].x, y: cornersA[m.ai].y }));
  const pB = dispOk.map((m) => ({ x: cornersB[m.bi].x, y: cornersB[m.bi].y }));
  const frImg = estimateFundamental(240, 180, 240, 180, pA, pB, lcg(42));
  check('F iz slikovnih ujemanj obstaja', frImg !== null);
  if (frImg) {
    check('RANSAC: večina slikovnih parov so inlierji', frImg.inliers.length >= Math.ceil(0.6 * pA.length), `${frImg.inliers.length}/${pA.length}`);
    check('slikovna residuala (inlierji) < 1,5 px', frImg.meanResidualPx < 1.5, String(frImg.meanResidualPx));
    // matchPointOnEpipolar: točka iz A najde korespondenco v B
    const probe = cornersA[0];
    const truePt = expectedB(probe.x, probe.y);
    const trueBx = truePt.x;
    const trueBy = truePt.y;
    const found = matchPointOnEpipolar(grayA, 240, 180, probe.x, probe.y, grayB, 240, 180, frImg.F, { radiusPx: 20 });
    check('epipolarno iskanje najde točko', found !== null);
    if (found) {
      const d = Math.hypot(found.x - trueBx, found.y - trueBy);
      check('najdena točka ±3 px od resnice', d < 3, `d=${d.toFixed(2)} px`);
      check('NCC ≥ 0.8', found.ncc >= 0.8, String(found.ncc));
    }
    // degenerirana F → null
    const foundNull = matchPointOnEpipolar(grayA, 240, 180, probe.x, probe.y, grayB, 240, 180, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    check('F = 0 → null (degenerirana črta)', foundNull === null);
  }
}

// ─── 7) Statusna pogodba: validateMultiView + makeProvenance ─
console.log('7) Statusna pogodba (multi-view)');

{
  // premalo inlierjev
  const v1 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS - 1, meanResidualPx: 1, focalMode: 'known', referenceKnown: true });
  check('premalo inlierjev → MULTIVIEW_DEGENERATE', !v1.ok && v1.code === 'MULTIVIEW_DEGENERATE', v1.code);
  check('status null pri degenerirani', v1.status === null);
  check('sporočilo NEZADOSTNI PODATKI', v1.message.includes('NEZADOSTNI PODATKI'));
  // residuala prevelika
  const v2 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: MAX_MULTIVIEW_RESIDUAL_PX + 0.5, focalMode: 'known', referenceKnown: true });
  check('residuala > max → RESIDUAL_HIGH', !v2.ok && v2.code === 'RESIDUAL_HIGH', v2.code);
  // brez reference
  const v3 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: 1, focalMode: 'known', referenceKnown: false });
  check('brez reference → NO_CALIBRATION', !v3.ok && v3.code === 'NO_CALIBRATION', v3.code);
  // preset / selfcal → AUTO_SUGGESTED
  const v4 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: 1, focalMode: 'preset', referenceKnown: true });
  check('preset → ASSUMED_SCALE / AUTO_SUGGESTED', v4.ok && v4.code === 'ASSUMED_SCALE' && v4.status === 'AUTO_SUGGESTED');
  const v5 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: 1, focalMode: 'selfcal', referenceKnown: true });
  check('selfcal → ASSUMED_SCALE / AUTO_SUGGESTED', v5.ok && v5.code === 'ASSUMED_SCALE' && v5.status === 'AUTO_SUGGESTED');
  // known + referenca → CALIBRATED
  const v6 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: 1, focalMode: 'known', referenceKnown: true });
  check('known + referenca → OK / CALIBRATED', v6.ok && v6.code === 'OK' && v6.status === 'CALIBRATED');
  // override pragi
  const v7 = validateMultiView({ inlierCount: 6, meanResidualPx: 1, focalMode: 'known', referenceKnown: true, minInliers: 5 });
  check('minInliers override (6 ≥ 5) → naprej', v7.ok);
  const v8 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: 5, focalMode: 'known', referenceKnown: true, maxResidualPx: 10 });
  check('maxResidualPx override (5 ≤ 10) → naprej', v8.ok);
  const v9 = validateMultiView({ inlierCount: 5, meanResidualPx: 1, focalMode: 'known', referenceKnown: true, minInliers: 5 });
  check('inlieri = min (meja) → naprej', v9.ok);
  const v10 = validateMultiView({ inlierCount: MIN_MULTIVIEW_INLIERS, meanResidualPx: MAX_MULTIVIEW_RESIDUAL_PX, focalMode: 'known', referenceKnown: true });
  check('residuala = max (meja) → naprej', v10.ok);

  // makeProvenance z multi-view
  const prov = makeProvenance({
    method: 'multi-view',
    status: 'CALIBRATED',
    valueCm: 250.5,
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    reference: { valueCm: 150, label: 'odsek ograje', assumed: false },
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  check('makeProvenance sprejme multi-view', prov.method === 'multi-view');
  check('privzeta transformacija = multi-view-triangulation', prov.transform === 'multi-view-triangulation');
  check('scriptVersion = MEASUREMENT_SCRIPT_VERSION', prov.scriptVersion === '1.0.0');
  check('provenance deterministična', JSON.stringify(prov) === JSON.stringify(makeProvenance({
    method: 'multi-view', status: 'CALIBRATED', valueCm: 250.5,
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    reference: { valueCm: 150, label: 'odsek ograje', assumed: false },
    createdAt: '2025-01-01T00:00:00.000Z',
  })));

  // pogodba še vedno velja: assumed-reference nikoli potrjena
  let threw = false;
  try {
    makeProvenance({ method: 'assumed-reference', status: 'CONFIRMED', valueCm: 10, createdAt: '2025-01-01T00:00:00.000Z' });
  } catch {
    threw = true;
  }
  check('assumed-reference + CONFIRMED še vedno vrže', threw);
  threw = false;
  try {
    makeProvenance({ method: 'multi-view-x' as unknown as 'multi-view', status: 'CALIBRATED', valueCm: 10, createdAt: '2025-01-01T00:00:00.000Z' });
  } catch {
    threw = true;
  }
  check('neznana metoda vrže', threw);

  // explainWarning za novi kodi
  const e1 = explainWarning('MULTIVIEW_DEGENERATE');
  const e2 = explainWarning('RESIDUAL_HIGH');
  check('explainWarning(MULTIVIEW_DEGENERATE) neprazno + fotke', e1.length > 40 && e1.includes('fotk'));
  check('explainWarning(RESIDUAL_HIGH) neprazno + epipolarn', e2.length > 40 && e2.includes('epipolarn'));
  check('explainWarning(NO_CALIBRATION) nespremenjen', explainWarning('NO_CALIBRATION').includes('NI mogoče izračunati nobene dolžine'));
}

// ─── 8) Verzija ──────────────────────────────────────────────
console.log('8) Verzija skripte');
check('MULTIVIEW_SCRIPT_VERSION neprazen', typeof MULTIVIEW_SCRIPT_VERSION === 'string' && MULTIVIEW_SCRIPT_VERSION.length > 0);

// ─── 9) Faza 4: matchPointOnEpipolar ob VELIKEM premiku (popravek v1.1.0) ──
// Stara implementacija je iskala v škatli (xA±radius, yA±radius) — pri
// resničnem premiku kamere (> radius) prava korespondenca ni bila dosegljiva.
// Ta scena ima premik ~45 px (> radiusPx 20 in > privzetega 24): stara koda
// bi VSE probes zavrnila, popravljena (iskanje po črti čez B) jih najde.
console.log('9) Faza 4 — epipolarno iskanje ob velikem premiku (~45 px)');
{
  // B = FIZIKALNO prava preslikava A (tekstura, šum in gradient v IZVORNIH
  // koordinatah) — makePlankImg indeksira šum/gradient po destinaciji, kar pri
  // velikem premiku uniči fotometrijsko konsistentnost (NCC padne). Ta fixture
  // je ekvivalent resničnega para fotk: ista scena, drugačka geometrija.
  const makeShiftImg = (shiftX: number, shiftY: number, rotDeg: number): ImgData => {
    const w = 240, h = 180;
    const bands: { y0: number; y1: number; base: number }[] = [];
    { const rb = lcg(7); let y = 0; while (y < h) { const bw = 10 + Math.floor(rb() * 13); bands.push({ y0: y, y1: y + bw, base: 90 + Math.floor(rb() * 120) }); y += bw; } }
    const seams: { x: number; dark: number }[] = [];
    { const rs = lcg(9); let x = 0; while (x < w) { seams.push({ x, dark: -30 - Math.floor(rs() * 40) }); x += 20 + Math.floor(rs() * 25); } }
    const noise = new Float64Array(w * h);
    { const rr = lcg(123); for (let i = 0; i < w * h; i++) noise[i] = (rr() - 0.5) * 24; }
    const grad = (x: number, y: number): number => 30 * Math.sin(x / 37) * Math.cos(y / 23);
    const srcTex = (sx: number, sy: number): number => {
      let base = 128;
      for (const b of bands) if (sy >= b.y0 && sy < b.y1) { base = b.base; break; }
      let dark = 0;
      for (const s of seams) if (sx >= s.x && sx < s.x + 2) { dark = s.dark; break; }
      return base + dark + grad(sx, sy) + noise[Math.round(sy) * w + Math.round(sx)];
    };
    const data = new Uint8ClampedArray(w * h * 4);
    const cosr = Math.cos((rotDeg * Math.PI) / 180);
    const sinr = Math.sin((rotDeg * Math.PI) / 180);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - shiftX - w / 2;
        const dy = y - shiftY - h / 2;
        const sx = cosr * dx + sinr * dy + w / 2;
        const sy = -sinr * dx + cosr * dy + h / 2;
        const j = (y * w + x) * 4;
        const val = (sx < 1 || sy < 1 || sx > w - 2 || sy > h - 2) ? 128 : srcTex(Math.round(sx), Math.round(sy));
        data[j] = val; data[j + 1] = val; data[j + 2] = val; data[j + 3] = 255;
      }
    }
    return { width: w, height: h, data };
  };
  const imgA = makeShiftImg(0, 0, 0);
  const imgB = makeShiftImg(40, 20, 1.5); // A→B: zasuk −1,5° + zamik (40, 20) → premik ~45 px
  const grayA = toGrayscale(imgA);
  const grayB = toGrayscale(imgB);
  const cA = findCorners(grayA, 240, 180);
  const cB = findCorners(grayB, 240, 180);
  const dA = buildDescriptors(grayA, 240, 180, cA, 9);
  const dB = buildDescriptors(grayB, 240, 180, cB, 9);
  const matches = matchFeatures(cA, dA, cB, dB, { width: 240, height: 180 }, { width: 240, height: 180 }, { maxDisplacementPct: 30 });
  check('velik premik: ujemanj ≥ 10', matches.length >= 10, String(matches.length));
  const c15 = Math.cos((1.5 * Math.PI) / 180);
  const s15 = -Math.sin((1.5 * Math.PI) / 180);
  const expectedB = (x: number, y: number): XY => ({
    x: c15 * (x - 120) + s15 * (y - 90) + 120 + 40,
    y: -s15 * (x - 120) + c15 * (y - 90) + 90 + 20,
  });
  const pA = matches.map((m) => ({ x: cA[m.ai].x, y: cA[m.ai].y }));
  const pB = matches.map((m) => ({ x: cB[m.bi].x, y: cB[m.bi].y }));
  // F iz ujemanj, ki so skladna z znano afino preslikavo ±3,5 px — robovi
  // sintetične fotke B (sivi margin) ustvarjajo lažne korespondence, ki bi
  // kontaminirale F; ta filter je enak vzorcu sekcije 6 (dispOk).
  const dispOk = matches.filter((m) => {
    const a = cA[m.ai];
    const e = expectedB(a.x, a.y);
    const b = cB[m.bi];
    return Math.hypot(b.x - e.x, b.y - e.y) < 3.5;
  });
  check('velik premik: ≥ 8 pravilnih ujemanj', dispOk.length >= 8, String(dispOk.length));
  const frP = dispOk.map((m) => ({ x: cA[m.ai].x, y: cA[m.ai].y }));
  const frQ = dispOk.map((m) => ({ x: cB[m.bi].x, y: cB[m.bi].y }));
  const fr = estimateFundamental(240, 180, 240, 180, frP, frQ, lcg(42));
  check('velik premik: F ocenjena', fr !== null);
  if (fr) {
    check('velik premik: residuala < 1,5 px', fr.meanResidualPx < 1.5, String(fr.meanResidualPx));
    // probes: notranje točke, katerih resnica je še v teksturnem delu B
    // (zamik 40 px + patch 5 px roba → x < 190, y < 150)
    const probes = frP.filter((p) => p.x > 40 && p.x < 190 && p.y > 30 && p.y < 150).slice(0, 4);
    check('velik premik: ≥ 3 probe znotraj', probes.length >= 3, String(probes.length));
    let foundN = 0;
    for (const p of probes) {
      const e = expectedB(p.x, p.y);
      const f = matchPointOnEpipolar(grayA, 240, 180, p.x, p.y, grayB, 240, 180, fr.F, { radiusPx: 20 });
      if (!f) continue;
      foundN++;
      const dTrue = Math.hypot(f.x - e.x, f.y - e.y);
      const dClick = Math.hypot(f.x - p.x, f.y - p.y);
      if (foundN === 1) {
        check('najdena korespondenca ±3 px od resnice', dTrue < 3, `d=${dTrue.toFixed(2)} px`);
        check('korespondenca je > radius od klika (dokaz popravka)', dClick > 24, `dClick=${dClick.toFixed(1)} px`);
        check('NCC ≥ 0.8', f.ncc >= 0.8, String(f.ncc));
      }
    }
    check('vse probe najdejo korespondenco (prej: 0/…)', foundN === probes.length, `${foundN}/${probes.length}`);
    // determinizem
    const f1 = matchPointOnEpipolar(grayA, 240, 180, probes[0].x, probes[0].y, grayB, 240, 180, fr.F, { radiusPx: 20 });
    const f2 = matchPointOnEpipolar(grayA, 240, 180, probes[0].x, probes[0].y, grayB, 240, 180, fr.F, { radiusPx: 20 });
    check('determinizem (identična rezultata)', JSON.stringify(f1) === JSON.stringify(f2));
    // cap premika: maxDisplacementPct 1 → maxSpan ≈ 21 px < 56 → null
    const capped = matchPointOnEpipolar(grayA, 240, 180, probes[0].x, probes[0].y, grayB, 240, 180, fr.F, { radiusPx: 20, maxDisplacementPct: 1 });
    check('cap premika (maxDisplacementPct 1) iskreno zavrne', capped === null);
    // gladko območje (brez teksture) → null (NCC nedefinirana/low)
    const flatB = new Float64Array(240 * 180).fill(128);
    const flat = matchPointOnEpipolar(grayA, 240, 180, probes[0].x, probes[0].y, flatB, 240, 180, fr.F, { radiusPx: 20 });
    check('brez teksture v B → null', flat === null);
    // točka izven fotke A → null
    const out = matchPointOnEpipolar(grayA, 240, 180, 500, 90, grayB, 240, 180, fr.F, { radiusPx: 20 });
    check('klik izven fotke A → null', out === null);
  }
}

// ─── Rezultat ────────────────────────────────────────────────
console.log(`\nREZULTAT: ${okCount} OK, ${badCount} NAPAK`);
process.exit(badCount > 0 ? 1 : 0);
