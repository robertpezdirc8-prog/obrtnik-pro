'use client';

// ─── Pametna kamera — glavni pogled ─────────────────────────
// Trije načini (zavihki):
//  1. "Zajem + analiza" — fotografiraj, skripta prepozna objekte, mere,
//     referenco in predlaga kalkulator.
//  2. "AR merjenje" — živo tap-to-measure na video kadru:
//     daljine, površine, koti; zamrznitev; kader gre v analizo.
//  3. "Merilni pripomočki" — laserski merilnik (Web Bluetooth),
//     glasovni vnos meritev, izvoz vseh meritev.
// Meritve se samodejno shranjujejo v galerijo (PATCH) in se
// preslikajo v predpolnitve kalkulatorja (buildPrefillFromMeasures).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ScanSearch, Camera, Sparkles, History, Trash2, ArrowRight, Check,
  Ruler, Wrench, Copy, Download, Box, Layers, PackagePlus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { buildProjectFromPhotos, type ProjectSummary } from '@/lib/photo-project';
import { formatEUR } from '@/lib/format';
import { CRAFT_LABELS, normalizePhotoAnalysis, type AnalyzeResponse, type PhotoMeasure, type MeasureKind } from '@/lib/camera-types';
import type { CraftId } from '@/lib/types';
import type { ProcessedImage } from '@/lib/image-quality';
import {
  buildPrefillFromMeasures, downloadMeasuresCsv, formatCm, formatM2, formatDeg, measuresToText,
} from '@/lib/measure-geometry';
import { PhotoCapture } from './photo-capture';
import { PhotoCanvas } from './photo-canvas';
import { AnalysisPanel } from './analysis-panel';
import { LiveAr } from './live-ar';
import { LaserPanel } from './laser-panel';
import { VoiceInput } from './voice-input';
import { WebXrAr } from './webxr-ar';
import { Measure3dPreview } from './preview-3d';

interface PhotoRecord {
  id: string;
  title: string | null;
  craftId: string | null;
  dataUrl: string;
  analysis: string | null;
  measurements: string | null;
  createdAt: string;
}

type CameraTab = 'analiza' | 'ar' | 'orodja';

const ANALYSIS_STEPS = [
  'Prepoznavam sceno…',
  'Iskam objekte in mere…',
  'Primerjam s katalogom…',
  'Pripravljam predloge…',
];

const measureSeq = { n: 0 };
const auxId = () => `aux${++measureSeq.n}-${Date.now()}`;

