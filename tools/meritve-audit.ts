// ─── PREVERJANJE MERIL (meritve-audit.ts) ─────────────────────────────────
// Namen: tvoj terenski test. Za vsako fotko izračuna merilo NA DVA
// NEODVISNA NAČINA in pove, ali se ujemata:
//
//   A) KAMERA: aplikacijin samodejni predlog merila iz referenčnega objekta
//      (vrata 200 cm / okno 120 cm) → pxPerCm.
//   B) DESKA: detektor koraka med deskami v ograji; POLNA-100 je široka 10 cm,
//      zato korak/10 = pxPerCm. (Samo za WPC ograjo!)
//
// Če se metodi ujemata, je merilo zanesljivo. Če ne, je treba ograjo izmeriti
// z metrom — in to je natanko to, kar aplikacija od montera zahteva.
//
// Zagon: bun tools/meritve-audit.ts [foto.jpg ...]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

import { findBoard } from '../src/lib/board-detect';
import { analyzePhotoImage } from '../src/lib/cv-engine';

/** Širina deske POLNA-100 v cm (uradno: 10 cm). */
const BOARD_WIDTH_CM = 10;

interface Row {
  file: string;
  pxPerCmCamera: number | null;
  pxPerCmBoard: number | null;
  diffPct: number | null;
  verdict: string;
  pitchPx: number;
  band: string;
}

const files = process.argv.slice(2);
const list: string[] = files.length > 0 ? files : [
  'tests/fixtures/hisa-balkon-parkgate.jpg',
  'public/roksal/ograje/polna-100/foto-vgradnja-og.jpg',
];

const rows: Row[] = [];
for (const file of list) {
  let buf: Buffer;
  try {
    buf = readFileSync(join(process.cwd(), file));
  } catch {
    console.log(`${file}: datoteke ni (preskočeno)`);
    continue;
  }
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  // A) kamere: predlogi merila
  const analysis = analyzePhotoImage({ data: new Uint8ClampedArray(data), width: W, height: H });
  const cam = analysis.scaleSuggestions.filter((s) => s.pxPerCm > 0);
  const pxPerCmCamera = cam.length > 0 ? cam.map((s) => s.pxPerCm).sort((a, b) => a - b)[Math.floor(cam.length / 2)] : null;

  // B) deska: korak med deskami (več pasov, vzamemo najboljšega)
  let pxPerCmBoard: number | null = null;
  let bestPitch = 0;
  let bestBand = '';
  for (let band = 0.1; band <= 0.75; band += 0.05) {
    const y0 = Math.round(H * band);
    const y1 = Math.round(Math.min(H - 1, H * (band + 0.15)));
    if (y1 - y0 < 15) continue;
    const prof: number[] = [];
    for (let x = 0; x < W; x++) {
      let s = 0;
      let c = 0;
      for (let y = y0; y < y1; y++) {
        const i = (y * W + x) * info.channels;
        s += (data[i] + data[i + 1] + data[i + 2]) / 3;
        c++;
      }
      prof.push(s / c);
    }
    const b = findBoard(prof, { minPitch: 6, maxPitch: Math.max(30, Math.round(W / 4)) });
    if (b && b.pitch > bestPitch) {
      bestPitch = b.pitch;
      bestBand = `${Math.round(band * 100)}–${Math.round((band + 0.15) * 100)} % višine`;
      pxPerCmBoard = b.pitch / BOARD_WIDTH_CM;
    }
  }

  let diffPct: number | null = null;
  let verdict = 'ni mogoče oceniti';
  if (pxPerCmCamera && pxPerCmBoard) {
    diffPct = ((pxPerCmBoard - pxPerCmCamera) / pxPerCmCamera) * 100;
    const a = Math.abs(diffPct);
    verdict = a <= 8 ? 'MERILO SE UJEMA — uporabno' : a <= 20 ? 'razlika je znatna — preveri z metrom' : 'MERILO NI ZANESLJIVO — meri z metrom';
  } else if (pxPerCmBoard) {
    verdict = 'kamera ni našla referenčnega objekta — merilo samo iz desk';
  }
  rows.push({ file, pxPerCmCamera, pxPerCmBoard, diffPct, verdict, pitchPx: bestPitch, band: bestBand });
}

console.log('\nPREVERJANJE MERIL — dve neodvisni metodi\n');
console.log('foto | kamera (px/cm) | deska 10 cm (px/cm) | korak deske | odstopanje | ocena');
for (const r of rows) {
  console.log(
    `${r.file} | ${r.pxPerCmCamera ? r.pxPerCmCamera.toFixed(2) : '—'} | ${r.pxPerCmBoard ? r.pxPerCmBoard.toFixed(2) : '—'} | ` +
      `${r.pitchPx ? `${r.pitchPx} px (pas ${r.band})` : '—'} | ` +
      `${r.diffPct === null ? '—' : `${r.diffPct > 0 ? '+' : ''}${r.diffPct.toFixed(1)} %`} | ${r.verdict}`,
  );
}
console.log(
  '\nPOZOR: metoda »deska« vzame NAJŠIRŠI korak v sliki — to je lahko druga konstrukcija ' +
    '(npr. bela »latica« ograja, ne WPC deska). Njena vrednost je zato le orientacijska; ' +
    'za točno merilo mora biti v kadru znan objekt (vrata/okno) ali ograja z merljivo širino deske.',
);
console.log(
  '\nNAPOMENA: metoda »deska« velja samo za WPC ograjo s profili POLNA-100 (10 cm) ' +
    'oziroma ROMB-67 (6,7 cm) — pri drugih profilih jo prilagodi (BOARD_WIDTH_CM).',
);
console.log(
  'V aplikaciji merilo DOLOČA MONTER: vpiše dejansko širino ograje v cm, ki jo je ' +
    'izmeril. Ta skript je le PREVERJANJE, ali je samodejno merilo kamere uporabno.',
);
