// ─── Preverb: KODA NE POZNA CENE — CENE IMA OBRTNIK ─────────────────────────
// ZAKAJ (Task 88): aplikacija je doslej pisala denar. V `pricing.ts` in
// `seed.ts` je bilo zapisanih ~50 številk (145 €/m za aluminijasto ograjo,
// 520 €/kos za okno, 28 €/m² za montažo terase, 0,80 €/kos za kljukico,
// `laborRate * 0,85` za polaganje ploščic), napisal pa jih je programer, ne
// človek, ki bo po njih izstavil račun. Platil je tisti, ki jih je izgubil.
//
// Pravilo obrtnika: aplikacija sme izračunati KOLIČINO (metre, m², kose,
// kilograme, ure), nikoli pa cene. Zato ta varuh preveri tri stvari:
//  1. V KODI NI DENARJA — v cenovnem pogonu, privzetih vnosih, katalogu in
//     GBB panelju ni nobene cene, nobene `€` povedi in nobene urne postavke.
//  2. REGISTER JE EDINI VIR — ime, merska enota in ključ vrstice živijo samo
//     v `lib/cenik.ts`; kalkulator jih bere od tam, zato se katalog, Cenik in
//     dokument ne morejo več raziti.
//  3. PARITETA — vsak ključ, ki ga kalkulator LAHKO emitira, ga register
//     pozna, in vsak ključ registra emitira kateri koli kalkulator. Sicer bi
//     obrtnik vpisal ceno za vrstico, ki je nikoli ne dobi, ali pa bi kalkulator
//     izdal vrstico, katere cene nikoli ne more vpisati.
//
// PLUS ena sama pot denarja (`applyCenik`) in pravilo, da vpisane cene ne sme
// nihče tiho popraviti — 0 € je veljavna cena, prazno polje pa NI ničla.
//
// Zagon: bun tests/verify/cenik-guard.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENIK, CENIK_BY_KEY, CENIK_GROUPS, CENIK_KEYS, PRICE_MIN,
  applyCenik, cenikLine, parsePriceInput, priceLabel, priceWindowHint,
  readCenik, unpricedLines,
  type CenikValues, type PriceKey,
} from '../../src/lib/cenik';
import {
  calculateFasada, calculateKeramika, calculateNadstresek, calculateOknaVrata,
  calculateOgraje, calculateStopnice, calculateWpcTerasa,
} from '../../src/lib/pricing';
import type { CalcLine, CraftId, CraftInputs } from '../../src/lib/types';
import { plural } from '../../src/lib/install-plan';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');
/** Samo koda, brez komentarjev. Komentarji namenoma naštejejo BIVŠE cene
 *  (145 €/m, 520 €/kos) kot razlago, zakaj jih ni več — regex bi jih sicer
 *  javil kot lažno vračanje aktivne kode. */
const CODE = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const CRAFT_IDS: CraftId[] =
  ['ograje', 'stopnice', 'keramika', 'wpc-terasa', 'okna-vrata', 'nadstreški', 'fasada'];

