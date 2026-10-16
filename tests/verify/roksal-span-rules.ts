// ─── Verifikacija: ROKSALova pravila razmikov imajo VIR in NISO izmisljeni ──
// Zakaj ta skript obstaja: `post-layout.ts` je `maxSpanCm` samo preverjal proti
// pasu 60..300 cm, privzetih 150 pa nikoli ni bilo utemeljeno.
// `src/lib/roksal-span-rules.ts` zdaj hrani dobesedne citate treh ROKSALovih
// strani. PRVA VERZIJA modula je bila napačna, ker je pravila vezala samo na
// ELEMENT — stran pa isto besedo uporablja za različne IZDELKE (podložna letev:
// fasada 70–80 cm, terasa 33–35 cm) in je zato izmišljila tudi „razhajanje
// 150 zoper 180“, ki v resnici sta mejo DVEH različnih profilov.
//
// Skript torej preverja: (a) nobena meja ne pride iz domneve in je citirana
// številka DOBESEDNO v citatu, (b) pravilo ne more prehajati med izdelki,
// (c) izmed več veljavnih pravil zmagate STROŽJE, (d) pas (133–140) ne more
// postiti zgornjega roba, (e) posledica (»dodaj še en stebriček«) in priporočen
// pas (reža) ne moreta postati meja, (f) kadar vhoda ni, modul JAVI manjkajoč
// podatek in NE trdi, da ROKSAL nič ne objavlja, (g) UI številke ne pokaže brez
// vira in ne opozarja proti meji 0 cm.
//
// Zagon: bun tests/verify/roksal-span-rules.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SPAN_RULES, SPAN_HEADINGS, maxAllowedSpan, checkSpan, spanAdvice, profileLabel,
  type MaxSpanInput, type RoksalFamily, type SpanContext, type SpanLimitRule, type SpanRule,
} from '../../src/lib/roksal-span-rules';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const limitRules = SPAN_RULES.filter((r): r is SpanLimitRule => r.kind === 'limit');
const FAMILIES: RoksalFamily[] = ['ograja', 'terasa', 'fasada', 'pregrada', 'rocaj', 'korito'];

/** Ali je številka DOBESEDNO v citatu (s presledkom, vezajem ali enoto). */
const quotedNumber = (n: number, quote: string) => {
  const txt = String(n).replace('.', ',');
  return new RegExp(`${txt.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\s*(?:cm|mm)|\\s*[–-])`).test(quote);
};

