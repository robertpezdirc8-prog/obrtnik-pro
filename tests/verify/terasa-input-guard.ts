// ─── Preverb: VPISANO ŠTEVILKO SME IZRAČUN VZETI DOBESEDNO ─────────────────
// ZAKAJ (Task 83): kalkulator WPC terase je vpisani razmak nosilcev TIHO
// usekal — `Math.min(0.6, Math.max(0.3, razmak))`. Na zaslonu je pisalo 8 m,
// ponudba je tekla pri 0,6 m. Enako je bilo s ceno deske (`Math.max(1, …)`),
// nabavno dolžino in obema dilatacijama. Monter ne more opaziti napake, ki
// samodejno popravi njegova meritve; opazi šele predrago ali premalo debelo
// podkonstrukcijo.
//
// ZAKAJ (Task 88): ista bolezen je bila v denarju. Kalkulator je imenoval ceno
// deske (`boardPricePerM: 12.5`), montažo pa je računal iz urne postavke. Zdaj
// kalkulator NE pozna nobene cene: vrstica je KOLIČINA + ključ do Cenika, denar
// pa pripne `applyCenik` iz tistega, kar je monter sam vpisal.
//
// KAJPRIKAŽE:
//  1. useka v koderju ni več (vir se preveri neposredno, ne samo obnašanja);
//  2. znotraj okna se VPISANA vrednost uporabi točno — št. nosilcev se
//     mora menjati z 0,5 m, 1,2 m in 2,5 m, kot se ne bi mogel, če usek drži;
//  3. zunaj okna izračun NE zaračuna ničesar in v razlogu našteje VPISANO
//     vrednost (ne popravljene);
//  4. cena in načrt montaže se odločita ENAKO — oba uporabnika hodita čez isti
//     `resolveTerasaInputs`, razhajanje je torej strukturno nemogoče;
//  5. ROKSALov pas (33–35 cm) OCENUJE veljavne vnose (ok/warn/bad), jih pa ne
//     spreminja — 1,2 m je izračunan in označen kot preširok;
//  6. okno vnosa ima utemeljitev za vsak rob in ima čiste slovenske oznake,
//     kot jih monter vidi na zaslonu;
//  7. predlog razmaka iz fotke izhaja iz ROKSALovega pravila, ne iz kode;
//  8. DENAR: kalkulator da same količine, ceno pripne Cenik DOBESEDNO; 0 € je
//     veljavna cena, manjkajoča ali negativna pa ostane brez cene in ukine
//     CELOTNO vsoto (delnega seštevka ni).
//
// Zagon: bun tests/verify/terasa-input-guard.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateWpcTerasa } from '../../src/lib/pricing';
import { craftInstallPlan, plural } from '../../src/lib/install-plan';
import {
  TERASA_INPUT_BOUNDS, resolveTerasaInputs, terasaProblemText,
} from '../../src/lib/terasa-inputs';
import { CRAFT_INPUT_DEFAULTS } from '../../src/lib/defaults';
import { maxAllowedSpan } from '../../src/lib/roksal-span-rules';
import { JOIST_SUGGEST_M } from '../../src/lib/deck-analysis';
import {
  CENIK_KEYS, applyCenik, readCenik, unpricedLines, priceLabel, priceWindowHint,
  type CenikValues, type PriceKey,
} from '../../src/lib/cenik';
import { fixtureCenik, zCenikom, cenaVrslice, vsota as cenikVsota } from './cenik-fixture';
import type { CalcLine } from '../../src/lib/types';
import type { CraftInputs } from '../../src/lib/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

const BASE: CraftInputs = { deckLength: 5, deckWidth: 4, joistSpacing: 0.33, boardLengthM: 4, sideGapMm: 5, endGapMm: 4 };
const withSpacing = (s: number): CraftInputs => ({ ...BASE, joistSpacing: s });
const goli = (i: CraftInputs = BASE): CalcLine[] => calculateWpcTerasa(i).lines;
const nosilci = (i: CraftInputs) => goli(i).find((l) => l.priceKey === 'terasa.nosilci');
const battenCheck = (i: CraftInputs) =>
  craftInstallPlan('wpc-terasa', i).checks.find((c) => c.label === 'Razmak nosilcev');
