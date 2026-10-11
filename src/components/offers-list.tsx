'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { FileDown, Loader2, FileText, Trash2, Inbox, BellRing, Copy } from 'lucide-react';
import { formatDate, formatEUR, STATUS_LABELS } from '@/lib/format';
import { openOfferPDF } from '@/lib/pdf';
import type { OfferDTO, SettingsDTO, OfferStatus } from '@/lib/types';

/** Dni brez odgovora, po katerih ponudba zasluži opomnik (raziskave: hitro
 *  spremljanje neodgovorjenih ponudb najbolj vpliva na konverzijo). */
const FOLLOW_UP_AFTER_DAYS = 3;

function daysSince(dateIso: string): number {
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
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
  const [followUpOffer, setFollowUpOffer] = useState<OfferDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        fetch('/api/offers').then((r) => r.json()),
        fetch('/api/settings').then((r) => r.json()),
      ]);
      setOffers(o.offers ?? []);
      setSettings(s.settings ?? null);
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
      setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
      toast({ title: 'Status posodobljen' });
    } else {
      toast({ title: 'Napaka', description: 'Statusa ni bilo mogoče spremeniti.', variant: 'destructive' });
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

  const filtered = offers.filter(
    (o) =>
      o.customerName.toLowerCase().includes(query.toLowerCase()) ||
      o.number.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ponudbe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vse shranjene ponudbe — izvozi PDF ali posodobi status.
          </p>
        </div>
        <Input
          placeholder="Išči po številki ali stranki…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:w-72"
        />
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
          {filtered.map((offer) => (
            <Card key={offer.id} className="transition-shadow hover:shadow-sm">
              <CardContent className="flex flex-col md:flex-row md:items-center gap-3 p-4">
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
                      {(offer.status === 'sent' || offer.status === 'draft') && daysSince(offer.createdAt) >= FOLLOW_UP_AFTER_DAYS && (
                        <Badge variant="outline" className="border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {daysSince(offer.createdAt)} dni brez odgovora
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm truncate">{offer.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(offer.createdAt)} · {offer.items.length} postavk
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:justify-end flex-wrap">
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
                  {(offer.status === 'sent' || offer.status === 'draft') && daysSince(offer.createdAt) >= FOLLOW_UP_AFTER_DAYS && (
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
                  )}
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
          ))}
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
                  {followUpOffer.customerName} · {daysSince(followUpOffer.createdAt)} dni brez odgovora.
                  Izberi besedilo, ga po potrebi prilagodi in pošlji — stranke najpogosteje odgovorijo
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
    </div>
  );
}
