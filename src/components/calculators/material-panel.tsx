'use client';

import { useMemo } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ShoppingCart, Scissors, ShieldCheck, Check, AlertTriangle,
  Info, XCircle, Wrench, PackageOpen, Trash2, Recycle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLeftovers } from '@/lib/store';
import { matchLeftovers, fmtLen } from '@/lib/leftovers';
import { plural } from '@/lib/install-plan';
import type { CheckStatus, InstallPlan } from '@/lib/install-plan';

const STATUS_META: Record<CheckStatus, { icon: React.ElementType; cls: string }> = {
  ok: { icon: Check, cls: 'text-emerald-600 dark:text-emerald-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
  bad: { icon: XCircle, cls: 'text-red-600 dark:text-red-400' },
  info: { icon: Info, cls: 'text-muted-foreground' },
};

/** "Material & montaža" — samodejni nakup, rezalni načrt, kontrole
 *  in sklad ostankov. Vse izračunano z determinističnimi skriptami
 *  iz vnesenih mer (brez AI). */
export function MaterialPanel({ plan, craft }: { plan: InstallPlan; craft: string }) {
  const { toast } = useToast();
  const leftoverItems = useLeftovers((s) => s.items);
  const addLeftovers = useLeftovers((s) => s.add);
  const removeLeftover = useLeftovers((s) => s.remove);
  const clearCraft = useLeftovers((s) => s.clearCraft);

  const craftLeftovers = leftoverItems.filter((i) => i.craft === craft);
  const planLeftovers = plan.cuts.flatMap((c) => c.leftovers);

  // Deterministično povezovanje skladišča z zahtevanimi kosi načrta
  const match = useMemo(() => {
    if (craftLeftovers.length === 0) return null;
    const pool = craftLeftovers.flatMap((i) => Array(Math.max(1, i.count ?? 1)).fill(i.lengthM));
    const pieces = plan.cuts.flatMap((c) => c.pieces);
    if (pieces.length === 0) return null;
    return matchLeftovers(pieces, pool);
  }, [craftLeftovers, plan.cuts]);

  if (plan.buys.length === 0 && plan.cuts.length === 0 && plan.checks.length === 0) {
    return null;
  }

  const warns = plan.checks.filter((c) => c.status === 'warn' || c.status === 'bad').length;

  const savePlanLeftovers = () => {
    if (planLeftovers.length === 0) return;
    // Enaki ostanki se grupirajo v en vnos s števcem
    const grouped = new Map<number, number>();
    for (const l of planLeftovers) {
      grouped.set(l, (grouped.get(l) ?? 0) + 1);
    }
    const stamp = Date.now();
    addLeftovers(
      Array.from(grouped.entries()).map(([lengthM, count], i) => ({
        id: `lo-${craft}-${stamp}-${i}`,
        craft,
        lengthM,
        count,
        label: 'Iz rezalnega načrta',
        createdAt: new Date().toISOString(),
      })),
    );
    toast({
      title: 'Ostanki shranjeni v sklad ✓',
      description: `${planLeftovers.length} kosov je zdaj na voljo za prihodnje projekte.`,
    });
  };

  return (
    <Card data-testid="material-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Material &amp; montaža
          {warns > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              {warns} {plural(warns, ['opozorilo', 'opozorili', 'opozorila', 'opozoril'])}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Nakup, rezi, kontrole in ostanki — izračunane iz mer s skriptami, brez AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.buys.length > 0 && (
          <section aria-label="Nakup materiala" className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShoppingCart className="h-3.5 w-3.5" />
              Nakup materiala
            </h3>
            <ul className="space-y-1.5">
              {plan.buys.map((b) => (
                <li key={b.label} className="rounded-lg border bg-secondary/40 px-3 py-2">
                  <p className="text-sm font-medium">{b.label}</p>
                  <p className="text-xs text-muted-foreground">{b.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.cuts.length > 0 && (
          <section aria-label="Rezalni načrt" className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Scissors className="h-3.5 w-3.5" />
              Rezalni načrt
            </h3>
            {plan.cuts.map((c) => (
              <div key={c.title} className="rounded-lg border bg-secondary/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs font-semibold text-primary">{c.summary}</p>
                </div>
                <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                  {c.bars.map((bar) => (
                    <li key={bar} className="truncate">{bar}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {/* Sklad ostankov — raziskava: monterji ostanke vozijo po kombiju
            in jih pozabijo; apps (handifox, protrak) jih štejejo po lokacijah. */}
        {(craftLeftovers.length > 0 || planLeftovers.length > 0) && (
          <section aria-label="Sklad ostankov" className="space-y-1.5" data-testid="leftovers-section">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <PackageOpen className="h-3.5 w-3.5" />
              Sklad ostankov
            </h3>

            {craftLeftovers.length > 0 && (
              <div className="rounded-lg border bg-secondary/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    Na zalogi: {craftLeftovers.reduce((s, i) => s + Math.max(1, i.count ?? 1), 0)}{' '}
                    {craftLeftovers.reduce((s, i) => s + Math.max(1, i.count ?? 1), 0) === 1 ? 'kos' : 'kosov'} ·{' '}
                    {fmtLen(craftLeftovers.reduce((s, i) => s + i.lengthM * Math.max(1, i.count ?? 1), 0))} skupaj
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearCraft(craft);
                      toast({ title: 'Sklad ostankov izpraznjen' });
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive min-h-[28px]"
                  >
                    izprazni
                  </button>
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {craftLeftovers.map((i) => {
                    const count = Math.max(1, i.count ?? 1);
                    return (
                      <li
                        key={i.id}
                        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs"
                      >
                        <Recycle className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        {count > 1 ? `${fmtLen(i.lengthM)} × ${count}` : fmtLen(i.lengthM)}
                        <button
                          type="button"
                          aria-label={`Odstrani ostanek ${fmtLen(i.lengthM)}`}
                          onClick={() => removeLeftover(i.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {match && match.covered > 0 && (
                  <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1.5" data-testid="leftover-match">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Ostanki pokrijejo {match.covered} od {match.total} kosov tega načrta — prihranek do {fmtLen(match.savedLM)} nabave
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {match.details.slice(0, 4).map((d) => (
                        <li key={d} className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 font-mono truncate">{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {match && match.covered === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ostanki so prekratki za kose tega načrta (potrebuješ {fmtLen(Math.min(...plan.cuts.flatMap((c) => c.pieces), Infinity))} ali več).
                  </p>
                )}
              </div>
            )}

            {planLeftovers.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Ta načrt pušča uporabne ostanke: {planLeftovers.map((l) => fmtLen(l)).join(' · ')}
                </p>
                <Button variant="outline" size="sm" className="h-8 min-h-8 text-xs shrink-0" onClick={savePlanLeftovers} data-testid="save-leftovers">
                  <PackageOpen className="mr-1.5 h-3.5 w-3.5" />
                  Shrani v sklad
                </Button>
              </div>
            )}
          </section>
        )}

        {plan.checks.length > 0 && (
          <section aria-label="Kontrole in predpisi" className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Kontrole in predpisi
            </h3>
            <ul className="space-y-1.5">
              {plan.checks.map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                return (
                  <li key={c.label} className="flex items-start gap-2 rounded-lg border px-3 py-2" data-status={c.status}>
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.cls}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