// ── 1) V kodi ni denarja ────────────────────────────────────
console.log('1) Kalkulator, privzetki, katalog in GBB panel ne poznajo cene:');
{
  const FILES = [
    'src/lib/pricing.ts',
    'src/lib/defaults.ts',
    'src/lib/seed.ts',
    'src/components/calculators/gbb-panel.tsx',
  ];
  for (const f of FILES) {
    const code = CODE(SRC(f));
    check(`${f}: nobena številčna cena na enoto`, !/unitPrice\s*[:=]\s*-?[0-9]/.test(code));
    check(`${f}: nobena poved o €`, !code.includes('€'));
    check(`${f}: noben cenovni vnos kalkulatorja (brez *PricePer* / *PriceM2*)`,
      !/Price(?:Per|M2|m2|NaEnoto)/.test(code));
  }
  const pricing = CODE(SRC('src/lib/pricing.ts'));
  check('cenovni pogon ne pozna urne postavke', !/laborRate|\brate\b/.test(pricing));
  check('cenovni pogon ne pozna znaka za evre', !/EUR|\bEURO\b/i.test(pricing));
  check('cenovni pogon cene ne zaokrožuje (Math.floor čez ceno)',
    !/Math\.floor\s*\([^)]*(?:price|Rate|unitPrice)/.test(pricing));
  const defaults = CODE(SRC('src/lib/defaults.ts'));
  check('privzetki kalkulatorjev nimajo več cenovnega polja',
    !defaults.includes('tilePricePerM2') && !defaults.includes('boardPricePerM'));
  const seed = CODE(SRC('src/lib/seed.ts'));
  check('seed kataloga ne piše cene v bazo', !/unitPrice/.test(seed));
  check('seed nastavitev ne piše številk (brez @default cen)',
    !/vatRate:\s*[0-9]|laborRate:\s*[0-9]|depositPercent:\s*[0-9]/.test(seed));
  // Vnosni tip kalkulatorja je meritev, ne denar.
  const tipi = SRC('src/lib/types.ts');
  const vnos = tipi.slice(tipi.indexOf('export interface CraftInputs'), tipi.indexOf('}', tipi.indexOf('export interface CraftInputs')));
  check('CraftInputs nima polja za ceno (vnos meri, ne obračunava)', !/[Pp]rice|[Rr]ate/.test(vnos));
}

