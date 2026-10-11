'use client';

// ─── Živo AR merjenje: tap-to-measure na video kadru ────────
// • Dolžine (2 točki) · Površine (poligon → m²) · Koti (3 točke)
// • Umerjanje z znano referenco (vrata, okno, oseba, ploščica…)
// • Zamrznitev kadra za natančnejše merjenje
// • "Posnemi in analiziraj" — kader + meritve gredo v samodejno analizo
//
// TOČKE SO V % PRIKAZA. Prikaz uporablja object-cover (crop), zato
// izračuni tečejo v "videnih naravnih pikslih": uniform skala
// scale = max(rectW/natW, rectH/natH) → size = rect/scale.
// Razdalje, ploščine in koti so pri uniform skali pravilni.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Camera, AlertTriangle, Zap, Ruler, Square, TriangleRight,
  Crosshair, Check, X, Undo2, Maximize, Snowflake, Play, Sparkles, Trash2, Magnet,
} from 'lucide-react';
import { compressElement, type ProcessedImage } from '@/lib/image-quality';
import { buildEdgeMap, snapPoint, type EdgeMap } from '@/lib/edge-detect';
import type { PhotoMeasure, MeasureKind } from '@/lib/camera-types';
import {
  angleAt, centroidPct, formatCm, formatDeg, formatM2, lengthCm,
  polygonAreaM2, polygonSidesCm, type ImgSize, type XY,
} from '@/lib/measure-geometry';

interface Pt { x: number; y: number } // % prikaza

interface LiveArProps {
  onCaptureFrame: (img: ProcessedImage, measures: PhotoMeasure[]) => void;
  busy: boolean;
}

type ArMode = 'length' | 'area' | 'angle';

let arSeq = 0;
const nextId = () => `ar${++arSeq}-${Date.now()}`;

const QUICK_REFS: Array<{ label: string; cm: number }> = [
  { label: 'Vrata 200', cm: 200 },
  { label: 'Okno 120', cm: 120 },
  { label: 'Ploščica 60', cm: 60 },
  { label: 'Kartica 8,6', cm: 8.6 },
  { label: 'Oseba 170', cm: 170 },
];

