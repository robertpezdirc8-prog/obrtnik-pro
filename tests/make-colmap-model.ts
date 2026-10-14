// Generira sintetični COLMAP model (text format) z ZNANO resnico za E2E testiranje.
// Resnica (enote modela): točke 1–8; razdalja 1→2 = 2,5 enot (referenca = 100 cm
// → merilo 40 cm/enoto); 2→3 = 2,0 (80 cm); 1→6 = 5,0 (200 cm); 1→5 = √2,8125 ≈ 1,67705 (67,08 cm).
// Pozicije kamer iz identitetnega kvaterniona: center = −T (uradna spec).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'tests', 'colmap-fixture');
mkdirSync(dir, { recursive: true });

// cameras.txt — 1 kamera (SIMPLE_RADIAL: f, cx, cy, k1)
const cameras = [
  '# Camera list with one line of data per camera:',
  '# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]',
  '# Number of cameras: 1',
  '1 SIMPLE_RADIAL 1920 1080 1500 960 540 0.01',
  '',
].join('\n');

// images.txt — 3 fotke, identity kvaternion → center = −T
// T = (−1,−3,−5) → center (1,3,5); T = (2,−2.5,−4) → center (−2,2.5,4); T = (−3,−4,−6) → center (3,4,6)
const images = [
  '# Image list with two lines of data per image:',
  '# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
  '# POINTS2D[] as (X, Y, POINT3D_ID)',
  '# Number of images: 3, mean observations per image: 3',
  '1 1 0 0 0 -1 -3 -5 1 fence_left.JPG',
  '100 100 1 200 100 2 150 100 3 300 100 6 250 100 -1',
  '2 1 0 0 0 2 -2.5 -4 1 fence_center.JPG',
  '110 120 1 210 120 2 310 120 4',
  '3 1 0 0 0 -3 -4 -6 1 fence_right.JPG',
  '120 90 3 220 90 5 20 90 7',
  '',
].join('\n');

// points3D.txt — 8 točk z barvami; 1→2 = 2,5; 2→3 = 2,0; 1→6 = 5,0; 1→5 = 1,67705...
const points3D = [
  '# 3D point list with one line of data per point:',
  '# POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)',
  '# Number of points: 8, mean track length: 2',
  '1 0 0 0 180 120 90 0.5 1 0 2 2',
  '2 2.5 0 0 170 130 80 0.4 1 1 2 1',
  '3 2.5 2 0 160 140 70 0.3 1 2 3 0',
  '4 0 2 0 150 150 60 0.6 2 2',
  '5 1.25 1 0.5 140 160 50 0.7 3 1',
  '6 5 0 0 130 170 40 0.8 1 3',
  '7 0 -1 0 120 180 30 0.9 3 2',
  '8 2.5 0 1 110 190 20 1.0',
  '',
].join('\n');

writeFileSync(join(dir, 'cameras.txt'), cameras);
writeFileSync(join(dir, 'images.txt'), images);
writeFileSync(join(dir, 'points3D.txt'), points3D);
console.log(`Fixture zapisana v ${dir} (8 točk, 3 fotke, 1 kamera)`);
console.log('Resnica: 1→2 = 2,5 enot | 2→3 = 2,0 | 1→6 = 5,0 | 1→5 ≈ 1,67705 enot');
