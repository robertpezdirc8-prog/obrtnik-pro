import type { OfferDTO, SettingsDTO } from './types';
import { formatEUR, formatNum } from './format';
import { validUntil } from './pdf';
import { readSettings, settingsProblemShort, settingsWindowHint } from './settings-inputs';

// ─── Pisarniški dokumenti — čiste tekstovne skripte ─────────
// Raziskava (r/BathroomRemodeling »estimate ghosting«, clearstory,
// Joist, data.si o garancijskih listih): obrtniki potrebujejo
// hitro besedilo, ki ga pošljejo po WhatsApp/SMS brez tipkanja,
// dokumentiran change order (dodatno delo) in zapisnik o predaji.
// Vse je deterministična sestava iz podatkov ponudbe in nastavitev.

const nf = (n: number) => formatNum(n, 2);

/** Kratek povzetek ponudbe za SMS / WhatsApp / Viber.
 *  Stranka na en pogled vidi obseg, ceno, veljavnost in akontacijo.
 *
 *  Task 86: ta skript je bil ČETRTI bralec `depositPercent` in je imel SVOJ
 *  privzetek 30 %, medtem ko sta oba PDF-ja imela svojega (0 %); odstotek je
 *  tudi usekal na celota. Zdaj bere istega `readSettings` kot dokumenti — če
 *  vnosa ni ali je zunaj okna, vrstica to pove z VPISANO vrednostjo, ne z
 *  izmišljeno. */
export function buildOfferShareText(offer: OfferDTO, settings: SettingsDTO): string {
  const items = offer.items
    .map((i, n) => `${n + 1}. ${i.name} — ${formatNum(i.quantity)} ${i.unit} × ${formatNum(i.unitPrice)} € = ${formatNum(i.total)} €`)
    .join('\n');

  const s = readSettings(settings);
  const veljava = s.quoteValidDays;
  const capara = s.depositPercent;
  const lines: string[] = [
    `PONUDBA ${offer.number} — ${settings.companyName}`,
    `Stranka: ${offer.customerName}`,
    '',
    items,
    '',
    `Skupaj brez DDV: ${formatNum(offer.subtotal)} €`,
    `DDV ${formatNum(offer.vatRate)} %: ${formatNum(offer.vatAmount)} €`,
    `SKUPAJ Z DDV: ${formatNum(offer.total)} €`,
    veljava.problem
      ? `Velja do: — (${settingsProblemShort(veljava.problem)}; ${settingsWindowHint('quoteValidDays')})`
      : `Velja do: ${validUntil(offer.createdAt, veljava.value) ?? '—'}`,
  ];
  if (capara.problem) {
    lines.push(`Akontacija: ni izračunana (${settingsProblemShort(capara.problem)}; ${settingsWindowHint('depositPercent')}).`);
  } else if (capara.value > 0) {
    const deposit = offer.total * (capara.value / 100);
    lines.push(`Akontacija ${nf(capara.value)} %: ${formatNum(deposit)} € ob naročilu, ostanek po zaključku.`);
  }
  if (settings.iban) {
    lines.push(`IBAN: ${settings.iban}`);
  }
  lines.push('', 'Odgovorite »DA« in termin potrdimo.');
  return lines.join('\n');
}

export interface ChangeOrderData {
  /** Št. dokumenta, npr. "2026-001-D2". */
  docNumber: string;
  offerNumber: string;
  customerName: string;
  objectAddress?: string | null;
  description: string;
  /** Vrednost brez DDV. */
  amount: number;
  vatRate: number;
  dateIso: string;
  companyName: string;
}

/** Številčenje dodatnih del je deterministično: št. ponudbe + zaporedna
 *  številka dodatnega dela (clearstory: brez št. dokumenta change order
 *  izgine v papirjih). */
export function changeOrderNumber(offerNumber: string, count: number): string {
  return `${offerNumber}-D${count + 1}`;
}

