// ─── Preverb: VPISANO VIŠINO OGRAJE IZRAČUN VZME DOBESEDNO ─────────────────
// ZAKAJ (Task 84, nadaljevanje Task 83): pri ograjah je cena računala z
// `Math.max(0.9, input.height ?? 1.0)`. Monter je vpisal 0,5 m in na zaslonu
// videl 0,5 m, ponudba pa je tekla pri 0,9 m. Načrt montaže je isto višino
// bral neposredno (`i.height ?? 1`), torej sta bila dva izpista istega vnosa
// lahko različna — cena 0,9, načrt 0,5.
//
// KAJPRIKAŽE:
//  1. useka v koderju ni več (vir se preveri neposredno, ne samo obnašanja);
//  2. znotraj okna se VPISANA višina uporabi dobesedno — v ceni IN v načrtu;
//  3. zunaj okna izračun NE zaračuna ničesar in v razlogu našteje VPISANO
//     vrednost (ne popravljene);
//  4. cena in načrt hodita čez ISTI `resolveCraftInputs('ograje', …)`, zato
//     se ne moreta raziti;
//  5. okno vnosa ima razlog za vsak rob, njegovo ime pa ustreza polju na
//     zaslonu; namig pod poljem nosi ISTE številke kot resolver;
//  6. trditev o zahtevani višini ograje ni več zapisana kot citiran predpis;
//  7. tretji bralec istega vnosa — norma za trajanje montaže — se ustavi
//     skupaj s ponudbo, sicer bi termine načrtoval po meritvi, ki je že
//     zavrnjena; man-ure so zapisane z vejico, kot jih bere monter.
//
// Zagon: bun tests/verify/ograje-input-guard.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateOgraje } from '../../src/lib/pricing';
import { craftInstallPlan } from '../../src/lib/install-plan';
import {
  CRAFT_INPUT_BOUNDS, OGRAJE_INPUT_BOUNDS, craftProblemText, inputWindowHint, resolveCraftInputs,
} from '../../src/lib/craft-inputs';
import { formatNum } from '../../src/lib/format';
import { estimateDuration } from '../../src/lib/labor';
import type { CraftInputs } from '../../src/lib/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

const BASE: CraftInputs = { length: 12, height: 1.1, material: 'alu', gates: 0 };
const zVisino = (h: number): CraftInputs => ({ ...BASE, height: h });
const vsota = (i: CraftInputs) => calculateOgraje(i, 35).lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
const povzetek = (i: CraftInputs) => calculateOgraje(i, 35).summary.map((s) => `${s.label}: ${s.value}`).join(' | ');
const plan = (i: CraftInputs) => craftInstallPlan('ograje', i);
const višinaCheck = (i: CraftInputs) => plan(i).checks.find((c) => c.label === 'Višina ograje');
const zavrnitve = (i: CraftInputs) => plan(i).checks.filter((c) => c.label === 'Izračun ni opravljen');
const opisCene = (i: CraftInputs) => calculateOgraje(i, 35).lines.map((l) => `${l.name} ${l.description ?? ''}`).join(' · ');

// ── 1. Tihi usek je odstranjen iz vira ──────────────────────
{
  console.log('uporabljen vir (usek, ki je samovoljno popravil višino):');
  const pricing = SRC('src/lib/pricing.ts');
  const planSrc = SRC('src/lib/install-plan.ts');
  const a = planSrc.indexOf('function ograjePlan');
  const ograjePlanSrc = planSrc.slice(a, planSrc.indexOf('function stopnicePlan'));
  check('v ceniku ni več `Math.max(0.9, input.height …)`', !pricing.includes('Math.max(0.9, input.height'));
  check('v ceniku dolžine ograje ne useka več `Math.max(0, input.length …)`', !pricing.includes('Math.max(0, input.length'));
  check('v ceniku prehodov ne useka več `Math.max(0, input.gates …)`', !pricing.includes('Math.max(0, input.gates'));
  check('cenik kliče resolver za ograje', pricing.includes("resolveCraftInputs('ograje'"));
  check('načrt kliče ISTI resolver za ograje', ograjePlanSrc.includes("resolveCraftInputs('ograje'"));
  check('načrt ne bere več višine mimo resolverja', !ograjePlanSrc.includes('i.height ?? 1'));
  check('načrt ne useka več dolžine', !ograjePlanSrc.includes('Math.max(0, i.length'));
  check('načrt prehodov ne šteje več iz surovega vnosa', !ograjePlanSrc.includes('i.gates'));
}

