// ─── SPOROČILO ZA MONTERJA (SMS/WhatsApp) iz montažnega lista ─────────────
// Zakaj: monter na terenu dobi ponudbo (PDF) in list (PDF), a v praksi mu
// občasno pride najbolj koristen KRATEK tekst: kaj je, koliko, kje se
// spaja in kaj je treba preveriti. To sporočilo je izključno iz števil, ki
// jih je izračunal `photo-install-sheet.ts` — nič ni izmišljeno in nič ni
// skritega: kar ni izmerjeno, piše PREDLOG.
//
// Format: navadno besedilo (brez HTML, brez tabel) — gre v SMS, WhatsApp
// ali e-pošto, zato vrstice kratke in brez okraskov.

import type { InstallerSheet } from './photo-install-sheet';
import { formatNum } from './format';

export interface InstallerMessageInput {
  sheet: InstallerSheet;
  /** ime obrta (podjetje) */
  obrtnik?: string | null;
  /** objekt / naslov */
  objekt?: string | null;
  /** številka ponudbe, če je ponudba povezana */
  ponudba?: string | null;
}

/** Besedilo sporočila za monterja. */
export function buildInstallerSheetMessage(input: InstallerMessageInput): string {
  const s = input.sheet;
  const lines: string[] = [];

  if (s.blockers.length > 0) {
    lines.push('MONTAŽNI LIST NI IZVEDEN — manjkajo podatki:');
    for (const b of s.blockers) lines.push(`• ${b}`);
    lines.push('Dopolni meritve in zahtevaj nov list.');
    return lines.join('\n');
  }

  lines.push(`MONTAŽNI LIST — ${s.profileLabel}`);
  if (input.obrtnik) lines.push(input.obrtnik);
  if (input.objekt) lines.push(`Objekt: ${input.objekt}`);
  if (input.ponudba) lines.push(`Ponudba: ${input.ponudba}`);
  lines.push(
    `Trasa: ${s.runCm === null ? '—' : `${s.runCm.toFixed(0)} cm`} · višina polnila: ${s.panelHeightCm.toFixed(0)} cm`,
  );
  lines.push(
    `Stebri: ${s.postCount} (razmak ${s.bayCm.toFixed(0)} cm${s.baySource === 'measured' ? ', izmerjen' : ', PREDLOG — preveri na objektu'}) · celote: ${s.bays.length}`,
  );
  lines.push(`Deske: ${s.boards} kosov · skupaj ${formatNum(s.totalMeters)} m`);
  const rezi = [...new Set(s.bays.map((b) => b.cutLenCm))].sort((a, b) => b - a);
  if (rezi.length > 0) {
    lines.push(`Rez: ${rezi.map((r) => `${r.toFixed(0)} cm`).join(' / ')}`);
  }
  if (s.stocks.length > 0) {
    for (const st of s.stocks) {
      lines.push(
        `Nabavni profili: ${st.count} × ${st.stockCm} cm (${st.perStock} rezov na kos) · odpad ${st.wasteCm.toFixed(0)} cm (${st.wastePct.toFixed(1)} %)`,
      );
    }
  }
  if (s.cutList.length > 0) {
    const poCelotah = s.cutList
      .map((c) => `celota ${c.bay}: ${c.boardTo - c.boardFrom + 1} × ${c.cutLenCm.toFixed(0)} cm`)
      .join(' · ');
    lines.push(`Rezalni načrt (za žago): ${poCelotah}.`);
  }
  if (s.span.status === 'unknown') {
    lines.push('Meje razmika stebrov ROKSAL za ta profil ne objavlja — razmak potrdi monter.');
  }
  lines.push('Stebri in pritrdila nista v kosovnici — količine vpiši iz kataloga.');
  return lines.join('\n');
}
