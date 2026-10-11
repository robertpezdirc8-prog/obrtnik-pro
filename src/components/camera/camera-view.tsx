'use client';

// ─── Pametna kamera — glavni pogled ─────────────────────────
// Potek: zajem → AI analiza (VLM) → rezultat (okviri objektov,
// meritve, predlogi) → shranjevanje v galerijo → kalkulator.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScanSearch, Camera, Sparkles, History, Trash2, ArrowRight, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useView } from '@/lib/store';
import { CRAFT_LABELS, type AnalyzeResponse, type PhotoMeasure } from '@/lib/camera-types';
import type { CraftId } from '@/lib/types';
import type { ProcessedImage } from '@/lib/image-quality';
import { PhotoCapture } from './photo-capture';
import { PhotoCanvas } from './photo-canvas';
import { AnalysisPanel } from './analysis-panel';

interface PhotoRecord {
  id: string;
  title: string | null;
  craftId: string | null;
  dataUrl: string;
  analysis: string | null;
  measurements: string | null;
  createdAt: string;
}

const ANALYSIS_STEPS = [
  'Prepoznavam sceno…',
  'Iskam objekte in mere…',
  'Primerjam s katalogom…',
  'Pripravljam predloge…',
];

export function CameraView() {
  const { toast } = useToast();
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);

  const [phase, setPhase] = useState<'capture' | 'analyzing' | 'result'>('capture');
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [measures, setMeasures] = useState<PhotoMeasure[]>([]);

  const [gallery, setGallery] = useState<PhotoRecord[] | null>(null);

  // Animacija korakov med analizo
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const t = setInterval(() => setStepIdx((i) => (i + 1) % ANALYSIS_STEPS.length), 2200);
    return () => clearInterval(t);
  }, [phase]);

  const loadGallery = useCallback(() => {
    fetch('/api/photos')
      .then((r) => r.json())
      .then((d) => setGallery(d.photos ?? []))
      .catch(() => setGallery([]));
  }, []);

  useEffect(() => { loadGallery(); }, [loadGallery]);

  const handleAnalyze = async (img: ProcessedImage) => {
    setBusy(true);
    setError(null);
    setStepIdx(0);
    setPhase('analyzing');
    try {
      const res = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img.dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Analiza ni uspela.');

      const analysisResult = data as AnalyzeResponse;
      setResult(analysisResult);
      setPhotoUrl(img.dataUrl);
      setMeasures([]);

      // Samodejno shrani v galerijo (ne kritično)
      try {
        await fetch('/api/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: CRAFT_LABELS[analysisResult.analysis.craft],
            craftId: analysisResult.analysis.craft,
            dataUrl: img.dataUrl,
            analysis: JSON.stringify(analysisResult),
          }),
        });
        loadGallery();
        toast({ title: 'Shranjeno v galerijo ✓', description: 'Analiza je na voljo tudi pozneje.' });
      } catch {
        /* galerija ni kritična */
      }

      setPhase('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznana napaka.');
      setPhase('capture');
    } finally {
      setBusy(false);
    }
  };

  const openCalculator = (craft?: string) => {
    if (craft && craft !== 'drugo') setActiveCraft(craft);
    setView('kalkulatorji');
  };

  const reopenPhoto = (rec: PhotoRecord) => {
    let parsed: AnalyzeResponse | null = null;
    try {
      if (rec.analysis) parsed = JSON.parse(rec.analysis) as AnalyzeResponse;
    } catch { parsed = null; }

    setPhotoUrl(rec.dataUrl);
    try {
      setMeasures(rec.measurements ? (JSON.parse(rec.measurements) as PhotoMeasure[]) : []);
    } catch {
      setMeasures([]);
    }
    if (parsed) {
      setResult(parsed);
      setPhase('result');
    } else {
      setPhase('capture');
      toast({ title: 'Ta fotografija še ni analizirana', description: 'Zaženi novo AI analizo.' });
    }
  };

  const deletePhoto = async (id: string) => {
    try {
      await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      setGallery((g) => g?.filter((p) => p.id !== id) ?? null);
      if (result && photoUrl === gallery?.find((p) => p.id === id)?.dataUrl) {
        setPhase('capture');
        setResult(null);
        setPhotoUrl(null);
      }
    } catch {
      toast({ title: 'Brisanje ni uspelo', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Glava */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ScanSearch className="h-5 w-5" />
            </span>
            Pametna kamera
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fotografiraj objekt — AI prepozna, kaj je, oceni mere in pripravi kalkulator.
          </p>
        </div>
        {phase === 'result' && (
          <Button variant="outline" size="sm" onClick={() => { setPhase('capture'); setResult(null); setPhotoUrl(null); }}>
            <Camera className="mr-2 h-4 w-4" />
            Nova fotografija
          </Button>
        )}
      </div>

      {phase === 'capture' && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardContent className="p-4 sm:p-5">
              <PhotoCapture onAnalyze={(img) => void handleAnalyze(img)} busy={busy} />
            </CardContent>
          </Card>

          {/* Nasveti + kako deluje */}
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardContent className="p-4 sm:p-5 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Kaj AI prepozna
                </h3>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {[
                    'Vrsto dela — ograja, stopnice, keramika, terasa…',
                    'Objekte in njihove približne dimenzije',
                    'Referenčni objekt za umerjanje merila',
                    'Katere meritve še vzeti na terenu',
                    'Predlagane izdelke iz tvojega kataloga',
                  ].map((s) => (
                    <li key={s} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      {s}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 sm:p-5 space-y-2">
                <h3 className="text-sm font-bold">Kako priti do najboljših mer</h3>
                <ol className="list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
                  <li>Ujami cel objekt od roba do roba.</li>
                  <li>V okvir postavi znano referenco (vrata, okno, ploščico).</li>
                  <li>Fotografiraj pravokotno, ne poševno.</li>
                  <li>Po analizi umeri merilo in klikaj po fotki — mere se izpišejo v cm.</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {phase === 'analyzing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-5 p-10 sm:p-14">
            <div className="relative">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-9 w-9" />
              </span>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{ANALYSIS_STEPS[stepIdx]}</p>
              <p className="mt-1 text-sm text-muted-foreground">Pametna kamera analizira fotografijo — traja nekaj sekund.</p>
            </div>
            <div className="w-full max-w-xs space-y-2">
              {ANALYSIS_STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  {i < stepIdx ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : i === stepIdx ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-border" />
                  )}
                  <span className={i === stepIdx ? 'font-medium text-foreground' : 'text-muted-foreground'}>{s}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'result' && result && photoUrl && (
        <div className="space-y-5">
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4 sm:p-5">
                <PhotoCanvas
                  dataUrl={photoUrl}
                  objects={result.analysis.objects}
                  referenceLabel={result.analysis.reference?.label}
                  referenceCm={result.analysis.reference?.assumedCm}
                  measures={measures}
                  setMeasures={setMeasures}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 sm:p-5">
                <AnalysisPanel result={result} onOpenCalculator={() => openCalculator(result.analysis.craft)} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Galerija */}
      <section aria-label="Galerija fotografij">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <History className="h-5 w-5 text-primary" />
            Zadnji zajemi
          </h2>
          {gallery && gallery.length > 0 && (
            <Badge variant="secondary">{gallery.length}</Badge>
          )}
        </div>

        {gallery === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)}
          </div>
        ) : gallery.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Še ni zajetih fotografij — posnemi prvo zgoraj. ✓
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {gallery.map((rec) => (
              <div key={rec.id} className="group relative overflow-hidden rounded-xl border bg-card">
                <button
                  onClick={() => reopenPhoto(rec)}
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Odpri ${rec.title ?? 'fotografijo'}`}
                >
                  <img src={rec.dataUrl} alt={rec.title ?? 'Zajeta fotografija'} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.03]" />
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold">{rec.title ?? 'Zajem'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(rec.createdAt).toLocaleDateString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </button>
                {rec.craftId && rec.craftId !== 'drugo' && (
                  <Badge className="absolute left-2 top-2 text-[9px] px-1.5 py-0" variant="default">
                    {CRAFT_LABELS[rec.craftId as keyof typeof CRAFT_LABELS] ?? rec.craftId}
                  </Badge>
                )}
                <button
                  onClick={() => void deletePhoto(rec.id)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Izbriši ${rec.title ?? 'fotografijo'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Povezava naprej */}
      <div className="flex items-center justify-between rounded-xl border bg-accent/40 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Želiš ročni vnos? Kalkulatorji odmerka so še vedno na voljo.
        </p>
        <Button variant="outline" size="sm" onClick={() => { setActiveCraft(null); openCalculator(); }}>
          Kalkulatorji
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
