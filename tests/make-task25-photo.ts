// Sintetična scena za Task 25 E2E: ograja (racked) na klanecu + vrata 100 cm.
// 1 m = 96 px; teren: groundY(x) = 516 − 0,125·x (od (40,511) do (920,401)).
// Poženi: bun tests/make-task25-photo.ts → tests/task25-fence-slope.jpg
// Pot izvira iz relacije do te datoteke: absolutna pot razvojnega
// kontejnerja je veljala samo na stroji, kjer je repozitorij nastal.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const W = 960, H = 720;
const bars: string[] = [];
for (let x = 40; x <= 920 - 30; x += 60) {
  const gy = 516 - 0.125 * (x + 15);
  bars.push(`<rect x="${x}" y="120" width="30" height="${Math.max(10, gy - 120)}" fill="#8a5a2a"/>`);
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#e8e6e0"/>
  <rect x="0" y="0" width="${W}" height="120" fill="#cfd8d4"/>
  ${bars.join('\n  ')}
  <polygon points="0,516 960,401 960,720 0,720" fill="#2f503f"/>
  <polygon points="40,511 920,401 920,391 40,501" fill="#27422f"/>
  <rect x="820" y="208" width="96" height="204" fill="#4a4038" stroke="#2e2823" stroke-width="6"/>
  <rect x="880" y="300" width="22" height="7" fill="#c9b458"/>
</svg>`;

sharp(Buffer.from(svg))
  .jpeg({ quality: 88 })
  .toFile(fileURLToPath(new URL('./task25-fence-slope.jpg', import.meta.url)))
  .then(() => console.log('OK tests/task25-fence-slope.jpg'));
