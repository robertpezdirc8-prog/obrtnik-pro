import type { InvoiceDTO, OfferDTO, SettingsDTO } from './types';
import { formatDate, formatNum } from './format';
import type { HandoverData } from './paperwork';
import { buildHandoverDoc } from './paperwork';
import { readSettings, settingsProblemText, type SettingReading } from './settings-inputs';

// ─── Tiskalni prikaz ponudbe (odpre okno → shrani kot PDF) ──

const nf = (n: number) => formatNum(n, 2);

/**
 * Vsi trditveni podatki na dokumentih (veljavnost, akontacija, rok plačila)
 * pridejo iz `readSettings` — iz istega registra kot zaslon urejevalnika in
 * strežnik. Dokument sme ob napačnem vnosu izpustiti SAMO to vrsto in mora
 * povedati zakaj; vpisane številke pa NE sme popraviti (isti razred napake kot
 * pri kalkulatorjih, Task 83–85: `Math.floor` in `|| 15` sta iz 33,7 % naredila
 * 33 %, iz 0 dni pa 15 dni).
 */

/** Datum poteka veljavnosti = datum izdaje + quoteValidDays dni.
 *  Število dni je vpisano dobesedno: brez `Math.floor` in brez tihega 15.
 *  `null` = vnos ni veljaven, zato dokument vrste ne more izračunati. */