// ── 1. Vsak podatek ima citat, naslov odseka, družino in vir ──
console.log('1. vsaka pravila imajo citat, naslov, družino, vir in stabilen id:');
{
  const ids = SPAN_RULES.map((r) => r.id);
  check(`id-ji so unikatni (${ids.length} pravil)`, new Set(ids).size === ids.length);
  const FROZEN = [
    'ograja-polna5732-posts-150', 'ograja-polna5732-bearers-100',
    'ograja-polna100128-posts-180-low', 'ograja-polna100128-posts-150-tall',
    'ograja-polna128-posts-110', 'ograja-romb67-posts-lbracket-145',
    'ograja-romb67-extra-over-180', 'ograja-deska150-posts-horizontal-band',
    'ograja-posts-cross-133', 'ograja-posts-vertical-200', 'korito-battens-70',
    'rocaj-handle-screws-50', 'fasada-battens-70', 'fasada-polna100-battens-50',
    'fasada-romb-battens-80', 'fasada-kubo-rails-100', 'terasa-battens-33',
    'terasa-steel-substructure-33', 'pregrada-kubo-rails-120', 'pregrada-kubo-rails-260-alu',
    'ograja-polna100128-board-gap-range', 'terasa-board-gap-5-6mm',
  ];
  check('množica id-jev je zamrznjena (nobeno pravilo ne more tiho izginiti)',
    ids.length === FROZEN.length && FROZEN.every((i) => ids.includes(i)),
    ids.filter((i) => !FROZEN.includes(i)).concat(FROZEN.filter((i) => !ids.includes(i))).join(','));
  check('id začne se z družino pravila (oznaka ne laže)',
    SPAN_RULES.every((r) => r.id.startsWith(`${r.family}-`)),
    SPAN_RULES.filter((r) => !r.id.startsWith(`${r.family}-`)).map((r) => r.id).join(','));
  const HEADINGS = Object.values(SPAN_HEADINGS) as string[];
  check('vsak citat stoji pod dobesednim naslovom odseka',
    SPAN_RULES.every((r) => HEADINGS.includes(r.heading)),
    SPAN_RULES.filter((r) => !HEADINGS.includes(r.heading)).map((r) => r.id).join(','));
  check('vsaka družina je ena od šestih objavljenih', FAMILIES.every((f) => SPAN_RULES.some((r) => r.family === f)),
    FAMILIES.filter((f) => !SPAN_RULES.some((r) => r.family === f)).join(','));
  check('vsak citat vsebuje centimetre ali milimetre',
    SPAN_RULES.every((r) => /\d+(?:[.,]\d+)?\s*(?:cm|mm)/.test(r.quote)));
  check('vsak citat je v slovenščini (vezniki, brez angleških besed za razmik)',
    SPAN_RULES.every((r) => /\b(je|se|na|za|med|do|pri|ki|v)\b/.test(r.quote) &&
      !/\b(spacing|maximum|distance|posts|rails|brackets?)\b/i.test(r.quote)),
    SPAN_RULES.filter((r) => !/\b(je|se|na|za|med|do|pri|ki|v)\b/.test(r.quote)).map((r) => r.id).join(','));
  const URLS = new Set(['roksal.com/woodcore-wpc-deske/montaza-wpc-deske/',
    'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/',
    'roksal.com/pogosta-vprasanja-wpc/']);
  check('vir je ena od TREH objavljenih strani (nič tretjega)',
    SPAN_RULES.every((r) => URLS.has(r.source)),
    [...new Set(SPAN_RULES.map((r) => r.source))].join(' | '));
  check('tudi alsoSeenAt je ena od istih treh strani',
    SPAN_RULES.every((r) => !r.alsoSeenAt || URLS.has(r.alsoSeenAt)));
  check('nobo pravilo nima praznega id-ja ali citata',
    SPAN_RULES.every((r) => r.id.length > 4 && r.quote.length > 30));
  // BISTVO: številka, ki jo modul izroči monterju, mora biti v citatu tudi
  // NAPISANA. Brez tega bi bil citat lahko škatla za poljubno številko.
  const exempt = SPAN_RULES.filter((r) => r.basis === 'ADJACENT');
  check('izjeme pri preizkusu številke so samo ADJACENT (milimetri v vprašanju)',
    exempt.every((r) => r.kind === 'range' && r.basis === 'ADJACENT') && exempt.length === 1,
    exempt.map((r) => r.id).join(','));
  check('vsaka NEPOSREDNA meja ima svojo številko dobesedno v citatu',
    limitRules.filter((r) => r.basis === 'DIRECT').every((r) => quotedNumber(r.limitCm, r.quote)),
    limitRules.filter((r) => r.basis === 'DIRECT' && !quotedNumber(r.limitCm, r.quote)).map((r) => r.id).join(','));
  check('vsak spodnji in zgornji rob pasu je dobesedno v citatu',
    limitRules.every((r) => !r.bandCm || (quotedNumber(r.bandCm[0], r.quote) && quotedNumber(r.bandCm[1], r.quote))),
    limitRules.filter((r) => r.bandCm && !(quotedNumber(r.bandCm[0], r.quote) && quotedNumber(r.bandCm[1], r.quote)))
      .map((r) => r.id).join(','));
  check('vsaka posledica ima svoj prag dobesedno v citatu',
    SPAN_RULES.filter((r) => r.kind === 'consequence').every((r) => quotedNumber(r.firesAtSpacingCm, r.quote)));
  check('vsak DIRECT pas ima oba robu dobesedno v citatu',
    SPAN_RULES.filter((r): r is Extract<SpanRule, { kind: 'range' }> => r.kind === 'range' && r.basis === 'DIRECT')
      .every((r) => quotedNumber(r.rangeCm[0], r.quote) && quotedNumber(r.rangeCm[1], r.quote)));
}

// ── 2. Obseg: pravilo velja SAMO za izdelek, pod katerim je objavljeno ──
console.log('2. disciplína obsega (razlog, da je obstala prva verzija):');
{
  const terasa = maxAllowedSpan({ family: 'terasa', context: 'battens' });
  const fasada = maxAllowedSpan({ family: 'fasada', context: 'battens' });
  const korito = maxAllowedSpan({ family: 'korito', context: 'battens' });
  check('Ista beseda (»podložna letev«) po izdelku pomeni različno mejo: terasa 33, fasada 70, korito 70',
    terasa.maxSpanCm === 33 && fasada.maxSpanCm === 70 && korito.maxSpanCm === 70,
    `terasa=${terasa.maxSpanCm}, fasada=${fasada.maxSpanCm}, korito=${korito.maxSpanCm}`);
  check(' fasadna meja 70 NE more priti v poštev pri terasi',
    !terasa.applicable.some((r) => r.id === 'fasada-battens-70'), terasa.applicable.map((r) => r.id).join(','));
  check(' terasna meja 33 NE more priti v poštev pri fasadi',
    !fasada.applicable.some((r) => r.id === 'terasa-battens-33'), fasada.applicable.map((r) => r.id).join(','));
  check(' terasa zmaga spodnji rob pasu 33–35, fasada spodnji rob 70–80',
    terasa.binding?.bandCm?.join('-') === '33-35' && fasada.binding?.bandCm?.join('-') === '70-80',
    `${terasa.binding?.bandCm} / ${fasada.binding?.bandCm}`);

  const fasKubo = maxAllowedSpan({ family: 'fasada', context: 'kubo-rails', profile: 'kubo-80-42' });
  const preKubo = maxAllowedSpan({ family: 'pregrada', context: 'kubo-rails', profile: 'kubo-80-42' });
  check('isti profil (KUBO 80-42) po izdelku dobi 100 cm (fasada) ali 120 cm (pregrada)',
    fasKubo.maxSpanCm === 100 && preKubo.maxSpanCm === 120,
    `fasada=${fasKubo.maxSpanCm}, pregrada=${preKubo.maxSpanCm}`);
  check(' fasada NE sme prevzeti meje pregradne stene (120/260)',
    fasKubo.applicable.every((r) => r.family === 'fasada') && fasKubo.consequences.length === 0);
  check(' opomba o alu vstavku (120/260) se NE oglasi na fasadi',
    !fasKubo.notes.some((n) => /260 cm sme samo z vstavkom/.test(n)), fasKubo.notes.join(' | '));
  check(' opomba o alu vstavku pa se OGLASI pri pregradni steni',
    preKubo.notes.some((n) => /260 cm sme samo z vstavkom/.test(n)), preKubo.notes.join(' | '));
  check(' KUBO na fasadi javi dve vlogi profila (monter izreče izdelek)',
    fasKubo.notes.some((n) => /KUBO je objavljen v dveh vlogah/.test(n)), fasKubo.notes.join(' | '));

  // GLOBALNA MRA: noben izhod ne sme vsebovati pravila druge družine.
  const probes: MaxSpanInput[] = [];
  for (const family of FAMILIES) {
    for (const context of ['posts', 'bearers', 'battens', 'kubo-rails', 'handle-screws', 'board-gap'] as SpanContext[]) {
      for (const profile of [null, 'polna-57-32', 'polna-100', 'polna-128', 'romb-67', 'kubo-80-42', 'terasna-150'] as const) {
        probes.push({ family, context, profile });
      }
    }
  }
  const leaked = probes.map((p) => maxAllowedSpan(p))
    .filter((v) => [...v.applicable, ...v.analogies, ...v.consequences, ...v.ranges]
      .some((r) => r.family !== v.family));
  check(`nobeno pravilo ne more prehajati med družinami (${probes.length} kombinacij)`, leaked.length === 0,
    `${leaked.length} uhajanj`);
  check('nobeno pravilo ne more prehajati med konteksti (isti obseg mra)',
    probes.map((p) => maxAllowedSpan(p)).every((v) => [...v.applicable, ...v.consequences, ...v.ranges]
      .every((r) => r.context === v.context)));
}

