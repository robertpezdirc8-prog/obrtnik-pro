'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Layers, PlusCircle, CheckCircle2, AlertTriangle, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import { plural } from '@/lib/install-plan';
import { buildGBB, gbbBandCheck, gbbDiffPct } from '@/lib/gbb';
import { type CenikValues } from '@/lib/cenik';
import type { CraftId, CraftInputs } from '@/lib/types';

const POSTAVKE: [string, string, string, string] = ['postavka', 'postavki', 'postavke', 'postavk'];

/** Opcije »Dobro · Boljše · Najboljše« za stranko.
 *  Raziskava (Leap, Joist, Housecall Pro, Eano): »three ways to say
 *  yes instead of one number to negotiate« — najvišja konverzija.
 *  Vse izvedbe so deterministične materialne lestvice iz istih mer
 *  (brez AI).
 *
 *  Task 88: lestvica izbere IZVEDBO, ne cene. Vsaka opcija svojo ceno
 *  povleče iz Cenika, zato je lahko BREZ zneska — dokler obrtnik cene ni
 *  vpisal, se na zaslonu ne pojavi nobena številka in opcije ni mogoče
 *  dodati v ponudbo. Tri številke, ki jih ni napisal človek, bi bile
 *  ponudba, ki se jo pogaja z lastno aplikacijo. */
export function GbbPanel({ craft, inputs, values }: { craft: CraftId; inputs: CraftInputs; values: CenikValues }) {
  const { toast } = useToast();
  const addItems = useDraft((s) => s.addItems);
  const setView = useView((s) => s.setView);

  const variants = useMemo(() => buildGBB(craft, inputs, values), [craft, inputs, values]);
  const band = useMemo(() => gbbBandCheck(variants.map((v) => v.total)), [variants]);

  if (variants.length < 2) return null;
  const base = variants[0].total;

  const addVariant = (vi: (typeof variants)[number]) => {
    if (vi.result.lines.length === 0) return;
    if (vi.total === null) {
      toast({
        title: 'Cena ni vpisana',
        description: `${vi.unpriced.map((l) => l.name).join(', ')} — ceno vpiši v Ceniku. Opcije nismo dodali.`,
        variant: 'destructive',
      });
      return;
    }
    const items = vi.result.lines.map((l) => ({
      key: `gbb-${craft}-${vi.key}-${l.name}`,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      ...(l.priceKey ? { priceKey: l.priceKey } : {}),
    }));
    addItems(items);
    toast({
      title: `Opcija »${vi.label}« dodana ✓`,
      description: `${items.length} ${plural(items.length, POSTAVKE)} · ${formatEUR(vi.total)} brez DDV`,
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
          izračunana iz istih mer z drugim materialom (skripte, brez AI). Znesek vsake izvedbe
          sestavi tvoja cena iz Cenika; številke v kodi ni.
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
                  {v.total === null ? (
                    <p
                      className="text-sm font-semibold text-amber-700 dark:text-amber-400"
                      data-testid={`gbb-unpriced-${v.key}`}
                    >
                      {v.unpriced.length} {v.unpriced.length === 1 ? 'vrstica nima' : 'vrstice nimajo'} vpisane cene — znesek ni izračunan
                    </p>
                  ) : (
                    <p className="text-lg font-bold">{formatEUR(v.total)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    brez DDV
                    {diff !== null && diff > 0 && <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">+{diff} %</span>}
                  </p>
                  {v.total === null && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {v.unpriced.slice(0, 2).map((l) => l.name).join(' · ')}
                      {v.unpriced.length > 2 && ` · … in ${v.unpriced.length - 2} drugih`}
                    </p>
                  )}
                  <ul className="mt-1.5 space-y-0.5">
                    {v.result.lines.slice(0, 3).map((l, i) => (
                      <li key={`${l.name}-${i}`} className="text-xs text-muted-foreground truncate">• {l.name}</li>
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
                  disabled={v.total === null}
                  data-testid={`gbb-add-${v.key}`}
                >
                  {v.total === null ? (
                    <>
                      <Wallet className="mr-1.5 h-4 w-4" />
                      Najprej vpiši ceno
                    </>
                  ) : (
                    <>
                      <PlusCircle className="mr-1.5 h-4 w-4" />
                      Dodaj opcijo
                    </>
                  )}
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
