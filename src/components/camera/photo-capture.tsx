'use client';

// ─── Zajem fotografije: živa kamera ali nalaganje ───────────
// Na mobilnem uporablja zadnjo kamero (facingMode: environment).
// Vključuje kontrolo kakovosti (ostrina, svetlost) s priporočili.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, RefreshCw, Upload, ScanSearch, AlertTriangle, CheckCircle2, Images, Zap } from 'lucide-react';
import { processImage, checkQuality, type ProcessedImage, type QualityCheck } from '@/lib/image-quality';

interface PhotoCaptureProps {
  onAnalyze: (img: ProcessedImage) => void;
  busy: boolean;
}

type CaptureMode = 'live' | 'upload';

export function PhotoCapture({ onAnalyze, busy }: PhotoCaptureProps) {
  const [mode, setMode] = useState<CaptureMode>('live');
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);
  const [quality, setQuality] = useState<QualityCheck | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [camActive, setCamActive] = useState(false);

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
    stopStream();
    const processed = compressVideo(video);
    void handleProcessed(processed);
  };

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
    try {
      const processed = await processImage(file);
      await handleProcessed(processed);
    } catch {
      setCamError('Datoteke ni bilo mogoče prebrati kot sliko.');
    }
  };

  const handleProcessed = async (processed: ProcessedImage) => {
    setPhoto(processed);
    const q = await checkQuality(processed.dataUrl);
    setQuality(q);
  };

  const retake = () => {
    setPhoto(null);
    setQuality(null);
    setCamError(null);
    if (mode === 'live') void startCamera();
  };

  // ─── Predogled s kontrola kakovosti ──────────────────────
  if (photo) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border">
          <img src={photo.dataUrl} alt="Zajeta fotografija za analizo" className="block max-h-[420px] w-full object-contain bg-secondary" />
        </div>

        {quality && !quality.ok && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-semibold">Kontrola kakovosti</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {quality.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          </div>
        )}
        {quality?.ok && (
          <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Fotografija je ostro in dobro osvetljena — pripravljena za analizo.
          </div>
        )}

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
          {/* AR namigi: mreža tretjin + vogalniški okvir */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border-[0.5px] border-white/20" />
              ))}
            </div>
            <span className="absolute left-3 top-3 h-8 w-8 rounded-tl-lg border-l-2 border-t-2 border-primary/80" />
            <span className="absolute right-3 top-3 h-8 w-8 rounded-tr-lg border-r-2 border-t-2 border-primary/80" />
            <span className="absolute bottom-3 left-3 h-8 w-8 rounded-bl-lg border-b-2 border-l-2 border-primary/80" />
            <span className="absolute bottom-3 right-3 h-8 w-8 rounded-br-lg border-b-2 border-r-2 border-primary/80" />
            <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white">
              Postavi objekt in referenco v okvir
            </span>
          </div>
          {camActive && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
              <button
                onClick={captureFrame}
                disabled={busy}
                aria-label="Posnemi fotografijo"
                className="h-16 w-16 rounded-full border-4 border-white bg-primary shadow-lg transition-transform active:scale-95 disabled:opacity-50"
              />
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
    </div>
  );
}
