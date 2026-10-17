// ─── Merljiv seštevek vseh `tests/verify/*.ts` preverb ─────────────────────
// ZAKAJ: README trdi «2757 preverb», toda ta številka je bila doslej sešteta
// ROČNO iz posameznih izpisov, ker formati povzetkov niso enotni
// (`REZULTAT: N OK, M NAPAK`, `N/M preverb`, `Časovnica: 74 OK`, `N uspešnih`,
// `N ✓ / M ✗`). Ročno seštevanje je isto kot spomin: enkrat zamerzi.
//
// KAJPRIKAŽE:
//  1. vsak `tests/verify/*.ts` je zagnan z `bun` in njegova izhodna koda je
//     zabeležena;
//  2. zadnja vrsta izpisa, ki ustreza KATEREMUKOLI znanim formatom, je
//     razčlenjena na (prehodni, neuspešni);
//  3. skript brez razčlenjenega povzetka in brez upravičene izjeme je TRDNA
//     napaka — število preverb ne more izginiti tiho;
//  4. izpisana je razpredelnica vrstico za vrstico, da lahko kdorkoli ponovi
//     in primerja posamezen skript, ne samo seštevka.
//
// SAMOZANESTLJIVOST: ta datoteka živi V `tests/`, NE v `tests/verify/` —
// sicer bi bila v svojem lastnem sweepu in bi se zagnala dvakrat.
//
// Zagon:  bun tests/verify-counts.ts
// Izhod:  0 = vsi skripti zeleni in vsi povzetki razčlenjeni; 1 = sicer.
// Nič ne piše na disk in nič ne kliče po mreži.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

interface Rule {
  /** Obrazec z dvema ujetima številoma. */
  re: RegExp;
  /**
   * Kaj pomeni DRUGO število: `fail` je število neuspešnih, `total` je število
   * vseh. To ni kozmetika — `35/35 testov uspešnih` z drugim kot neuspešnim
   * poroča 35 napak povsod, kjer je format ulomek, in seštevek postane lažen.
   */
  second: 'fail' | 'total';
  /** Kratek opis formata za razpredelnico. */
  fmt: string;
}

// Vrstni red je pomemben: najbolj specifičen obrazec najprej, da `REZULTAT: N
// OK, M NAPAK` ne uide genericnemu `(\d+) uspešnih, ...`.
const RULES: Rule[] = [
  { re: /REZULTAT:\s*(\d+)\s*OK,\s*(\d+)\s*(?:NAPAK|FAIL)/i, second: 'fail', fmt: 'REZULTAT: N OK, M NAPAK' },
  { re: /(\d+)\s*preverjanj[^\d]*(\d+)\s*OK\s*·\s*(\d+)\s*NAPAK/, second: 'fail', fmt: 'N preverjanj · N OK · M NAPAK' },
  { re: /(\d+)\s*(?:uspe[šs]nih|pre[šs]lo),\s*(\d+)\s*(?:neuspe[šs]nih|spodletelih|padlo)/, second: 'fail', fmt: 'N uspešnih, M neuspešnih' },
  { re: /(\d+)\s*OK\s*\/\s*(\d+)\s*(?:NAPAK|FAIL)/i, second: 'fail', fmt: 'N OK / M FAIL' },
  { re: /(\d+)\s*OK[^\d]{1,4}(\d+)\s*(?:NAPAK|FAIL)/i, second: 'fail', fmt: 'ime: N OK, M NAPAK' },
  { re: /^[\s═]*\D*?(\d+)\/(\d+)\s*(?:preverb|testov uspe[šs]nih|✓)/, second: 'total', fmt: 'N/M' },
  { re: /(\d+)\s*✓\s*\/\s*(\d+)\s*✗/, second: 'fail', fmt: 'N ✓ / M ✗' },
];