export function CameraView() {
  const { toast } = useToast();
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);
  const setCameraPrefill = useView((s) => s.setCameraPrefill);
  const addDraftItems = useDraft((s) => s.addItems);

  const [tab, setTab] = useState<CameraTab>('analiza');
  const [phase, setPhase] = useState<'capture' | 'analyzing' | 'result'>('capture');
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [measures, setMeasures] = useState<PhotoMeasure[]>([]);
  const [lastPhotoId, setLastPhotoId] = useState<string | null>(null);
  const [auxMeasures, setAuxMeasures] = useState<PhotoMeasure[]>([]);

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

  // Samodejno shranjevanje meritev v galerijo (debounce)
  useEffect(() => {
    if (phase !== 'result' || !lastPhotoId) return;
    const t = setTimeout(() => {
      fetch(`/api/photos/${lastPhotoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measurements: JSON.stringify(measures) }),
      }).catch(() => { /* ni kritično */ });
    }, 900);
    return () => clearTimeout(t);
  }, [measures, phase, lastPhotoId]);

  const handleAnalyze = async (img: ProcessedImage, measuresOverride?: PhotoMeasure[]) => {
    setBusy(true);
    setError(null);
    setStepIdx(0);
    setPhase('analyzing');
    const measuresToSave = measuresOverride ?? measures;
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
      if (measuresOverride) setMeasures(measuresOverride);

      // Samodejno shrani v galerijo (ne kritično)
      try {
        const saveRes = await fetch('/api/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: CRAFT_LABELS[analysisResult.analysis.craft],
            craftId: analysisResult.analysis.craft,
            dataUrl: img.dataUrl,
            analysis: JSON.stringify(analysisResult),
            measurements: JSON.stringify(measuresToSave),
          }),
        });
        if (saveRes.ok) {
          const saved = (await saveRes.json()) as { photo?: { id?: string } };
          setLastPhotoId(saved.photo?.id ?? null);
        }
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

  const addAuxMeasure = (kind: MeasureKind) => (label: string, cm: number) => {
    setAuxMeasures((list) => [...list, { id: auxId(), label, kind, value: cm, points: [] }]);
    toast({ title: 'Meritev dodana ✓', description: `${label}: ${formatCm(cm)}` });
  };

  const removeAuxMeasure = (id: string) => setAuxMeasures((list) => list.filter((m) => m.id !== id));

  const allMeasures = [...measures, ...auxMeasures];
  const detectedHeightCm = result?.analysis.objects.find((o) => (o.estHeightCm ?? 0) >= 80)?.estHeightCm ?? null;
  const detectedDefaultHeightM = detectedHeightCm ? Math.round((detectedHeightCm / 100) * 10) / 10 : undefined;

  const openCalculator = (craft?: string) => {
    const c = craft && craft !== 'drugo' ? craft : null;
    if (c) {
      const base = result?.analysis.prefill ?? {};
      const extra = buildPrefillFromMeasures(c, allMeasures);
      const merged = { ...base, ...extra };
      setActiveCraft(c);
      if (Object.keys(merged).length > 0) {
        setCameraPrefill({
          craft: c as CraftId,
          inputs: merged,
          photoTitle: result?.analysis.sceneDescription?.slice(0, 80),
        });
      } else {
        setCameraPrefill(null);
      }
    } else {
      setActiveCraft(null);
      setCameraPrefill(null);
    }
    setView('kalkulatorji');
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(measuresToText(allMeasures));
      toast({ title: 'Meritve kopirane ✓' });
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const reopenPhoto = (rec: PhotoRecord) => {
    let parsed: AnalyzeResponse | null = null;
    try {
      if (rec.analysis) {
        const raw = JSON.parse(rec.analysis) as Partial<AnalyzeResponse>;
        parsed = {
          analysis: normalizePhotoAnalysis(raw.analysis),
          suggestedProducts: Array.isArray(raw.suggestedProducts) ? raw.suggestedProducts : [],
        };
      }
    } catch { parsed = null; }

    setPhotoUrl(rec.dataUrl);
    try {
      setMeasures(rec.measurements ? (JSON.parse(rec.measurements) as PhotoMeasure[]) : []);
    } catch {
      setMeasures([]);
    }
    setLastPhotoId(rec.id);
    if (parsed) {
      setResult(parsed);
      setPhase('result');
    } else {
      setPhase('capture');
      toast({ title: 'Ta fotografija še ni analizirana', description: 'Zaženi novo analizo.' });
    }
  };

  const deletePhoto = async (id: string) => {
    try {
      await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      setGallery((g) => g?.filter((p) => p.id !== id) ?? null);
      if (lastPhotoId === id) {
        setPhase('capture');
        setResult(null);
        setPhotoUrl(null);
        setLastPhotoId(null);
      }
    } catch {
      toast({ title: 'Brisanje ni uspelo', variant: 'destructive' });
    }
  };

  const measureCount = (rec: PhotoRecord): number => {
    try {
      const parsed = rec.measurements ? (JSON.parse(rec.measurements) as unknown[]) : [];
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  };

  // Slovensko oblikovanje števca: 1 fotografija / 2–4 fotografije / 5+ fotografij
  const photoWord = (n: number): string =>
    n === 1 ? 'fotografija' : n >= 2 && n <= 4 ? 'fotografije' : 'fotografij';

  // Projekt iz fotografij — deterministični seštevek vseh analiz v osnutek ponudbe
  const project: ProjectSummary | null = useMemo(() => {
    if (!gallery || gallery.length === 0) return null;
    const summary = buildProjectFromPhotos(
      gallery.map((g) => ({
        id: g.id,
        title: g.title,
        craftId: g.craftId,
        analysis: g.analysis,
        measurements: g.measurements,
      })),
    );
    return summary.groups.length > 0 ? summary : null;
  }, [gallery]);

  const collectProject = () => {
    if (!project) return;
    // Stabilni ključi → ponovno zbiranje POSODOBI količine namesto podvajanja
    const items = project.groups.flatMap((g) =>
      g.lines.map((l) => ({
        key: `proj-${g.craft}-${l.name}`,
        name: l.name,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
      })),
    );
    if (items.length === 0) {
      toast({ title: 'Ni postavk za zbiranje', variant: 'destructive' });
      return;
    }
    addDraftItems(items);
    toast({
      title: `Projekt zbran: ${items.length} postavk ✓`,
      description: `${formatEUR(project.total)} brez DDV — pregledaj in ustvari ponudbo.`,
    });
    setView('ponudbe');
  };

  const tabs: Array<[CameraTab, string, React.ReactNode]> = [
    ['analiza', 'Zajem + analiza', <ScanSearch key="i" className="h-4 w-4" />],
    ['ar', 'AR merjenje', <Ruler key="i" className="h-4 w-4" />],
    ['orodja', 'Pripomočki', <Wrench key="i" className="h-4 w-4" />],
  ];

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
            Skripta prepozna objekte in mere, AR živo meri, laser in glas doda vrednosti — vse gre v kalkulator.
          </p>
        </div>
        {phase === 'result' && tab === 'analiza' && (
          <Button variant="outline" size="sm" onClick={() => { setPhase('capture'); setResult(null); setPhotoUrl(null); setLastPhotoId(null); }}>
            <Camera className="mr-2 h-4 w-4" />
            Nova fotografija
          </Button>
        )}
      </div>

      {/* Zavihki */}
      <div className="flex w-full rounded-lg border p-0.5 bg-secondary/50 sm:w-fit" role="tablist" aria-label="Načini pametne kamere">
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[40px] sm:flex-none ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ── Zajem + analiza ─────────────────────────────────────── */}
      {tab === 'analiza' && phase === 'capture' && (
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
                  Kaj skripta prepozna
                </h3>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {[
                    'Vrsto dela — ograja, stopnice, keramika, terasa…',
                    'Objekte in njihove približne dimenzije',
                    'Ravnine (stene, tla) za merjenje s perspektivno korekcijo',
                    'Materiale, napake in tveganja na objektu',
                    'Referenčni objekt za enoklikovno umerjanje merila',
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
                  <li>Meri tudi površine (m²) in kote (°) — vse gre v kalkulator.</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'analiza' && phase === 'analyzing' && (
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

      {tab === 'analiza' && phase === 'result' && result && photoUrl && (
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
                  surfaces={result.analysis.surfaces}
                  referenceLabel={result.analysis.reference?.label}
                  referenceCm={result.analysis.reference?.assumedCm}
                  referenceBox={result.analysis.referenceBox}
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
          <Card>
            <CardContent className="p-4 sm:p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Box className="h-4 w-4 text-primary" />
                3D predogled meritev — vrti, primerjaj, pokaži stranki
              </h3>
              <Measure3dPreview measures={measures} defaultHeightM={detectedDefaultHeightM} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── AR merjenje ────────────────────────────────────── */}
      {tab === 'ar' && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardContent className="p-4 sm:p-5">
              <LiveAr onCaptureFrame={(img, m) => void handleAnalyze(img, m)} busy={busy} />
            </CardContent>
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardContent className="p-4 sm:p-5 space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Ruler className="h-4 w-4 text-primary" />
                  Kako deluje AR merjenje
                </h3>
                <ol className="list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
                  <li>Vključi kamero in usmeri v objekt.</li>
                  <li>Izberi način: dolžine, površine ali koti.</li>
                  <li>Umeri: klikni 2 točki z znano dolžino (vrata, okno…).</li>
                  <li>Tapni točke — izračun je takojšen.</li>
                  <li>Zamrzni kader za natančnejše tapkanje.</li>
                </ol>
                <p className="text-xs text-muted-foreground">
                  Meri v ravnini objekta (pravokotno na steno) — tako je merilo za cel kadir enako.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 sm:p-5">
                <h3 className="text-sm font-bold">Nasvet za površine</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Za keramiko, teraso ali fasado klikaj oglišča tal/stene in zapri poligon —
                  dobiš m² takoj, ki jih kalkulator upošteva pri odmerku materiala.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Pravi 3D AR (WebXR) — realni metri brez umerjanja */}
          <Card>
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Box className="h-4 w-4 text-primary" />
                  Pravi 3D AR (WebXR) — meri v prostoru, brez umerjanja
                </h3>
                <Badge variant="secondary" className="text-[10px]">Beta</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Na telefonu (Chrome na Androidu z ARCore) tapni točki v prostoru — razdalja je realna,
                brez umerjanja. Na namiznem računalniku uporabi 2D AR merjenje zgoraj.
              </p>
              <WebXrAr onAddMeasure={addAuxMeasure('xr')} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Merilni pripomočki ─────────────────────────────── */}
      {tab === 'orodja' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4 sm:p-5">
                <LaserPanel onAddMeasurement={addAuxMeasure('laser')} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 sm:p-5">
                <VoiceInput onAddMeasurement={addAuxMeasure('voice')} />
              </CardContent>
            </Card>
          </div>

          {auxMeasures.length > 0 && (
            <Card>
              <CardContent className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">Dodane meritve ({auxMeasures.length})</h3>
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => setAuxMeasures([])}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Počisti
                  </Button>
                </div>
                <ul className="max-h-48 space-y-1 overflow-y-auto scroll-area pr-1">
                  {auxMeasures.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
                          {m.kind === 'laser' ? 'laser' : 'glas'}
                        </Badge>
                        <span className="truncate font-medium">{m.label}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <strong className="text-green-700">{m.value !== null ? formatCm(m.value) : '—'}</strong>
                        <button
                          onClick={() => removeAuxMeasure(m.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Izbriši ${m.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col items-start justify-between gap-2 rounded-xl border bg-accent/40 px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              {allMeasures.length > 0
                ? `Skupaj ${allMeasures.length} meritev (fotomeritve + pripomočki) — izvoz ali takojšnja uporaba v kalkulatorju.`
                : 'Meritve iz AR, laserja in glasu se združijo tu in gredo v kalkulator en klik.'}
            </p>
            {allMeasures.length > 0 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="min-h-10" onClick={() => void copyAll()}>
                  <Copy className="mr-1.5 h-4 w-4" />
                  Kopiraj vse
                </Button>
                <Button variant="outline" size="sm" className="min-h-10" onClick={() => downloadMeasuresCsv(allMeasures)}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Prenesi CSV
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Projekt iz fotografij — seštevek vseh analiz ───── */}
      {project && (
        <Card data-testid="photo-project">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Layers className="h-4 w-4 text-primary" />
                  Projekt iz fotografij — samodejni seštevek
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {project.usedPhotos} {photoWord(project.usedPhotos)} ·{' '}
                  {project.groups.length} {project.groups.length === 1 ? 'dejavnost' : 'dejavnosti'} ·{' '}
                  skupaj <strong className="text-foreground">{formatEUR(project.total)}</strong> brez DDV
                  {project.skippedPhotos > 0 && <> · {project.skippedPhotos} preskočenih</>}
                </p>
              </div>
              <Button size="sm" className="min-h-10" onClick={collectProject} data-testid="collect-project">
                <PackagePlus className="mr-2 h-4 w-4" />
                Zberi v ponudbo
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {project.groups.map((g) => (
                <div key={g.craft} className="rounded-lg border bg-secondary/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{g.craftLabel}</p>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {g.photoCount} fot.
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{g.lines.length} postavk</p>
                  <p className="text-sm font-bold text-primary">{formatEUR(g.subtotal)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
            {gallery.map((rec) => {
              const mc = measureCount(rec);
              return (
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
                  {mc > 0 && (
                    <Badge className="absolute right-2 bottom-2 text-[9px] px-1.5 py-0" variant="secondary">
                      {mc} mer.
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
              );
            })}
          </div>
        )}
      </section>

      {/* Povezava naprej */}
      <div className="flex items-center justify-between rounded-xl border bg-accent/40 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Želiš ročni vnos? Kalkulatorji odmerka so še vedno na voljo.
        </p>
        <Button variant="outline" size="sm" onClick={() => openCalculator()}>
          Kalkulatorji
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
