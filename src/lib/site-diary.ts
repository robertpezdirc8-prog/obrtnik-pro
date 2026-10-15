// ─── Terenski dnevnik (Baustellendokumentacija) — čiste funkcije, 0 AI ──
// Raziskava 2026 (qonto »die 11 besten Handwerkersoftwaren«, fuer-gruender
// 13-anbieter test, plancraft): Baustellendokumentacija je ena od šestih
// ključnih funkcij obrtniške programske opreme — zapisi z datumom + fotke
// so dokaz izvedenega dela (spori, garancija, dodatna dela).
//
// Pogodbe iskrenosti:
//  • delovni dan je niz "YYYY-MM-DD" (brez časovnih pasov — ista pogodba
//    kot pri časovnici), dnevi se grupirajo deterministično;
//  • ure na delovnem nalogu SE IZPIŠEJO samo, kadar je vnos vezan na
//    ponudbo (brez povezave ni ure — ne ugibamo);
//  • span dni je null, kadar ni vnosov (ne trdimo »0 dni« za prazno);
//  • fotografije so dokaz, ne analiza — aplikacija jih ne ocenjuje in
//    ne popravlja.

import { billableHours, type TimeEntryInput } from './time-tracking';

// ─── Faze dela ──────────────────────────────────────────────

export const DIARY_PHASES = ['priprava', 'demontaza', 'montaza', 'zakljucek', 'ostalo'] as const;
export type DiaryPhase = (typeof DIARY_PHASES)[number];

export const DIARY_PHASE_LABELS: Record<DiaryPhase, string> = {
  priprava: 'Priprava',
  demontaza: 'Demontaža',
  montaza: 'Montaža',
  zakljucek: 'Zaključek',
  ostalo: 'Ostalo',
};

export function isDiaryPhase(v: unknown): v is DiaryPhase {
  return typeof v === 'string' && (DIARY_PHASES as readonly string[]).includes(v);
}

// ─── Omejitve (isti odziv na strežniku in klientu) ──────────

export const MAX_PHOTOS_PER_ENTRY = 6;
export const MAX_NOTE_LEN = 500;
export const MAX_OBJECT_LABEL_LEN = 80;
export const MAX_CAPTION_LEN = 120;
export const MAX_PHOTO_CHARS = 6_000_000; // ~4,5 MB slike po base64 — stisnjene na 1280 px

export interface DiaryPhoto {
  dataUrl: string;
  /** Male sličice (do ~320 px) — za sezname, da se ne prenašajo polne fotke. */
  thumb: string | null;
  caption: string | null;
}

export interface DiaryEntryInput {
  id: string;
  day: string; // "YYYY-MM-DD"
  phase: DiaryPhase;
  note: string;
  offerId: string | null;
  offerNumber: string | null; // denormalizirano za prikaz
  objectLabel: string | null;
  photos: DiaryPhoto[];
  createdAt: string;
}

// ─── Validacija fotografij (ista pravila na strežniku in klientu) ──────

export interface PhotoParseResult {
  photos: DiaryPhoto[];
  error: string | null;
}

/**
 * Stroga validacija vnosnih fotografij: polje ≤ 6, vsaka vnosna slika
 * mora biti dataURL (data:image/...), sličica in opomba opcijski.
 */
export function parseDiaryPhotos(raw: unknown): PhotoParseResult {
  if (!Array.isArray(raw)) return { photos: [], error: 'Fotografije morajo biti polje.' };
  if (raw.length > MAX_PHOTOS_PER_ENTRY) {
    return { photos: [], error: `Največ ${MAX_PHOTOS_PER_ENTRY} fotografij na vnos.` };
  }
  const photos: DiaryPhoto[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) return { photos: [], error: 'Fotografija mora biti objekt.' };
    const obj = p as Record<string, unknown>;
    const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl : '';
    if (!dataUrl.startsWith('data:image/') || dataUrl.length < 20 || dataUrl.length > MAX_PHOTO_CHARS) {
      return { photos: [], error: 'Fotografija mora biti slika v obliki dataURL (data:image/...).' };
    }
    let thumb: string | null = null;
    if (typeof obj.thumb === 'string' && obj.thumb.startsWith('data:image/') && obj.thumb.length <= MAX_PHOTO_CHARS) {
      thumb = obj.thumb;
    }
    let caption: string | null = null;
    if (typeof obj.caption === 'string') {
      const c = obj.caption.trim();
      caption = c.length > 0 ? c.slice(0, MAX_CAPTION_LEN) : null;
    }
    photos.push({ dataUrl, thumb, caption });
  }
  return { photos, error: null };
}

// ─── Grupiranje po dnevih (deterministično) ─────────────────

export interface DiaryDay {
  day: string;
  weekday: string; // "sre" — sl-SI kratko
  entries: DiaryEntryInput[];
  photoCount: number;
}

