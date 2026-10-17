'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Save, ShoppingCart, Loader2, Copy, Boxes, ChartPie } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft } from '@/lib/store';
import { calcTotals } from '@/lib/pricing';
import { plural } from '@/lib/install-plan';
import { formatEUR, formatNum } from '@/lib/format';
import { numberProblemSentence, readSettings, settingsProblemText, parseNumberInput } from '@/lib/settings-inputs';
import type { SettingsDTO } from '@/lib/types';

// ─── Razlikovanje dela od materiala (deterministično) ────────
// Delovne postavke v kalkulatorjih imajo stalna imena: »Montaža …«,
// »Polaganje …«, »Fugiranje …«, »Vgradnja …«, »Betoniranje …«.
// Sprememba imen v pricing.ts zahteva posodobitev tega vzorca.
const LABOR_PATTERNS: RegExp[] = [/montaža/i, /polaganje/i, /fugiran/i, /vgradnj/i, /betoniran/i];

export function isLaborItem(name: string): boolean {
  return LABOR_PATTERNS.some((re) => re.test(name));
}

/** Nabavni list za dobavitelja — samo materialne postavke osnutka. */
export function buildBuyList(items: { name: string; quantity: number; unit: string }[], customerName: string): string {
  const materials = items.filter((i) => !isLaborItem(i.name));
  if (materials.length === 0) return '';
  const lines = materials.map((m) => `- ${m.name} — ${m.quantity} ${m.unit}`);
  return [
    `NAROČILO MATERIALA — ${new Date().toLocaleDateString('sl-SI')}`,
    `Objekt: ${customerName || '(vnos objekta)'}`,
    '',
    ...lines,
    '',
    'Prosimo za potrditev zaloge in rok dostave. Hvala!',
  ].join('\n');
}

