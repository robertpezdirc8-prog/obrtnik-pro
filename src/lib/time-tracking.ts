// ─── Časovnica (Zeiterfassung) — čiste funkcije, 0 AI ───────
// Raziskava (meisterwerk, rechnung-handwerk, lexware, pds 2025/26):
// od »erfassten Zeiteintrag bis zur fertigen Rechnung« mora biti
// nekaj klikov. Ta knjižnica deluje točno tako: vnosi minut →
// obračunljive ure (na četrt ure) → postavke v osnutek ponudbe.
//
// Pogodbe iskrenosti:
//  • delovni dan je niz "YYYY-MM-DD" (brez časovnih pasov, brez ugibanj);
//  • obračun se šteje na 0,25 h (matematično, polovice gor), vsako
//    delo pa vsaj 0,25 h — zaokroževanje je izrecno vidno v opisu
//    postavke, nikoli tiho;
//  • povprečje na delovni dan SE NE TRDI pod MIN_DAYS_FOR_AVG dnevi
//    (null — ista pogodba kot win-rate in povprečje plačil).

export const BILLABLE_ROUNDING_H = 0.25; // štetje na četrt ure
export const MIN_BILLABLE_H = 0.25;      // vsako delo vsaj četrt ure
export const MIN_DAYS_FOR_AVG = 3;       // pod 3 dnevi brez povprečja
export const MAX_MINUTES = 24 * 60;      // en vnos ≤ 24 h

export interface TimeEntryInput {
  id: string;
  day: string;            // "YYYY-MM-DD"
  description: string;
  minutes: number;
  hourlyRate: number;
  customerName: string | null;
  offerId: string | null;
  craftId: string | null;
  billedAt: string | null;
  billedRef: string | null;
  createdAt: string;
}

// ─── Dnevi (nizi, brez časovnih pasov) ──────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** Današnji dan po LOKALNEM času naprave (isti format "YYYY-MM-DD"). */
export function todayDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Dan + n dni (UTC aritmetika na nizu — deterministično). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ponedeljek tedna, v katerega spada `day`. */
export function weekStartDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = nedelja
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(day, -back);
}

// ─── Obračunljive ure ───────────────────────────────────────

/**
 * Minute → obračunljive ure: na 0,25 h (matematično, polovice gor),
 * vsako delo vsaj 0,25 h. 90 min → 1,5 · 100 min → 1,75 · 82,5 → 1,5.
 */
export function billableHours(minutes: number): number {
  const u = minutes / 60 / BILLABLE_ROUNDING_H; // število četrtin
  const q = Math.floor(u + 0.5);                // polovice gor
  const h = Math.max(q, 1) * BILLABLE_ROUNDING_H; // min 0,25 h
  // zaokroži float šume (0.7500000001) na 4 decimalki
  return Math.round(h * 10000) / 10000;
}

export function formatHours(minutes: number): string {
  const h = minutes / 60;
  const rounded = Math.round(h * 100) / 100;
  const text = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(rounded);
  return `${text} h`;
}

export function formatMinutesHM(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
}

// ─── Statistika ─────────────────────────────────────────────

export interface CustomerHours {
  customerName: string;
  minutes: number;
  billableHours: number;
  earned: number;
}

export interface TimeStats {
  totalMinutes: number;
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  unbilledMinutes: number;
  /** Σ obračunljivih ur neobračunanih vnosov (na četrt ure). */
  unbilledBillableHours: number;
  /** Σ obračunljive ure × urna postavka (to je tudi vrednost postavk v ponudbi). */
  unbilledEarned: number;
  daysWithWork: number;
  /** null pod MIN_DAYS_FOR_AVG dnevi — povprečje se ne izmišljuje. */
  avgHoursPerDay: number | null;
  /** Neobračunano po strankah, padajoče po minutah. */
  byCustomer: CustomerHours[];
  /** Zadnjih 7 dni (najstarejši → danes), minute za mini graf. */
  last7Days: { day: string; minutes: number }[];
}

