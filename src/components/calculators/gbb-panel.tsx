'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Layers, PlusCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import { buildGBB, gbbBandCheck, gbbDiffPct } from '@/lib/gbb';
import type { CraftId, CraftInputs } from '@/lib/types';

/** Opcije »Dobro · Boljše · Najboljše« za stranko.
 *  Raziskava (Leap, Joist, Housecall Pro, Eano): »three ways to say
 *  yes instead of one number to negotiate« — najvišja konverzija.
 *  Vse izvedbe so deterministične materialne lestvice iz istih mer
 *  (brez AI). */
export function GbbPanel({ craft, inputs, laborRate }: { craft: CraftId; inputs: CraftInputs; laborRate: number }) {
  const { toast } = useToast();
  const addItems = useDraft((s) => s.addItems);
  const setView = useView((s) => s.setView);

  const variants = useMemo(() => buildGBB(craft, inputs, laborRate), [craft, inputs, laborRate]);
  const band = useMemo(() => gbbBandCheck(variants.map((v) => v.total)), [variants]);

  if (variants.length < 2 || variants.every((v) => v.total <= 0)) return null;
  const base = variants[0].total;

  const addVariant = (vi: (typeof variants)[number]) => {
    if (vi.result.lines.length === 0) return;
    const items = vi.result.lines.map((l, i) => ({
      key: `gbb-${craft}-${vi.key}-${l.name}`,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
    }));
    addItems(items);
    toast({
      title: `Opcija »${vi.label}« dodana ✓`,
      description: `${items.length} postavk · ${formatEUR(vi.total)} brez DDV`,
    });
    setView('ponudbe');
  };

  return (
    <Card data-testid="gbb-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Opcije za stranko — dobro · boljše · najboljše
        </CardTitle>
        <CardDescription>
          Ista mera, tri izvedbe. Stranka izbere — ne se pogaja. Objektivno: vsaka opcija je
          izračunana iz istih mer z drugim materialom (skripte, brez AI).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          {variants.map((v) => {
            const diff = gbbDiffPct(v.total, base);
            return (
              <div
                key={v.key}
                className={`rounded-xl border p-3 flex flex-col gap-2 ${
                  v.isCurrent ? 'border-primary/60 bg-primary/5' : 'bg-card'
                }`}
                data-testid={`gbb-${v.key}`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <Badge variant={v.isCurrent ? 'default' : 'secondary'} className="text-xs">
                    {v.label}
                  </Badge>
                  {v.isCurrent && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      tvoja izbira
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">{v.tierName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                </div>
                <div className="mt-auto">
                  <p className="text-lg font-bold">{formatEUR(v.total)}</p>
                  <p className="text-xs text-muted-foreground">
                    brez DDV
                    {diff > 0 && <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">+{diff} %</span>}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {v.result.lines.slice(0, 3).map((l) => (
                      <li key={l.name} className="text-xs text-muted-foreground truncate">• {l.name}</li>
                    ))}
                    {v.result.lines.length > 3 && (
                      <li className="text-xs text-muted-foreground">• … in {v.result.lines.length - 3} drugi</li>
                    )}
                  </ul>
                </div>
                <Button
                  variant={v.isCurrent ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-9 w-full"
                  onClick={() => addVariant(v)}
                  data-testid={`gbb-add-${v.key}`}
                >
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                  Dodaj opcijo
                </Button>
              </div>
            );
          })}
        </div>
        {band && (
          <p
            className={`text-xs flex items-start gap-1.5 ${
              band.status === 'warn'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            }`}
            data-testid="gbb-band"
          >
            {band.status === 'warn' ? (
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            <span>
              <span className="font-medium">Cenovni pas (smernica: dobro ≥ 75 % in najboljše ≤ 150 % srednje opcije):</span>{' '}
              {band.note}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
