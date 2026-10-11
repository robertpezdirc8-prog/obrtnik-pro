'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ClipboardList, Calculator } from 'lucide-react';
import { CRAFTS, craftBySlug } from '@/lib/crafts-meta';
import { useDraft, useView } from '@/lib/store';
import { calcTotals } from '@/lib/pricing';
import { formatEUR } from '@/lib/format';
import { OgrajeCalc, StopniceCalc, KeramikaCalc, WpcTerasaCalc, OknaVrataCalc, NadstresekCalc, FasadaCalc } from './calculators/crafts';
import { CraftImage } from './craft-image';

export function CalculatorsView() {
  const activeCraft = useView((s) => s.activeCraft);
  const setActiveCraft = useView((s) => s.setActiveCraft);
  const setView = useView((s) => s.setView);
  const items = useDraft((s) => s.items);

  const openDraft = () => {
    setActiveCraft(null);
    setView('kalkulatorji');
  };

  const draftTotals = calcTotals(items, 22);
  const craft = activeCraft ? craftBySlug(activeCraft) : undefined;

  return (
    <div className="space-y-6">
      {items.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-primary/30 bg-accent/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                Osnutek ponudbe: {items.length} postavk
              </p>
              <p className="text-xs text-muted-foreground">
                Vrednost brez DDV: {formatEUR(draftTotals.subtotal)}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={openDraft} className="sm:self-auto" variant="default">
            <Calculator className="mr-2 h-4 w-4" />
            Odpri ponudbo
          </Button>
        </div>
      )}

      {craft ? (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setActiveCraft(null)} className="-ml-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Vse dejavnosti
          </Button>
          {renderCraftCalc(craft.slug)}
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kalkulatorji odmerka</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Izberi dejavnost, vnesi dimenzije in izračun se pripravi samodejno.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CRAFTS.map((c) => (
              <button
                key={c.slug}
                onClick={() => setActiveCraft(c.slug)}
                className="group text-left rounded-xl border bg-card overflow-hidden hover:border-primary/40 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative h-32 w-full overflow-hidden bg-secondary">
                  <CraftImage src={c.image} alt={c.name} emoji={c.emoji} />
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <c.icon className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm">{c.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{c.short}</p>
                  <Badge variant="secondary" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    Odpri kalkulator →
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function renderCraftCalc(slug: string) {
  switch (slug) {
    case 'ograje': return <OgrajeCalc />;
    case 'stopnice': return <StopniceCalc />;
    case 'keramika': return <KeramikaCalc />;
    case 'wpc-terasa': return <WpcTerasaCalc />;
    case 'okna-vrata': return <OknaVrataCalc />;
    case 'nadstreški': return <NadstresekCalc />;
    case 'fasada': return <FasadaCalc />;
    default: return null;
  }
}
