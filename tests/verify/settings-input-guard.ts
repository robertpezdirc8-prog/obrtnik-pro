// ─── Preverb: DENAR IN ROKI NA DOKUMENTIH IMAJO EN BRALEC ──────────────────
// ZAKAJ (Task 86): `depositPercent` so štirje bralci razumeli vsak po svoje.
// Urejevalnik je vpisano pokazal dobesedno (»33.7 %« z piko), PDF ponudbe in
// račun sta uporabila `Math.floor` (33 %), SMS pa je imel SVOJ privzetek 30 %
// (PDF-ja sta imela svojega: 0 %). Pri 150 % je urejevalnik izračunal
// NEGATIVEN ostanek, PDF pa 100 %. Rok plačila je računal PDF iz
// `paymentDays` (z rezervo 15), strežnik pa je v bazo pisal hardcodiranih
// 30 dni — isti račun je imel dva datuma zapadlosti, evidenca terjatev pa še
// tretjega (izmišljenega privzetka).
//
// KAJ POKAŽE:
//  1. `readSettings` vpisane vrednosti NE useka, NE zaokroži in NE nadomesti;
//  2. rob je PO POLJIH — napaka na roku plačila ne ugasne akontacije;
//  3. zunaj okna dokument izpusti vrsto z razlogom, ki imenuje VPISANO
//     vrednost (in nikoli prirejene);
//  4. vsi bralci (PDF ponudbe, račun, SMS, urejevalnik, strežnik) dajo ISTO
//     številko — enake formulacije in enake decimalke;
//  5. račun tiska SHRANJENI `dueAt`, ne današnje nastavitve;
//  6. tihi privzetki so iz vira odstranjeni (vir se bere neposredno).
//
// Zagon: bun tests/verify/settings-input-guard.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSettings,
  resolveSettingsInputs,
  SETTINGS_INPUT_BOUNDS,
  settingsProblemShort,
  settingsProblemText,
  settingsWindowHint,
  type SettingsField,
} from '../../src/lib/settings-inputs';
import { buildInvoiceHTML, buildOfferHTML, validUntil } from '../../src/lib/pdf';
import { buildOfferShareText } from '../../src/lib/paperwork';
import type { InvoiceDTO, OfferDTO, SettingsDTO } from '../../src/lib/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');
/** Samo koda, brez komentarjev. Komentarji namenoma naštejejo bivše napake
 *  (`Math.floor`, `|| 15`, `DEFAULT_DUE_DAYS`) — sicer bi jih regex našel in
 *  javil kot lažno vračanje aktivne kode. */
const CODE = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const FIELDS: SettingsField[] = ['vatRate', 'laborRate', 'quoteValidDays', 'depositPercent', 'paymentDays'];

const BASE_SETTINGS: SettingsDTO = {
  companyName: 'Ograje Lozar s.p.',
  ownerName: 'Robert Pezdirc',
  address: 'Kranj',
  phone: '040 123 456',
  email: 'info@example.si',
  taxNumber: '12345678',
  iban: 'SI56 0000 0000 0000 000',
  vatRate: 22,
  laborRate: 35,
  quoteValidDays: 15,
  depositPercent: 30,
  paymentDays: 15,
  logoUrl: null,
};
const set = (p: Partial<SettingsDTO>): SettingsDTO => ({ ...BASE_SETTINGS, ...p });

const CREATED = '2026-10-01T08:00:00.000Z';
const OFFER: OfferDTO = {
  id: 'o1',
  number: '2026-001',
  customerName: 'Novak',
  customerEmail: null,
  customerPhone: null,
  customerAddress: null,
  objectAddress: 'Kranj',
  note: null,
  status: 'sent',
  sentAt: null,
  decidedAt: null,
  followUpAt: null,
  subtotal: 1000,
  vatRate: 22,
  vatAmount: 220,
  total: 1220,
  createdAt: CREATED,
  items: [{ id: 'i1', name: 'Montaža ograje', description: null, quantity: 10, unit: 'm', unitPrice: 100, total: 1000, sortOrder: 0 }],
};
/** Račun čez 1220 € z SHRANJENIM rokom 29.10.2026 (28 dni od izdaje). */
const INVOICE: InvoiceDTO = {
  id: 'r1',
  number: 'RAC-2026-001',
  offerId: 'o1',
  offerNumber: '2026-001',
  customerName: 'Novak',
  subtotal: 1000,
  vatRate: 22,
  vatAmount: 220,
  total: 1220,
  dueAt: '2026-10-29T08:00:00.000Z',
  paidAt: null,
  createdAt: CREATED,
};

