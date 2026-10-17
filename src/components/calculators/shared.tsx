'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Sparkles, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { formatEUR, formatNum } from '@/lib/format';
import { craftInstallPlan } from '@/lib/install-plan';
import { estimateDuration } from '@/lib/labor';
import { numberProblemSentence, parseNumberInput, readSettings, settingsProblemText } from '@/lib/settings-inputs';
import { MaterialPanel } from './material-panel';
import { GbbPanel } from './gbb-panel';
import type { CalcLine, CraftId, CraftInputs } from '@/lib/types';

// ─── Vnosna polja ───────────────────────────────────────────

/** Vnos mere ali cene: VPISANO BESEDILO ostane to, kar je monter tipkal.
 *
 *  Stara različica je bila `type="number"` z `onChange(v === '' ? 0 : Number(v))`:
 *  slovenska tipkovnica tipka vejico, `type="number"` pa jo vrne kot PRAZEN
 *  string — monter je izpraznil polje ali vpisal 2,5, aplikacija pa je tiho
 *  zapisala 0. Zdaj tekst živi v lokalnem stanju, `parseNumberInput` ga prebere
 *  (vejica ali pika), neveljaven vnos gre v izračun kot NaN, da
 *  `resolveCraftInputs` JAVI zavrnitev namesto, da bi kaj obračunal po prejšnji
 *  vrednosti. DOM `min`/`max`/`step` na elementu ni več: meja, ki jo hrani
 *  brskalnik, je videti kot obljuba posega v vnos. */
