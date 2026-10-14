// ─── Sledenje ponudbam: lijak, iskren win-rate, opomniki (Wiedervorlage) ────
//
// Čiste, deterministične funkcije (0 AI). Pogodbe iskrenosti:
//  • win-rate se IZRAČUNA samo, če je odločenih (sprejetih + zavrnjenih)
//    ponudb ≥ MIN_DECIDED_FOR_WINRATE — sicer je null in UI pove
//    »premalo podatkov« (nikoli lažnih odstotkov iz 1–2 primerov);
//  • »brez odgovora« velja SAMO za poslane ponudbe (osnutek stranka
//    še ni videla — ne more »brez odgovora«);
//  • ročno nastavljen opomnik (followUpAt) velja za osnutek IN poslano;
//  • odločene ponudbe nikoli niso za opomnik (opomnik se ob odločitvi
//    počisti na strežniku).

import type { OfferStatus } from './types';

/** Najmanjše št. odločenih ponudb za trditev o win-rate (pogodba). */
export const MIN_DECIDED_FOR_WINRATE = 3;
/** Dni brez odgovora, po katerih je poslana ponudba »za opomnik«. */
export const FOLLOW_UP_DEFAULT_DAYS = 3;
const DAY_MS = 86_400_000;

/** Minimalni lik ponudbe, ki ga pipeline rabi (OfferDTO je nadmnožica). */
export interface PipelineOffer {
  id: string;
  number: string;
  customerName: string;
  status: OfferStatus;
  total: number;
  createdAt: string;
  sentAt?: string | null;
  decidedAt?: string | null;
  followUpAt?: string | null;
}

export interface PipelineStats {
  counts: Record<OfferStatus, number> & { total: number };
  /** accepted + rejected */
  decided: number;
  /** accepted / decided ali null, če decided < MIN_DECIDED_FOR_WINRATE. */
  winRate: number | null;
  valueSent: number;
  valueAccepted: number;
  valueRejected: number;
  /** povprečna vrednost sprejetih ali null, če ni nobene. */
  avgAccepted: number | null;
  /** Največja rast lijaka: poslane → sprejete (za povratne informacije). */
  biggestGap: 'draft→sent' | 'sent→decided' | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lijak + iskren win-rate iz vseh ponudb. Deterministično. */
export function computePipelineStats(
  offers: PipelineOffer[],
): PipelineStats {
  const counts = { draft: 0, sent: 0, accepted: 0, rejected: 0, total: offers.length };
  let valueSent = 0;
  let valueAccepted = 0;
  let valueRejected = 0;
  let acceptedCount = 0;

  for (const o of offers) {
    if (o.status in counts) counts[o.status] += 1;
    if (o.status === 'sent') valueSent += o.total;
    if (o.status === 'accepted') { valueAccepted += o.total; acceptedCount += 1; }
    if (o.status === 'rejected') valueRejected += o.total;
  }

  const decided = counts.accepted + counts.rejected;
  const winRate = decided >= MIN_DECIDED_FOR_WINRATE
    ? round2((counts.accepted / decided) * 100)
    : null;
  const avgAccepted = acceptedCount > 0 ? round2(valueAccepted / acceptedCount) : null;

  // Največja padajoča koraka v lijaku — kje gre največ ponudb »izgubit«.
  let biggestGap: PipelineStats['biggestGap'] = null;
  const gapDraftSent = counts.draft - counts.sent;
  const gapSentDecided = counts.sent - decided;
  if (gapDraftSent > 0 || gapSentDecided > 0) {
    biggestGap = gapDraftSent >= gapSentDecided ? 'draft→sent' : 'sent→decided';
  }

  return {
    counts,
    decided,
    winRate,
    valueSent: round2(valueSent),
    valueAccepted: round2(valueAccepted),
    valueRejected: round2(valueRejected),
    avgAccepted,
    biggestGap,
  };
}

export type FollowUpReason = 'opomnik' | 'brez-odgovora';

export interface FollowUpInfo {
  /** Ponudba zasluži pozornost zdaj. */
  due: boolean;
  /** Zakaj: ročni opomnik je potekel ali poslana ponudba brez odgovora. */
  reason: FollowUpReason | null;
  /** Dni od ročnega opomnika (pozitivno = pretekel) oz. od pošiljanja. */
  days: number;
}

/** Kdaj je ena ponudba »za opomnik«. Čista funkcija glede na `now`. */
export function followUpInfo(
  offer: PipelineOffer,
  now: Date,
  defaultDays: number = FOLLOW_UP_DEFAULT_DAYS,
): FollowUpInfo {
  // Odločena ponudba — nič več za opomnik (followUpAt se tudi počisti).
  if (offer.status === 'accepted' || offer.status === 'rejected') {
    return { due: false, reason: null, days: 0 };
  }

  const toTime = (iso?: string | null): number => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? t : NaN;
  };

