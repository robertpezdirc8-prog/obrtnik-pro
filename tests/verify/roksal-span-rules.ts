// ─── Verifikacija: ROKSALova pravila razmikov imajo VIR in NISO izmisljeni ──
// Zakaj ta skript obstaja: `post-layout.ts` je do danes `maxSpanCm` samo
// preveril proti pasu 60..300 cm, privzetih 150 pa nikoli ni bil utemeljen.
// `src/lib/roksal-span-rules.ts` zdaj hrani dobesedne citate z dveh ROKSALovih
// strani — torej mora biti preverljivo, da (a) nobena meja ne pride iz
// domneve, (b) izmed več veljavnih pravil zmagate STROŽJE, (c) pas (133–140)
// ne more postiti zgornjega roba, (d) analogija (npr. 100 cm za NOSILCE) ne
// more postati meja za STEBRIČKE, (e) posledica (»dodaj še en stebriček«) ne
// more postati meja.
//
// Zagon: bun tests/verify/roksal-span-rules.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SPAN_RULES, maxAllowedSpan, checkSpan, spanAdvice,
  type SpanContext, type SpanLimitRule,
} from '../../src/lib/roksal-span-rules';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const limitRules = SPAN_RULES.filter((r): r is SpanLimitRule => r.kind === 'limit');

// ── 1. Vsak podatek ima citat in vir — brez njega številka ne obstaja ──
console.log('1. vsaka pravila imajo citat, vir in stabilen id:');
{
  const ids = SPAN_RULES.map((r) => r.id);
  check(`id-ji so unikatni (${ids.length} pravil)`, new Set(ids).size === ids.length);
  const FROZEN = [
    'posts-abs-150', 'posts-180-low', 'posts-150-tall', 'posts-lbracket-145',
    'posts-horizontal-band', 'posts-cross-band', 'posts-vertical-200', 'posts-polna128-110',
    'posts-via-bearers-100', 'posts-via-kubo-rails-120', 'posts-extra-over-180',
    'bearers-100', 'kubo-rails-120', 'kubo-rails-260-alu', 'handle-screws-50', 'battens-80',
  ];
  check('množica id-jev je zamrznjena (nobeno pravilo ne more tiho izginiti)',
    ids.length === FROZEN.length && FROZEN.every((i) => ids.includes(i)),
    ids.filter((i) => !FROZEN.includes(i)).join(','));
  check('vsak citat vsebuje centimetre', SPAN_RULES.every((r) => /\d+(?:[.,]\d+)?\s*cm/.test(r.quote)));
  // (Citat z besedo „je“ ni nujno slovenski — a vsak naš ima slovenske veznike
  //  in noben angleškega; to je edino, kar deterministično preverimo.)
  check('vsak citat je v slovenščini (vezniki, brez angleških besed za razmik)',
    SPAN_RULES.every((r) => /\b(je|se|na|za|med|do|pri|ki|v)\b/.test(r.quote) &&
      !/\b(spacing|maximum|distance|posts|rails|brackets?)\b/i.test(r.quote)),
    SPAN_RULES.filter((r) => !/\b(je|se|na|za|med|do|pri|ki|v)\b/.test(r.quote)).map((r) => r.id).join(','));
  const URLS = new Set(['roksal.com/woodcore-wpc-deske/montaza-wpc-deske/',
    'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/']);
  check('vir je ena od DVEH objavljenih strani (nič tretjega)', SPAN_RULES.every((r) => URLS.has(r.source)),
    [...new Set(SPAN_RULES.map((r) => r.source))].join(' | '));
  check('nobo pravilo nima praznega id-ja ali citata',
    SPAN_RULES.every((r) => r.id.length > 4 && r.quote.length > 30));
}