export function LiveAr({ onCaptureFrame, busy }: LiveArProps) {
  const [mode, setMode] = useState<ArMode>('length');
  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [frozen, setFrozen] = useState<ProcessedImage | null>(null);
  const [vSize, setVSize] = useState<{ w: number; h: number } | null>(null);
  const [pending, setPending] = useState<Pt[]>([]);
  const [pxPerCm, setPxPerCm] = useState<number | null>(null);
  const [calibOpen, setCalibOpen] = useState(false);
  const [calibInput, setCalibInput] = useState('');
  const [arMeasures, setArMeasures] = useState<PhotoMeasure[]>([]);
  // Magnet (pripenjanje na robove) — deluje na zamrznjenem kadru
  const [magnet, setMagnet] = useState(true);
  const [edge, setEdge] = useState<EdgeMap | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
      setCamError('Dostop do kamere ni mogoč (preveri dovoljenja) ali pa kamera ni na voljo.');
    } finally {
      setStarting(false);
    }
  };

  const onMeta = () => {
    const v = videoRef.current;
    if (v?.videoWidth) setVSize({ w: v.videoWidth, h: v.videoHeight });
  };

  // Vidno območje v naravnih pikslih (object-cover uniform skala)
  const frameSize = (): ImgSize | null => {
    const el = wrapRef.current;
    if (!el || !vSize) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const scale = Math.max(rect.width / vSize.w, rect.height / vSize.h);
    return { w: rect.width / scale, h: rect.height / scale };
  };

  const ptFromEvent = (e: React.MouseEvent<HTMLDivElement>): Pt | null => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const countKind = (kind: MeasureKind, list: PhotoMeasure[]) => list.filter((m) => m.kind === kind).length;

  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    const raw = ptFromEvent(e);
    if (!raw) return;
    const pt = snapPt(raw);

    if (mode === 'area' && pending.length >= 3) {
      const first = pending[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 4) {
        closeArea(pending);
        return;
      }
    }

    const next = [...pending, pt];
    const size = frameSize();

    if (mode === 'length') {
      if (next.length === 2) {
        if (pxPerCm === null || !size) {
          setPending(next);
          setCalibOpen(true);
        } else {
          const cm = lengthCm(next[0], next[1], size, pxPerCm);
          setPending([]);
          if (cm !== null) {
            setArMeasures((list) => [...list, {
              id: nextId(), label: `Mer ${countKind('length', list) + 1}`, kind: 'length', value: cm,
              points: [[next[0].x, next[0].y], [next[1].x, next[1].y]],
            }]);
          }
        }
        return;
      }
      setPending(next);
      return;
    }

    if (mode === 'angle') {
      if (next.length === 3) {
        setPending([]);
        if (!size) return;
        const deg = angleAt(next[0], next[1], next[2], size);
        setArMeasures((list) => [...list, {
          id: nextId(), label: `Kot ${countKind('angle', list) + 1}`, kind: 'angle', value: deg,
          points: next.map((p) => [p.x, p.y] as [number, number]),
        }]);
        return;
      }
      setPending(next);
      return;
    }

    setPending(next);
  };

  const closeArea = (pts: Pt[]) => {
    const size = frameSize();
    if (pxPerCm === null || !size) {
      setPending(pts);
      setCalibOpen(true);
      return;
    }
    const area = polygonAreaM2(pts, size, pxPerCm);
    const sides = polygonSidesCm(pts, size, pxPerCm);
    setPending([]);
    if (area === null) return;
    setArMeasures((list) => [...list, {
      id: nextId(), label: `Površina ${countKind('area', list) + 1}`, kind: 'area', value: area,
      points: pts.map((p) => [p.x, p.y] as [number, number]), sides,
    }]);
  };

  const confirmCalibration = (cmOverride?: number) => {
    const cm = cmOverride ?? Number(calibInput.replace(',', '.'));
    if (!Number.isFinite(cm) || cm <= 0 || pending.length < 2) return;
    const size = frameSize();
    if (!size) return;
    const px = Math.hypot(
      ((pending[1].x - pending[0].x) / 100) * size.w,
      ((pending[1].y - pending[0].y) / 100) * size.h,
    );
    const scale = px / cm;
    setPxPerCm(scale);

    if (mode === 'area' && pending.length >= 3) {
      closeArea(pending);
    } else {
      setArMeasures((list) => [...list, {
        id: nextId(), label: 'Merilo (umerjanje)', kind: 'length', value: Math.round(cm * 10) / 10,
        points: [[pending[0].x, pending[0].y], [pending[1].x, pending[1].y]],
      }]);
      setPending([]);
    }
    setCalibOpen(false);
  };

  const freeze = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const img = compressElement(video, video.videoWidth, video.videoHeight);
    setFrozen(img);
    video.pause();
    buildEdgeMap(img.dataUrl).then((m) => setEdge(m)).catch(() => setEdge(null));
  };

  const unfreeze = () => {
    setFrozen(null);
    setEdge(null);
    void videoRef.current?.play().catch(() => {});
  };

  /** % prikaza (object-cover obrez) → % celotnega kadra. */
  const displayToFrame = (p: Pt): Pt | null => {
    if (!vSize) return null;
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const scale = Math.max(rect.width / vSize.w, rect.height / vSize.h);
    const visW = rect.width / scale;
    const visH = rect.height / scale;
    const offX = (vSize.w - visW) / 2;
    const offY = (vSize.h - visH) / 2;
    return {
      x: ((offX + (p.x / 100) * visW) / vSize.w) * 100,
      y: ((offY + (p.y / 100) * visH) / vSize.h) * 100,
    };
  };

  const frameToDisplay = (p: Pt): Pt | null => {
    if (!vSize) return null;
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const scale = Math.max(rect.width / vSize.w, rect.height / vSize.h);
    const visW = rect.width / scale;
    const visH = rect.height / scale;
    const offX = (vSize.w - visW) / 2;
    const offY = (vSize.h - visH) / 2;
    const fx = (p.x / 100) * vSize.w - offX;
    const fy = (p.y / 100) * vSize.h - offY;
    return { x: (fx / visW) * 100, y: (fy / visH) * 100 };
  };

  /** Pripni točko na rob (samo zamrznjen kadar). */
  const snapPt = (p: Pt): Pt => {
    if (!magnet || !frozen || !edge) return p;
    const fr = displayToFrame(p);
    if (!fr) return p;
    const snapped = snapPoint(fr, edge);
    if (!snapped.snapped) return p;
    const back = frameToDisplay(snapped.point);
    return back ?? p;
  };

  const sendToAnalysis = () => {
    let img: ProcessedImage | null = null;
    if (frozen) {
      img = frozen;
    } else {
      const video = videoRef.current;
      if (!video?.videoWidth) return;
      img = compressElement(video, video.videoWidth, video.videoHeight);
    }
    onCaptureFrame(img, arMeasures);
  };

  const areaPending = mode === 'area' && pending.length > 0;
  const modeHint: Record<ArMode, string> = {
    length: 'Klikni 2 točki na kadru — dolžina se izpiše v cm. Prvi par umeri merilo.',
    area: 'Klikaj oglišča površine; klik na prvo oglišče (ali gumb) zapre poligon → m².',
    angle: 'Klikni 3 točke: krak, oglišče kota, krak → kot v stopinjah.',
  };

  return (
    <div className="space-y-3">
      {!camActive && !frozen && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Camera className="h-6 w-6 text-primary" />
          </span>
          <p className="max-w-sm text-sm text-muted-foreground">
            Živo AR merjenje: usmeri kamero, tapni dve točki in takoj vidiš dolžino.
            Meri daljice, površine in kote — brez merilnega traku.
          </p>
          <Button onClick={startCamera} disabled={starting} className="min-h-11">
            {starting ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Vklapljam…
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Vključi AR merjenje
              </>
            )}
          </Button>
        </div>
      )}

      {camError && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {camError}
        </div>
      )}

      {(camActive || frozen) && (
        <>
          {/* Načini + stanje */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border p-0.5 bg-secondary/50">
              {([
                ['length', 'Dolžine', <Ruler key="i" className="h-4 w-4" />],
                ['area', 'Površine', <Square key="i" className="h-4 w-4" />],
                ['angle', 'Koti', <TriangleRight key="i" className="h-4 w-4" />],
              ] as Array<[ArMode, string, React.ReactNode]>).map(([m, label, icon]) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setPending([]); }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  aria-pressed={mode === m}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            {pxPerCm !== null ? (
              <Badge variant="outline" className="gap-1.5">
                <Check className="h-3 w-3 text-green-600" />
                Merilo umerjeno
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                Umeri z znano referenco
              </Badge>
            )}
            {frozen && <Badge variant="secondary">Kader zamrznjen</Badge>}
            <button
              onClick={() => setMagnet(!magnet)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${magnet ? 'border-primary/50 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={magnet}
              aria-label="Magnet: pripenjanje točk na robove zamrznjenega kadra"
              title={frozen ? 'Klik se pripne na najbližji rob' : 'Magnet deluje na zamrznjenem kadru'}
            >
              <Magnet className="h-4 w-4" />
              Magnet
            </button>
          </div>

          <p className="text-xs text-muted-foreground">{modeHint[mode]}</p>

          {/* Kader + overlay */}
          <div
            ref={wrapRef}
            onClick={addPoint}
            className="relative aspect-[3/4] w-full cursor-crosshair overflow-hidden rounded-xl border bg-zinc-950 select-none sm:aspect-[4/3]"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              onLoadedMetadata={onMeta}
              className={`h-full w-full object-cover ${frozen ? 'invisible' : ''}`}
              aria-label="Živi AR kader"
            />
            {frozen && (
              <img src={frozen.dataUrl} alt="Zamrznjen kader" className="absolute inset-0 h-full w-full object-cover" />
            )}

            {/* AR mreža + vogalniki */}
            {!frozen && (
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border-[0.5px] border-white/20" />
                  ))}
                </div>
                <span className="absolute left-3 top-3 h-8 w-8 rounded-tl-lg border-l-2 border-t-2 border-primary/80" />
                <span className="absolute right-3 top-3 h-8 w-8 rounded-tr-lg border-r-2 border-t-2 border-primary/80" />
                <span className="absolute bottom-3 left-3 h-8 w-8 rounded-bl-lg border-b-2 border-l-2 border-primary/80" />
                <span className="absolute bottom-3 right-3 h-8 w-8 rounded-br-lg border-b-2 border-r-2 border-primary/80" />
              </div>
            )}

            {/* Overlay risbe */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full pointer-events-none">
              {arMeasures.filter((m) => m.kind === 'length').map((m) => (
                <line
                  key={m.id}
                  x1={m.points[0][0]} y1={m.points[0][1]}
                  x2={m.points[1][0]} y2={m.points[1][1]}
                  stroke="currentColor" strokeWidth={2.5}
                  className="text-green-500" vectorEffect="non-scaling-stroke"
                />
              ))}
              {arMeasures.filter((m) => m.kind === 'area').map((m) => (
                <polygon
                  key={m.id}
                  points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  className="fill-green-500/25 stroke-green-400"
                  strokeWidth={2.5} vectorEffect="non-scaling-stroke"
                />
              ))}
              {arMeasures.filter((m) => m.kind === 'angle').map((m) => (
                <polyline
                  key={m.id}
                  points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none" stroke="currentColor" strokeWidth={2.5}
                  className="text-orange-500" vectorEffect="non-scaling-stroke"
                />
              ))}
              {pending.length >= 2 && mode === 'area' && (
                <polygon
                  points={pending.map((p) => `${p.x},${p.y}`).join(' ')}
                  className="fill-amber-500/20 stroke-amber-400"
                  strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* Oznake */}
            {arMeasures.filter((m) => m.kind === 'length' && m.value !== null).map((m) => {
              const mx = (m.points[0][0] + m.points[1][0]) / 2;
              const my = (m.points[0][1] + m.points[1][1]) / 2;
              return (
                <span key={`l-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${mx}%`, top: `${my}%` }}>
                  {formatCm(m.value!)}
                </span>
              );
            })}
            {arMeasures.filter((m) => m.kind === 'area').map((m) => {
              const c = centroidPct(m.points);
              return (
                <span key={`a-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
                  {formatM2(m.value ?? 0)}
                </span>
              );
            })}
            {arMeasures.filter((m) => m.kind === 'angle').map((m) => {
              const v = m.points[1];
              return (
                <span key={`x-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${v[0]}%`, top: `${v[1]}%` }}>
                  {formatDeg(m.value ?? 0)}
                </span>
              );
            })}
            {pending.map((p, i) => (
              <span key={`d-${i}`} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
            ))}
          </div>

          {/* Pomožni gumbi poligona */}
          {areaPending && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => closeArea(pending)} disabled={pending.length < 3} className="min-h-11">
                <Maximize className="mr-1.5 h-4 w-4" />
                Zapri površino ({pending.length})
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPending(pending.slice(0, -1))} className="min-h-11">
                <Undo2 className="mr-1.5 h-4 w-4" />
                Razveljavi točko
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending([])} className="min-h-11">
                <X className="mr-1.5 h-4 w-4" />
                Prekini
              </Button>
            </div>
          )}

          {/* Umerjanje */}
          {calibOpen && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" role="dialog" aria-label="Umerjanje merila v živem pogledu">
              <div className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold">Koliko cm je izbrana daljica na kadru?</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REFS.map((r) => (
                  <button
                    key={r.cm}
                    onClick={() => { setCalibInput(String(r.cm)); confirmCalibration(r.cm); }}
                    className="min-h-[32px] rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-accent"
                    aria-label={`Umeri na ${r.label}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  min={1}
                  placeholder="npr. 200"
                  value={calibInput}
                  onChange={(e) => setCalibInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmCalibration(); }}
                  className="max-w-32"
                  aria-label="Prava dolžina v centimetrih"
                />
                <Button size="sm" onClick={() => confirmCalibration()} disabled={!calibInput} className="min-h-11">
                  <Check className="mr-1 h-4 w-4" />
                  Umeri
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setCalibOpen(false); setPending([]); }} className="min-h-11">
                  <X className="mr-1 h-4 w-4" />
                  Prekliči
                </Button>
              </div>
            </div>
          )}

          {/* Akcije */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1 min-h-12" onClick={sendToAnalysis} disabled={busy}>
              {busy ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Analiziram…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Posnemi in analiziraj
                </>
              )}
            </Button>
            {frozen ? (
              <Button variant="outline" className="min-h-12" onClick={unfreeze}>
                <Play className="mr-2 h-4 w-4" />
                Nadaljuj živo
              </Button>
            ) : (
              <Button variant="outline" className="min-h-12" onClick={freeze}>
                <Snowflake className="mr-2 h-4 w-4" />
                Zamrzni kader
              </Button>
            )}
          </div>
        </>
      )}

      {/* AR meritve */}
      {arMeasures.length > 0 && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">AR meritve ({arMeasures.length})</Label>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => { setArMeasures([]); setPxPerCm(null); }}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Počisti vse
            </Button>
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto scroll-area pr-1">
            {arMeasures.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
                    {m.kind === 'area' ? 'm²' : m.kind === 'angle' ? '°' : 'cm'}
                  </Badge>
                  <span className="truncate font-medium">{m.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <strong className="text-green-700">
                    {m.value === null ? '—' : m.kind === 'area' ? formatM2(m.value) : m.kind === 'angle' ? formatDeg(m.value) : formatCm(m.value)}
                  </strong>
                  <button
                    onClick={() => setArMeasures((l) => l.filter((x) => x.id !== m.id))}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Izbriši ${m.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Meritve gredo skupaj s kadrom v samodejno analizo in se upoštevajo pri odpiranju kalkulatorja.
          </p>
        </div>
      )}
    </div>
  );
}
