'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { makeThumbnail, processImage } from '@/lib/image-quality';
import { formatHours, todayDay, type TimeEntryInput } from '@/lib/time-tracking';
import {
  buildDiaryReportHtml, diaryHours, diarySummary, diaryToCsv, formatDiaryDay,
  groupDiaryByDay, MAX_PHOTOS_PER_ENTRY,
  DIARY_PHASES, DIARY_PHASE_LABELS, type DiaryPhoto, type DiaryPhase,
} from '@/lib/site-diary';
import { Camera, Download, FileDown, Loader2, NotebookPen, Pencil, Trash2, X } from 'lucide-react';

// ─── Terenski dnevnik (Baustellendokumentacija) ──────────────
// Zapis z datumom + fotke = dokaz izvedenega dela (raziskava 2026:
// ena od 6 ključnih funkcij Handwerkersoftware). Ure na delovnem
// nalogu se izpišejo IZRECNO samo, kadar vnos ima ponudbo.

interface DiaryPhotoDto {
  dataUrl: string;
  thumb: string | null;
  caption: string | null;
}

interface DiaryEntryDto {
  id: string;
  day: string;
  phase: string;
  note: string;
  offerId: string | null;
  offerNumber: string | null;
  objectLabel: string | null;
  createdAt: string;
  photos: DiaryPhotoDto[];
}

interface OfferLite {
  id: string;
  number: string;
  customerName: string;
  objectAddress: string | null;
}

const NO_OFFER = 'brez';

/** DTO → čisti vnos za knjižnico: neznana faza se pošteno preslika v 'ostalo'. */
function toEntryInput(e: DiaryEntryDto): import('@/lib/site-diary').DiaryEntryInput {
  return {
    id: e.id,
    day: e.day,
    phase: (DIARY_PHASES as readonly string[]).includes(e.phase) ? (e.phase as DiaryPhase) : 'ostalo',
    note: e.note,
    offerId: e.offerId,
    offerNumber: e.offerNumber,
    objectLabel: e.objectLabel,
    photos: e.photos.filter((p) => p.dataUrl).map((p) => ({ dataUrl: p.dataUrl, thumb: p.thumb, caption: p.caption })),
    createdAt: e.createdAt,
  };
}

