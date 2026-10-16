// ─── Preverb: VPISANI VREDNOSTI NE SME NIČE TIHO POPRAVITI (5 dejavnosti) ──
// ZAKAJ (Task 85, nadaljevanje Task 83/84): usek `Math.max(rob, vnos)` je živel
// v vseh kalkulatorjih, ne samo v ograjah. Cena je računala `Math.max(0.6,
// širina)` (stopnice), `Math.max(1, cena)` in `Math.min(30, rezerva)` (keramika),
// `Math.max(0.5, velikost)` (okna), `Math.max(2, št. stebrov)` (nadstrešek) in
// `Math.max(0, bruto − odprtine)` (fasada). Načrt montaže je isti vnos bral
// DOBESEDNO, norma za trajanje pa tretjič. Monter je torej pri 0,4 m na načrtu
// videl 0,4 m, ponudba pa je zaračunala 0,6 m — dva odgovora na isto vprašanje.
//
// KAJPRIKAŽE:
//  1. useka v viru ni več (cene, načrta in norme);
//  2. vsak rob vsakega registriranega polja zavrne pri vseh treh bralcih
//     hkrati in v razlogu našteje VPISANO vrednost;
//  3. znotraj okna se vpisana številka uporabi dobesedno — v ceni IN v načrtu;
//  4. izmišljenih številk ni več: udobje stopnic se ne ocenjuje več proti G, ki
//     ga je kalkulator sam prislil, fasada pa našteje neto namesto tihe useka;
//  5. register: ime polja ustreza naslovu na zaslonu, namig pod poljem nosi
//     ISTE številke kot resolver, utemeljitev roba ne izmišlja predpisa;
//  6. vse, kar monter prebere, je zapisano z decimalno VEJICO.
//
// Zagon: bun tests/verify/craft-inputs-all.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateFasada, calculateKeramika, calculateNadstresek, calculateOknaVrata, calculateStopnice,
} from '../../src/lib/pricing';
import { craftInstallPlan } from '../../src/lib/install-plan';
import { estimateDuration } from '../../src/lib/labor';
import { formatNum } from '../../src/lib/format';
import {
  FASADA_INPUT_BOUNDS, KERAMIKA_INPUT_BOUNDS, NADSTRESEK_INPUT_BOUNDS, OKNA_INPUT_BOUNDS,
  STOPNICE_INPUT_BOUNDS, CRAFT_INPUT_BOUNDS, craftProblemText, fasadaOpeningProblem,
  inputWindowHint, resolveCraftInputs, type InputBound,
} from '../../src/lib/craft-inputs';
import type { CalcResult, CraftId, CraftInputs } from '../../src/lib/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');
const r2 = (n: number) => Math.round(n * 100) / 100;
/** To, kar monter dejansko vidi: decimalna vejica, integer brez odsekov. */
const beseda = (n: number) => formatNum(Math.abs(n), 2);

interface Craft {
  id: CraftId;
  bounds: readonly InputBound[];
  base: CraftInputs;
  price: (i: CraftInputs) => CalcResult;
}

const CRAFTS: Craft[] = [
  {
    id: 'stopnice', bounds: STOPNICE_INPUT_BOUNDS, price: (i) => calculateStopnice(i, 35),
    base: { steps: 12, stepWidth: 1.1, totalRiseCm: 0, stepMaterial: 'wpc', railingNeeded: true },
  },
  {
    id: 'keramika', bounds: KERAMIKA_INPUT_BOUNDS, price: (i) => calculateKeramika(i, 35),
    base: { floorLength: 4, floorWidth: 3, wallHeight: 0, tilePricePerM2: 24, reservePercent: 10, tilePattern: 'ravno' },
  },
  {
    id: 'okna-vrata', bounds: OKNA_INPUT_BOUNDS, price: (i) => calculateOknaVrata(i, 35),
    base: { windowCount: 3, windowSize: 2, doorCount: 1, windowMaterial: 'pvc', removeOld: true },
  },
  {
    id: 'nadstreški', bounds: NADSTRESEK_INPUT_BOUNDS, price: (i) => calculateNadstresek(i, 35),
    base: { canopyWidth: 5, canopyDepth: 3, canopyPosts: 2, canopyCover: 'ploc', waterDrain: true },
  },
  {
    id: 'fasada', bounds: FASADA_INPUT_BOUNDS, price: (i) => calculateFasada(i, 35),
    base: { facadePerimeter: 36, facadeHeight: 2.8, openingsM2: 12, cladding: 'wpc' },
  },
];