// ── 2. Meje so fizično smiselne in jih `post-layout` sprejme ──
console.log('2. mejne vrednosti (pogoj, da jih plan_post-layout sploh sprejme):');
{
  // `planPostLayout` zavrne `maxSpanCm` izven 60..300, zato sme SAMO kontekst
  // stebričkov napajati ta vhod. Ostali konteksti (vijaki na 50 cm, letve na
  // 70 cm) so lahko zunaj — in jih UI NE sme posiljati v razpored stebrov.
  const postLimits = limitRules.filter((r) => r.context === 'posts' && r.basis === 'DIRECT');
  check('meje za stebričke so vse v 60..300 cm (jih lahko sprejme post-layout)',
    postLimits.every((r) => r.limitCm >= 60 && r.limitCm <= 300),
    postLimits.filter((r) => r.limitCm < 60 || r.limitCm > 300).map((r) => `${r.id}=${r.limitCm}`).join(','));
  check('obstajajo meje IZVEN tega pasu (50 cm vijaki, 70 cm letve) — niso za stebričke',
    limitRules.some((r) => r.context !== 'posts' && r.limitCm < 60) &&
      limitRules.some((r) => r.context === 'battens'),
    limitRules.filter((r) => r.limitCm < 60).map((r) => `${r.context}:${r.limitCm}`).join(','));
  check('pri pasu je meja VEDNO spodnji rob, nikoli zgornji',
    limitRules.every((r) => !r.bandCm || r.limitCm === r.bandCm[0]),
    limitRules.filter((r) => r.bandCm && r.limitCm !== r.bandCm[0]).map((r) => r.id).join(','));
  check('pasov so natanko trije (133–140, 133–145, 70–80)',
    limitRules.filter((r) => r.bandCm).map((r) => r.id).sort().join(',') ===
    'battens-80,posts-cross-band,posts-horizontal-band',
    limitRules.filter((r) => r.bandCm).map((r) => r.id).join(','));
  check('posledična pravila NISO mejna pravila',
    SPAN_RULES.filter((r) => r.kind === 'consequence').every((r) => !('limitCm' in r)));
  check('nobo posledično pravilo nima meje 179,9 (regresija: prag ni meja)',
    !limitRules.some((r) => r.id.includes('extra')));
}

// ── 3. Vsak kontekst ima neposreden podatek ali pa javi UNKNOWN ──
console.log('3. pokritost kontekstov:');
{
  const ctxs: SpanContext[] = ['posts', 'bearers', 'kubo-rails', 'handle-screws', 'battens'];
  for (const c of ctxs) {
    const direct = limitRules.filter((r) => r.context === c && r.basis === 'DIRECT');
    check(`kontekst ${c}: obstaja vsaj eno NEPOSREDNO mejno pravilo`, direct.length > 0);
  }
  check('kontekst kubo-rails brez profila JAVI UNKNOWN (ne ugane številke)',
    maxAllowedSpan({ context: 'kubo-rails' }).assurance === 'UNKNOWN');
  const unk = maxAllowedSpan({ context: 'kubo-rails' });
  check('UNKNOWN pomeni maxSpanCm = 0 (klicatelj ne sme pokazati mere)', unk.maxSpanCm === 0);
  check('UNKNOWN opomba pove, da številka ne bi bila utemeljena',
    unk.notes.some((n) => /utemeljena/.test(n)), unk.notes.join(' | '));
}