/** Ponedeljek–nedelja ime dneva iz niza (UTC datumi — brez preskokov ob meji). */
export function weekdayShort(day: string): string {
  return new Intl.DateTimeFormat('sl-SI', { weekday: 'short' }).format(new Date(`${day}T12:00:00.000Z`));
}

/**
 * Grupira vnose po dnevih padajoče (najnovejši dan zgoraj), znotraj
 * dneva po času nastanka padajoče (zadnji zapis dneva zgoraj).
 */
export function groupDiaryByDay(entries: DiaryEntryInput[]): DiaryDay[] {
  const byDay = new Map<string, DiaryEntryInput[]>();
  for (const e of entries) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return days.map((day) => {
    const dayEntries = (byDay.get(day) ?? []).slice().sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    return {
      day,
      weekday: weekdayShort(day),
      entries: dayEntries,
      photoCount: dayEntries.reduce((sum, e) => sum + e.photos.length, 0),
    };
  });
}

// ─── Povzetek (iskreno — null namesto lažnega 0) ────────────

export interface DiarySummary {
  entries: number;
  days: number;
  photos: number;
  firstDay: string | null;
  lastDay: string | null;
  /** Vključno razpon v dneh (lastDay − firstDay + 1); null brez vnosov. */
  spanDays: number | null;
}

export function diarySummary(entries: DiaryEntryInput[]): DiarySummary {
  if (entries.length === 0) {
    return { entries: 0, days: 0, photos: 0, firstDay: null, lastDay: null, spanDays: null };
  }
  const days = [...new Set(entries.map((e) => e.day))].sort();
  const photos = entries.reduce((sum, e) => sum + e.photos.length, 0);
  const firstDay = days[0] ?? null;
  const lastDay = days[days.length - 1] ?? null;
  let spanDays: number | null = null;
  if (firstDay && lastDay) {
    const ms = new Date(`${lastDay}T00:00:00.000Z`).getTime() - new Date(`${firstDay}T00:00:00.000Z`).getTime();
    spanDays = Math.round(ms / 86_400_000) + 1;
  }
  return { entries: entries.length, days: days.length, photos, firstDay, lastDay, spanDays };
}

// ─── Ure iz časovnice (po ponudbi — brez ponudbe ni ur) ─────

export interface DiaryHours {
  /** Σ oddelanih minut vnosa časovnice vezanih na isti delovni nalog. */
  minutes: number;
  /** Σ obračunljivih ur (vsak vnos posebej na 0,25 h — enako kot obračun). */
  hours: number;
  timeEntries: number;
}

/**
 * Ure vezane na ponudbo. `offerId = null` → { 0, 0, 0 }: brez delovnega
 * naloga SE NE TRDI nobena ura (ure so zgodovina časovnice, ne ugib).
 */
export function diaryHours(timeEntries: TimeEntryInput[], offerId: string | null): DiaryHours {
  if (!offerId) return { minutes: 0, hours: 0, timeEntries: 0 };
  const linked = timeEntries.filter((t) => t.offerId === offerId);
  const minutes = linked.reduce((sum, t) => sum + (Number.isFinite(t.minutes) ? t.minutes : 0), 0);
  const hours = Math.round(linked.reduce((sum, t) => sum + billableHours(t.minutes), 0) * 10000) / 10000;
  return { minutes, hours, timeEntries: linked.length };
}

// ─── Oblika dneva (sl-SI) ───────────────────────────────────

/** "2026-10-14" → "sre, 14. 10. 2026" (deterministično, UTC). */
export function formatDiaryDay(day: string): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  const date = new Intl.DateTimeFormat('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(d);
  return `${weekdayShort(day)}, ${date}`;
}

// ─── CSV izvoz (; ločilo za sl Excel, BOM doda klicatelj) ───

