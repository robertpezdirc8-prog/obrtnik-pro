// Sintetična scena za Task 27 E2E: stena kopalnice s ploščicami 60×60 (running bond).
// Merilo: 1 cm = 2,4 px → ploščica 60 cm = 144 px (+ fuga ~2 px).
// Kalibracija v E2E prek "Znam ploščico" = 60 → pričakovano 60×60, odpadek 10 %.
// Poženi: bun tests/make-task27-photo.ts → tests/task27-bathroom.jpg
import sharp from 'sharp';

const W = 960, H = 720;
const PITCH = 144; // 60 cm @ 2,4 px/cm
const tiles: string[] = [];
for (let y = 0, row = 0; y < H + PITCH; y += PITCH, row++) {
  for (let x = (row % 2) * (PITCH / 2), col = 0; x < W + PITCH; x += PITCH, col++) {
    const tone = 205 + ((row + col) % 3) * 6;
    tiles.push(`<rect x="${x + 2}" y="${y + 2}" width="${PITCH - 4}" height="${PITCH - 4}" fill="rgb(${tone},${tone - 4},${tone - 10})"/>`);
  }
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#57534e"/>
  ${tiles.join('\n  ')}
</svg>`;

sharp(Buffer.from(svg))
  .jpeg({ quality: 88 })
  .toFile('/home/z/my-project/tests/task27-bathroom.jpg')
  .then(() => console.log('OK tests/task27-bathroom.jpg'));
