// ─── SINTETIČNA OGRAVA Z RESNIČNO GEOMETRIJO (za preverjanje meril) ────
// Zakaj: meritve je treba dokazati, ne trditi. Ta skript nariše fotko, kjer
// so VSE dimenzije znane, in sicer PERSPEKTIVNO (projekcija štirikotnika), da
// preverjanje ne bi bilo »preprosto«:
//
//   ravnina ograje: 350 cm × 100 cm, profili POLNA-100 (10 cm + 2 cm reža),
//   stebri na 0 / 150 / 300 cm, deske po pravilu spoj-na-stebru (28 desk),
//   poleg tudi vrata 200 cm (referenčni objekt za predlog merila kamere).
//
// E2E nato klikne ZNANE oglišča, vpiše 350 × 100 cm in preveri, da aplikacija
// vrnatko točno: 4 stebre, 3 celote, 28 desk, 28 m, 6 nabavnih kosov, 680 cm
// odpada. Če bi bila homografija ali štetje desk napačno, bi E2E to ujel.
//
// Zagon: bun tests/make-sinteticna-ograva.ts
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

const OUT = join(process.cwd(), 'tests', 'fixtures', 'sinteticna-ograva.png');
mkdirSync(join(process.cwd(), 'tests', 'fixtures'), { recursive: true });

const W = 1000;
const H = 700;

// ── ravnina ograje v sliki (perspektiva) ──
const TL = { x: 110, y: 320 }; // zgornji levi
const TR = { x: 880, y: 300 }; // zgornji desni
const BR = { x: 860, y: 540 }; // spodnji desni
const BL = { x: 120, y: 560 }; // spodnji levi
const PLANE_CM_W = 350;
const PLANE_CM_H = 100;
const BOARD_CM = 10;
const GAP_CM = 2;
const POST_CM = 6;
const POSTS_CM = [0, 150, 300];
const BAYS = [
  [0, 150],
  [150, 300],
  [300, 350],
];

/** Projekcija cm v ravnini na piksle (bilinearna po štirikotniku). */
function project(cx: number, cy: number): { x: number; y: number } {
  const u = cx / PLANE_CM_W; // levo→desno
  const v = cy / PLANE_CM_H; // zgoraj→dolu
  const top = { x: TL.x + (TR.x - TL.x) * u, y: TL.y + (TR.y - TL.y) * u };
  const bottom = { x: BL.x + (BR.x - BL.x) * u, y: BL.y + (BR.y - BL.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}
const pt = (cx: number, cy: number): string => {
  const p = project(cx, cy);
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
};

/** Deske po pravilu spoj-na-stebru: v vsaki celoti toliko desk, kolikor jih spravi. */
function boardsInBay(fromCm: number, toCm: number): number[] {
  const out: number[] = [];
  for (let x = fromCm; x + BOARD_CM <= toCm; x += BOARD_CM + GAP_CM) out.push(x);
  return out;
}

const boards: number[] = [];
for (const [a, b] of BAYS) boards.push(...boardsInBay(a, b));

// ── ozadje: stena, tla, vrata (200 cm) ──
const doorW = 90;
const doorX = 610;
const doorTop = project(0, 0).y; // vrata segata od tal do 200 cm nad tlemi ograje
const groundY = project(0, PLANE_CM_H).y;
const doorTopY = project(0, PLANE_CM_H - 200).y;

const parts: string[] = [];
parts.push(`<rect width="${W}" height="${H}" fill="#dfe4e8"/>`); // stena
parts.push(`<rect x="0" y="${groundY.toFixed(1)}" width="${W}" height="${(H - groundY).toFixed(1)}" fill="#b9b3a6"/>`); // tla
// vrata (referenčni objekt, 200 cm)
parts.push(
  `<rect x="${doorX}" y="${doorTopY.toFixed(1)}" width="${doorW}" height="${(groundY - doorTopY).toFixed(1)}" fill="#6d5b4c" stroke="#4a3d33" stroke-width="4"/>`,
);
// okno
parts.push(`<rect x="180" y="150" width="180" height="150" fill="#9fc4d8" stroke="#5d6b74" stroke-width="5"/>`);

// stebri (kovina) — pred deskami
for (const px of POSTS_CM) {
  parts.push(
    `<polygon points="${pt(px, PLANE_CM_H)},${pt(px + POST_CM, PLANE_CM_H)},${pt(px + POST_CM, -2)},${pt(px, -2)}" fill="#9a9da0" stroke="#6e7174" stroke-width="1.5"/>`,
  );
}
// deske
let i = 0;
for (const x of boards) {
  const shade = 96 + ((i * 37) % 26); // zrnatost med deskami
  parts.push(
    `<polygon points="${pt(x, 0)},${pt(x + BOARD_CM, 0)},${pt(x + BOARD_CM, PLANE_CM_H)},${pt(x, PLANE_CM_H)}" fill="rgb(${shade},${shade + 2},${shade + 4})" stroke="#5c5f62" stroke-width="0.8"/>`,
  );
  i++;
}
// podložna letva spodaj
parts.push(
  `<polygon points="${pt(0, PLANE_CM_H)},${pt(PLANE_CM_W, PLANE_CM_H)},${pt(PLANE_CM_W, PLANE_CM_H - 4)},${pt(0, PLANE_CM_H - 4)}" fill="#7d8083"/>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
await sharp(Buffer.from(svg)).png().toFile(OUT);

console.log(
  `Zapisano: ${OUT.replace(process.cwd() + '/', '')} · ravnina ${PLANE_CM_W} × ${PLANE_CM_H} cm · ` +
    `desk ${boards.length} · stebri ${POSTS_CM.length} na ${POSTS_CM.join('/')} cm · oglišča v %: ` +
    `${[TL, TR, BR, BL].map((p) => `${((p.x / W) * 100).toFixed(1)},${((p.y / H) * 100).toFixed(1)}`).join(' | ')}`,
);
