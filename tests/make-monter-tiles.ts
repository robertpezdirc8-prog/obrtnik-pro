// ─── Tile-i IZ FOTOGRAFIJ OD MONTERJEV (tests/fixtures/monter/) ─────────────
// Namen: ROKSALOVE lastne fotografije vgrajenih ograj so preširoke (deska je
// le 9–18 px), zato dajo zamegljene tile-e. Fotografije od monterjev so bližnje
// (telefon, ena deska zapolni sliko) → tile-i so ostri in merilo je izmerjeno.
//
// VSTOP: `tests/fixtures/monter/manifest.json` (glej MANIFEST.md) + fotografije.
//
// DETERMINIZEM: skript za vsak vnos poišče temno šprinjo med deskami, izmeri
// korak v pikslih in odreže natanko eno desko; tile je realno
// `boardWidthCm` širok, zato je tekstura v upodobitvi v PRAVEM merilu.
//
// Zagon: bun tests/make-monter-tiles.ts
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

import { findBoard } from '../src/lib/board-detect';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'monter');
const MANIFEST = join(DIR, 'manifest.json');

interface Entry {
  file: string;
  colour: string;
  profile: string;
  boardWidthCm: number;
}

if (!existsSync(MANIFEST)) {
  console.log('Ni manifesta — glej tests/fixtures/monter/MANIFEST.md');
  process.exit(0);
}
let entries: Entry[] = [];
try {
  entries = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Entry[];
} catch (e) {
  console.log(`Manifest ni veljaven JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
if (entries.length === 0) {
  console.log('Manifest je prazen — dodaj fotografije od monterjev (MANIFEST.md).');
  process.exit(0);
}

for (const en of entries) {
  const path = join(DIR, en.file);
  if (!existsSync(path)) {
    console.log(`${en.colour}: datoteke ${en.file} ni v mapi — preskočeno`);
    continue;
  }
  try {
    const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    let best: { left: number; top: number; side: number; pitch: number } | null = null;
    for (let band = 0.1; band <= 0.8; band += 0.05) {
      const y0 = Math.round(H * band);
      const y1 = Math.round(Math.min(H - 1, H * (band + 0.15)));
      if (y1 - y0 < 15) continue;
      const prof: number[] = [];
      for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (let y = y0; y < y1; y++) { const i = (y * W + x) * info.channels; s += (data[i] + data[i + 1] + data[i + 2]) / 3; c++; }
        prof.push(s / c);
      }
      const b = findBoard(prof, { minPitch: 8, maxPitch: Math.max(40, Math.round(W / 4)) });
      if (!b) continue;
      const side = Math.max(8, Math.round(b.width));
      if (!best || side > best.side) {
        const top = Math.max(0, Math.min(H - side, Math.round((y0 + y1) / 2 - side / 2)));
        const left = Math.max(0, Math.min(W - side, Math.round(b.left)));
        best = { left, top, side, pitch: b.pitch };
      }
    }
    if (!best) {
      console.log(`${en.colour}: deske ni mogoče določiti — preskočeno`);
      continue;
    }
    const outDir = join(process.cwd(), 'public', 'roksal', 'ograje', en.profile);
    mkdirSync(outDir, { recursive: true });
    const slug = en.colour.toLowerCase().replace(/[^a-z]+/g, '-');
    const out = join(outDir, `mont-${slug}.png`);
    const buf = await sharp(path)
      .extract({ left: best.left, top: best.top, width: best.side, height: best.side })
      .resize(256, 256, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    writeFileSync(out, buf);
    const st = await sharp(buf).stats();
    const mean = st.channels.slice(0, 3).map((c) => Math.round(c.mean));
    console.log(
      `${en.colour} (${en.profile}): deska ${best.side} px = ${en.boardWidthCm} cm → ` +
      `mont-${slug}.png · RGB ${mean.join(',')}`,
    );
  } catch (e) {
    console.log(`${en.colour}: napaka — ${e instanceof Error ? e.message : String(e)}`);
  }
}
