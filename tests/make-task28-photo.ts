// Sintetična fasada za Task 28 E2E: stena z vrati 100×200 cm + 2 oknoma 120×120 cm.
// Merilo: 1 cm = 2 px @ 960×720. Vrata: temna odprtina s temnim okvirom, dno pri tleh
// (y=698/720 = 96,9 %). Okna: steklo (nizka nasičenost, srednja svetlost) v belih okvirjih,
// BREZ palic (razdelili bi okno na visoke police → izven pasu razmerja stranic oken).
// Stena je TOPLA (s ≈ 0,18 > 0,14) — ne sme pasti v stekleno masko (prej je cela stena
// postala "steklo" in okna se niso zaznala). Lekcija Task 27: kontrast mora biti realen.
// Pričakovani popis: Vrata ≈ 106×206 (s okvirom), Okno 1/2 ≈ 126×126, merila se ujemajo.
// Poženi: bun tests/make-task28-photo.ts → tests/task28-facade.jpg
// Pot izvira iz relacije do te datoteke: absolutna pot razvojnega
// kontejnerja je veljala samo na stroji, kjer je repozitorij nastal.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const W = 960, H = 720;

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="rgb(196,182,158)"/>
  <rect width="${W}" height="${H}" fill="url(#noise)"/>
  <defs>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.76  0 0 0 0 0.71  0 0 0 0 0.62  0 0 0 0.06 0"/>
    </filter>
  </defs>
  <rect x="0" y="700" width="${W}" height="20" fill="rgb(150,120,84)"/>
  <rect x="8" y="120" width="252" height="252" fill="rgb(232,230,226)"/>
  <rect x="18" y="130" width="232" height="232" fill="rgb(150,158,168)"/>
  <rect x="620" y="120" width="252" height="252" fill="rgb(232,230,226)"/>
  <rect x="630" y="130" width="232" height="232" fill="rgb(150,158,168)"/>
  <rect x="352" y="286" width="212" height="412" fill="rgb(40,32,26)"/>
  <rect x="360" y="294" width="196" height="396" fill="rgb(48,44,40)"/>
  <rect x="360" y="560" width="196" height="130" fill="rgb(56,52,46)"/>
</svg>`;

sharp(Buffer.from(svg))
  .jpeg({ quality: 90 })
  .toFile(fileURLToPath(new URL('./task28-facade.jpg', import.meta.url)))
  .then(() => console.log('OK tests/task28-facade.jpg'));
