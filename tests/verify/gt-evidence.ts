// 48. skript v sweepu — dokazna gradiva dvotapnega predloga (tests/gt/).
//
// NAMEENJENOST. V dokumentih (glava src/lib/band-suggest.ts, docs/,
// tests/gt/README.md) stojijo številke: mediana 2,3 %, trapež 3,3 %, zunanji
// zadetek 8,0 % / max 24,3 %, 512 px → 13,2 %. Te številke so bile izmerjene na
// fotkah, KI JIH NI V REPOZITORIJU (tuje hiše; objavo mora odobriti monter),
// zato jih noben navaden test ne more ponoviti. Ta skript zato NE meri — on
// preverja, da so ZAMRZNJENI IZPISI sonde še na mestu, da se ujemajo s številkami
// v dokumentih in da jih nobena roka ni skrajšala ali prepisala.
//
// POGODBA, KI JO TESTIRA. Brez te preizkušnje bi lahko kdorkoli izbrisal
// `tests/gt/outputs/`, ali pa v glavi modula spremenil 2,3 % v 1,0 %, in sweep
// bi bil še vedno zelen. Številka, ki je ni več mogoče ponoviti, je trditev brez
// dokaza — to je napaka, ne okras.
//
// TESTI, KI IH NI (in zakaj):
//   - ponovitev meritev: rabí fotokorpus; skript mora teči brez njega, sicer ne
//     sme v sweep. Izpise znova požene človek z `bun tests/gt/<sonda>.ts <fotke>`.
//   - numerična primerjava "samodejno": izpisi so besedilo, ne structured data,
//     ker jih je treba brati z odločitvijo vred. Testira se prisotnost vsake
//     dokumentirane številke v njenem redu vrstic, ne povzetek.
//
// Zagon: bun tests/verify/gt-evidence.ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { GT_CASES } from '../gt/gt-quads';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GT = (p: string): string => join(ROOT, 'tests/gt', p);

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, info?: string): void => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};

// Decimalni ločil v izpisih je pika (toFixed), v dokumentih vejica. Oboje je
// ista številka, zato obrazec dovoli oba — sicer bi bil test odvisen od tega,
// katero tipkografijo je izbrila sonda.
const NUM = (n: string): string => n.replace('.', '[.,]');

/** Vrstica, ki se začne z `start` (iz večvrstičnega besedila). */
const lineStartingWith = (text: string, start: string): string | undefined =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(start));

type Evidence = { file: string; minBytes: number; locks: Array<[string, RegExp]> };

