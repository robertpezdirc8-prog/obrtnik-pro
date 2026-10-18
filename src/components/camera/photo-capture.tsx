'use client';

// ─── Zajem fotografije: živa kamera ali nalaganje ───────────
// Na mobilnem uporablja zadnjo kamero (facingMode: environment).
// Kontrola kakovosti (ostrina, svetlost) + NAKLON (deterministični
// deskew) z enoklikovno izravnavo + SNEMALNI VODIČ po dejavnosti.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import {
  Camera, RefreshCw, Upload, ScanSearch, AlertTriangle, CheckCircle2, Images, Zap,
  ListChecks, Crop, RotateCw, Check, Circle, Grid3x3, Compass, Focus, Sun, Sparkles,
} from 'lucide-react';
import { processImage, checkQuality, estimateTilt, autoLevel, type ProcessedImage, type QualityCheck } from '@/lib/image-quality';
import { grayFromImageData, makeStabilityTracker, meanAbsDiff } from '@/lib/stability';
import {
  CAPTURE_GUIDES, GUIDE_CRAFTS, loadGuideDone, resetGuideShots, toggleGuideShot,
} from '@/lib/capture-guide';
import { CRAFT_LABELS, type CraftCategory } from '@/lib/camera-types';

interface PhotoCaptureProps {
  onAnalyze: (img: ProcessedImage) => void;
  busy: boolean;
  /** Dejavnost zadnje analize — predizbor snemalnega vodiča. */
  initialCraft?: CraftCategory | null;
}

type CaptureMode = 'live' | 'upload';
/** Prekrivna mreža za kompozicijo (raziskava task14: Griddr/ruščina). */
type GridMode = 'tretjine' | 'zlati' | 'off';

const GUIDE_LS_KEY = 'obrtnik-vodnik-izbor';
const GRID_LS_KEY = 'obrtnik-mreza';

