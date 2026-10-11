'use client';

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  ShoppingCart, Scissors, ShieldCheck, Check, AlertTriangle,
  Info, XCircle, Wrench,
} from 'lucide-react';
import type { CheckStatus, InstallPlan } from '@/lib/install-plan';

const STATUS_META: Record<CheckStatus, { icon: React.ElementType; cls: string }> = {
  ok: { icon: Check, cls: 'text-emerald-600 dark:text-emerald-400' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
  bad: { icon: XCircle, cls: 'text-red-600 dark:text-red-400' },
  info: { icon: Info, cls: 'text-muted-foreground' },
};

/** "Material & montaža" — samodejni nakup, rezalni načrt in kontrole.
 *  Vse izračunano z determinističnimi skriptami iz vnesenih mer (brez AI). */
export function MaterialPanel({ plan }: { plan: InstallPlan }) {
  if (plan.buys.length === 0 && plan.cuts.length === 0 && plan.checks.length === 0) {
    return null;
  }

  const warns = plan.checks.filter((c) => c.status === 'warn' || c.status === 'bad').length;

  return (
    <Card data-testid="material-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Material &amp; montaža
          {warns > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              {warns} opozoril
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Nakup, rezi in kontrole izračunane iz mer — čiste skripte, brez AI.
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