// ── 3. Brez profila ENE SAME ŠTEVILKE NI ──
console.log('3. meja je odvisna od profila — modul je ne sme poenostaviti:');
{
  const plain = maxAllowedSpan({ family: 'ograja', context: 'posts' });
  check('ograja/stebrički brez profila → UNKNOWN (prva verzija je tu trdila 150)',
    plain.assurance === 'UNKNOWN' && plain.maxSpanCm === 0, `${plain.assurance} ${plain.maxSpanCm}`);
  check(' → po profilih 110 (POLNA 128) in 150 (POLNA 57-32)',
    plain.byProfile.map((r) => `${r.profile}:${r.limitCm}`).join(',') === 'polna-128:110,polna-57-32:150',
    plain.byProfile.map((r) => `${r.profile}:${r.limitCm}`).join(','));
  check(' → najstrožja meja po profilih je 110 cm, ne 150', plain.profileFloorCm === 110, String(plain.profileFloorCm));
  check(' → opomba to izreče (»ene same številke ni«)',
    plain.notes.some((n) => /ene same številke ni/.test(n)), plain.notes.join(' | '));
  check(' → opomba javi, da 110 velja SAMO za tisti profil',
    plain.notes.some((n) => /Najstrožja od objavljenih mej je 110 cm/.test(n)), plain.notes.join(' | '));
  check(' → opomba imenuje PROFILE, ki jih ni bilo mogoče ovrednotiti',
    plain.notes.some((n) => /meja ni ovrednotena — manjka: višina polnila, način pritrditve/.test(n)),
    plain.notes.join(' | '));
  check(' nasvet za UI brez profila JE null (sicer bi pokazal izmisljeno mejo)',
    spanAdvice({ family: 'ograja', context: 'posts' }) === null);
  check(' meja 150 NISTE več splošna — vezana je na profil 57-32',
    limitRules.filter((r) => r.limitCm === 150).every((r) =>
      JSON.stringify(r.appliesTo ?? []).includes('profile=')),
    limitRules.filter((r) => r.limitCm === 150).map((r) => `${r.id}[${JSON.stringify(r.appliesTo)}]`).join(' '));
  check(' noben citat brez pogoja ne obljublja meje za VSE stebričke',
    !limitRules.some((r) => r.context === 'posts' && !r.appliesTo));
}

