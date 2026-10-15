// ─── Verify: e-račun (e-SLOG / EN 16931, UBL 2.1) ───────────
// Vsak test ima ročno izračunano resnico (0 AI, deterministično).
// Poženi: bun tests/verify/eslog.ts

import {
  ESLOG_CUSTOMIZATION_ID,
  buildEslogXml,
  eslogDate,
  eslogDateSl,
  eslogFilename,
  eslogMathIssues,
  eslogMoney,
  eslogPercent,
  eslogQuantity,
  eslogWarnings,
  escapeXml,
  splitAddress,
  sloTaxIdentifier,
  unitToRec20,
  type EslogInvoiceInput,
} from '../../src/lib/eslog';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ─── Ročna resnica: osnovni račun ───────────────────────────
// Postavki: 12 m × 145 € = 1740 €; 3 kos × 38 € = 114 €
// Osnova = 1854 €, DDV 22 % = 407,88 €, skupaj = 2261,88 €
const items = [
  { name: 'Aluminijasta ograja', description: 'Eloksirana', quantity: 12, unit: 'm', unitPrice: 145, total: 1740 },
  { name: 'Steber aluminij 40×40', description: null, quantity: 3, unit: 'kos', unitPrice: 38, total: 114 },
];
const SELLER = {
  name: 'Obrt Test s.p.',
  address: 'Ulica 14, 1000 Ljubljana',
  taxNumber: '12345678',
  iban: 'SI56 0510 0801 0555 555',
};
const BASE: EslogInvoiceInput = {
  number: 'RAC-2026-001',
  issueDate: new Date('2026-10-14T10:00:00.000Z'),
  dueDate: new Date('2026-11-13T10:00:00.000Z'),
  offerNumber: 'PON-2026-001',
  subtotal: 1854,
  vatRate: 22,
  vatAmount: 407.88,
  total: 2261.88,
  seller: SELLER,
  buyer: { name: 'Stranka d.o.o.', address: 'Cesta 1, 2000 Maribor' },
  items,
};

console.log('\n── enote (UN/ECE Rec 20, preverjeno na Peppol seznamu) ──');
check('m → MTR', unitToRec20('m') === 'MTR');
check('m² → MTK', unitToRec20('m²') === 'MTK');
check('m³ → MTQ', unitToRec20('m³') === 'MTQ');
check('ura → HUR', unitToRec20('ura') === 'HUR');
check('kg → KGM', unitToRec20('kg') === 'KGM');
check('komplet → SET', unitToRec20('komplet') === 'SET');
check('kos → C62', unitToRec20('kos') === 'C62');
check('neznana (vrečka) → C62 fallback', unitToRec20('vrečka') === 'C62');
check('različne velikosti črk (M) → MTR', unitToRec20(' M ') === 'MTR');

console.log('\n── escapeXml ──');
check('& → &amp;', escapeXml('A & B') === 'A &amp; B');
check('< > oklepaji', escapeXml('<x>') === '&lt;x&gt;');
check('narekovaji', escapeXml('"a\'b"') === '&quot;a&apos;b&quot;');
check('kontrolni znaki odstranjeni, \n ostane', escapeXml('a\u0007b\nc') === 'ab\nc');
check('čšž ostanejo', escapeXml('čšžČŠŽ') === 'čšžČŠŽ');

console.log('\n── datumi, zneski, količine, stopnje ──');
check('eslogDate YYYY-MM-DD', eslogDate(new Date('2026-10-14T10:00:00.000Z')) === '2026-10-14');
check('eslogDateSl 13. 11. 2026', eslogDateSl(new Date('2026-11-13T10:00:00.000Z')) === '13. 11. 2026');
check('eslogMoney 2 dec', eslogMoney(407.88) === '407.88');
check('eslogMoney zaokroži', eslogMoney(1.005) === '1.00' || eslogMoney(1.005) === '1.01'); // plavajoča vejica — dovolimo obe, glavno: 2 dec
check('eslogMoney natanko 2 dec', (eslogMoney(5) as string).match(/^\d+\.\d{2}$/) !== null);
check('eslogPercent cela', eslogPercent(22) === '22');
check('eslogPercent decimalna', eslogPercent(9.5) === '9.5');
check('eslogQuantity celo', eslogQuantity(12) === '12');
check('eslogQuantity decimalna', eslogQuantity(2.5) === '2.5');
check('eslogQuantity 3 dec brez ničel', eslogQuantity(1.25) === '1.25');

