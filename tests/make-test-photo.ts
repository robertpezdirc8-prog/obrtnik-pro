// Ustvari testno fotografijo balkona z alu ograjo + vrata (referenca 200 cm)
// Pot izvira iz relacije do te datoteke: absolutna pot razvojnega
// kontejnerja je veljala samo na stroji, kjer je repozitorij nastal.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const svg = `
<svg width="1280" height="960" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b8c9dd"/><stop offset="1" stop-color="#dfe8f0"/>
    </linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8dfcf"/><stop offset="1" stop-color="#d9cbb4"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="960" fill="url(#sky)"/>
  <!-- fasada -->
  <rect x="0" y="120" width="1280" height="840" fill="url(#wall)"/>
  <rect x="0" y="120" width="1280" height="40" fill="#c9b896"/>
  <!-- balkonska plošča -->
  <rect x="80" y="700" width="1120" height="60" fill="#b3a68e"/>
  <!-- balkonska vrata (referenca ~200 cm) -->
  <rect x="540" y="300" width="200" height="400" fill="#7a5c3e" stroke="#5d4429" stroke-width="10"/>
  <rect x="560" y="320" width="70" height="360" fill="#8f6d4b"/>
  <rect x="650" y="320" width="70" height="360" fill="#8f6d4b"/>
  <circle cx="710" cy="500" r="8" fill="#d8b25a"/>
  <!-- okno levo -->
  <rect x="180" y="340" width="240" height="240" fill="#9fb8c8" stroke="#6b6257" stroke-width="12"/>
  <line x1="300" y1="340" x2="300" y2="580" stroke="#6b6257" stroke-width="8"/>
  <!-- aluminijasta ograja: zgornji ročaj -->
  <rect x="80" y="480" width="1120" height="26" fill="#2f3640" rx="6"/>
  <!-- stebri -->
  <rect x="90" y="480" width="30" height="220" fill="#3b4450"/>
  <rect x="380" y="480" width="30" height="220" fill="#3b4450"/>
  <rect x="670" y="480" width="30" height="220" fill="#3b4450"/>
  <rect x="960" y="480" width="30" height="220" fill="#3b4450"/>
  <rect x="1150" y="480" width="30" height="220" fill="#3b4450"/>
  <!-- polnilna polja (vodoravne letve) -->
  ${[520, 560, 600, 640, 680].map((y) => `<rect x="80" y="${y}" width="1120" height="14" fill="#4a5561"/>`).join('\n  ')}
  <!-- senca na tleh -->
  <rect x="80" y="760" width="1120" height="18" fill="#a3977f"/>
</svg>`;

const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
const FOTO = fileURLToPath(new URL('./test-photo.jpg', import.meta.url));
await sharp(buf).toFile(FOTO);
console.log('OK', FOTO, buf.length, 'bytes');