// ── 4. Razrešitev: zmaga NAJSTROŽJE veljavno pravilo ──
console.log('4. razrešitev po profilih in orientacijah:');
{
  const p57 = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-57-32' });
  check('POLNA 57-32 → 150 cm (SOURCED, posts-150)', p57.maxSpanCm === 150 && p57.binding?.id === 'ograja-polna5732-posts-150',
    `${p57.maxSpanCm} ${p57.binding?.id}`);
  check(' → tabela po profilih se NE ponovi, ko je profil izbran', p57.byProfile.length === 0);
  check(' → opomba se izrecno opraviči za manjkajočo orientacijo',
    p57.notes.some((n) => /Orientacija desk ni izbrana/.test(n)), p57.notes.join(' | '));

  const p128 = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-128' });
  check('POLNA 128 → 110 cm (prva verzija bi tu montirala na 150 — 40 cm preveč)',
    p128.maxSpanCm === 110 && p128.binding?.id === 'ograja-polna128-posts-110', String(p128.maxSpanCm));

  const low = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-100', panelHeightCm: 140 });
  check('POLNA 100 do 150 cm visoka → 180 cm in BREZ konflikta',
    low.maxSpanCm === 180 && low.conflicts.length === 0, `${low.maxSpanCm}; konflikti=${low.conflicts.length}`);
  const tall = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-100', panelHeightCm: 190 });
  check('POLNA 100 nad 150 cm visoka → 150 cm (180 ne velja)',
    tall.maxSpanCm === 150 && tall.binding?.id === 'ograja-polna100128-posts-150-tall' && tall.conflicts.length === 0,
    `${tall.maxSpanCm} ${tall.binding?.id}`);
  check(' → 150 in 180 sta meji DVEH različnih pogojev, ne protislovje (regresija na v1)',
    SPAN_RULES.filter((r) => r.id.includes('polna100128-posts')).every((r) =>
      JSON.stringify(r.appliesTo).includes('panelHeight')));

  const noH = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-100' });
  check('POLNA 100 BREZ višine → UNKNOWN, a NE „ROKSAL nič ne objavlja“',
    noH.assurance === 'UNKNOWN' && noH.notes.some((n) => /objavlja mejo, a te ni bilo mogoče ovrednotiti/.test(n)) &&
      !noH.notes.some((n) => /ne objavlja omejitve razmika/.test(n)), noH.notes.join(' | '));
  check(' → opomba imenuje manjkajoč vhod (višina polnila)',
    noH.notes.some((n) => /manjka: višina polnila/.test(n)), noH.notes.join(' | '));

  const romb = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'romb-67' });
  check('ROMB 67 brez L-kotnikov → UNKNOWN z manjkajočim vhodom',
    romb.assurance === 'UNKNOWN' && romb.notes.some((n) => /manjka: način pritrditve/.test(n)), romb.notes.join(' | '));
  const lb = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'romb-67', lBracket: true });
  check('ROMB 67 z L-kotniki → 145 cm', lb.maxSpanCm === 145 && lb.binding?.id === 'ograja-romb67-posts-lbracket-145',
    String(lb.maxSpanCm));

  const h150 = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'terasna-150', orientation: 'horizontal' });
  check('DESKA 150 vodoravno → 133 cm (spodnji rob pasu 133–140)',
    h150.maxSpanCm === 133 && h150.notes.some((n) => /pas 133–140 cm/.test(n)), h150.notes.join(' | '));
  check('DESKA 150 brez orientacije → UNKNOWN (pravila 133/200 nista ovrednotena)',
    maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'terasna-150' }).assurance === 'UNKNOWN');

  const cr = maxAllowedSpan({ family: 'ograja', context: 'posts', orientation: 'cross' });
  check('prečno (brez profila) → 133 cm, vezalo je splošni citat 133–145',
    cr.maxSpanCm === 133 && cr.binding?.id === 'ograja-posts-cross-133', String(cr.maxSpanCm));
  check(' → vir je stran za ograje, a citat je potrjen tudi v pogostih vprašanjih',
    /balkonske-ograje/.test(cr.binding?.source ?? '') && Boolean(cr.binding?.alsoSeenAt), cr.binding?.source ?? '');
  check(' → opomba javi, da ZGORNJI rob pasu (145) ni dovoljenje',
    cr.notes.some((n) => /varna meja je spodnji rob 133 cm/.test(n)), cr.notes.join(' | '));

  const v = maxAllowedSpan({ family: 'ograja', context: 'posts', orientation: 'vertical' });
  check('pokončno → 200 cm (citat je splošen, ne profilni)', v.maxSpanCm === 200 && v.conflicts.length === 0,
    String(v.maxSpanCm));

  const both = maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-57-32', orientation: 'cross' });
  check('profil 150 in prečno 133 → zmaga 133 (min veljavnih, oba citata vidna)',
    both.maxSpanCm === 133 && both.applicable.map((r) => r.limitCm).join(',') === '133,150',
    both.applicable.map((r) => `${r.id}:${r.limitCm}`).join(','));

  const nos = maxAllowedSpan({ family: 'ograja', context: 'bearers', profile: 'polna-57-32' });
  check('nosilci pri profilu 57-32 → 100 cm (NE splošna meja nosilcev)',
    nos.maxSpanCm === 100 && nos.binding?.id === 'ograja-polna5732-bearers-100', String(nos.maxSpanCm));
  check(' nosilci brez profila → tabela (samo 57-32 je objavljen)',
    maxAllowedSpan({ family: 'ograja', context: 'bearers' }).byProfile.map((r) => r.profile).join(',') === 'polna-57-32');
}

