// ─── Sledenje plačilom: terjatve + Mahnwesen (opomniki plačil) ──
// Raziskava (Handwerker-Software-Vergleich 2025/26, OMR: »Rechnungs-
// stellung und Zahlungsüberwachung«; Craftboxx/ToolTime): denarni
// tok je za malega obrtnika kritičen — treba je vedeti, kaj je
// neplačano, kaj zapadlo in kdaj pošteno poslati opomnik.
// Knjižnica je čisto deterministična (0 AI), pogodbe iskrenosti kot
// pri offer-pipeline: pod 3 plačanimi računi NE trdimo povprečja.

export interface PaymentInvoice {
  id: string;
  number: string;
  customerName: string;
  total: number;
  createdAt: string;
  /** Rok plačila (ISO) — null = računu nikoli ni bil dodeljen (brez roka). */
  dueAt: string | null;
  /** Kdaj plačano (ISO) — null = neplačan. */
  paidAt: string | null;
}

export type PaymentStatus = 'paid' | 'overdue' | 'due-soon' | 'pending' | 'no-due';

const DAY_MS = 86_400_000;
/** Kdaj se opozori PRED rokom ("rok čez N dni"). */
export const DUE_SOON_DAYS = 5;
/** Iskrenost povprečja: manj kot toliko plačanih = brez trditve. */
export const MIN_PAID_FOR_AVG = 3;

/** Koliko polnih dni od a do b (pozitivno = b kasneje). */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

export interface PaymentInfo {
  status: PaymentStatus;
  /** Za 'overdue': polni dnevi prek roka. */
  daysOverdue: number | null;
  /** Za 'due-soon': polni dnevi do roka (≥ 0 = še danes). */
  daysLeft: number | null;
  /** Rok (ISO) — `null` pomeni, da računu nikoli ni bil dodeljen. */
  effectiveDueAt: string | null;
  /** Ali je rok izrecen (true) ali ga ni (false). */
  dueExplicit: boolean;
}

/**
 * Učinkovit rok = SHRANJENI `dueAt`. Prejšnja različica je v primeru brez
 * roka sama izmislila 30 dni od izdaje (`DEFAULT_DUE_DAYS`), medtem ko je
 * račun v PDF pisal datum iz nastavitve `paymentDays` — isti račun je imel
 * dva zapadla datuma. Task 86: brez izmišljene roka.
 */
export function effectiveDueAt(inv: PaymentInvoice): { iso: string | null; explicit: boolean } {
  return inv.dueAt ? { iso: inv.dueAt, explicit: true } : { iso: null, explicit: false };
}

/** Stanje enega računa glede na `now` (deterministično). */
export function paymentStatus(inv: PaymentInvoice, now: Date): PaymentInfo {
  const { iso: dueIso, explicit } = effectiveDueAt(inv);
  const base: PaymentInfo = {
    status: 'pending',
    daysOverdue: null,
    daysLeft: null,
    effectiveDueAt: dueIso,
    dueExplicit: explicit,
  };
  if (inv.paidAt) return { ...base, status: 'paid' };
  if (!dueIso) return { ...base, status: 'no-due' };

  const due = new Date(dueIso);
  const overdue = daysBetween(due, now); // >0 = zapadel
  if (overdue > 0) {
    return { ...base, status: 'overdue', daysOverdue: overdue };
  }
  const left = daysBetween(now, due); // 0 = rok danes
  if (left <= DUE_SOON_DAYS) {
    return { ...base, status: 'due-soon', daysLeft: left };
  }
  return base;
}

// ─── Mahnwesen: poštene stopnje opomnikov ───────────────────

export interface Dunning {
  /** 0 = ni zapadla · 1 = 1–14 dni · 2 = 15–30 dni · 3 = 31+ dni. */
  level: 0 | 1 | 2 | 3;
  label: string;
  /** Predlog vsebine opomnika (iskren, brez groženj — strokovni ton). */
  message: string;
}

const DUNNING: Record<1 | 2 | 3, { label: string; message: string }> = {
  1: {
    label: '1. opomnik',
    message: 'Prijazen opomnik: »Izgleda, da nam je račun {nr} ušel — v spodnjem e-sporočilu še enkrat prilagam. Hvala!«',
  },
  2: {
    label: '2. opomnik',
    message: 'Izrecen rok: »Račun {nr} je zapadel. Uprizorite plačilo v 7 dneh, sicer obračunam zamudne obresti.«',
  },
  3: {
    label: '3. opomnik',
    message: 'Zadnji opomnik: »Račun {nr} je močno zapadel. Zadnji rok 14 dni, po njem predam odvetniku ali izvedencu.«',
  },
};

/** Stopnja opomnika po poštenih pragovih (samo za NEplačane). */
export function dunningLevel(inv: PaymentInvoice, now: Date): Dunning {
  const info = paymentStatus(inv, now);
  if (info.status === 'paid') {
    return { level: 0, label: 'Plačano', message: '' };
  }
  if (info.status === 'no-due') {
    return { level: 0, label: 'Brez roka', message: '' };
  }
  const d = info.daysOverdue ?? 0;
  if (d === 0) {
    return {
      level: 0,
      label: info.status === 'due-soon' ? 'Rok se izteka' : 'V roku',
      message: '',
    };
  }
  if (d <= 14) return { level: 1, ...DUNNING[1] };
  if (d <= 30) return { level: 2, ...DUNNING[2] };
  return { level: 3, ...DUNNING[3] };
}

