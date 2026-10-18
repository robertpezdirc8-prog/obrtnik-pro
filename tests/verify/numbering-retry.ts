/**
 * Preverja atomsko številčenje (src/lib/numbering.ts) z SINTEZIČNIMI
 * napakami P2002 — brez baze, brez Prisme, deterministično.
 *
 * Pokrito:
 *  - brez trka: generate klican natanko 1×, attempts = 1
 *  - enkraten trk: drugi poskus uspe, generate klican 2×, attempts = 2
 *  - več zaporednih trkov: uspe na N-tem poskusu, generate točko pričakovano
 *  - trk VEDNO: po maxAttempts pade z ZADNJO napako (ne z novim Errorjem)
 *  - tuja napaka (code ≠ P2002, pa tudi brez code) se PROPAGIRA takoj —
 *    ni ponovljen in ni požrt
 *  - sleep je injektiran: ni realnega spanja, razpored je 20·poskus
 *  - številke, podane v attempt, so TOČNO izhodi generate (brez spreminjanja)
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 */

import { createWithUniqueNumber, MAX_NUMBER_ATTEMPTS } from '../../src/lib/numbering';

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

/** Sintetična Prisma P2002 — duck-typing po `code`, kot prava napaka. */
const P2002 = (): Error & { code: string } =>
  Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

interface Sled {
  generirane: string[];
  poskusi: string[];
  spani: number[];
}

/** Ustvari generater, ki prve `trki` številk zavrne s P2002. */
function scena(številke: string[], trki: Set<string>): {
  generate: () => Promise<string>;
  attempt: (n: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  sled: Sled;
} {
  const sled: Sled = { generirane: [], poskusi: [], spani: [] };
  return {
    sled,
    generate: async () => {
      const n = številke[sled.generirane.length];
      sled.generirane.push(n);
      return n;
    },
    attempt: async (n: string) => {
      sled.poskusi.push(n);
      if (trki.has(n)) throw P2002();
      return `OK(${n})`;
    },
    sleep: async (ms: number) => {
      sled.spani.push(ms);
    },
  };
}

// ── 1. Brez trka ────────────────────────────────────────────
{
  const s = scena(['2026-001'], new Set());
  const r = await createWithUniqueNumber(s.generate, s.attempt, { sleep: s.sleep });
  check('brez trka vrne vrednost', r.value === 'OK(2026-001)', String(r.value));
  check('brez trka attempts = 1', r.attempts === 1, String(r.attempts));
  check('generate klican natanko 1×', s.sled.generirane.length === 1, String(s.sled.generirane.length));
  check('brez trka ni spanja', s.sled.spani.length === 0, JSON.stringify(s.sled.spani));
  console.log('brez trka:');
}

// ── 2. Enkraten trk ─────────────────────────────────────────
{
  const s = scena(['2026-001', '2026-002'], new Set(['2026-001']));
  const r = await createWithUniqueNumber(s.generate, s.attempt, { sleep: s.sleep });
  check('ob enkratnem trku uspe drugi poskus', r.value === 'OK(2026-002)', String(r.value));
  check('attempts = 2', r.attempts === 2, String(r.attempts));
  check('generate klican 2×', s.sled.generirane.join(',') === '2026-001,2026-002');
  check('attempt dobil TOČNO generirane številke', s.sled.poskusi.join(',') === s.sled.generirane.join(','));
  check('med poskusoma eno spanje 20 ms', s.sled.spani.join(',') === '20', JSON.stringify(s.sled.spani));
  console.log('enkraten trk:');
}

// ── 3. Več zaporednih trkov, uspe na 3. poskusu ─────────────
{
  const s = scena(['2026-001', '2026-002', '2026-003'], new Set(['2026-001', '2026-002']));
  const r = await createWithUniqueNumber(s.generate, s.attempt, { sleep: s.sleep });
  check('uspe na 3. poskusu', r.value === 'OK(2026-003)' && r.attempts === 3, String(r.attempts));
  check('spanja sledijo 20·poskus (20, 40)', s.sled.spani.join(',') === '20,40', JSON.stringify(s.sled.spani));
  console.log('več trkov:');
}

// ── 4. Trk vedno — pade po maxAttempts z ZADNJO napako ─────
{
  const s = scena(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], new Set());
  const zadnjaNapaka = P2002();
  const attempt = async (n: string): Promise<string> => {
    s.sled.poskusi.push(n);
    throw n === 'A5' ? zadnjaNapaka : P2002();
  };
  let padla: unknown;
  try {
    await createWithUniqueNumber(s.generate, attempt, { sleep: s.sleep, maxAttempts: 5 });
  } catch (e) {
    padla = e;
  }
  check('ob trkovanju VEDNO je napaka propagirana', padla instanceof Error, String(padla));
  check('propagirana je ZADNJA napaka, ne nova', padla === zadnjaNapaka);
  check('poskusov je natanko maxAttempts', s.sled.poskusi.length === 5, String(s.sled.poskusi.length));
  check('generate klican samo tolikokrat, kot je poskusov', s.sled.generirane.length === 5);
  check('med poskusi je spanje natanko maxAttempts-1×', s.sled.spani.length === 4, JSON.stringify(s.sled.spani));
  console.log('trk vedno:');
}

// ── 5. Tuje napake se propagirajo takoj ─────────────────────
{
  const tujca = Object.assign(new Error('foreign'), { code: 'P9999' });
  const s = scena(['X1'], new Set());
  const attempt = async (): Promise<string> => {
    throw tujca;
  };
  let padla: unknown;
  try {
    await createWithUniqueNumber(s.generate, attempt, { sleep: s.sleep });
  } catch (e) {
    padla = e;
  }
  check('tuja napaka (code P9999) je propagirana', padla === tujca);
  check('tuja napaka NI ponovljena', s.sled.generirane.length === 1, String(s.sled.generirane.length));

  const s2 = scena(['Y1'], new Set());
  const brezKode = new Error('brez kode');
  const attempt2 = async (): Promise<string> => {
    throw brezKode;
  };
  let padla2: unknown;
  try {
    await createWithUniqueNumber(s2.generate, attempt2, { sleep: s2.sleep });
  } catch (e) {
    padla2 = e;
  }
  check('napaka brez code je propagirana', padla2 === brezKode);
  check('napaka brez code NI ponovljena', s2.sled.generirane.length === 1);
  console.log('tuje napake:');
}

// ── 6. Privzeti maxAttempts in brez opts ────────────────────
{
  check('MAX_NUMBER_ATTEMPTS = 5', MAX_NUMBER_ATTEMPTS === 5, String(MAX_NUMBER_ATTEMPTS));
  const s = scena(['Z1'], new Set());
  const r = await createWithUniqueNumber(s.generate, s.attempt);
  check('klic brez opts deluje (realno spanje 0× pri uspehu)', r.attempts === 1 && s.sled.spani.length === 0);
  console.log('privzetki:');
}

console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