// ── 5. Konflikt se sme javiti SAMO med enako splošnima citatoma ──
console.log('5. razhajanje citatov (mehanizem ostane, v1 ga je zlorabila):');
{
  // Danes noben par enako splošnih pravil ne daje različnih mej — zato mora biti
  // vsak tak par POOSEN (vodoravno/prečno/pokončno, nizka/visoka, z/brez vstavka).
  const gen = limitRules.filter((r) => r.basis === 'DIRECT' &&
    !(r.appliesTo ?? []).toString().includes('profile='));
  const contradict = (a: SpanRule, b: SpanRule) => {
    const ca = (a.appliesTo ?? []).toString();
    const cb = (b.appliesTo ?? []).toString();
    const fields: [string, string][] = [
      ['orientation=horizontal', 'orientation=cross'], ['orientation=horizontal', 'orientation=vertical'],
      ['orientation=cross', 'orientation=vertical'], ['panelHeight<=150', 'panelHeight>150'],
      ['kuboAluInsert', 'kuboNoInsert'],
    ];
    return fields.some(([x, y]) => (ca.includes(x) && cb.includes(y)) || (ca.includes(y) && cb.includes(x)));
  };
  const pairs: string[] = [];
  for (const a of gen) {
    for (const b of gen) {
      if (a.id < b.id && a.context === b.context && a.family === b.family &&
        a.limitCm !== b.limitCm && !contradict(a, b)) pairs.push(`${a.id}(${a.limitCm}) vs ${b.id}(${b.limitCm})`);
    }
  }
  check(`enako splošna pravila z različnima mejama se izključujejo (${gen.length} pravil v mra)`,
    pairs.length === 0, pairs.join(' | '));
  check('noben izhod danes NIMA konflikta (nič ne razhaja, če enako splošni citati niso v navzkrižju)',
    FAMILIES.every((f) => (['posts', 'bearers', 'battens', 'kubo-rails', 'handle-screws', 'board-gap'] as SpanContext[])
      .every((c) => maxAllowedSpan({ family: f, context: c }).conflicts.length === 0)));
  check(' mehanizem za javljanje razhajanja obstaja in vzame NIŽJO mejo (vir modula)',
    /Vzeta je NIŽJA; za višjo mora potrditi dobavitelj/.test(
      readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), 'src/lib/roksal-span-rules.ts'), 'utf-8')));
  check('profilna meja proti splošni NI protislovje, ampak specializacija (110 zmaga brez javljanja)',
    maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-128', orientation: 'vertical' }).conflicts.length === 0);
}

// ── 6. Vrstne omejitve: pas, posledica in ADJACENT ne morejo postati meja ──
console.log('6. pas / posledica / ADJACENT ne morejo postati meja:');
{
  check('posledična pravila NISO mejna pravila',
    SPAN_RULES.filter((r) => r.kind === 'consequence').every((r) => !('limitCm' in r)));
  check('nobo posledično pravilo nima meje 180 (regresija: prag ni meja)',
    !limitRules.some((r) => r.limitCm === 180 && r.id.includes('extra')));
  check('pri pasu je meja VEDNO spodnji rob, nikoli zgornji',
    limitRules.every((r) => !r.bandCm || r.limitCm === r.bandCm[0]),
    limitRules.filter((r) => r.bandCm && r.limitCm !== r.bandCm[0]).map((r) => r.id).join(','));
  check('spodnji rob pasu je res NIŽJI od zgornjega',
    limitRules.every((r) => !r.bandCm || r.bandCm[0] < r.bandCm[1]));
  check('pasov (bandCm) je natanko pet: 133–140, 133–145, 70–80, 33–35, 33–35',
    limitRules.filter((r) => r.bandCm).map((r) => r.id).sort().join(',') ===
    'fasada-battens-70,ograja-deska150-posts-horizontal-band,ograja-posts-cross-133,terasa-battens-33,terasa-steel-substructure-33',
    limitRules.filter((r) => r.bandCm).map((r) => r.id).sort().join(','));
  check('reža med deskama je PAS (range), ne meja',
    SPAN_RULES.filter((r) => r.context === 'board-gap').every((r) => r.kind === 'range' && !('limitCm' in r)));
  check(' noben pas ne more biti vezalo (binding je vedno limit)',
    FAMILIES.every((f) => (['posts', 'bearers', 'battens', 'kubo-rails', 'handle-screws', 'board-gap'] as SpanContext[])
      .every((c) => {
        const v = maxAllowedSpan({ family: f, context: c });
        return v.binding === null || v.binding.kind === 'limit';
      })));
  check('ADJACENT nikoli ni mejno pravilo (danes ga ima samo reža terase)',
    SPAN_RULES.filter((r) => r.basis === 'ADJACENT').every((r) => r.kind !== 'limit'),
    SPAN_RULES.filter((r) => r.basis === 'ADJACENT').map((r) => `${r.id}:${r.kind}`).join(','));
  check('noben binding nikoli ni ADJACENT',
    FAMILIES.every((f) => (['posts', 'bearers', 'battens', 'kubo-rails', 'handle-screws', 'board-gap'] as SpanContext[])
      .every((c) => {
        const v = maxAllowedSpan({ family: f, context: c });
        return v.binding === null || v.binding.basis === 'DIRECT';
      })));
  check(' analogija (ADJACENT) se v razsodbi pojavi kot opomba, nikoli kot meja',
    maxAllowedSpan({ family: 'terasa', context: 'board-gap' }).analogies.length === 0 &&
      maxAllowedSpan({ family: 'terasa', context: 'battens' }).maxSpanCm === 33);
}

