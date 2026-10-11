'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, ClipboardList, Euro, FileCheck2, Hammer, ScanSearch } from 'lucide-react';
import { CRAFTS } from '@/lib/crafts-meta';
import { useDraft, useView } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import { CraftImage } from './craft-image';
import type { OfferDTO } from '@/lib/types';

export function Dashboard() {
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);
  const draftCount = useDraft((s) => s.items.length);
  const [offers, setOffers] = useState<OfferDTO[] | null>(null);

  useEffect(() => {
    fetch('/api/offers')
      .then((r) => r.json())
      .then((d) => setOffers(d.offers ?? []))
      .catch(() => setOffers([]));
  }, []);

  const totalValue = (offers ?? []).reduce((s, o) => s + o.total, 0);
  const accepted = (offers ?? []).filter((o) => o.status === 'accepted').length;

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
            <Button size="lg" variant="outline" className="min-h-12" onClick={() => { setActiveCraft(null); setView('kalkulatorji'); }}>
              <ClipboardList className="mr-2 h-5 w-5" />
              Ročni izračun
            </Button>
          </div>
          {draftCount > 0 && (
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

      {/* Dejavnosti */}
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
              Še ni ponudb — prvo ustvari z kalkulatorjem odmerka.
            </p>
            <Button onClick={() => setView('kalkulatorji')}>Začni</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {offers.slice(0, 4).map((o) => (
              <button
                key={o.id}
                onClick={() => setView('ponudbe')}
                className="w-full flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{o.customerName}</p>
                  <p className="text-xs text-muted-foreground">{o.number}</p>
                </div>
                <span className="font-bold text-primary shrink-0">{formatEUR(o.total)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
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
