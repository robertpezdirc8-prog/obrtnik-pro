// Verifikacija MERILNE NEGOTOVOSTI in OPIISA STRUKTURE (measure-verify.ts):
//   1) negotovost širine = kliknišče (±5 px) + zaokrožitev vnosa (0,5 cm),
//      izračunana po modelu, ki je zapisan v kodu;
//   2) brez širine ali brez ravnine → merilo ni določeno (ne 0, ki bi lahal);
//   3) opis strukture pove število desk in OPOZORI, da število ni merilo;
//   4) štetje desk na sintetični sliki z znanim številom desk je natančno.
// Zagon: bun tests/verify/measure-verify.ts
import { createRequire } from 'node:module';
import { countBoardsInPlane, describeStructure, measurementUncertainty } from '../../src/lib/measure-verify';

const require = createRequire(process.cwd() + '/');
const sharp = require('sharp');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

console.log('Merilna negotovost in opis strukture (measure-verify)\n');

// ── 1) Model negotovosti ────────────────────────────────────────────
{
  const u = measurementUncertainty({ widthCm: 350, quadWidthPx: 700 });
  // ±(5/700)*350 = 2,5 cm + 0,5 cm = 3,0 cm
  check('negotovost ≈ 3,0 cm (klik + zaokrožitev)', Math.abs(u.plusMinusCm - 3.0) < 0.05, u);
  check('negotovost v % je navedena', u.plusMinusPct > 0.5 && u.plusMinusPct < 1.2, u);
  check('razlog pove oba vira napake', u.reason.includes('kliknišče') && u.reason.includes('0,5 cm'), u.reason);
  const u2 = measurementUncertainty({ widthCm: 700, quadWidthPx: 700 });
  // Enaka napaka klikništva (5 px) pomeni VEČJO absolutno negotovost pri
  // širši ograji, a manjšo RELATIVNO (odstotek je odvisen od širine).
  check('širša ograja: večja absolutna negotovost', u2.plusMinusCm > u.plusMinusCm, { u, u2 });
  check('širša ograja: manjša relativna negotovost', u2.plusMinusPct < u.plusMinusPct, { u, u2 });
  const u3 = measurementUncertainty({ widthCm: 100, quadWidthPx: 700 });
  check('ozka ograja = večja negotovost v %', u3.plusMinusPct > u.plusMinusPct, { u, u3 });
}

// ── 2) Brez merila ─────────────────────────────────────────────────
{
  const u = measurementUncertainty({ widthCm: null, quadWidthPx: 700 });
  check('brez širine → merilo ni določeno', u.plusMinusCm === 0 && u.reason.includes('ni določeno'), u);
  const u2 = measurementUncertainty({ widthCm: 350, quadWidthPx: null });
  check('brez ravnine → merilo ni določeno', u2.plusMinusCm === 0, u2);
}

// ── 3) Opis strukture ──────────────────────────────────────────────
{
  const d = describeStructure({ boardsDetected: 27, plankCm: 10, gapCm: 2 });
  check('opis pove število desk', d.includes('27'), d);
  check('opis pove, da število NI merilo', d.includes('ni merilo'), d);
  check('brez desk → prazen opis', describeStructure({ boardsDetected: null, plankCm: 10, gapCm: 2 }) === '');
}

// ── 4) Štetje desk na sintetični sliki (28 desk) ──────────────────
{
  const file = 'tests/fixtures/sinteticna-ograva.png';
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const quad: [number, number][] = [[11.0, 45.7], [88.0, 42.9], [86.0, 77.1], [12.0, 80.0]];
  const r = countBoardsInPlane({ rgba: new Uint8Array(data.buffer.slice(0)), W: info.width, H: info.height, quadPct: quad });
  check('preštete deske so blizu resnice (28)', r.boards !== null && Math.abs(r.boards - 28) <= 1, r);
  check('brez ravnine → brez števila', countBoardsInPlane({ rgba: new Uint8Array(data.buffer.slice(0)), W: info.width, H: info.height, quadPct: [] }).boards === null);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