export function OfferEditor() {
  const { toast } = useToast();
  const setView = useDraftSafe();
  const goAddItems = useAddItemsNav();
  const items = useDraft((s) => s.items);
  const customerName = useDraft((s) => s.customerName);
  const customerEmail = useDraft((s) => s.customerEmail);
  const customerPhone = useDraft((s) => s.customerPhone);
  const customerAddress = useDraft((s) => s.customerAddress);
  const objectAddress = useDraft((s) => s.objectAddress);
  const note = useDraft((s) => s.note);
  const updateItem = useDraft((s) => s.updateItem);
  const removeItem = useDraft((s) => s.removeItem);
  const setCustomer = useDraft((s) => s.setCustomer);
  const clearDraft = useDraft((s) => s.clearDraft);

  /** DDV pride iz nastavitev, ročni vpis v tem oknu ga preseže. Shranjen je
   *  kot BESEDILO (`Number('')` bi bil 0 %, kar monter ni vpisal). */
  const [settingsVat, setSettingsVat] = useState(Number.NaN);
  const [vatText, setVatText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [laborRate, setLaborRate] = useState(Number.NaN);
  const [depositPercent, setDepositPercent] = useState(Number.NaN);
  const [buyListOpen, setBuyListOpen] = useState(false);
  /** Dokler nastavitve niso prebrane, denarnih vrst NI za pokazati — začetna
   *  vrednost 22 / 35 / 30 bi bila na zaslonu izmišljen podatek (Task 86:
   *  urejevalnik je bil peta različica istega vnosa). */
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setSettingsVat(d.settings.vatRate);
          setLaborRate(d.settings.laborRate);
          setDepositPercent(d.settings.depositPercent);
          setSettingsReady(true);
        }
      })
      .catch(() => {});
  }, []);

  /** DDV, akontacija in urna postavka se berejo skozi ISTI register kot PDF,
   *  račun in SMS — nič se ne useka, ne zaokroži, ne nadomesti. Vrstica pod
   *  poljem imenuje VPISANO vrednost, ker je tiha menjava ravno tisto, kar je
   *  bilo narobe (monter je vpisal 33,7, dokument je šel po 33). */
  const settingsV = {
    vatRate: vatText === null ? settingsVat : parseNumberInput(vatText),
    laborRate,
    depositPercent,
  };
  const read = readSettings(settingsV);
  const ddv = read.vatRate;
  const capara = read.depositPercent;
  const delo = read.laborRate;
  const totals = calcTotals(items, ddv.value);
  /** Postavke, kjer cena še ni vpisana. Iz njih se NE sme narediti noben
   *  delni seštevek: že ena prazna cena skriva celoten znesek ponudbe. */
  const unpriced = items.filter((i) => i.unitPrice === null || !Number.isFinite(i.unitPrice));
  /** DDV je izračunljiv šele, ko ima vsaka vrstica svojo ceno. */
  const totalsShown = items.length > 0 && unpriced.length === 0;
  const ddvVrednost = vatText === null
    ? (Number.isFinite(settingsVat) ? formatNum(settingsVat, 2) : '')
    : vatText;

  // ─── Količina in cena na enoto: VPISANO je BESEDILO ────────
  // `type="number"` slovensko vejico vrne kot PRAZEN string, stara različica pa
  // je ta prazen string prevedla z `Number(e.target.value) || 0`. Monter je
  // vpisal 12,5 m, na zaslonu videl 12,5, postavka pa je tekla pri 0 € —
  // enaka tiha menjava številke kot pri DDV in akontaciji (Task 86).
  type ItemNumField = 'quantity' | 'unitPrice';
  const FIELD_LABEL: Record<ItemNumField, string> = { quantity: 'Količina', unitPrice: 'Cena/en. (€)' };
  const [itemRaw, setItemRaw] = useState<Record<string, string>>({});
  const rawId = (key: string, f: ItemNumField) => `${key}::${f}`;

  const setItemNumber = (key: string, f: ItemNumField, text: string) => {
    setItemRaw((p) => ({ ...p, [rawId(key, f)]: text }));
    const v = parseNumberInput(text);
    // Neveljavnega vpisa NIKOLI ne pretvorimo v 0. V bazi ostane zadnja
    // veljavna številka, ponudba pa je do popravka blokirana (spodnja vrstica).
    if (Number.isFinite(v)) updateItem(key, f === 'quantity' ? { quantity: v } : { unitPrice: v });
  };

  /** Vrnjen je VPISAN tekst, kadar ga aplikacija ne more prebrati. */
  const itemProblem = (key: string, f: ItemNumField): string | null => {
    const t = itemRaw[rawId(key, f)];
    if (t === undefined) return null;
    return Number.isFinite(parseNumberInput(t)) ? null : t;
  };

  const blockedFields = items.flatMap((it) =>
    (['quantity', 'unitPrice'] as ItemNumField[])
      .map((f) => ({ name: it.name, label: FIELD_LABEL[f], typed: itemProblem(it.key, f), field: f, key: it.key }))
      .filter((x) => x.typed !== null));

  const itemHasProblem = (key: string) => blockedFields.some((b) => b.key === key);

  /** Stavki, ki imata na zaslonu enako obliko kot pri nastavitvah: imenujeta
   *  VPISANO, ne nadomestne številke. */
  const itemProblemSentence = (b: { label: string; typed: string | null }): string =>
    numberProblemSentence(b.label, b.typed ?? '');

  // Struktura cene: material vs delo (deterministično po imenih)
  const split = useMemo(() => {
    // Razdelitev sme obstati samo, če ima ceno vsaka vrstica. Delni
    // seštevek bi pokazal odstotke, ki temeljijo na manjkajoči osnovi.
    const incomplete = items.some((i) => i.unitPrice === null || !Number.isFinite(i.unitPrice));
    let material = 0;
    let labor = 0;
    if (!incomplete) {
      for (const i of items) {
        const value = i.quantity * (i.unitPrice as number);
        if (isLaborItem(i.name)) labor += value;
        else material += value;
      }
    }
    const sum = material + labor;
    return {
      incomplete,
      material,
      labor,
      materialPct: sum > 0 ? Math.round((material / sum) * 100) : 0,
      laborPct: sum > 0 ? Math.round((labor / sum) * 100) : 0,
      has: !incomplete && sum > 0,
    };
  }, [items]);

  const buyListText = useMemo(
    () => buildBuyList(items, customerName),
    [items, customerName],
  );

  const handleSave = async () => {
    if (!customerName.trim()) {
      toast({ title: 'Manjka ime stranke', description: 'Vpiši ime stranke pred shranjevanjem.', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'Ponudba je prazna', description: 'Dodaj vsaj eno postavko iz kalkulatorja.', variant: 'destructive' });
      return;
    }
    // Pod vrstico, ki nima vpisane cene, ponudba NE gre v bazo: stolpec
    // `unitPrice` je NOT NULL, strežnik bi prazno polje moral napolniti s
    // številko, ki je obrtnik ni vpisal (Task 88).
    if (unpriced.length > 0) {
      toast({
        title: 'Cena ni vpisana',
        description: `${unpriced.map((i) => i.name).join(', ')} — ceno vpiši v stolpec »Cena/en. (€)« ali v Ceniku. Ponudbe nismo shranili.`,
        variant: 'destructive',
      });
      return;
    }
    // Vrstica z neveljavnim vpisom pomeni, da na dokument NE sme iti številka,
    // ki je monter ni vpisal — v bazi bi ostala zadnja veljavna.
    if (blockedFields.length > 0) {
      const b = blockedFields[0];
      toast({
        title: 'Postavka ni izračunana',
        description: `${b.name} — ${itemProblemSentence(b)}. Vpisanih vrednosti nismo popravili in ponudbe nismo shranili.`,
        variant: 'destructive',
      });
      return;
    }
    // Brez veljavne stopnje DDV ponudbe NI za shraniti: strežnik bi jo moral
    // izmeriti čez `?? 22` in v bazo zapisati znesek, ki ga monter ni izračunal.
    if (!settingsReady || ddv.problem) {
      toast({
        title: 'DDV ni izračunan',
        description: ddv.problem
          ? settingsProblemText(ddv.problem)
          : 'Nastavitev DDV ni bilo mogoče prebrati. Poskusi znova čez trenutek.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerPhone,
          customerAddress,
          objectAddress,
          note,
          vatRate: ddv.value,
          items: items.map((i) => ({
            name: i.name,
            description: i.description ?? null,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Napaka pri shranjevanju');
      toast({ title: `Ponudba ${data.offer.number} shranjena ✓`, description: `Skupaj z DDV: ${formatEUR(data.offer.total)}` });
      clearDraft();
      setView('ponudbe');
    } catch (e) {
      toast({
        title: 'Napaka pri shranjevanju',
        description: e instanceof Error ? e.message : 'Poskusi ponovno.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nova ponudba</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Postavke iz kalkulatorjev so že tukaj — količine izračuna kalkulator, cene vedno vpišeš sam.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={goAddItems} className="min-h-10">
            + Dodaj postavke
          </Button>
          <Button
            variant="outline"
            onClick={() => setBuyListOpen(true)}
            className="min-h-10"
            disabled={items.length === 0}
            data-testid="buy-list-button"
          >
            <Boxes className="mr-2 h-4 w-4" />
            Nabavni list
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Postavke */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                Postavke ponudbe ({items.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    Ponudba je še prazna. Uporabi kalkulatorje za odmerek materiala in dela.
                  </p>
                  <Button onClick={goAddItems} className="min-h-10">
                    Odpri kalkulatorje
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {blockedFields.length > 0 && (
                    <div
                      className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      data-testid="item-refusal"
                    >
                      <p className="font-semibold">Ponudba ni shranjena — {blockedFields.length} {blockedFields.length === 1 ? 'vrstica ni prebrana' : 'vrstice niso prebrane'}.</p>
                      {blockedFields.map((b) => (
                        <p key={`${b.key}::${b.field}`}>{b.name}: {itemProblemSentence(b)}</p>
                      ))}
                      <p>Vpisanih vrednosti nismo popravili in nihče znesek po njih ni izračunan.</p>
                    </div>
                  )}
                  <div className="max-h-[420px] overflow-y-auto scroll-area -mx-1 px-1">
                    <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.key} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground">{item.description}</p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                            aria-label={`Odstrani ${item.name}`}
                            onClick={() => removeItem(item.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:items-start">
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Količina</Label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-8 text-sm"
                              aria-label={`Količina — ${item.name}`}
                              aria-invalid={itemProblem(item.key, 'quantity') !== null || undefined}
                              value={itemRaw[rawId(item.key, 'quantity')] ?? formatNum(item.quantity, 2)}
                              onChange={(e) => setItemNumber(item.key, 'quantity', e.target.value)}
                            />
                            {itemProblem(item.key, 'quantity') !== null && (
                              <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400" data-testid="item-field-problem">
                                {itemProblemSentence({ label: FIELD_LABEL.quantity, typed: itemProblem(item.key, 'quantity') })}
                              </p>
                            )}
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Enota</Label>
                            <Input
                              className="h-8 text-sm"
                              value={item.unit}
                              onChange={(e) => updateItem(item.key, { unit: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Cena/en. (€)</Label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-8 text-sm"
                              aria-label={`Cena na enoto — ${item.name}`}
                              aria-invalid={itemProblem(item.key, 'unitPrice') !== null || item.unitPrice === null || undefined}
                              placeholder="Vpiši ceno"
                              value={itemRaw[rawId(item.key, 'unitPrice')] ?? (item.unitPrice === null ? '' : formatNum(item.unitPrice, 2))}
                              onChange={(e) => setItemNumber(item.key, 'unitPrice', e.target.value)}
                            />
                            {itemProblem(item.key, 'unitPrice') !== null ? (
                              <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400" data-testid="item-field-problem">
                                {itemProblemSentence({ label: FIELD_LABEL.unitPrice, typed: itemProblem(item.key, 'unitPrice') })}
                              </p>
                            ) : item.unitPrice === null ? (
                              <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400" data-testid="item-price-missing">
                                Cena ni vpisana.
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Vrednost</Label>
                            <p className="text-sm font-semibold h-8 flex items-center" data-testid="item-line-value">
                              {itemHasProblem(item.key) || item.unitPrice === null
                                ? '—'
                                : formatEUR(item.quantity * item.unitPrice)}
                            </p>
                            {itemHasProblem(item.key) && (
                              <p className="text-[11px] leading-tight text-muted-foreground">
                                Vrednost ni izračunana — popravi vpisano številko.
                              </p>
                            )}
                            {!itemHasProblem(item.key) && item.unitPrice === null && (
                              <p className="text-[11px] leading-tight text-muted-foreground">
                                Vrednost ni izračunana — cena manjka.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Opomba k ponudbi</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="npr. Rok izvedbe: 3 tedni od sprejema ponudbe. Garancija 5 let na material in montažo."
                value={note}
                onChange={(e) => setCustomer({ note: e.target.value })}
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* Stranka + vsote */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Stranka</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Ime stranke *</Label>
                <Input value={customerName} onChange={(e) => setCustomer({ customerName: e.target.value })} placeholder="Janez Novak" />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input value={customerPhone} onChange={(e) => setCustomer({ customerPhone: e.target.value })} placeholder="041 234 567" inputMode="tel" />
              </div>
              <div className="space-y-1.5">
                <Label>E-pošta</Label>
                <Input value={customerEmail} onChange={(e) => setCustomer({ customerEmail: e.target.value })} placeholder="janez@primer.si" inputMode="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Naslov stranke</Label>
                <Input value={customerAddress} onChange={(e) => setCustomer({ customerAddress: e.target.value })} placeholder="Cesta 12, 1000 Ljubljana" />
              </div>
              <div className="space-y-1.5">
                <Label>Objekt / lokacija dela</Label>
                <Input value={objectAddress} onChange={(e) => setCustomer({ objectAddress: e.target.value })} placeholder="Če je drugačen od naslova stranke" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vsote</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Brez DDV</span>
                <span className="font-semibold">{totalsShown ? formatEUR(totals.subtotal) : '—'}</span>
              </div>
              {items.length > 0 && unpriced.length > 0 && (
                <div
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
                  data-testid="offer-price-refusal"
                >
                  <p className="font-semibold">
                    Vsote niso izračunane — vpisana cena manjka pri {unpriced.length}{' '}
                    {plural(unpriced.length, ['vrstici', 'vrsticah', 'vrsticah', 'vrsticah'])}.
                  </p>
                  {unpriced.slice(0, 6).map((i) => (
                    <p key={i.key}>{i.name}</p>
                  ))}
                  {unpriced.length > 6 && <p>… in še {unpriced.length - 6} {unpriced.length - 6 === 1 ? 'vrstica' : 'vrstic'}.</p>}
                  <p>Ceno vpiši v stolpec »Cena/en. (€)« ali v Ceniku. Dokler cena manjka, ponudbe ni mogoče shraniti.</p>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">DDV</span>
                  {/* Isti register kot Nastavitve, PDF in račun: brez DOM
                      meje in brez `|| 0`, ki bi izpraznjen polje spremenil v 0 %. */}
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="h-7 w-16 text-sm"
                    value={ddvVrednost}
                    step="any"
                    aria-invalid={ddv.problem !== null}
                    onChange={(e) => { setVatText(e.target.value); }}
                    aria-label="DDV stopnja"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <span className="font-semibold">{ddv.problem || !totalsShown ? '—' : formatEUR(totals.vatAmount)}</span>
              </div>
              {ddv.problem && (
                <p
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300"
                  data-testid="vat-row"
                >
                  DDV ni izračunan — {settingsProblemText(ddv.problem)}
                </p>
              )}
              {/* Hitri preklop DDV — standardna in nižja stopnja. */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-0.5">Hitro:</span>
                {[22, 9.5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVatText(String(v))}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors min-h-[28px] ${
                      !ddv.problem && ddv.value === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {v === 9.5 ? '9,5' : v} %
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                9,5 % je nižja stopnja za določena dela na stavbah za stanovanjske namene.
                Katero stopnjo obračunaš, je davčna odločitev — točno razmejitev preveri pri
                davčnem svetovalcu ali na finansi.si, aplikacija je ne more presoditi.
              </p>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Skupaj z DDV</span>
                <span className="text-xl font-bold text-primary">{ddv.problem || !totalsShown ? '—' : formatEUR(totals.total)}</span>
              </div>
              {/* Struktura cene — material vs delo (raziskava: konsistentna
                  marža zahteva vidno razdelitev pred oddajo). */}
              {split.incomplete && (
                <p
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300"
                  data-testid="price-split-refusal"
                >
                  Struktura cene ni izračunana — del materiala in dela se ne da razmeriti,
                  dokler ima vrstica brez vpisane cene.
                </p>
              )}
              {split.has && (
                <div className="rounded-lg bg-secondary/60 px-3 py-2" data-testid="price-split">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1">
                      <ChartPie className="h-3 w-3 text-muted-foreground" />
                      Struktura cene
                    </span>
                    <span className="text-muted-foreground">material {split.materialPct} % · delo {split.laborPct} %</span>
                  </div>
                  <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-secondary">
                    <div className="bg-primary" style={{ width: `${split.materialPct}%` }} aria-label={`Material ${split.materialPct} %`} />
                    <div className="bg-amber-500" style={{ width: `${split.laborPct}%` }} aria-label={`Delo ${split.laborPct} %`} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Material {formatEUR(split.material)}</span>
                    <span>Delo {formatEUR(split.labor)}</span>
                  </div>
                  {(split.materialPct < 35 || split.materialPct > 80) && (
                    <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      {split.materialPct < 35
                        ? 'Delo prevladuje — preveri, ali so materialne postavke brez nadomestka.'
                        : 'Material prevladuje — preveri, ali je delo podcenjeno.'}
                    </p>
                  )}
                </div>
              )}
              {/* Akontacija — isti register kot PDF, račun in SMS. Vpisana
                  vrednost se uporabi dobesedno (vejica, brez `Math.floor`);
                  zunaj okna vrstica pove razlog in ne prirejenega odstotka. */}
              {settingsReady && capara.problem && (
                <div
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
                  data-testid="deposit-row"
                >
                  Akontacija ni izračunana — {settingsProblemText(capara.problem)}
                </div>
              )}
              {/* Akontacija je delež ZNESKA Z DDV. Če DDV ni izračunan, tudi ta
                  vrstica ne more biti — izpustiti jo brez razloga bi bilo isto
                  tiho molčanje, kot ga preprečuje ta celotna naloga. */}
              {settingsReady && !capara.problem && capara.value > 0 && ddv.problem && (
                <div
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
                  data-testid="deposit-row"
                >
                  Akontacija {formatNum(capara.value, 2)} % ni izračunana — znesek z DDV ni izračunan, ker
                  stopnja DDV ni veljavna (razlog je izpisan zgoraj).
                </div>
              )}
              {settingsReady && !capara.problem && !ddv.problem && capara.value > 0 && unpriced.length > 0 && (
                <div
                  className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
                  data-testid="deposit-row"
                >
                  Akontacija {formatNum(capara.value, 2)} % ni izračunana — skupni znesek ni izračunan,
                  ker vrsticam manjka vpisana cena (razlog je izpisan zgoraj).
                </div>
              )}
              {settingsReady && !capara.problem && !ddv.problem && capara.value > 0 && totalsShown && totals.total > 0 && (
                <div className="rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="deposit-row">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Akontacija {formatNum(capara.value, 2)} % ob naročilu</span>
                    <span className="font-semibold">{formatEUR((totals.total * capara.value) / 100)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
                    <span>Ostanek po zaključku dela</span>
                    <span>{formatEUR(totals.total * (1 - capara.value / 100))}</span>
                  </div>
                </div>
              )}
              <Button
                className="w-full min-h-11"
                size="lg"
                onClick={handleSave}
                disabled={saving || unpriced.length > 0}
                data-testid="save-offer"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {unpriced.length > 0 ? 'Najprej vpiši ceno' : 'Shrani ponudbo'}
              </Button>
              {settingsReady && delo.problem ? (
                <p className="text-xs text-amber-700 dark:text-amber-400 text-center" data-testid="labor-rate-row">
                  Urna postavka dela ni uporabljena — {settingsProblemText(delo.problem)}
                </p>
              ) : settingsReady ? (
                <p className="text-xs text-muted-foreground text-center" data-testid="labor-rate-row">
                  {formatNum(delo.value, 2)} €/h je tvoja urna postavka — uporablja se samo za evidenco
                  opravljenih ur, ne za to ponudbo. Cena v ponudbi je vedno tista, ki jo vpišeš sam.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Nabavni list za dobavitelja — samo materialne postavke */}
      <Dialog open={buyListOpen} onOpenChange={setBuyListOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              Nabavni list za dobavitelja
            </DialogTitle>
            <DialogDescription>
              Samo materialne postavke (delo je izpuščeno). Kopiraj in pošlji po e-pošti
              dobavitelju — potrdi zalogo in rok dostave pred sprejemom ponudbe.
            </DialogDescription>
          </DialogHeader>
          {buyListText ? (
            <div className="space-y-3">
              <Textarea value={buyListText} readOnly rows={10} className="text-sm bg-secondary/40 font-mono" data-testid="buy-list-preview" />
              <Button
                className="w-full min-h-11"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buyListText);
                    toast({ title: 'Nabavni list kopiran ✓', description: 'Prilepi v e-pošto dobavitelju.' });
                  } catch {
                    toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
                  }
                }}
                data-testid="buy-list-copy"
              >
                <Copy className="mr-2 h-4 w-4" />
                Kopiraj naročilo
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">V osnutku ni materialnih postavk.</p>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

import { useView } from '@/lib/store';
function useDraftSafe() {
  return useView((s) => s.setView);
}
/** »+ Dodaj postavke« mora pokazati mrežo kalkulatorjev, četudi osnutek ni prazen
 *  (sicer uporabnik obstane v urejevalniku brez poti do kalkulatorjev). */
function useAddItemsNav() {
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);
  return () => {
    setActiveCraft('izberi');
    setView('kalkulatorji');
  };
}