/** Samo datum (brez ura) — za dokumente. */
const fmtDay = (iso: string): string => {
  const t = new Date(iso).getTime();
  return new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(Number.isFinite(t) ? t : Date.now()),
  );
};

/** Potrdilo dodatnega dela (change order / COR) — stranka s podpisom
 *  potrdi obseg in ceno, sicer gre v spor (raziskava: scope creep). */
export function buildChangeOrderText(d: ChangeOrderData): string {
  const vat = d.amount * (d.vatRate / 100);
  const total = d.amount + vat;
  return [
    `DODATNO DELO št. ${d.docNumber}`,
    `k ponudbi ${d.offerNumber}`,
    `Datum: ${fmtDay(d.dateIso)}`,
    `Stranka: ${d.customerName}`,
    d.objectAddress ? `Objekt: ${d.objectAddress}` : '',
    '',
    `Opis dodatnega dela:`,
    d.description.trim(),
    '',
    `Vrednost dela (brez DDV): ${formatNum(d.amount)} €`,
    `DDV ${formatNum(d.vatRate)} %: ${formatNum(vat)} €`,
    `SKUPAJ: ${formatNum(total)} €`,
    '',
    'Stranka s podpisom potrjuje obseg in ceno dodatnega dela. Delo se izvede po zaključku osnovnega obsega (ali po dogovoru).',
    '',
    `${d.companyName}                          Stranka:`,
    `______________________                ______________________`,
  ].filter((l) => l !== '').join('\n');
}

export interface HandoverData {
  companyName: string;
  ownerName: string;
  taxNumber?: string | null;
  offerNumber: string;
  customerName: string;
  customerPhone?: string | null;
  objectAddress?: string | null;
  /** Imena predanih postavk. */
  itemNames: string[];
  dateIso: string;
  /** Garancija na delo v mesecih. */
  warrantyMonths: number;
  /** Št. fotografij izvedenega stanja (0 = ni). */
  photoCount: number;
  notes?: string;
}

/** Zapisnik o predaji in prevzemu dela (garancijski zapis).
 *  Zahtevani podatki garancijskega lista (data.si): dajalec garancije,
 *  datum, doba garancije + seznam predanega. */
export function buildHandoverDoc(d: HandoverData): string {
  const items = d.itemNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n');
  const tax = d.taxNumber ? ` · davčna št. ${d.taxNumber}` : '';
  return [
    'ZAPISNIK O PREDAJI IN PREVZEMU DELA',
    'Garancijski zapis',
    '',
    `Datum predaje: ${fmtDay(d.dateIso)}`,
    '',
    `Ponudnik: ${d.companyName}${tax}`,
    `Stranka: ${d.customerName}${d.customerPhone ? ` · tel. ${d.customerPhone}` : ''}`,
    d.objectAddress ? `Objekt: ${d.objectAddress}` : '',
    `Dokumentacija: ponudba ${d.offerNumber}`,
    '',
    'PREDANO DELO:',
    items || '  (brez postavk)',
    '',
    d.photoCount > 0
      ? `Fotografska dokumentacija: ${d.photoCount} fotografij izvedenega stanja (arhiv ponudnika).`
      : 'Fotografska dokumentacija: na zahtevo stranke.',
    '',
    `Garancija na delo: ${d.warrantyMonths} mesecev od dneva predaje.`,
    'Garancija na material: veljajo garancijski pogoji proizvajalcev.',
    'Garancija ne velja za poškodbe iz neustrezne uporabe, mehanskih poškodb ali neustreznega vzdrževanja.',
    d.notes?.trim() ? `\nOpombe ob predaji: ${d.notes.trim()}` : '',
    '',
    'Delo je bilo predano in prevzeto:',
    '',
    `${d.ownerName || d.companyName} (ponudnik)          Stranka:`,
    `______________________                ______________________`,
  ].filter((l) => l !== '').join('\n');
}