// Vsak zaklep = ena številka, ki jo nekje trdimo. `file` je izpis sonde, ki jo
// je izmerila; če vzorec izgine, izpis in dokument nista več isti dokaz.
const EVIDENCE: Evidence[] = [
  {
    file: 'outputs/2026-10-16-sonda1-bazeline.txt',
    minBytes: 3000,
    locks: [
      ['bazni predlog: mediana 2,3 % / max 10,1 %', new RegExp(`mediana ${NUM('2.3')} %.*max ${NUM('10.1')} %`)],
      ['zavrnjeni prag 0,80 je v izpisu', /prag podpore 0[.,]80/],
      ['zavrnjeni prag 0,90 je v izpisu', /prag podpore 0[.,]90/],
      ['zavrnjena toleranca ±3 px je v izpisu', /toleranca roba ±3 px/],
      ['5 najdenih / 5 zavrnjenih', /najdenih 5, zavrnjenih 5/],
      ['odločitveno pravilo (mediana IN max, ne število pasov)', /MEDIANI in MAX/],
    ],
  },
  {
    file: 'outputs/2026-10-16-sonda2-trapez.txt',
    minBytes: 2000,
    locks: [
      ['pravokotnik 2,3 % (istámera kot sonda 1)', /V0 pravokotnik\s+mediana 2[.,]3 %/],
      ['trapež 3,3 % → PADLEC', /V1 trapež\S*\s+mediana 3[.,]3 %/],
      ['trapežev je samo 3 od 10 (ostali padec nazaj)', /trapezov 3/],
    ],
  },
  {
    file: 'outputs/2026-10-16-sonda3-pravilo-ustavljanja.txt',
    minBytes: 2000,
    locks: [
      ['V0 prvi zadetek (produkcija) je merjen', /V0 prvi zadetek \(produkcija\)/],
      ['zunanji zadetek 8,0 % / max 24,3 % → PADEC', new RegExp(`mediana ${NUM('8.0')} %, max ${NUM('24.3')} %`)],
      ['najboljša podpora 4,6 % / max 24,3 % → PADEC na max', new RegExp(`mediana ${NUM('4.6')} %, max ${NUM('24.3')} %`)],
      ['KONTROLA: lokalna reimplementacija = produkcija v 10/10', /enako v 10 od 10 primerov/],
    ],
  },
  {
    file: 'outputs/2026-10-16-sonda4-locljivost.txt',
    minBytes: 1500,
    locks: [
      ['10 tirnic v obsegu premerjenih', /V obsegu premerjenih tirnic: 10\./],
      ['GT rob preseže prag pri ±2 px v 8/10', new RegExp(`preseže prag pri ±2 px: 8 od ${NUM('10')}`)],
      ['napačna vrstica je močneje podprta v 4/10', /VEČ podpore kot GT rob: 4 od 10/],
      ['GT zmaga z občutno prednostjo samo v 2/10', /0[.,]02.*\b2 od 10/],
      ['sklep: omejitev je robni zemljevid', /robni zemljevid ostane omejitev/],
    ],
  },
  {
    file: 'outputs/2026-10-16-sonda5-resolucija.txt',
    minBytes: 800,
    locks: [
      // Vsaka vrstica tabele posebej: številka mora stati NA SVOJI vrsti, sicer
      // bi bila zamenjava stolpcev (npr. max namesto mediane) neopazna.
      ['192 px → 5,5 %', /192.*5[.,]5 %/],
      ['256 px → 2,3 % (izbrana)', /256.*2[.,]3 %/],
      ['320 px → 3,0 %', /320.*3[.,]0 %/],
      ['384 px → 6,5 %', /384.*6[.,]5 %/],
      ['512 px → 13,2 %', /512.*13[.,]2 %/],
    ],
  },
];

const contents = new Map<string, string>();

console.log('1) ground truth: oblika in obseg (brez fotk se da preveriti vse');
{
  check('10 primerov (5 v obsegu + 5 izven)', GT_CASES.length === 10, `${GT_CASES.length}`);
  const inScope = GT_CASES.filter((c) => c.inScope);
  check('5 primerov v obsegu', inScope.length === 5, `${inScope.length}`);
  const expectedIn = ['04.jpg', '04.jpg#zgoraj', '16.jpg', '15.jpg', '05.jpg'];
  check(
    'v obsegu so TOČNO tisti primeri, ki jih navajajo dokumenti',
    expectedIn.every((f) => inScope.some((c) => c.file.endsWith(f))) && inScope.length === expectedIn.length,
    inScope.map((c) => c.file.split('/').pop()).join(' '),
  );
  check(
    'vsak primer ima 4 oglišča',
    GT_CASES.every((c) => c.quad.length === 4),
    GT_CASES.filter((c) => c.quad.length !== 4).map((c) => c.file).join(' '),
  );
  const oob = GT_CASES.filter((c) => c.quad.some(([x, y]) => x < 0 || x > 100 || y < 0 || y > 100));
  check('vsa oglišča so v okviru slike (0–100 %)', oob.length === 0, oob.map((c) => c.file).join(' '));
  check(
    'v obsegu noben rob ne leži na robu slike (rob kadra ni tirnica)',
    inScope.every((c) => c.quad.every(([x, y]) => x > 0 && x < 100 && y > 0 && y < 100)),
    inScope.filter((c) => c.quad.some(([x, y]) => x === 0 || y === 0 || x === 100 || y === 100))
      .map((c) => c.file)
      .join(' '),
  );
  check(
    'vsak primer razloži, kaj je na fotki (`what`) in zakaj je v/izven obsega (`why`)',
    GT_CASES.every((c) => c.what.length > 10 && c.why.length > 10),
  );
  check(
    'vsak `why` vsebuje razlog, ne prazne besede',
    GT_CASES.every((c) => /[a-zčšž]/i.test(c.why) && c.why.length > 20),
  );
  const dup = GT_CASES.map((c) => c.file).filter((f, i, a) => a.indexOf(f) !== i);
  check('brez podvojenih primerov', dup.length === 0, dup.join(' '));
  const outside = GT_CASES.filter((c) => !c.inScope);
  check(
    'izven obsega: vsak utemelji, kaj pogoj ruši (odrezan rob, tla, kot, velikost)',
    outside.length === 5 && outside.every((c) => /kadr|rob|ploskev|kot|1 %|~1|mejo|ZUNAJ|mali|nedokonč|tle|strop/i.test(c.why)),
  );
}