const stopChecks = (i: CraftInputs) =>
  craftInstallPlan('wpc-terasa', i).checks.filter((c) => c.label === 'Izračun ni opravljen');

// ── 1. Tihi usek je odstranjen iz vira ──────────────────────
{
  console.log('uporabljen vir (usek, ki je samovoljno popravil vnos):');
  const pricing = SRC('src/lib/pricing.ts');
  const plan = SRC('src/lib/install-plan.ts');
  check('v ceniku ni več `Math.min(0.6,` za razmak', !/Math\.min\(0\.6, Math\.max\(0\.3/.test(pricing));
  check('v načrtu montaže ni več `Math.min(0.6,` za razmak', !/Math\.min\(0\.6, Math\.max\(0\.3/.test(plan));
  check('cena deske se ne useka navzgor (Math.max(1, …) mrtev)', !/Math\.max\(1, input\.boardPricePerM/.test(pricing));
  check('noben izračun terase ne uporablja pogojnega predloga 0,3 / 0,4', !/\? 0\.3 : 0\.4/.test(pricing + plan + SRC('src/lib/deck-analysis.ts')));
  // Task 88: kalkulator cene sploh nima več od kod dobiti.
  check('v pricing.ts ne obstaja več boardPricePerM', !pricing.includes('boardPricePerM'));
  check('v types.ts obrtnik ne vpisuje cene v kalkulator', !SRC('src/lib/types.ts').includes('boardPricePerM'));
  check('urna postavka ni več parameter cenjenja terase', !/laborRate/.test(pricing.slice(pricing.indexOf('calculateWpcTerasa'))));
}

// ── 2. Znotraj okna se vpisano vzame dobesedno ──────────────
{
  console.log('vpisana vrednost = izračunana vrednost:');
  // 5 m / spacing + 1 = število nosilcev; usek na 0,6 bi stalno enačil 8 m in 0,6 m
  check('0,50 m → 11 nosilcev × 4 m = 44 lm', nosilci(withSpacing(0.5))?.quantity === 44, String(nosilci(withSpacing(0.5))?.quantity));
  check('1,20 m → 6 nosilcev × 4 m = 24 lm (stari usek bi dal 0,6 m → 40 lm)',
    nosilci(withSpacing(1.2))?.quantity === 24, String(nosilci(withSpacing(1.2))?.quantity));
  check('2,50 m → 3 nosilci × 4 m = 12 lm', nosilci(withSpacing(2.5))?.quantity === 12, String(nosilci(withSpacing(2.5))?.quantity));
  check('vsak razmak da drugčen odmerek (noben drug drugega ne posnema)',
    new Set([0.33, 0.5, 1.2, 2.5].map((s) => nosilci(withSpacing(s))?.quantity)).size === 4);
  check('opis vrstice nosilcev izpiše VPISANI razmak v cm',
    nosilci(withSpacing(1.2))?.description === 'Razmak 120 cm', String(nosilci(withSpacing(1.2))?.description));
  // dilatacija in nabavna dolžina sta bili usekani enako
  check('stranska reža 12 mm se uporabi, ne useka na 10 mm',
    calculateWpcTerasa({ ...BASE, sideGapMm: 12 }).summary.some((s) => s.value.includes('str. 12 mm')));
  const deska8 = goli({ ...BASE, boardLengthM: 8 })[0]?.description ?? '';
  check('nabavna deska 8 m se uporabi, ne useka na 6 m', deska8.includes('po 8 m'), deska8);
}

// ── 3. Zunaj okna se ne zaračuna ničesar ────────────────────
{
  console.log('zunaj okna: nič ni obračunano, razlog nosi VPISANO vrednost:');
  const r = calculateWpcTerasa(withSpacing(8));
  check('8 m → nobena postavka (lines prazen)', r.lines.length === 0, `lines=${r.lines.length}`);
  check('8 m → povzetek pravi »Izračun ni opravljen«', r.summary[0]?.label === 'Izračun ni opravljen', JSON.stringify(r.summary));
  check('razlog našteje vpisanih 8 m, ne popravljenih 0,6 m', r.summary[0]?.value.includes('8 m') === true, r.summary[0]?.value);
  check('8 m → načrt montaže prav tako brez nakupa',
    stopChecks(withSpacing(8)).length > 0 && craftInstallPlan('wpc-terasa', withSpacing(8)).buys.length === 0);
  check('prazna meritev (0 m) ni napaka, ampak še-ne-vneseno stanje',
    calculateWpcTerasa({ ...BASE, deckLength: 0 }).summary[0]?.value === '0 m²');
  check('znotraj okna meja ni preslikana: 3 m je veljaven vnos', resolveTerasaInputs(withSpacing(3)).ok === true);
  check('3,01 m pa ni več', resolveTerasaInputs(withSpacing(3.01)).ok === false);
}

// ── 4. Cena in načrt se odločita enako ──────────────────────
{
  console.log('oba uporabnika hodita čez isto okno:');
  const cases: CraftInputs[] = [
    BASE, withSpacing(0.35), withSpacing(0.4), withSpacing(1.2), withSpacing(8), withSpacing(0.01),
    { ...BASE, sideGapMm: 80 }, { ...BASE, endGapMm: 0 }, { ...BASE, boardLengthM: 0.2 },
    { ...BASE, deckWidth: 400 },
  ];
  for (const c of cases) {
    const price = calculateWpcTerasa(c);
    const plan = craftInstallPlan('wpc-terasa', c);
    const rejected = price.lines.length === 0 && price.summary[0]?.label === 'Izračun ni opravljen';
    const stopped = plan.checks.some((k) => k.label === 'Izračun ni opravljen' && k.status === 'bad');
    check(`vnos ${JSON.stringify(c)}: oba zaustavljena ali oba računana`, rejected === stopped, `price=${rejected} plan=${stopped}`);
    if (rejected) {
      const problems = resolveTerasaInputs(c).problems;
      check(`  ↳ načrt ponovi ISTO besedilo kot razlog (${problems.length} problemov)`,
        problems.length === plan.checks.filter((k) => k.label === 'Izračun ni opravljen').length
        && plan.checks.filter((k) => k.label === 'Izračun ni opravljen').every((k) =>
          problems.some((p) => terasaProblemText(p) === k.detail)));
    }
  }
}

// ── 5. ROKSALov pas oceni, ne spremeni ──────────────────────
{
  console.log('objavljeni pas 33–35 cm odloča o oceni, ne o računu:');
  const batten = maxAllowedSpan({ family: 'terasa', context: 'battens' });
  check('ROKSAL za teraso objavlja spodnji rob 33 cm', batten.maxSpanCm === 33, String(batten.maxSpanCm));
  check('33 cm → ok', battenCheck(withSpacing(0.33))?.status === 'ok', battenCheck(withSpacing(0.33))?.status);
  check('35 cm → warn (znotraj pasu, čez varno mejo)', battenCheck(withSpacing(0.35))?.status === 'warn', battenCheck(withSpacing(0.35))?.status);
  check('40 cm → bad', battenCheck(withSpacing(0.4))?.status === 'bad', battenCheck(withSpacing(0.4))?.status);
  check('120 cm → bad IN vendar izračunan',
    battenCheck(withSpacing(1.2))?.status === 'bad' && calculateWpcTerasa(withSpacing(1.2)).lines.length > 0);
  check('ocena našteje vir in citat', /roksal\.com/.test(battenCheck(withSpacing(1.2))?.detail ?? '')
    && battenCheck(withSpacing(1.2))?.detail.includes('33') === true);
  check('dilatacija 0 mm je označena kot preozka (brez tihega dviga na 2 mm)',
    battenCheck({ ...BASE, sideGapMm: 0 }) !== undefined
    && craftInstallPlan('wpc-terasa', { ...BASE, sideGapMm: 0 }).checks.some((k) => k.label === 'Stranska dilatacija' && k.status === 'bad'));
}

// ── 6. Okno je utemeljeno in govori z imeni zaslona ─────────
{
  console.log('vsak rob okna ima razlog, vsako polje ima ime zaslona:');
  const crafts = SRC('src/components/calculators/crafts.tsx');
  // Task 88: cena deske iz okna je izpadla — ostane šest meritev. Cene ne
  // uporablja več kalkulator, zato je tudi ni več treba varovati z oknom.
  check('okno pokriva vseh šest meritev terase', TERASA_INPUT_BOUNDS.length === 6, String(TERASA_INPUT_BOUNDS.length));
  check('okno ne vsebuje več cenovnega polja', !TERASA_INPUT_BOUNDS.some((b) => /cena/i.test(b.label)));
  for (const b of TERASA_INPUT_BOUNDS) {
    check(`${b.field}: razlog za rob (${b.why.slice(0, 32)}…)`, b.why.length >= 20 && (b.min !== null || b.max !== null));
    check(`${b.field}: ime polja je točno tako, kot ga vidi monter`, crafts.includes(`label="${b.label}"`));
  }
  check('okno je označeno kot meja VNOSA, ne kot predpis',
    SRC('src/lib/terasa-inputs.ts').includes('To NI inženirski predpis'));
}

// ── 7. Predlog iz fotke izhaja iz pravila ───────────────────
{
  console.log('predlog razmaka: izpeljan, ne vklesan:');
  check('JOIST_SUGGEST_M = spodnji rob objavljenega pasu',
    JOIST_SUGGEST_M === maxAllowedSpan({ family: 'terasa', context: 'battens' }).maxSpanCm / 100, String(JOIST_SUGGEST_M));
  check('to je 0,33 m', JOIST_SUGGEST_M === 0.33, String(JOIST_SUGGEST_M));
  check('privzeta vrednost kalkulatora = predlog iz pravila (en vir)',
    CRAFT_INPUT_DEFAULTS.joistSpacing === JOIST_SUGGEST_M, String(CRAFT_INPUT_DEFAULTS.joistSpacing));
  check('privzetek kalkulatora NE pade čez ROKSALovo mejo',
    battenCheck({ ...BASE, joistSpacing: CRAFT_INPUT_DEFAULTS.joistSpacing ?? 0.33 })?.status === 'ok');
  {
    const panel = SRC('src/components/camera/deck-panel.tsx');
    // Zgodovinski omenki v komentarju so dovoljene (razlagajo, kaj je bilo
    // narobe); prepovedana je številka, ki jo monter VIDI ali izbere.
    check('v panelu ni več gumba »Ravno · nosilci 0,40 m«', !/nosilci 0,40 m/.test(panel));
    check('v panelu ni več gumba »Diagonalno · nosilci 0,30 m«', !/nosilci 0,30 m/.test(panel));
    check('v panelu ne obstaja več izbira po smeri (`? 0.3 : 0.4`)', !/\?\s*0\.3\s*:\s*0\.4/.test(panel));
    check('povzetek iz fotke svoj predlog veže na ROKSALovo objavo',
      /ROKSALov spodnji rob objavljenega pasu/.test(panel));
  }
}

// ── 8. Besedilo za uporabnika ───────────────────────────────
{
  console.log('besedilo, ki ga monter prebere:');
  const p = resolveTerasaInputs(withSpacing(8)).problems[0];
  const text = terasaProblemText(p);
  check('uporabi decimalno vejico (0,05–3 m)', text.includes('0,05–3'), text);
  check('pove, da izračun ni opravljen', text.includes('Izračun ni opravljen'));
  check('obseže utemeljitev roba', text.includes('ne zna več pretvoriti v število nosilcev'));
  // Razlog `why` je v registru zapisan z malo, ker je stavek sredi besedila. Ko
  // pride ZA PIKO, mora začeti z veliko — v pridobljenem posnetku je monter
  // bral »… razmak zunaj 5 cm–3 m aplikacija ne zna …«.
  for (const b of TERASA_INPUT_BOUNDS) {
    const out = b.min !== null ? (b.min ?? 0) - 1 : (b.max ?? 0) + 1;
    const t = terasaProblemText(resolveTerasaInputs({ ...BASE, [b.field]: out }).problems.find((x) => x.bound.field === b.field)!);
    const cap = b.why.charAt(0).toUpperCase() + b.why.slice(1);
    check(`${b.field}: razlog za piko se začne z veliko`, t.includes(`. ${cap}.`), t);
  }
  // Števec opozoril v kartici »Material & montaža«: »1 opozoril« je bil viden na
  // zaslonu. Slovenija ima dvojino, monter pa je prav tam, kjer šteje napake.
  const OP: [string, string, string, string] = ['opozorilo', 'opozorili', 'opozorila', 'opozoril'];
  check('1 = opozorilo (ne »1 opozoril«)', plural(1, OP) === 'opozorilo', plural(1, OP));
  check('2 = opozorili (dvojina)', plural(2, OP) === 'opozorili', plural(2, OP));
  check('4 = opozorila', plural(4, OP) === 'opozorila', plural(4, OP));
  check('5 = opozoril', plural(5, OP) === 'opozoril', plural(5, OP));
  check('kartica materiala USENI sklanja števec opozoril',
    SRC('src/components/calculators/material-panel.tsx')
      .includes("{plural(warns, ['opozorilo', 'opozorili', 'opozorila', 'opozoril'])}"));
}

// ── 9. DENAR: kalkulator da količino, ceno vpiše monter ─────
//       (Task 88 — »ne cene ne piši, uporabnik mora sam«)
{
  console.log('\n── denar: koda pozna količino, ceno pozna monter ──');
  const L = goli();
  check('kalkulator vrne KOLIČINE brez cene (vsaka vrstica unitPrice null)',
    L.length > 0 && L.every((l) => l.unitPrice === null));
  check('vsaka vrstica nosi registriran ključ',
    L.every((l) => typeof l.priceKey === 'string' && CENIK_KEYS.includes(l.priceKey as PriceKey)));
  const KLJUCI: PriceKey[] = [
    'terasa.deska-klasicna', 'terasa.nosilci', 'terasa.kljukice',
    'terasa.profil', 'terasa.vijaki', 'montaza.terasa',
  ];
  check('nabor ključev terase je točno teh šest',
    L.length === KLJUCI.length && KLJUCI.every((k) => L.some((l) => l.priceKey === k)),
    L.map((l) => l.priceKey).join(', '));
  check('cenik pripne ceno po LASTNEM ključu (tuje cene ni)',
    zCenikom(L).every((l) => l.unitPrice === CENIK_KEYS.indexOf(l.priceKey as PriceKey) + 1));
  check('brez cenika denarja ni — vsota je NaN, ne 0',
    Number.isNaN(cenikVsota(L)) && applyCenik(L, {}).every((l) => l.unitPrice === null));
  check('fixture cenik je res pestri (nobena cena se ne ponovi)',
    new Set(Object.values(fixtureCenik())).size === CENIK_KEYS.length);

  console.log('vpisana cena = cena na dokumentu:');
  const rocno: CenikValues = {
    'terasa.deska-klasicna': 18.75, 'terasa.nosilci': 9.4, 'terasa.kljukice': 0.32,
    'terasa.profil': 4.1, 'terasa.vijaki': 0.18, 'montaza.terasa': 30,
  };
  const za = zCenikom(L, rocno);
  check('deska 18,75 €/m ostane 18,75 (brez zaokroževanja in brez dviga)',
    cenaVrslice(za, 'terasa.deska-klasicna') === 18.75, String(cenaVrslice(za, 'terasa.deska-klasicna')));
  check('montaža 30 €/m² ostane 30', cenaVrslice(za, 'montaza.terasa') === 30);
  check('nobena vrstica ni brez cene', unpricedLines(za).length === 0);

  console.log('0 € je podatek, ne prazno polje:');
  const zNicjo = zCenikom(L, { ...rocno, 'terasa.deska-klasicna': 0 });
  check('vpisanih 0 € koda ne vzame za manjkajočo ceno',
    cenaVrslice(zNicjo, 'terasa.deska-klasicna') === 0 && unpricedLines(zNicjo).length === 0);
  check('0 € zniža vsoto in je ne uniči',
    Number.isFinite(cenikVsota(zNicjo)) && cenikVsota(zNicjo) < cenikVsota(za),
    String(cenikVsota(zNicjo)));
  const reading = readCenik({ 'terasa.deska-klasicna': 0 })['terasa.deska-klasicna'];
  check('readCenik za 0 € ne vrne problema', reading?.problem === null, JSON.stringify(reading));

  console.log('manjkajoča ali negativna cena ukine CELOTNO vsoto:');
  const brez = Object.fromEntries(
    Object.entries(rocno).filter(([k]) => k !== 'montaza.terasa'),
  ) as CenikValues;
  const del = zCenikom(L, brez);
  check('brez cene montaže vrstica ostane brez cene (ničle ni)',
    cenaVrslice(del, 'montaza.terasa') === null);
  check('manjkajoča vrstica je IMENOVANA, ne spregledana',
    unpricedLines(del).some((l) => l.name === 'Montaža terase'),
    unpricedLines(del).map((l) => l.name).join(', '));
  check('ena sama manjkajoča cena ukine CELATEN seštevek (delnega ni)',
    Number.isNaN(cenikVsota(del)));
  const neg = zCenikom(L, { ...rocno, 'terasa.deska-klasicna': -3 });
  check('negativna cena ne dobi ničle, ampak ostane brez cene',
    cenaVrslice(neg, 'terasa.deska-klasicna') === null && Number.isNaN(cenikVsota(neg)));
  const negReading = readCenik({ 'terasa.deska-klasicna': -3 })['terasa.deska-klasicna'];
  check('razlog našteje VPISANO vrednost (−3)', /-3|−3/.test(negReading?.problem ?? ''), negReading?.problem ?? '');
  check('okno cen govori o spodnjem robu 0 €', priceWindowHint().includes('0 €') && priceWindowHint().includes('ni obračunana'));
  check('oznaka vrstice pride iz registra, ne iz kalkulatorja',
    priceLabel('terasa.deska-klasicna') === 'Terasna deska WPC — klasična (polna 25×140) (€/m)',
    priceLabel('terasa.deska-klasicna'));

  console.log('odtenek deske menja KLJUČ, ne cene:');
  const relief = goli({ ...BASE, boardGrade: 'relief' })[0];
  const jedro = goli({ ...BASE, boardGrade: 'jedro' })[0];
  check('3D relief piše na svoj ključ', relief?.priceKey === 'terasa.deska-relief', String(relief?.priceKey));
  check('polno jedro piše na svoj ključ', jedro?.priceKey === 'terasa.deska-jedro', String(jedro?.priceKey));
  check('izbor odtenka ne spremeni količine (cena ne vpliva na račun)',
    relief?.quantity === L[0]?.quantity && jedro?.quantity === L[0]?.quantity,
    `${String(relief?.quantity)} / ${String(jedro?.quantity)} / ${String(L[0]?.quantity)}`);
  check('cena reliefa je vpisana LOČENO od klasične',
    cenaVrslice(zCenikom(goli({ ...BASE, boardGrade: 'relief' }), { 'terasa.deska-relief': 21 }), 'terasa.deska-relief') === 21
    && cenaVrslice(zCenikom(goli({ ...BASE, boardGrade: 'relief' }), { 'terasa.deska-klasicna': 18.75 }), 'terasa.deska-relief') === null);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
