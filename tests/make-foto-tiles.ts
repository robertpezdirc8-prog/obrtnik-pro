// ─── Tile-i IZ URADNIH FOTOGRAFIJ vgrajene ROKSAL ograje ────────────────
// Zakaj: dosedanji tile-i so IZREZI iz uradne barvne lestvice (ploska barva).
// Fotomontaža zato izgleda kot ravna plošča, ne kot resnična ograja. Ta
// skript naredi tile iz URADNIH FOTOGRAFIJ vgrajene ograje — zrnatost, robna
// senca in barva so resnični.
//
// DETERMINIZEM: vsi pravokotniki izreza so ZAPIŠANI (ne iskani med sliko),
// zato isti vhodi → isti tile. Merilo je izpeljano iz meritve v fotografiji:
// razmik med temnima šprinjama med deskami je ≈ 15 px, kar pri POLNA-100
// pomeni 12 cm realnega koraka (10 cm deska + 2 cm reža) → 1 px ≈ 0,8 cm.
// Izrez 13 × 13 px je torej ≈ 10 × 10 cm = natanko širina enega profila.
//
// Zagon: bun tests/make-foto-tiles.ts
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

const OUT = join(process.cwd(), 'public', 'roksal', 'ograje', 'polna-100');

/** Izrezi: [x, y, w, h] v pikslih + realna velikost tile-a v cm. */
const CROPS = [
  {
    out: 'foto-dekor-1.png',
    src: join(OUT, 'foto-vgradnja-og.jpg'),
    // Temna vrtna ograja (amazon): deska ≈ 13 px, korak ≈ 15 px.
    // 15 px ↔ 12 cm (10 cm deska + 2 cm reža) → 1 px ≈ 0,8 cm → 13 px ≈ 10 cm.
    rect: { left: 235, top: 190, width: 13, height: 13 },
    realCm: 10,
    opis: 'POLNA-100, amazon (dekor 1) — temna vrtna ograja, sredina deske',
  },
  {
    out: 'foto-dekor-2.png',
    src: join(OUT, 'foto-vgradnja-og2.jpg'),
    // Deska v tej fotografiji ≈ 30 px (1 px ≈ 0,33 cm) → 30 px ≈ 10 cm.
    rect: { left: 700, top: 400, width: 30, height: 30 },
    realCm: 10,
    opis: 'POLNA-100, svetlo sivi (dekor 2) — ograja od spodaj',
  },
];

mkdirSync(OUT, { recursive: true });
for (const c of CROPS) {
  const buf = await sharp(c.src).extract(c.rect).resize(256, 256, { kernel: 'lanczos3' }).png().toBuffer();
  const outPath = join(OUT, c.out);
  await sharp(buf).toFile(outPath);
  const st = await sharp(outPath).stats();
  const mean = st.channels.map((ch) => Math.round(ch.mean));
  console.log(`${c.out}: ${c.rect.width}×${c.rect.height} px → 256×256 (${c.realCm} cm) · povprečje RGB ${mean.join(',')} · ${c.opis}`);
}