const sPoljem = (base: CraftInputs, field: string, v: number): CraftInputs =>
  ({ ...base, [field]: v }) as CraftInputs;
const cena = (c: Craft, i: CraftInputs) => c.price(i);
const cenaBesedilo = (c: Craft, i: CraftInputs) => {
  const r = cena(c, i);
  return [...r.lines.map((l) => `${l.name} ${l.description ?? ''}`), ...r.summary.map((s) => `${s.label}: ${s.value}`)].join(' · ');
};
const cenaZavrne = (c: Craft, i: CraftInputs) => {
  const r = cena(c, i);
  return r.lines.length === 0 && r.summary[0]?.label === 'Izračun ni opravljen';
};
const nacin = (c: Craft, i: CraftInputs) => craftInstallPlan(c.id, i);
const nacrtBesedilo = (c: Craft, i: CraftInputs) => {
  const p = nacin(c, i);
  return [...p.buys.map((b) => `${b.label} ${b.detail}`), ...p.cuts.map((k) => `${k.title} ${k.summary}`), ...p.checks.map((k) => `${k.label} ${k.detail}`)].join(' · ');
};
const nacrtZavrne = (c: Craft, i: CraftInputs) => nacin(c, i).checks.some((k) => k.label === 'Izračun ni opravljen');
const norma = (c: Craft, i: CraftInputs) => estimateDuration(c.id, i);
const vsota = (c: Craft, i: CraftInputs) => cena(c, i).lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
const preverba = (c: Craft, i: CraftInputs, label: string) => nacin(c, i).checks.find((k) => k.label === label);

// ── 1. Vir: tihi usek je iz treh bralcev izginil ────────────
{
  console.log('uporabljen vir (noben bralec vnesene mere ne sme popraviti):');
  const pricing = SRC('src/lib/pricing.ts');
  const planSrc = SRC('src/lib/install-plan.ts');
  const laborSrc = SRC('src/lib/labor.ts');
  const stariUseki = [
    'Math.max(0.6, input.stepWidth', 'Math.max(1, input.tilePrice', 'Math.min(30, input',
    'Math.max(0.5, input.windowSize', 'Math.max(2, input.canopyPosts', 'Math.max(0, gross',
    'Math.max(0, inputs.', 'Math.max(0, i.floorLength', 'Math.max(0, i.canopyWidth',
    'Math.max(0, i.steps', 'Math.max(0, i.openingsM2',
  ];
  for (const u of stariUseki) {
    check(`v ceni/načrtu/normi ni več useka ${u}`, !pricing.includes(u) && !planSrc.includes(u) && !laborSrc.includes(u), u);
  }
  for (const c of CRAFTS) {
    check(`cenik kliče resolver za ${c.id}`, pricing.includes(`resolveCraftInputs('${c.id}',`));
    check(`načrt kliče resolver za ${c.id}`, planSrc.includes(`resolveCraftInputs('${c.id}',`));
    check(`norma kliče resolver za ${c.id}`, laborSrc.includes(`resolveCraftInputs('${c.id}',`));
  }
  check('norma bere tudi teraso prek njenega lastnega resolverja', laborSrc.includes('resolveTerasaInputs(inputs)'));
  check('norma nima več ročno zaokroženega razmerja za vrata (1,67)', !laborSrc.includes('1.67'));
  check('norma ima razmerje zapisano kot 2,5 / 1,5', laborSrc.includes('(2.5 / 1.5) * inp.v.doorCount'));
}

