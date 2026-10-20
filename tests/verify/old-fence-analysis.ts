// Verifikacija PREPOZNAVANJA STARE OGRAJE (old-fence-analysis.ts):
//   1) pokončne lesene deske z VIDNIMI vijaki → družina POLNA, material les,
//      vijaki najdeni in njihove položaje;
//   2) vodoravne deske → ROMB;
//   3) kovinska (tema, sijajna) ograja → material KOVINA + opomba o zamenjavi
//      materiala;
//   4) brez ravnine → ni jasno + nizka zanesljivost (brez izmišljanja);
//   5) determinizem: isti vhodi → isti izid.
// Zagon: bun tests/verify/old-fence-analysis.ts
import { analyseOldFence } from '../../src/lib/old-fence-analysis';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

const W = 240;
const H = 180;
const QUAD: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];

function makeImage(kind: 'vertikalne-les-vijaki' | 'vodoravne-les' | 'kovina'): Uint8Array {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v = 120;
      if (kind === 'vertikalne-les-vijaki') {
        // deske: svetlo lesen pas (16 px) + temna reža (4 px) — realistično
        const inGap = x % 20 < 4;
        v = inGap ? 60 : 150 + ((x * 7) % 12) - 6;
        // vijaki: temna pika na sredini vsake deske
        if (x % 20 === 10 && y % 45 === 22) v = 55;
      } else if (kind === 'vodoravne-les') {
        const inGap = y % 18 === 0 || y % 18 === 17;
        v = inGap ? 60 : 150 + ((y * 5) % 10) - 5;
      } else {
        // kovinska ograja: tanke svetle palice na temni podlagi
        v = x % 12 < 2 ? 190 : 35;
      }
      d[i] = v;
      d[i + 1] = v * 0.98;
      d[i + 2] = v * 0.94;
      d[i + 3] = 255;
    }
  }
  return d;
}

console.log('Prepoznavanje stare ograje — material, orientacija, vijaki, družina profila\n');

// ── 1) pokončne lesene deske z vidnimi vijaki ──
{
  const r = analyseOldFence({ rgba: makeImage('vertikalne-les-vijaki'), W, H, quadPct: QUAD });
  check('pokončno: material les', r.material === 'les', r.materialEvidence);
  check('pokončno: orientacija pokončno', r.orientation === 'pokončno', r.orientationEvidence);
  check('pokončno: vijaki najdeni', r.screws.length >= 3, r.screws.length);
  check('pokončno: položaji so v % ravnine', r.screws.every((s) => s.xPct >= 0 && s.xPct <= 100 && s.yPct >= 0 && s.yPct <= 100), r.screws.slice(0, 3));
  check('pokončno: družina POLNA (vidni vijaki)', r.family === 'polna', r.familyReason);
  check('pokončno: zanesljivost visoka', r.confidence === 'visoka', r.confidence);
}

// ── 2) vodoravne deske ──
{
  const r = analyseOldFence({ rgba: makeImage('vodoravne-les'), W, H, quadPct: QUAD });
  check('vodoravno: orientacija vodoravno', r.orientation === 'vodoravno', r.orientationEvidence);
  check('vodoravno: družina ROMB', r.family === 'romb', r.familyReason);
}

// ── 3) kovinska ograja ──
{
  const r = analyseOldFence({ rgba: makeImage('kovina'), W, H, quadPct: QUAD });
  check('kovina: material kovina', r.material === 'kovina', r.materialEvidence);
  check('kovina: opomba o zamenjavi materiala', r.notes.some((n) => n.includes('ZAMENJAVO MATERIALA')), r.notes);
}

// ── 4) brez ravnine ──
{
  const r = analyseOldFence({ rgba: makeImage('kovina'), W, H, quadPct: [] });
  check('brez ravnine: ni jasno', r.material === 'ni jasno' && r.orientation === 'ni jasno', r);
  check('brez ravnine: nizka zanesljivost', r.confidence === 'nizka');
  check('brez ravnine: ni družine', r.family === null);
  check('brez ravnine: opomba, najprej označi ravnino', r.notes.length >= 1, r.notes);
}

// ── 5) determinizem ──
{
  const img = makeImage('vertikalne-les-vijaki');
  const a = analyseOldFence({ rgba: img, W, H, quadPct: QUAD });
  const b = analyseOldFence({ rgba: img, W, H, quadPct: QUAD });
  check('determinizem: isti vhodi → isti izid', JSON.stringify(a) === JSON.stringify(b));
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
