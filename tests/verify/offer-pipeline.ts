// ─── Testi: Sledenje ponudbam (offer-pipeline) ──────────────
// Vse pričakovane vrednosti so IZRAČUNANE ROČNO (nic claимерov AI).
// Poženi: bun run tests/verify/offer-pipeline.ts

import {
  computePipelineStats,
  dueFollowUps,
  followUpInfo,
  formatFollowUpRelative,
  nextStatusData,
  suggestFollowUpIso,
  MIN_DECIDED_FOR_WINRATE,
  FOLLOW_UP_DEFAULT_DAYS,
  type PipelineOffer,
} from '../../src/lib/offer-pipeline';
import type { OfferStatus } from '../../src/lib/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass += 1; }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, g === w ? undefined : `dobil ${g}, pričakovano ${w}`);
}

/** Fiksni "zdaj" — sreda 2026-02-11 12:00 UTC (deterministični testi). */
const NOW = new Date('2026-02-11T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

function offer(p: Partial<PipelineOffer> & { id: string }): PipelineOffer {
  return {
    number: `2026-0${p.id}`,
    customerName: `Stranka ${p.id}`,
    status: 'draft',
    total: 1000,
    createdAt: daysAgo(1),
    ...p,
  } as PipelineOffer;
}

// ─── 1) computePipelineStats: ročno preštet lijak ───────────
{
  const offers: PipelineOffer[] = [
    offer({ id: '1', status: 'draft', total: 100 }),
    offer({ id: '2', status: 'draft', total: 200 }),
    offer({ id: '3', status: 'sent', total: 300 }),
    offer({ id: '4', status: 'sent', total: 400 }),
    offer({ id: '5', status: 'sent', total: 260 }),
    offer({ id: '6', status: 'accepted', total: 1000 }),
    offer({ id: '7', status: 'accepted', total: 2000 }),
    offer({ id: '8', status: 'accepted', total: 3000 }),
    offer({ id: '9', status: 'rejected', total: 500 }),
  ];
  const s = computePipelineStats(offers);
  eq('lijak: counts po statusih', [s.counts.draft, s.counts.sent, s.counts.accepted, s.counts.rejected], [2, 3, 3, 1]);
  eq('lijak: skupaj', s.counts.total, 9);
  eq('lijak: decided', s.decided, 4);
  // ROČNO: 3 sprejete od 4 odločenih = 75 %
  eq('win-rate 3/4 = 75 %', s.winRate, 75);
  // ROČNO: sent 300+400+260 = 960; accepted 6000; rejected 500
  eq('vrednost poslanih', s.valueSent, 960);
  eq('vrednost sprejetih', s.valueAccepted, 6000);
  eq('vrednost zavrnjenih', s.valueRejected, 500);
  // ROČNO: 6000 / 3 = 2000
  eq('povprečno sprejeto', s.avgAccepted, 2000);
  // ROČNO: draft→sent padec 0 (sent > draft), sent→decided padec 3−4 <0 → nobena vrzel ni pozitivna
  eq('največja vrzel brez pozitivnih padcev', s.biggestGap, null);
}

// ─── 2) Iskrenost: < 3 odločenih → winRate null ─────────────
{
  const s2 = computePipelineStats([
    offer({ id: '1', status: 'accepted', total: 100 }),
    offer({ id: '2', status: 'accepted', total: 100 }),
  ]);
  eq('2 odločeni → winRate null (pogodba)', s2.winRate, null);
  ok('2 odločeni < MIN', s2.decided < MIN_DECIDED_FOR_WINRATE);

  const s3 = computePipelineStats([
    offer({ id: '1', status: 'accepted', total: 100 }),
    offer({ id: '2', status: 'rejected', total: 100 }),
    offer({ id: '3', status: 'rejected', total: 100 }),
  ]);
  // ROČNO: 1 sprejeta / 3 odločene = 33,33 %
  eq('3 odločene → winRate 33,33 %', s3.winRate, 33.33);

  const s0 = computePipelineStats([]);
  eq('prazno → winRate null', s0.winRate, null);
  eq('prazno → avgAccepted null', s0.avgAccepted, null);
  eq('prazno → skupaj 0', s0.counts.total, 0);
}

// ─── 3) avgAccepted null brez sprejetih ─────────────────────
{
  const s = computePipelineStats([
    offer({ id: '1', status: 'sent', total: 100 }),
    offer({ id: '2', status: 'rejected', total: 100 }),
    offer({ id: '3', status: 'rejected', total: 100 }),
  ]);
  eq('brez sprejetih → avgAccepted null', s.avgAccepted, null);
  // ROČNO: 0 sprejetih / 2 odločeni = premalo → null (pogodba < 3)
  eq('2 odločeni brez sprejetih → winRate null', s.winRate, null);

  const s4 = computePipelineStats([
    offer({ id: '1', status: 'sent', total: 100 }),
    offer({ id: '2', status: 'rejected', total: 100 }),
    offer({ id: '3', status: 'rejected', total: 100 }),
    offer({ id: '4', status: 'rejected', total: 100 }),
  ]);
  // ROČNO: 0 sprejetih / 3 odločene = 0 %
  eq('0 sprejetih od 3 → winRate 0 %', s4.winRate, 0);
}

// ─── 4) biggestGap ──────────────────────────────────────────
{
  const a = computePipelineStats([
    offer({ id: '1', status: 'draft', total: 100 }),
    offer({ id: '2', status: 'draft', total: 100 }),
    offer({ id: '3', status: 'draft', total: 100 }),
    offer({ id: '4', status: 'draft', total: 100 }),
    offer({ id: '5', status: 'draft', total: 100 }),
    offer({ id: '6', status: 'sent', total: 100 }),
    offer({ id: '7', status: 'accepted', total: 100 }),
    offer({ id: '8', status: 'rejected', total: 100 }),
    offer({ id: '9', status: 'accepted', total: 100 }),
  ]);
  // ROČNO: draft→sent = 5−1 = 4; sent→decided = 1−3 = −2 → večja vrzel draft→sent
  eq('največja vrzel draft→sent', a.biggestGap, 'draft→sent');

  const b = computePipelineStats([
    offer({ id: '1', status: 'sent', total: 100 }),
    offer({ id: '2', status: 'sent', total: 100 }),
    offer({ id: '3', status: 'sent', total: 100 }),
    offer({ id: '4', status: 'sent', total: 100 }),
    offer({ id: '5', status: 'sent', total: 100 }),
    offer({ id: '6', status: 'accepted', total: 100 }),
  ]);
  // ROČNO: draft→sent = 0−5 <0; sent→decided = 5−1 = 4 → sent→decided
  eq('največja vrzel sent→decided', b.biggestGap, 'sent→decided');
}

// ─── 5) followUpInfo: ročni opomnik (Wiedervorlage) ─────────
{
  // Opomnik včeraj → zapadel
  const o1 = offer({ id: '1', status: 'draft', followUpAt: daysAgo(1) });
  eq('opomnik včeraj → due opomnik', followUpInfo(o1, NOW), { due: true, reason: 'opomnik', days: 1 });
  // Opomnik čez 2 dni → še ni na vrsti
  const o2 = offer({ id: '2', status: 'sent', followUpAt: daysAhead(2) });
  eq('opomnik čez 2 dni → ne due', followUpInfo(o2, NOW), { due: false, reason: null, days: -2 });
  // Opomnik danes ob 12:00 → zapadel (days = 0)
  const o3 = offer({ id: '3', status: 'sent', followUpAt: NOW.toISOString() });
  eq('opomnik danes → due, 0 dni', followUpInfo(o3, NOW), { due: true, reason: 'opomnik', days: 0 });
  // Opomnik velja tudi za osnutek (ročno nastavljen)
  const o4 = offer({ id: '4', status: 'draft', followUpAt: daysAgo(5) });
  eq('opomnik na osnutku → due opomnik', followUpInfo(o4, NOW).reason, 'opomnik');
}

// ─── 6) followUpInfo: brez odgovora SAMO za poslane ─────────
{
  const sent4 = offer({ id: '1', status: 'sent', sentAt: daysAgo(4), createdAt: daysAgo(5) });
  // ROČNO: 4 dni od sentAt ≥ 3 → brez odgovora
  eq('poslana 4 dni → brez-odgovora', followUpInfo(sent4, NOW), { due: true, reason: 'brez-odgovora', days: 4 });

  const sent2 = offer({ id: '2', status: 'sent', sentAt: daysAgo(2), createdAt: daysAgo(9) });
  eq('poslana 2 dni → še ne (9 dni starosti ne šteje)', followUpInfo(sent2, NOW), { due: false, reason: null, days: 0 });

  // Osnutek BREZ opomnika nikoli ni »brez odgovora« (stranka še ni videla)
  const draft9 = offer({ id: '3', status: 'draft', createdAt: daysAgo(9) });
  eq('osnutek 9 dni → ne due', followUpInfo(draft9, NOW), { due: false, reason: null, days: 0 });

  // Osnutek brez sentAt, a status sent → fallback na createdAt
  const sentNoStamp = offer({ id: '4', status: 'sent', createdAt: daysAgo(6) });
  eq('poslana brez sentAt → createdAt fallback', followUpInfo(sentNoStamp, NOW).reason, 'brez-odgovora');

  // Odločena ponudba nikoli ni za opomnik, niti s pretečenim followUpAt
  const acc = offer({ id: '5', status: 'accepted', followUpAt: daysAgo(10) });
  eq('sprejeta s pretečenim opomnikom → ne due', followUpInfo(acc, NOW), { due: false, reason: null, days: 0 });
  const rej = offer({ id: '6', status: 'rejected', sentAt: daysAgo(30) });
  eq('zavrnjena → ne due', followUpInfo(rej, NOW).due, false);

  ok('privzeto 3 dni', FOLLOW_UP_DEFAULT_DAYS === 3);
}

// ─── 7) dueFollowUps: sortiranje po nujnosti ────────────────
{
  const offers: PipelineOffer[] = [
    offer({ id: '1', status: 'sent', sentAt: daysAgo(2), createdAt: daysAgo(2) }),          // brez-odgovora (najnovejša)
    offer({ id: '2', status: 'sent', sentAt: daysAgo(10), createdAt: daysAgo(10) }),        // brez-odgovora najstarejša
    offer({ id: '3', status: 'draft', followUpAt: daysAgo(3) }),                            // opomnik (danes pretekel)
    offer({ id: '4', status: 'sent', followUpAt: daysAhead(4) }),                           // opomnik v prihodnosti → ne due
    offer({ id: '5', status: 'accepted' }),                                                 // nikoli
    offer({ id: '6', status: 'draft', followUpAt: daysAgo(7) }),                            // opomnik najstarejši
  ];
  const due = dueFollowUps(offers, NOW);
  // ROČNO: 3 due = opomnik id6 (pred 7 d), opomnik id3 (pred 3 d), brez-odgovora id2 (10 dni)
  eq('due seznam: 3 ponudbe', due.length, 3);
  eq('vrstni red: opomniki najprej po starosti', due.map((d) => d.id), ['6', '3', '2']);
  eq('razlog prve', due[0].info.reason, 'opomnik');
  eq('razlog zadnje', due[2].info.reason, 'brez-odgovora');
}

// ─── 8) nextStatusData: prehodi s časovnimi žigi ────────────
{
  const T1 = new Date('2026-02-11T12:00:00.000Z');
  const prevSent = new Date('2026-02-05T08:00:00.000Z');

  // draft → sent: nastavi sentAt zdaj, počisti ostalo
  const a = nextStatusData('sent', {}, T1);
  eq('→ sent: sentAt = zdaj', a.sentAt?.toISOString(), T1.toISOString());
  eq('→ sent: decidedAt null', a.decidedAt, null);
  eq('→ sent: followUpAt null', a.followUpAt, null);

  // ponovno → sent z obstoječim sentAt: IDEMPOTENTNO (ostane prvotni)
  const b = nextStatusData('sent', { sentAt: prevSent.toISOString() }, T1);
  eq('→ sent ponovno: sentAt ostane', b.sentAt?.toISOString(), prevSent.toISOString());

  // sent → accepted: decidedAt zdaj, followUpAt počiščen, sentAt ostane
  const c = nextStatusData('accepted', { sentAt: prevSent.toISOString() }, T1);
  eq('→ accepted: decidedAt = zdaj', c.decidedAt?.toISOString(), T1.toISOString());
  eq('→ accepted: sentAt ostane', c.sentAt?.toISOString(), prevSent.toISOString());
  eq('→ accepted: followUpAt počiščen', c.followUpAt, null);

  // accepted → rejected: decidedAt IDEMPOTENTNO ostane
  const prevDecided = new Date('2026-02-09T09:30:00.000Z');
  const d = nextStatusData('rejected', { decidedAt: prevDecided.toISOString() }, T1);
  eq('→ rejected: decidedAt ostane obstoječi', d.decidedAt?.toISOString(), prevDecided.toISOString());

  // → draft: decidedAt se počisti, sentAt ostane (iskrena zgodovina)
  const e = nextStatusData('draft', { sentAt: prevSent.toISOString(), decidedAt: prevDecided.toISOString() }, T1);
  eq('→ draft: decidedAt počiščen', e.decidedAt, null);
  eq('→ draft: sentAt ostane', e.sentAt?.toISOString(), prevSent.toISOString());

  // → draft, ki je bil NIKOLI poslan: sentAt ostane null
  const f = nextStatusData('draft', {}, T1);
  eq('→ draft brez zgodovine: sentAt null', f.sentAt, null);
}

// ─── 9) suggestFollowUpIso + formatFollowUpRelative ─────────
{
  eq('opomnik +3 dni', suggestFollowUpIso(NOW, 3), daysAhead(3));
  eq('opomnik +7 dni', suggestFollowUpIso(NOW, 7), daysAhead(7));

  eq('relativno: danes', formatFollowUpRelative(NOW.toISOString(), NOW), 'danes');
  eq('relativno: jutri', formatFollowUpRelative(daysAhead(1), NOW), 'jutri');
  eq('relativno: včeraj', formatFollowUpRelative(daysAgo(1), NOW), 'včeraj');
  eq('relativno: pred 2 dni', formatFollowUpRelative(daysAgo(2), NOW), 'pred 2 dni');
  eq('relativno: čez 3 dni', formatFollowUpRelative(daysAhead(3), NOW), 'čez 3 dni');
  eq('relativno: neveljaven', formatFollowUpRelative('ni datum', NOW), '');
}

// ─── 10) Determinizem ───────────────────────────────────────
{
  const offers: PipelineOffer[] = [
    offer({ id: '1', status: 'sent', sentAt: daysAgo(5), total: 1234.56 }),
    offer({ id: '2', status: 'accepted', sentAt: daysAgo(9), decidedAt: daysAgo(4), total: 999.99 }),
    offer({ id: '3', status: 'rejected', followUpAt: daysAgo(2), total: 50 }),
  ];
  const a = JSON.stringify(computePipelineStats(offers));
  const b = JSON.stringify(computePipelineStats(offers));
  eq('dva klica = enak rezultat', a, b);
  const d1 = JSON.stringify(dueFollowUps(offers, NOW).map((o) => [o.id, o.info]));
  const d2 = JSON.stringify(dueFollowUps(offers, NOW).map((o) => [o.id, o.info]));
  eq('dueFollowUps determinizem', d1, d2);
}

// ─── Poročilo ───────────────────────────────────────────────
console.log(`\n═══ offer-pipeline: ${pass} OK, ${fail} NAPAK ═══`);
if (failures.length > 0) {
  console.log('Neuspehi:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