// ── 2. Register: imena, razlogi, namigi ─────────────────────
{
  console.log('register vnosnih oken (ime polja = naslov na zaslonu):');
  const ui = SRC('src/components/calculators/crafts.tsx');
  for (const c of CRAFTS) {
    check(`${c.id}: niz meja je povezan z dejavnostjo`, CRAFT_INPUT_BOUNDS[c.id] === c.bounds);
    for (const b of c.bounds) {
      check(`${c.id}/${b.field}: label ustreza polju na zaslonu`, ui.includes(`label="${b.label}"`), b.label);
      check(`${c.id}/${b.field}: okno ima utemeljitev in vsaj en rob`, b.why.length > 10 && (b.min !== null || b.max !== null), b.why);
      check(`${c.id}/${b.field}: utemeljitev se začne z malo`, b.why.charAt(0) === b.why.charAt(0).toLowerCase(), b.why);
      check(`${c.id}/${b.field}: utemeljitev ne izmišlja predpisa ali ROKSALove meje`, !/ROKSAL|objavljen|predpis/i.test(b.why), b.why);
      const hint = inputWindowHint(c.id, b.field) ?? '__MANJKA__';
      check(`${c.id}/${b.field}: namig obstaja`, hint !== '__MANJKA__');
      check(`${c.id}/${b.field}: namig nosi spodnji rob registra`, b.min === null || hint.includes(beseda(b.min)), hint);
      check(`${c.id}/${b.field}: namig nosi zgornji rob registra`, b.max === null || hint.includes(beseda(b.max)), hint);
      check(`${c.id}/${b.field}: polje na zaslonu namig dobi iz registra`,
        ui.includes(`inputWindowHint('${c.id}', '${b.field}')`) || ui.includes(`inputWindowHintWith('${c.id}', '${b.field}'`), b.field);
    }
  }
  check('polje Širina stopnic nima več DOM meje min={0.6}', !/label="Širina stopnic"[^\n]*min=\{0\.6\}/.test(ui));
  check('polje Št. stebrov nima več DOM meje min={0}', !/label="Št. stebrov"[^\n]*min=\{0\}/.test(ui));
  check('pod poljem višinske razlike ni več obljube o preverjanju udobja', !ui.includes('preveri udobje'));
  check('pri nadstrešku se ne govori več o »zaboj« (pravi izraz je odvodni žleb)',
    !ui.includes('Zaboj +') && !SRC('src/lib/install-plan.ts').includes("'zaboj +"));
}

// ── 3. Zunaj okna: vsak rob zavrne pri vseh treh bralcih ────
for (const c of CRAFTS) {
  console.log(`${c.id}: zunaj okna (cena = načrt = norma):`);
  for (const b of c.bounds) {
    const robovi: [string, number][] = [];
    if (b.min !== null) robovi.push(['min', b.min === 0 ? -1 : r2(b.min - 0.01)]);
    if (b.max !== null) robovi.push(['max', r2(b.max + 0.01)]);
    for (const [stran, v] of robovi) {
      const i = sPoljem(c.base, b.field, v);
      const me = `${b.label} ${beseda(v)} (${stran})`;
      check(`${me}: cena NE zaračuna ničesar`, cena(c, i).lines.length === 0, cenaBesedilo(c, i).slice(0, 120));
      check(`${me}: povzetek našteje VPISANO vrednost`, cenaBesedilo(c, i).includes(beseda(v)), cenaBesedilo(c, i).slice(0, 120));
      check(`${me}: načrt zavrne ENAKO kot cena`, nacrtZavrne(c, i) === cenaZavrne(c, i));
      check(`${me}: zavrnjen načrt ne kupuje materiala`, !nacrtZavrne(c, i) || nacin(c, i).buys.length === 0);
      check(`${me}: norma se ustavi skupaj s ponudbo`, !cenaZavrne(c, i) || norma(c, i) === null);
      const problem = resolveCraftInputs(c.id, i).problems[0];
      const dolgi = problem ? craftProblemText(problem) : '__MANJKA__';
      check(`${me}: dolgi razlog našteje okno in reče, da izračuna ni`,
        dolgi.includes('sprejemamo') && dolgi.includes('Izračun ni opravljen'), dolgi.slice(0, 140));
      check(`${me}: dolgi razlog je zapisan z vejico, ne s piko`, !/\d\.\d/.test(dolgi), dolgi.slice(0, 80));
    }
  }
}