console.log('\n2) dokazni izpisi sonde: obstajajo, niso skrajšani');
for (const ev of EVIDENCE) {
  const path = GT(ev.file);
  const exists = existsSync(path);
  check(`${ev.file} obstaja`, exists);
  if (!exists) continue;
  const raw = readFileSync(path, 'utf8');
  contents.set(ev.file, raw);
  check(`${ev.file} ni pokrajšan (${raw.length} B)`, raw.length >= ev.minBytes, `pričakovano ≥ ${ev.minBytes} B`);
  check(`${ev.file} ima glavo sonde (maxSide + fotokorpus)`, /=====.*(maxSide|fotokorpus)|fotokorpus:/.test(raw));
}

console.log('\n3) dokumentirane številke se ujemajo z zamrznjenim izpisom');
for (const ev of EVIDENCE) {
  const raw = contents.get(ev.file);
  if (raw === undefined) {
    check(`${ev.file}: vsaka dokumentirana številka`, false, 'izpisa ni, dokaza ni');
    continue;
  }
  for (const [label, re] of ev.locks) {
    check(`${ev.file.split('/').pop()}: ${label}`, re.test(raw));
  }
}
{
  const raw = contents.get('outputs/2026-10-16-sonda5-resolucija.txt');
  if (raw) {
    const rows = ['192', '256', '320', '384', '512'];
    const bad = rows.filter((r) => {
      const line = lineStartingWith(raw, r);
      return !line || !/%/.test(line);
    });
    check('tabela ločljivosti ima vrsto za vsako izmero (192/256/320/384/512)', bad.length === 0, bad.join(' '));
    const l256 = lineStartingWith(raw, '256');
    const l512 = lineStartingWith(raw, '512');
    check(
      'na 256 px je mediana MANJŠA kot na 512 px (sicer izbira ni utemeljena)',
      l256 !== undefined && l512 !== undefined && l256.includes('2.3 %') && l512.includes('13.2 %'),
    );
  }
}