export function validUntil(createdAtIso: string, validDays: number): string | null {
  if (!Number.isFinite(validDays)) return null;
  const t = new Date(createdAtIso).getTime();
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + validDays * 86_400_000);
  return new Intl.DateTimeFormat('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildOfferHTML(offer: OfferDTO, settings: SettingsDTO): string {
  const s = readSettings(settings);
  const veljava = s.quoteValidDays;
  const rows = offer.items
    .map(
      (item, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>
          <strong>${esc(item.name)}</strong>
          ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ''}
        </td>
        <td class="r">${formatNum(item.quantity)} ${esc(item.unit)}</td>
        <td class="r">${formatNum(item.unitPrice)} €</td>
        <td class="r"><strong>${formatNum(item.total)} €</strong></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Ponudba ${esc(offer.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #292524; margin: 0; padding: 32px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #a16207; padding-bottom: 16px; margin-bottom: 24px; }
  .company h1 { margin: 0 0 4px; font-size: 20px; color: #854d0e; }
  .company p { margin: 2px 0; color: #57534e; }
  .offer-meta { text-align: right; }
  .offer-meta .num { font-size: 22px; font-weight: 700; color: #854d0e; }
  .offer-meta p { margin: 2px 0; color: #57534e; }
  h2 { font-size: 14px; color: #854d0e; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px; }
  .parties { display: flex; gap: 24px; margin-bottom: 8px; }
  .parties > div { flex: 1; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px 14px; }
  .parties p { margin: 3px 0; }
  .label { font-size: 10px; text-transform: uppercase; color: #a8a29e; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #854d0e; color: #fff; text-align: left; padding: 8px 10px; font-size: 12px; }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; width: 32px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
  tr:nth-child(even) td { background: #fafaf9; }
  .desc { color: #78716c; font-size: 11px; margin-top: 2px; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals table { width: 320px; }
  .totals td { padding: 6px 10px; }
  .totals .grand td { background: #fef3c7; font-weight: 700; font-size: 15px; color: #854d0e; border-top: 2px solid #a16207; }
  .note { background: #fefce8; border-left: 3px solid #d97706; padding: 10px 14px; border-radius: 0 6px 6px 0; margin-top: 12px; color: #44403c; }
  .foot { margin-top: 32px; display: flex; justify-content: space-between; color: #78716c; font-size: 11px; border-top: 1px solid #e7e5e4; padding-top: 12px; }
  .sig { margin-top: 40px; display: flex; justify-content: space-between; }
  .sig div { width: 45%; text-align: center; }
  .sig .line { border-top: 1px solid #a8a29e; margin-top: 48px; padding-top: 6px; color: #57534e; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="head">
    <div class="company">
      <h1>${esc(settings.companyName)}</h1>
      ${settings.address ? `<p>${esc(settings.address)}</p>` : ''}
      ${settings.phone || settings.email ? `<p>${[settings.phone, settings.email].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${settings.taxNumber ? `<p>Davčna št.: ${esc(settings.taxNumber)}</p>` : ''}
    </div>
    <div class="offer-meta">
      <div class="num">PONUDBA ${esc(offer.number)}</div>
      <p>Datum: ${formatDate(offer.createdAt)}</p>
      <p>Velja do: ${veljava.problem ? '— (razlog je zapisan spodaj)' : validUntil(offer.createdAt, veljava.value) ?? '—'}</p>
      <p>Status: ${offer.status === 'draft' ? 'Osnutek' : offer.status === 'sent' ? 'Poslana' : offer.status === 'accepted' ? 'Sprejeta' : 'Zavrnjena'}</p>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="label">Stranka</div>
      <p><strong>${esc(offer.customerName)}</strong></p>
      ${offer.customerAddress ? `<p>${esc(offer.customerAddress)}</p>` : ''}
      ${offer.customerPhone ? `<p>Tel.: ${esc(offer.customerPhone)}</p>` : ''}
      ${offer.customerEmail ? `<p>${esc(offer.customerEmail)}</p>` : ''}
    </div>
    <div>
      <div class="label">Objekt / lokacija dela</div>
      <p>${offer.objectAddress ? esc(offer.objectAddress) : '—'}</p>
      ${settings.iban ? `<p style="margin-top:8px">IBAN: ${esc(settings.iban)}</p>` : ''}
    </div>
  </div>

  <h2>Postavke ponudbe</h2>
  <table>
    <thead>
      <tr><th class="c">Št.</th><th>Opis</th><th class="r">Količina</th><th class="r">Cena/en.</th><th class="r">Vrednost</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Plačljiva vrednost (brez DDV)</td><td class="r">${formatNum(offer.subtotal)} €</td></tr>
      <tr><td>DDV ${formatNum(offer.vatRate)} %</td><td class="r">${formatNum(offer.vatAmount)} €</td></tr>
      <tr class="grand"><td>SKUPAJ Z DDV</td><td class="r">${formatNum(offer.total)} €</td></tr>
      ${depositRows(offer.total, s.depositPercent)}
    </table>
  </div>

  ${offer.note ? `<div class="note"><strong>Opomba:</strong> ${esc(offer.note)}</div>` : ''}

  <div class="sig">
    <div><div class="line">Ponudnik: ${esc(settings.companyName)}</div></div>
    <div><div class="line">Naročnik: ${esc(offer.customerName)}</div></div>
  </div>

  <div class="foot">
    <span>${veljava.problem
      ? `Veljavnost ni izračunana — ${esc(settingsProblemText(veljava.problem))}`
      : `Ponudba velja ${nf(veljava.value)} dni od datuma izdaje.`}</span>
    <span>Cene so izražene v EUR in vezane na nabavne cene materiala na dan izdaje.</span>
  </div>
</body>
</html>`;
}

/** Akontacijski vrstici v tabeli vsot. Vpisan odstotek se uporabi DOBESEDNO
 *  (brez `Math.floor` in brez lastnega privzetka) — če je zunaj okna vnosa,
 *  dokument izpusti razlog in ne popravljene številke. */
function depositRows(total: number, capara: SettingReading): string {
  if (capara.problem) {
    return `
      <tr><td colspan="2" style="color:#b45309">Akontacija ni izračunana — ${esc(settingsProblemText(capara.problem))}</td></tr>`;
  }
  const pct = capara.value;
  if (pct <= 0 || total <= 0) return '';
  const deposit = total * (pct / 100);
  const rest = total - deposit;
  return `
      <tr><td style="color:#78716c">— od tega akontacija ${nf(pct)} % (ob naročilu)</td><td class="r" style="color:#78716c">${formatNum(deposit)} €</td></tr>
      <tr><td style="color:#78716c">— ostanek po zaključku in prevzemu dela</td><td class="r" style="color:#78716c">${formatNum(rest)} €</td></tr>`;
}

export function openOfferPDF(offer: OfferDTO, settings: SettingsDTO): boolean {
  const html = buildOfferHTML(offer, settings);
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Počakaj, da brskalnik izriše vsebino, potem odpri print dialog
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
  return true;
}

/** Zapisnik o predaji dela — odpre okno za tisk (istega obdobja kot
 *  PDF ponudbe). Vsebino gradi čista funkcija buildHandoverDoc. */
export function openHandoverPrint(offer: OfferDTO, settings: SettingsDTO, opts: {
  dateIso: string; warrantyMonths: number; photoCount: number; notes: string;
}): boolean {
  const data: HandoverData = {
    companyName: settings.companyName,
    ownerName: settings.ownerName,
    taxNumber: settings.taxNumber,
    offerNumber: offer.number,
    customerName: offer.customerName,
    customerPhone: offer.customerPhone,
    objectAddress: offer.objectAddress,
    itemNames: offer.items.map((i) => `${i.name} (${formatNum(i.quantity)} ${i.unit})`),
    dateIso: opts.dateIso,
    warrantyMonths: opts.warrantyMonths,
    photoCount: opts.photoCount,
    notes: opts.notes,
  };
  const text = buildHandoverDoc(data);
  const html = `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Zapisnik o predaji dela — ${offer.number}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #292524; margin: 0; padding: 40px; font-size: 13px; }
  h1 { font-size: 18px; color: #854d0e; margin: 0 0 4px; }
  .sub { color: #78716c; margin: 0 0 20px; }
  pre { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<h1>${settings.companyName}</h1>
<p class="sub">Zapisnik o predaji in prevzemu dela · ponudba ${offer.number}</p>
<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
  return true;
}

// ─── Račun (iz sprejete ponudbe) ────────────────────────────

/** Samo datum (brez ure) — za rok plačila na računu. */
function dayOnly(iso: string): string {
  return new Intl.DateTimeFormat('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(iso));
}

/** Račun gradi iz podatkov računa (server izračuna iz ponudbe) +
 *  podrobnosti ponudbe za referenco in postavke. */
export function buildInvoiceHTML(invoice: InvoiceDTO, offer: OfferDTO | null, settings: SettingsDTO): string {
  const s = readSettings(settings);
  const capara = s.depositPercent;
  /** Rok plačila na računu bere SHRANJENI `dueAt` (strežnik ga dodeli ob
   *  izdaji iz nastavitve), ne pa današnje nastavitve — sicer bi račun,
   *  izdan pred spremembo roka, na papirju trdil drugo kot evidenca terjatev.
   *  Št. dni od izdaje je izračun IZ obeh shranjenih datumov, ne izmislek. */
  const trenutniRok = s.paymentDays;
  const rokDatum = invoice.dueAt ? dayOnly(invoice.dueAt) : null;
  const dniOdIzdaje = invoice.dueAt
    ? Math.round((new Date(invoice.dueAt).getTime() - new Date(invoice.createdAt).getTime()) / 86_400_000)
    : null;
  const akontacijaVrstica = capara.problem
    ? `<p style="color:#b45309">Akontacija ni izračunana — ${esc(settingsProblemText(capara.problem))}</p>`
    : capara.value > 0 && invoice.total > 0
      ? `<p>Akontacija ${nf(capara.value)} % (${formatNum(invoice.total * (capara.value / 100))} €) je že plačana ob naročilu — za plačilo je preostanek ${formatNum(invoice.total - invoice.total * (capara.value / 100))} € (če akontacija ni bila plačana, za plačilo velja celoten znesek).</p>`
      : '';
  const items = (offer?.items ?? [])
    .map(
      (item, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td><strong>${esc(item.name)}</strong>${item.description ? `<div class="desc">${esc(item.description)}</div>` : ''}</td>
        <td class="r">${formatNum(item.quantity)} ${esc(item.unit)}</td>
        <td class="r">${formatNum(item.unitPrice)} €</td>
        <td class="r"><strong>${formatNum(item.total)} €</strong></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Račun ${esc(invoice.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #292524; margin: 0; padding: 32px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #a16207; padding-bottom: 16px; margin-bottom: 24px; }
  .company h1 { margin: 0 0 4px; font-size: 20px; color: #854d0e; }
  .company p { margin: 2px 0; color: #57534e; }
  .meta { text-align: right; }
  .meta .num { font-size: 22px; font-weight: 700; color: #854d0e; }
  .meta p { margin: 2px 0; color: #57534e; }
  h2 { font-size: 14px; color: #854d0e; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px; }
  .parties { display: flex; gap: 24px; margin-bottom: 8px; }
  .parties > div { flex: 1; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px 14px; }
  .parties p { margin: 3px 0; }
  .label { font-size: 10px; text-transform: uppercase; color: #a8a29e; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #854d0e; color: #fff; text-align: left; padding: 8px 10px; font-size: 12px; }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; width: 32px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
  tr:nth-child(even) td { background: #fafaf9; }
  .desc { color: #78716c; font-size: 11px; margin-top: 2px; }
  .pay { background: #fefce8; border-left: 3px solid #d97706; padding: 12px 14px; border-radius: 0 6px 6px 0; margin-top: 16px; color: #44403c; }
  .pay p { margin: 3px 0; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals table { width: 320px; }
  .totals td { padding: 6px 10px; }
  .totals .grand td { background: #fef3c7; font-weight: 700; font-size: 15px; color: #854d0e; border-top: 2px solid #a16207; }
  .foot { margin-top: 32px; color: #78716c; font-size: 11px; border-top: 1px solid #e7e5e4; padding-top: 12px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="head">
    <div class="company">
      <h1>${esc(settings.companyName)}</h1>
      ${settings.address ? `<p>${esc(settings.address)}</p>` : ''}
      ${settings.phone || settings.email ? `<p>${[settings.phone, settings.email].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${settings.taxNumber ? `<p>Davčna št.: ${esc(settings.taxNumber)}</p>` : ''}
    </div>
    <div class="meta">
      <div class="num">RAČUN ${esc(invoice.number)}</div>
      <p>Datum izdaje: ${formatDate(invoice.createdAt)}</p>
      <p>Rok plačila: ${rokDatum ?? '— (razlog je v plačilnih podatkih)'}</p>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="label">Kupec</div>
      <p><strong>${esc(invoice.customerName)}</strong></p>
      ${offer?.customerAddress ? `<p>${esc(offer.customerAddress)}</p>` : ''}
    </div>
    <div>
      <div class="label">Objekt / lokacija</div>
      <p>${offer?.objectAddress ? esc(offer.objectAddress) : '—'}</p>
      <p style="margin-top:8px">Izdano na podlagi ponudbe: <strong>${esc(invoice.offerNumber ?? offer?.number ?? '')}</strong></p>
    </div>
  </div>

  <h2>Postavke računa</h2>
  <table>
    <thead>
      <tr><th class="c">Št.</th><th>Opis</th><th class="r">Količina</th><th class="r">Cena/en.</th><th class="r">Vrednost</th></tr>
    </thead>
    <tbody>${items || `<tr><td colspan="5">Postavke po ponudbi ${esc(invoice.offerNumber ?? '')} — skupna vrednost.</td></tr>`}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Osnova (brez DDV)</td><td class="r">${formatNum(invoice.subtotal)} €</td></tr>
      <tr><td>DDV ${formatNum(invoice.vatRate)} %</td><td class="r">${formatNum(invoice.vatAmount)} €</td></tr>
      <tr class="grand"><td>ZA PLAČILO</td><td class="r">${formatNum(invoice.total)} €</td></tr>
    </table>
  </div>

  <div class="pay">
    <strong>Plačilni podatki</strong>
    ${settings.iban ? `<p>IBAN: <strong>${esc(settings.iban)}</strong></p>` : '<p>IBAN: — (dopolni v nastavitvah)</p>'}
    ${settings.taxNumber ? `<p>Referenca: ${esc(invoice.number)} · Davčna št. izdajatelja: ${esc(settings.taxNumber)}</p>` : ''}
    ${akontacijaVrstica}
    ${rokDatum
      ? `<p>Rok za plačilo: ${rokDatum} (${dniOdIzdaje} dni od izdaje).</p>`
      : `<p style="color:#b45309">Račun nima roka plačila: ob izdaji nastavitev roka (dni) ni bila veljavna, `
        + 'datuma zapadlosti pa nismo izmislili. '
        + (trenutniRok.problem
            ? 'Nastavitev roka plačila je danes prav tako zunaj okna — popravi jo v Nastavitvah in izdaj nov dokument.'
            : `Trenutna nastavitev (${nf(trenutniRok.value)} dni) velja za NOVE račune; tega ne spreminja.`)
        + '</p>'}
  </div>

  <div class="foot">
    Račun je izdan na podlagi sprejete ponudbe ${esc(invoice.offerNumber ?? offer?.number ?? '')}. Ob objavi računa nastane obveznost obračuna DDV (dan dobave blaga / opravljene storitve).
  </div>
</body>
</html>`;
}

export function openInvoicePDF(invoice: InvoiceDTO, offer: OfferDTO | null, settings: SettingsDTO): boolean {
  const html = buildInvoiceHTML(invoice, offer, settings);
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
  return true;
}
