// ─── Tile-i IZ GALERIJE ROKSAL (vgrajeni ograji) ─────────────────────────
// Zakaj: barvne lestvice so ploske (barva, brez zrnatosti), vgrajene ograje pa
// imajo zrnatost, robno senco in REALNO razmerje. Iz uradnih fotografij vgrajenih
// ograj (galerija roksal.com) zato režemo tile posamezne deske — material je
// resničen, ne rekonstruiran.
//
// DETERMINIZEM: detektor ne »išče nekaj lepega« — poišče PERIODIČNE temne
// šprinje med deskami, izmeri korak v slikovnih piksli in odreže natanko eno
// desko. Širina profila POLNA-100 je 10 cm → tile je realno 10 × 10 cm, kar
// pomeni, da je tekstura v upodobitvi v PRAVEM merilu (začetni tile-i so imeli
// »realCm 45« kot privzetek).
//
// Zagon: bun tests/make-galerija-tiles.ts   (mreža: roksal.com, brez ključa)
import { createRequire } from 'node:module';
import { findBoard } from '../src/lib/board-detect';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

// Izhod je v RAZISKOVALNO mapo, ne v aplikacijo: izmerjeno je, da so deske v
// uradnih galerijskih fotografijah široke le 9–18 px, zato so ti tile-i
// zamegljeni in barvno odstopajo od uradne lestvice (do Δ212). Najboljši vir
// ostaja uradna barvna lestvica; za ostre tile-e so potrebni bližnji posnetki
// (npr. od monterjev — tests/make-monter-tiles.ts).
const OUT = join(process.cwd(), 'tests', 'fixtures', 'galerija-raziskava');
const CACHE = join(process.cwd(), 'tests', 'fixtures', 'galerija-cache');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

interface Photo {
  /** polni URL v galeriji roksal.com */
  url: string;
  /** uradno ime odtenka */
  colour: string;
  /** profil, iz katerega je deska (POLNA-100 = 10 cm) */
  boardWidthCm: number;
  /** pričakovano povprečje RGB odtenka (iz uradne barvne lestvice) — merilo izbire */
  swatchRgb: [number, number, number];
}

const U = 'https://roksal.com/wp-content/uploads';
const PHOTOS: Photo[] = [
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-amazon-polna-deska-loz2.jpg`, colour: 'Amazon wood', boardWidthCm: 10, swatchRgb: [95, 94, 97] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-amazon-polna-deska-gr2.jpg`, colour: 'Amazon wood', boardWidthCm: 10, swatchRgb: [95, 94, 97] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-ash-polna-deska-1.jpg`, colour: 'Ash wood', boardWidthCm: 10, swatchRgb: [147, 146, 146] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-ash-polna-deska-4.jpg`, colour: 'Ash wood', boardWidthCm: 10, swatchRgb: [147, 146, 146] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-golden-polna-deska-1.jpg`, colour: 'Golden teak', boardWidthCm: 10, swatchRgb: [162, 125, 116] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-burma-polna-deska-1.jpg`, colour: 'Burma teak', boardWidthCm: 10, swatchRgb: [143, 119, 110] },
  { url: `${U}/2021/03/wpc-woodcore-pokoncna-ograja-burma-polna-deska-3.jpg`, colour: 'Burma teak', boardWidthCm: 10, swatchRgb: [143, 119, 110] },
  { url: `${U}/2023/12/pokoncna-10-oak1.jpg`, colour: 'Oak wood', boardWidthCm: 10, swatchRgb: [177, 148, 125] },
  { url: `${U}/2024/02/ograja-rustic-oak-pokoncna.jpg`, colour: 'Rustic oak', boardWidthCm: 10, swatchRgb: [154, 127, 98] },
  { url: `${U}/2024/02/ograja-rustic-oak-pokoncna3.jpg`, colour: 'Rustic oak', boardWidthCm: 10, swatchRgb: [154, 127, 98] },
  { url: `${U}/2021/03/wpc-woodcore-ograja-bela-pokoncna-ograja.jpg`, colour: 'White', boardWidthCm: 10, swatchRgb: [199, 198, 197] },
];

/** Preveri, ali je slika že lokalna; sicer jo prenese z roksal.com. */
async function fetchPhoto(url: string): Promise<string> {
  const file = url.split('/').pop() as string;
  const local = join(CACHE, file);
  try {
    readFileSync(local);
    return local;
  } catch {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`prenos ni uspel: HTTP ${res.status} (${file})`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(local, buf);
    return local;
  }
}


const best = new Map<string, { path: string; left: number; top: number; side: number; pitch: number; rgb: number[]; d: number }>();

for (const p of PHOTOS) {
  try {
    const path = await fetchPhoto(p.url);
    const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    for (let band = 0.2; band <= 0.62; band += 0.08) {
      const y0 = Math.round(H * band);
      const y1 = Math.round(Math.min(H - 1, H * (band + 0.2)));
      if (y1 - y0 < 20) continue;
      const prof: number[] = [];
      for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (let y = y0; y < y1; y++) { const i = (y * W + x) * info.channels; s += (data[i] + data[i + 1] + data[i + 2]) / 3; c++; }
        prof.push(s / c);
      }
      const board = findBoard(prof, { minPitch: 8, maxPitch: 90 });
      if (!board) continue;
      const side = Math.max(8, Math.round(board.width));
      const top = Math.max(0, Math.min(H - side, Math.round((y0 + y1) / 2 - side / 2)));
      const left = Math.max(0, Math.min(W - side, Math.round(board.left)));
      const buf = await sharp(path).extract({ left, top, width: side, height: side }).resize(256, 256, { kernel: 'lanczos3' }).png().toBuffer();
      const st = await sharp(buf).stats();
      const rgb = st.channels.slice(0, 3).map((c) => Math.round(c.mean));
      const d = Math.sqrt((rgb[0] - p.swatchRgb[0]) ** 2 + (rgb[1] - p.swatchRgb[1]) ** 2 + (rgb[2] - p.swatchRgb[2]) ** 2);
      const cur = best.get(p.colour);
      // Merilo: manjše odstopanje barve + VEČJA deska (ostane ostrina)
      if (!cur || d < cur.d - 6 || (Math.abs(d - cur.d) <= 6 && side > cur.side)) {
        best.set(p.colour, { path, left, top, side, pitch: board.pitch, rgb, d });
      }
    }
  } catch (e) {
    console.log(`  (${p.colour}) ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const [colour, b] of best) {
  const slug = colour.toLowerCase().replace(/[^a-z]+/g, '-');
  const out = join(OUT, `foto-${slug}.png`);
  const buf = await sharp(b.path).extract({ left: b.left, top: b.top, width: b.side, height: b.side })
    .resize(256, 256, { kernel: 'lanczos3' }).png().toBuffer();
  writeFileSync(out, buf);
  console.log(`${colour}: deska ${b.side} px (korak ${b.pitch} px) · RGB ${b.rgb.join(',')} · odstopanje od lestvice ${Math.round(b.d)} → foto-${slug}.png`);
}