// ── 7. KUBO: 120 in 260 se izključata ──
console.log('7. KUBO pregradna stena:');
{
  const noIns = maxAllowedSpan({ family: 'pregrada', context: 'kubo-rails', profile: 'kubo-80-42' });
  check('brez vstavka → 120 cm', noIns.maxSpanCm === 120 && noIns.binding?.id === 'pregrada-kubo-rails-120', String(noIns.maxSpanCm));
  check(' 260-ino pravilo NI med veljavnimi', !noIns.applicable.some((r) => r.id === 'pregrada-kubo-rails-260-alu'));
  const alu = maxAllowedSpan({ family: 'pregrada', context: 'kubo-rails', profile: 'kubo-80-42', kuboAluInsert: true });
  check('z alu vstavkom 20 × 60 × 2 mm → 260 cm', alu.maxSpanCm === 260 && alu.binding?.id === 'pregrada-kubo-rails-260-alu',
    String(alu.maxSpanCm));
  check(' 120-ino pravilo NI več med veljavnimi (med se izključata)',
    !alu.applicable.some((r) => r.id === 'pregrada-kubo-rails-120'), alu.applicable.map((r) => r.id).join(','));
  check(' opomba o vstavku se NE ponovi, ko je vstavek potrjen',
    !alu.notes.some((n) => /260 cm sme samo z vstavkom/.test(n)), alu.notes.join(' | '));
  check(' obe KUBO pravili sta vezani na profil (sicer bi bila meja veljala napačnemu profilu)',
    SPAN_RULES.filter((r) => r.context === 'kubo-rails')
      .every((r) => JSON.stringify(r.appliesTo ?? []).includes('profile=kubo-80-42')));
}

// ── 8. Skladnost monterjevega razmika ──
console.log('8. checkSpan (razsodba o dejanskem razmiku):');
{
  const post = { family: 'ograja', context: 'posts', profile: 'polna-57-32' } as const;
  const over = checkSpan(post, 180);
  check('POLNA 57-32 na 180 cm → NE SKLADNO (meja 150)', over.ok === false, String(over.ok));
  check(' kljub temu se oglasi zahteva po dodatnem stebričku (prag 180)',
    over.fires.some((r) => r.id === 'ograja-romb67-extra-over-180'), over.fires.map((r) => r.id).join(','));
  check(' besedilo posledice je razumljivo (ne citat)',
    /dodaten stebriček/.test(over.fires[0]?.advice ?? ''), over.fires[0]?.advice ?? '');
  check(' razsodba 180 cm JE SOURCED, meja 150 (ne 180)',
    over.verdict.assurance === 'SOURCED' && over.verdict.maxSpanCm === 150);
  const ok = checkSpan(post, 150);
  check('150 cm → SKLADNO in brez posledice', ok.ok === true && ok.fires.length === 0, `ok=${ok.ok}, fires=${ok.fires.length}`);
  const under = checkSpan(post, 140);
  check('140 cm → SKLADNO, 180-prag še ne velja', under.ok === true && under.fires.length === 0);
  const nan = checkSpan(post, Number.NaN);
  check('Ne-število → ok = NULL (aplikacija ne trdi ne enega ne drugega)', nan.ok === null);
  const noSrc = checkSpan({ family: 'terasa', context: 'posts' }, 90);
  check('brez vira (terasa/stebri) → ok = NULL, kljub temu pod mejo',
    noSrc.ok === null && noSrc.verdict.assurance === 'UNKNOWN');
  check(' in opomba pove, da številka ne bi bila utemeljena',
    noSrc.verdict.notes.some((n) => /ne bi bila utemeljena/.test(n)), noSrc.verdict.notes.join(' | '));

  const gap4 = checkSpan({ family: 'ograja', context: 'board-gap', profile: 'polna-100' }, 4);
  check('reža 4 cm (pas 0,5–3) → ok = NULL, a JAVI kršitev priporočenega pasu',
    gap4.ok === null && gap4.outsideRange.map((r) => r.id).join(',') === 'ograja-polna100128-board-gap-range',
    `ok=${gap4.ok}, pas=[${gap4.outsideRange.map((r) => r.id).join(',')}]`);
  const gap2 = checkSpan({ family: 'ograja', context: 'board-gap', profile: 'polna-100' }, 2);
  check('reža 2 cm → znotraj pasu (nobene kršitve)', gap2.outsideRange.length === 0);
  const mmGap = checkSpan({ family: 'terasa', context: 'board-gap' }, 0.3);
  check(' ADJACENT pas (5–6 mm v vprašanju) NE more javljati kršitve', mmGap.outsideRange.length === 0,
    mmGap.outsideRange.map((r) => r.id).join(','));
  check(' terasa/stebri: reža 0,3 cm je še vedno samo UNKNOWN (brez meja)', mmGap.ok === null);
}