console.log('\n4) sonde merijo IZDELAN modul, ne svoje kopije');
{
  const probes = [
    'probe-band-module.ts',
    'probe-per-side-rail.ts',
    'probe-stop-rule.ts',
    'probe-rail-visibility.ts',
    'probe-resolution.ts',
  ];
  for (const p of probes) {
    const path = GT(p);
    const exists = existsSync(path);
    check(`tests/gt/${p} obstaja`, exists);
    if (!exists) continue;
    const src = readFileSync(path, 'utf8');
    contents.set(p, src);
    check(
      `${p}: uvozi izdani modul (../../src/lib/band-suggest)`,
      src.includes('../../src/lib/band-suggest') || p === 'probe-band-module.ts',
      'sonda meri kopijo — izmerjena številka ne velja za produkt',
    );
    check(
      `${p}: ne vse lastne kopije iskalne logike (findRail/suggestBand def)`,
      !/function suggestBand|const suggestBand =/.test(src) && !/function findRail/.test(src),
    );
    check(`${p}: bere GT iz tests/gt/gt-quads (ne izven repozitorija)`, src.includes('./gt-quads'));
    check(
      `${p}: ne piše datotek (izpise cattura človek z preusmeritvijo)`,
      !/writeFileSync|appendFileSync|mkdirSync|Bun\.write/.test(src),
    );
  }
  const shared = GT('harness.ts');
  check('skupni vodila tests/gt/harness.ts obstaja', existsSync(shared));
  if (existsSync(shared)) {
    const src = readFileSync(shared, 'utf8');
    check('harness: manjkajoč fotokorpus je GLASNA napaka (exit 2, ne tiha ničla)', /process\.exit\(2\)/.test(src));
    check(
      'harness: pot do fotk je ARGUMENT/okoljska spremenljivka, ne vgrajen privzetek',
      !/\/home\/|C:\\Users/.test(src) &&
        !/=\s*['"]\.\.\/fb-hi/.test(src) &&
        /process\.argv\[2\]/.test(src) &&
        /ROKSAL_GT_PHOTOS/.test(src),
    );
    check('harness: manjkajočo fotko javi z exit 2', /existsSync/.test(src) && /process\.exit\(2\)/.test(src));
    check('harness: izračuna mediano na enem mestu (sonde je ne reimplementirajo)', /export const median =/.test(src));
    for (const p of ['probe-band-module.ts', 'probe-per-side-rail.ts', 'probe-stop-rule.ts', 'probe-resolution.ts']) {
      check(`${p}: mediano uvozi iz harnessa`, (contents.get(p) ?? '').includes("from './harness'"));
    }
  }
  const gtq = GT('gt-quads.ts');
  check('tests/gt/gt-quads.ts obstaja v repozitoriju', existsSync(gtq));
  if (existsSync(gtq)) {
    const src = readFileSync(gtq, 'utf8');
    check('gt-quads: NE vsebin slik (samo koordinate + opisi)', !/base64|data:image/.test(src));
    check(
      'gt-quads: dokumentira, da vrstni red oglišč ZL/ZD/SD/SL in enote % slike',
      /ZL/.test(src) && /Odst|odsto/.test(src),
    );
  }
  // Sklic na izpis, ki ga ni, je tiha napaka: bralec odide iskat dokaz, ki ga
  // ni več (to se je zgodilo z `2026-10-16-res-sweep.txt` v glavi harness.ts).
  {
    const named = new Set<string>();
    const files = [
      GT('harness.ts'),
      GT('README.md'),
      GT('probe-band-module.ts'),
      GT('probe-per-side-rail.ts'),
      GT('probe-stop-rule.ts'),
      GT('probe-rail-visibility.ts'),
      GT('probe-resolution.ts'),
      join(ROOT, 'tests/verify/gt-evidence.ts'),
    ];
    for (const p of files) {
      if (!existsSync(p)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/outputs\/([\w.\-]+\.txt)/g)) named.add(m[1]);
    }
    const missing = [...named].filter((n) => !existsSync(GT(join('outputs', n))));
    check(
      `noben sklic na izpis (${named.size}) ne visi v prazno`,
      named.size >= 5 && missing.length === 0,
      missing.join(' '),
    );
  }
}