// Skripti BREZ brojača preverb — upravičeni, a na seznamu, ker nova datoteka
// brez povzetka sicer pomeni, da je iz števke izpadla neopaženo. Razlog je
// del poročila, ne komentar v kodi.
const NO_COUNTER: Record<string, string> = {
  'features-photos.ts': 'raziskovalni izpis mer (featurer na fotkah), ne preverb',
  'real-photos.ts': 'raziskovalni izpis mer (pitch dekorja), ne preverb',
  'structure-photos.ts': 'raziskovalni izpis mer (usmerjenost desk), ne preverb',
  'debug-energies.ts': 'dijagnostična razpredelnica, ne preverb',
  'scores-debug.ts': 'dijagnostična razpredelnica, ne preverb',
  'quality-calibrate.ts': 'kalibracijska razpredelnica, ne preverb',
  'scene-classify.ts': 'klasifikacijski izpis, ne preverb',
  'cenik-fixture.ts': 'skupni podatki za cenikove skripte, ne preverb (sama nima trditev)',
};

const BUN = process.execPath; // zagnan z `bun`, torej je to bunov binar
const dir = 'tests/verify';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .sort();

interface Row {
  file: string;
  code: number;
  ok: number | null;
  fail: number | null;
  fmt: string | null;
  note: string;
}

const rows: Row[] = [];
for (const f of files) {
  const r = spawnSync(BUN, [`${dir}/${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const code = r.status ?? -1;
  const lines = out.split(/\r?\n/).reverse();
  let hit: { ok: number; fail: number; fmt: string } | null = null;
  scanLines: for (const line of lines) {
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.second === 'total') {
        const all = Number(m[2]);
        const passed = Number(m[1]);
        hit = { ok: passed, fail: Math.max(0, all - passed), fmt: rule.fmt };
      } else {
        // OK je VEDNO drugo-od-konca ujeto število, NAPAK zadnje: pri
        // `N preverjanj · N OK · M NAPAK` je prvo število samo naziv.
        hit = { ok: Number(m[m.length - 2]), fail: Number(m[m.length - 1]), fmt: rule.fmt };
      }
      break scanLines;
    }
  }
  rows.push({
    file: f,
    code,
    ok: hit?.ok ?? null,
    fail: hit?.fail ?? null,
    fmt: hit?.fmt ?? null,
    note: hit ? '' : NO_COUNTER[f] ?? (code === 0 ? 'NI POVZETKA in ni na seznamu izjem' : 'skript padel, povzetka ni'),
  });
}

let totOk = 0;
let totFail = 0;
const problems: string[] = [];
console.log('datoteka                        OK   NAPAK  izhod  format / opomba');
for (const row of rows) {
  const f = row.file.padEnd(30);
  if (row.code !== 0) problems.push(`${row.file}: izhodna koda ${row.code}`);
  if (row.ok === null) {
    if (!NO_COUNTER[row.file]) problems.push(`${row.file}: ${row.note}`);
    console.log(`${f}  ${'—'.padStart(4)}  ${'—'.padStart(5)}   ${String(row.code).padStart(4)}   ${row.note}`);
    continue;
  }
  totOk += row.ok;
  totFail += row.fail ?? 0;
  if (row.fail !== 0) problems.push(`${row.file}: ${row.fail} neuspešnih preverb`);
  console.log(`${f}  ${String(row.ok).padStart(4)}  ${String(row.fail).padStart(5)}   ${String(row.code).padStart(4)}   ${row.fmt}`);
}

const counted = rows.filter((r) => r.ok !== null).length;
const exempt = rows.filter((r) => r.ok === null && NO_COUNTER[r.file]).length;
console.log('');
console.log(
  `SKUPAJ: ${totOk} OK, ${totFail} NAPAK — razčlenjeno v ${counted} od ${rows.length} skriptov ` +
    `(${exempt} brez brojača, upravičeno).`,
);
console.log(`Ponovi z: bun tests/verify-counts.ts  (ta datoteka sama ni v sweepu).`);

if (problems.length) {
  console.log('\nTEŽAVE:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
process.exit(totFail === 0 ? 0 : 1);