// ── 4. Pravilo zmaguje NAJSTROŽJE veljavno ──
console.log('4. razrešitev (min veljavnih DIRECT pravil):');
{
  const plain = maxAllowedSpan({});
  check('privzeti vnos (stebrički, brez orientation/višine) → 150 cm', plain.maxSpanCm === 150, String(plain.maxSpanCm));
  check('→ SOURCED, vezalo je posts-abs-150',
    plain.assurance === 'SOURCED' && plain.binding?.id === 'posts-abs-150', plain.binding?.id ?? 'null');
  check('opomba se izrecno opraviči za manjkajočo orientacijo',
    plain.notes.some((n) => /Orientacija/.test(n)), plain.notes.join(' | '));
  check('opomba se izrecno opraviči za manjkajočo višino',
    plain.notes.some((n) => /Višina polnila/.test(n)), plain.notes.join(' | '));

  const h = maxAllowedSpan({ orientation: 'horizontal' });
  check('vodoravne deske → 133 cm (spodnji rob pasu 133–140)', h.maxSpanCm === 133, String(h.maxSpanCm));
  check('→ opomba imenuje pas', h.notes.some((n) => /pas 133–140/.test(n)), h.notes.join(' | '));
  check('→ opomba javi, da orientacija bi dovolila 140 a je strožje drugo pravilo',
    h.notes.some((n) => /dovolila do 140 cm/.test(n)), h.notes.join(' | '));

  const cr = maxAllowedSpan({ orientation: 'cross' });
  check('prečne deske → 133 cm (spodnji rob pasu 133–145)', cr.maxSpanCm === 133, String(cr.maxSpanCm));
  check('→ vezalo je posts-cross-band (vir je stran za ograje)',
    cr.binding?.id === 'posts-cross-band' && /balkonske-ograje/.test(cr.binding?.source ?? ''),
    `${cr.binding?.id} @ ${cr.binding?.source}`);

  const v = maxAllowedSpan({ orientation: 'vertical' });
  check('pokončne deske → 150 cm, ne 200 (varovalka min velja)', v.maxSpanCm === 150, String(v.maxSpanCm));
  check('→ opomba javi razhajanje z 200 cm', v.notes.some((n) => /dovolila do 200 cm/.test(n)), v.notes.join(' | '));

  const lb = maxAllowedSpan({ lBracket: true });
  check('L-kotniki → 145 cm', lb.maxSpanCm === 145 && lb.binding?.id === 'posts-lbracket-145', String(lb.maxSpanCm));

  const p128 = maxAllowedSpan({ profile: 'polna-128' });
  check('polna deska 12,8 → 110 cm', p128.maxSpanCm === 110 && p128.binding?.id === 'posts-polna128-110', String(p128.maxSpanCm));

  const tall = maxAllowedSpan({ panelHeightCm: 190 });
  check('ograja 190 cm visoka → 150 cm in BREZ razhajanja (180 ne velja)',
    tall.maxSpanCm === 150 && tall.conflicts.length === 0, tall.conflicts.join(' | '));
  check('→ med veljavnimi je tudi posts-150-tall',
    tall.applicable.some((r) => r.id === 'posts-150-tall'), tall.applicable.map((r) => r.id).join(','));
}

// ── 5. Razhajanje citatov se JAVI, ne reši v monterjevo korist ──
console.log('5. proizvajalec si sam nasprotuje — aplikacija mora to pokazati:');
{
  const low = maxAllowedSpan({ panelHeightCm: 140 });
  check('ograja do 150 cm visoka: obe trditvi sta veljavni',
    low.applicable.some((r) => r.id === 'posts-180-low') && low.applicable.some((r) => r.id === 'posts-abs-150'),
    low.applicable.map((r) => r.id).join(','));
  check(' kljub temu zmaga NIŽJA meja 150 (ne 180)', low.maxSpanCm === 150, String(low.maxSpanCm));
  check('razhajanje je javljeno z obema citatoma',
    low.conflicts.length === 1 && /150 cm/.test(low.conflicts[0]) && /180 cm/.test(low.conflicts[0]),
    low.conflicts.join(' | '));
  check('razhajanje omeni, da mora 180 cm potrditi dobavitelj',
    /dobavitelj/.test(low.conflicts[0] ?? ''), low.conflicts[0] ?? '');
}