export function NumField({
  label, value, onChange, unit, placeholder, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  placeholder?: string;
  hint?: string;
}) {
  /** Zadnja številka, KI SMO JO MI poslali staršu. Če pride na zaslon drugačna,
   *  jo je spremenilo nekaj zunaj polja (predpolnitev s kamere, ponastavitev),
   *  in lasten vpis se mora umakniti — sicer bi polje kazalo staro meritev.
   *  Par (vpis, zunanja vrednost) živi v ENEM stanju: React sme med renderjem
   *  nastaviti stanje samega komponente, ref pa ne. */
  const [vnos, setVnos] = useState<{ text: string | null; external: number }>({
    text: null,
    external: value,
  });
  if (!Object.is(vnos.external, value)) {
    setVnos({ text: null, external: value });
  }
  const text = vnos.text;
  const shown = text ?? (Number.isFinite(value) ? formatNum(value, 3) : '');
  const problem = text !== null && !Number.isFinite(parseNumberInput(text));
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={problem || undefined}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => {
            const t = e.target.value;
            const n = parseNumberInput(t);
            const out = Number.isFinite(n) ? n : Number.NaN;
            setVnos({ text: t, external: out });
            // Neveljavno (prazno ali neštevilo) gre naprej kot NaN — izračun se
            // ustavi z razlogom, vnos se NE pretvori v ničlo.
            onChange(out);
          }}
          className="pr-12 h-10"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{unit}</span>
      </div>
      {problem ? (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="numfield-refusal">
          {`${numberProblemSentence(label, text ?? '')} — izračun je zaustavljen, vnosa nismo popravili.`}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
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
  /** `laborRate` je OBVEZEN: urna postavka dela je edini vir cene dela in sme
   *  priti SAMO iz nastavitev. Prejšnji podpis je imel privzetek `= 35`, torej
   *  je vsak kalkulator bez nastavitve natisnil delovno ure po izmišljeni
   *  številki (Task 86). */
  compute: (inputs: CraftInputs, laborRate: number) => { lines: CalcLine[]; summary: { label: string; value: string }[] };
  prefilled?: boolean;
  children: React.ReactNode;
}

export function CraftCalculator({ craft, title, description, inputs, setInputs, compute, prefilled, children }: CraftCalcProps) {
  const { toast } = useToast();
  const addItem = useDraft((s) => s.addItems);
  const setView = useView((s) => s.setView);

  /** Urna postavka dela pride IZ NASTAVITEV. Prejšnja začetna vrednost `35` je
   *  bila izmišljena številka: kalkulator je po njej računal montažo, GBB panel
   *  pa tri opcije za stranko, še preden so nastavitve sploh prišle na zaslon
   *  (Task 86). Zato je `compute(inputs, laborRate)` zdaj obvezen. */
  const [laborRate, setLaborRate] = useState(Number.NaN);
  const [laborLoaded, setLaborLoaded] = useState(false);
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setLaborLoaded(true);
        setLaborRate(d.settings?.laborRate ?? Number.NaN);
      })
      .catch(() => undefined);
  }, []);
  /** ISTI bralec kot PDF, račun, SMS in urejevalnik ponudbe — nič se ne useka
   *  in nič se ne nadomesti z ugodnejšo številko. Brez veljavne postavke denar
   *  NI izračunan (`priced = false`), zato na dokument ne more iti ura, ki je
   *  monter ni nastavil. */
  const delo = readSettings({ laborRate }).laborRate;
  const priced = laborLoaded && !delo.problem;

  const result = useMemo(() => compute(inputs, delo.value), [compute, inputs, delo.value]);
  const plan = useMemo(() => craftInstallPlan(craft, inputs), [craft, inputs]);
  const duration = useMemo(() => estimateDuration(craft, inputs), [craft, inputs]);
  const [priceOverrides, setPriceOverrides] = useState<Record<number, number>>({});
  /** Ročna cena na enoto je DENAR. Stari vnos je bil `type="number"` z
   *  `Number(e.target.value)`: vejico je brskalnik vrnil kot prazen string,
   *  `Number('')` pa je 0 — monter je tipkal 12,5, vrstica je tekla pri 0 €.
   *  Vpisano živi kot BESEDILO, neveljavno pa ustavi dodajanje. */
  const [priceText, setPriceText] = useState<Record<number, string>>({});
  const priceProblem = (i: number): string | null => {
    const t = priceText[i];
    if (t === undefined) return null;
    return Number.isFinite(parseNumberInput(t)) ? null : t;
  };
  const anyPriceProblem = result.lines.reduce<boolean>((bad, _l, i) => bad || priceProblem(i) !== null, false);
  const firstPriceProblem = (() => {
    for (let i = 0; i < result.lines.length; i++) {
      const t = priceProblem(i);
      if (t !== null) return { name: result.lines[i].name, typed: t };
    }
    return null;
  })();

  const subtotal = result.lines.reduce(
    (s, l, i) => s + l.quantity * (priceOverrides[i] ?? l.unitPrice),
    0,
  );

  const handleAdd = () => {
    if (result.lines.length === 0) {
      toast({ title: 'Ni postavk', description: 'Najprej vnesi veljavne dimenzije.', variant: 'destructive' });
      return;
    }
    // Neveljavno vpisane cene NE pretvorimo v 0 in NE spustimo ven prejšnje:
    // v ponudbi bi bila številka, ki je monter ni napisal.
    if (firstPriceProblem) {
      toast({
        title: 'Cena na enoto ni prebrana',
        description: `${firstPriceProblem.name} — ${numberProblemSentence('Cena', firstPriceProblem.typed)}. Vpisani vrednosti nismo popravili in postavk nismo dodali.`,
        variant: 'destructive',
      });
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
    setPriceText({});
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
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="min-w-0">
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

          {/* Ocena trajanja — deterministični normativi (lib/labor.ts),
              orientacijska pomoč za terminiranje ekipe. */}
          {duration && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-testid="duration-row">
              <Clock className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">Trajanje montaže: {duration.summary}</p>
                <p className="text-xs text-muted-foreground">orientacijski normativ — začni planiranje terminov od tega</p>
              </div>
            </div>
          )}

          {!priced && result.lines.length > 0 && (
            <div
              className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              data-testid="calc-price-refusal"
            >
              {delo.problem
                ? `Cene niso izračunane — ${settingsProblemText(delo.problem)}`
                : 'Cene niso izračunane — nastavitve še niso na zaslonu.'}
            </div>
          )}

          {priced && result.lines.length > 0 && (
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
                            {priceProblem(i) !== null ? '—' : formatEUR(priceOverrides[i] ?? l.unitPrice)}
                          </p>
                        </div>
                        <div className="shrink-0">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="w-24 h-8 text-sm"
                            aria-invalid={priceProblem(i) !== null || undefined}
                            aria-label={`Cena za ${l.name}`}
                            value={priceText[i] ?? formatNum(priceOverrides[i] ?? l.unitPrice, 3)}
                            onChange={(e) => {
                              const t = e.target.value;
                              const n = parseNumberInput(t);
                              setPriceText((p) => ({ ...p, [i]: t }));
                              if (Number.isFinite(n)) setPriceOverrides((p) => ({ ...p, [i]: n }));
                            }}
                          />
                          {priceProblem(i) !== null && (
                            <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400 w-24" data-testid="price-refusal">
                              {numberProblemSentence('Cena', priceText[i] ?? '')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Vsota (brez DDV)</p>
                    {anyPriceProblem ? (
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400" data-testid="subtotal-refusal">
                        Vsota ni izračunana — {firstPriceProblem?.name}: cena ni prebrana.
                      </p>
                    ) : (
                      <p className="text-lg font-bold">{formatEUR(subtotal)}</p>
                    )}
                  </div>
                  <Button onClick={handleAdd} size="lg" className="min-h-11">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Dodaj v ponudbo
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <MaterialPanel plan={plan} craft={craft} />
          {/* Opcije za stranko so DENAR, izračunan po urni postavki dela. Brez
              prebrane nastavitve jih NE prikazujemo — tri cene po izmišljenih
              35 €/h bi bile ponudba, ki je noben vir ni podprl. */}
          {priced && result.lines.length > 0 && (
            <GbbPanel craft={craft} inputs={inputs} laborRate={delo.value} />
          )}
          {!priced && delo.problem && result.lines.length > 0 && (
            <div
              className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
              data-testid="gbb-blocked"
            >
              Opcije za stranko niso izračunane — {settingsProblemText(delo.problem)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
