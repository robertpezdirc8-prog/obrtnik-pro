// ─── Generator sintetične E2E fotke za predlog profila (Task 66) ────────────
// Deterministična fotka „stare ograje" (1280×890) z NAVPIČNIMI deskami ZNANE
// širine: ravnina na 12–88 % × 48–92 % fotke (TOČNO demo kvadrant — kalibracija
// je potem točna), realni meri 500×180 cm. Deske: 10 cm širine + 2 cm reža
// (perioda 12 cm = 30,72 px po fotki; deska = 25,6 px).
// MERITEV V E2E: klik na x = 12,0 % in 13,5 % (zaokrožitev stagePct na 0,1 %)
// → planeDistanceCm = 9,9 cm → suggestProfiles → polna-100 (diff 0,1 ≤ 0,3 →
// "natančno ujemanje"). Ta skripta IZRAČUNA pričakovano vrednost iz enake
// homografije (ne trda kode!) — tests/verify/photo-profile-suggest dokazuje
// knjižnico, E2E dokazuje UI tok.
// Izhod: /tmp/e2e-suggest-photo.b64 (PNG base64 za brskalnik)
// Zagon: bun tests/e2e-suggest-fixture.ts
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { calibratePlane, planeDistanceCm } from '../src/lib/homography';

const W = 1280;
const H = 890;
// ravnina = demo kvadrant (12–88 % × 48–92 %)
const X0 = 0.12 * W;    // 153,6
const X1 = 0.88 * W;    // 1126,4
const Y0 = 0.48 * H;    // 427,2
const Y1 = 0.92 * H;    // 818,8
const PLANE_W_CM = 500;
const PLANE_H_CM = 180;
const PLANK_CM = 10;
const GAP_CM = 2;

const pxPerCm = (X1 - X0) / PLANE_W_CM;
const periodPx = (PLANK_CM + GAP_CM) * pxPerCm;   // 30,72
const plankPx = PLANK_CM * pxPerCm;               // 25,6

function pixel(x: number, y: number): [number, number, number] {
  const inQuad = x >= X0 && x < X1 && y >= Y0 && y < Y1;
  if (inQuad) {
    const phase = (x - X0) % periodPx;
    if (phase < plankPx) {
      const edge = Math.min(phase, plankPx - phase);
      const d = edge < 3 ? -22 : 0;
      return [139 + d, 90 + d, 43 + d]; // rjava deska (robovi temnejši)
    }
    return [95, 63, 30]; // reža
  }
  if (y < Y0) return [205 - Math.floor(y * 0.04), 215, 226]; // nebo
  return [152, 141, 104]; // tla
}

const buf = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y);
    const i = (y * W + x) * 3;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }
}

const png = await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
writeFileSync('/tmp/e2e-suggest-photo.b64', png.toString('base64'));

// pričakovana E2E meritev iz ENAKE homografije (stagePct zaokroži na 0,1 %)
const quadPct = [[12, 48], [88, 48], [88, 92], [12, 92]] as [number, number][];
const plane = calibratePlane(quadPct.map(([x, y]) => ({ x, y })), PLANE_W_CM, PLANE_H_CM, { w: W, h: H });
if (!plane) throw new Error('kalibracija ni uspela');
const d = planeDistanceCm(plane, { x: 12.0, y: 60 }, { x: 13.5, y: 60 }, { w: W, h: H });
console.log(`fixture: 1280×890, ravnina 500×180 cm, deske ${PLANK_CM}+${GAP_CM} cm`);
console.log(`pričakovana E2E meritev (klik 12,0 % → 13,5 %): ${d} cm → najbližji profil: polna-100 (diff |${d}−10| = ${Math.abs((d ?? 0) - 10).toFixed(1)} cm)`);