  // 1) Ročno nastavljen opomnik (Wiedervorlage) — velja za osnutek IN poslano.
  const fu = toTime(offer.followUpAt);
  if (Number.isFinite(fu)) {
    const days = Math.floor((now.getTime() - fu) / DAY_MS);
    return { due: days >= 0, reason: days >= 0 ? 'opomnik' : null, days };
  }

  // 2) Poslana ponudba brez odgovora po `defaultDays` dneh.
  if (offer.status === 'sent') {
    const sent = toTime(offer.sentAt) || toTime(offer.createdAt);
    if (Number.isFinite(sent)) {
      const days = Math.floor((now.getTime() - sent) / DAY_MS);
      if (days >= defaultDays) return { due: true, reason: 'brez-odgovora', days };
    }
  }

  return { due: false, reason: null, days: 0 };
}

/** Vse ponudbe za opomnik, sortirane po nujnosti:
 *  1. pretekel ročni opomnik (najstarejši najprej),
 *  2. poslane brez odgovora (najdlje čakajoče najprej). */
export function dueFollowUps(
  offers: PipelineOffer[],
  now: Date,
  defaultDays: number = FOLLOW_UP_DEFAULT_DAYS,
): Array<PipelineOffer & { info: FollowUpInfo }> {
  const out: Array<PipelineOffer & { info: FollowUpInfo }> = [];
  for (const o of offers) {
    const info = followUpInfo(o, now, defaultDays);
    if (info.due && info.reason) out.push({ ...o, info });
  }
  out.sort((a, b) => {
    if (a.info.reason !== b.info.reason) {
      return a.info.reason === 'opomnik' ? -1 : 1; // opomniki imajo prednost
    }
    const ta = a.info.reason === 'opomnik'
      ? new Date(a.followUpAt ?? a.createdAt).getTime()
      : new Date(a.sentAt ?? a.createdAt).getTime();
    const tb = b.info.reason === 'opomnik'
      ? new Date(b.followUpAt ?? b.createdAt).getTime()
      : new Date(b.sentAt ?? b.createdAt).getTime();
    return ta - tb;
  });
  return out;
}

/** Podatki za PATCH ob spremembi statusa — časovni žigi NASTAVLJA STREŽNIK:
 *  • → sent: sentAt (enkrat, idempotentno);
 *  • → accepted/rejected: decidedAt (enkrat), followUpAt = null;
 *  • → draft: decidedAt se počisti (odločitev preklicana), sentAt ostane,
 *    če je bil kdaj poslan (iskrena zgodovina). */
export function nextStatusData(
  status: OfferStatus,
  prev: { sentAt?: string | null; decidedAt?: string | null } = {},
  now: Date = new Date(),
): { sentAt: Date | null; decidedAt: Date | null; followUpAt: Date | null } {
  const prevSent = prev.sentAt ? new Date(prev.sentAt) : null;
  const prevDecided = prev.decidedAt ? new Date(prev.decidedAt) : null;

  if (status === 'sent') {
    return { sentAt: prevSent ?? now, decidedAt: null, followUpAt: null };
  }
  if (status === 'accepted' || status === 'rejected') {
    return {
      sentAt: prevSent,
      decidedAt: prevDecided ?? now,
      followUpAt: null, // odločeno — opomni se počisti
    };
  }
  // draft — odločitev se prekliče; če je bila ponudba kdaj poslana,
  // sentAt ostane (zgodovina se ne izmišlja nazaj).
  return { sentAt: prevSent, decidedAt: null, followUpAt: null };
}

/** ISO niz za opomnik `days` dni od `now` (Wiedervorlage). */
export function suggestFollowUpIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** Kratek sl-SI opis roka opomnika glede na `now` (za značke v UI). */
export function formatFollowUpRelative(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((t - now.getTime()) / DAY_MS);
  if (days === 0) return 'danes';
  if (days === 1) return 'jutri';
  if (days === -1) return 'včeraj';
  if (days < 0) return `pred ${-days} dni`;
  return `čez ${days} dni`;
}