// ── 2. Znotraj okna: vpisana številka se uporabi dobesedno ──
{
  console.log('znotraj okna 0,2–4 m (monterja meritev, ne naša meja):');
  for (const h of [0.5, 0.8, 1.1, 2.5]) {
    const comma = String(h).replace('.', ',');
    check(`${h} m: cena našteje VPISANO višino`, opisCene(zVisino(h)).includes(`Višina ${comma} m`), opisCene(zVisino(h)).slice(0, 150));
    check(`${h} m: cena ne omenja več 0,9 m`, !opisCene(zVisino(h)).includes('0,9 m'));
    const detail = višinaCheck(zVisino(h))?.detail ?? '__MISSING__';
    check(`${h} m: načrt našteje ISTO vpisano višino`, detail.includes(comma), detail);
  }
  const prazno = calculateOgraje({ ...BASE, length: 0 }, 35);
  check('0 m ostane PRAZEN izračun, ne zavrnitev', prazno.lines.length === 0 && povzetek({ ...BASE, length: 0 }).includes('Dolžina: 0 m'), povzetek({ ...BASE, length: 0 }));
  const stebri = calculateOgraje(BASE, 35).lines.find((l) => l.name === 'Stebri');
  check('12 m ograje = 9 stebrov (pravilo 1,5 m se ni spremenilo)', stebri?.quantity === 9, String(stebri?.quantity));
  check('razmak 1,5 m je še vedno označen kot PREDPOSTAVKA', (stebri?.description ?? '').includes('predpostavka'), stebri?.description);
  check('montaža se računa iz VPISANE dolžine', povzetek(BASE).includes('Montaža (ocena): 6 h'), povzetek(BASE));
}

// ── 3. Zunaj okna: nič se ne zaračuna, razlog našteje vpisano ─
{
  console.log('zunaj okna:');
  const nizko = calculateOgraje(zVisino(0.1), 35);
  check('0,1 m: nobena postavka ni obračunana', nizko.lines.length === 0, JSON.stringify(nizko.summary));
  check('0,1 m: povzetek našteje VPISANO višino', povzetek(zVisino(0.1)).includes('Višina ograje 0,1 m'), povzetek(zVisino(0.1)));
  check('0,1 m: načrt isto zavrne in ne kupuje materiala', zavrnitve(zVisino(0.1)).length === 1 && plan(zVisino(0.1)).buys.length === 0);
  const text = craftProblemText(resolveCraftInputs('ograje', zVisino(0.1)).problems[0]!);
  check('0,1 m: razlog navede razmerje (0,1 < 0,2)', text.includes('premalo za izračun (0,1 < 0,2)'), text);
  check('0,1 m: razlog uporabi decimalno vejico', /\d,\d/.test(text), text);
  check('0,1 m: razlog pravi, da izračuna ni', text.includes('Izračun ni opravljen — nobena postavka ni obračunana.'), text);
  check('0,1 m: razlog pojasni, kaj okno pomeni (ne izmišlja predpisa)', text.includes('Pod 20 cm vpisano ni ograja'), text);

  check('5 m: zavrnjeno, ne usečeno na 4 m', calculateOgraje(zVisino(5), 35).lines.length === 0 && povzetek(zVisino(5)).includes('Višina ograje 5 m'), povzetek(zVisino(5)));
  check('5 m: dolgi razlog reče PREVEČ in navede rob 4 m', craftProblemText(resolveCraftInputs('ograje', zVisino(5)).problems[0]!).includes('preveč za izračun (5 > 4)'), craftProblemText(resolveCraftInputs('ograje', zVisino(5)).problems[0]!));
  check('−1 m: zavrnjeno (prej bi iz tega postalo 0,9 m)', calculateOgraje(zVisino(-1), 35).lines.length === 0, povzetek(zVisino(-1)));
  check('3000 m: zgornji rob dolžine deluje', calculateOgraje({ ...BASE, length: 3000 }, 35).lines.length === 0, povzetek({ ...BASE, length: 3000 }));
  check('300 prehodov: zavrnjeno z imenom polja', povzetek({ ...BASE, gates: 300 }).includes('Št. oključljivih prehodov'), povzetek({ ...BASE, gates: 300 }));
  check('NaN: zavrnjen kot »vnos ni število«, ne kot 0', povzetek({ ...BASE, height: Number.NaN }).includes('vnos ni število'), povzetek({ ...BASE, height: Number.NaN }));
}

