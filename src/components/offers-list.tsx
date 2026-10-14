'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Check, FileDown, Loader2, FileText, Trash2, Inbox, BellRing, Copy,
  MessageCircle, FilePlus2, FileCheck2, Receipt,
} from 'lucide-react';
import { formatDate, formatEUR, formatNum, STATUS_LABELS } from '@/lib/format';
import {
  computePipelineStats,
  followUpInfo,
  formatFollowUpRelative,
  suggestFollowUpIso,
} from '@/lib/offer-pipeline';
import {
  dunningLevel,
  formatDueRelative,
  paymentStatus,
  type PaymentInvoice,
} from '@/lib/payment-tracking';
import { openOfferPDF, openHandoverPrint, openInvoicePDF } from '@/lib/pdf';
import { validUntil } from '@/lib/pdf';
import { buildOfferShareText, buildChangeOrderText, buildHandoverDoc, changeOrderNumber } from '@/lib/paperwork';
import { useChangeOrders, type ChangeOrderEntry } from '@/lib/store';
import type { OfferDTO, SettingsDTO, OfferStatus, InvoiceDTO } from '@/lib/types';

function daysSince(dateIso: string): number {
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function todayIso(): string {
  return new Date().toISOString();
}

/** Izgradi besedili opomnika (SMS in e-pošta) — čista funkcija. */
export function buildFollowUpTexts(
  offer: OfferDTO,
  companyName: string,
  ownerName: string,
): { sms: string; email: string } {
  const first = offer.customerName.trim().split(/\s+/)[0] || ' Pozdravljeni';
  const when = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sl-SI', { day: 'numeric', month: 'long' });
  const sms = `Pozdravljeni ${first}, v priponki še enkrat naša ponudba ${offer.number} (${formatEUR(offer.total)} z DDV). Če imate vprašanja, kar vprašajte — z veseljem pomagamo pri odločitvi. Lep pozdrav, ${ownerName || companyName}`;
  const email = `Pozdravljeni ${first},

pred nekaj dni smo vam poslali ponudbo ${offer.number} za vaš objekt (skupaj ${formatEUR(offer.total)} z DDV).

Vem, da je izbira izvajalca pomembna odločitev — zato povabim k vprašanju: kaj bi morali prilagoditi (obseg, material ali rok), da bi ponudba ustrezala vašim pričakovanjem?

V nasprotnem primeru bi predlagal kratek klic ali ogled do ${when} — terminski prostor se hitro polni.

Lep pozdrav,
${ownerName || companyName}${companyName ? `, ${companyName}` : ''}`;
  return { sms, email };
}

export function OffersList() {
  const { toast } = useToast();
  const [offers, setOffers] = useState<OfferDTO[]>([]);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [followUpOfferId, setFollowUpOfferId] = useState<string | null>(null);
  const [changeOffer, setChangeOffer] = useState<OfferDTO | null>(null);
  const [handoverOffer, setHandoverOffer] = useState<OfferDTO | null>(null);
  const [invoiceOffer, setInvoiceOffer] = useState<OfferDTO | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([]);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  // Dodatna dela (change orders) — lokalni zapis po ponudbah
  const changeOrdersByOffer = useChangeOrders((s) => s.byOffer);
  const addChangeOrder = useChangeOrders((s) => s.add);
  const removeChangeOrder = useChangeOrders((s) => s.remove);
  // Obrazec dodatnega dela
  const [coDescription, setCoDescription] = useState('');
  const [coAmount, setCoAmount] = useState('');
  const [coDate, setCoDate] = useState('');
  // Obrazec zapisnika
  const [hoDate, setHoDate] = useState('');
  const [hoWarranty, setHoWarranty] = useState('24');
  const [hoPhotos, setHoPhotos] = useState('0');
  const [hoNotes, setHoNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s, inv] = await Promise.all([
        fetch('/api/offers').then((r) => r.json()),
        fetch('/api/settings').then((r) => r.json()),
        fetch('/api/invoices').then((r) => r.json()).catch(() => ({ invoices: [] })),
      ]);
      setOffers(o.offers ?? []);
      setSettings(s.settings ?? null);
      setInvoices(inv.invoices ?? []);
    } catch {
      toast({ title: 'Napaka', description: 'Ponudb ni bilo mogoče naložiti.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (id: string, status: OfferStatus) => {
    const res = await fetch(`/api/offers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const data = await res.json();
      // Strežnik nastavi časovne žige (sentAt/decidedAt) in počisti opomnik —
      // lokalno stanje osvežimo z odgovorom.
      setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, ...(data.offer as OfferDTO) } : o)));
      toast({ title: 'Status posodobljen' });
    } else {
      toast({ title: 'Napaka', description: 'Statusa ni bilo mogoče spremeniti.', variant: 'destructive' });
    }
  };

  /** Ročni opomnik (Wiedervorlage): nastavi ali počisti datum follow-upa. */
  const setFollowUp = async (id: string, followUpAt: string | null) => {
    const res = await fetch(`/api/offers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followUpAt }),
    });
    if (res.ok) {
      const data = await res.json();
      setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, ...(data.offer as OfferDTO) } : o)));
      toast({
        title: followUpAt ? 'Opomnik nastavljen' : 'Opomnik počiščen',
        description: followUpAt
          ? `Vrnemo se k ponudbi ${formatFollowUpRelative(followUpAt, new Date())}.`
          : undefined,
      });
    } else {
      toast({ title: 'Napaka', description: 'Opomnika ni bilo mogoče nastaviti.', variant: 'destructive' });
    }
  };

  const deleteOffer = async (id: string) => {
    const res = await fetch(`/api/offers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setOffers((prev) => prev.filter((o) => o.id !== id));
      toast({ title: 'Ponudba izbrisana' });
    } else {
      toast({ title: 'Napaka', description: 'Ponudbe ni bilo mogoče izbrisati.', variant: 'destructive' });
    }
  };

  const exportPDF = (offer: OfferDTO) => {
    if (!settings) {
      toast({ title: 'Nastavitve se nalagajo…', description: 'Poskusi še enkrat.', variant: 'destructive' });
      return;
    }
    const ok = openOfferPDF(offer, settings);
    if (!ok) {
      toast({
        title: 'Preprečeno okno za tiskanje',
        description: 'Dovoli pojavna okna za ta spletni naslov in poskusi ponovno.',
        variant: 'destructive',
      });
    }
  };

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} kopiran ✓`, description: 'Prilepi v SMS ali e-pošto in pošlji stranki.' });
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  /** Odpri dialog za dodatno delo z danes kot privzetim datumom. */
  const openChangeDialog = (offer: OfferDTO) => {
    setCoDescription('');
    setCoAmount('');
    setCoDate(new Date().toISOString().slice(0, 10));
    setChangeOffer(offer);
  };

  /** Zapiši dodatno delo: deterministična št. dokumenta + kopiranje besedila. */
  const saveChangeOrder = async () => {
    if (!changeOffer) return;
    const description = coDescription.trim();
    const amount = Number(coAmount);
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Manjkata opis in znesek', description: 'Opiši delo in vpiši vrednost brez DDV.', variant: 'destructive' });
      return;
    }
    const existing = changeOrdersByOffer[changeOffer.id] ?? [];
    const docNumber = changeOrderNumber(changeOffer.number, existing.length);
    const entry: ChangeOrderEntry = {
      id: `co-${changeOffer.id}-${Date.now()}`,
      docNumber,
      date: coDate || todayIso().slice(0, 10),
      description,
      amount,
      vatRate: changeOffer.vatRate,
    };
    addChangeOrder(changeOffer.id, entry);
    const text = buildChangeOrderText({
      docNumber,
      offerNumber: changeOffer.number,
      customerName: changeOffer.customerName,
      objectAddress: changeOffer.objectAddress,
      description,
      amount,
      vatRate: changeOffer.vatRate,
      dateIso: entry.date,
      companyName: settings?.companyName ?? '',
    });
    await copyText(`Dodatno delo ${docNumber}`, text);
    setChangeOffer(null);
  };

  /** Odpri dialog zapisnika z današnjim dnem. */
  const openHandoverDialog = (offer: OfferDTO) => {
    setHoDate(new Date().toISOString().slice(0, 10));
    setHoWarranty('24');
    setHoPhotos('0');
    setHoNotes('');
    setHandoverOffer(offer);
  };

  /** Izdaj račun iz ponudbe — server številči deterministično
   *  (RAC-LETO-NNN), vsote izračuna iz shranjene ponudbe. */
  const createInvoice = async (offer: OfferDTO) => {
    if (!settings) return;
    setCreatingInvoice(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Napaka pri izdaji računa');
      const invoice: InvoiceDTO = data.invoice;
      setInvoices((prev) => [invoice, ...prev]);
      const opened = openInvoicePDF(invoice, offer, settings);
      toast({
        title: `Račun ${invoice.number} izdan ✓`,
        description: opened
          ? `${formatEUR(invoice.total)} z DDV — odpiram za tiskanje.`
          : `${formatEUR(invoice.total)} z DDV. Dovoli pojavna okna in ponovno odpri račun za tiskanje.`,
      });
    } catch (e) {
      toast({
        title: 'Napaka pri izdaji računa',
        description: e instanceof Error ? e.message : 'Poskusi ponovno.',
        variant: 'destructive',
      });
    } finally {
      setCreatingInvoice(false);
    }
  };

  const buildHandoverText = (offer: OfferDTO): string => {
    if (!settings) return '';
    return buildHandoverDoc({
      companyName: settings.companyName,
      ownerName: settings.ownerName,
      taxNumber: settings.taxNumber,
      offerNumber: offer.number,
      customerName: offer.customerName,
      customerPhone: offer.customerPhone,
      objectAddress: offer.objectAddress,
      itemNames: offer.items.map((i) => `${i.name} (${formatNum(i.quantity)} ${i.unit})`),
      dateIso: hoDate || todayIso(),
      warrantyMonths: Number(hoWarranty) || 24,
      photoCount: Number(hoPhotos) || 0,
      notes: hoNotes,
    });
  };

  const printHandover = (offer: OfferDTO) => {
    if (!settings) return;
    const ok = openHandoverPrint(offer, settings, {
      dateIso: hoDate || todayIso(),
      warrantyMonths: Number(hoWarranty) || 24,
      photoCount: Number(hoPhotos) || 0,
      notes: hoNotes,
    });
    if (!ok) {
      toast({
        title: 'Preprečeno okno za tiskanje',
        description: 'Dovoli pojavna okna za ta spletni naslov in poskusi ponovno.',
        variant: 'destructive',
      });
    }
  };

  const filtered = offers.filter(
    (o) =>
      o.customerName.toLowerCase().includes(query.toLowerCase()) ||
      o.number.toLowerCase().includes(query.toLowerCase()),
  );

  /** Iskren povzetek sledenja: lijak + win-rate (null = premalo odločenih). */
  const pipeline = computePipelineStats(offers);

  /** Zadnji status ponudbe v opomniku — izpeljano iz svežega stanja,
   *  da se dialog osveži tudi po nastavitvi opomnika. */
  const followUpOffer: OfferDTO | null = offers.find((o) => o.id === followUpOfferId) ?? null;
  const setFollowUpOffer = (o: OfferDTO | null) => setFollowUpOfferId(o?.id ?? null);

  /** Zemljevid: offerId → računi. */
  const invoicesByOffer = new Map<string, InvoiceDTO[]>();
  for (const inv of invoices) {
    const list = invoicesByOffer.get(inv.offerId) ?? [];
    list.push(inv);
    invoicesByOffer.set(inv.offerId, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ponudbe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vse shranjene ponudbe — PDF, SMS povzetek, dodatna dela in zapisniki.
          </p>
        </div>
        <Input
          placeholder="Išči po številki ali stranki…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:w-72"
        />
      </div>

      {/* Sledenje — lijak + iskren win-rate */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-secondary/30 px-3 py-2.5" data-testid="pipeline-strip">
        <span className="text-xs text-muted-foreground">Lijak:</span>
        {(['draft', 'sent', 'accepted', 'rejected'] as const).map((s) => (
          <Badge key={s} variant={s === 'accepted' ? 'default' : s === 'rejected' ? 'destructive' : 'secondary'} className="font-normal">
            {STATUS_LABELS[s]} {pipeline.counts[s]}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {pipeline.winRate === null ? (
            <>Stopnja uspešnosti: — (premalo odločenih, najmanj 3)</>
          ) : (
            <>Stopnja uspešnosti: <strong className="text-primary">{pipeline.winRate.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} %</strong> ({pipeline.counts.accepted}/{pipeline.decided})</>
          )}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Nalagam ponudbe…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Inbox className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              {query ? 'Ni zadetkov iskanja.' : 'Še ni shranjenih ponudb. Ustvari prvo z kalkulatorjem.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((offer) => {
            const changeOrders = changeOrdersByOffer[offer.id] ?? [];
            const offerInvoices = invoicesByOffer.get(offer.id) ?? [];
            return (
              <Card key={offer.id} className="transition-shadow hover:shadow-sm">
                <CardContent className="flex flex-col md:flex-row md:items-center md:flex-wrap gap-3 p-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="rounded-lg bg-accent p-2.5 shrink-0">
                      <FileText className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{offer.number}</span>
                        <Badge variant={offer.status === 'accepted' ? 'default' : offer.status === 'rejected' ? 'destructive' : 'secondary'}>
                          {STATUS_LABELS[offer.status] ?? offer.status}
                        </Badge>
                        {(() => {
                          const info = followUpInfo(offer, new Date());
                          if (!info.due || !info.reason) return null;
                          return info.reason === 'opomnik' ? (
                            <Badge variant="outline" className="border-amber-500/60 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              <BellRing className="mr-1 h-3 w-3" />
                              Opomnik {formatFollowUpRelative(offer.followUpAt ?? '', new Date())}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                              {info.days} dni brez odgovora
                            </Badge>
                          );
                        })()}
                        {changeOrders.length > 0 && (
                          <Badge variant="outline" className="border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            {changeOrders.length} {changeOrders.length === 1 ? 'dodatno delo' : 'dodatni deli'}
                          </Badge>
                        )}
                        {(invoicesByOffer.get(offer.id) ?? []).map((inv) => {
                          const info = paymentStatus(inv as unknown as PaymentInvoice, new Date());
                          return (
                            <Badge
                              key={inv.id}
                              variant="outline"
                              className={
                                info.status === 'paid'
                                  ? 'border-emerald-600/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                  : info.status === 'overdue'
                                    ? 'border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                                    : 'border-sky-600/40 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                              }
                              data-testid={`invoice-badge-${inv.number}`}
                            >
                              <Receipt className="mr-1 h-3 w-3" />
                              Račun {inv.number} · {formatDueRelative(info, new Date())}
                            </Badge>
                          );
                        })}
                      </div>
                      <p className="text-sm truncate">{offer.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(offer.createdAt)} · {offer.items.length} postavk
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:justify-end md:flex-1 flex-wrap">
                    <span className="font-bold text-primary mr-1">{formatEUR(offer.total)}</span>
                    <Select value={offer.status} onValueChange={(v) => changeStatus(offer.id, v as OfferStatus)}>
                      <SelectTrigger className="h-9 w-32" aria-label="Status ponudbe">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="min-h-9" onClick={() => exportPDF(offer)}>
                      <FileDown className="mr-1.5 h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9"
                      aria-label={`Kopiraj povzetek ponudbe ${offer.number} za SMS/WhatsApp`}
                      data-testid={`share-${offer.number}`}
                      onClick={() => {
                        if (!settings) return;
                        void copyText('Povzetek ponudbe', buildOfferShareText(offer, settings));
                      }}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                      SMS
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9"
                      aria-label={`Dodatno delo k ponudbi ${offer.number}`}
                      data-testid={`change-order-${offer.number}`}
                      onClick={() => openChangeDialog(offer)}
                    >
                      <FilePlus2 className="mr-1.5 h-4 w-4" />
                      Dodatno delo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-9"
                      aria-label={`Zapisnik o predaji dela za ponudbo ${offer.number}`}
                      data-testid={`handover-${offer.number}`}
                      onClick={() => openHandoverDialog(offer)}
                    >
                      <FileCheck2 className="mr-1.5 h-4 w-4" />
                      Zapisnik
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`min-h-9 ${offer.status === 'accepted' ? 'border-sky-600/40 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950' : ''}`}
                      aria-label={`Račun za ponudbo ${offer.number}`}
                      data-testid={`invoice-${offer.number}`}
                      onClick={() => setInvoiceOffer(offer)}
                    >
                      <Receipt className="mr-1.5 h-4 w-4" />
                      Račun
                    </Button>
                    {(() => {
                      const info = followUpInfo(offer, new Date());
                      return info.due ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-9 border-amber-500/50 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950"
                          onClick={() => setFollowUpOffer(offer)}
                          data-testid={`followup-${offer.number}`}
                        >
                          <BellRing className="mr-1.5 h-4 w-4" />
                          Opomni stranko
                        </Button>
                      ) : null;
                    })()}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`Izbriši ponudbo ${offer.number}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Izbrisati ponudbo {offer.number}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Ponudba za stranko {offer.customerName} bo trajno izbrisana.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Prekliči</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteOffer(offer.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Izbriši
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Opomnik stranki — pripravljena besedila (SMS + e-pošta), en klik kopiranje */}
      <Dialog open={!!followUpOffer} onOpenChange={(open) => !open && setFollowUpOffer(null)}>
        <DialogContent className="max-w-lg">
          {followUpOffer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BellRing className="h-5 w-5 text-amber-600" />
                  Opomnik za ponudbo {followUpOffer.number}
                </DialogTitle>
                <DialogDescription>
                  {followUpOffer.customerName} · {followUpOffer.status === 'sent' ? `${daysSince(followUpOffer.sentAt ?? followUpOffer.createdAt)} dni od pošiljanja` : 'osnutek'}
                  {followUpOffer.followUpAt && (
                    <> · opomnik zastavljen: {formatFollowUpRelative(followUpOffer.followUpAt, new Date())}</>
                  )}
                  . Izberi besedilo, ga po potrebi prilagodi in pošlji — stranke najpogosteje odgovorijo
                  prav na kratek, prijazen opomnik.
                </DialogDescription>
              </DialogHeader>
              {(() => {
                const texts = buildFollowUpTexts(
                  followUpOffer,
                  settings?.companyName ?? '',
                  settings?.ownerName ?? '',
                );
                return (
                  <div className="space-y-3">
                    {/* Wiedervorlage — hitri hitri roki opomnika */}
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-secondary/30 p-3">
                      <span className="text-xs font-semibold text-muted-foreground mr-1">Opomnik zase:</span>
                      <Button size="sm" variant="outline" className="min-h-9 h-9" data-testid="fu-1d" onClick={() => setFollowUp(followUpOffer.id, suggestFollowUpIso(new Date(), 1))}>
                        Jutri
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-9 h-9" data-testid="fu-3d" onClick={() => setFollowUp(followUpOffer.id, suggestFollowUpIso(new Date(), 3))}>
                        +3 dni
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-9 h-9" data-testid="fu-7d" onClick={() => setFollowUp(followUpOffer.id, suggestFollowUpIso(new Date(), 7))}>
                        +7 dni
                      </Button>
                      {followUpOffer.followUpAt && (
                        <Button size="sm" variant="ghost" className="min-h-9 h-9 text-xs text-muted-foreground" data-testid="fu-clear" onClick={() => setFollowUp(followUpOffer.id, null)}>
                          Počisti opomnik
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMS</p>
                        <Button variant="outline" size="sm" className="h-8 min-h-8 text-xs" onClick={() => void copyText('SMS', texts.sms)}>
                          <Copy className="mr-1 h-3 w-3" />
                          Kopiraj
                        </Button>
                      </div>
                      <Textarea value={texts.sms} readOnly rows={4} className="text-sm bg-secondary/40" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">E-pošta</p>
                        <Button variant="outline" size="sm" className="h-8 min-h-8 text-xs" onClick={() => void copyText('E-pošta', texts.email)}>
                          <Copy className="mr-1 h-3 w-3" />
                          Kopiraj
                        </Button>
                      </div>
                      <Textarea value={texts.email} readOnly rows={9} className="text-sm bg-secondary/40" />
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dodatno delo (change order) — deterministična št. dokumenta,
          kopirno besedilo za podpis stranke */}
      <Dialog open={!!changeOffer} onOpenChange={(open) => !open && setChangeOffer(null)}>
        <DialogContent className="max-w-lg">
          {changeOffer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FilePlus2 className="h-5 w-5 text-primary" />
                  Dodatno delo — k ponudbi {changeOffer.number}
                </DialogTitle>
                <DialogDescription>
                  Brez podpisanega zapisa o dodatnem delu gre največ sporov (raziskava: scope creep).
                  Zaporedna št. dokumenta se določi samodejno, besedilo je pripravljeno za stranko.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Opis dodatnega dela *</Label>
                  <Textarea
                    value={coDescription}
                    onChange={(e) => setCoDescription(e.target.value)}
                    placeholder="npr. Dodatni zidni nosilec + montaža (izven prvotnega obsega)"
                    rows={2}
                    data-testid="co-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Vrednost brez DDV (€) *</Label>
                    <Input
                      type="number"
                      min={0}
                      step={10}
                      value={coAmount}
                      onChange={(e) => setCoAmount(e.target.value)}
                      placeholder="180"
                      data-testid="co-amount"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Datum</Label>
                    <Input type="date" value={coDate} onChange={(e) => setCoDate(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  DDV po ponudbi: {formatNum(changeOffer.vatRate)} % · št. dokumenta:{' '}
                  <strong>{changeOrderNumber(changeOffer.number, (changeOrdersByOffer[changeOffer.id] ?? []).length)}</strong>
                </p>
                <Button className="w-full min-h-11" size="lg" onClick={() => void saveChangeOrder()} data-testid="co-save">
                  <Copy className="mr-2 h-4 w-4" />
                  Zapiši in kopiraj besedilo
                </Button>
                {(changeOrdersByOffer[changeOffer.id] ?? []).length > 0 && (
                  <div className="rounded-lg border bg-secondary/40 p-2.5 space-y-1.5" data-testid="co-list">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zapisana dodatna dela</p>
                    {(changeOrdersByOffer[changeOffer.id] ?? []).map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{e.docNumber}</span>{' '}
                          <span className="text-muted-foreground truncate">{e.description}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs font-semibold">{formatEUR(e.amount)}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Izbriši ${e.docNumber}`}
                            onClick={() => removeChangeOrder(changeOffer.id, e.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Zapisnik o predaji in prevzemu dela (garancijski zapis) */}
      <Dialog open={!!handoverOffer} onOpenChange={(open) => !open && setHandoverOffer(null)}>
        <DialogContent className="max-w-2xl">
          {handoverOffer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileCheck2 className="h-5 w-5 text-primary" />
                  Zapisnik o predaji dela — {handoverOffer.number}
                </DialogTitle>
                <DialogDescription>
                  Garancijski list mora vsebovati dajalca, datum in dobo garancije (raziskava: data.si).
                  Izpolni in tiskaj — ali kopiraj besedilo za e-pošto.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Datum predaje</Label>
                  <Input type="date" value={hoDate} onChange={(e) => setHoDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Garancija na delo (mesecev)</Label>
                  <Input type="number" min={0} max={120} step={6} value={hoWarranty} onChange={(e) => setHoWarranty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Št. fotografij (dokumentacija)</Label>
                  <Input type="number" min={0} max={99} step={1} value={hoPhotos} onChange={(e) => setHoPhotos(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Opombe ob predaji (neobvezno)</Label>
                <Textarea
                  value={hoNotes}
                  onChange={(e) => setHoNotes(e.target.value)}
                  rows={2}
                  placeholder="npr. Stranki prikazano upravljanje z drsniki; rezervna fuga izročena."
                />
              </div>
              <Textarea value={buildHandoverText(handoverOffer)} readOnly rows={12} className="text-xs bg-secondary/40 font-mono" data-testid="handover-preview" />
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  className="flex-1 min-h-11"
                  onClick={() => void copyText('Zapisnik', buildHandoverText(handoverOffer))}
                  data-testid="handover-copy"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Kopiraj besedilo
                </Button>
                <Button className="flex-1 min-h-11" onClick={() => printHandover(handoverOffer)} data-testid="handover-print">
                  <FileDown className="mr-2 h-4 w-4" />
                  Tiskaj / shrani PDF
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* Računi — izdaja iz sprejete ponudbe (estimate → invoice workflow) */}
      <Dialog open={!!invoiceOffer} onOpenChange={(open) => !open && setInvoiceOffer(null)}>
        <DialogContent className="max-w-lg">
          {invoiceOffer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-sky-600" />
                  Računi za ponudbo {invoiceOffer.number}
                </DialogTitle>
                <DialogDescription>
                  Sprejeta ponudba je komercialna osnova računa — vsote in DDV se prenesejo,
                  št. računa dodeli strežnik (RAC-LETO-NNN).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {(invoicesByOffer.get(invoiceOffer.id) ?? []).length > 0 && (
                  <div className="rounded-lg border bg-secondary/40 p-2.5 space-y-1.5" data-testid="invoice-list">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Izdani računi</p>
                    {(invoicesByOffer.get(invoiceOffer.id) ?? []).map((inv) => {
                      const info = paymentStatus(inv as unknown as PaymentInvoice, new Date());
                      const dun = dunningLevel(inv as unknown as PaymentInvoice, new Date());
                      return (
                        <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium">{inv.number}</span>{' '}
                            <span className="text-xs text-muted-foreground">{formatDate(inv.createdAt)}</span>
                            <p className="text-xs flex items-center gap-1">
                              <span
                                className={
                                  info.status === 'paid'
                                    ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                                    : info.status === 'overdue'
                                      ? 'text-red-700 dark:text-red-300 font-medium'
                                      : 'text-amber-700 dark:text-amber-300 font-medium'
                                }
                              >
                                {dun.label !== 'Plačano' && dun.level > 0 ? `${dun.label} · ` : ''}
                                {formatDueRelative(info, new Date())}
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs font-semibold">{formatEUR(inv.total)}</span>
                            {info.status !== 'paid' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 min-h-7 px-2 text-xs border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"
                                aria-label={`Označi račun ${inv.number} kot plačan`}
                                data-testid={`invoice-pay-${inv.number}`}
                                onClick={async () => {
                                  const res = await fetch(`/api/invoices/${inv.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ paidAt: new Date().toISOString() }),
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    setInvoices((prev) => prev.map((x) => (x.id === inv.id ? (data.invoice as InvoiceDTO) : x)));
                                  }
                                }}
                              >
                                <Check className="mr-1 h-3 w-3" />
                                Plačano
                              </Button>
                            )}
                            {info.status === 'paid' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 min-h-7 px-2 text-xs"
                                aria-label={`Razveljavi plačilo računa ${inv.number}`}
                                onClick={async () => {
                                  const res = await fetch(`/api/invoices/${inv.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ paidAt: null }),
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    setInvoices((prev) => prev.map((x) => (x.id === inv.id ? (data.invoice as InvoiceDTO) : x)));
                                  }
                                }}
                              >
                                Razveljavi
                              </Button>
                            )}
                            {settings && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Odpri račun ${inv.number} za tiskanje`}
                                onClick={() => openInvoicePDF(inv, invoiceOffer, settings)}
                              >
                                <FileDown className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button
                  className="w-full min-h-11"
                  size="lg"
                  disabled={creatingInvoice}
                  onClick={() => void createInvoice(invoiceOffer)}
                  data-testid="invoice-create"
                >
                  {creatingInvoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}
                  Izdaj račun iz ponudbe {invoiceOffer.number}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Račun se nanaša na {invoiceOffer.items.length} postavk · DDV {formatNum(invoiceOffer.vatRate)} % · skupaj {formatEUR(invoiceOffer.total)}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