/** Datum v obliki, jo tiskajo dokumenti (sl-SI, brez ure). */
const day = (iso: string) =>
  new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const plusDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString();

// ── 1. Register: pet polj, vsak rob utemeljen ───────────────
{
  console.log('register nastavitev:');
  check('pet številskih polj', SETTINGS_INPUT_BOUNDS.length === 5, `${SETTINGS_INPUT_BOUNDS.length}`);
  for (const f of FIELDS) {
    const b = SETTINGS_INPUT_BOUNDS.find((x) => x.field === f);
    check(`${f}: rob obstaja`, !!b);
    check(`${f}: rob ima razlog (why ≥ 20 znakov)`, (b?.why ?? '').length >= 20, b?.why);
    check(`${f}: rob ima enoto`, (b?.unit ?? '').length > 0);
  }
  // Zgornje meje dni in urne postavke NE obstajajo — to je monterjeva
  // poslovna odločitev, aplikacija je ne sme izmisliti.
  for (const f of ['laborRate', 'quoteValidDays', 'paymentDays'] as SettingsField[]) {
    const b = SETTINGS_INPUT_BOUNDS.find((x) => x.field === f);
    check(`${f}: zgornje meje ni (monterjeva poslovna odločitev)`, b?.max === null, `max=${b?.max}`);
  }
  const cap = SETTINGS_INPUT_BOUNDS.find((x) => x.field === 'depositPercent');
  check('akontacija: spodnji rob 0 (brez akontacije je veljaven)', cap?.min === 0);
  check('akontacija: zgornji rob 100 (odstotek deleža celote)', cap?.max === 100);
}

// ── 2. Vpisana vrednost se NE popravi ───────────────────────
{
  console.log('brez useka, zaokroževanja in tihih privzetkov:');
  const r = readSettings(set({ depositPercent: 33.7 }));
  check('33,7 % ostane 33,7', r.depositPercent.value === 33.7, `${r.depositPercent.value}`);
  check('33,7 % je veljaven (brez problema)', r.depositPercent.problem === null);

  const nula = readSettings(set({ depositPercent: 0 }));
  check('0 % je veljaven vnos', nula.depositPercent.problem === null && nula.depositPercent.value === 0);
  const sto = readSettings(set({ depositPercent: 100 }));
  check('100 % je veljaven vnos', sto.depositPercent.problem === null);
  const vec = readSettings(set({ depositPercent: 100.5 }));
  check('100,5 % je ZUNAJ (side max)', vec.depositPercent.problem?.side === 'max', vec.depositPercent.problem?.side);
  check('100,5 % se NE useka na 100', vec.depositPercent.value === 100.5, `${vec.depositPercent.value}`);
  const minus = readSettings(set({ depositPercent: -5 }));
  check('-5 % je ZUNAJ (side min)', minus.depositPercent.problem?.side === 'min');

  const prazen = readSettings({ ...BASE_SETTINGS, depositPercent: undefined });
  check('manjkajoč vnos = NaN problem, NE privzetek 30',
    prazen.depositPercent.problem?.side === 'nan' && Number.isNaN(prazen.depositPercent.value),
    `${prazen.depositPercent.value}`);
  const nic = readSettings({ ...BASE_SETTINGS, paymentDays: null });
  check('null vnos = nan problem, NE privzetek 15',
    nic.paymentDays.problem?.side === 'nan' && Number.isNaN(nic.paymentDays.value));

  const delo = readSettings(set({ laborRate: 0 }));
  check('0 €/h je veljavno (delo obračunano drugje)', delo.laborRate.problem === null);
  const deloNeg = readSettings(set({ laborRate: -1 }));
  check('-1 €/h je zunaj', deloNeg.laborRate.problem?.side === 'min');
  const ddvDrob = readSettings(set({ vatRate: 22.5 }));
  check('22,5 % DDV je veljaven (odstotki smejo biti drobni)', ddvDrob.vatRate.problem === null);
}