console.log('\n5) odločitve v izdanem kodu so STILL dokumentirane');
{
  const band = readFileSync(join(ROOT, 'src/lib/band-suggest.ts'), 'utf8');
  check(
    'odločitev 2 živi: NAKLONA modul NE OCENJUJE (toisto ime zaklene band-ui-contract)',
    /NAKLONA modul NE OCENJUJE/.test(band),
  );
  check(
    'odločitev 5 živi: zavrnjene hipoteze (trapež / zunanji / najboljša podpora / ločljivost)',
    /TRAPEŽ/.test(band) && /ZUNANJI/.test(band) && /NAJBOLJŠO/.test(band) && /LOČLJIVOST/.test(band),
  );
  check('odločitev 5 napotí na dokazno gradivo (tests/gt)', /tests\/gt\//.test(band));
  {
    const outputs = [...contents.entries()]
      .filter(([k]) => k.startsWith('outputs/'))
      .map(([, v]) => v)
      .join('\n');
    const lines = band.split('\n');
    const offenders: string[] = [];
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/(\d,\d)\s?%/g)) {
        const num = m[1].replace(',', '.');
        if (outputs.includes(num)) continue;
        const ctx = lines.slice(Math.max(0, idx - 2), idx + 3).join(' ');
        if (!/worklog/i.test(ctx)) offenders.push(`${num} % (vrstica ${idx + 1})`);
      }
    });
    check(
      'vsaka številka v glavi ima zamrznjen izpis ALI pa vrstica pove, kje dokaz je',
      offenders.length === 0,
      offenders.join(', '),
    );
  }
  check(
    'BAND_LIMITS še vedno vsebuje izmerjene pragove (0,85 / ±2 px / 64 vzorcev)',
    /minSupport: 0\.85/.test(band) && /edgeTolerancePx: 2/.test(band) && /samples: 64/.test(band),
  );
  const readme = GT('README.md');
  check('tests/gt/README.md obstaja', existsSync(readme));
  if (existsSync(readme)) {
    const src = readFileSync(readme, 'utf8');
    check('README: pojasni, zakaj sond NI v sweepu (fotke lastnika)', /fotke|Fotke/.test(src) && /sweep/.test(src));
    check('README: izpisi v outputs/ so zamrznjen dokaz, ne paživi', /zamrznjen/.test(src));
    check('README: pove, kaj mapa NE dokaže (majhen vzorec, brez kataloga)', /NE dokaže/.test(src) && /katalog/.test(src));
  }
}

console.log('\n6) mutacijski dokaz: testi dejansko LOČijo napačen dokaz');
{
  const raw = contents.get('outputs/2026-10-16-sonda5-resolucija.txt') ?? '';
  const swapped = raw.replace('13.2 %', '2.3 %');
  check(
    'če zamenjam 512 px vrsto na 2,3 %, test to ULOVI (sicer ne preverja ničesar)',
    !/512.*13[.,]2 %/.test(swapped),
  );
  const truncated = raw.slice(0, Math.floor(raw.length / 3));
  check('če izpis porežem na tretjino, ga velikostna mera zavrne', truncated.length < 800);
  const band = readFileSync(join(ROOT, 'src/lib/band-suggest.ts'), 'utf8');
  const withoutNoTilt = band.replace('NAKLONA modul NE OCENJUJE', 'NAKLONA modul OCENJUJE');
  check('če iz glave izbrisem prepoved nagiba, test to ULOVI', !/NAKLONA modul NE OCENJUJE/.test(withoutNoTilt));
  const fakeQuad = GT_CASES.map((c, i) => (i === 0 ? { ...c, quad: [[101, 50], [50, 50], [50, 50], [0, 50]] } : c));
  check(
    'oglišče na 101 % bi prošlo samo če meja ne bi bila preverjena',
    fakeQuad.some((c) => c.quad.some(([x]) => x > 100)),
  );
  check('NUM() dopusti piko IN vejico (izpisi pika, dokumenti vejica)', NUM('2.3') === '2[.,]3');
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) {
  console.log(
    '\nKAJ STORITI: dokazna gradiva so POSNEMKI sonde, ne numerična osnova. Če se\n' +
      'razlike ujemajo, jih POSODOBI v dokumentih in znova poženi sondo na fotkah\n' +
      '(`bun tests/gt/<sonda>.ts ../fb-hi 256 > tests/gt/outputs/<dan>-<sonda>.txt`),\n' +
      'ne pa ročno prepisuj izpisov. Če fotk ni, številka v dokumentu NIMA več\n' +
      'dokaza — umakni jo iz dokumenta in odločitev ponovno razmisli.',
  );
}
process.exit(fail === 0 ? 0 : 1);
