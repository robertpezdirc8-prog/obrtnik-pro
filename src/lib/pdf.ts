import type { OfferDTO, SettingsDTO } from './types';
import { formatDate, formatNum } from './format';

// ─── Tiskalni prikaz ponudbe (odpre okno → shrani kot PDF) ──

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildOfferHTML(offer: OfferDTO, settings: SettingsDTO): string {
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
    </table>
  </div>

  ${offer.note ? `<div class="note"><strong>Opomba:</strong> ${esc(offer.note)}</div>` : ''}

  <div class="sig">
    <div><div class="line">Ponudnik: ${esc(settings.companyName)}</div></div>
    <div><div class="line">Naročnik: ${esc(offer.customerName)}</div></div>
  </div>

  <div class="foot">
    <span>Ponudba je veljavna 30 dni od datuma izdaje.</span>
    <span>Cene so izražene v EUR.</span>
  </div>
</body>
</html>`;
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