// ── 4. Znotraj okna: vpisana številka se uporabi dobesedno ──
{
  console.log('znotraj okna — zgodovinski primeri, kjer je bila mera menjana:');
  const stopnice = CRAFTS[0];
  const ozko = sPoljem(stopnice.base, 'stepWidth', 0.45);
  check('0,45 m širine: cena našteje VPISANO 0,45', cenaBesedilo(stopnice, ozko).includes('Širina 0,45 m'), cenaBesedilo(stopnice, ozko).slice(0, 120));
  check('0,45 m širine: cena ne omenja več 0,6 m', !cenaBesedilo(stopnice, ozko).includes('0,6 m'));
  check('0,45 m širine: načrt našteje ISTO vpisano širino',
    (preverba(stopnice, ozko, 'Širina stopnic')?.detail ?? '').includes('0,45'), preverba(stopnice, ozko, 'Širina stopnic')?.detail);
  check('0,45 m širine: deske se režejo na VPISANO širino',
    nacrtBesedilo(stopnice, ozko).includes('12 × 0,45 m'), nacrtBesedilo(stopnice, ozko).slice(0, 160));

  const keramika = CRAFTS[1];
  const velikaRezerva = sPoljem(keramika.base, 'reservePercent', 50);
  check('50 % rezerve: cena NE useka na 30 %', cenaBesedilo(keramika, velikaRezerva).includes('rezerva 50 %'), cenaBesedilo(keramika, velikaRezerva).slice(0, 140));
  const kolicinaPloscic = keramika.price(velikaRezerva).lines.find((l) => l.name === 'Keramične ploščice')?.quantity ?? -1;
  check('50 % rezerve: 12 m² prostora → 18 m² ploščic', kolicinaPloscic === 18, String(kolicinaPloscic));
  check('50 % rezerve: načrt računa PO ISTEM',
    nacrtBesedilo(keramika, velikaRezerva).includes('z rezervo 50 %'), nacrtBesedilo(keramika, velikaRezerva).slice(0, 140));
  check('0 €/m² je VELJAVEN vnos (material je plačan drugje)', keramika.price(sPoljem(keramika.base, 'tilePricePerM2', 0)).lines.length > 0);
  check('101 % rezerve je zunaj okna', cenaZavrne(keramika, sPoljem(keramika.base, 'reservePercent', 101)));

  const okna = CRAFTS[2];
  const majhno = sPoljem(okna.base, 'windowSize', 0.2);
  check('0,2 m²: cena našteje VPISANO velikost (ne 0,5 m²)', cenaBesedilo(okna, majhno).includes('velikost 0,2 m²'), cenaBesedilo(okna, majhno).slice(0, 140));
  check('0,2 m²: povzetek da 3 × 0,2 = 0,6 m²', cenaBesedilo(okna, majhno).includes('Okna: 3 kosov (0,6 m²)'), cenaBesedilo(okna, majhno).slice(0, 140));
  const samoVrata = sPoljem(sPoljem(okna.base, 'windowCount', 0), 'doorCount', 2);
  check('naročilo samo z vrati (0 oken) je veljavno', okna.price(samoVrata).lines.length > 0 && !cenaZavrne(okna, samoVrata));
  const prazno = sPoljem(sPoljem(okna.base, 'windowCount', 0), 'doorCount', 0);
  check('prazno naročilo (0 oken, 0 vrat) ostane prazno, ne zavrnjeno',
    okna.price(prazno).lines.length === 0 && !cenaZavrne(okna, prazno), cenaBesedilo(okna, prazno));

  const nadstresek = CRAFTS[3];
  const brezStebrov = sPoljem(nadstresek.base, 'canopyPosts', 0);
  check('0 stebrov je VELJAVNA izvedba, ne usečena na 2',
    nadstresek.price(brezStebrov).lines.length > 0 && !cenaZavrne(nadstresek, brezStebrov));
  check('0 stebrov: povzetek našteje »Stebri: 0 kosov«',
    cenaBesedilo(nadstresek, brezStebrov).includes('Stebri: 0 kosov'), cenaBesedilo(nadstresek, brezStebrov).slice(0, 140));
  check('0 stebrov: postavka za stebre ima količino 0',
    nadstresek.price(brezStebrov).lines.find((l) => l.name === 'Stebri (jeklo 80×80)')?.quantity === 0);
  check('0 stebrov: načrt reče sidranje na zid, ne »0 m — preširoko«',
    (preverba(nadstresek, brezStebrov, 'Razmak stebrov')?.detail ?? '').includes('sidrana na zid'),
    preverba(nadstresek, brezStebrov, 'Razmak stebrov')?.detail);
  const enSter = sPoljem(nadstresek.base, 'canopyPosts', 1);
  check('1 steber: načrt opozori, namesto da bi tiho dodal drugega',
    preverba(nadstresek, enSter, 'Razmak stebrov')?.status === 'warn'
    && (preverba(nadstresek, enSter, 'Razmak stebrov')?.detail ?? '').includes('1 steber'),
    preverba(nadstresek, enSter, 'Razmak stebrov')?.detail);
  const fronta = sPoljem(nadstresek.base, 'canopyWidth', 7.5);
  check('7,5 m fronte: cena in načrt oba naštejeta 7,5',
    cenaBesedilo(nadstresek, fronta).includes('7,5') && nacrtBesedilo(nadstresek, fronta).includes('7,5'));

  const fasada = CRAFTS[4];
  const visoka = sPoljem(fasada.base, 'facadeHeight', 2.35);
  check('2,35 m višine: bruto 84,6 m² je iz VPISANE višine',
    cenaBesedilo(fasada, visoka).includes('Bruto površina: 84,6 m²'), cenaBesedilo(fasada, visoka).slice(0, 160));
  check('2,35 m višine: neto 72,6 m² (84,6 − 12)', cenaBesedilo(fasada, visoka).includes('Neto površina: 72,6 m²'));
}

