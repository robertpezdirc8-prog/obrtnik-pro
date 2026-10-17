'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Sparkles, Clock, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCenik } from '@/hooks/use-cenik';
import { useDraft, useView } from '@/lib/store';
import { formatEUR, formatNum } from '@/lib/format';
import { craftInstallPlan, plural } from '@/lib/install-plan';
import { estimateDuration } from '@/lib/labor';
import { numberProblemSentence, parseNumberInput } from '@/lib/settings-inputs';
import { applyCenik, unpricedLines, type PriceKey } from '@/lib/cenik';
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

const VRSTICE: [string, string, string, string] = ['vrstica', 'vrstici', 'vrstice', 'vrstic'];
const POSTAVKE: [string, string, string, string] = ['postavka', 'postavki', 'postavke', 'postavk'];

export interface CraftCalcProps {
  craft: CraftId;
  title: string;
  description: string;
  inputs: CraftInputs;
  setInputs: (patch: Partial<CraftInputs>) => void;
  /** `compute` izračuna SAMO KOLIČINE (metre, m², kose, ure). Cene tu ni od
   *  kod: pogon jih ne pozna in jih ne sme prejeti kot parametra. Denar pride
   *  izključno iz Cenika (`applyCenik`), kjer ga vpiše obrtnik (Task 88). */
  compute: (inputs: CraftInputs) => { lines: CalcLine[]; summary: { label: string; value: string }[] };
  prefilled?: boolean;
  children: React.ReactNode;
}

export function CraftCalculator({ craft, title, description, inputs, setInputs, compute, prefilled, children }: CraftCalcProps) {
  const { toast } = useToast();
  const addItem = useDraft((s) => s.addItems);
  const setView = useView((s) => s.setView);
  const openCenik = useView((s) => s.openCenik);
  const cenik = useCenik();

  const result = useMemo(() => compute(inputs), [compute, inputs]);
  const plan = useMemo(() => craftInstallPlan(craft, inputs), [craft, inputs]);
  const duration = useMemo(() => estimateDuration(craft, inputs), [craft, inputs]);

  /** Količine se izračunajo vedno. Cena se pripne ŠELE tu, in samo če jo je
   *  obrtnik vpisal: vrstica brez cene ostane `null` — ne 0 €, ne prejšnja
   *  številka. */
  const lines = useMemo(() => applyCenik(result.lines, cenik.readings), [result.lines, cenik.readings]);
  const missing = useMemo(() => unpricedLines(lines), [lines]);
  const priced = missing.length === 0 && lines.length > 0;

  const subtotal = priced ? lines.reduce((s, l) => s + l.quantity * (l.unitPrice as number), 0) : 0;

  /** Katerih ključov manjka — gumb odpre Cenik na prvi manjkajoči vrstici. */
  const missingKeys = useMemo(
    () => Array.from(new Set(missing.map((l) => l.priceKey))).filter((k): k is PriceKey => !!k),
    [missing],
  );

  const handleAdd = () => {
    if (result.lines.length === 0) {
      toast({ title: 'Ni postavk', description: 'Najprej vnesi veljavne dimenzije.', variant: 'destructive' });
      return;
    }
    // Brez vpisane cene vrstica NE gre v ponudbo: na dokumentu bi bila
    // številka, ki je obrtnik ni napisal — ali prazna vrsta, ki bi jo moral
    // sam uganiti ob tiskanju.
    if (missing.length > 0) {
      toast({
        title: 'Cena ni vpisana',
        description: `${missing.map((l) => l.name).join(', ')} — ceno vpiši v Ceniku. Postavk nismo dodali.`,
        variant: 'destructive',
      });
      return;
    }
    const stamp = Date.now();
    const items = lines.map((l, i) => ({
      key: `${craft}-${stamp}-${i}`,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      ...(l.priceKey ? { priceKey: l.priceKey } : {}),
    }));
    addItem(items);
    toast({
      title: 'Dodano v ponudbo ✓',
      description: `${items.length} ${plural(items.length, POSTAVKE)} · ${formatEUR(subtotal)} brez DDV`,
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
              orientacijska pomoč za terminiranje ekipe. NI CENA: ure se
              cenijo šele, ko obrtnik vpiše svojo postavko. */}
          {duration && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-testid="duration-row">
              <Clock className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">Trajanje montaže: {duration.summary}</p>
                <p className="text-xs text-muted-foreground">orientacijski normativ — začni planiranje terminov od tega</p>
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Izračunane količine</CardTitle>
                <CardDescription>
                  Količine izmeri aplikacija, cene pa določiš ti — v Ceniku, ki je edini vir
                  denarja.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-72 overflow-y-auto scroll-area -mx-1 px-1">
                  <div className="space-y-2">
                    {lines.map((l, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border p-2.5" data-testid="price-line">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{l.name}</p>
                          {l.description && <p className="text-xs text-muted-foreground truncate">{l.description}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5" data-testid="line-detail">
                            {formatNum(l.quantity)} {l.unit} ×{' '}
                            {l.unitPrice === null ? 'cena ni vpisana' : formatEUR(l.unitPrice)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {l.unitPrice === null ? (
                            <button
                              type="button"
                              onClick={() => openCenik(l.priceKey ?? null)}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 min-h-[36px]"
                              data-testid={`cenik-open-${l.priceKey ?? i}`}
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Vpiši ceno
                            </button>
                          ) : (
                            <p className="text-sm font-semibold" data-testid="line-amount">{formatEUR(l.quantity * l.unitPrice)}</p>
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
                    {!priced ? (
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400" data-testid="subtotal-refusal">
                        Vsota ni izračunana — {missing.length} {plural(missing.length, VRSTICE)} brez vpisane cene.
                      </p>
                    ) : (
                      <p className="text-lg font-bold">{formatEUR(subtotal)}</p>
                    )}
                  </div>
                  <Button
                    onClick={handleAdd}
                    size="lg"
                    className="min-h-11"
                    disabled={!priced}
                    data-testid="add-to-offer"
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Dodaj v ponudbo
                  </Button>
                </div>
                {!priced && (
                  <div
                    className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
                    data-testid="calc-price-refusal"
                  >
                    <p className="font-medium">
                      {cenik.loaded
                        ? `${missing.length} ${plural(missing.length, VRSTICE)} brez cene — postavk ni mogoče dodati:`
                        : 'Cene še niso na zaslonu — postavk ni mogoče dodati.'}
                    </p>
                    {!cenik.loaded ? (
                      <p className="text-xs mt-1">Cenik se ne more naložiti, zato aplikacija ne izmisli nobene številke.</p>
                    ) : (
                      <>
                        <p className="text-xs mt-1">{missing.map((l) => l.name).join(', ')}</p>
                        <button
                          type="button"
                          onClick={() => openCenik(missingKeys[0] ?? null)}
                          className="mt-2 rounded-md border px-2.5 py-1.5 text-xs font-medium min-h-[36px] hover:bg-accent"
                          data-testid="cenik-open-from-calc"
                        >
                          Odpri Cenik
                        </button>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <MaterialPanel plan={plan} craft={craft} />
          {/* Opcije za stranko so DENAR. Dokler katerakoli vrstica nima
              vpisane cene, se ne prikažejo — tri cene, ki jih ni noben vir
              podprl, bi bile ponudba, ki je obrtnik ni napisal. */}
          {priced && result.lines.length > 0 && (
            <GbbPanel craft={craft} inputs={inputs} values={cenik.values} />
          )}
        </div>
      </div>
    </div>
  );
}