// ── 3. Celi dni: 15,5 dneva ni zaokroženo ──────────────────
{
  console.log('dni se vpisujejo kot cela števila:');
  const pol = readSettings(set({ paymentDays: 15.5 }));
  check('15,5 dni je problem (side fraction)', pol.paymentDays.problem?.side === 'fraction', pol.paymentDays.problem?.side);
  check('15,5 dni ostane 15,5 (brez Math.floor)', pol.paymentDays.value === 15.5, `${pol.paymentDays.value}`);
  check('razlog imenuje VPISANIH 15,5', settingsProblemText(pol.paymentDays.problem!).includes('15,5'));
  const veljav = readSettings(set({ paymentDays: 15 }));
  check('15 dni velja', veljav.paymentDays.problem === null);
  const nicDni = readSettings(set({ paymentDays: 0 }));
  check('0 dni je zunaj (side min), NE prevzame 15', nicDni.paymentDays.problem?.side === 'min');
  const veljav2 = readSettings(set({ quoteValidDays: 999999 }));
  check('zelo dolga veljavnost je veljavna (zgornje meje ni)', veljav2.quoteValidDays.problem === null);
  const drobenV = readSettings(set({ quoteValidDays: 3.5 }));
  check('3,5 dneva veljavnosti je problem (fraction)', drobenV.quoteValidDays.problem?.side === 'fraction');
}

// ── 4. Rob je PO POLJIH ────────────────────────────────────
{
  console.log('napaka na enem polju ne ugasne ostalih:');
  const s = set({ paymentDays: 0, depositPercent: 33.7 });
  const r = readSettings(s);
  check('rok plačila: problem', r.paymentDays.problem !== null);
  check('akontacija kljub temu velja (brez problema)', r.depositPercent.problem === null);
  check('akontacija kljub temu ostane 33,7', r.depositPercent.value === 33.7);
  const r2 = readSettings(set({ depositPercent: 150, paymentDays: 15 }));
  check('ločevanje po poljih velja tudi v obratni smeri',
    r2.depositPercent.problem?.side === 'max' && r2.paymentDays.problem === null);
  const skupni = resolveSettingsInputs(s);
  check('skupni resolver je celosten (ok=false), a po poljih loči', skupni.ok === false && r.depositPercent.problem === null);
  const pdf = buildOfferHTML(OFFER, s);
  check('PDF ponudbe vsebuje akontacijo 33,7 kljub napačnemu roku', pdf.includes('akontacija 33,7 %'));
  check('PDF veljavnost NE pade zaradi napačnega roka plačila', !pdf.includes('Veljavnost ni izračunana'));
  check('PDF akontacija ostane tudi zato, ker je napaka na drugem polju', !pdf.includes('Akontacija ni izračunana'));
  const sms = buildOfferShareText(OFFER, s);
  check('SMS vsebuje akontacijo 33,7', sms.includes('Akontacija 33,7 %'));
}

