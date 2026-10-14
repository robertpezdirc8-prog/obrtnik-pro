// Numerična verifikacija colmap-model (bun, brez brskalnika) — Task 47
// Resnica iz uradne specifikacije (colmap.github.io/format.html) in ročno
// izračunanih kvaternionov: identiteta → center = −T; rotacija 90° okoli
// Z osi; znane razdalje in merilo.
import {
  calibrateScale,
  cameraCenterFromPose,
  modelBBox,
  modelDistanceUnits,
  modelPointById,
  parseCamerasTxt,
  parseColmapModel,
  parseImagesTxt,
  parsePoints3DTxt,
  quatToRotationMatrix,
  scaledDistanceCm,
} from '../../src/lib/colmap-model';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(got)}`);
  }
}
const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a !== null && a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tol;
const close3 = (v: [number, number, number], e: [number, number, number], tol = 1e-9) =>
  Math.abs(v[0] - e[0]) <= tol && Math.abs(v[1] - e[1]) <= tol && Math.abs(v[2] - e[2]) <= tol;

// ── 1) Kvaternion → rotacijska matrika ──
{
  const R = quatToRotationMatrix(1, 0, 0, 0);
  check('kvat identiteta: R = I', close(R[0][0], 1) && close(R[1][1], 1) && close(R[2][2], 1) && close(R[0][1], 0), R);
  // 90° okoli Z: q = (√2/2, 0, 0, √2/2) → R = [[0,-1,0],[1,0,0],[0,0,1]]
  const s = Math.SQRT1_2;
  const Rz = quatToRotationMatrix(s, 0, 0, s);
  check('kvat 90° Z: R[0] = [0,-1,0]', close3([Rz[0][0], Rz[0][1], Rz[0][2]], [0, -1, 0]), Rz[0]);
  check('kvat 90° Z: R[1] = [1,0,0]', close3([Rz[1][0], Rz[1][1], Rz[1][2]], [1, 0, 0]), Rz[1]);
}

// ── 2) Center kamere = −Rᵗ·T ──
{
  const c = cameraCenterFromPose(1, 0, 0, 0, 1, 2, 3);
  check('center: identiteta → (−1,−2,−3)', close3(c, [-1, -2, -3]), c);
  // 90° okoli Z, T = (1,0,0): RᵗT = (0,−1,0) → center = −RᵗT = (0,+1,0)
  const s = Math.SQRT1_2;
  const c2 = cameraCenterFromPose(s, 0, 0, s, 1, 0, 0);
  check('center: 90° Z + T(1,0,0) → (0,+1,0)', close3(c2, [0, 1, 0]), c2);
}

// ── 3) Parser cameras.txt (primer iz uradne spec) ──
{
  const cams = parseCamerasTxt(
    '# Camera list with one line of data per camera:\n' +
      '# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n' +
      '1 SIMPLE_PINHOLE 3072 2304 2559.81 1536 1152\n' +
      '2 PINHOLE 3072 2304 2560.56 2560.56 1536 1152\n',
  );
  check('kamere: št. 2', cams.length === 2, cams.length);
  check('kamere: model SIMPLE_PINHOLE', cams[0].model === 'SIMPLE_PINHOLE', cams[0].model);
  check('kamere: 3 parametri pri SIMPLE_PINHOLE (f, cx, cy)', cams[0].params.length === 3 && close(cams[0].params[0], 2559.81), cams[0].params);
  check('kamere: 4 parametri pri PINHOLE (fx, fy, cx, cy)', cams[1].params.length === 4, cams[1].params.length);
}

// ── 4) Parser images.txt (primer iz uradne spec) ──
{
  const imgs = parseImagesTxt(
    '# Image list with two lines of data per image:\n' +
      '1 0.851773 0.0165051 0.503764 -0.142941 -0.737434 1.02973 3.74354 1 P1180141.JPG\n' +
      '2362.39 248.498 58396 1784.7 268.254 59027 1784.7 268.254 -1\n' +
      '2 0.851773 0.0165051 0.503764 -0.142941 -0.737434 1.02973 3.74354 1 P1180142.JPG\n' +
      '1190.83 663.957 23056 1258.77 640.354 59070\n',
  );
  check('fotke: št. 2', imgs.length === 2, imgs.length);
  check('fotke: ime 1.', imgs[0].name === 'P1180141.JPG', imgs[0].name);
  check('fotke: cameraId 1', imgs[0].cameraId === 1, imgs[0].cameraId);
  check('fotke: opazovane točke 1. = [58396, 59027] (−1 izpuščen)', JSON.stringify(imgs[0].observedPointIds) === '[58396,59027]', imgs[0].observedPointIds);
  check('fotke: opazovane točke 2. = [23056, 59070]', JSON.stringify(imgs[1].observedPointIds) === '[23056,59070]', imgs[1].observedPointIds);
  // Center 1. fotke — ročno iz kvaterniona (deterministično, enaka formula):
  const expect = cameraCenterFromPose(0.851773, 0.0165051, 0.503764, -0.142941, -0.737434, 1.02973, 3.74354);
  check('fotke: center = −RᵗT', close3(imgs[0].center, expect), imgs[0].center);
  // Normaliziran kvaternion → |center| mora biti stabilen: |T| iz identitete preverjen zgoraj
  check('fotke: center je finite', imgs[0].center.every((v) => Number.isFinite(v)), imgs[0].center);
}

// ── 5) Parser points3D.txt (primer iz uradne spec) ──
{
  const pts = parsePoints3DTxt(
    '# 3D point list with one line of data per point:\n' +
      '63390 1.67241 0.292931 0.609726 115 121 122 1.33927 16 6542 15 7345 6 6714 14 7227\n' +
      '63376 2.01848 0.108877 -0.0260841 102 209 250 1.73449 16 6519 15 7322 14 7212 8 3991\n',
  );
  check('točke: št. 2', pts.length === 2, pts.length);
  check('točke: id 63390', pts[0].id === 63390, pts[0].id);
  check('točke: xyz 1. točke', close3(pts[0].xyz, [1.67241, 0.292931, 0.609726]), pts[0].xyz);
  check('točke: rgb 1. = [115,121,122]', JSON.stringify(pts[0].rgb) === '[115,121,122]', pts[0].rgb);
  check('točke: track 1. = 4 pare', pts[0].trackCount === 4, pts[0].trackCount);
  check('točke: error 1. = 1.33927', close(pts[0].error, 1.33927), pts[0].error);
}

// ── 6) Iskrene napake parserjev ──
{
  let err = '';
  try {
    parsePoints3DTxt('# samo komentar\n');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: prazne točke → izrecna', err.includes('ni podatkovnih vrstic'), err);
  err = '';
  try {
    parseImagesTxt('1 1 0 0 0 0 0 0 1 a.jpg\nXY 1 2\n');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: neštevilska vrednost z vrstico', err.includes('images.txt') && err.includes('ni veljavna številka'), err);
  err = '';
  try {
    parseImagesTxt('1 1 0 0 0 0 0 0 1 a.jpg\n');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: liho število vrstic', err.includes('liho število vrstic'), err);
  err = '';
  try {
    parsePoints3DTxt('1 0 0 0 255 255 255\n'); // manjka ERROR
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: premalo polj', err.includes('vsaj 8 polj'), err);
  err = '';
  try {
    parseCamerasTxt('1 SIMPLE_PINHOLE 3072 2304 1 2 3\n1 SIMPLE_PINHOLE 3072 2304 1 2 3\n');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: podvojen CAMERA_ID', err.includes('podvojen CAMERA_ID'), err);
}

// ── 7) Združen model + preverjanje sklicev ──
{
  let err = '';
  try {
    parseColmapModel({
      cameras: '1 SIMPLE_PINHOLE 100 100 50 50 50\n',
      images: '1 1 0 0 0 0 0 0 99 a.jpg\n0 0 1\n',
      points3D: '1 0 0 0 255 255 255 0\n',
    });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: neobstoječ CAMERA_ID', err.includes('CAMERA_ID 99'), err);
  err = '';
  try {
    parseColmapModel({
      cameras: '1 SIMPLE_PINHOLE 100 100 50 50 50\n',
      images: '1 1 0 0 0 0 0 0 1 a.jpg\n0 0 777\n',
      points3D: '1 0 0 0 255 255 255 0\n',
    });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check('napaka: točka 777 v points3D ni', err.includes('točko 777'), err);
}

// ── 8) Razdalje + merilo (ročna resnica) ──
{
  const model = parseColmapModel({
    cameras: '1 SIMPLE_PINHOLE 100 100 50 50 50\n',
    images: '1 1 0 0 0 0 0 0 1 a.jpg\n0 0 1 0 0 2\n',
    points3D:
      '1 0 0 0 255 0 0 0\n' +
      '2 3 4 0 0 255 0 0\n' + // razdalja 1→2 = 5 enot (trik 3-4-5)
      '3 0 0 0 0 0 255 0\n', // razdalja 1→3 = 0
  });
  check('razdalja 1→2 = 5 enot', close(modelDistanceUnits(model, 1, 2), 5), modelDistanceUnits(model, 1, 2));
  check('razdalja 1→3 = 0', close(modelDistanceUnits(model, 1, 3), 0), modelDistanceUnits(model, 1, 3));
  check('razdalja: neobstoječa točka → null', modelDistanceUnits(model, 1, 999) === null, modelDistanceUnits(model, 1, 999));
  check('točka po ID', modelPointById(model, 2)?.xyz[0] === 3, modelPointById(model, 2));
  // Merilo: 5 enot = 100 cm → skala 20 cm/enota; 2,5 enot = 50 cm
  const scale = calibrateScale(5, 100);
  check('skala 100/5 = 20', close(scale, 20), scale);
  check('razdalja cm: 2,5 enot → 50 cm', close(scaledDistanceCm(2.5, scale as number), 50), scaledDistanceCm(2.5, scale as number));
  check('skala: enote 0 → null', calibrateScale(0, 100) === null, calibrateScale(0, 100));
  check('skala: realCm −5 → null', calibrateScale(5, -5) === null, calibrateScale(5, -5));
  check('skala: NaN → null', calibrateScale(NaN, 100) === null, calibrateScale(NaN, 100));
  check('cm: negativna skala → null', scaledDistanceCm(2, -1) === null, scaledDistanceCm(2, -1));
}

// ── 9) Ovojnica ──
{
  const model = parsePoints3DTxt('1 0 0 0 0 0 0 0\n2 2 3 0 0 0 0 0\n3 0 0 4 0 0 0 0\n');
  const bb = modelBBox(model);
  check('bbox: obstaja', bb !== null, bb);
  check('bbox: min (0,0,0)', close3((bb as NonNullable<typeof bb>).min, [0, 0, 0]), bb?.min);
  check('bbox: max (2,3,4)', close3((bb as NonNullable<typeof bb>).max, [2, 3, 4]), bb?.max);
  check('bbox: diagonala √29', close((bb as NonNullable<typeof bb>).diag, Math.sqrt(29)), bb?.diag);
  check('bbox: prazno → null', modelBBox([]) === null, modelBBox([]));
}

console.log(`\nRezultat: ${pass} uspešnih, ${fail} neuspešnih`);
if (fail > 0) process.exit(1);