// ── 4. Cena in načrt se ne moreta raziti ────────────────────
{
  console.log('oba izpista istega vnosa:');
  for (const h of [0.1, 0.5, 1.1, 4, 5]) {
    const cena = calculateOgraje(zVisino(h), 35);
    const nacrt = plan(zVisino(h));
    const cenaZavrne = cena.lines.length === 0 && cena.summary[0]?.label === 'Izračun ni opravljen';
    const nacrtZavrne = nacrt.checks.some((c) => c.label === 'Izračun ni opravljen');
    check(`${h} m: oba izpista se odločita ENAKO`, cenaZavrne === nacrtZavrne, `cena=${cenaZavrne} nacrt=${nacrtZavrne}`);
  }
  check('5 m ne zaračuna ničesar (0 €)', vsota(zVisino(5)) === 0, String(vsota(zVisino(5))));
  check('krog nazaj na 1,1 m da POVEČ ISTO vsoto', vsota(zVisino(1.1)) === vsota(BASE) && vsota(BASE) > 0, `${vsota(zVisino(1.1))} vs ${vsota(BASE)}`);
}

// ── 5. Register: imena, enote, razlogi ──────────────────────
{
  console.log('okno vnosa (samo to, kar aplikacija še zna izračunati):');
  check('registrirana trije številčni polji (dolžina, višina, prehodi)', OGRAJE_INPUT_BOUNDS.length === 3, OGRAJE_INPUT_BOUNDS.map((b) => b.field).join(','));
  const crafts = SRC('src/components/calculators/crafts.tsx');
  for (const b of OGRAJE_INPUT_BOUNDS) {
    check(`${b.field}: label ustreza polju na zaslonu`, crafts.includes(`label="${b.label}"`), b.label);
    check(`${b.field}: okno ima utemeljitev in vsaj en rob`, b.why.length > 10 && (b.min !== null || b.max !== null), b.why);
    check(`${b.field}: utemeljitev se začne z malo (je stavek sredi besedila)`, b.why.charAt(0) === b.why.charAt(0).toLowerCase(), b.why);
  }
  check('okno vnosa se NE sklicuje na ROKSAL (to ni inženirski predpis)',
    !OGRAJE_INPUT_BOUNDS.some((b) => /ROKSAL|objavljen/i.test(b.why)), OGRAJE_INPUT_BOUNDS.map((b) => b.why).join(' '));
  check('registiran niz je povezan z dejavnostjo ograje', CRAFT_INPUT_BOUNDS.ograje === OGRAJE_INPUT_BOUNDS);
}