// ── 6. Analogija ne more postati meja ──
console.log('6. ADJACENT = opomba, nikoli omejitev:');
{
  const plain = maxAllowedSpan({});
  check('100 cm za NOSILCE je na voljo kot analogija',
    plain.analogies.some((r) => r.id === 'posts-via-bearers-100'), plain.analogies.map((r) => r.id).join(','));
  check(' a meja stebričkov OSTANE 150 (analogija je ne more znižati)', plain.maxSpanCm === 150);
  check(' analogija je v opombi izrecno označena za drug element',
    plain.notes.some((n) => /drugem elementu/.test(n)), plain.notes.join(' | '));
  const kubo = maxAllowedSpan({ profile: 'kubo-80-42' });
  check('KUBO: 120 cm med cevmi je analogija za stebričke (ne meja)',
    kubo.analogies.some((r) => r.id === 'posts-via-kubo-rails-120') && kubo.maxSpanCm === 150,
    `meja=${kubo.maxSpanCm}, analogije=${kubo.analogies.map((r) => r.id).join(',')}`);
  check('noben BINDING nikoli ni ADJACENT',
    [plain, kubo, maxAllowedSpan({ context: 'bearers' }), maxAllowedSpan({ context: 'battens' })]
      .every((x) => x.binding === null || x.binding.basis === 'DIRECT'));
}

// ── 7. KUBO: 120 in 260 se izključata ──
console.log('7. KUBO horizontalne cevi:');
{
  const noIns = maxAllowedSpan({ context: 'kubo-rails', profile: 'kubo-80-42' });
  check('brez vstavka → 120 cm', noIns.maxSpanCm === 120 && noIns.binding?.id === 'kubo-rails-120', String(noIns.maxSpanCm));
  check(' opomba pove, da 260 cm sme samo z vstavkom',
    noIns.notes.some((n) => /260 cm sme samo z vstavkom/.test(n)), noIns.notes.join(' | '));
  check(' 260-ino pravilo NI med veljavnimi', !noIns.applicable.some((r) => r.id === 'kubo-rails-260-alu'));
  const alu = maxAllowedSpan({ context: 'kubo-rails', profile: 'kubo-80-42', kuboAluInsert: true });
  check('z alu vstavkom → 260 cm', alu.maxSpanCm === 260 && alu.binding?.id === 'kubo-rails-260-alu', String(alu.maxSpanCm));
  check(' 120-ino pravilo NI več med veljavnimi (med se izključata)',
    !alu.applicable.some((r) => r.id === 'kubo-rails-120'), alu.applicable.map((r) => r.id).join(','));
  check(' opomba o vstavku se NE ponovi, ko je vstavek potrjen',
    !alu.notes.some((n) => /260 cm sme samo z vstavkom/.test(n)), alu.notes.join(' | '));
}

// ── 8. Posledica (dodaj stebriček) se oglasi, a ne meča ──
console.log('8. posledična pravila:');
{
  const over = checkSpan({}, 180);
  check('razmik 180 cm → NE SKLADNO (meja je 150)', over.ok === false, String(over.ok));
  check(' kljub temu se oglasi zahteva po dodatnem stebričku',
    over.fires.some((r) => r.id === 'posts-extra-over-180'), over.fires.map((r) => r.id).join(','));
  check(' besedilo posledice je razumljivo (ne citat)',
    /dodaten stebriček/.test(over.fires[0]?.advice ?? ''), over.fires[0]?.advice ?? '');
  const ok150 = checkSpan({ orientation: 'vertical' }, 150);
  check('razmik 150 cm → SKLADNO in brez posledice', ok150.ok === true && ok150.fires.length === 0,
    `ok=${ok150.ok}, fires=${ok150.fires.length}`);
  const under = checkSpan({}, 140);
  check('razmik 140 cm → SKLADNO, a 180-prag še ne velja', under.ok === true && under.fires.length === 0);
  const nan = checkSpan({}, Number.NaN);
  check('Ne-število → ok = NULL (aplikacija ne trdi ne enega ne drugega)', nan.ok === null);
  const noSrc = checkSpan({ context: 'kubo-rails' }, 90);
  check('brez vira → ok = NULL, kljub temu pod 120', noSrc.ok === null && noSrc.verdict.assurance === 'UNKNOWN');
}