// ── 5. Besedilo zavrnitve imenuje VPISANO vrednost ─────────
{
  console.log('zavrnitev:');
  const p = readSettings(set({ depositPercent: 150 })).depositPercent.problem!;
  const t = settingsProblemText(p);
  check('kratka oblika našteje 150 %', settingsProblemShort(p) === 'Akontacija (%) 150 %', settingsProblemShort(p));
  check('dolga oblika vsebuje vpisanih 150', t.includes('150'));
  check('dolga oblika vsebuje okno 0–100 %', t.includes('0–100 %'), t);
  check('dolga oblika pravi, da vnosa NI popravila', t.includes('Vpisane vrednosti nismo popravili'));
  check('dolga oblika ne predstavi 100 % kot nove vrednosti', !t.includes('Akontacija 100'));
  const tDrob = settingsProblemText(readSettings(set({ depositPercent: 100.5 })).depositPercent.problem!);
  check('zavrnitev piše drobno VPISANO vrednost z vejico', tDrob.includes('100,5') && !/\d\.\d/.test(tDrob), tDrob);
  const nanText = settingsProblemText(readSettings({ ...BASE_SETTINGS, depositPercent: undefined }).depositPercent.problem!);
  check('manjkajoč vnos: besedilo pravi »številka ni vpisana«', nanText.includes('številka ni vpisana'), nanText);
  check('namig pod poljem črpa številke iz registra',
    settingsWindowHint('depositPercent').includes('0–100 %'), settingsWindowHint('depositPercent'));
  const extra = settingsWindowHint('quoteValidDays', 'Izpiše se na PDF');
  check('namig z dodatnim besedilom obdrži obe trditvi', extra.startsWith('Izpiše se na PDF') && extra.includes('najmanj 1 dni'));
}

// ── 6. PDF ponudbe, račun in SMS izpišejo ISTE številke ────
{
  console.log('ujemanje bralcev (33,7 % čez 1220 €):');
  const s = set({ depositPercent: 33.7 });
  const pdf = buildOfferHTML(OFFER, s);
  const sms = buildOfferShareText(OFFER, s);
  const rac = buildInvoiceHTML(INVOICE, OFFER, s);
  const znesek = (1220 * 33.7) / 100; // 411,14 €
  check('PDF piše 33,7 % (vejica)', pdf.includes('akontacija 33,7 %'), pdf.match(/akontacija [^%]*%/)?.[0]);
  check('PDF NE piše 33 % (usekan)', !pdf.includes('akontacija 33 %'));
  check('PDF NE piše 33.7 (pika)', !pdf.includes('33.7'));
  check('SMS piše 33,7 %', sms.includes('Akontacija 33,7 %'));
  check('račun piše 33,7 %', rac.includes('Akontacija 33,7 %'));
  check('PDF in SMS se strinjata o znesku akontacije',
    pdf.includes(new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(znesek)) &&
    sms.includes(new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(znesek)),
    `znesek ${znesek}`);
  const nic = set({ depositPercent: 0 });
  check('0 % ⇒ na PDF ni akontacijske vrstice', !buildOfferHTML(OFFER, nic).includes('akontacija'));
  check('0 % ⇒ v SMS ni akontacijske vrstice', !buildOfferShareText(OFFER, nic).includes('Akontacija'));
  // Bivša napaka: SMS je imel svoj privzetek 30 %, PDF-ja svojega (0 %).
  const smsZunaj = buildOfferShareText(OFFER, set({ depositPercent: 150 }));
  check('SMS pri 150 % NE vrne svojega bivšega privzetka 30 %', !smsZunaj.includes('Akontacija 30 %'), smsZunaj);
  check('SMS pri 150 % pove razlog', smsZunaj.includes('Akontacija: ni izračunana'));
  check('SMS pri 150 % imenuje vpisanih 150', smsZunaj.includes('150'));
}

