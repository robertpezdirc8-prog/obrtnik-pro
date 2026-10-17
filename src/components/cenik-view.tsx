'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Trash2, Wallet, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCenik } from '@/hooks/use-cenik';
import { plural } from '@/lib/install-plan';
import { useView } from '@/lib/store';
import { NumField } from './calculators/shared';
import { craftBySlug } from '@/lib/crafts-meta';
import {
  CENIK,
  CENIK_GROUPS,
  CENIK_KEYS,
  priceLabel,
  priceWindowHint,
  type PriceKey,
} from '@/lib/cenik';

// ─── Cenik ──────────────────────────────────────────────────
//
// Edino mesto v aplikaciji, kjer se vpiše CENA. Doslej je aplikacija cene
// pisala sama: 145 €/m za ograjo, 520 €/kos za okno, 28 €/m² za montažo
// terase — v kodi, dvakrat (katalog in kalkulator) in brez okna, kjer bi jih
// obrtnik lahko popravil. Pravilo obrtnika (Task 88): aplikacija izračuna
// KOLIČINO, ceno vedno določi človek.
//
// Zato je začetno stanje PRAZNO: vseh 54 vrstic čaka, da obrtnik napiše svojo
// številko. Prazno polje NI 0 € — izračun in dokument se v tem primeru
// ustavita z razlogom, ki imenuje vrstico.
//
// Številko odstrani SAMO gumb »Izbriši ceno« (strežniku gre null). Izprazniti
// polje je neodločenost, ne odločitev: tak vpis ostane na zaslonu, na strežnik
// pa ne gre nič.

const TOTAL = CENIK_KEYS.length;

/** Številka in samostalnik MORATA biti skladna: `1 cen vpisanih` je slovensko
 *  napačno, zato gre tudi ta stavek skozi `plural` (Task 88). */
const VRSTICE: [string, string, string, string] = ['vrstica', 'vrstici', 'vrstice', 'vrstic'];
const CENOVNE_VRSTICE: [string, string, string, string] = ['cenovna vrstica', 'cenovni vrstici', 'cenovne vrstice', 'cenovnih vrstic'];
const VPISANO: [string, string, string, string] = ['cena vpisana', 'ceni vpisani', 'cene vpisane', 'cen vpisanih'];
const ODSTRANJENO: [string, string, string, string] = ['cena odstranjena', 'ceni odstranjeni', 'cene odstranjene', 'cen odstranjenih'];