export function computeTimeStats(entries: TimeEntryInput[], now: Date): TimeStats {
  const today = todayDay(now);
  const wStart = weekStartDay(today);
  const wEnd = addDays(wStart, 6);
  const month = today.slice(0, 7); // "YYYY-MM"

  let totalMinutes = 0;
  let todayMinutes = 0;
  let weekMinutes = 0;
  let monthMinutes = 0;
  let unbilledMinutes = 0;
  let unbilledBillableHours = 0;
  let unbilledEarned = 0;
  const days = new Set<string>();
  const byCust = new Map<string, CustomerHours>();

  for (const e of entries) {
    const m = Math.max(0, Math.round(e.minutes));
    totalMinutes += m;
    days.add(e.day);
    if (e.day === today) todayMinutes += m;
    if (e.day >= wStart && e.day <= wEnd) weekMinutes += m;
    if (e.day.startsWith(month)) monthMinutes += m;

    const billed = e.billedAt !== null && e.billedAt !== undefined;
    if (!billed) {
      unbilledMinutes += m;
      const bh = billableHours(m);
      unbilledBillableHours += bh;
      unbilledEarned += bh * e.hourlyRate;

      const name = e.customerName && e.customerName.trim() !== '' ? e.customerName.trim() : 'Brez stranke';
      const agg = byCust.get(name) ?? { customerName: name, minutes: 0, billableHours: 0, earned: 0 };
      agg.minutes += m;
      agg.billableHours += bh;
      agg.earned += bh * e.hourlyRate;
      byCust.set(name, agg);
    }
  }

  const byCustomer = [...byCust.values()].sort((a, b) => b.minutes - a.minutes);

  const last7Days: { day: string; minutes: number }[] = [];
  const perDay = new Map<string, number>();
  for (const e of entries) {
    perDay.set(e.day, (perDay.get(e.day) ?? 0) + Math.max(0, Math.round(e.minutes)));
  }
  for (let i = 6; i >= 0; i -= 1) {
    const d = addDays(today, -i);
    last7Days.push({ day: d, minutes: perDay.get(d) ?? 0 });
  }

  return {
    totalMinutes,
    todayMinutes,
    weekMinutes,
    monthMinutes,
    unbilledMinutes,
    unbilledBillableHours: Math.round(unbilledBillableHours * 10000) / 10000,
    unbilledEarned: Math.round(unbilledEarned * 100) / 100,
    daysWithWork: days.size,
    avgHoursPerDay: days.size >= MIN_DAYS_FOR_AVG
      ? Math.round((totalMinutes / days.size / 60) * 100) / 100
      : null,
    byCustomer,
    last7Days,
  };
}

// ─── Postavke za osnutek ponudbe ────────────────────────────

export interface WorkItemDraft {
  key: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

/**
 * Neobračunani vnosi → postavke osnutka, GRUPIRANE po urni postavki
 * (padajoče). Količina = Σ obračunljivih ur skupine; opis izrecno
 * pove, da se šteje na četrt ure — zaokroževanje ni skrito.
 * Vnos brez stranke dobil oznako "Delo".
 */
export function hoursToInvoiceItems(entries: TimeEntryInput[]): WorkItemDraft[] {
  const unbilled = entries.filter((e) => !(e.billedAt !== null && e.billedAt !== undefined));
  const byRate = new Map<number, TimeEntryInput[]>();
  for (const e of unbilled) {
    const rate = Math.round(e.hourlyRate * 100) / 100;
    const list = byRate.get(rate) ?? [];
    list.push(e);
    byRate.set(rate, list);
  }

  const items: WorkItemDraft[] = [];
  for (const rate of [...byRate.keys()].sort((a, b) => b - a)) {
    const group = byRate.get(rate)!;
    // determinističen vrstni red: dan naraščajoče, nato opis
    group.sort((a, b) => (a.day === b.day ? a.description.localeCompare(b.description, 'sl') : a.day.localeCompare(b.day)));
    const qty = Math.round(group.reduce((s, e) => s + billableHours(e.minutes), 0) * 10000) / 10000;
    const lines = group.map((e) => `${e.day.slice(8, 10)}.${e.day.slice(5, 7)}. ${e.description} (${formatHours(e.minutes)})`);
    const found = group.find((e) => e.customerName !== null && e.customerName.trim() !== '');
    const label = found && found.customerName ? found.customerName.trim() : null;
    items.push({
      key: `cas-${group.map((e) => e.id).join('-')}`,
      name: label ? `Delo — ${label}` : 'Delo',
      description:
        `Urna postavka ${new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(rate)} €/h; ` +
        `čas se šteje na ${new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(BILLABLE_ROUNDING_H)} h. Opravila:\n${lines.join('\n')}`,
      quantity: qty,
      unit: 'ur',
      unitPrice: rate,
    });
  }
  return items;
}