function csvEsc(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function diaryToCsv(entries: DiaryEntryInput[]): string {
  const head = 'dan;faza;ponudba;objekt;opis;st_fotografij;ustvarjeno';
  const rows = entries.map((e) =>
    [
      e.day,
      DIARY_PHASE_LABELS[e.phase] ?? e.phase,
      e.offerNumber ?? '',
      e.objectLabel ?? '',
      e.note,
      e.photos.length,
      e.createdAt,
    ]
      .map(csvEsc)
      .join(';'),
  );
  return [head, ...rows].join('\r\n');
}

// ─── Tiskalno poročilo (HTML — čista funkcija, testabilno) ──

export interface DiaryReportMeta {
  companyName: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  customerName?: string | null;
  objectAddress?: string | null;
  offerNumber?: string | null;
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Zgradi HTML dokumentacijo izvedenih del (odpre se v oknu za tiskanje).
 * Ure izpiše IZRECNO samo, kadar obstajajo (timeEntries > 0) — pogodba
 * iskrenosti: nič tihih »0 h«.
 */
export function buildDiaryReportHtml(
  days: DiaryDay[],
  meta: DiaryReportMeta,
  hours: DiaryHours,
): string {
  const period = days.length > 0
    ? `${formatDiaryDay(days[days.length - 1].day)} – ${formatDiaryDay(days[0].day)}`
    : '—';

  const dayBlocks = days.map((d) => {
    const entriesHtml = d.entries.map((e) => {
      const photosHtml = e.photos.length > 0
        ? `<div class="photos">${e.photos
            .map((p) => `<figure><img src="${escHtml(p.dataUrl)}" alt="${escHtml(p.caption ?? 'Fotografija izvedenega dela')}">${p.caption ? `<figcaption>${escHtml(p.caption)}</figcaption>` : ''}</figure>`)
            .join('')}</div>`
        : '';
      return `<div class="entry">
        <div class="entry-head">
          <span class="phase">${escHtml(DIARY_PHASE_LABELS[e.phase] ?? e.phase)}</span>
          ${e.offerNumber ? `<span class="ref">Delovni nalog ${escHtml(e.offerNumber)}</span>` : ''}
          ${e.objectLabel ? `<span class="ref">${escHtml(e.objectLabel)}</span>` : ''}
        </div>
        ${e.note ? `<p class="note">${escHtml(e.note)}</p>` : '<p class="note muted">(brez opisa — samo fotografija)</p>'}
        ${photosHtml}
      </div>`;
    }).join('');
    return `<div class="day">
      <h3>${escHtml(formatDiaryDay(d.day))}</h3>
      ${entriesHtml}
    </div>`;
  }).join('');

  const hoursHtml = hours.timeEntries > 0
    ? `<div class="hours"><strong>Evidence ure:</strong> ${new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(hours.hours)} h
       (${hours.timeEntries} ${hours.timeEntries === 1 ? 'vnos' : hours.timeEntries === 2 ? 'vnosa' : 'vnosov'} časovnice — čas se šteje na 0,25 h).</div>`
    : '';

  const body = dayBlocks || '<p class="muted">Ni zapisov za izbrano obdobje.</p>';

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Dokumentacija izvedenih del</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #292524; margin: 0; padding: 32px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #a16207; padding-bottom: 16px; margin-bottom: 20px; }
  .company h1 { margin: 0 0 4px; font-size: 20px; color: #854d0e; }
  .company p { margin: 2px 0; color: #57534e; }
  .meta { text-align: right; }
  .meta .num { font-size: 20px; font-weight: 700; color: #854d0e; }
  .meta p { margin: 2px 0; color: #57534e; }
  h3 { margin: 18px 0 6px; padding: 8px 12px; background: #fef3c7; border-left: 4px solid #a16207; font-size: 14px; color: #854d0e; }
  .entry { border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .entry-head { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .phase { background: #854d0e; color: #fff; border-radius: 6px; padding: 2px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.3px; }
  .ref { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 2px 10px; font-size: 11px; color: #57534e; }
  .note { margin: 4px 0; white-space: pre-wrap; }
  .muted { color: #a8a29e; }
  .photos { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  figure { margin: 0; max-width: 240px; }
  img { width: 100%; border: 1px solid #e7e5e4; border-radius: 6px; display: block; }
  figcaption { font-size: 10px; color: #57534e; margin-top: 3px; }
  .hours { margin-top: 16px; padding: 10px 14px; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; }
  .foot { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e7e5e4; color: #78716c; font-size: 11px; }
</style>
</head>
<body>
  <div class="head">
    <div class="company">
      <h1>${escHtml(meta.companyName)}</h1>
      ${meta.ownerName ? `<p>${escHtml(meta.ownerName)}</p>` : ''}
      ${meta.address ? `<p>${escHtml(meta.address)}</p>` : ''}
      <p>${meta.phone ? `Tel.: ${escHtml(meta.phone)}` : ''}${meta.phone && meta.email ? ' · ' : ''}${meta.email ? escHtml(meta.email) : ''}</p>
    </div>
    <div class="meta">
      <div class="num">Dokumentacija izvedenih del</div>
      <p>Obdobje: ${escHtml(period)}</p>
      ${meta.customerName ? `<p>Stranka: ${escHtml(meta.customerName)}</p>` : ''}
      ${meta.objectAddress ? `<p>Objekt: ${escHtml(meta.objectAddress)}</p>` : ''}
      ${meta.offerNumber ? `<p>Delovni nalog: ${escHtml(meta.offerNumber)}</p>` : ''}
    </div>
  </div>
  ${body}
  ${hoursHtml}
  <div class="foot">
    Zapis je nastal v aplikaciji Obrtnik Pro. Fotografije prikazujejo izvedeno stanje ob datumih zapisov in so del dokumentacije dela.
  </div>
</body>
</html>`;
}