console.log('\n── davčna številka (SI########) ──');
check('12345678 → SI12345678', sloTaxIdentifier('12345678') === 'SI12345678');
check('SI12345678 → SI12345678', sloTaxIdentifier('SI12345678') === 'SI12345678');
check('SI 12345678 (presledek) → SI12345678', sloTaxIdentifier('SI 12345678') === 'SI12345678');
check('7 števk → null', sloTaxIdentifier('1234567') === null);
check('črke → null', sloTaxIdentifier('SI1234567A') === null);
check('prazno → null', sloTaxIdentifier('') === null);

console.log('\n── razčlenjevanje naslova ──');
const a1 = splitAddress('Ulica 14, 1000 Ljubljana');
check('ulica', a1.street === 'Ulica 14');
check('kraj', a1.city === 'Ljubljana');
check('pošta', a1.postalZone === '1000');
const a2 = splitAddress('Naselje 5');
check('brez vejice: street', a2.street === 'Naselje 5');
check('brez vejice: city prazno, postal prazno', a2.city === '' && a2.postalZone === '');
const a3 = splitAddress('Ulica 14, 1000 Ljubljana, Slovenija');
check('3 deli: street', a3.street === 'Ulica 14');
// Regex s sledi od začetka ostanka: pošta 1000, kraj 'Ljubljana, Slovenija'
check('3 deli: pošta 1000', a3.postalZone === '1000');
check('3 deli: kraj z državo', a3.city === 'Ljubljana, Slovenija');

console.log('\n── eslogMathIssues (iskrna vrata) ──');
check('čist račun → 0 težav', eslogMathIssues(BASE).length === 0);
{
  const noItems = { ...BASE, items: [] };
  const iss = eslogMathIssues(noItems);
  // Poleg BR-16 tudi neskladje vsot (0 vs 1854) — oboje je prav, da javi
  check('brez postavk → BR-16 težava', iss.some((s) => s.includes('BR-16')));
  check('brez postavk → tudi vsota postavk', iss.some((s) => s.includes('Vsota postavk')));
}
{
  const badLine = { ...BASE, items: [{ ...items[0], total: 999 }] };
  const iss = eslogMathIssues(badLine);
  check('vrstica ≠ količina×cena → težava z 999', iss.some((s) => s.includes('999')));
}
{
  const badSum = { ...BASE, subtotal: 1855 };
  const iss = eslogMathIssues(badSum);
  check('vsota postavk ≠ osnova', iss.some((s) => s.includes('Vsota postavk')));
}
{
  const badVat = { ...BASE, vatAmount: 400 };
  const iss = eslogMathIssues(badVat);
  check('DDV ne ustreza osnovi', iss.some((s) => s.includes('DDV')));
}
{
  const badTotal = { ...BASE, total: 2300 };
  const iss = eslogMathIssues(badTotal);
  check('skupaj ne ustreza osnova+DDV', iss.some((s) => s.includes('Skupaj')));
}
{
  const noSeller = { ...BASE, seller: { ...SELLER, name: '', address: '', taxNumber: '12' } };
  const iss = eslogMathIssues(noSeller);
  check('manjkajoči izdajatelj: 3 težave', iss.length === 3, JSON.stringify(iss));
}
{
  const qty0 = { ...BASE, items: [{ ...items[0], quantity: 0 }] };
  const iss = eslogMathIssues(qty0);
  check('količina 0 → težava', iss.some((s) => s.includes('količina')));
}
{
  const negPrice = { ...BASE, items: [{ ...items[0], unitPrice: -5 }] };
  const iss = eslogMathIssues(negPrice);
  check('negativna cena → težava', iss.some((s) => s.includes('negativna')));
}
// OKVIR ± 0,01 €
{
  const tol = { ...BASE, total: 2261.885 }; // 0,005 razlike — okvir zajame
  check('odstopanje ≤ 0,01 okvir', eslogMathIssues(tol).length === 0);
}

