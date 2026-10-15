// ─── E-račun (e-SLOG / EN 16931, sintaksa UBL 2.1) ──────────
// Raziskava 2026 (živi viri, vse preverjeno):
// - ZIERDED (Državni zbor RS, 23. 11. 2025): izmenjava e-računov med
//   podjetji (B2B) postane OBVEZNA 1. 1. 2028; za proračunske uporabnike
//   (B2G) že zdaj prek enotne vstopne točke UJP.
// - Format: e-SLOG 2.x = evropski standard EN 16931 v sintaksi UBL 2.1
//   (evropska komisija: "Slovenia employs the e-SLOG standard ... to
//   comply with EN 16931").
// - Struktura UBL računa (vrstni red elementov po XSD in živem primeru):
//   CustomizationID, ID, IssueDate, DueDate, InvoiceTypeCode 380
//   (standardni komercialni račun), Note, DocumentCurrencyCode EUR,
//   BuyerReference, AccountingSupplierParty, AccountingCustomerParty,
//   PaymentMeans (30 = nakazilo), PaymentTerms, TaxTotal (TaxSubtotal
//   po stopnji), LegalMonetaryTotal, InvoiceLine (InvoicedQuantity
//   unitCode, LineExtensionAmount, Item [Description, Name,
//   ClassifiedTaxCategory S/%], Price).
// - CustomizationID za EN 16931: urn:cen.eu:en16931:2017 (Peppol BIS je
//   razširitev: ...#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0).
// - Enote: UN/ECE Rec 20 — preverjeno na Peppol seznamu kod: MTR = meter,
//   MTK = m², MTQ = m³, HUR = ura, KGM = kg, SET = komplet, C62 = kos/enota.
//   Neznana enota → C62 (iskren generičen fallback).
// - Pogodba iskrenosti: aplikacija le IZVOZI datoteko — oddaja (UJP,
//   Peppol) poteka zunaj. Račun z matematično neskladnjo (vsota vrstic,
//   DDV, skupaj) se NE izvozi (gate eslogMathIssues). Neznane ali
//   manjkajoče neobvezne podatke ne izmišljujemo — opozorilo v XML
//   komentarju.

export const ESLOG_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017';
export const ESLOG_INVOICE_TYPE_CODE = '380';
export const ESLOG_CURRENCY = 'EUR';

export interface EslogSeller {
  /** Ime podjetja (Settings.companyName). */
  name: string;
  /** Naslov (Settings.address). */
  address: string;
  /** Davčna številka (Settings.taxNumber) — 8 števk ali SI + 8. */
  taxNumber: string;
  /** IBAN (opcijsko — ko manjka, XML dobi opozorilni komentar). */
  iban?: string;
}

export interface EslogBuyer {
  name: string;
  /** Naslov kupca (ponudba customerAddress) — opcijsko. */
  address?: string;
}

export interface EslogItem {
  name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  /** Znesek vrstice kot v bazi (kontrolira se proti quantity × unitPrice). */
  total: number;
}

export interface EslogInvoiceInput {
  number: string;
  issueDate: Date;
  dueDate?: Date | null;
  /** Številka sprejete ponudbe — gre v BuyerReference in Note. */
  offerNumber: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  seller: EslogSeller;
  buyer: EslogBuyer;
  items: EslogItem[];
}

export interface EslogBuildResult {
  xml: string;
  /** Neblokirajoča opozorila (tudi kot XML komentar na vrhu datoteke). */
  warnings: string[];
}

// ─── Pomožne (čiste) funkcije ───────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

