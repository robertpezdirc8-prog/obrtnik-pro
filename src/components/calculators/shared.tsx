'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { formatEUR, formatNum } from '@/lib/format';
import { craftInstallPlan } from '@/lib/install-plan';
import { MaterialPanel } from './material-panel';
import type { CalcLine, CraftId, CraftInputs } from '@/lib/types';

// ─── Vnosna polja ───────────────────────────────────────────

export function NumField({
  label, value, onChange, unit, step = 0.1, min = 0, max, placeholder, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="pr-12 h-10"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{unit}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SelField<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-2 rounded-md text-sm border transition-colors min-h-[40px] ${
              value === o.value
                ? 'bg-primary text-primary-foreground border-primary font-medium'
                : 'bg-card border-border hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BoolField({
  label, value, onChange, hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ─── Okvir kalkulatorja ─────────────────────────────────────

export interface CraftCalcProps {
  craft: CraftId;
  title: string;
  description: string;
  inputs: CraftInputs;
  setInputs: (patch: Partial<CraftInputs>) => void;
  compute: (inputs: CraftInputs) => { lines: CalcLine[]; summary: { label: string; value: string }[] };
  prefilled?: boolean;
  children: React.ReactNode;
}

export function CraftCalculator({ craft, title, description, inputs, setInputs, compute, prefilled, children }: CraftCalcProps) {
  const { toast } = useToast();
  const addItem = useDraft((s) => s.addItems);
  const setView = useView((s) => s.setView);
  const result = useMemo(() => compute(inputs), [compute, inputs]);
  const plan = useMemo(() => craftInstallPlan(craft, inputs), [craft, inputs]);
  const [priceOverrides, setPriceOverrides] = useState<Record<number, number>>({});

  const subtotal = result.lines.reduce(
    (s, l, i) => s + l.quantity * (priceOverrides[i] ?? l.unitPrice),
    0,
  );

  const handleAdd = () => {
    if (result.lines.length === 0) {
      toast({ title: 'Ni postavk', description: 'Najprej vnesi veljavne dimenzije.', variant: 'destructive' });
      return;
    }
    const stamp = Date.now();
    const items = result.lines.map((l, i) => ({
      key: `${craft}-${stamp}-${i}`,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: priceOverrides[i] ?? l.unitPrice,
    }));
    addItem(items);
    setPriceOverrides({});
    toast({
      title: 'Dodano v ponudbo ✓',
      description: `${items.length} postavk · ${formatEUR(subtotal)} brez DDV`,
    });
    setView('kalkulatorji');
  };

  return (
    <div className="space-y-4" data-craft={craft}>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {prefilled && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Vrednosti predpolnjene s pametne kamere — preveri jih in po potrebi popravi.
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vnos dimenzij</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>

        <div className="space-y-4">
          {result.summary.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Povzetek izračuna</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {result.summary.map((s) => (
                  <div key={s.label} className="rounded-lg bg-secondary/60 px-3 py-2">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-sm font-semibold">{s.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {result.lines.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Predlagane postavke</CardTitle>
                <CardDescription>Cene lahko pred dodajanjem prilagodiš.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-72 overflow-y-auto scroll-area -mx-1 px-1">
                  <div className="space-y-2">
                    {result.lines.map((l, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border p-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{l.name}</p>
                          {l.description && <p className="text-xs text-muted-foreground truncate">{l.description}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatNum(l.quantity)} {l.unit} ×{' '}
                            {formatEUR(priceOverrides[i] ?? l.unitPrice)}
                          </p>
                        </div>
                        <Input
                          type="number"
                          className="w-24 h-8 text-sm shrink-0"
                          value={priceOverrides[i] ?? l.unitPrice}
                          step={0.5}
                          min={0}
                          aria-label={`Cena za ${l.name}`}
                          onChange={(e) =>
                            setPriceOverrides((p) => ({ ...p, [i]: Number(e.target.value) }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Vsota (brez DDV)</p>
                    <p className="text-lg font-bold">{formatEUR(subtotal)}</p>
                  </div>
                  <Button onClick={handleAdd} size="lg" className="min-h-11">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Dodaj v ponudbo
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <MaterialPanel plan={plan} />
        </div>
      </div>
    </div>
  );
}
