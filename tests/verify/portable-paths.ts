/**
 * Preverja, da nobena pot v izvornem kodu (aplikacija + testi) ni vezana na
 * konkretn stroj. Razlog: pet verify skriptov je mesecev padlo samo zato, ker
 * so pisali na `/tmp/...` ali brali absolutno pot razvojnega kontejnerja —
 * logika je bila pravilna, številka v dokumentih pa nezanesljiva.
 *
 * Deterministično: brez mreže, brez modelov, samo branje datotek v repozitoriju.
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, info?: string): void {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    console.log('  \u2717 ' + name + (info ? ' — ' + info : ''));
  }
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

// Vzorec je zložen iz delov, da se sam ne ujame (ta datoteka je edina, ki sme
// vsebovati te nize).
const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'absolutna pot kontejnerja', re: new RegExp('/' + 'home' + '/' + 'z' + '/' + 'my-project') },
  { label: 'tuja /tmp pot', re: new RegExp("['\"`]" + '/' + 'tmp' + '/') },
  { label: 'absolutna Windows pot uporabniškega doma', re: new RegExp('[Cc]:' + '\\' + '\\' + 'Users' + '\\' + '\\') },
];

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const FILES = tsFiles(join(ROOT, 'src')).concat(tsFiles(join(ROOT, 'tests')));

console.log(`skaniranih datotek: ${FILES.length} (src + tests)`);
check('skanira več datotek, kot jih je bilo popravljeno (vsaj 40)', FILES.length >= 40, `najdeno ${FILES.length}`);
check('skript sam je v skaniranem nizu — sicer izjema nič ne dokaže', FILES.includes(SELF));

const hits: string[] = [];
for (const f of FILES) {
  if (f === SELF) continue;
  const src = readFileSync(f, 'utf-8');
  src.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) hits.push(`${f}:${i + 1}: ${p.label}`);
    }
  });
}

check('nič absolutnih strojno vezanih poti v src/ in tests/', hits.length === 0, hits.slice(0, 6).join(' | '));
check(
  'pet popravljenih skriptov ostane brez vzorcev',
  ['canopy-analysis', 'deck-analysis', 'fasada-analysis', 'stair-profile', 'tile-grid'].every(
    (n) => !hits.some((h) => h.includes('verify/' + n + '.ts')),
  ),
);

// Prehodnost: fiksna pot mora biti odvedena iz import.meta.url, ne iz cwd.
const DERIVED = [
  'tests/verify/fasada-analysis.ts',
  'tests/verify/tile-grid.ts',
  'tests/make-task25-photo.ts',
  'tests/make-task27-photo.ts',
  'tests/make-task28-photo.ts',
  'tests/make-task30-photo.ts',
  'tests/make-task32-photo.ts',
  'tests/make-test-photo.ts',
  'tests/seed-test-photo.ts',
];
for (const rel of DERIVED) {
  const src = readFileSync(join(ROOT, rel), 'utf-8');
  check(`pot odvedena iz import.meta.url: ${rel}`, src.includes('import.meta.url'));
}

// Vsak skript, ki zapisuje datoteko (dokazni posnetek, fiksna slika, preneseno
// gradivo), mora svojo mapo odvesti iz os.tmpdir() — ne iz trdo zapisane poti.
const TMP_USERS = [
  'verify/canopy-analysis',
  'verify/deck-analysis',
  'verify/stair-profile',
  'verify/tile-grid',
  'e2e-colmap-cdp',
  'e2e-compare-check',
  'e2e-compare-fixture',
  'e2e-diary-cdp',
  'e2e-eslog-cdp',
  'e2e-suggest-fixture',
  'eslog-screens',
  'make-deka-fetch',
  'make-kubo-fetch',
  'make-ograje-fetch',
];
for (const rel of TMP_USERS) {
  const src = readFileSync(join(ROOT, 'tests', rel + '.ts'), 'utf-8');
  check(`os.tmpdir() + mkdirSync kot izhodna mapa: ${rel}`, src.includes('tmpdir()') && src.includes('mkdirSync'));
}

// Determinizem: enak izvor → enak seznam zadetkov.
const rerun: string[] = [];
for (const f of FILES) {
  if (f === SELF) continue;
  const src = readFileSync(f, 'utf-8');
  src.split('\n').forEach((line) => {
    for (const p of PATTERNS) if (p.re.test(line)) rerun.push('x');
  });
}
check('skop je determinističen (enako število zadetkov ob ponovitvi)', rerun.length === hits.length);

console.log('');
console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
