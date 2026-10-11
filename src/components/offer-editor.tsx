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
import { formatEUR, formatNum } from '@/lib/format';
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

  const [vatRate, setVatRate] = useState(22);
  const [saving, setSaving] = useState(false);
  const [laborRate, setLaborRate] = useState(35);
  const [depositPercent, setDepositPercent] = useState(30);
  const [buyListOpen, setBuyListOpen] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setVatRate(d.settings.vatRate ?? 22);
          setLaborRate(d.settings.laborRate ?? 35);
          setDepositPercent(Number.isFinite(d.settings.depositPercent) ? d.settings.depositPercent : 30);
        }
      })
      .catch(() => {});
  }, []);

  const totals = calcTotals(items, vatRate);

  // Struktura cene: material vs delo (deterministično po imenih)
  const split = useMemo(() => {
    let material = 0;
    let labor = 0;
    for (const i of items) {
      const value = i.quantity * i.unitPrice;
      if (isLaborItem(i.name)) labor += value;
      else material += value;
    }
    const sum = material + labor;
    return {
      material,
      labor,
      materialPct: sum > 0 ? Math.round((material / sum) * 100) : 0,
      laborPct: sum > 0 ? Math.round((labor / sum) * 100) : 0,
      has: sum > 0,
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
          vatRate,
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
            Postavke iz kalkulatorjev so že tukaj — preveri cene in dodaj stranko.
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
                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Količina</Label>
                            <Input
                              type="number"
                              className="h-8 text-sm"
                              value={item.quantity}
                              min={0}
                              step={0.1}
                              onChange={(e) => updateItem(item.key, { quantity: Number(e.target.value) || 0 })}
                            />
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
                              type="number"
                              className="h-8 text-sm"
                              value={item.unitPrice}
                              min={0}
                              step={0.5}
                              onChange={(e) => updateItem(item.key, { unitPrice: Number(e.target.value) || 0 })}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase text-muted-foreground">Vrednost</Label>
                            <p className="text-sm font-semibold h-8 flex items-center">
                              {formatEUR(item.quantity * item.unitPrice)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
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
                placeholder="npr. Rok izvedbe: 3 tedni od sprejema ponudbe. Garancija 5 let na material in montáže."
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
                <span className="font-semibold">{formatEUR(totals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">DDV</span>
                  <Input
                    type="number"
                    className="h-7 w-16 text-sm"
                    value={vatRate}
                    min={0}
                    max={30}
                    step={0.5}
                    onChange={(e) => setVatRate(Number(e.target.value) || 0)}
                    aria-label="DDV stopnja"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <span className="font-semibold">{formatEUR(totals.vatAmount)}</span>
              </div>
              {/* Hitri preklop DDV — 9,5 % za obnovo zasebnih stanovanj (54. člen PZDDV) */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-0.5">Hitro:</span>
                {[22, 9.5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVatRate(v)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors min-h-[28px] ${
                      vatRate === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {v === 9.5 ? '9,5' : v} %
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                9,5 %: obnova in popravila zasebnih stanovanj (54. člen PZDDV).
                Materiali, ki so bistven del dobave, ostanejo 22 % — za natančno razdelitev se posvetuj z davčnim svetovalcem.
              </p>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Skupaj z DDV</span>
                <span className="text-xl font-bold text-primary">{formatEUR(totals.total)}</span>
              </div>
              {/* Struktura cene — material vs delo (raziskava: konsistentna
                  marža zahteva vidno razdelitev pred oddajo). */}
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
              {/* Akontacija — raziskava: jasno dogovorjena akontacija (10–50 %)
                  zmanjša nepoplačila; izpiše se tudi na PDF. */}
              {depositPercent > 0 && totals.total > 0 && (
                <div className="rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="deposit-row">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Akontacija {depositPercent} % ob naročilu</span>
                    <span className="font-semibold">{formatEUR((totals.total * depositPercent) / 100)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
                    <span>Ostanek po zaključku dela</span>
                    <span>{formatEUR(totals.total * (1 - depositPercent / 100))}</span>
                  </div>
                </div>
              )}
              <Button className="w-full min-h-11" size="lg" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Shrani ponudbo
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {formatNum(laborRate)} €/h je nastavljena urna postavka dela
              </p>
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