// ── 7. Veljavnost: dokument NE izmišlja 15 dni ─────────────
{
  console.log('veljavnost ponudbe:');
  const s = set({ quoteValidDays: 15 });
  const pdf = buildOfferHTML(OFFER, s);
  const sms = buildOfferShareText(OFFER, s);
  const expected = day(plusDays(CREATED, 15));
  check('validUntil(15) = izdaja + 15 dni', validUntil(CREATED, 15) === expected, `${validUntil(CREATED, 15)} vs ${expected}`);
  check('PDF piše ta datum', pdf.includes(`Velja do: ${expected}`));
  check('SMS piše ISTI datum', sms.includes(`Velja do: ${expected}`));
  check('PDF piše 15 dni od izdaje (besedilo se ujema z datumom)', pdf.includes('Ponudba velja 15 dni'));

  const nic = readSettings({ ...BASE_SETTINGS, quoteValidDays: undefined });
  const pdfNic = buildOfferHTML(OFFER, { ...BASE_SETTINGS, quoteValidDays: Number.NaN });
  const smsNic = buildOfferShareText(OFFER, { ...BASE_SETTINGS, quoteValidDays: Number.NaN });
  const datum15 = day(plusDays(CREATED, 15));
  check('brez nastavitve: PDF ne piše datuma', !pdfNic.includes(`Velja do: ${datum15}`));
  check('brez nastavitve: PDF pove razlog', pdfNic.includes('Veljavnost ni izračunana'));
  check('brez nastavitve: SMS pove razlog namesto datuma', smsNic.includes('Velja do: —') && smsNic.includes('številka ni vpisana'), smsNic);
  check('resolver: manjkajoč vnos ima problem', nic.quoteValidDays.problem?.side === 'nan');

  const nicVrednost = buildOfferHTML(OFFER, set({ quoteValidDays: 0 }));
  check('0 dni: PDF NE priredi na 15', !nicVrednost.includes('Ponudba velja 15 dni') && nicVrednost.includes('Veljavnost ni izračunana'));
  const droben = buildOfferHTML(OFFER, set({ quoteValidDays: 15.5 }));
  check('15,5 dneva: PDF izpusti vrsto in našteje 15,5',
    droben.includes('Veljavnost ni izračunana') && droben.includes('15,5'));
  check('validUntil brez števila = null (brez izmišljenega datuma)', validUntil(CREATED, Number.NaN) === null);
}

// ── 8. Račun tiska SHRANJENI rok, ne današnje nastavitve ──
{
  console.log('rok plačila računa:');
  const rac = buildInvoiceHTML(INVOICE, OFFER, set({ paymentDays: 5 }));
  const shrani = day(INVOICE.dueAt as string);
  check('račun piše shranjeni datum 29. 10. 2026', rac.includes(`Rok plačila: ${shrani}`), rac.match(/Rok plačila: [^<]*/)?.[0]);
  check('račun NE piše datuma iz nastavitve 5 dni', !rac.includes(day(plusDays(CREATED, 5))));
  check('račun piše 28 dni od izdaje (izračun iz obeh shranjenih datumov)', rac.includes('(28 dni od izdaje)'));

  const brez = buildInvoiceHTML({ ...INVOICE, dueAt: null }, OFFER, set({ paymentDays: 5 }));
  check('brez shranjenega roka: račun ne izmišlja datuma', brez.includes('Račun nima roka plačila'));
  check('brez shranjenega roka: omenja trenutno nastavitev 5 dni', brez.includes('Trenutna nastavitev (5 dni)'));
  check('brez shranjenega roka: piše, da tega računa ne spreminja', brez.includes('tega ne spreminja'));

  const brezNapak = buildInvoiceHTML({ ...INVOICE, dueAt: null }, OFFER, set({ paymentDays: 0 }));
  check('brez roka IN napačna nastavitev: opozori na Nastavitve', brezNapak.includes('zunaj okna'));
  const placi = buildInvoiceHTML(INVOICE, OFFER, set({ depositPercent: 150 }));
  check('račun s 150 %: izpusti akontacijo z razlogom (namesto 100 %)',
    placi.includes('Akontacija ni izračunana') && !placi.includes('Akontacija 100 %'));
}