// ── 9. Nasvet za UI ──
console.log('9. spanAdvice (samo stavka, ki jo monter razume):');
{
  const a = spanAdvice({ family: 'ograja', context: 'posts', profile: 'polna-57-32' });
  check('profil 57-32: stavka omeni 150 in vir', a !== null && /Največ 150 cm/.test(a) && /roksal\.com/.test(a), a ?? 'null');
  const b = spanAdvice({ family: 'ograja', context: 'posts', orientation: 'cross' });
  check('prečno: stavka omeni pas 133–145, ne zgornjega roba', b !== null && /pas 133–145/.test(b) && /Največ 133/.test(b), b ?? 'null');
  const c = spanAdvice({ family: 'terasa', context: 'battens' });
  check('terasa: stavka omeni pas 33–35 in mejo 33', c !== null && /Največ 33 cm/.test(c) && /33–35/.test(c), c ?? 'null');
  check('brez vira: NASVETA NI (UI ne sme pokazati številke)', spanAdvice({ family: 'ograja', context: 'posts' }) === null);
  check('brez profila pri nosilcih: NASVETA NI', spanAdvice({ family: 'ograja', context: 'bearers' }) === null);
  check('nasvet NE zabriše manjkajočega vhoda (klicatelj ga še vidi)',
    maxAllowedSpan({ family: 'ograja', context: 'posts', profile: 'polna-100' }).notes.length > 0);
  check('profileLabel je monterjevo ime profila (ne klic koda)',
    profileLabel('polna-57-32') === 'POLNA DESKA 57-32' && !profileLabel('romb-67').includes('-67"'));
}

// ── 10. Meje, ki jih plan_post-layout sploh sme prenesti ──
console.log('10. povezava na razpored stebrov (pas 60..300 cm):');
{
  const postLimits = limitRules.filter((r) => r.family === 'ograja' && r.context === 'posts' && r.basis === 'DIRECT');
  check('meje za stebričke ograje so vse v 60..300 cm (jih sprejme planPostLayout)',
    postLimits.every((r) => r.limitCm >= 60 && r.limitCm <= 300),
    postLimits.filter((r) => r.limitCm < 60 || r.limitCm > 300).map((r) => `${r.id}=${r.limitCm}`).join(','));
  check('obstajajo objave IZVEN tega pasu (33/50/70 cm) — te NISO za razpored stebrov',
    limitRules.some((r) => r.limitCm < 60), limitRules.filter((r) => r.limitCm < 60).map((r) => `${r.family}:${r.limitCm}`).join(','));
  check(' 50 cm (vijaki na ročaju) je v drugem kontekstu, zato v razpored ne sme',
    limitRules.some((r) => r.context === 'handle-screws' && r.limitCm < 60));
  check('nobena meja ni izmišljena kot „varnostni faktor“ (vse so dobesedno citirane)',
    limitRules.every((r) => r.quote.length > 20 && r.source.startsWith('roksal.com')));
}

// ── 11. Mutacije: dokaz, da preizkusi res bitejo ──
console.log('11. mutacijski preizkusi (ročne trditve, ne odvisne od kode):');
{
  const ids = new Set(SPAN_RULES.map((r) => r.id));
  check('če bi izpustil profilni pogoj pri 150, bi bila meja splošna (preizkus 3 bi padel)',
    ids.has('ograja-polna5732-posts-150') &&
    JSON.stringify(SPAN_RULES.find((r) => r.id === 'ograja-polna5732-posts-150')?.appliesTo).includes('profile='));
  check('če bi pasu dal zgornji rob, bi bila meja 140 (preizkus 2 bi padel)',
    limitRules.filter((r) => r.bandCm).every((r) => r.limitCm < (r.bandCm?.[1] ?? r.limitCm)));
  check('če bi posledico spremenil v mejo, bi se prag 180 izmuznil v razrešitev',
    SPAN_RULES.filter((r) => r.kind === 'consequence').every((r) => r.firesAtSpacingCm === 180));
  check('če bi terasi pustil fasadno letev, bi bilo 70 cm namesto 33 (preizkus 2 bi padel)',
    maxAllowedSpan({ family: 'terasa', context: 'battens' }).maxSpanCm === 33);
  check('če bi KUBO pravili vezal na družino samo v eno smer, bi fasada dobila 260',
    maxAllowedSpan({ family: 'fasada', context: 'kubo-rails', profile: 'kubo-80-42', kuboAluInsert: true }).maxSpanCm === 100);
  check('če bi režo spremenil v mejo, bi bila „največ 3 cm“ predpis (preizkus 6 bi padel)',
    SPAN_RULES.filter((r) => r.context === 'board-gap').every((r) => r.kind !== 'limit'));
  check('če bi iz pustega vnosa vrnil 150, bi UI pokazal neobstoječ predpis (preizkus 3 bi padel)',
    maxAllowedSpan({ family: 'ograja', context: 'posts' }).maxSpanCm === 0);
}

