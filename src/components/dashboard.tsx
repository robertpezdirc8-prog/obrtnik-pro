'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Banknote, BellRing, Check, ClipboardList, Euro, FileCheck2, Hammer, ScanSearch, X } from 'lucide-react';
import { CRAFTS } from '@/lib/crafts-meta';
import { useDraft, useView } from '@/lib/store';
import { formatDate, formatEUR, STATUS_LABELS } from '@/lib/format';
import {
  actionableInvoices,
  computeReceivables,
  dunningLevel,
  formatDueRelative,
  suggestDueIso,
  type PaymentInvoice,
} from '@/lib/payment-tracking';
import {
  computePipelineStats,
  dueFollowUps,
  followUpInfo,
  formatFollowUpRelative,
  MIN_DECIDED_FOR_WINRATE,
  type PipelineOffer,
} from '@/lib/offer-pipeline';
import { CraftImage } from './craft-image';
import { useSessionGate } from './auth/login-gate';
import { normalizeRole } from '@/lib/permissions';
import type { InvoiceDTO, OfferDTO } from '@/lib/types';

export function Dashboard() {
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);
  const draftCount = useDraft((s) => s.items.length);
  // Vloga (Task 97): montir vidi ponudbe (GET), NE pa računov in
  // lastniških akcij. Brez seje (privzeti način) = lastnik, kot do zdaj.
  const sessionGate = useSessionGate();
  const isMontir = normalizeRole(sessionGate?.user.role) === 'montir';
  const [offers, setOffers] = useState<OfferDTO[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDTO[] | null>(null);

  const load = useCallback(() => {
    fetch('/api/offers')
      .then((r) => r.json())
      .then((d) => setOffers(d.offers ?? []))
      .catch(() => setOffers([]));
    // Montir: računov ne sprašuj (403 je garancija, ne napaka) —
    // odsek Terjatve je zanj skrit, stanje ostane null (nič ne izmišljujem).
    if (!isMontir) {
      fetch('/api/invoices')
        .then((r) => r.json())
        .then((d) => setInvoices(d.invoices ?? []))
        .catch(() => setInvoices([]));
    }
  }, [isMontir]);

  useEffect(() => {
    load();
  }, [load]);

  const totalValue = (offers ?? []).reduce((s, o) => s + o.total, 0);
  const accepted = (offers ?? []).filter((o) => o.status === 'accepted').length;
  const stats = offers ? computePipelineStats(offers) : null;
  const due = offers ? dueFollowUps(offers, new Date()).slice(0, 4) : [];

  // Terjatve — InvoiceDTO je strukturno PaymentInvoice (žigi dodeljuje strežnik)
  const receivables = invoices ? computeReceivables(invoices as unknown as PaymentInvoice[], new Date()) : null;
  const payDue = invoices ? actionableInvoices(invoices as unknown as PaymentInvoice[], new Date()).slice(0, 4) : [];

  /** Hitra akcija na računu (plačilo ali premik roka). */
  const patchInvoice = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) load();
  };

  /** Hitra akcija na ponudbi iz opomnika (status ali premik opomnika). */
  const patchOffer = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/offers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) load();
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-accent via-card to-secondary px-6 py-10 sm:px-10">
        <div className="relative max-w-2xl">
          <Badge variant="secondary" className="mb-3">
            <Hammer className="mr-1.5 h-3 w-3" />
            Digitalni pomočnik obrtnika
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Od fotke do podpisanega naročila
          </h1>
          <p className="mt-3 text-muted-foreground sm:text-lg">
            Fotografiraj objekt — pametna kamera prepozna, kaj je in koliko veliko.
            Kalkulatorji odmerka in profesionalne ponudbe za ograje, stopnice,
            keramiko, WPC terase, okna in vrata, nadstreške in fasade —
            kar na terenu, v 10 minutah.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" className="min-h-12" onClick={() => setView('kamera')}>
              <ScanSearch className="mr-2 h-5 w-5" />
              Fotografiraj — samodejna analiza
            </Button>
            {!isMontir && (
              <Button size="lg" variant="outline" className="min-h-12" onClick={() => { setActiveCraft(null); setView('kalkulatorji'); }}>
                <ClipboardList className="mr-2 h-5 w-5" />
                Ročni izračun
              </Button>
            )}
          </div>
          {draftCount > 0 && !isMontir && (
            <button
              onClick={() => { setActiveCraft(null); setView('kalkulatorji'); }}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Nadaljuj z osnutkom ({draftCount} postavk)
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>

      {/* Statistika */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Vse ponudbe"
          value={offers === null ? '…' : String(offers.length)}
        />
        <StatCard
          icon={<Euro className="h-4 w-4" />}
          label="Vrednost skupaj"
          value={offers === null ? '…' : formatEUR(totalValue)}
        />
        <StatCard
          icon={<FileCheck2 className="h-4 w-4" />}
          label="Sprejete"
          value={offers === null ? '…' : String(accepted)}
        />
        <StatCard
          icon={<Hammer className="h-4 w-4" />}
          label="Osnutek v delu"
          value={String(draftCount)}
        />
      </section>

      {/* Sledenje ponudbam — lijak + iskren win-rate + opomniki */}
      <section aria-label="Sledenje ponudbam" className="rounded-2xl border bg-card">
        <div className="flex flex-col gap-1 p-4 pb-3 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Sledenje ponudbam</h2>
            <p className="text-sm text-muted-foreground">
              Lijak, stopnja uspešnosti in opomniki — brez pozabljenih ponudb.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setView('ponudbe')}>
            Vse ponudbe <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>

        {offers === null || stats === null ? (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-4">
            {/* Lijak + win-rate */}
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="funnel">
                <FunnelChip label={STATUS_LABELS.draft} value={stats.counts.draft} hint="še ni poslanih" />
                <FunnelChip label={STATUS_LABELS.sent} value={stats.counts.sent} hint={formatEUR(stats.valueSent)} />
                <FunnelChip label={STATUS_LABELS.accepted} value={stats.counts.accepted} hint={formatEUR(stats.valueAccepted)} tone="good" />
                <FunnelChip label={STATUS_LABELS.rejected} value={stats.counts.rejected} hint={formatEUR(stats.valueRejected)} tone="bad" />
              </div>
              <div className="rounded-xl border bg-secondary/40 p-3 sm:min-w-44" data-testid="winrate">
                <p className="text-xs text-muted-foreground mb-1">Stopnja uspešnosti</p>
                {stats.winRate === null ? (
                  <p className="text-sm font-medium text-muted-foreground" title={`Iskreno: ${stats.decided} odločenih ponudb je premalo (najmanj ${MIN_DECIDED_FOR_WINRATE}).`}>
                    — <span className="text-xs">premalo podatkov</span>
                  </p>
                ) : (
                  <p className="text-2xl font-bold text-primary leading-none">
                    {formatFollowPercent(stats.winRate)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {stats.counts.accepted}/{stats.decided} odločenih
                    </span>
                  </p>
                )}
                {stats.avgAccepted !== null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    povprečno sprejeto {formatEUR(stats.avgAccepted)}
                  </p>
                )}
              </div>
            </div>

            {/* Opomniki (Wiedervorlage) */}
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <BellRing className="h-4 w-4 text-amber-600" />
                Za opomnik
              </p>
              {due.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-xl border border-dashed p-3">
                  Ni ponudb za opomnik — vse poslane imajo odgovor ali čakajo na nastavljeni rok.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="due-list">
                  {due.map((o) => (
                    <li key={o.id} className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {o.customerName}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{o.number}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o.info.reason === 'opomnik'
                            ? `Opomnik: ${formatFollowUpRelative(o.followUpAt ?? '', new Date())}`
                            : `${o.info.days} dni brez odgovora`}{' '}
                          · {formatEUR(o.total)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!isMontir && o.status === 'draft' && (
                          <Button size="sm" variant="outline" className="min-h-9 h-9" onClick={() => patchOffer(o.id, { status: 'sent' })}>
                            Poslana
                          </Button>
                        )}
                        {!isMontir && (
                          <>
                            <Button size="sm" variant="outline" className="min-h-9 h-9 border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300" onClick={() => patchOffer(o.id, { status: 'accepted' })}>
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Sprejeta
                            </Button>
                            <Button size="sm" variant="outline" className="min-h-9 h-9 border-red-600/30 text-red-700 hover:bg-red-50 dark:text-red-300" onClick={() => patchOffer(o.id, { status: 'rejected' })}>
                              <X className="mr-1 h-3.5 w-3.5" />
                              Zavrnjena
                            </Button>
                            <Button size="sm" variant="ghost" className="min-h-9 h-9 text-xs" onClick={() => patchOffer(o.id, { followUpAt: suggestIso(3) })}>
                              +3 dni
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Terjatve — samo LASTNIK (montir računov ne vidi: 403 je
          garancija, tu pa jih sploh ne izrišemo) */}
      {!isMontir && (
      <section aria-label="Terjatve" className="rounded-2xl border bg-card">
        <div className="flex flex-col gap-1 p-4 pb-3 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Terjatve</h2>
            <p className="text-sm text-muted-foreground">
              Kaj je neplačano, kaj zapadlo in kdaj pošteno poslati opomnik.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setView('ponudbe')}>
            Računi v ponudbah <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>

        {invoices === null || receivables === null ? (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="receivables-chips">
                <FunnelChip
                  label="Odprto"
                  value={receivables.counts.unpaid}
                  hint={formatEUR(receivables.outstandingTotal)}
                />
                <FunnelChip
                  label="Zapadle"
                  value={receivables.counts.overdue}
                  hint={
                    receivables.worstOverdueDays !== null
                      ? `najdaljša ${receivables.worstOverdueDays} dni · ${formatEUR(receivables.overdueTotal)}`
                      : 'nič zapadlega'
                  }
                  tone={receivables.counts.overdue > 0 ? 'bad' : undefined}
                />
                <FunnelChip
                  label="Plačano ta mesec"
                  hint={formatEUR(receivables.paidThisMonthTotal)}
                  value={receivables.counts.paid}
                  tone="good"
                />
              </div>
              <div className="rounded-xl border bg-secondary/40 p-3 sm:min-w-44" data-testid="avg-payment">
                <p className="text-xs text-muted-foreground mb-1">Povprečno plačilo</p>
                {receivables.avgDaysToPay === null ? (
                  <p
                    className="text-sm font-medium text-muted-foreground"
                    title={`Iskreno: manj kot ${3} plačanih računov je premalo za povprečje.`}
                  >
                    — <span className="text-xs">premalo podatkov</span>
                  </p>
                ) : (
                  <p className="text-2xl font-bold text-primary leading-none">
                    {receivables.avgDaysToPay.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">dni</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">od izdaje do plačila</p>
              </div>
            </div>

            {/* Opomniki plačil (zapadle + rok se izteka) */}
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Banknote className="h-4 w-4 text-amber-600" />
                Za plačilo / opomnik
              </p>
              {payDue.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-xl border border-dashed p-3">
                  Nič zapadlega, rok se ne izteka — terjatve pod nadzorom.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="payment-due-list">
                  {payDue.map(({ inv, info }) => {
                    const dun = dunningLevel(inv, new Date());
                    return (
                      <li
                        key={inv.id}
                        className="flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {inv.customerName}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">{inv.number}</span>
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={
                                dun.level === 0
                                  ? 'border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0'
                                  : dun.level === 1
                                    ? 'border-amber-500/60 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 px-1.5 py-0'
                                    : 'border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0'
                              }
                            >
                              {dun.label}
                            </Badge>
                            {formatDueRelative(info, new Date())} · {formatEUR(inv.total)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-9 h-9 border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"
                            data-testid={`pay-done-${inv.number}`}
                            onClick={() => patchInvoice(inv.id, { paidAt: new Date().toISOString() })}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Plačano
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-9 h-9 text-xs"
                            onClick={() => patchInvoice(inv.id, { dueAt: suggestDueIso(new Date(), 7) })}
                          >
                            +7 dni rok
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
      )}

      {/* Dejavnosti — montažna navodila in odmerek so lastniško orodje
          za odmero ponudbe; montir delo vidi v ponudbah */}
      {!isMontir && (
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Kalkulatorji po dejavnostih</h2>
            <p className="text-sm text-muted-foreground">7 dejavnosti — odmerek, material in montaža.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setView('kalkulatorji')}>
            Vse <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CRAFTS.map((c) => (
            <button
              key={c.slug}
              onClick={() => { setActiveCraft(c.slug); setView('kalkulatorji'); }}
              className="group text-left rounded-xl border bg-card overflow-hidden hover:border-primary/40 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="h-24 w-full overflow-hidden bg-secondary">
                <CraftImage src={c.image} alt={c.name} emoji={c.emoji} />
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <c.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-sm">{c.name}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      )}

      {/* Zadnje ponudbe */}
      <section>
        <h2 className="text-xl font-bold tracking-tight mb-4">Zadnje ponudbe</h2>
        {offers === null ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : offers.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {isMontir
                ? 'Še ni ponudb — lastnik jih ustvari s kalkulatorjem odmerka.'
                : 'Še ni ponudb — prvo ustvari z kalkulatorjem odmerka.'}
            </p>
            {!isMontir && <Button onClick={() => setView('kalkulatorji')}>Začni</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            {offers.slice(0, 4).map((o) => (
              <OfferRow key={o.id} offer={o} onClick={() => setView('ponudbe')} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function suggestIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function formatFollowPercent(v: number): string {
  return `${v.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} %`;
}

function FunnelChip({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'good' ? 'border-emerald-600/30 bg-emerald-50/60 dark:bg-emerald-950/20' : tone === 'bad' ? 'border-red-600/20 bg-red-50/50 dark:bg-red-950/20' : 'bg-secondary/30'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

function OfferRow({ offer, onClick }: { offer: OfferDTO; onClick: () => void }) {
  const info = followUpInfo(offer, new Date());
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">{offer.customerName}</p>
        <p className="text-xs text-muted-foreground">
          {offer.number} · {formatDate(offer.createdAt)}
          {info.due && info.reason === 'opomnik' && (
            <span className="ml-1.5 text-amber-700 dark:text-amber-300">· opomnik {formatFollowUpRelative(offer.followUpAt ?? '', new Date())}</span>
          )}
          {info.due && info.reason === 'brez-odgovora' && (
            <span className="ml-1.5 text-amber-700 dark:text-amber-300">· {info.days} dni brez odgovora</span>
          )}
        </p>
      </div>
      <span className="font-bold text-primary shrink-0">{formatEUR(offer.total)}</span>
    </button>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
        <span className="text-primary">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-lg sm:text-xl font-bold truncate">{value}</p>
    </div>
  );
}