console.log('\n── eslogWarnings (neblokirajoča) ──');
check('polni prodajalec → brez opozoril', eslogWarnings(BASE).length === 0);
{
  const noIban = { ...BASE, seller: { ...SELLER, iban: '' } };
  const w = eslogWarnings(noIban);
  check('brez IBAN → 1 opozorilo o plačilu', w.length === 1 && w[0].includes('IBAN'));
}
{
  const noBuyerAddr = { ...BASE, buyer: { name: 'Stranka' } };
  const w = eslogWarnings(noBuyerAddr);
  check('brez naslova kupca → 1 opozorilo o SI', w.length === 1 && w[0].includes('SI'));
}
{
  const both = { ...BASE, seller: { ...SELLER, iban: '' }, buyer: { name: 'Stranka' } };
  check('oboje → 2 opozorili', eslogWarnings(both).length === 2);
}

console.log('\n── buildEslogXml (struktura + ročna resnica) ──');
{
  const { xml, warnings } = buildEslogXml(BASE);
  check('brez opozoril za polni račun', warnings.length === 0);
  check('XML deklaracija', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check('UBL root ns', xml.includes('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));
  check('cac ns', xml.includes('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"'));
  check('cbc ns', xml.includes('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'));
  check('CustomizationID EN 16931', xml.includes(`<cbc:CustomizationID>${ESLOG_CUSTOMIZATION_ID}</cbc:CustomizationID>`));
  check('ID', xml.includes('<cbc:ID>RAC-2026-001</cbc:ID>'));
  check('IssueDate', xml.includes('<cbc:IssueDate>2026-10-14</cbc:IssueDate>'));
  check('DueDate', xml.includes('<cbc:DueDate>2026-11-13</cbc:DueDate>'));
  check('TypeCode 380', xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>'));
  check('Note s ponudbo', xml.includes('<cbc:Note>Sklic na ponudbo PON-2026-001</cbc:Note>'));
  check('EUR', xml.includes('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>'));
  check('BuyerReference', xml.includes('<cbc:BuyerReference>PON-2026-001</cbc:BuyerReference>'));
  check('izdajatelj ime', xml.includes('<cbc:Name>Obrt Test s.p.</cbc:Name>'));
  check('izdajatelj ulica', xml.includes('<cbc:StreetName>Ulica 14</cbc:StreetName>'));
  check('izdajatelj kraj', xml.includes('<cbc:CityName>Ljubljana</cbc:CityName>'));
  check('izdajatelj pošta', xml.includes('<cbc:PostalZone>1000</cbc:PostalZone>'));
  check('država SI', xml.includes('<cbc:IdentificationCode>SI</cbc:IdentificationCode>'));
  check('davčni ID SI12345678', xml.includes('<cbc:CompanyID>SI12345678</cbc:CompanyID>'));
  check('kupec ime', xml.includes('<cbc:Name>Stranka d.o.o.</cbc:Name>'));
  check('kupec kraj', xml.includes('<cbc:CityName>Maribor</cbc:CityName>'));
  check('plačilo koda 30', xml.includes('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>'));
  check('PaymentID = št. računa', xml.includes('<cbc:PaymentID>RAC-2026-001</cbc:PaymentID>'));
  check('IBAN (brez presledkov?) — zapisan kot vnesen', xml.includes('<cbc:ID>SI56 0510 0801 0555 555</cbc:ID>'));
  check('rok v PaymentTerms', xml.includes('<cbc:Note>Rok plačila: 13. 11. 2026</cbc:Note>'));
  // DDV: ročna resnica 407,88
  check('TaxAmount 407.88', xml.includes('currencyID="EUR">407.88</cbc:TaxAmount>'));
  check('TaxableAmount 1854.00', xml.includes('currencyID="EUR">1854.00</cbc:TaxableAmount>'));
  check('DDV kategorija S 22', xml.includes('<cbc:ID>S</cbc:ID>') && xml.includes('<cbc:Percent>22</cbc:Percent>'));
  // LegalMonetaryTotal: ročna resnica
  check('LineExtensionAmount 1854.00', xml.includes('<cbc:LineExtensionAmount currencyID="EUR">1854.00</cbc:LineExtensionAmount>'));
  check('TaxExclusiveAmount 1854.00', xml.includes('<cbc:TaxExclusiveAmount currencyID="EUR">1854.00</cbc:TaxExclusiveAmount>'));
  check('TaxInclusiveAmount 2261.88', xml.includes('<cbc:TaxInclusiveAmount currencyID="EUR">2261.88</cbc:TaxInclusiveAmount>'));
  check('PayableAmount 2261.88', xml.includes('<cbc:PayableAmount currencyID="EUR">2261.88</cbc:PayableAmount>'));
  // Vrstice: 2, ID 1 in 2, enote MTR/C62, zneski
  check('2 vrstici', (xml.match(/<cac:InvoiceLine>/g) ?? []).length === 2);
  check('vrstica 1 MTR', xml.includes('<cbc:InvoicedQuantity unitCode="MTR">12</cbc:InvoicedQuantity>'));
  check('vrstica 2 C62', xml.includes('<cbc:InvoicedQuantity unitCode="C62">3</cbc:InvoicedQuantity>'));
  check('vrstica 1 znesek 1740.00', xml.includes('currencyID="EUR">1740.00</cbc:LineExtensionAmount>'));
  check('vrstica 2 znesek 114.00', xml.includes('currencyID="EUR">114.00</cbc:LineExtensionAmount>'));
  check('cena 145.00', xml.includes('currencyID="EUR">145.00</cbc:PriceAmount>'));
  check('Description pred Name (UBL vrstni red)', xml.indexOf('<cbc:Description>Eloksirana</cbc:Description>') < xml.indexOf('<cbc:Name>Aluminijasta ograja</cbc:Name>'));
  check('brez praznega Description', !xml.includes('<cbc:Description></cbc:Description>'));
  check('brez XML komentarjev pri čistem', !xml.includes('<!-- OPOZORILO'));
}
{
  const { xml } = buildEslogXml({
    ...BASE,
    buyer: { name: 'Stranka <Nemčija> & "Sinovi"' },
    seller: { ...SELLER, iban: '' },
  });
  check('kupec ubežen', xml.includes('<cbc:Name>Stranka &lt;Nemčija&gt; &amp; &quot;Sinovi&quot;</cbc:Name>'));
  check('opozorilo IBAN kot komentar', xml.includes('<!-- OPOZORILO: Manjka IBAN'));
  check('brez naslova kupca → samo država', !xml.includes('<cbc:CityName>Maribor</cbc:CityName>'));
}
{
  // brez dueDate: brez DueDate in PaymentTerms
  const { xml } = buildEslogXml({ ...BASE, dueDate: null });
  check('brez dueDate: ni DueDate', !xml.includes('<cbc:DueDate>'));
  check('brez dueDate: ni PaymentTerms', !xml.includes('<cac:PaymentTerms>'));
}

console.log('\n── eslogFilename ──');
check('RAC-2026-001 → RAC-2026-001-eslog.xml', eslogFilename('RAC-2026-001') === 'RAC-2026-001-eslog.xml');
check('nevarni znaki → podčrtaj', eslogFilename('RAC/2026 1') === 'RAC_2026_1-eslog.xml');

console.log(`\n${passed} prešlo, ${failed} padlo`);
if (failed > 0) process.exit(1);