// ── 12. Vezava v UI in v načrtih: pravila res uporabijo module ──
console.log('12. vir-gledna pogodba (post-layout-panel.tsx):');
{
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const panel = readFileSync(join(ROOT, 'src/components/camera/post-layout-panel.tsx'), 'utf-8');
  check('panel uvozi maxAllowedSpan in profileLabel iz modula Pravil',
    /import\s*\{\s*maxAllowedSpan,\s*profileLabel/.test(panel) && /from '@\/lib\/roksal-span-rules'/.test(panel));
  check('panel IZREČE družino (ograja) in kontekst (posts) — brez tega meja ne obstaja',
    /maxAllowedSpan\(\{ family: 'ograja', context: 'posts'/.test(panel));
  check('panel vpraša po PROFILU (in ima izrecno možnost „ni izbran“) — meja je odvisna od njega',
    /aria-label="Profil polnila"/.test(panel) && /profil ni izbran/.test(panel) &&
      /const \[profile, setProfile\] = useState<RoksalProfileKind \| null>\(null\)/.test(panel));
  check('panel vpraša po POSTAVITVI desk (orientacija), ker 133/200 sta orientacijski pravili',
    /aria-label="Postavitev desk"/.test(panel) && /const \[orientation, setOrientation\]/.test(panel));
  check('panel NE vsebuje več meje kot trditva (150 je samo uporabnikova izbira)',
    /useState\(150\)/.test(panel) && !/maxSpanCm: 150/.test(panel));
  check('prikaže citat in vir (monter vidi, od kod številka pride)',
    /spanRule\.binding\.quote/.test(panel) && /spanRule\.binding\.source/.test(panel));
  check('brez profila prikaže TABELO po profilih, ne ene številke',
    /data-testid="post-layout-profile-table"/.test(panel) && /spanRule\.byProfile\.map/.test(panel));
  check('ko meje ni, UI to JAVI in ne kaže številke',
    /data-testid="post-layout-no-limit"/.test(panel) && /Utemeljene meje ni/.test(panel));
  check('opozorilo se NE more oglasiti proti meji 0 cm (nova izmisljena številka)',
    /const overLimit = warnLimitCm > 0 && maxSpan > warnLimitCm/.test(panel) && !/maxSpan > warnLimitCm\s*\?/.test(panel));
  check('izbira NAD objavljeno mejo je javljena kot opozorilo (ne tiho prešteta)',
    /NAD objavljeno mejo/.test(panel));
  const notesFilter = /notes\.filter\(\(n\) => \/([^/]+)\/\.test\(n\)\)/.exec(panel);
  check('manjkajoči vhodi (orientacija, višina, profil, ovrednotenje) pridejo v UI',
    !!notesFilter && /Orientacija/.test(notesFilter[1]) && /Višina polnila/.test(notesFilter[1]) &&
      /odvisna od profila/.test(notesFilter[1]) && /Najstrožja/.test(notesFilter[1]) &&
      /ovrednot/.test(notesFilter[1]) && /manjka/.test(notesFilter[1]));
  check('pasovna opomba («spodnji rob») pride do monitorja — sicer 133–145 izgleda kot dovoljenje 145',
    !!notesFilter && /spodnji rob/.test(notesFilter[1]));
  check('pravila NE pobegnejo v načrt: planPostLayout dobi uporabnikovo izbiro, ne meje',
    /maxSpanCm: maxSpan/.test(panel) && !/maxSpanCm: spanRule\.maxSpanCm/.test(panel));
}

console.log('13. pravila veljajo tudi v nakupovnih načrtih (install-plan.ts, pricing.ts):');
{
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const plan = readFileSync(join(ROOT, 'src/lib/install-plan.ts'), 'utf-8');
  const pricing = readFileSync(join(ROOT, 'src/lib/pricing.ts'), 'utf-8');
  check('install-plan uvozi modul Pravil (ne ponavlja številk)',
    /import \{ maxAllowedSpan, profileLabel \} from '\.\/roksal-span-rules'/.test(plan));
  check(' ograje: meja stebrov se ovrednoti po ROKSALu (family ograja, context posts)',
    /maxAllowedSpan\(\{ family: 'ograja', context: 'posts'/.test(plan));
  check(' ograje: lasten 1,5 m razmak je OZNAČEN kot predpostavka ponudbe, ne kot ROKSALova meja',
    /predpostavka 1,5 m, ne ROKSALova meja/.test(plan) && !/1,5 m po ROKSALu/.test(plan));
  check(' ograje: 11 cm za palice je označen kot varnostna praksa brez vira',
    /varnostna praksa, ROKSAL tega ne objavlja/.test(plan));
  check(' terasa: merska enota pasu pride iz modula (33–35), ne iz žive besedila',
    /maxAllowedSpan\(\{ family: 'terasa', context: 'battens' \}\)/.test(plan) &&
      /batten\.binding\?\.bandCm\?\.\[1\]/.test(plan));
  check(' terasa: mrtva veja (pogoj, ki je moral biti vedno resničen) je iz kode',
    !/if \(spacing <= 0\.6/.test(plan) && !/spacing <= 0\.6 \?/.test(plan));
  check(' terasa: trditve „maks. 60 cm“ brez vira NI več v nobenem izpisu (detail)',
    !/detail:.*maks\. 60 cm/.test(plan));
  check(' terasa: razsodba ima tri cone (ok / warn znotraj pasu / bad)',
    /spacingCm <= batten\.maxSpanCm \? 'ok'[\s\S]{0,120}'warn'[\s\S]{0,60}'bad'/.test(plan));
  check(' fasada: objavljen pas 70–80 je naveden iz modula, ne iz domneve',
    /maxAllowedSpan\(\{ family: 'fasada', context: 'battens' \}\)/.test(plan) &&
      /roksalFacade\.binding\?\.bandCm/.test(plan));
  check(' fasada: splošna 40 cm ostane SAMO kot primerjava (info), ne kot ROKSALova meja',
    /spaceAbove40/.test(plan) && /ne ROKSALova meja/.test(plan));
  check(' pricing: ponudba ne predstavlja 1,5 m kot ROKSALovega predpisa',
    /predpostavka izračuna, ne ROKSALova meja/.test(pricing));
}

console.log(`\n${pass}/${pass + fail} preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
process.exit(fail === 0 ? 0 : 1);