export function PhotoCapture({ onAnalyze, busy, initialCraft }: PhotoCaptureProps) {
  const [mode, setMode] = useState<CaptureMode>('live');
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);
  const [quality, setQuality] = useState<QualityCheck | null>(null);
  const [tilt, setTilt] = useState<number>(0);
  const [leveling, setLeveling] = useState(false);
  const [leveled, setLeveled] = useState(false);
  const [manualDeg, setManualDeg] = useState(0);
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [camActive, setCamActive] = useState(false);

  // Snemalni vodič
  const [guideCraft, setGuideCraft] = useState<CraftCategory>('ograje');
  const [guideDone, setGuideDone] = useState<Record<string, boolean>>({});

  // Mreža za kompozicijo (tretjine / zlati rez / off) — persist
  const [grid, setGrid] = useState<GridMode>('tretjine');

  // Libela (DeviceOrientation — deterministični senzorski skript)
  const [orient, setOrient] = useState<{ beta: number | null; gamma: number | null }>({ beta: null, gamma: null });
  const [hasOrient, setHasOrient] = useState(false);

  // AUTO-ZAJEM ob mirovanju (deterministični frame-diff skript)
  const [autoCap, setAutoCap] = useState(false);
  const [steady, setSteady] = useState(false);
  const [steadyProgress, setSteadyProgress] = useState(0);
  const [autoFired, setAutoFired] = useState(false);
  const prevGrayRef = useRef<Float32Array | null>(null);
  const trackerRef = useRef(makeStabilityTracker());
  const captureRef = useRef<() => void>(() => undefined);

  // Živi indikator svetlobe (deterministični histogram na vzorcu 64×48)
  const [liveLight, setLiveLight] = useState<'ok' | 'dark' | 'bright' | null>(null);

  // Naloži izbor + stanje vodiča (obvezno v efektu — SSR varno)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GUIDE_LS_KEY);
      if (saved && (GUIDE_CRAFTS as string[]).includes(saved)) setGuideCraft(saved as CraftCategory);
    } catch { /* ni kritično */ }
  }, []);
  useEffect(() => { setGuideDone(loadGuideDone(guideCraft)); }, [guideCraft]);
  useEffect(() => {
    if (initialCraft) setGuideCraft(initialCraft);
  }, [initialCraft]);

  // Mreža + libela: obvezno v efektu (SSR varno)
  useEffect(() => {
    try {
      const g = window.localStorage.getItem(GRID_LS_KEY);
      if (g === 'tretjine' || g === 'zlati' || g === 'off') setGrid(g);
    } catch { /* ni kritično */ }
  }, []);
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta === null && e.gamma === null) return;
      setHasOrient(true);
      setOrient({ beta: e.beta, gamma: e.gamma });
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, []);

  const cycleGrid = () => {
    const next: GridMode = grid === 'tretjine' ? 'zlati' : grid === 'zlati' ? 'off' : 'tretjine';
    setGrid(next);
    try { window.localStorage.setItem(GRID_LS_KEY, next); } catch { /* ni kritično */ }
  };

  const pickGuideCraft = (c: CraftCategory) => {
    setGuideCraft(c);
    try { window.localStorage.setItem(GUIDE_LS_KEY, c); } catch { /* ni kritično */ }
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const startCamera = async () => {
    setCamError(null);
    setStarting(true);
    // iOS 13+: dovoljenje za senzor orientacije (libela) — na gest uporabnika
    try {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DOE.requestPermission === 'function') await DOE.requestPermission().catch(() => undefined);
    } catch { /* libela ni kritična */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCamError('Dostop do kamere ni mogoč (preveri dovoljenja) ali pa kamera ni na voljo. Uporabi nalaganje slike.');
      setMode('upload');
    } finally {
      setStarting(false);
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // Kader mora nastati PREK ustavitve toka: stopStream() odklopi srcObject, video
    // takoj meri 0×0 in platno vrni `data:,` (6 B) namesto fotografije.
    const processed = compressVideo(video);
    stopStream();
    void handleProcessed(processed);
  };

  captureRef.current = captureFrame;

  const compressVideo = (video: HTMLVideoElement): ProcessedImage => {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height };
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setAutoFired(false);
    try {
      const processed = await processImage(file);
      await handleProcessed(processed);
    } catch {
      setCamError('Datoteke ni bilo mogoče prebrati kot sliko.');
    }
  };

  const handleProcessed = async (processed: ProcessedImage) => {
    setPhoto(processed);
    setLeveled(false);
    setManualDeg(0);
    const [q, t] = await Promise.all([checkQuality(processed.dataUrl, processed.width, processed.height), estimateTilt(processed.dataUrl)]);
    setQuality(q);
    setTilt(t);
  };

  const applyLevel = async (deg: number) => {
    if (!photo || deg === 0) return;
    setLeveling(true);
    try {
      const leveledImg = await autoLevel(photo.dataUrl, deg);
      setPhoto(leveledImg);
      const [q, t] = await Promise.all([checkQuality(leveledImg.dataUrl, leveledImg.width, leveledImg.height), estimateTilt(leveledImg.dataUrl)]);
      setQuality(q);
      setTilt(t);
      setLeveled(true);
      setManualDeg(0);
    } catch {
      /* izravnava ni kritična — fotka ostane */
    } finally {
      setLeveling(false);
    }
  };

  const retake = () => {
    setPhoto(null);
    setQuality(null);
    setTilt(0);
    setLeveled(false);
    setManualDeg(0);
    setCamError(null);
    setAutoFired(false);
    if (mode === 'live') void startCamera();
  };

  // ── Auto-zajem: 4 vzorce/s → 64×48 sivine → mean abs diff →
  //    5 zaporednih mirnih vzorcev (≈ 1,25 s) = samodejni posnetek ──
  useEffect(() => {
    if (!autoCap || !camActive || photo || busy) {
      setSteady(false);
      setSteadyProgress(0);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    prevGrayRef.current = null;
    trackerRef.current.reset();
    setSteady(false);
    setSteadyProgress(0);
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      ctx.drawImage(video, 0, 0, 64, 48);
      const gray = grayFromImageData(ctx.getImageData(0, 0, 64, 48).data);
      const diff = meanAbsDiff(prevGrayRef.current, gray);
      prevGrayRef.current = gray;
      const fired = trackerRef.current.push(diff);
      setSteady(trackerRef.current.isStable);
      setSteadyProgress(Math.min(1, trackerRef.current.streak / 5));
      if (fired) {
        setAutoFired(true);
        captureRef.current?.();
      }
    }, 250);
    return () => {
      clearInterval(id);
      setSteady(false);
      setSteadyProgress(0);
    };
  }, [autoCap, camActive, photo, busy]);

  // ── Živa svetloba: 64×48 vzorec vs. 600 ms → povprečje + klipanje.
  //    Isti pragovi kot končna kontrola kakovosti (samo mehkejši pragi
  //    zaradi majhnega vzorca) — pokaze se, da uporabnik popravi
  //    svetlobo PRED posnetkom, ne šele pri opozorilu po njem.
  useEffect(() => {
    if (!camActive || photo) {
      setLiveLight(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      ctx.drawImage(video, 0, 0, 64, 48);
      const gray = grayFromImageData(ctx.getImageData(0, 0, 64, 48).data);
      let sum = 0;
      let dark = 0;
      let bright = 0;
      for (let i = 0; i < gray.length; i++) {
        sum += gray[i];
        if (gray[i] < 12) dark++;
        if (gray[i] > 243) bright++;
      }
      const mean = sum / gray.length;
      const darkPct = (100 * dark) / gray.length;
      const brightPct = (100 * bright) / gray.length;
      setLiveLight(
        mean < 55 || darkPct > 30 ? 'dark'
        : mean > 215 || brightPct > 30 ? 'bright'
        : 'ok',
      );
    }, 600);
    return () => clearInterval(id);
  }, [camActive, photo]);

  // ─── Predogled s kontrola kakovosti + naklon ─────────────
  if (photo) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border">
          <img src={photo.dataUrl} alt="Zajeta fotografija za analizo" className="block max-h-[420px] w-full object-contain bg-secondary" />
        </div>

        {quality && !quality.ok && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" role="alert" data-testid="quality-card">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <p className="flex-1 font-semibold">Kontrola kakovosti</p>
              <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-bold text-amber-900" data-testid="quality-score">
                {quality.score}/100 · {quality.verdict}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${quality.blurScore >= 90 ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-400 bg-amber-100 text-amber-900'}`}>
                <Focus className="h-3 w-3" /> Ostrina {quality.blurScore < 35 ? 'slaba' : quality.blurScore < 90 ? 'mejna' : 'ok'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${quality.exposureOk ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-400 bg-amber-100 text-amber-900'}`}>
                <Sun className="h-3 w-3" /> Svetloba {quality.exposureOk ? 'ok' : 'slaba'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${quality.glareOk ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-400 bg-amber-100 text-amber-900'}`} data-testid="quality-glare">
                <Sparkles className="h-3 w-3" /> Odsevi {quality.glareOk ? 'brez' : `${quality.glarePct.toFixed(1).replace('.', ',')} %`}
              </span>
            </div>
            <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground" data-testid="quality-tips">
              {quality.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
              {quality.tips.map((t, i) => <li key={`t${i}`} className="text-foreground/80">Nasvet: {t}</li>)}
            </ul>
          </div>
        )}
        {quality?.ok && (
          <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="quality-card">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="flex-1">Fotografija je ostro in dobro osvetljena — pripravljena za analizo.</span>
            <span className="rounded-full bg-green-200/70 px-2 py-0.5 text-[11px] font-bold text-green-900" data-testid="quality-score">
              {quality.score}/100 · {quality.verdict}
            </span>
          </div>
        )}
        {autoFired && (
          <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800" data-testid="capture-auto-fired">
            <Zap className="h-3.5 w-3.5 shrink-0" />
            Samodejni posnetek — kadr je bil miren, zato oster.
          </div>
        )}

        {tilt !== 0 && !leveled && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="tilt-warning">
            <RotateCw className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Skripta zazna naklon ≈ <strong>{Math.abs(tilt)}°</strong> — izravnava izboljša meritve in vizualizer.
            </span>
            <Button size="sm" variant="outline" className="min-h-9 border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => setManualDeg(Math.max(-10, Math.min(10, tilt)))} data-testid="tilt-use-detected">
              <Crop className="mr-1.5 h-3.5 w-3.5" />
              Uporabi zaznano ({tilt}°)
            </Button>
          </div>
        )}

        {/* Ročna izravnava naklona (deterministični deskew) */}
        <div className="rounded-xl border p-3 space-y-2" data-testid="tilt-box">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Crop className="h-4 w-4 text-primary" />
              Naklon fotografije
            </span>
            <span className="text-xs font-medium text-muted-foreground" data-testid="tilt-value">
              {manualDeg > 0 ? `+${manualDeg}` : manualDeg}°
            </span>
          </div>
          <Slider
            value={[manualDeg]}
            min={-10}
            max={10}
            step={0.5}
            onValueChange={(v) => setManualDeg(v[0] ?? 0)}
            aria-label="Naklon v stopinjah"
            data-testid="tilt-slider"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-9" onClick={() => void applyLevel(manualDeg)} disabled={leveling || manualDeg === 0} data-testid="level-photo">
              <Crop className="mr-1.5 h-3.5 w-3.5" />
              {leveling ? 'Izravnavam…' : 'Izravnaj fotko'}
            </Button>
            <Button size="sm" variant="ghost" className="min-h-9" onClick={() => setManualDeg(0)}>
              Ponastavi naklon
            </Button>
            {leveled && (
              <span className="flex items-center gap-1.5 text-xs text-green-700" data-testid="tilt-leveled">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Izravnano ✓
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button size="lg" className="flex-1 min-h-12" onClick={() => onAnalyze(photo)} disabled={busy}>
            {busy ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Analiziram…
              </>
            ) : (
              <>
                <ScanSearch className="mr-2 h-5 w-5" />
                Analiziraj s pametjo
              </>
            )}
          </Button>
          <Button size="lg" variant="outline" className="min-h-12" onClick={retake} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Zamenjaj fotko
          </Button>
        </div>
      </div>
    );
  }

  // ─── Zajem ────────────────────────────────────────────────
  const shots = CAPTURE_GUIDES[guideCraft];
  const doneCount = shots.filter((s) => guideDone[s.id]).length;

  // Libela: telefon pokonci (beta ≈ 90°) in raven (|gamma| < 1,5°)
  const levelOk =
    orient.beta !== null && orient.gamma !== null &&
    Math.abs(orient.gamma) < 1.5 && Math.abs(orient.beta - 90) < 4;

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg border p-0.5 bg-secondary/50 w-fit">
        <button
          onClick={() => { setMode('live'); setCamError(null); void startCamera(); }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={mode === 'live'}
        >
          <Camera className="h-4 w-4" />
          Kamera
        </button>
        <button
          onClick={() => { setMode('upload'); stopStream(); }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === 'upload' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={mode === 'upload'}
        >
          <Upload className="h-4 w-4" />
          Naloži sliko
        </button>
      </div>

      {mode === 'live' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={cycleGrid} aria-pressed={grid !== 'off'} data-testid="capture-grid">
            <Grid3x3 className="mr-1.5 h-3.5 w-3.5" />
            Mreža: {grid === 'tretjine' ? 'tretjine' : grid === 'zlati' ? 'zlati rez' : 'izklop'}
          </Button>
          <Button
            size="sm"
            variant={autoCap ? 'secondary' : 'outline'}
            className="min-h-9 text-xs"
            onClick={() => setAutoCap((v) => !v)}
            aria-pressed={autoCap}
            data-testid="capture-auto"
          >
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Auto-zajem: {autoCap ? 'vklopljen' : 'izklopljen'}
          </Button>
          {!hasOrient && camActive && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="capture-level-unsupported">
              <Compass className="h-3.5 w-3.5" />
              Libela: senzor orientacije ni na voljo (namizni brskalnik)
            </span>
          )}
        </div>
      )}

      {camError && mode !== 'live' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {camError}
        </div>
      )}

      {mode === 'live' ? (
        <div className="relative overflow-hidden rounded-xl border bg-zinc-950 aspect-[3/4] sm:aspect-[4/3]">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" aria-label="Živi predogled kamere" />
          {!camActive && !camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
              <Camera className="h-10 w-10 opacity-70" />
              <p className="text-sm opacity-90">Vključi kamero in fotografiraj ograjo, stopnice, ploščice, teraso, okna, nadstrešek ali fasado.</p>
              <Button onClick={startCamera} disabled={starting} className="min-h-11">
                {starting ? (
                  <>
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Vklapljam…
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Vključi kamero
                  </>
                )}
              </Button>
            </div>
          )}
          {camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
              <AlertTriangle className="h-10 w-10 text-amber-400" />
              <p className="text-sm opacity-90">{camError}</p>
            </div>
          )}
          {/* AR namigi: mreža (tretjine/zlati rez) + vogalniški okvir */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {grid === 'tretjine' && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35" data-testid="capture-grid-overlay">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border-[0.5px] border-white/20" />
                ))}
              </div>
            )}
            {grid === 'zlati' && (
              <div className="absolute inset-0 opacity-40" data-testid="capture-grid-overlay">
                <span className="absolute inset-y-0 left-[38.2%] w-px bg-white/30" />
                <span className="absolute inset-y-0 left-[61.8%] w-px bg-white/30" />
                <span className="absolute inset-x-0 top-[38.2%] h-px bg-white/30" />
                <span className="absolute inset-x-0 top-[61.8%] h-px bg-white/30" />
              </div>
            )}
            <span className="absolute left-3 top-3 h-8 w-8 rounded-tl-lg border-l-2 border-t-2 border-primary/80" />
            <span className="absolute right-3 top-3 h-8 w-8 rounded-tr-lg border-r-2 border-t-2 border-primary/80" />
            <span className="absolute bottom-3 left-3 h-8 w-8 rounded-bl-lg border-b-2 border-l-2 border-primary/80" />
            <span className="absolute bottom-3 right-3 h-8 w-8 rounded-br-lg border-b-2 border-r-2 border-primary/80" />
            <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white">
              Postavi objekt in referenco v okvir
            </span>
          </div>
          {/* Libela: pokoncen in raven držanje telefona = zelena (senzorski skript) */}
          {hasOrient && orient.beta !== null && orient.gamma !== null && (
            <div className="absolute right-3 top-14 flex flex-col items-center gap-1" data-testid="capture-level">
              <div className="relative h-14 w-14 rounded-full border-2 border-white/70 bg-black/40">
                <span className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-white/25" aria-hidden="true" />
                <span className="absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-white/25" aria-hidden="true" />
                <span
                  className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ${levelOk ? 'bg-green-400' : 'bg-amber-300'}`}
                  style={{
                    left: `calc(50% + ${Math.max(-22, Math.min(22, orient.gamma * 0.75))}px)`,
                    top: `calc(50% + ${Math.max(-22, Math.min(22, (90 - orient.beta) * 0.75))}px)`,
                  }}
                  data-testid="capture-level-dot"
                />
              </div>
              <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="capture-level-state">
                {levelOk ? 'Ravno ✓' : `${Math.abs(orient.gamma).toFixed(0)}°`}
              </span>
            </div>
          )}
          {/* Živi indikator svetlobe (histogram na vzorcu) — popravi svetlobo PRED posnetkom */}
          {camActive && liveLight && (
            <div
              className={`absolute bottom-4 left-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${liveLight === 'ok' ? 'bg-black/55' : 'bg-amber-900/70'}`}
              data-testid="capture-light"
            >
              <Sun className={`h-3 w-3 ${liveLight === 'ok' ? 'text-green-400' : 'text-amber-300'}`} />
              {liveLight === 'ok' ? 'Svetloba: prav ✓' : liveLight === 'dark' ? 'Pretemno — poišči svetlobo' : 'Presvetlo — se umakni od sonca'}
            </div>
          )}
          {/* Auto-zajem: indikator mirovanja (deterministični frame-diff) */}
          {autoCap && camActive && (
            <div className="absolute left-3 top-14 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white" data-testid="capture-steady">
              <span className={`h-2 w-2 rounded-full ${steady ? 'bg-green-400' : 'bg-amber-300'}`} />
              {steady ? 'Miren kadr — posnamem ✓' : 'Drži mirno …'}
            </div>
          )}
          {camActive && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
              <span className="relative inline-flex">
                {/* Progress obroč: koliko mirovanja še manjka (percent-done feedback) */}
                {autoCap && (
                  <svg className="pointer-events-none absolute -inset-2" viewBox="0 0 80 80" aria-hidden="true" data-testid="capture-ring">
                    <circle cx="40" cy="40" r="37" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="4" />
                    <circle
                      cx="40" cy="40" r="37" fill="none"
                      stroke={steady ? '#4ade80' : '#fbbf24'}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 37}
                      strokeDashoffset={2 * Math.PI * 37 * (1 - steadyProgress)}
                      transform="rotate(-90 40 40)"
                      style={{ transition: 'stroke-dashoffset 150ms linear' }}
                    />
                  </svg>
                )}
                <button
                  onClick={captureFrame}
                  disabled={busy}
                  aria-label="Posnemi fotografijo"
                  className="h-16 w-16 rounded-full border-4 border-white bg-primary shadow-lg transition-transform active:scale-95 disabled:opacity-50"
                />
              </span>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Naloži fotografijo z naprave"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Images className="h-6 w-6 text-primary" />
          </span>
          <span className="text-sm font-medium">Klikni in izberi fotografijo z naprave</span>
          <span className="text-xs text-muted-foreground">JPG, PNG ali WebP — samodejno jo stisnemo</span>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
        aria-hidden="true"
      />

      {mode === 'upload' && (
        <Button variant="outline" className="w-full min-h-11" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Izberi datoteko
        </Button>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-secondary/50 p-3 text-xs text-muted-foreground">
        <Badge variant="secondary" className="shrink-0">Namig</Badge>
        <p>
          Na fotografijo ujami <strong>cel objekt</strong> in <strong>znano referenco</strong> (vrata, okno,
          ploščico ali osebo) — analiza jo uporabi za oceno mer in za umerjanje merila.
        </p>
      </div>

      {/* Snemalni vodič po dejavnosti */}
      <div className="rounded-xl border p-3 sm:p-4" data-testid="capture-guide">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <ListChecks className="h-4 w-4 text-primary" />
            Snemalni vodič
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]" data-testid="guide-progress">
              {doneCount}/{shots.length} posnetkov
            </Badge>
            {doneCount > 0 && (
              <button
                onClick={() => setGuideDone(resetGuideShots(guideCraft))}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Ponastavi
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Dejavnost vodiča">
          {GUIDE_CRAFTS.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={guideCraft === c}
              onClick={() => pickGuideCraft(c)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors min-h-[28px] ${guideCraft === c ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'}`}
              data-testid={`guide-craft-${c}`}
            >
              {CRAFT_LABELS[c]}
            </button>
          ))}
        </div>

        <Progress value={(doneCount / shots.length) * 100} className="mt-3 h-1.5" aria-label="Napredek snemanja" />

        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto scroll-area pr-1">
          {shots.map((s) => {
            const done = !!guideDone[s.id];
            return (
              <li key={s.id}>
                <button
                  onClick={() => setGuideDone(toggleGuideShot(guideCraft, s.id))}
                  aria-pressed={done}
                  className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${done ? 'border-green-300 bg-green-50/70' : 'border-border hover:bg-accent/40'}`}
                  data-testid={`guide-shot-${s.id}`}
                >
                  {done ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className="min-w-0">
                    <span className={`block text-xs font-semibold ${done ? 'text-green-800' : ''}`}>{s.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
