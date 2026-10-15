// Verifikacija Faze 4: Večpogled → merilni list (multiview-sheet.ts).
// Čiste funkcije, brez canvasa/slike — deterministični prevod verige 3D
// razdalj v PhotoMeasure z statusno pogodbo.
// Zagon: bun tests/verify/multiview-sheet.ts
import {
  MULTIVIEW_SHEET_VERSION,
  MULTIVIEW_SHEET_NOTE,
  multiViewChainToMeasures,
} from '../../src/lib/multiview-sheet';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); };
};

const CHAIN = [
  { i: 0, j: 1, cm: 42.3 },
  { i: 1, j: 2, cm: 118.65 },
  { i: 2, j: 3, cm: 30.02 },
];

// ── 1. Osnovni prevod (3 odseki) ─────────────────────────────
{
  console.log('osnovni prevod (3 odseki, CALIBRATED):');
  const out = multiViewChainToMeasures({ distancesCm: CHAIN, status: 'CALIBRATED', idPrefix: 't' });
  check('3 odseki + skupaj = 4 meritve', out.length === 4, `got ${out.length}`);
  check('oznake po verigi M1–M2, M2–M3, M3–M4',
    out[0].label === 'Večpogled M1–M2' && out[1].label === 'Večpogled M2–M3' && out[2].label === 'Večpogled M3–M4',
    out.map((m) => m.label).join(' | '));
  check('vrednosti ohranjene in zaokrožene na 0,1 cm',
    out[0].value === 42.3 && out[1].value === 118.7 && out[2].value === 30.0,
    out.map((m) => String(m.value)).join(', '));
  check('skupaj = vsota po poti (zaokroženo)', out[3].value === 191, `got ${out[3].value}`);
  check('oznaka skupaja', out[3].label === 'Večpogled veriga (skupaj)', out[3].label);
  check('vse kind length', out.every((m) => m.kind === 'length'));
  check('točke PRAZNE (3D meritev ni na fotki lista)', out.every((m) => m.points.length === 0));
  check('status prenesen nespremenjen (CALIBRATED)', out.every((m) => m.status === 'CALIBRATED'));
  check('metoda vedno multi-view', out.every((m) => m.method === 'multi-view'));
  check('deterministični id-ji (t-1..t-3, t-sum)',
    out[0].id === 't-1' && out[1].id === 't-2' && out[2].id === 't-3' && out[3].id === 't-sum',
    out.map((m) => m.id).join(','));
}

// ── 2. AUTO_SUGGESTED + en odsek (brez skupaja) ──────────────
{
  console.log('AUTO_SUGGESTED + 1 odsek:');
  const out = multiViewChainToMeasures({ distancesCm: [CHAIN[0]], status: 'AUTO_SUGGESTED' });
  check('1 odsek → 1 meritev (brez vrstice skupaj)', out.length === 1, `got ${out.length}`);
  check('status AUTO_SUGGESTED prenesen', out[0].status === 'AUTO_SUGGESTED');
  check('privzeta predpona mv', out[0].id === 'mv-1', out[0].id);
}

// ── 3. Prazen vnos ───────────────────────────────────────────
{
  console.log('prazen vnos:');
  check('prazna veriga → prazna tabela',
    multiViewChainToMeasures({ distancesCm: [], status: 'CALIBRATED' }).length === 0);
}

// ── 4. Iskreni neuspehi (eksplicitni) ────────────────────────
{
  console.log('iskreni neuspehi:');
  let threw: string | null = null;
  try { multiViewChainToMeasures({ distancesCm: CHAIN, status: null }); }
  catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check('status null → Error z NEZADOSTNI PODATKI', threw?.includes('NEZADOSTNI PODATKI') === true, threw ?? 'no throw');
  let threw2: string | null = null;
  try { multiViewChainToMeasures({ distancesCm: CHAIN, status: 'MANUAL' }); }
  catch (e) { threw2 = e instanceof Error ? e.message : String(e); }
  check('status MANUAL → Error (validateMultiView ga nikoli ne vrne)', threw2?.includes('MANUAL') === true, threw2 ?? 'no throw');
}

// ── 5. Determinizem po bajtih ────────────────────────────────
{
  console.log('determinizem:');
  const a = multiViewChainToMeasures({ distancesCm: CHAIN, status: 'AUTO_SUGGESTED' });
  const b = multiViewChainToMeasures({ distancesCm: CHAIN, status: 'AUTO_SUGGESTED' });
  check('isti vhodi → identičen JSON', JSON.stringify(a) === JSON.stringify(b));
  const c = multiViewChainToMeasures({ distancesCm: [{ i: 0, j: 1, cm: 42.35 }], status: 'AUTO_SUGGESTED' });
  check('0,05 cm razlike → druga vrednost (42,4 vs 42,3)', c[0].value === 42.4 && b[0].value === 42.3, `${c[0].value}`);
}

// ── 6. Konstante ─────────────────────────────────────────────
{
  console.log('konstante:');
  check('MULTIVIEW_SHEET_VERSION = 1.0.0', MULTIVIEW_SHEET_VERSION === '1.0.0');
  check('žig omenja trak/laser (iskrenost)', MULTIVIEW_SHEET_NOTE.includes('trakom ali laserjem'), MULTIVIEW_SHEET_NOTE);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