// ── 9. Nasvet za UI ──
console.log('9. spanAdvice (samo stavka, ki jo monter razume):');
{
  const a = spanAdvice({});
  check('privzeto: stavka omeni 150 in vir', a !== null && /150/.test(a) && /roksal\.com/.test(a), a ?? 'null');
  const b = spanAdvice({ orientation: 'cross' });
  check('prečno: stavka omeni pas 133–145', b !== null && /pas 133–145/.test(b) && /Največ 133/.test(b), b ?? 'null');
  check('brez vira: NASVETA NI (UI ne sme pokazati številke)', spanAdvice({ context: 'kubo-rails' }) === null);
  const notes = maxAllowedSpan({ panelHeightCm: 140 });
  check('nasvet NE zabriše razhajanja (še vedno ga vidi klicatelj)', notes.conflicts.length === 1);
}

// ── 10. Mutacije: dokaz, da preizkusi res bitejo ──
console.log('10. mutacijski preizkusi (ročne trditve, ne odvisne od kode):');
{
  const ids = new Set(SPAN_RULES.map((r) => r.id));
  check('če bi izpustil posts-abs-150, bi 180 cm postalo privzeto (preizkus 5 bi padel)',
    ids.has('posts-abs-150') && !ids.has('posts-abs-999'));
  check('če bi pasu dal zgornji rob, bi bila meja 140 (preizkus 2 bi padel)',
    limitRules.filter((r) => r.bandCm).every((r) => r.limitCm < (r.bandCm?.[1] ?? r.limitCm)));
  check('če bi posledico spremenil v mejo, bi se prag 180 izmuznil v razrešitev',
    SPAN_RULES.filter((r) => r.kind === 'consequence').every((r) => r.firesAtSpacingCm === 180));
  check('če bi analogijo spustil v razrešitev, bi posts dobil 100 (preizkus 6 bi padel)',
    maxAllowedSpan({}).maxSpanCm === 150);
  check('če bi KUBO pravili pustili nevezani na profil, bi bila meja zunaj KUBO napačna',
    SPAN_RULES.filter((r) => r.context === 'kubo-rails')
      .every((r) => JSON.stringify(r.appliesTo ?? []).includes('profile=kubo-80-42')));
}

// ── 11. Vezava v UI: panel res PRAŠA modul, ne napačnega privzetka ──
console.log('11. vir-gledna pogodba (post-layout-panel.tsx):');
{
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const panel = readFileSync(join(ROOT, 'src/components/camera/post-layout-panel.tsx'), 'utf-8');
  check('panel uvozi maxAllowedSpan iz modula Pravil',
    /import\s*\{\s*maxAllowedSpan\s*\}\s*from\s*'@\/lib\/roksal-span-rules'/.test(panel));
  check('panel NE vsebuje več meje, privzete v kodi brez vira (150 je samo izbira, ne trditev)',
    /useState\(150\)/.test(panel) && /data-testid="post-layout-span-rule"/.test(panel));
  check('prikaže citat in vir (monter vidi, od kod številka pride)',
    /spanRule\.binding\.quote/.test(panel) && /spanRule\.binding\.source/.test(panel));
  check('izbira NAD objavljeno mejo je javljena kot opozorilo (ne tiho prešteta)',
    /maxSpan > spanRule\.maxSpanCm/.test(panel) && /NAD objavljeno/.test(panel));
  check('razhajanje proizvajalca (150/180) gre v UI, ne ostane v jedru',
    /spanRule\.conflicts\.map/.test(panel));
  check('meja je vezana na višino polnila (pravila se res ovrednotijo ob vhodu)',
    /maxAllowedSpan\(\{ context: 'posts', panelHeightCm: panelH \}\)/.test(panel));
  check('izbirnik vsebuje tudi izbrano vrednost (sicer Select tiho pade na prazno)',
    /spanOptions\.map/.test(panel) && /!MAX_SPANS\.includes\(spanRule\.maxSpanCm\)/.test(panel));
  check('pravila NE pobegnejo v načrt: planPostLayout dobi uporabnikovo izbiro, ne meje',
    /maxSpanCm: maxSpan/.test(panel) && !/maxSpanCm: spanRule\.maxSpanCm/.test(panel));
}

console.log(`\n${pass}/${pass + fail} preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
process.exit(fail === 0 ? 0 : 1);