// ── 5. Izmišljena številka: udobje stopnic ──────────────────
{
  console.log('stopnice: pravila 2R + G se ne preverja več proti G, ki ga je kalkulator sam izbral:');
  const c = CRAFTS[0];
  const pricing = SRC('src/lib/pricing.ts');
  const planSrc = SRC('src/lib/install-plan.ts');
  check('v ceni ni več izmišljenega G (63 − 2R)', !pricing.includes('63 - 2 *'));
  check('v načrtu ni več izmišljenega G (63 − 2R)', !planSrc.includes('63 - 2 *'));
  check('v načrtu ni več useka globine stopnice (Math.min(32', !planSrc.includes('Math.min(32'));
  check('oznaka »Udobje (pravilo 2R + G)« je povsod odstranjena',
    !pricing.includes('Udobje (pravilo') && !planSrc.includes('Udobje (pravilo'));
  const zRazliko = sPoljem(sPoljem(c.base, 'steps', 16), 'totalRiseCm', 265);
  const pas = cena(c, zRazliko).summary.find((s) => s.label === 'Pravilo 2R + G')?.value ?? '__MANJKA__';
  const pasNacrt = preverba(c, zRazliko, 'Pravilo 2R + G')?.detail ?? '__MANJKA__';
  check('R = 265/16 = 16,56 cm je izračunan, ne ugiban',
    (cena(c, zRazliko).summary.find((s) => s.label === 'Višina stopnice (R)')?.value ?? '').includes('16,56'),
    cena(c, zRazliko).summary.map((s) => s.value).join(' | '));
  check('cena pove RAZPON G, ki ga pravilo zahteva (26,88–32,88)', pas.includes('26,88') && pas.includes('32,88'), pas);
  check('načrt našteje ISTE meje kot cena', pasNacrt.includes('26,88') && pasNacrt.includes('32,88'), pasNacrt);
  check('cena in načrt oba rečeta, da globine vnos ne vsebuje',
    pas.includes('ne pozna') && pasNacrt.includes('vnos ne vsebuje'), `${pas} /// ${pasNacrt}`);
  check('načrt ne trdi več, da je stopnica udobna', !pasNacrt.includes('✓') && !pas.includes('✓ udobje'), `${pas} /// ${pasNacrt}`);
  const prestrma = sPoljem(sPoljem(c.base, 'steps', 2), 'totalRiseCm', 265);
  const slaba = preverba(c, prestrma, 'Pravilo 2R + G');
  check('R = 132,5 cm: načrt reče, da razpored NI izvedljiv',
    slaba?.status === 'bad' && (slaba.detail ?? '').includes('ni izvedljivo'), slaba?.detail);
  check('brez vpisane višinske razlike se kontrola koraka NE izmišlja',
    !cena(c, c.base).summary.some((x) => x.label === 'Pravilo 2R + G'),
    cena(c, c.base).summary.map((x) => x.label).join(' | '));

  console.log('širina stopnic: številka brez izvira je označena kot praksa, ne kot predpis:');
  const sirina = preverba(c, c.base, 'Širina stopnic');
  check('1,1 m: ocena nosi VPISANO širino', (sirina?.detail ?? '').startsWith('1,1 m'), sirina?.detail);
  check('trditev o 0,9 m IMENUJE VIR (splošna praksa, ne objavljen podatek ROKSAL)',
    (sirina?.detail ?? '').includes('splošna praksa, ne objavljen podatek ROKSAL'), sirina?.detail);
  check('1,1 m je ok', sirina?.status === 'ok', sirina?.status);
  const ozka = preverba(c, sPoljem(c.base, 'stepWidth', 0.45), 'Širina stopnic');
  check('0,45 m je opozorilo, ne usekana mera',
    ozka?.status === 'warn' && (ozka.detail ?? '').startsWith('0,45 m'), ozka?.detail);

  console.log('širina stopnic soči račun, ne samo zaslon:');
  const profili = (sir: number) =>
    cena(c, sPoljem(c.base, 'stepWidth', sir)).lines.find((x) => x.name === 'Antidrseči profili')?.quantity ?? -1;
  const koraki = c.base.steps ?? 0;
  for (const sir of [0.45, 0.6, 1.35]) {
    const z = Math.round(koraki * sir * 100) / 100;
    check(`${koraki} stopnic × vpisanih ${sir} m: profil znaša ${z} m (stari usek na 0,6 m bi pri 0,45 zaračunal 7,2 m)`,
      profili(sir) === z, `${koraki} × ${sir} = ${profili(sir)}`);
  }

  console.log('št. stopnic: predlog je pri treh bralcih isti');
  const samodejno = sPoljem(sPoljem(c.base, 'steps', 0), 'totalRiseCm', 265);
  check('0 stopnic + 265 cm: cena predlaga 16 (265 / 17,5)',
    cena(c, samodejno).summary.some((x) => x.value.startsWith('16')),
    cena(c, samodejno).summary.map((x) => `${x.label}:${x.value}`).join(' | '));
  check('predlog je označen kot samodejen',
    cena(c, samodejno).summary.some((x) => x.label === 'Št. stopnic (samodejno)'));
  check('0 stopnic + 265 cm: načrt kupi 16 desk',
    nacrtBesedilo(c, samodejno).includes('16 × 1,1 m'), nacrtBesedilo(c, samodejno).slice(0, 160));
  check('0 stopnic + 265 cm: norma šteje ISTIH 16 (20,8 man-ur)',
    (norma(c, samodejno)?.summary ?? 'null').includes('20,8'), norma(c, samodejno)?.summary);
}

