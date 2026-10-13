// Sintetična fotka WPC terase za E2E (Task 29): deske 14 cm + reža 5 mm,
// pxPerCm 10 → pitch 145 px, vodoravne deske, rjava WPC z vlakni.
// Zagon: bun tests/make-task29-photo.ts   → tests/task29-deck.jpg
import sharp from 'sharp';

const W = 1200, H = 900;
const PX_PER_CM = 10;
const PITCH = 145;   // 14,5 cm (deska 14 + reža 0,5)
const GAP = 5;       // 0,5 cm

// determinističen PRNG (LCG)
let seed = 20290129;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const buf = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const m = y % PITCH;
    const row = Math.floor(y / PITCH);
    const idx = (y * W + x) * 3;
    if (m < GAP) {
      // temna reža (senca podkonstrukcije)
      const v = 46 + rnd() * 10;
      buf[idx] = Math.round(v * 1.05); buf[idx + 1] = Math.round(v * 0.92); buf[idx + 2] = Math.round(v * 0.78);
    } else {
      // deska: rjava WPC, tone po vrstah + dolga vlakna vzdolž desk + droben šum
      const tone = 0.5 + 0.5 * Math.sin(row * 12.9898);
      let rC = 138 + tone * 34;   // 138–172
      let gC = 106 + tone * 28;   // 106–134
      let bC = 78 + tone * 22;    // 78–100
      const fiber = Math.sin(x * 0.045 + row * 17.3) * 6 + Math.sin(x * 0.011 + row * 5.1) * 4;
      const grain = (rnd() - 0.5) * 7;
      rC += fiber + grain; gC += fiber * 0.9 + grain; bC += fiber * 0.8 + grain;
      // mehak rob deske (prvi/zadnji 1 px svetlejši — fasadirni profil)
      if (m === GAP || m === GAP + 1 || m === PITCH - 1) { rC += 12; gC += 11; bC += 9; }
      buf[idx] = Math.max(0, Math.min(255, Math.round(rC)));
      buf[idx + 1] = Math.max(0, Math.min(255, Math.round(gC)));
      buf[idx + 2] = Math.max(0, Math.min(255, Math.round(bC)));
    }
  }
}

await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
  .jpeg({ quality: 88 })
  .toFile('tests/task29-deck.jpg');
console.log('tests/task29-deck.jpg — 1200×900, pitch 145 px @ 10 px/cm (deska 14 cm + reža 5 mm)');