// ── 2) Register je edini vir imen in enot ───────────────────
console.log('\n2) Register imen, enot in ključev (lib/cenik.ts):');
{
  check('register ima 54 vrstic (merjeno; vsaka nova mora pokazati pariteto v 3. poglavju)',
    CENIK.length === 54, `${CENIK.length}`);
  const duplikati = CENIK_KEYS.filter((k, i) => CENIK_KEYS.indexOf(k) !== i);
  check('noben ključ ni napisan dvakrat', duplikati.length === 0, duplikati.join(', '));
  check('CENIK_BY_KEY pokriva vsak ključ', CENIK_KEYS.every((k) => CENIK_BY_KEY[k]?.key === k));
  check('vsaka vrstica ima naziv, enoto in dejavnost',
    CENIK.every((d) => d.name.trim().length > 2 && d.unit.trim().length > 0 && CRAFT_IDS.includes(d.craft)));
  const imena = CENIK.map((d) => d.name);
  const podvojenaImena = imena.filter((n, i) => imena.indexOf(n) !== i);
  check('noben naziv se ne ponovi (Cenik je berljiv po imenu)', podvojenaImena.length === 0, podvojenaImena.join(', '));
  check('cenovni pogon NE piše lastnih imen vrstic', !/name:\s*['"`]/.test(CODE(SRC('src/lib/pricing.ts'))));

  const vrstica = cenikLine('ograje.alu', 12.5, 'opis');
  check('cenikLine: cena je null, dokler je obrtnik ne vpiše', vrstica.unitPrice === null);
  check('cenikLine: naziv in enota sta vzeta iz registra',
    vrstica.name === CENIK_BY_KEY['ograje.alu'].name && vrstica.unit === CENIK_BY_KEY['ograje.alu'].unit);
  check('cenikLine: ključ je pripet', vrstica.priceKey === 'ograje.alu');
  check('cenikLine: količina gre dobesedno', vrstica.quantity === 12.5);
  check('priceLabel sestavi „Naziv (€/enota)“ iz registra',
    priceLabel('ograje.alu') === `${CENIK_BY_KEY['ograje.alu'].name} (€/${CENIK_BY_KEY['ograje.alu'].unit})`);
  check('okno cene ima samo spodnjo mejo (0 €) — zgornje ne postavljamo',
    PRICE_MIN === 0 && !priceWindowHint().includes('največ'));
  check('namig o oknu obljubi, da brez cene vrstica ni obračunana',
    priceWindowHint().includes('brez cene vrstica na dokumentu ni obračunana'));
}

// ── 3) Pariteta: register ⇄ kalkulator ──────────────────────
console.log('\n3) Pariteta ključev — register in kalkulatorja govorita isti jezik:');
{
  const BASE: CraftInputs = {
    length: 6, height: 1.1, gates: 1,
    steps: 12, stepWidth: 1.1, railingNeeded: true, totalRiseCm: 200,
    floorLength: 4, floorWidth: 3, wallHeight: 2, reservePercent: 10,
    deckLength: 5, deckWidth: 4, joistSpacing: 0.33, boardLengthM: 4, sideGapMm: 5, endGapMm: 4,
    windowCount: 3, windowSize: 2, doorCount: 1, removeOld: true,
    canopyWidth: 5, canopyDepth: 3, canopyPosts: 2, waterDrain: true,
    facadePerimeter: 36, facadeHeight: 2.8, openingsM2: 12,
  };
  // Vse opcije, ki SPLOH vplivajo na to, kateri ključ vrstica nosi.
  const permutations: CalcLine[][] = [];
  for (const material of ['alu', 'steklo', 'inox'] as const) {
    for (const gates of [0, 1]) {
      permutations.push(calculateOgraje({ ...BASE, material, gates }).lines);
      permutations.push(calculateOgraje({ ...BASE, material, gates, height: 2.2 }).lines);
    }
  }
  for (const stepMaterial of ['wpc', 'hrast'] as const)
    for (const railingNeeded of [true, false])
      for (const totalRiseCm of [0, 200])
        permutations.push(calculateStopnice({ ...BASE, steps: 12, stepWidth: 1.1, stepMaterial, railingNeeded, totalRiseCm }).lines);
  for (const tileGrade of ['std', 'format', 'premium'] as const)
    for (const tilePattern of ['ravno', 'diagonalno', 'ribja-kost'] as const)
      for (const wallHeight of [0, 2])
        permutations.push(calculateKeramika({ ...BASE, floorLength: 4, floorWidth: 3, tileGrade, tilePattern, wallHeight }).lines);
  for (const boardGrade of ['klasicna', 'relief', 'jedro'] as const)
    permutations.push(calculateWpcTerasa({ ...BASE, deckLength: 5, deckWidth: 4, boardGrade }).lines);
  for (const windowMaterial of ['pvc', 'alu'] as const)
    for (const removeOld of [true, false])
      permutations.push(calculateOknaVrata({ ...BASE, windowMaterial, removeOld, windowCount: 3, doorCount: 1 }).lines);
  for (const canopyCover of ['ploc', 'polikar', 'steklo'] as const)
    for (const waterDrain of [true, false])
      permutations.push(calculateNadstresek({ ...BASE, canopyCover, waterDrain }).lines);
  for (const cladding of ['wpc', 'les', 'ploc'] as const)
    permutations.push(calculateFasada({ ...BASE, cladding }).lines);

  const emitirani = new Set<PriceKey>();
  let brezKljuca = 0;
  let sCeno = 0;
  for (const lines of permutations) {
    for (const l of lines) {
      if (!l.priceKey) brezKljuca++;
      else emitirani.add(l.priceKey);
      if (l.unitPrice !== null) sCeno++;
    }
  }
  check(`nobena od ${permutations.length} kombinacij ne izpusti vrstice brez ključa`,
    brezKljuca === 0, `${brezKljuca} vrstic`);
  check('nobena kombinacija ne izpusti vrstice, ki bi že imela ceno', sCeno === 0, `${sCeno} vrstic`);

  const neznani = [...emitirani].filter((k) => !CENIK_KEYS.includes(k));
  check('kalkulator ne more emitirati ključa, ki ga register ne pozna',
    neznani.length === 0, neznani.join(', '));
  const siroc = CENIK_KEYS.filter((k) => !emitirani.has(k));
  check('register ne izdaje ključa, ki ga noben kalkulator nikoli ne potrebuje',
    siroc.length === 0, `${siroc.length}: ${siroc.join(', ')}`);
  check(`množici sta enaki (${emitirani.size} = ${CENIK_KEYS.length})`, emitirani.size === CENIK_KEYS.length);

  // Statični del: ključ, napisan v kodi, mora biti registriran.
  const literali = [...CODE(SRC('src/lib/pricing.ts')).matchAll(/cenikLine\(\s*'([^']+)'/g)].map((m) => m[1]);
  check('vsak dobesedni ključ v kodi je registriran',
    literali.length > 0 && literali.every((k) => CENIK_KEYS.includes(k as PriceKey)),
    literali.filter((k) => !CENIK_KEYS.includes(k as PriceKey)).join(', '));
}

// ── 4) Pariteta: register ⇄ katalog ⇄ zaslon Cenik ──────────
console.log('\n4) Katalog in zaslon Cenik brata isti register:');
{
  const seed = SRC('src/lib/seed.ts');
  check('katalog zgradi seznam iz registra (CENIK.filter po dejavnosti)',
    seed.includes('CENIK.filter((d) => d.craft === slug)'));
  check('katalog piše cenovni ključ v `sku` (katalog, Cenik in kalkulator ne morejo več raziti)',
    seed.includes('sku: d.key'));
  check('katalog nima ročno napisanega seznama vrstic poleg registra',
    (seed.match(/sku: '/g) ?? []).length === 0);
  const brezKljuca = (CODE(seed).match(/sku: null/g) ?? []).length;
  check('izdelkov brez cenovnega ključa je natanko 5 (noben kalkulator jih ne zmore)',
    brezKljuca === 5, `${brezKljuca}`);
  check('izdelki brez ključa ne nosijo cene', !/sku: null[^}]*unitPrice/.test(CODE(seed)));

  const pokrite = CENIK_GROUPS.flatMap((g) => g.defs.map((d) => d.key));
  check('CENIK_GROUPS pokrije vsak ključ natanko enkrat',
    pokrite.length === CENIK_KEYS.length && CENIK_KEYS.every((k) => pokrite.filter((x) => x === k).length === 1));
  check('skupine so po dejavnostih (nobena skupina meša dve dejavnosti)',
    CENIK_GROUPS.every((g) => g.defs.every((d) => d.craft === g.craft)));
  check('vsaka dejavnost ima vsaj eno ceno in nobena skupina ni prazna',
    CRAFT_IDS.every((c) => CENIK_GROUPS.find((g) => g.craft === c)?.defs.length));

  const zaslon = CODE(SRC('src/components/cenik-view.tsx'));
  check('zaslon Cenik črpa vrstice iz registra', zaslon.includes('CENIK_GROUPS'));
  check('zaslon Cenik NE piše lastnih nazivov (naziv gre vedno iz registra)',
    !/label={`\s*['"`]/.test(zaslon) && zaslon.includes('d.name'));
  check('cenovna polja so NumField — besedilna, z decimalnim načinom in slovensko vejico',
    zaslon.includes('<NumField') && zaslon.includes('unit="€"') &&
    /type="text"/.test(SRC('src/components/calculators/shared.tsx')) &&
    SRC('src/components/calculators/shared.tsx').includes('inputMode="decimal"'));
}

// ── 5) Ena sama pot denarja ─────────────────────────────────
console.log('\n5) Denar v ponudbo sme priti samo skozi Cenik:');
{
  const values: CenikValues = { 'ograje.alu': 145 };
  const lines = [cenikLine('ograje.alu', 10), cenikLine('ograje.vijaki', 10)];
  const pripeto = applyCenik(lines, readCenik(values));
  check('applyCenik pripne vpisano ceno dobesedno', pripeto[0].unitPrice === 145);
  check('applyCenik manjkajoče cene NE nadomesti z ničlo', pripeto[1].unitPrice === null);
  check('applyCenik ne spremeni količine', pripeto.every((l, i) => l.quantity === lines[i].quantity));
  check('applyCenik ohrani ključ', pripeto[1].priceKey === 'ograje.vijaki');
  check('unpricedLines IMENUJE vrstico brez cene, je ne spregleda',
    unpricedLines(pripeto).length === 1 && unpricedLines(pripeto)[0].name === CENIK_BY_KEY['ograje.vijaki'].name);

  const delnaVsota = pripeto.reduce((s, l) => s + l.quantity * (l.unitPrice ?? Number.NaN), 0);
  check('delno cenjena ponudba nima DELNE vsote (vsota je NaN, ne prirezana)', Number.isNaN(delnaVsota));

  const nices = applyCenik([cenikLine('ograje.alu', 3)], readCenik({ 'ograje.alu': 0 }));
  check('0 € je VELJAVNA vpisana cena in ne manjkajoč podatek',
    nices[0].unitPrice === 0 && unpricedLines(nices).length === 0);
  const podNico = readCenik({ 'ograje.alu': -3 })['ograje.alu'];
  check('cena pod ničlo je zavrnjena z razlogom, ki imenuje vpisano vrednost',
    podNico?.problem === 'cena -3 € je pod ničlo — ponudba ne more izstaviti negativnega zneska',
    podNico?.problem ?? 'manjka');
  check('pod ničlo pomeni BREZ cene, ne prirejene cene',
    applyCenik([cenikLine('ograje.alu', 3)], readCenik({ 'ograje.alu': -3 }))[0].unitPrice === null);
  const prazno = readCenik({})['ograje.alu'];
  check('prazno polje ni ničla, ampak „cena ni vpisana“',
    prazno?.problem === 'cena ni vpisana' && Number.isNaN(prazno.value));

  check('prazno cenovno polje se ne razlomi v 0', Number.isNaN(parsePriceInput('')));
  check('slovenska vejica ostane vejica (12,5 → 12,5)', parsePriceInput('12,5') === 12.5);

  const store = CODE(SRC('src/lib/cenik-store.ts'));
  check('strežnik zavrne neznane ključe, namesto da bi jih tiho spregledal',
    store.includes('isPriceKey') && store.includes('takega izdelka Cenik ne pozna'));
  check('strežnik cene presoji z ISTIM bralecem kot dokumenti', store.includes('readCenik(incoming)'));
  check('strežnik ne useka in ne zaokroži vpisane cene',
    !/Math\.(floor|round|min|max)/.test(store) && !/\?\?\s*0/.test(store));
  check('izbris cene (null) je veljavna odločitev, ne napaka', store.includes('if (raw === null) continue'));

  // Zaslonska meja pri brisanju: prazno polje JE neodločenost, null pa
  // zavestna odločitev. Če se ti dve stvari združita, obrtnik izgubi ceno,
  // ker je pomotoma potegnil čez polje — zato je to preverjeno, ne samo
  // zaželjeno.
  const zaslonBrisi = CODE(SRC('src/components/cenik-view.tsx'));
  check('null za izbris nastane SAMO na gumbu, ne ob praznem vnosu',
    zaslonBrisi.includes('[d.key]: null') && zaslonBrisi.includes('cenik-clear-'));
  check('gumb za izbris je na vrstici, ki ima že SHRAMO cenjeno vrednost',
    /cenik-clear-\$\{d\.key\}/.test(zaslonBrisi) && zaslonBrisi.includes('cenik.priceOf(d.key) !== null'));
  check('na strežnik grejo samo veljavne spremembe (številka ali zavesten izbris)',
    zaslonBrisi.includes('v === null || Number.isFinite(v)') &&
    zaslonBrisi.includes('v !== null && !Number.isFinite(v)'));
  check('označen izbris ostane na zaslonu IMENOVAN, da se ne zdi kot shranjen',
    zaslonBrisi.includes('cenik-pending-delete') && zaslonBrisi.includes('prazno polje'));

  const shranjuj = CODE(SRC('src/app/api/offers/route.ts'));
  check('ponudba zavrne vrstico brez cene, preden jo zapiše',
    shranjuj.includes('i.unitPrice === null'));
  check('ponudba ne more spremeniti prazne cene v 0 (Number(null) === 0 — tu je bil bug)',
    shranjuj.includes('isNum') && !/unitPrice:\s*Number\(/.test(shranjuj));

  const kalkulacija = CODE(SRC('src/components/calculators/shared.tsx'));
  check('kalkulator denar pripne SAMO iz Cenika', kalkulacija.includes('applyCenik(result.lines, cenik.readings)'));
  check('kalkulator dokument zapre, dokler je katera cena prazna',
    kalkulacija.includes('unpricedLines(lines)') && kalkulacija.includes('missing.length === 0'));

  const schema = SRC('prisma/schema.prisma');
  const cenikModel = /model CenikPrice \{([^}]*)\}/.exec(schema)?.[1] ?? '__MANJKA__';
  check('baza hrani ceno kot POLJE (manjkajoča = null, ne 0)', /unitPrice\s+Float\?/.test(cenikModel), cenikModel);
  check('baza nima privzete cene (@default bi pomenil izmišljeno številko)', !/@default/.test(cenikModel));
}

// ── 6) Slovenščina šteje enako kot obrtnik ───────────────────
// Če zaslon pravi »1 vrstic brez cene«, obrtnik ne more verjeti nobeni
// številki na njem. Skladnja ni okras: jeisti števec in ista beseda morata
// dati pravilno obliko, sicer se zdi, da je napisal programer, ne človek.
console.log('6) Številke na zaslonih se sklanjajo pravilno:');
{
  const VRSTICE: [string, string, string, string] = ['vrstica', 'vrstici', 'vrstice', 'vrstic'];
  const CENE: [string, string, string, string] = ['cena vpisana', 'ceni vpisani', 'cene vpisane', 'cen vpisanih'];
  check('1 vrstica, 2 vrstici, 4 vrstice, 5 vrstic',
    plural(1, VRSTICE) === 'vrstica' && plural(2, VRSTICE) === 'vrstici' &&
    plural(4, VRSTICE) === 'vrstice' && plural(5, VRSTICE) === 'vrstic',
    [1, 2, 3, 4, 5, 14, 24].map((n) => `${n} ${plural(n, VRSTICE)}`).join(', '));
  check('dvanajst je »12 vrstic«, dvaindvajset pa »22 vrstic« (desetišice se ne obnašajo kot 2)',
    plural(12, VRSTICE) === 'vrstic' && plural(22, VRSTICE) === 'vrstic');
  check('1 cena vpisana, 4 cene vpisane, 5 cen vpisanih',
    plural(1, CENE) === 'cena vpisana' && plural(4, CENE) === 'cene vpisane' && plural(5, CENE) === 'cen vpisanih');

  // Trdo zapisana množina za interpoliranim števcem = napačen sklep za
  // vsako številko, ki ni 5+. Zato se zasloni denarne poti pregledajo kodeks.
  const ZASLONI = [
    'src/components/cenik-view.tsx',
    'src/components/calculators/shared.tsx',
    'src/components/calculators/gbb-panel.tsx',
    'src/components/camera/camera-view.tsx',
    'src/components/calculators-view.tsx',
  ];
  const TRDO = /\$\{[^}]*\.length\}\s+(?!.*plural)(vrstic|vrstice|vrstici|postavk|postavke|cen|cene)/;
  for (const f of ZASLONI) {
    const code = CODE(SRC(f));
    const zadetek = code.split('\n').find((l) => TRDO.test(l));
    check(`${f}: noben števec nima trdo zapisane množine`, !zadetek, zadetek?.trim().slice(0, 90) ?? '');
  }
  check('potrditev Cenika šteje vpisane in odstranjene cene prek plural',
    CODE(SRC('src/components/cenik-view.tsx')).includes('plural(vpisane, VPISANO)') &&
    CODE(SRC('src/components/cenik-view.tsx')).includes('plural(izbrisane, ODSTRANJENO)'));
  check('kalkulatorjeva zavrnitev šteje vrstice prek plural',
    (CODE(SRC('src/components/calculators/shared.tsx')).match(/plural\(missing\.length, VRSTICE\)/g) ?? []).length === 2,
    `${(CODE(SRC('src/components/calculators/shared.tsx')).match(/plural\(missing\.length, VRSTICE\)/g) ?? []).length} zadetkov`);
  check('kamera (zbiranje projekta) šteje vrstice prek plural',
    CODE(SRC('src/components/camera/camera-view.tsx')).includes('plural(projectUnpriced.length, VRSTICE)'));
}

console.log(`\n${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
