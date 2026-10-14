// Izpeljani pogledi A, B, C iz izvorne fotke za E2E verige (3 fotke, ENAKE mere).
// Čisti prevodi (izsek z zamikom, brez zasuka): pravi premik kamere vzporedno s
// sceno; enakomerne razlike premikov (0 / +22,10 / +44,20 px) → AB = BC razlika,
// pod periodo ponavljajočega se vzorca (brez aliasinga).
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'public/crafts/ograje.jpg';
const DX = 22, DY = 10;

async function derive(out: string, exLeft: number, exTop: number): Promise<void> {
  const meta = await sharp(SRC).metadata();
  const w = (meta.width ?? 1200) - 2 * DX;
  const h = (meta.height ?? 800) - 2 * DY;
  await sharp(SRC)
    .extract({ left: exLeft, top: exTop, width: w, height: h })
    .jpeg({ quality: 88 })
    .toFile(out);
  const m3 = await sharp(out).metadata();
  console.log(`${out}: ${m3.width}x${m3.height}`);
}

await derive('tests/mv-chain-A.jpg', 0, 0);
await derive('tests/mv-chain-B.jpg', DX, DY);
await derive('tests/mv-chain-C.jpg', 2 * DX, 2 * DY);
console.log('gotovo');