// ── 6. Fasada: povezalno pravilo (odprtine ≤ bruto) ─────────
{
  console.log('fasada: odprtine so lahko največ toliko kot celotna stena:');
  const c = CRAFTS[4];
  const prevec = sPoljem(sPoljem(c.base, 'facadeHeight', 2.35), 'openingsM2', 85);
  check('85 m² odprtin na 84,6 m² stene: cena NE zaračuna', cena(c, prevec).lines.length === 0);
  check('85 m²: povzetek našteje VPISANO 85', cenaBesedilo(c, prevec).includes('85'), cenaBesedilo(c, prevec).slice(0, 140));
  const dolgi = craftProblemText(resolveCraftInputs(c.id, prevec).problems[0] ?? fasadaOpeningProblem(84.6, 85)!);
  check('85 m²: dolgi razlog našteje mejo 84,6 (= bruto stene)', dolgi.includes('84,6'), dolgi);
  check('85 m²: dolgi razlog pojasni, da se izmere ne izidejo', dolgi.includes('zato se izmere ne izidejo'), dolgi);
  check('85 m²: načrt isto zavrne', nacrtZavrne(c, prevec) === true);
  check('85 m²: norma se ustavi', norma(c, prevec) === null);
  check('povezalna meja ni zapisana v registru (je odvisna od drugega vnosa)',
    !FASADA_INPUT_BOUNDS.some((b) => b.field === 'openingsM2' && b.max === 84.6));

  console.log('rob, kjer se lahko razideta zaokroževanje in meja:');
  const tocno = sPoljem(sPoljem({ ...c.base, facadePerimeter: 17 }, 'facadeHeight', 2.35), 'openingsM2', 39.95);
  check('17 × 2,35 = 39,9499…: odprtine 39,95 SE NE zavrnejo', !cenaZavrne(c, tocno), cenaBesedilo(c, tocno).slice(0, 140));
  const robNacrt = preverba(c, tocno, 'Delež odprtin');
  check('39,95 m² odprtin: načrt našteje neto 0 m², ne »neto −0 m²«',
    (robNacrt?.detail ?? '').includes('neto 0 m²') && !/neto [-−]0/.test(robNacrt?.detail ?? ''),
    robNacrt?.detail);
  const skorVse = sPoljem(sPoljem({ ...c.base, facadePerimeter: 17 }, 'facadeHeight', 2.35), 'openingsM2', 39.96);
  check('39,96 m² odprtin na 39,95 m² stene: zavrnjeno', cenaZavrne(c, skorVse), cenaBesedilo(c, skorVse).slice(0, 140));
  const delez = preverba(c, c.base, 'Delež odprtin');
  check('12 m² odprtin na 100,8 m²: delež 12 % in neto 88,8 m²',
    (delez?.detail ?? '').includes('12 %') && (delez?.detail ?? '').includes('88,8'), delez?.detail);
}