// ── 6. Namig pod poljem nosi ISTE številke ──────────────────
{
  console.log('besedilo, ki ga monter prebere pod poljem:');
  const hint = inputWindowHint('ograje', 'height') ?? '__MISSING__';
  check('namig obstaja', hint !== '__MISSING__' && hint.length > 0, hint);
  check('namig ima spodnji rob enako zapisan kot resolver', hint.includes(formatNum(OGRAJE_INPUT_BOUNDS.find((b) => b.field === 'height')!.min!, 2)), hint);
  check('namig ima zgornji rob enako zapisan kot resolver', hint.includes(formatNum(OGRAJE_INPUT_BOUNDS.find((b) => b.field === 'height')!.max!, 2)), hint);
  check('namig pove, da izračun ni opravljen', hint.includes('izračun ni opravljen'), hint);
  check('namig ustreza robom, ki jih dejansko preverja resolver',
    hint === inputWindowHint('ograje', 'height') && resolveCraftInputs('ograje', zVisino(0.15)).ok === false, hint);
  const crafts = SRC('src/components/calculators/crafts.tsx');
  check('polje Višina ograje nima več DOM meje min={0.9}', !/label="Višina ograje"[^\n]*min=\{0\.9\}/.test(crafts));
  check('polje Višina ograje namig dobi iz registra', crafts.includes("inputWindowHint('ograje', 'height')"));
}

// ── 7. Zahtevana višina ni več izmišljen predpis ────────────
{
  console.log('kako načrt govori o zahtevani višini:');
  check('v načrtu ni več trditve »predpis zahteva ≥ 1,0 m«', !SRC('src/lib/install-plan.ts').includes('predpis zahteva'));
  const nizko = višinaCheck(zVisino(0.5))?.detail ?? '__MISSING__';
  check('pod 0,9 m jasno reče, da zahteve ne more preveriti', nizko.includes('vira ni v aplikaciji'), nizko);
  check('0,5 m je označeno kot bad', višinaCheck(zVisino(0.5))?.status === 'bad', višinaCheck(zVisino(0.5))?.status);
  const ok = višinaCheck(zVisino(1.1))?.detail ?? '__MISSING__';
  check('1,1 m je ok in številko imenuje PRIPOROČILO', višinaCheck(zVisino(1.1))?.status === 'ok' && ok.includes('priporočilo'), ok);
  const sredina = višinaCheck(zVisino(0.95));
  check('0,95 m (med priporočilom in mejo vnosa) je opozorilo, ne napaka', sredina?.status === 'warn', sredina?.status);
  check('0,95 m pošteno reče, da lokalne zahteve ne more preveriti',
    (sredina?.detail ?? '').includes('ne more preveriti') && (sredina?.detail ?? '').includes('0,95'), sredina?.detail);
}

// ── 8. Tretji bralec vnosa: norma za trajanje montaže ───────
{
  console.log('trajanje montaže bere isti vnos in se zaustavi skupaj s ponudbo:');
  const znotraj = estimateDuration('ograje', zVisino(1.1));
  check('znotraj okna norma ostane (12 m × 1,2 = 14,4 man-ur)',
    znotraj !== null && znotraj.summary.includes('14,4'), znotraj?.summary ?? 'null');
  check('man-ure so zapisane Z VEJICO, ne s piko',
    znotraj !== null && !/\d\.\d/.test(znotraj.summary), znotraj?.summary ?? 'null');
  check('5 m: norma se ZAUSTAVI skupaj s ponudbo', estimateDuration('ograje', zVisino(5)) === null,
    estimateDuration('ograje', zVisino(5))?.summary ?? 'null');
  check('3000 m: norma se zaustavi, ker je dolžina zunaj okna',
    estimateDuration('ograje', { ...BASE, length: 3000 }) === null,
    estimateDuration('ograje', { ...BASE, length: 3000 })?.summary ?? 'null');
  check('300 prehodov: norma se zaustavi, čeprav je dolžina veljavna',
    estimateDuration('ograje', { ...BASE, gates: 300 }) === null,
    estimateDuration('ograje', { ...BASE, gates: 300 })?.summary ?? 'null');
  check('prazno polje (0 m) norme ne pokaže', estimateDuration('ograje', { ...BASE, length: 0 }) === null);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
