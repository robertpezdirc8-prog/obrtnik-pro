// ─── Preverb: VPISANO ŠTEVILKO SME IZRAČUN VZETI DOBESEDNO ─────────────────
// ZAKAJ (Task 83): kalkulator WPC terase je vpisani razmak nosilcev TIHO
// usekal — `Math.min(0.6, Math.max(0.3, razmak))`. Na zaslonu je pisalo 8 m,
// ponudba je tekla pri 0,6 m. Enako je bilo s ceno deske (`Math.max(1, …)`),
// nabavno dolžino in obema dilatacijama. Monter ne more opaziti napake, ki
// samodejno popravi njegova meritve; opazi šele predrago ali premalo debelo
// podkonstrukcijo.
//
// KAJPRIKAŽE:
//  1. useka v koderju ni več (vir se preveri neposredno, ne samo obnašanja);
//  2. znotraj okna vnosa se VPISANA vrednost uporabi točno — št. nosilcev se
//     mora menjati z 0,5 m, 1,2 m in 2,5 m, kot se ne bi mogel, če usek drži;
//  3. zunaj okna izračun NE zaračuna ničesar in v razlogu našteje VPISANO
//     vrednost (ne popravljene);
//  4. cena in načrt montaže se odločita ENAKO — oba uporabnika hodita čez isti
//     `resolveTerasaInputs`, razhajanje je torej strukturno nemogoče;
//  5. ROKSALov pas (33–35 cm) OCENUJE veljavne vnose (ok/warn/bad), jih pa ne
//     spreminja — 1,2 m je izračunan in označen kot preširok;
//  6. okno vnosa ima utemeljitev za vsak rob in ima čiste slovenske oznake,
//     kot jih monter vidi na zaslonu;
//  7. predlog razmaka iz fotke izhaja iz ROKSALovega pravila, ne iz kode.
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
import type { CraftInputs } from '../../src/lib/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

const BASE: CraftInputs = { deckLength: 5, deckWidth: 4, joistSpacing: 0.33, boardLengthM: 4, sideGapMm: 5, endGapMm: 4, boardPricePerM: 12.5 };
const withSpacing = (s: number): CraftInputs => ({ ...BASE, joistSpacing: s });
const nosilci = (i: CraftInputs) => calculateWpcTerasa(i, 35).lines.find((l) => l.name.startsWith('Nosilci'));
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
    calculateWpcTerasa({ ...BASE, sideGapMm: 12 }, 35).summary.some((s) => s.value.includes('str. 12 mm')));
  const deska8 = calculateWpcTerasa({ ...BASE, boardLengthM: 8 }, 35).lines[0]?.description ?? '';
  check('nabavna deska 8 m se uporabi, ne useka na 6 m', deska8.includes('po 8 m'), deska8);
  check('cena 0 €/m ostane 0 (dvig na 1 € mrtev)',
    calculateWpcTerasa({ ...BASE, boardPricePerM: 0 }, 35).lines[0]?.unitPrice === 0);
}

// ── 3. Zunaj okna se ne zaračuna ničesar ────────────────────
{
  console.log('zunaj okna: nič ni obračunano, razlog nosi VPISANO vrednost:');
  const r = calculateWpcTerasa(withSpacing(8), 35);
  check('8 m → nobena postavka (lines prazen)', r.lines.length === 0, `lines=${r.lines.length}`);
  check('8 m → povzetek pravi »Izračun ni opravljen«', r.summary[0]?.label === 'Izračun ni opravljen', JSON.stringify(r.summary));
  check('razlog našteje vpisanih 8 m, ne popravljenih 0,6 m', r.summary[0]?.value.includes('8 m') === true, r.summary[0]?.value);
  check('8 m → načrt montaže prav tako brez nakupa',
    stopChecks(withSpacing(8)).length > 0 && craftInstallPlan('wpc-terasa', withSpacing(8)).buys.length === 0);
  const neg = calculateWpcTerasa({ ...BASE, boardPricePerM: -3 }, 35);
  check('negativna cena je zavrnjena in imenovana',
    neg.lines.length === 0 && neg.summary[0]?.value.includes('Cena deske') === true, JSON.stringify(neg.summary));
  check('prazna meritev (0 m) ni napaka, ampak še-ne-vneseno stanje',
    calculateWpcTerasa({ ...BASE, deckLength: 0 }, 35).summary[0]?.value === '0 m²');
  check('znotraj okna meja ni preslikana: 3 m je veljaven vnos', resolveTerasaInputs(withSpacing(3)).ok === true);
  check('3,01 m pa ni več', resolveTerasaInputs(withSpacing(3.01)).ok === false);
}

// ── 4. Cena in načrt se odločita enako ──────────────────────
{
  console.log('oba uporabnika hodita čez isto okno:');
  const cases: CraftInputs[] = [
    BASE, withSpacing(0.35), withSpacing(0.4), withSpacing(1.2), withSpacing(8), withSpacing(0.01),
    { ...BASE, sideGapMm: 80 }, { ...BASE, endGapMm: 0 }, { ...BASE, boardLengthM: 0.2 },
    { ...BASE, boardPricePerM: -1 }, { ...BASE, deckWidth: 400 },
  ];
  for (const c of cases) {
    const price = calculateWpcTerasa(c, 35);
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
    battenCheck(withSpacing(1.2))?.status === 'bad' && calculateWpcTerasa(withSpacing(1.2), 35).lines.length > 0);
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
  check('okno pokriva vseh sedem vnosov terase', TERASA_INPUT_BOUNDS.length === 7, String(TERASA_INPUT_BOUNDS.length));
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
  check('cena nima zgornje meje, zato je omenjen samo spodnji rob',
    terasaProblemText(resolveTerasaInputs({ ...BASE, boardPricePerM: -3 }).problems[0]!)
      .includes('Cena deske −3 €/m je premalo za izračun (−3 < 0); sprejemamo najmanj 0 €/m') === true,
    terasaProblemText(resolveTerasaInputs({ ...BASE, boardPricePerM: -3 }).problems[0]!));
  // Razlog `why` je v registru zapisan z malo, ker je stavek sredi besedila. Ko
  // pride ZA PIKO, mora začeti z veliko — v pridobljenem posnetku je monter
  // bral »… sprejemamo najmanj 0 €/m. cena je tvoja pogodba z dobaviteljem.«
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

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
