'use client';

// ─── Prikaz rezultatov samodejne analize + predlogi izdelkov ───────
// Vključno z interaktivnim MERILNIM NAČRTOM (measurementsNeeded →
// checklist z oznakami "izmerjeno", shranjeno po fotografiji).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sparkles, CheckCircle2, AlertTriangle, Ruler, Calculator, PlusCircle, Info, Lightbulb, Layers3, Package, ShieldAlert, ClipboardList, Circle, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCenik } from '@/hooks/use-cenik';
import { useDraft } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import { CRAFT_LABELS, type AnalyzeResponse, type PhotoAnalysis, type SuggestedProduct } from '@/lib/camera-types';
import type { CraftId } from '@/lib/types';
import { craftBySlug } from '@/lib/crafts-meta';

interface AnalysisPanelProps {
  result: AnalyzeResponse;
  onOpenCalculator: () => void;
  /** Id fotografije — ključ za shranjevanje merilnega načrta. */
  planKey?: string | null;
}

const PLAN_LS_PREFIX = 'obrtnik-na';

export function AnalysisPanel({ result, onOpenCalculator, planKey }: AnalysisPanelProps) {
  const { analysis, suggestedProducts } = result;
  const { toast } = useToast();
  const addItems = useDraft((s) => s.addItems);
  const cenik = useCenik();

  // ── Merilni načrt: done-stanja po fotki (localStorage) ──
  // Lazy init + remount prek key propa (camera-view) namesto set-state v efektu.
  const planLsKey = `${PLAN_LS_PREFIX}-${planKey ?? 'ad-hoc'}`;
  const [planDone, setPlanDone] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(`${PLAN_LS_PREFIX}-${planKey ?? 'ad-hoc'}`);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const togglePlanItem = (idx: number) => {
    setPlanDone((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      try { window.localStorage.setItem(planLsKey, JSON.stringify(next)); } catch { /* ni kritično */ }
      return next;
    });
  };
  const resetPlan = () => {
    setPlanDone({});
    try { window.localStorage.removeItem(planLsKey); } catch { /* ni kritično */ }
  };

  const craftLabel = CRAFT_LABELS[analysis.craft];
  const craftMeta = analysis.craft !== 'drugo' ? craftBySlug(analysis.craft as CraftId) : undefined;
  const hasPrefill = Object.keys(analysis.prefill).length > 0;
  const planDoneCount = analysis.measurementsNeeded.reduce((n, _m, i) => n + (planDone[i] ? 1 : 0), 0);

  const addProduct = (p: SuggestedProduct) => {
    // Kamera predlaga IZDELEK, ne ceno. Cena je lahko vpisana v Ceniku (po
    // `sku`), sicer postavka gre v osnutek brez nje in jo mora obrtnik
    // dopisati sam — aplikacija je ne ugiblje (Task 88).
    const price = p.sku ? cenik.priceOf(p.sku) : null;
    addItems([{
      key: `pred-${p.id}`,
      name: p.name,
      quantity: 1,
      unit: p.unit,
      unitPrice: price,
      productId: p.id,
      ...(p.sku ? { priceKey: p.sku } : {}),
    }]);
    toast({
      title: price === null ? 'Dodano brez cene — ceno vpiši' : 'Dodano v osnutek ✓',
      description: price === null
        ? `${p.name} · 1 ${p.unit}. Vpiši ceno v ponudbi ali v Ceniku; brez cene ponudbe ni mogoče shraniti.`
        : `${p.name} · ${formatEUR(price)} / ${p.unit}`,
      variant: price === null ? 'destructive' : 'default',
    });
  };

  // Združevanje predpolnitev (analiza + izmerjene vrednosti) opravi camera-view.
  const openCalculator = () => onOpenCalculator();

  return (
    <div className="space-y-4" data-testid="photo-analysis">
      {/* Glava analize */}
      <div className="rounded-xl border bg-gradient-to-br from-accent/70 to-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="text-sm font-bold">{craftLabel}</p>
              <p className="text-xs text-muted-foreground">Samodejno prepoznavanje</p>
            </div>
          </div>
          {analysis.estimatedAreaM2 !== null && (
            <Badge variant="secondary" className="text-xs">
              ≈ {analysis.estimatedAreaM2.toLocaleString('sl-SI')} m²
            </Badge>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Zaupanje</span>
            <span className="font-semibold text-foreground">{Math.round(analysis.craftConfidence)} %</span>
          </div>
          <Progress value={analysis.craftConfidence} className="h-2" />
        </div>
        <p className="text-sm text-muted-foreground">{analysis.sceneDescription}</p>
      </div>

      {/* Zaznani objekti */}
      {analysis.objects.length > 0 && (
        <section aria-label="Zaznani objekti">
          <h3 className="mb-2 text-sm font-bold">Kaj je skripta zaznala ({analysis.objects.length})</h3>
          <div className="max-h-72 space-y-2 overflow-y-auto scroll-area pr-1">
            {analysis.objects.map((o, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border p-2.5">
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">{o.count}×</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{o.label}</p>
                  {(o.estWidthCm !== null || o.estHeightCm !== null) && (
                    <p className="text-xs text-primary font-medium">
                      ≈ {o.estWidthCm !== null ? `${o.estWidthCm} cm` : '?'} × {o.estHeightCm !== null ? `${o.estHeightCm} cm` : '?'}
                    </p>
                  )}
                  {o.note && <p className="mt-0.5 text-xs text-muted-foreground">{o.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Zaznane ravnine */}
      {analysis.surfaces.length > 0 && (
        <section aria-label="Zaznane ravnine">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <Layers3 className="h-4 w-4 text-amber-600" />
            Ravnine za merjenje ({analysis.surfaces.length})
          </h3>
          <div className="space-y-2">
            {analysis.surfaces.map((s, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{s.label}</p>
                  {s.estAreaM2 !== null && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">≈ {s.estAreaM2.toLocaleString('sl-SI')} m²</Badge>
                  )}
                </div>
                {s.note && <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Način „Ravnina“ na fotografiji: 4 oglišča + realna širina/višina → merjenje s perspektivno korekcijo.
            </p>
          </div>
        </section>
      )}

      {/* Materiali */}
      {analysis.materials.length > 0 && (
        <section aria-label="Materiali">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <Package className="h-4 w-4 text-primary" />
            Materiali na objektu
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {analysis.materials.map((m, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{m}</Badge>
            ))}
          </div>
        </section>
      )}

      {/* Tveganja / napake */}
      {analysis.hazards.length > 0 && (
        <section aria-label="Tveganja in napake">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Napake / tveganja ({analysis.hazards.length})
          </h3>
          <ul className="space-y-1.5">
            {analysis.hazards.map((h, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Obseg dela */}
      {analysis.scope && (
        <div className="flex items-start gap-2.5 rounded-xl border bg-card p-3">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">Obseg dela</p>
            <p className="text-sm text-muted-foreground">{analysis.scope}</p>
          </div>
        </div>
      )}

      {/* Referenčni objekt za umerjanje */}
      {analysis.reference && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Merilo za umerjanje: {analysis.reference.label} ≈ {analysis.reference.assumedCm} cm
              {analysis.scaleSuggestions.length > 0 && (() => {
                const best = analysis.scaleSuggestions[0];
                return (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      best.confidenceLabel === 'visoka'
                        ? 'bg-green-100 text-green-800'
                        : best.confidenceLabel === 'srednja'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                    }`}
                    data-testid="analysis-scale-confidence"
                  >
                    zanesljivost {best.confidence}/100
                  </span>
                );
              })()}
            </p>
            <p className="text-xs text-muted-foreground">{analysis.reference.explanation}</p>
            {analysis.scaleSuggestions.length > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Še {analysis.scaleSuggestions.length - 1} alternativ{' '}
                {analysis.scaleAgreement === 'high'
                  ? '(merila se ujemajo ✓)'
                  : analysis.scaleAgreement === 'low'
                    ? '(⚠ merila se NE ujemajo — preveri ročno)'
                    : ''}{' '}
                — v zavihku merjenja.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Merilni načrt — interaktiven checklist */}
      {analysis.measurementsNeeded.length > 0 && (
        <section aria-label="Merilni načrt" data-testid="measure-plan">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Merilni načrt — izmeri na terenu
            </h3>
            <div className="flex items-center gap-2">
              <Badge variant={planDoneCount === analysis.measurementsNeeded.length ? 'default' : 'secondary'} className="text-[10px]" data-testid="plan-progress">
                {planDoneCount}/{analysis.measurementsNeeded.length} izmerjeno
              </Badge>
              {planDoneCount > 0 && (
                <button onClick={resetPlan} className="text-muted-foreground hover:text-foreground" aria-label="Ponastavi merilni načrt">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <Progress value={(planDoneCount / analysis.measurementsNeeded.length) * 100} className="mb-2 h-1.5" aria-label="Napredek merjenja" />
          <ul className="space-y-1.5">
            {analysis.measurementsNeeded.map((m, i) => {
              const done = !!planDone[i];
              return (
                <li key={i}>
                  <button
                    onClick={() => togglePlanItem(i)}
                    aria-pressed={done}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${done ? 'border-green-300 bg-green-50/70' : 'border-border bg-secondary/40 hover:bg-accent/50'}`}
                    data-testid={`plan-item-${i}`}
                  >
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className={done ? 'text-green-900' : ''}>{m}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Klikni na vrstico, ko meritev vzameš (AR merjenje, laser ali trak) — načrt se shrani ob fotki.
          </p>
        </section>
      )}

      {/* Priporočila */}
      {analysis.recommendations && (
        <div className="flex items-start gap-2.5 rounded-xl border bg-card p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold">Priporočila skripte</p>
            <p className="text-sm text-muted-foreground">{analysis.recommendations}</p>
          </div>
        </div>
      )}

      {/* Predlagani izdelki */}
      {suggestedProducts.length > 0 && (
        <section aria-label="Predlagani izdelki">
          <h3 className="mb-2 text-sm font-bold">Iz kataloga — dodaj v ponudbo</h3>
          <div className="max-h-64 space-y-2 overflow-y-auto scroll-area pr-1">
            {suggestedProducts.map((p) => {
              const price = p.sku ? cenik.priceOf(p.sku) : null;
              return (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {price === null ? <span className="text-amber-700 dark:text-amber-400">cena ni vpisana</span> : `${formatEUR(price)} / ${p.unit}`}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => addProduct(p)} className="shrink-0 h-8">
                  <PlusCircle className="mr-1 h-3.5 w-3.5" />
                  Dodaj
                </Button>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA */}
      {analysis.craft !== 'drugo' && (
        <Button size="lg" className="w-full min-h-12 whitespace-normal" onClick={openCalculator}>
          <Calculator className="mr-2 h-5 w-5 shrink-0" />
          {hasPrefill ? 'Odpri kalkulator s predpolnjenimi merami' : `Odpri kalkulator: ${craftMeta?.name ?? craftLabel}`}
        </Button>
      )}
      {analysis.craft === 'drugo' && (
        <div className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Analiza ni prepoznala naše dejavnosti — poskusi fotografirati objekt bližje ali iz drugega kota.
        </div>
      )}
    </div>
  );
}
