'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { FileDown, Loader2, FileText, Trash2, Inbox } from 'lucide-react';
import { formatDate, formatEUR, STATUS_LABELS } from '@/lib/format';
import { openOfferPDF } from '@/lib/pdf';
import type { OfferDTO, SettingsDTO, OfferStatus } from '@/lib/types';

export function OffersList() {
  const { toast } = useToast();
  const [offers, setOffers] = useState<OfferDTO[]>([]);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

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
    </div>
  );
}