export function DiaryView() {
  const { toast } = useToast();

  const [entries, setEntries] = useState<DiaryEntryDto[] | null>(null);
  const [offers, setOffers] = useState<OfferLite[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryInput[]>([]);
  const [filterOffer, setFilterOffer] = useState<string>('vse');
  const [saving, setSaving] = useState(false);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [buildingReport, setBuildingReport] = useState(false);

  // ── Obrazec ──
  const [formDay, setFormDay] = useState('');
  const [formPhase, setFormPhase] = useState<DiaryPhase>('montaza');
  const [formOfferId, setFormOfferId] = useState<string>(NO_OFFER);
  const [formObjectLabel, setFormObjectLabel] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formPhotos, setFormPhotos] = useState<DiaryPhoto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Brisanje / lučka ──
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (offerFilter: string) => {
    try {
      const q = offerFilter !== 'vse' ? `?offerId=${encodeURIComponent(offerFilter)}` : '';
      const res = await fetch(`/api/diary-entries${q}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      toast({ title: 'Napaka', description: 'Dnevnika ni bilo mogoče naložiti.', variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    setFormDay(todayDay(new Date()));
    void load('vse');
    fetch('/api/offers')
      .then((r) => r.json())
      .then((o) => {
        setOffers(
          (o?.offers ?? []).map((x: { id: string; number: string; customerName: string; objectAddress?: string | null }) => ({
            id: x.id, number: x.number, customerName: x.customerName, objectAddress: x.objectAddress ?? null,
          })),
        );
      })
      .catch(() => undefined);
    fetch('/api/time-entries')
      .then((r) => r.json())
      .then((t) => setTimeEntries(t?.entries ?? []))
      .catch(() => undefined);
  }, [load]);

  const changeFilter = (v: string) => {
    setFilterOffer(v);
    void load(v);
  };

  // ── Povzetek (iskro — šteje samo prikazane vnose) ──
  const entriesInput = useMemo(() => (entries ?? []).map(toEntryInput), [entries]);
  const summary = useMemo(() => diarySummary(entriesInput), [entriesInput]);
  const hoursForOffer = useMemo(() => {
    if (filterOffer === 'vse') return null;
    return diaryHours(timeEntries, filterOffer);
  }, [timeEntries, filterOffer]);

  const days = useMemo(() => groupDiaryByDay(entriesInput), [entriesInput]);

  // ── Dodajanje fotografij (stiskanje + male sličice) ──
  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS_PER_ENTRY - formPhotos.length;
    if (room <= 0) {
      toast({ title: 'Dosežena omejitev', description: `Največ ${MAX_PHOTOS_PER_ENTRY} fotografij na vnos.` });
      return;
    }
    setProcessingPhotos(true);
    try {
      const added: DiaryPhoto[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const proc = await processImage(file);
        let thumb: string | null = null;
        try {
          thumb = await makeThumbnail(proc.dataUrl);
        } catch {
          thumb = null; // brez sličice je vnos še vedno veljaven
        }
        added.push({ dataUrl: proc.dataUrl, thumb, caption: null });
      }
      setFormPhotos((prev) => [...prev, ...added].slice(0, MAX_PHOTOS_PER_ENTRY));
      if (files.length > room) {
        toast({ title: 'Nekatere fotografije so izpuščene', description: `Največ ${MAX_PHOTOS_PER_ENTRY} fotografij na vnos.` });
      }
    } catch {
      toast({ title: 'Napaka', description: 'Fotografij ni bilo mogoče obdelati.', variant: 'destructive' });
    } finally {
      setProcessingPhotos(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormDay(todayDay(new Date()));
    setFormPhase('montaza');
    setFormOfferId(NO_OFFER);
    setFormObjectLabel('');
    setFormNote('');
    setFormPhotos([]);
  };

  const startEdit = (e: DiaryEntryDto) => {
    setEditingId(e.id);
    setFormDay(e.day);
    setFormPhase((DIARY_PHASES as readonly string[]).includes(e.phase) ? (e.phase as DiaryPhase) : 'ostalo');
    setFormOfferId(e.offerId ?? NO_OFFER);
    setFormObjectLabel(e.objectLabel ?? '');
    setFormNote(e.note ?? '');
    setFormPhotos(
      e.photos
        .filter((p) => p.dataUrl)
        .map((p) => ({ dataUrl: p.dataUrl, thumb: p.thumb ?? p.dataUrl, caption: p.caption })),
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitEntry = async () => {
    if (!formDay) {
      toast({ title: 'Manjka dan', description: 'Izberi delovni dan.', variant: 'destructive' });
      return;
    }
    if (!formNote.trim() && formPhotos.length === 0) {
      toast({ title: 'Prazno ni vnosa', description: 'Napiši opis dela ali dodaj vsaj eno fotografijo.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        day: formDay,
        phase: formPhase,
        note: formNote.trim(),
        offerId: formOfferId === NO_OFFER ? null : formOfferId,
        objectLabel: formObjectLabel.trim() || null,
        photos: formPhotos,
      };
      const res = editingId
        ? await fetch(`/api/diary-entries/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/diary-entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? 'Shranjevanje ni uspelo');
      }
      resetForm();
      await load(filterOffer);
      toast({
        title: editingId ? 'Vnos posodobljen' : 'Zapis v dnevniku',
        description: `Dan ${formatDiaryDay(payload.day)}.`,
      });
    } catch (err) {
      toast({ title: 'Napaka', description: err instanceof Error ? err.message : 'Shranjevanje ni uspelo.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    try {
      const res = await fetch(`/api/diary-entries/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('brisanje');
      if (editingId === id) resetForm();
      await load(filterOffer);
      toast({ title: 'Vnos izbrisan' });
    } catch {
      toast({ title: 'Napaka', description: 'Vnosa ni bilo mogoče izbrisati.', variant: 'destructive' });
    }
  };

  // ── Izvoz ──
  const exportCsv = () => {
    if (!entries || entries.length === 0) {
      toast({ title: 'Dnevnik je prazen', description: 'Ni zapisa za izvoz.' });
      return;
    }
    const csv = diaryToCsv(entriesInput);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terenski-dnevnik.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printReport = async () => {
    if (!entries || entries.length === 0) {
      toast({ title: 'Dnevnik je prazen', description: 'Ni zapisa za poročilo.' });
      return;
    }
    setBuildingReport(true);
    try {
      const q = filterOffer !== 'vse'
        ? `?photos=1&offerId=${encodeURIComponent(filterOffer)}`
        : '?photos=1';
      const res = await fetch(`/api/diary-entries${q}`);
      const data = await res.json();
      const full: DiaryEntryDto[] = data.entries ?? [];
      if (full.length === 0) throw new Error('ni vnosov');

      const settings = await fetch('/api/settings').then((r) => r.json()).catch(() => null);
      const s = settings?.settings ?? {};

      const currentOffer = offers.find((o) => o.id === (filterOffer !== 'vse' ? filterOffer : full[0]?.offerId));
      const daysFull = groupDiaryByDay(full.map(toEntryInput));
      const hours = filterOffer !== 'vse' ? diaryHours(timeEntries, filterOffer) : { minutes: 0, hours: 0, timeEntries: 0 };

      const html = buildDiaryReportHtml(
        daysFull,
        {
          companyName: s.companyName ?? '',
          ownerName: s.ownerName ?? '',
          address: s.address ?? '',
          phone: s.phone ?? '',
          email: s.email ?? '',
          customerName: currentOffer?.customerName ?? null,
          objectAddress: currentOffer?.objectAddress ?? null,
          offerNumber: currentOffer?.number ?? null,
        },
        hours,
      );
      const w = window.open('', '_blank', 'width=900,height=1000');
      if (!w) {
        toast({ title: 'Okno je blokirano', description: 'Dovoli pojavna okna za tiskanje poročila.', variant: 'destructive' });
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.setTimeout(() => {
        w.focus();
        w.print();
      }, 400);
    } catch (err) {
      toast({ title: 'Napaka', description: err instanceof Error ? err.message : 'Poročila ni bilo mogoče sestaviti.', variant: 'destructive' });
    } finally {
      setBuildingReport(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="diary-view">
      {/* Glava */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <NotebookPen className="h-6 w-6 text-primary" />
            Terenski dnevnik
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Zapis z datumom + fotografije = dokaz izvedenega dela (spori, garancija, dodatna dela).
            Vsak vnos je vezan na dan, ure pa se izpišejo samo, kadar je vnos povezan z delovnim nalogom.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} className="min-h-11" aria-label="Izvozi dnevnik kot CSV">
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" onClick={() => void printReport()} disabled={buildingReport} className="min-h-11" aria-label="Natisni dokumentacijo izvedenih del">
            {buildingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Natisni poročilo
          </Button>
        </div>
      </div>

      {/* Povzetek */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Vnosi</p>
            <p className="text-2xl font-bold">{entries ? summary.entries : '…'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Dni dela</p>
            <p className="text-2xl font-bold">{entries ? summary.days : '…'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Fotografije</p>
            <p className="text-2xl font-bold">{entries ? summary.photos : '…'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Ure iz časovnice</p>
            {hoursForOffer ? (
              <>
                <p className="text-2xl font-bold">{formatHours(hoursForOffer.hours)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {hoursForOffer.timeEntries > 0
                    ? `${hoursForOffer.timeEntries} ${hoursForOffer.timeEntries === 1 ? 'vnos' : hoursForOffer.timeEntries === 2 ? 'vnosa' : 'vnosov'} na izbranem nalogu`
                    : 'Ni še zabeleženih ur na tem nalogu'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground pt-1.5">Izberi ponudbo — ure so po nalogih</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Obrazec */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{editingId ? 'Uredi vnos' : 'Nov vnos v dnevnik'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="diary-day">Delovni dan</Label>
              <Input id="diary-day" type="date" value={formDay} onChange={(e) => setFormDay(e.target.value)} className="min-h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Faza dela</Label>
              <Select value={formPhase} onValueChange={(v) => setFormPhase(v as DiaryPhase)}>
                <SelectTrigger className="min-h-11" aria-label="Faza dela">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIARY_PHASES.map((p) => (
                    <SelectItem key={p} value={p}>{DIARY_PHASE_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ponudba (delovni nalog)</Label>
              <Select value={formOfferId} onValueChange={setFormOfferId}>
                <SelectTrigger className="min-h-11" aria-label="Ponudba">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OFFER}>Brez ponudbe</SelectItem>
                  {offers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.number} · {o.customerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {formOfferId === NO_OFFER && (
            <div className="space-y-1.5">
              <Label htmlFor="diary-object">Objekt (prosta oznaka)</Label>
              <Input
                id="diary-object"
                value={formObjectLabel}
                onChange={(e) => setFormObjectLabel(e.target.value)}
                placeholder="npr. Balkon — Cesta v Mestni log 12"
                maxLength={80}
                className="min-h-11"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="diary-note">Opis opravljenega dela</Label>
            <Textarea
              id="diary-note"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="npr. Demontaža stare ograje, vrtanje nosilcev, montaža 4 stebrov."
              maxLength={500}
              rows={3}
            />
          </div>

          {/* Fotografije */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Fotografije ({formPhotos.length}/{MAX_PHOTOS_PER_ENTRY})</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => fileRef.current?.click()}
                disabled={processingPhotos}
                aria-label="Dodaj fotografije"
              >
                {processingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Dodaj fotografije
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-label="Izberi fotografije"
                onChange={(e) => void onPickFiles(e.target.files)}
              />
            </div>
            {formPhotos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formPhotos.map((p, i) => (
                  <div key={i} className="relative group">
                    { }
                    <img
                      src={p.thumb ?? p.dataUrl}
                      alt={`Fotografija ${i + 1}`}
                      className="h-20 w-20 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={() => setFormPhotos((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                      aria-label={`Odstrani fotografijo ${i + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void submitEntry()} disabled={saving} className="min-h-11" aria-label={editingId ? 'Shrani spremembe vnosa' : 'Zapiši v dnevnik'}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />}
              {editingId ? 'Shrani spremembe' : 'Zapiši v dnevnik'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm} className="min-h-11">
                Prekliči urejanje
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filtri */}
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-sm">Prikaži:</Label>
        <Select value={filterOffer} onValueChange={changeFilter}>
          <SelectTrigger className="min-h-11 w-[260px]" aria-label="Filtriraj po ponudbi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vse">Vse ponudbe in objekti</SelectItem>
            {offers.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.number} · {o.customerName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {summary.spanDays !== null && summary.spanDays > 1 && (
          <Badge variant="secondary">razpon {summary.spanDays} dni</Badge>
        )}
      </div>

      {/* Dnevnik po dnevih */}
      {entries === null ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Nalagam dnevnik …</CardContent>
        </Card>
      ) : days.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Dnevnik je še prazen. Zapiši prvo delo ali dodaj fotografijo z objekta.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d.day}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-primary capitalize flex items-center gap-2">
                  {d.weekday}, {d.day.slice(8, 10)}.{d.day.slice(5, 7)}.{d.day.slice(0, 4)}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {d.entries.length} {d.entries.length === 1 ? 'zapis' : d.entries.length === 2 ? 'zapisa' : 'zapisov'}{d.photoCount > 0 ? ` · ${d.photoCount} ${d.photoCount === 1 ? 'fotka' : 'fotk'}` : ''}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.entries.map((e) => (
                  <div key={e.id} className="rounded-xl border bg-secondary/30 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
                          {DIARY_PHASE_LABELS[(DIARY_PHASES as readonly string[]).includes(e.phase) ? (e.phase as DiaryPhase) : 'ostalo']}
                        </Badge>
                        {e.offerNumber ? (
                          <Badge variant="secondary">Nalog {e.offerNumber}</Badge>
                        ) : e.objectLabel ? (
                          <Badge variant="secondary">{e.objectLabel}</Badge>
                        ) : null}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" onClick={() => startEdit(e)} aria-label={`Uredi vnos iz ${e.day}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="min-h-9 min-w-9 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteId(e.id)} aria-label={`Izbriši vnos iz ${e.day}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {e.note ? (
                      <p className="text-sm whitespace-pre-wrap">{e.note}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">(brez opisa — samo fotografija)</p>
                    )}
                    {e.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {e.photos.map((p, i) => (
                           
                          <img
                            key={i}
                            src={p.thumb || p.dataUrl}
                            alt={p.caption ?? `Fotografija izvedenega dela ${i + 1} (${formatDiaryDay(e.day)})`}
                            className="h-24 w-24 object-cover rounded-lg border cursor-zoom-in"
                            onClick={() => setLightboxPhoto(p.dataUrl || p.thumb)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Lučka za polno fotografijo */}
      <Dialog open={lightboxPhoto !== null} onOpenChange={(open) => !open && setLightboxPhoto(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">Fotografija izvedenega dela</DialogTitle>
          {lightboxPhoto && (
             
            <img src={lightboxPhoto} alt="Fotografija izvedenega dela — polni prikaz" className="w-full max-h-[75vh] object-contain rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Potrditev brisanja */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši vnos dnevnika?</AlertDialogTitle>
            <AlertDialogDescription>
              Zapis in njegove fotografije bodo trajno izbrisani. Tega ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteEntry()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