// ── 9. Vir: tihi privzetki so odstranjeni ──────────────────
{
  console.log('vir (kjer je bil izmišljen podatek):');
  const pdf = CODE(SRC('src/lib/pdf.ts'));
  const paperwork = CODE(SRC('src/lib/paperwork.ts'));
  const editor = CODE(SRC('src/components/offer-editor.tsx'));
  const settingsView = CODE(SRC('src/components/settings-view.tsx'));
  const apiSettings = CODE(SRC('src/app/api/settings/route.ts'));
  const apiInvoices = CODE(SRC('src/app/api/invoices/route.ts'));
  const tracking = CODE(SRC('src/lib/payment-tracking.ts'));
  const apiOffers = CODE(SRC('src/app/api/offers/route.ts'));
  const viz = CODE(SRC('src/lib/viz-proposal.ts'));
  const calcShell = CODE(SRC('src/components/calculators/shared.tsx'));
  const timesheet = CODE(SRC('src/components/timesheet-view.tsx'));
  const plan = CODE(SRC('src/lib/install-plan.ts'));

  check('pdf.ts brez Math.floor(settings.', !/Math\.floor\(\s*settings\./.test(pdf));
  check('pdf.ts brez useka na 0–100', !/Math\.max\(0,\s*Math\.min\(100/.test(pdf));
  check('pdf.ts brez tihega 15 dni', !/\|\|\s*15/.test(pdf));
  check('pdf.ts ne računa več roka iz nastavitve (bivši dueDate)', !/function dueDate/.test(pdf) && !/dueDate\(/.test(pdf));
  check('paperwork.ts brez lastnega privzetka 30 %', !/\?\?\s*30/.test(paperwork));
  check('paperwork.ts brez useka na 0–100', !/Math\.max\(0,\s*Math\.min\(100/.test(paperwork));
  check('paperwork.ts bere readSettings', paperwork.includes('readSettings('));
  check('urejevalnik več nima ?? 22 / ?? 35', !/\?\?\s*22/.test(editor) && !/\?\?\s*35/.test(editor));
  check('urejevalnik ob nalaganju več ne vzame privzetka 30', !/: 30\)/.test(editor));
  check('urejevalnik bere readSettings', editor.includes('readSettings('));
  check('urejevalnik ne prikaže akontacije pred nalaganjem nastavitev', editor.includes('settingsReady &&'));
  check('nastavitve: onChange NE useka z || 0 ali || 15', !/Number\(e\.target\.value\)\s*\|\|/.test(settingsView));
  check('nastavitve: DOM min/max več ni omejitev vpisa', !/min=\{|max=\{/.test(settingsView));
  check('nastavitve: namig pride iz registra', settingsView.includes('settingsWindowHint('));
  check('nastavitve: ne prodajajo izmišljenega nasveta 10–50 %', !settingsView.includes('10–50'));
  check('nastavitve: ne pišejo »tipično 15 ali 30 dni«', !settingsView.includes('tipično 15'));
  check('nastavitve: NE pošljejo napačnega vpisa na strežnik', settingsView.includes('blocked'));
  check('API nastavitev ZAVRNE vnose zunaj okna (400)', apiSettings.includes('status: 400') && apiSettings.includes('readSettings('));
  check('API računov ne pozna več izmišljenih 30 dni', !apiInvoices.includes('DEFAULT_DUE_DAYS') && apiInvoices.includes('readSettings('));
  check('API računov pusti rok prazen, če vnos ni veljaven', /rok\.problem\s*\?\s*null/.test(apiInvoices));
  check('payment-tracking brez izmišljenega privzetega roka', !tracking.includes('DEFAULT_DUE_DAYS'));
  check('payment-tracking pozna stanje brez roka', tracking.includes("'no-due'"));
  check('payment-tracking: suggestDueIso zahteva št. dni', /suggestDueIso\(from: Date \| string, days: number\)/.test(tracking));

  // — Task 86, 2. krog: izmišljeni 22 % in izmišljenih 35 €/h —
  check('API ponudb ne pozna več ?? 22', !/\?\?\s*22/.test(apiOffers));
  check('API ponudb bere readSettings', apiOffers.includes('readSettings('));
  check('API ponudb ZAVRNE shranjevanje brez veljavne stopnje DDV', apiOffers.includes('ddv.problem'));
  check('slika ponudbe ne pozna ?? 22', !/\?\?\s*22/.test(viz));
  check('slika ponudbe bere readSettings', viz.includes('readSettings('));
  check('slika ponudbe brez stopnje napiše »DDV prištejemo po ponudbi«', viz.includes("'DDV prištejemo po ponudbi'"));
  check('urejevalnik ne začne z izmišljenim useState(22)', !/useState\(22\)/.test(editor));
  check('urejevalnik ne shrani brez veljavne stopnje DDV', editor.includes('!settingsReady || ddv.problem'));
  check('izračun ne začne z izmišljenim useState(35)', !/useState\(35\)/.test(calcShell));
  check('izračun začne z NaN in počaka na nastavitve', /useState\(Number\.NaN\)/.test(calcShell) && calcShell.includes('laborLoaded'));
  check('GBB panel dobi postavko samo iz nastavitve', calcShell.includes('laborRate={delo.value}'));
  check('GBB panel je ob napačni nastavitvi zavrnjen z razlogom', calcShell.includes('gbb-blocked'));
  check('evidenca ur ne začne z izmišljenim useState(35)', !/useState\(35\)/.test(timesheet));
  check('evidenca ur ne nadomesti vpisa z nastavljeno postavko', !/\|\|\s*35/.test(timesheet) && timesheet.includes('if (delo.problem)'));
  check('evidenca ur shrani VPISANO postavko', timesheet.includes('hourlyRate: delo.value'));
  check('nadstrešek ne prodaja več »uhaja voda na spojih« kot dejstvo', !plan.includes('uhaja voda na spojih'));
  check('nakloni kritine so označeni kot priporočilo iz prakse', plan.includes('priporočilo iz prakse'));
  check('preklop 10 % je označen kot praktična ocena', plan.includes('praktična ocena'));
  check('padec odvoda je označen kot praksa', plan.includes('praksa, ne citiran predpis'));
}

// ── 10. Decimalna vejica je produktna invarianta ───────────
{
  console.log('vejica (ne pika) na dokumentih:');
  const s = set({ depositPercent: 33.7, vatRate: 22.5 });
  // CSS ima svoje decimalke (`letter-spacing: 0.5px`), zato se invarianta
  // preverja samo po besedilu dokumenta.
  const besedilo = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, ' ');
  const pdf = buildOfferHTML(OFFER, s);
  const sms = buildOfferShareText(OFFER, s);
  const rac = buildInvoiceHTML(INVOICE, OFFER, s);
  for (const [ime, dokument] of [['PDF', pdf], ['SMS', sms], ['račun', rac]] as const) {
    check(`${ime}: nobena številka v besedilu ni pisana z decimalno piko`,
      !/\d\.\d/.test(besedilo(dokument)), besedilo(dokument).match(/.{0,24}\d\.\d.{0,8}/)?.[0]);
  }
  check('PDF: drobni DDV 22,5 % iz postavk ponudbe se piše z vejico',
    buildOfferHTML({ ...OFFER, vatRate: 22.5, vatAmount: 225, total: 1225 }, s).includes('22,5 %'));
  check('račun: DDV pride iz postavke računa (22 %), ne iz nastavitev (22,5)',
    rac.includes('DDV 22 %') && !besedilo(rac).includes('22,5'));
  const racZunaj = buildInvoiceHTML(INVOICE, OFFER, set({ depositPercent: 150 }));
  check('račun pri 150 % ne natisne nadomestnega zneska (610 € = 50 %)', !racZunaj.includes('610'));
}

// ── 11. Task 87: vrstica, ki jo je monter TIPKAL, ne sme tiho postati 0 ──
//    `type="number"` je slovensko vejico vrnil kot PRAZEN string, `Number('')`
//    pa je 0. Monter je tipkal 12,5 in vrstica je tekla pri 0 €. Zdaj so vsa
//    številčna polja BESEDILO (`inputMode="decimal"`), neveljaven vpis pa
//    ZADRŽI izračun in imenuje vrednost, kot jo je nekdo vpisal.
{
  console.log('\n── Task 87: vpisana številka sme ostati vejica in ne sme postati 0 ──');
  const vnosi = {
    'nastavitve': CODE(SRC('src/components/settings-view.tsx')),
    'urejevalnik ponudbe': CODE(SRC('src/components/offer-editor.tsx')),
    'kalkulator (NumField)': CODE(SRC('src/components/calculators/shared.tsx')),
    'evidenca ur': CODE(SRC('src/components/timesheet-view.tsx')),
  } as const;
  for (const [ime, src] of Object.entries(vnosi)) {
    check(`${ime}: numerična polja NISO <Input type="number">`, !/type="number"/.test(src), 'najden number vnos');
    check(`${ime}: polja so BESEDILO z decimalnim načinom`, src.includes('inputMode="decimal"'));
    check(`${ime}: neveljaven vpis se bere kot NaN, ne kot 0`, src.includes('parseNumberInput'));
    check(`${ime}: praznega vpisa NE nadomesti ničla`, !/===\s*''\s*\?\s*0\b/.test(src));
    check(`${ime}: shranjena vrednost je prikazana z vejico`, src.includes('formatNum'));
  }
  const stavek = CODE(SRC('src/lib/settings-inputs.ts'));
  check('oblika zavrnitve živi v ENI moduli', stavek.includes('export function numberProblemSentence'));
  check('zavrnitev vrne VPISANO besedilo dobesedno', stavek.includes('${label} „${typed}“ številka ni'));
  // Shranjevanje nastavitev je bilo tiho brez vsebine — to je ujel šele
  // brskalnik: payload je vzel `{ ...settings }` (STARE vrednosti), odgovor pa
  // je bil »Nastavitve shranjene ✓«. Monter je vpisal 33,7, na zaslonu dobil
  // 33,7, na strežniku pa 30.
  check('nastavitve: Shrani pošlje OSNUTEK, ne stare vrednosti', vnosi['nastavitve'].includes('= { ...draft }'));
  check('nastavitve: payload ne sme več vzeti starih `settings`', !/payload:\s*Partial<SettingsDTO>\s*=\s*\{\s*\.\.\.settings\s*\}/.test(vnosi['nastavitve']));
  for (const ime of ['nastavitve', 'urejevalnik ponudbe', 'kalkulator (NumField)'] as const) {
    check(`${ime}: zavrnitev uporabi ISTI stavek kot ostali vnosi`, vnosi[ime].includes('numberProblemSentence'));
  }
  const calc = vnosi['kalkulator (NumField)'];
  check('ročna cena nima več LASTNEGA stavka o napaki (isti stavek povsod)', !calc.includes('ni cena'));
  check('kalkulator začne z NaN in počaka na nastavitve', calc.includes('const priced = laborLoaded && !delo.problem'));
  check('izračun cene prikaže šele, ko je urna postavka veljavna', calc.includes('priced && result.lines.length > 0'));
  check('izračun ima ime zavrnitve cene', calc.includes('data-testid="calc-price-refusal"'));
  check('GBB opcije so pod istim pogojem kot cene', /priced && result\.lines\.length > 0 && \(\s*<GbbPanel/.test(calc));
  const camera = CODE(SRC('src/components/camera/camera-view.tsx'));
  const vizPanel = CODE(SRC('src/components/camera/viz-panel.tsx'));
  const fotoProjekt = CODE(SRC('src/lib/photo-project.ts'));
  check('kamera nima izmišljene ure v klicu', !/runCalculator\([^)]*,\s*35\)/.test(camera) && !/,\s*35\)/.test(camera));
  check('kamera bere uro iz Nastavitev', camera.includes('useLaborRate()'));
  check('kamera brez veljavne ure ne zbere projekta v ponudbo', camera.includes('if (!priced)'));
  check('kamera brez ure ne natisne denarja', camera.includes('data-testid="project-price-refusal"'));
  check('predlog iz vizualizerja nima izmišljene ure', !/,\s*35\)/.test(vizPanel) && vizPanel.includes('delo.value'));
  check('seštevek fotografij nima privzete ure', !/laborRate\s*=\s*35/.test(fotoProjekt) && /laborRate: number/.test(fotoProjekt));
  check('pogon cen nima več izmišljene ure 35', !/\bunitPrice: 35\b/.test(CODE(SRC('src/lib/pricing.ts'))));
}

console.log(`\n═══ settings-input-guard: ${pass} OK, ${fail} NAPAK ═══`);
if (fail > 0) process.exit(1);