export function CenikView() {
  const { toast } = useToast();
  const cenik = useCenik();
  const cenikFocus = useView((s) => s.cenikFocus);
  const clearCenikFocus = useView((s) => s.clearCenikFocus);
  useEffect(() => {
    if (!cenikFocus) return;
    const row = document.getElementById(`cenik-row-${cenikFocus}`);
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector<HTMLInputElement>('input')?.focus();
    clearCenikFocus();
  }, [cenikFocus, clearCenikFocus]);
  /** Lokalne spremembe, ki še niso na strežniku. Vpisano ostane BESEDILO,
   *  ki ga je tipkal (vejico sprejemamo), neveljaven vnos je NaN.
   *
   *  `null` NI prazno polje. Prazno polje je »še nisem odločil« in na strežnik
   *  ne gre nič; `null` nastane SAMO na gumbu »Izbriši ceno« in pomeni
   *  zavestno odločitev, da številka preneha veljati. Brez te ločitve bi
   *  brisanje denarja bil stranski učinek tipkanja (Task 87). */
  const [typed, setTyped] = useState<Partial<Record<PriceKey, number | null>>>({});
  const [saving, setSaving] = useState(false);

  /** Vrednost, ki jo polje kaže: zadnji vpis, sicer shranjena cena, sicer NaN
   *  (prazno polje). Nikoli privzeta številka. */
  const shown = (key: PriceKey): number => {
    if (key in typed) {
      const v = typed[key];
      return v === null ? Number.NaN : (v as number);
    }
    return cenik.priceOf(key) ?? Number.NaN;
  };
  /** Izbris je NA VRSTICI, a še samo označen — potridi ga gumb »Shrani cene«. */
  const markedForDeletion = (key: PriceKey): boolean => typed[key] === null;

  const missing = CENIK_KEYS.filter((k) => !Number.isFinite(shown(k))).map(priceLabel);
  const pricedCount = TOTAL - missing.length;

  const save = async () => {
    const changes = Object.entries(typed) as [PriceKey, number | null][];
    const valid = changes.filter(([, v]) => v === null || Number.isFinite(v));
    const vpisane = valid.filter(([, v]) => v !== null).length;
    const izbrisane = valid.length - vpisane;
    const invalid = changes.filter(([, v]) => v !== null && !Number.isFinite(v)).map(([k]) => priceLabel(k));
    if (valid.length === 0) {
      toast({
        title: 'Nič za shraniti',
        description: invalid.length > 0
          ? `${plural(invalid.length, ['vnos', 'vnosa', 'vnosi', 'vnosov'])} brez veljavne cene. Vpisanega nismo popravili in na strežnik nismo poslali ničesar.`
          : 'Nobena cena še ni vpisana.',
        variant: invalid.length > 0 ? 'destructive' : 'default',
      });
      return;
    }
    setSaving(true);
    const res = await cenik.save(Object.fromEntries(valid));
    setSaving(false);
    if (!res.ok) {
      toast({ title: 'Cene niso shranjene', description: res.error ?? 'Strežnik jih je zavrnil.', variant: 'destructive' });
      return;
    }
    setTyped({});
    toast({
      title: 'Cenik shranjen ✓',
      description: `${vpisane} ${plural(vpisane, VPISANO)}${izbrisane > 0 ? `, ${izbrisane} ${plural(izbrisane, ODSTRANJENO)}` : ''}. Cena je tvoj poslovni podatek, ne številka aplikacije.`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Cenik
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cene vpišeš SAMO tu — aplikacija jih ne zna in jih ne ugiblje. Kalkulator izračuna
            količino, cena pride iz te strani. Vrstica brez cene ne more v ponudbo.
          </p>
        </div>
        <Badge variant={pricedCount === TOTAL ? 'default' : 'secondary'} className="text-sm">
          {pricedCount} / {TOTAL} vpisanih
        </Badge>
      </div>

      {!cenik.loaded && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cenik se nalaga — dotlej nobena cena ni na zaslonu.
          </CardContent>
        </Card>
      )}

      {missing.length > 0 && cenik.loaded && (
        <div
          className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          data-testid="cenik-missing"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            Cena manjka: {missing.length} {plural(missing.length, VRSTICE)} — ponudba, ki jih potrebuje, se ne more shraniti ali natisniti.
          </p>
          <p className="text-xs mt-1 first-letter:uppercase">{missing.slice(0, 8).join(' · ')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
        <Button onClick={save} disabled={saving || !cenik.loaded} size="sm" className="min-h-10">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Shrani cene
        </Button>
        <p className="text-xs text-muted-foreground">{priceWindowHint()}</p>
      </div>

      {CENIK_GROUPS.map((group) => (
        <Card key={group.craft}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{craftBySlug(group.craft)?.name ?? group.craft}</CardTitle>
            <CardDescription>{group.defs.length} {plural(group.defs.length, CENOVNE_VRSTICE)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.defs.map((d) => (
              <div key={d.key} id={`cenik-row-${d.key}`}>
                <NumField
                  label={`${d.name} (€/${d.unit})`}
                  unit="€"
                  value={shown(d.key)}
                  placeholder="Ni vpisana"
                  onChange={(v) => setTyped((t) => ({ ...t, [d.key]: v }))}
                />
                {markedForDeletion(d.key) ? (
                  <p
                    className="mt-1 text-[11px] leading-tight text-amber-700 dark:text-amber-400"
                    data-testid="cenik-pending-delete"
                  >
                    Cena je označena za izbris. Številka izgine s cenika, ko pritisneš
                    »Shrani cene« — prazno polje je same ne odstrani.
                  </p>
                ) : cenik.priceOf(d.key) !== null ? (
                  <button
                    type="button"
                    data-testid={`cenik-clear-${d.key}`}
                    onClick={() => setTyped((t) => ({ ...t, [d.key]: null }))}
                    className="mt-1 inline-flex min-h-[28px] items-center gap-1 text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Izbriši ceno
                  </button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        {CENIK.length} {plural(CENIK.length, VRSTICE)} v registru. Ime in merna enota sta v lib/cenik.ts, zato se
        katalog, kalkulator in PDF ne morejo več poimenovati drugače.
      </p>
    </div>
  );
}
