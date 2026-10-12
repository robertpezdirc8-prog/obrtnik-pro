'use client';

// ─── Vizualizer: menjava ograj, vzorcev in barv na fotografiji ──
// Deterministični skriptni predogled za stranko (0 AI):
//  • štirikotnik z vlečljivimi vogali (ali zaznana ravnina iz analize)
//  • katalog vzorcev (palice, panel, lamele, pikete, mreža, steklo,
//    WPC deke, ploščice) + palete (RAL, WPC, keramika, fasada)
//  • parametri v cm (razmak, debelina, fuga, prosojnost)
//  • prelakiranje obstoječega objekta (barva × svetlost fotke)
//  • pred/po drsnik, prenos PNG, shranjevanje v galerijo

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Palette, Upload, Download, Save, Crosshair, RefreshCw, Move,
  Fence, Grid3x3, Grid2x2, Columns3, Rows3, PanelTop, Rows2, Square, PaintBucket,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { processImage } from '@/lib/image-quality';
import type { CraftCategory, DetectedSurface } from '@/lib/camera-types';
import {
  DEFAULT_VIZ_PARAMS, VIZ_COLORS, VIZ_GROUP_LABELS, VIZ_STYLES,
  colorGroupsForPattern, defaultColorForPattern, defaultPatternForCraft,
  drawPatternOnQuad, estimateQuadDimsCm, isLightColor, recolorQuadPixels,
  slidersForPattern,
  type VizPattern, type VizParams,
} from '@/lib/viz';