/** XML escape: & < > " ' + odstrani kontrolne znake (pusti \n\t). */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Datum v UBL obliki YYYY-MM-DD (UTC deli shranjenega trenutka). */
export function eslogDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Slovenščina za PaymentTerms/Note: 13. 11. 2026. */
export function eslogDateSl(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${day}. ${m}. ${y}`;
}

/** Znesek v UBL obliki: točka kot decimale, 2 decimalni mesti. */
export function eslogMoney(n: number): string {
  return n.toFixed(2);
}

/** Stopnja DDV: cela števila brez decimal (22), sicer do 2 dec (9.5). */
export function eslogPercent(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(r2(rate));
}

/** Količina: cela števila kot niz, sicer do 3 decimalne brez odvečnih ničel. */
export function eslogQuantity(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(3);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

const UNIT_MAP: Record<string, string> = {
  m: 'MTR',
  'm²': 'MTK',
  'm3': 'MTQ',
  'm³': 'MTQ',
  ura: 'HUR',
  kg: 'KGM',
  komplet: 'SET',
  kos: 'C62',
};

/**
 * Naša enota → UN/ECE Rec 20 koda. Neznana enota → C62 (one/unit,
 * generično in pošteno — količina ostane pravilna).
 */
export function unitToRec20(unit: string): string {
  const key = unit.trim().toLowerCase();
  if (UNIT_MAP[key]) return UNIT_MAP[key];
  return 'C62';
}

/**
 * Davčna številka → oblika SI######## (slovenski identifikator za DDV).
 * Sprejme "12345678", "SI12345678", "SI 12345678". Napačna dolžina → null.
 */
export function sloTaxIdentifier(taxNumber: string): string | null {
  const t = taxNumber.trim().toUpperCase();
  const digits = t.startsWith('SI') ? t.slice(2) : t;
  const clean = digits.replace(/[\s-]/g, '');
  if (!/^\d{8}$/.test(clean)) return null;
  return `SI${clean}`;
}

export interface SplitAddress {
  street: string;
  city: string;
  postalZone: string;
}

/**
 * Naš naslov je ena vrstica ("Ulica 14, 1000 Ljubljana"). Razčleni:
 * 1. del = ulica, zadnji "NNNN Ime" → poštna številka + kraj.
 * Neuspeh → city = preostanek, postalZone = '' (nič ne izmišljujemo).
 */
export function splitAddress(addr: string): SplitAddress {
  const parts = addr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const street = parts[0] ?? '';
  const rest = parts.slice(1).join(', ');
  const m = rest.match(/^(\d{4})\s+(.+)$/);
  if (m) return { street, city: m[2], postalZone: m[1] };
  return { street, city: rest, postalZone: '' };
}

// ─── Iskrna vrata: matematična skladnost ────────────────────

/**
 * Preveri skladnost računa. PRAZEN seznam = izvoz dovoljen.
 * Vsaka težava = razlog, zakaj e-računa NE pišemo (ne smemo izdati
 * e-računa, ki ga računovodja zavrže zaradi neskladnih zneskov).
 */
export function eslogMathIssues(input: EslogInvoiceInput): string[] {
  const issues: string[] = [];

  if (input.items.length === 0) {
    issues.push('Račun nima postavk — e-račun zahteva vsaj eno vrstico (BR-16).');
  }

  if (!input.seller.name.trim()) {
    issues.push('Manjka ime izdajatelja — dopolni v Nastavitvah.');
  }
  if (!input.seller.address.trim()) {
    issues.push('Manjka naslov izdajatelja — e-račun ga zahteva. Dopolni v Nastavitvah.');
  }
  if (!sloTaxIdentifier(input.seller.taxNumber)) {
    issues.push('Davčna številka izdajatelja ni veljavna (pričakovano 8 števk).');
  }
  if (!input.buyer.name.trim()) {
    issues.push('Manjka ime kupca.');
  }

  input.items.forEach((it, i) => {
    const n = i + 1;
    if (!it.name.trim()) issues.push(`Postavka ${n}: manjka ime.`);
    if (!(it.quantity > 0)) issues.push(`Postavka ${n}: količina mora biti večja od 0.`);
    if (it.unitPrice < 0) issues.push(`Postavka ${n}: cena je negativna.`);
    if (Math.abs(r2(it.quantity * it.unitPrice) - r2(it.total)) > 0.01) {
      issues.push(
        `Postavka ${n}: znesek vrstice (${eslogMoney(it.total)} €) ni količina × cena (${eslogMoney(r2(it.quantity * it.unitPrice))} €).`,
      );
    }
  });

  const lineSum = r2(input.items.reduce((s, it) => s + it.total, 0));
  const subtotal = r2(input.subtotal);
  if (Math.abs(lineSum - subtotal) > 0.01) {
    issues.push(
      `Vsota postavk (${eslogMoney(lineSum)} €) se ne ujema z osnovo za DDV (${eslogMoney(subtotal)} €).`,
    );
  }

  const expectedVat = r2((subtotal * input.vatRate) / 100);
  if (Math.abs(expectedVat - r2(input.vatAmount)) > 0.01) {
    issues.push(
      `DDV (${eslogMoney(input.vatAmount)} €) se ne ujema z osnovo × stopnja (${eslogMoney(expectedVat)} €).`,
    );
  }

  const expectedTotal = r2(subtotal + r2(input.vatAmount));
  if (Math.abs(expectedTotal - r2(input.total)) > 0.01) {
    issues.push(
      `Skupaj (${eslogMoney(input.total)} €) se ne ujema z osnova + DDV (${eslogMoney(expectedTotal)} €).`,
    );
  }

  return issues;
}

/** Neblokirajoča opozorila (grejo tudi kot XML komentar na vrh). */
export function eslogWarnings(input: EslogInvoiceInput): string[] {
  const warnings: string[] = [];
  if (!input.seller.iban?.trim()) {
    warnings.push('Manjka IBAN izdajatelja — e-račun je brez podatka za plačilo (dopolni v Nastavitvah).');
  }
  if (!input.buyer.address?.trim()) {
    warnings.push('Kupec nima naslova — navedena je država SI (ZIERDED velja za domače poslovanje).');
  }
  return warnings;
}

// ─── Gradnja XML ────────────────────────────────────────────

function buyerAddressBlock(address: string | undefined, indent: string): string {
  // Brez naslova: samo država SI (iskren privzeti, opozorilo gre v komentar).
  if (!address?.trim()) {
    return `${indent}<cac:PostalAddress>\n${indent}  <cac:Country>\n${indent}    <cbc:IdentificationCode>SI</cbc:IdentificationCode>\n${indent}  </cac:Country>\n${indent}</cac:PostalAddress>\n`;
  }
  const a = splitAddress(address);
  const lines: string[] = [];
  if (a.street) lines.push(`${indent}  <cbc:StreetName>${escapeXml(a.street)}</cbc:StreetName>`);
  if (a.city) lines.push(`${indent}  <cbc:CityName>${escapeXml(a.city)}</cbc:CityName>`);
  if (a.postalZone) lines.push(`${indent}  <cbc:PostalZone>${escapeXml(a.postalZone)}</cbc:PostalZone>`);
  lines.push(
    `${indent}  <cac:Country>\n${indent}    <cbc:IdentificationCode>SI</cbc:IdentificationCode>\n${indent}  </cac:Country>`,
  );
  return `${indent}<cac:PostalAddress>\n${lines.join('\n')}\n${indent}</cac:PostalAddress>\n`;
}

/**
 * Zgradi e-račun XML (UBL 2.1, EN 16931). POKLIČI LE po uspešnem
 * eslogMathIssues (težave ne blokirajo tu — klicatelj zagotavlja čistost).
 */
export function buildEslogXml(input: EslogInvoiceInput): EslogBuildResult {
  const warnings = eslogWarnings(input);
  const taxId = sloTaxIdentifier(input.seller.taxNumber) ?? '';
  const sellerAddr = splitAddress(input.seller.address);
  const money = eslogMoney;

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  for (const w of warnings) {
    out.push(`<!-- OPOZORILO: ${escapeXml(w)} -->`);
  }
  out.push('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
  out.push('         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"');
  out.push('         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">');
  out.push(`  <cbc:CustomizationID>${ESLOG_CUSTOMIZATION_ID}</cbc:CustomizationID>`);
  out.push(`  <cbc:ID>${escapeXml(input.number)}</cbc:ID>`);
  out.push(`  <cbc:IssueDate>${eslogDate(input.issueDate)}</cbc:IssueDate>`);
  if (input.dueDate) {
    out.push(`  <cbc:DueDate>${eslogDate(input.dueDate)}</cbc:DueDate>`);
  }
  out.push(`  <cbc:InvoiceTypeCode>${ESLOG_INVOICE_TYPE_CODE}</cbc:InvoiceTypeCode>`);
  out.push(`  <cbc:Note>Sklic na ponudbo ${escapeXml(input.offerNumber)}</cbc:Note>`);
  out.push(`  <cbc:DocumentCurrencyCode>${ESLOG_CURRENCY}</cbc:DocumentCurrencyCode>`);
  out.push(`  <cbc:BuyerReference>${escapeXml(input.offerNumber)}</cbc:BuyerReference>`);

  // Izdajatelj (BG-4)
  out.push('  <cac:AccountingSupplierParty>');
  out.push('    <cac:Party>');
  out.push('      <cac:PartyName>');
  out.push(`        <cbc:Name>${escapeXml(input.seller.name)}</cbc:Name>`);
  out.push('      </cac:PartyName>');
  out.push('      <cac:PostalAddress>');
  if (sellerAddr.street) {
    out.push(`        <cbc:StreetName>${escapeXml(sellerAddr.street)}</cbc:StreetName>`);
  }
  if (sellerAddr.city) {
    out.push(`        <cbc:CityName>${escapeXml(sellerAddr.city)}</cbc:CityName>`);
  }
  if (sellerAddr.postalZone) {
    out.push(`        <cbc:PostalZone>${escapeXml(sellerAddr.postalZone)}</cbc:PostalZone>`);
  }
  out.push('        <cac:Country>');
  out.push('          <cbc:IdentificationCode>SI</cbc:IdentificationCode>');
  out.push('        </cac:Country>');
  out.push('      </cac:PostalAddress>');
  out.push('      <cac:PartyTaxScheme>');
  out.push(`        <cbc:CompanyID>${escapeXml(taxId)}</cbc:CompanyID>`);
  out.push('        <cac:TaxScheme>');
  out.push('          <cbc:ID>VAT</cbc:ID>');
  out.push('        </cac:TaxScheme>');
  out.push('      </cac:PartyTaxScheme>');
  out.push('    </cac:Party>');
  out.push('  </cac:AccountingSupplierParty>');

  // Kupec (BG-7)
  out.push('  <cac:AccountingCustomerParty>');
  out.push('    <cac:Party>');
  out.push('      <cac:PartyName>');
  out.push(`        <cbc:Name>${escapeXml(input.buyer.name)}</cbc:Name>`);
  out.push('      </cac:PartyName>');
  out.push(buyerAddressBlock(input.buyer.address, '      ').trimEnd());
  out.push('    </cac:Party>');
  out.push('  </cac:AccountingCustomerParty>');

  // Plačilo (nakazilo — koda 30; IBAN samo če obstaja)
  out.push('  <cac:PaymentMeans>');
  out.push('    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
  out.push(`    <cbc:PaymentID>${escapeXml(input.number)}</cbc:PaymentID>`);
  if (input.seller.iban?.trim()) {
    out.push('    <cac:PayeeFinancialAccount>');
    out.push(`      <cbc:ID>${escapeXml(input.seller.iban.trim())}</cbc:ID>`);
    out.push(`      <cbc:Name>${escapeXml(input.seller.name)}</cbc:Name>`);
    out.push('    </cac:PayeeFinancialAccount>');
  }
  out.push('  </cac:PaymentMeans>');

  if (input.dueDate) {
    out.push('  <cac:PaymentTerms>');
    out.push(`    <cbc:Note>Rok plačila: ${eslogDateSl(input.dueDate)}</cbc:Note>`);
    out.push('  </cac:PaymentTerms>');
  }

  // DDV (BG-23)
  out.push('  <cac:TaxTotal>');
  out.push(`    <cbc:TaxAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.vatAmount))}</cbc:TaxAmount>`);
  out.push('    <cac:TaxSubtotal>');
  out.push(`      <cbc:TaxableAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.subtotal))}</cbc:TaxableAmount>`);
  out.push(`      <cbc:TaxAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.vatAmount))}</cbc:TaxAmount>`);
  out.push('      <cac:TaxCategory>');
  out.push('        <cbc:ID>S</cbc:ID>');
  out.push(`        <cbc:Percent>${eslogPercent(input.vatRate)}</cbc:Percent>`);
  out.push('        <cac:TaxScheme>');
  out.push('          <cbc:ID>VAT</cbc:ID>');
  out.push('        </cac:TaxScheme>');
  out.push('      </cac:TaxCategory>');
  out.push('    </cac:TaxSubtotal>');
  out.push('  </cac:TaxTotal>');

  // Skupne vsote (BG-22) — matematična skladnost je obvezna (EN 16931)
  const lineSum = r2(input.items.reduce((s, it) => s + it.total, 0));
  out.push('  <cac:LegalMonetaryTotal>');
  out.push(`    <cbc:LineExtensionAmount currencyID="${ESLOG_CURRENCY}">${money(lineSum)}</cbc:LineExtensionAmount>`);
  out.push(`    <cbc:TaxExclusiveAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.subtotal))}</cbc:TaxExclusiveAmount>`);
  out.push(`    <cbc:TaxInclusiveAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.total))}</cbc:TaxInclusiveAmount>`);
  out.push(`    <cbc:PayableAmount currencyID="${ESLOG_CURRENCY}">${money(r2(input.total))}</cbc:PayableAmount>`);
  out.push('  </cac:LegalMonetaryTotal>');

  // Vrstice (BG-25) — po sortOrder
  input.items.forEach((it, i) => {
    const n = i + 1;
    out.push('  <cac:InvoiceLine>');
    out.push(`    <cbc:ID>${n}</cbc:ID>`);
    out.push(`    <cbc:InvoicedQuantity unitCode="${unitToRec20(it.unit)}">${eslogQuantity(it.quantity)}</cbc:InvoicedQuantity>`);
    out.push(`    <cbc:LineExtensionAmount currencyID="${ESLOG_CURRENCY}">${money(r2(it.total))}</cbc:LineExtensionAmount>`);
    out.push('    <cac:Item>');
    if (it.description?.trim()) {
      out.push(`      <cbc:Description>${escapeXml(it.description.trim())}</cbc:Description>`);
    }
    out.push(`      <cbc:Name>${escapeXml(it.name)}</cbc:Name>`);
    out.push('      <cac:ClassifiedTaxCategory>');
    out.push('        <cbc:ID>S</cbc:ID>');
    out.push(`        <cbc:Percent>${eslogPercent(input.vatRate)}</cbc:Percent>`);
    out.push('        <cac:TaxScheme>');
    out.push('          <cbc:ID>VAT</cbc:ID>');
    out.push('        </cac:TaxScheme>');
    out.push('      </cac:ClassifiedTaxCategory>');
    out.push('    </cac:Item>');
    out.push('    <cac:Price>');
    out.push(`      <cbc:PriceAmount currencyID="${ESLOG_CURRENCY}">${money(r2(it.unitPrice))}</cbc:PriceAmount>`);
    out.push('    </cac:Price>');
    out.push('  </cac:InvoiceLine>');
  });

  out.push('</Invoice>');
  return { xml: out.join('\n') + '\n', warnings };
}

/** Ime datoteke: RAC-2026-001-eslog.xml. */
export function eslogFilename(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${safe}-eslog.xml`;
}
