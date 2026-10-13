// Sintetična fotka za Task 32 E2E (fasada): stena z VODORAVNO oblogo,
// vrati (referenca 200 cm) in 2 okni. Merilo: 1 cm = 1 px @ 960×720.
//  STENA: x 120–840 (7,20 m), y 120–620 (5,00 m) → bruto 36,00 m²
//  VRATA: x 424–524 (1,00 m), y 420–620 (2,00 m visoka → referenca)
//  OKNO1: x 200–320 (1,20 m), y 200–300 (1,00 m) → 1,20 m²
//  OKNO2: x 600–760 (1,60 m), y 180–320 (1,40 m) → 2,24 m²
//  OBLIGA: vodoravne linije vsakih 30 px (12,5 px preklopa ni potreben)
//  Odprtine: 2,00 + 1,20 + 2,24 = 5,44 m² → NETO 30,56 m²
// Poženi: bun tests/make-task32-photo.ts → tests/task32-fasada.jpg
import sharp from 'sharp';

const W = 960, H = 720;

const noiseDefs = `
  <defs>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.72  0 0 0 0 0.68  0 0 0 0 0.60  0 0 0 0.07 0"/>
    </filter>
  </defs>`;

// vodoravne linije obloge čez celo steno (30 px pitch)
let clad = '';
for (let y = 120; y <= 620; y += 30) {
  clad += `<rect x="120" y="${y}" width="720" height="3" fill="rgb(112,104,96)"/>\n`;
}

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="rgb(178,190,200)"/>
  <rect width="${W}" height="${H}" fill="url(#noise)"/>
  ${noiseDefs}
  <rect x="0" y="620" width="${W}" height="100" fill="rgb(150,120,84)"/>
  <rect x="120" y="120" width="720" height="500" fill="rgb(206,192,168)"/>
  ${clad}
  <rect x="424" y="420" width="100" height="200" fill="rgb(40,32,26)"/>
  <rect x="430" y="426" width="88" height="188" fill="rgb(48,44,40)"/>
  <rect x="200" y="200" width="120" height="100" fill="rgb(52,64,74)"/>
  <rect x="206" y="206" width="108" height="88" fill="rgb(94,116,132)"/>
  <rect x="600" y="180" width="160" height="140" fill="rgb(52,64,74)"/>
  <rect x="606" y="186" width="148" height="128" fill="rgb(94,116,132)"/>
</svg>`;

sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile('/home/z/my-project/tests/task32-fasada.jpg')
  .then(() => console.log('OK tests/task32-fasada.jpg'));