// ─── Terjatve: poštene vsote + starostna struktura ──────────

export interface AgingBuckets {
  /** 1–7 dni zapadlih računov (število). */
  d1_7: number;
  d8_14: number;
  d15_30: number;
  d30plus: number;
}

export interface Receivables {
  counts: { paid: number; unpaid: number; overdue: number };
  /** Skupaj odprtih terjatev (neplačano, vsi). */
  outstandingTotal: number;
  /** Od tega ZAPADLO (redno svetilka za akcijo). */
  overdueTotal: number;
  /** Plačano v trenutnem koledarskem mesecu `now`. */
  paidThisMonthTotal: number;
  /**
   * Povprečje dni od izdaje do plačila — iskrenost: pod
   * MIN_PAID_FOR_AVG plačanih je null (brez lažnih trditev).
   */
  avgDaysToPay: number | null;
  aging: AgingBuckets;
  /** Najdaljša zapadlost v dneh (null, če nič zapadlega). */
  worstOverdueDays: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Združena statistika terjatev nad vsemi računi. */
export function computeReceivables(invoices: PaymentInvoice[], now: Date): Receivables {
  const res: Receivables = {
    counts: { paid: 0, unpaid: 0, overdue: 0 },
    outstandingTotal: 0,
    overdueTotal: 0,
    paidThisMonthTotal: 0,
    avgDaysToPay: null,
    aging: { d1_7: 0, d8_14: 0, d15_30: 0, d30plus: 0 },
    worstOverdueDays: null,
  };

  const payDays: number[] = [];
  const sameMonth = (iso: string): boolean =>
    new Date(iso).getUTCFullYear() === now.getUTCFullYear() &&
    new Date(iso).getUTCMonth() === now.getUTCMonth();

  for (const inv of invoices) {
    const info = paymentStatus(inv, now);
    if (info.status === 'paid') {
      res.counts.paid += 1;
      res.paidThisMonthTotal += inv.paidAt && sameMonth(inv.paidAt) ? inv.total : 0;
      payDays.push(Math.max(0, daysBetween(new Date(inv.createdAt), new Date(inv.paidAt as string))));
      continue;
    }
    res.counts.unpaid += 1;
    res.outstandingTotal += inv.total;
    if (info.status === 'overdue') {
      res.counts.overdue += 1;
      res.overdueTotal += inv.total;
      const d = info.daysOverdue ?? 0;
      res.worstOverdueDays = Math.max(res.worstOverdueDays ?? 0, d);
      if (d <= 7) res.aging.d1_7 += 1;
      else if (d <= 14) res.aging.d8_14 += 1;
      else if (d <= 30) res.aging.d15_30 += 1;
      else res.aging.d30plus += 1;
    }
  }

  if (payDays.length >= MIN_PAID_FOR_AVG) {
    res.avgDaysToPay = r2(payDays.reduce((s, d) => s + d, 0) / payDays.length);
  }
  res.outstandingTotal = r2(res.outstandingTotal);
  res.overdueTotal = r2(res.overdueTotal);
  res.paidThisMonthTotal = r2(res.paidThisMonthTotal);
  return res;
}

/** Seznam za akcijo: zapadle (najstarejše najprej) nato roki se iztekajo. */
export function actionableInvoices(invoices: PaymentInvoice[], now: Date): Array<{ inv: PaymentInvoice; info: PaymentInfo }> {
  return invoices
    .map((inv) => ({ inv, info: paymentStatus(inv, now) }))
    .filter(({ info }) => info.status === 'overdue' || info.status === 'due-soon')
    .sort((a, b) => {
      // zapadle najprej po padajoči zapadlosti, nato rok se izteka (najmanj dni ostanka)
      const ao = a.info.daysOverdue ?? 0;
      const bo = b.info.daysOverdue ?? 0;
      if (ao !== bo) return bo - ao;
      return (a.info.daysLeft ?? 0) - (b.info.daysLeft ?? 0);
    });
}

// ─── Formatiranje (sl-SI) ───────────────────────────────────

/** »rok danes« · »rok jutri« · »rok čez N dni« · »zapadla pred N dni« · »plačana«. */
export function formatDueRelative(info: PaymentInfo, now: Date): string {
  if (info.status === 'paid') return 'plačana';
  if (info.status === 'no-due') return 'rok ni nastavljen';
  if (info.status === 'overdue') return `zapadla pred ${info.daysOverdue} dni`;
  if (info.status === 'due-soon') {
    if (info.daysLeft === 0) return 'rok danes';
    if (info.daysLeft === 1) return 'rok jutri';
    return `rok čez ${info.daysLeft} dni`;
  }
  const left = daysBetween(now, new Date(info.effectiveDueAt as string));
  return left === 0 ? 'rok danes' : `rok čez ${left} dni`;
}

/** Predlagan rok: `from` + `days` dni (za UI hitre akcije). `days` je obvezen —
 *  prejšnji privzetek 30 dni je bil izmišljen podatek in ni imel vira. */
export function suggestDueIso(from: Date | string, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
