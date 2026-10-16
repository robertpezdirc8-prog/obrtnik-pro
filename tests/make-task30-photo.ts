// Sintetični fotki za Task 30 E2E (nadstrešek): FRONTALNA (širina) + STRANSKA (globina + naklon).
// Merilo: 1 cm = 1 px @ 960×720.
//  FRONT: stena + pas kritine (x 260–740 = 4,80 m) s temno fašno lento + vrata 200 px visoka
//         (y 494–694 → referenca 200 cm → pxPerCm = 1,0).
//  SIDE:  stranski pogled — rob kritine od stene (350,260) do spredaj (650,324):
//         Δx = 300 px = 3,00 m globine, Δy = 64 px → naklon ≈ 12,1°, poševno ≈ 3,07 m.
//         Vrata (referenca) x 180–380, y 494–694; tla spodaj (vodoravna črta ne sme zmedeti detekcijo).
// Poženi: bun tests/make-task30-photo.ts → tests/task30-front.jpg + tests/task30-side.jpg
// Pot izvira iz relacije do te datoteke: absolutna pot razvojnega
// kontejnerja je veljala samo na stroji, kjer je repozitorij nastal.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const W = 960, H = 720;

const noiseDefs = `
  <defs>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.76  0 0 0 0 0.71  0 0 0 0 0.62  0 0 0 0.06 0"/>
    </filter>
  </defs>`;

const front = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="rgb(196,182,158)"/>
  <rect width="${W}" height="${H}" fill="url(#noise)"/>
  ${noiseDefs}
  <rect x="0" y="700" width="${W}" height="20" fill="rgb(150,120,84)"/>
  <rect x="260" y="170" width="480" height="68" fill="rgb(150,138,128)"/>
  <rect x="260" y="238" width="480" height="20" fill="rgb(58,54,48)"/>
  <rect x="424" y="494" width="112" height="200" fill="rgb(40,32,26)"/>
  <rect x="430" y="500" width="100" height="188" fill="rgb(48,44,40)"/>
</svg>`;

const side = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="rgb(205,198,186)"/>
  <rect width="${W}" height="${H}" fill="url(#noise)"/>
  ${noiseDefs}
  <rect x="0" y="698" width="${W}" height="22" fill="rgb(150,120,84)"/>
  <rect x="230" y="494" width="100" height="200" fill="rgb(40,32,26)"/>
  <rect x="236" y="500" width="88" height="188" fill="rgb(48,44,40)"/>
  <polygon points="350,258 650,322 650,338 350,274" fill="rgb(58,54,48)"/>
</svg>`;

Promise.all([
  sharp(Buffer.from(front)).jpeg({ quality: 90 }).toFile(fileURLToPath(new URL('./task30-front.jpg', import.meta.url))),
  sharp(Buffer.from(side)).jpeg({ quality: 90 }).toFile(fileURLToPath(new URL('./task30-side.jpg', import.meta.url))),
]).then(() => console.log('OK tests/task30-front.jpg + tests/task30-side.jpg'));