// ── 7. Več hkrati napačnih vnosov ───────────────────────────
{
  console.log('več poljev hkrati zunaj okna (nobena zavrnitev ne sme izginiti):');
  const c = CRAFTS[0];
  const dvojno = { ...c.base, stepWidth: 0.2, totalRiseCm: 700 } as CraftInputs;
  const problems = resolveCraftInputs('stopnice', dvojno).problems;
  check('oba vpisa sta zabeležena, ne samo prvi', problems.length === 2, JSON.stringify(problems.map((x) => x.bound.field)));
  const kratek = cena(c, dvojno).summary[0]?.value ?? '';
  check('povzetek našteje VPISANO širino 0,2', kratek.includes('0,2'), kratek);
  check('povzetek našteje VPISANO višinsko razliko 700', kratek.includes('700'), kratek);
  check('načrt našteje OBE zavrnitvi', nacin(c, dvojno).checks.filter((k) => k.label === 'Izračun ni opravljen').length === 2);
  check('pri dvojno napačnem vnosu se ne zaračuna nič (0 €)', vsota(c, dvojno) === 0, String(vsota(c, dvojno)));
}

// ── 8. Vse, kar monter prebere, ima decimalno vejico ────────
{
  console.log('oblika številk (monter bere vejico):');
  const vzorci: [Craft, CraftInputs, string, string][] = [
    [CRAFTS[0], sPoljem(sPoljem(CRAFTS[0].base, 'steps', 13), 'stepWidth', 1.15), 'stopnice 13 × 1,15 m', '1,15'],
    [CRAFTS[1], sPoljem(CRAFTS[1].base, 'floorLength', 4.35), 'keramika 4,35 m', '13,05'],
    [CRAFTS[2], sPoljem(CRAFTS[2].base, 'windowSize', 1.35), 'okna 1,35 m²', '1,35'],
    [CRAFTS[3], sPoljem(CRAFTS[3].base, 'canopyDepth', 2.45), 'nadstrešek 2,45 m', '2,45'],
    [CRAFTS[4], sPoljem(CRAFTS[4].base, 'openingsM2', 13.75), 'fasada 13,75 m²', '13,75'],
  ];
  for (const [c, i, ime, vpisano] of vzorci) {
    const besedilo = `${cenaBesedilo(c, i)} /// ${nacrtBesedilo(c, i)} /// ${norma(c, i)?.summary ?? ''}`;
    check(`${ime}: v besedilu cene, načrta in norme ni decimalnih pik`, !/\d\.\d/.test(besedilo), besedilo.slice(0, 200));
    check(`${ime}: izračunana vrednost ${vpisano} je izpisana z vejico`, besedilo.includes(vpisano), besedilo.slice(0, 160));
  }
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