interface VizPanelProps {
  /** Aktualna fotografija (iz analize) ali null → lastno nalaganje. */
  dataUrl: string | null;
  craft: CraftCategory;
  surfaces: DetectedSurface[];
  /** Referenčni objekt za oceno dimenzij (box v % + assumedCm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  onSaved?: () => void;
}

type Quad = [number, number][];

const DEFAULT_QUAD: Quad = [[12, 46], [88, 46], [88, 88], [12, 88]];

const PATTERN_ICONS: Record<VizPattern, React.ReactNode> = {
  vertikalne: <Fence className="h-4 w-4" />,
  panel: <PanelTop className="h-4 w-4" />,
  horizontalne: <Rows3 className="h-4 w-4" />,
  piketna: <Columns3 className="h-4 w-4" />,
  mreza: <Grid3x3 className="h-4 w-4" />,
  steklo: <Square className="h-4 w-4" />,
  terasa: <Rows2 className="h-4 w-4" />,
  ploscice: <Grid2x2 className="h-4 w-4" />,
  barva: <PaintBucket className="h-4 w-4" />,
};

export function VizPanel({ dataUrl, craft, surfaces, reference, onSaved }: VizPanelProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploaded, setUploaded] = useState<{ dataUrl: string } | null>(null);
  const src = dataUrl ?? uploaded?.dataUrl ?? null;

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  const [dragging, setDragging] = useState<number | null>(null);
  const [showHandles, setShowHandles] = useState(true);
  const [pattern, setPattern] = useState<VizPattern>(defaultPatternForCraft(craft));
  const [colorId, setColorId] = useState<string>(defaultColorForPattern(defaultPatternForCraft(craft)).id);
  const [params, setParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [beforeAfter, setBeforeAfter] = useState(60);
  const [saving, setSaving] = useState(false);

  const color = useMemo(
    () => VIZ_COLORS.find((c) => c.id === colorId) ?? VIZ_COLORS[0],
    [colorId],
  );
  const styleInfo = useMemo(() => VIZ_STYLES.find((s) => s.id === pattern)!, [pattern]);

  // Sprememba vzorca → prilagodi paleto (če izbrana barva ni več veljavna)
  useEffect(() => {
    const groups = colorGroupsForPattern(pattern);
    const cur = VIZ_COLORS.find((c) => c.id === colorId);
    if (!cur || !groups.includes(cur.group)) {
      setColorId(defaultColorForPattern(pattern).id);
    }
  }, [pattern, colorId]);

  // Nalaganje slike
  useEffect(() => {
    if (!src) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);

  // Ocena dimenzij iz referenčnega objekta → kalibrira gostoto vzorca
  const dims = useMemo(() => {
    if (!imgEl || !reference) return null;
    return estimateQuadDimsCm(quad, imgEl.naturalWidth, imgEl.naturalHeight, reference);
  }, [imgEl, reference, quad]);

  const effectiveParams: VizParams = useMemo(() => {
    if (dims) {
      const avgW = (dims.topW + dims.botW) / 2;
      if (avgW > 30) return { ...params, quadWidthCm: Math.round(avgW) };
    }
    return params;
  }, [dims, params]);

  // ── Upodobitev: fotka → vzorec/prelakiranje → pred/po ────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const maxSide = 1100;
    const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(2, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(2, Math.round(imgEl.naturalHeight * scale));
    canvas.width = w;
    canvas.height = h;

    // "Po" slika na pomožnem canvasu (za prenos/shranjevanje)
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    octx.drawImage(imgEl, 0, 0, w, h);
    try {
      if (pattern === 'barva') recolorQuadPixels(octx, quad, color.hex);
      else drawPatternOnQuad(octx, imgEl, quad, pattern, color.hex, effectiveParams, craft);
    } catch {
      /* risanje ne sme ustaviti UI */
    }
    afterRef.current = off;

    // Kompozit: pred (desno) / po (levo do lovilca)
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imgEl, 0, 0, w, h);
    const clipW = Math.round((beforeAfter / 100) * w);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipW, h);
    ctx.clip();
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(clipW - 1, 0, 2, h);
  }, [imgEl, quad, pattern, color, effectiveParams, beforeAfter, craft]);

  // ── Vlečenje vogalov ─────────────────────────────────────
  const pctFromEvent = (e: React.PointerEvent): [number, number] => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const onStageMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const p = pctFromEvent(e);
    setQuad((q) => q.map((pt, i) => (i === dragging ? p : pt)) as Quad);
  };

  const applySurface = (s: DetectedSurface) => {
    if (!s.quad || s.quad.length !== 4) return;
    setQuad(s.quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) as Quad);
    toast({ title: 'Ravnina iz analize uporabljena ✓', description: s.label });
  };

  const resetQuad = () => setQuad(DEFAULT_QUAD);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const processed = await processImage(file);
      setUploaded({ dataUrl: processed.dataUrl });
      setQuad(DEFAULT_QUAD);
    } catch {
      toast({ title: 'Slike ni bilo mogoče prebrati.', variant: 'destructive' });
    }
  };

  const downloadPng = () => {
    const off = afterRef.current;
    if (!off) return;
    const a = document.createElement('a');
    a.href = off.toDataURL('image/png');
    a.download = `vizualizacija-${pattern}-${Date.now()}.png`;
    a.click();
    toast({ title: 'Slika prenesena ✓', description: 'Vizualizacijo lahko pošlješ stranki.' });
  };

  const saveToGallery = async () => {
    const off = afterRef.current;
    if (!off) return;
    setSaving(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Vizualizacija — ${styleInfo.label} · ${color.label}`,
          craftId: craft,
          dataUrl: off.toDataURL('image/jpeg', 0.85),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Shranjeno v galerijo ✓', description: `${styleInfo.label} · ${color.label}` });
      onSaved?.();
    } catch {
      toast({ title: 'Shranjevanje ni uspelo', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Prazno stanje: brez fotografije ──────────────────────
  if (!src) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Naloži fotografijo za vizualizacijo"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Palette className="h-6 w-6 text-primary" />
          </span>
          <span className="text-sm font-medium">Naloži fotografijo objekta — ograja, terasa, fasada …</span>
          <span className="text-xs text-muted-foreground">
            Skripta na fotki prikaže nov vzorec in barvo še pred montažo.
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          aria-hidden="true"
        />
      </div>
    );
  }

  const groups = colorGroupsForPattern(pattern);
  const colors = VIZ_COLORS.filter((c) => groups.includes(c.group));
  const sliders = slidersForPattern(pattern);
  const surfaceOptions = surfaces.filter((s) => s.quad && s.quad.length === 4);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* ── Platno z predogledom ──────────────────────────── */}
      <div className="lg:col-span-3">
        <div
          ref={stageRef}
          className="relative select-none overflow-hidden rounded-xl border bg-secondary"
          onPointerMove={onStageMove}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
          data-testid="viz-stage"
        >
          <canvas
            ref={canvasRef}
            className="block h-auto w-full touch-none"
            aria-label="Predogled vizualizacije"
            data-testid="viz-canvas"
          />
          {/* Ogrodje štirikotnika (viewBox 0–100 → % koordinati) */}
          {showHandles && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                points={quad.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="rgba(56,62,66,0.06)"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth="1.5"
                strokeDasharray="1.4 1.1"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {/* Vogališča */}
          {showHandles &&
            quad.map(([x, y], i) => (
              <button
                key={i}
                onPointerDown={(e) => { e.preventDefault(); setDragging(i); }}
                className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-primary/90 shadow-md active:cursor-grabbing"
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={`Voglišče ${i + 1} — vleci za prilagoditvijo`}
                data-testid={`viz-handle-${i}`}
              >
                <Move className="h-3.5 w-3.5 text-white" />
              </button>
            ))}
          {/* Značke prej/po */}
          <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
            PO — {styleInfo.label}
          </span>
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
            PREJ
          </span>
        </div>

        {/* Pred/po drsnik */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Primerjava pred / po</span>
            <span>{beforeAfter}% vizualizacije</span>
          </div>
          <Slider
            value={[beforeAfter]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setBeforeAfter(v[0] ?? 60)}
            aria-label="Pred po primerjava"
            data-testid="viz-before-after"
          />
        </div>

        {/* Dimenzije iz reference */}
        {dims && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            <span>
              Ocena območja (kalibrirano po referenci): širina ≈{' '}
              <strong className="text-foreground">{((dims.topW + dims.botW) / 200).toFixed(2)} m</strong>{' '}
              · višina ≈ <strong className="text-foreground">{((dims.leftH + dims.rightH) / 200).toFixed(2)} m</strong>
            </span>
          </div>
        )}

        {/* Akcije */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="min-h-10" onClick={downloadPng} data-testid="viz-download">
            <Download className="mr-1.5 h-4 w-4" />
            Prenesi PNG
          </Button>
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => void saveToGallery()} disabled={saving} data-testid="viz-save">
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? 'Shranjujem…' : 'Shrani v galerijo'}
          </Button>
          <Button size="sm" variant="ghost" className="min-h-10" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Druga fotka
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* ── Kontrole ──────────────────────────────────────── */}
      <div className="space-y-4 lg:col-span-2">
        {/* Vzorci */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vzorec / slog
          </Label>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2" data-testid="viz-styles">
            {VIZ_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setPattern(s.id)}
                title={s.hint}
                aria-pressed={pattern === s.id}
                className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors ${pattern === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
                data-testid={`viz-style-${s.id}`}
              >
                {PATTERN_ICONS[s.id]}
                <span className="leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{styleInfo.hint}</p>
        </div>

        {/* Barve */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Barva
            </Label>
            <Badge variant="secondary" className="text-[10px]">{color.label}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="viz-colors">
            {colors.map((c) => (
              <button
                key={c.id}
                onClick={() => setColorId(c.id)}
                title={c.label}
                aria-label={c.label}
                aria-pressed={colorId === c.id}
                className={`h-9 w-9 rounded-lg border-2 transition-transform hover:scale-105 ${colorId === c.id ? 'border-primary ring-2 ring-primary/30' : 'border-border'} ${isLightColor(c.hex) ? 'shadow-inner' : ''}`}
                style={{ backgroundColor: c.hex }}
                data-testid={`viz-color-${c.id}`}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {groups.map((g) => VIZ_GROUP_LABELS[g]).join(' · ')}
          </p>
        </div>

        {/* Parametri vzorca */}
        {sliders.length > 0 && (
          <div className="space-y-3 rounded-lg border bg-secondary/30 p-3">
            {sliders.map((s) => (
              <div key={s.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground">
                    {params[s.key]}{s.key === 'glassAlpha' ? '' : ' cm'}
                  </span>
                </div>
                <Slider
                  value={[params[s.key]]}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  onValueChange={(v) => setParams((p) => ({ ...p, [s.key]: v[0] ?? p[s.key] }))}
                  aria-label={s.label}
                />
              </div>
            ))}
            {!dims && pattern !== 'barva' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium" htmlFor="viz-quadw">
                  Realna širina območja (cm)
                </Label>
                <Input
                  id="viz-quadw"
                  type="number"
                  min={30}
                  max={5000}
                  value={params.quadWidthCm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setParams((p) => ({ ...p, quadWidthCm: Math.max(30, Math.min(5000, v)) }));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">Določa gostoto vzorca (razmak v cm).</p>
              </div>
            )}
          </div>
        )}

        {/* Območje */}
        <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Območje prenove
            </Label>
            <button
              onClick={() => setShowHandles((v) => !v)}
              className="text-xs text-primary hover:underline"
              aria-pressed={showHandles}
            >
              {showHandles ? 'Skrij vogališča' : 'Pokaži vogališča'}
            </button>
          </div>
          {surfaceOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {surfaceOptions.slice(0, 3).map((s, i) => (
                <Button key={i} size="sm" variant="outline" className="min-h-9 text-xs" onClick={() => applySurface(s)}>
                  <Crosshair className="mr-1 h-3.5 w-3.5" />
                  Ravnina: {s.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Vleci 4 vogališča na rob objekta na fotografiji.
            </p>
          )}
          <Button size="sm" variant="ghost" className="min-h-9 text-xs" onClick={resetQuad}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Ponastavi območje
          </Button>
        </div>

        {/* Opomba */}
        <div className="flex items-start gap-2 rounded-lg bg-secondary/50 p-3 text-[11px] text-muted-foreground">
          <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            Skriptni predogled (brez AI) — perspektiva, sence in gostota vzorca so izračunani
            iz fotografije. Namenjen dogovoru s stranko; odmerka ne nadomešča.
          </p>
        </div>
      </div>
    </div>
  );
}
