'use client';

// ─── Vizualizer: menjava ograj, vzorcev in barv na fotografiji ──
// Deterministični skriptni predogled za stranko (0 AI):
//  • VEČ OBMOČIJ (plasti) na isti fotki — vsako svoj vzorec/barvo
//  • katalog vzorcev (palice, panel, lamele, pikete, mreža, steklo,
//    WPC deke, ploščice) + palete (RAL, WPC, keramika, fasada)
//  • parametri v cm (razmak, debelina, fuga, prosojnost)
//  • prelakiranje obstoječega objekta (barva × svetlost fotke)
//  • pred/po drsnik, prenos PNG, shranjevanje v galerijo
//  • PREDSTAVNI LIST opcij — 2×N mreža variant za izbiro stranke

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Palette, Upload, Download, Save, Crosshair, RefreshCw, Move,
  Fence, Grid3x3, Grid2x2, Columns3, Rows3, PanelTop, Rows2, Square, PaintBucket, Blinds, Grip,
  Layers, Plus, X, CopyPlus, FileImage, Trash2, Ruler, Pipette, Calculator,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { processImage } from '@/lib/image-quality';
import type { CraftCategory, DetectedSurface } from '@/lib/camera-types';
import type { CraftInputs } from '@/lib/types';
import {
  DEFAULT_VIZ_PARAMS, VIZ_COLORS, VIZ_GROUP_LABELS, VIZ_STYLES,
  buildOptionsSheet, colorGroupsForPattern, craftInputsFromQuad, defaultColorForPattern, defaultPatternForCraft,
  defaultQuadForLayer, drawLayersOnQuad, estimateQuadDimsCm, isLightColor, makeLayer,
  quadDimsFromWidthCm, recolorQuadPixels, resolveLayerColor, slidersForPattern,
  type QuadDimsCm, type SheetVariant, type VizLayer, type VizPattern, type VizParams,
} from '@/lib/viz';

interface VizPanelProps {
  /** Aktualna fotografija (iz analize) ali null → lastno nalaganje. */
  dataUrl: string | null;
  craft: CraftCategory;
  surfaces: DetectedSurface[];
  /** Referenčni objekt za oceno dimenzij (box v % + assumedCm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Predlog iz števca palic (meritev z fotke) — enoklikovna uporaba. */
  barSuggest?: { spacingCm: number; elementCm: number; count: number; confidence: 'visoka' | 'srednja' | 'nizka' } | null;
  /** "Pošlji v kalkulator" — prefill iz ocenjenih dimenzij območja. */
  onQuote?: (craft: CraftCategory, inputs: Partial<CraftInputs>) => void;
  onSaved?: () => void;
}

type Quad = [number, number][];

const MAX_LAYERS = 4;
const MAX_VARIANTS = 4;

const PATTERN_ICONS: Record<VizPattern, React.ReactNode> = {
  vertikalne: <Fence className="h-4 w-4" />,
  panel: <PanelTop className="h-4 w-4" />,
  horizontalne: <Rows3 className="h-4 w-4" />,
  lamele45: <Blinds className="h-4 w-4" />,
  vozlik: <Grip className="h-4 w-4" />,
  piketna: <Columns3 className="h-4 w-4" />,
  mreza: <Grid3x3 className="h-4 w-4" />,
  steklo: <Square className="h-4 w-4" />,
  terasa: <Rows2 className="h-4 w-4" />,
  ploscice: <Grid2x2 className="h-4 w-4" />,
  barva: <PaintBucket className="h-4 w-4" />,
};

/** Barva iz fotke (eyedropper): max 3 shranjene, najstarejša pade ven. */
interface CustomColor { id: string; hex: string }
const MAX_CUSTOM = 3;

export function VizPanel({ dataUrl, craft, surfaces, reference, barSuggest, onQuote, onSaved }: VizPanelProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLCanvasElement | null>(null);
  const pristineRef = useRef<HTMLCanvasElement | null>(null); // izvorna fotka (za eyedropper)
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploaded, setUploaded] = useState<{ dataUrl: string } | null>(null);
  const src = dataUrl ?? uploaded?.dataUrl ?? null;

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<VizLayer[]>(() => [makeLayer('l1', 0, craft)]);
  const [activeId, setActiveId] = useState('l1');
  const [dragging, setDragging] = useState<number | null>(null);
  const [showHandles, setShowHandles] = useState(true);
  const [beforeAfter, setBeforeAfter] = useState(60);
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<SheetVariant[]>([]);
  const [pickMode, setPickMode] = useState(false);
  const [customColors, setCustomColors] = useState<CustomColor[]>([]);

  const activeIdx = Math.max(0, layers.findIndex((l) => l.id === activeId));
  const active = layers[activeIdx] ?? layers[0];

  const updateLayer = useCallback((patch: Partial<VizLayer>) => {
    setLayers((ls) => ls.map((l) => (l.id === activeId ? { ...l, ...patch } : l)));
  }, [activeId]);

  // Sprememba vzorca → če barva aktivne plasti ni več veljavna, zamenjaj
  // (custom barva iz fotke je vedno veljavna — ni vezana na palete)
  useEffect(() => {
    if (active.customHex) return;
    const groups = colorGroupsForPattern(active.pattern);
    const cur = VIZ_COLORS.find((c) => c.id === active.colorId);
    if (!cur || !groups.includes(cur.group)) {
      updateLayer({ colorId: defaultColorForPattern(active.pattern).id });
    }
  }, [active.pattern, active.colorId, active.customHex, updateLayer]);

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
    return estimateQuadDimsCm(active.quad, imgEl.naturalWidth, imgEl.naturalHeight, reference);
  }, [imgEl, reference, active.quad]);

  // Brez reference: uporabnikova ročna širina + razmerje strani fotke
  const quoteDims = useMemo<QuadDimsCm | null>(() => {
    if (!imgEl) return null;
    if (dims) return dims;
    return quadDimsFromWidthCm(active.quad, imgEl.naturalWidth, imgEl.naturalHeight, active.params.quadWidthCm);
  }, [imgEl, dims, active.quad, active.params.quadWidthCm]);

  const quoteInputs = useMemo<Partial<CraftInputs> | null>(() => {
    if (!quoteDims || craft === 'drugo') return null;
    const inp = craftInputsFromQuad(craft, quoteDims);
    return Object.keys(inp).length > 0 ? inp : null;
  }, [quoteDims, craft]);

  // Plasti za upodobitev: aktivna plast dobi kalibrirano širino iz reference
  const renderLayers = useMemo<VizLayer[]>(() => {
    if (!dims) return layers;
    const avgW = (dims.topW + dims.botW) / 2;
    if (avgW <= 30) return layers;
    return layers.map((l) =>
      l.id === activeId ? { ...l, params: { ...l.params, quadWidthCm: Math.round(avgW) } } : l,
    );
  }, [layers, activeId, dims]);

  // ── Upodobitev: fotka → vse plasti → pred/po ─────────────
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
    // Čista izvorna fotka (pred plastmi) — vzorčenje barve iz fotke
    const pristine = document.createElement('canvas');
    pristine.width = w;
    pristine.height = h;
    pristine.getContext('2d')!.drawImage(imgEl, 0, 0, w, h);
    pristineRef.current = pristine;
    try {
      drawLayersOnQuad(octx, imgEl, renderLayers, craft);
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
  }, [imgEl, renderLayers, beforeAfter, craft]);

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
    setLayers((ls) => ls.map((l, i) =>
      i === activeIdx
        ? { ...l, quad: l.quad.map((pt, j) => (j === dragging ? p : pt)) as Quad }
        : l,
    ));
  };

  // ── Barva iz fotke (eyedropper): 7×7 patch na izvirni fotki ──
  const pickColorAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pristine = pristineRef.current;
    if (!pristine || !imgEl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const px = Math.max(0, Math.min(pristine.width - 1, Math.round(((e.clientX - rect.left) / rect.width) * pristine.width)));
    const py = Math.max(0, Math.min(pristine.height - 1, Math.round(((e.clientY - rect.top) / rect.height) * pristine.height)));
    const ctx = pristine.getContext('2d');
    if (!ctx) return;
    const R = 3; // radij patcha (7×7) — povprečje namesto posameznega piksla (šum)
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = py - R; y <= py + R; y++) {
      for (let x = px - R; x <= px + R; x++) {
        if (x < 0 || y < 0 || x >= pristine.width || y >= pristine.height) continue;
        const d = ctx.getImageData(x, y, 1, 1).data;
        r += d[0]; g += d[1]; b += d[2]; n++;
      }
    }
    if (n === 0) return;
    const hex = `#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const id = `fotka-${Date.now()}`;
    setCustomColors((cs) => [...cs.slice(-(MAX_CUSTOM - 1)), { id, hex }]);
    updateLayer({ colorId: id, customHex: hex });
    setPickMode(false);
    toast({ title: `Barva iz fotke: ${hex} ✓`, description: 'Uporabljena na aktivnem območju — deluje v vseh vzorcih.' });
  };

  const applySurface = (s: DetectedSurface) => {
    if (!s.quad || s.quad.length !== 4) return;
    updateLayer({ quad: s.quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) as Quad });
    toast({ title: 'Ravnina iz analize uporabljena ✓', description: s.label });
  };

  const resetQuad = () => updateLayer({ quad: defaultQuadForLayer(activeIdx) });

  const addLayer = () => {
    if (layers.length >= MAX_LAYERS) return;
    const idx = layers.length;
    const l = makeLayer(`l${idx + 1}-${Date.now()}`, idx, craft);
    setLayers((ls) => [...ls, l]);
    setActiveId(l.id);
    toast({ title: 'Območje dodano ✓', description: `${l.label} — vleci vogališča na svoje mesto.` });
  };

  const removeLayer = (id: string) => {
    if (layers.length <= 1) return;
    const next = layers.filter((l) => l.id !== id);
    setLayers(next);
    if (activeId === id) setActiveId(next[next.length - 1].id);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const processed = await processImage(file);
      setUploaded({ dataUrl: processed.dataUrl });
      const fresh = [makeLayer('l1', 0, craft)];
      setLayers(fresh);
      setActiveId(fresh[0].id);
      setVariants([]);
    } catch {
      toast({ title: 'Slike ni bilo mogoče prebrati.', variant: 'destructive' });
    }
  };

  const downloadPng = () => {
    const off = afterRef.current;
    if (!off) return;
    const a = document.createElement('a');
    a.href = off.toDataURL('image/png');
    a.download = `vizualizacija-${active.pattern}-${Date.now()}.png`;
    a.click();
    toast({ title: 'Slika prenesena ✓', description: 'Vizualizacijo lahko pošlješ stranki.' });
  };

  // ── Predstavni list opcij ────────────────────────────────
  const addVariant = () => {
    const exists = variants.some((v) => v.pattern === active.pattern && v.colorId === active.colorId && v.customHex === active.customHex);
    if (exists) {
      toast({ title: 'Ta kombinacija je že med opcijami', variant: 'destructive' });
      return;
    }
    if (variants.length >= MAX_VARIANTS) {
      toast({ title: `Največ ${MAX_VARIANTS} opcij`, description: 'Zbriši eno in poskusi znova.' });
      return;
    }
    setVariants((vs) => [...vs, { pattern: active.pattern, colorId: active.colorId, customHex: active.customHex }]);
    toast({ title: 'Opcija shranjena ✓', description: 'Dodaj še druge in zgradi predstavni list.' });
  };

  const downloadSheet = () => {
    if (!imgEl || variants.length === 0) return;
    const sheet = buildOptionsSheet(
      imgEl,
      renderLayers,
      activeId,
      variants,
      craft,
      {
        title: 'Izberite slog — opcije za vas',
        subtitle: `${VIZ_STYLES.find((s) => s.id === active.pattern)?.label ?? ''} · predlog v vašem prostoru`,
        footer: 'Skriptni predogled (brez AI) — barve so orientacijske; odmerek potrdimo na terenu.',
      },
    );
    if (!sheet) return;
    const a = document.createElement('a');
    a.href = sheet.toDataURL('image/png');
    a.download = `opcije-${craft}-${Date.now()}.png`;
    a.click();
    toast({ title: 'Predstavni list prenesen ✓', description: `${variants.length} opcij — pripravljeno za stranko.` });
  };

  const saveSheetToGallery = async () => {
    if (!imgEl || variants.length === 0) return;
    const sheet = buildOptionsSheet(
      imgEl,
      renderLayers,
      activeId,
      variants,
      craft,
      {
        title: 'Izberite slog — opcije za vas',
        subtitle: `${VIZ_STYLES.find((s) => s.id === active.pattern)?.label ?? ''} · predlog v vašem prostoru`,
        footer: 'Skriptni predogled (brez AI) — barve so orientacijske; odmerek potrdimo na terenu.',
      },
    );
    if (!sheet) return;
    setSaving(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Predstavni list — ${variants.length} opcij (${craft})`,
          craftId: craft,
          dataUrl: sheet.toDataURL('image/jpeg', 0.85),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Predstavni list shranjen ✓', description: 'V galeriji — zavihek Galerija.' });
      onSaved?.();
    } catch {
      toast({ title: 'Shranjevanje ni uspelo', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveToGallery = async () => {
    const off = afterRef.current;
    if (!off) return;
    setSaving(true);
    try {
      const styleLabel = VIZ_STYLES.find((s) => s.id === active.pattern)?.label ?? active.pattern;
      const colorLabel = VIZ_COLORS.find((c) => c.id === active.colorId)?.label ?? '';
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Vizualizacija — ${styleLabel} · ${colorLabel}`,
          craftId: craft,
          dataUrl: off.toDataURL('image/jpeg', 0.85),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Shranjeno v galerijo ✓', description: `${styleLabel} · ${colorLabel}` });
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
            Skripta na fotki prikaže nov vzorec in barvo še pred montažo — tudi več območij hkrati.
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

  const groups = colorGroupsForPattern(active.pattern);
  const colors = VIZ_COLORS.filter((c) => groups.includes(c.group));
  const sliders = slidersForPattern(active.pattern);
  const surfaceOptions = surfaces.filter((s) => s.quad && s.quad.length === 4);
  const styleInfo = VIZ_STYLES.find((s) => s.id === active.pattern)!;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* ── Platno z predogledom ──────────────────────────── */}
      <div className="lg:col-span-3">
        <div
          ref={stageRef}
          className={`relative select-none overflow-hidden rounded-xl border bg-secondary ${pickMode ? 'cursor-crosshair' : ''}`}
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
            onClick={pickMode ? pickColorAt : undefined}
          />
          {/* Ogrodje aktivnega štirikotnika (viewBox 0–100 → % koordinati) */}
          {showHandles && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {layers.map((l, i) => (
                <polygon
                  key={l.id}
                  points={l.quad.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={i === activeIdx ? 'rgba(56,62,66,0.06)' : 'transparent'}
                  stroke={i === activeIdx ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={i === activeIdx ? '1.5' : '1'}
                  strokeDasharray={i === activeIdx ? '1.4 1.1' : '0.8 0.9'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
          {/* Vogališča (samo aktivna plast) */}
          {showHandles &&
            active.quad.map(([x, y], i) => (
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
          {pickMode && (
            <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow" role="status" data-testid="viz-pick-hint">
              <Pipette className="mr-1 inline h-3 w-3" />
              Klikni na fotko — vzorčim barvo
            </span>
          )}
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

        {/* Odmerek za območje — referenca ali ročna širina (razmerje strani) */}
        {!dims && quoteDims && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            <span>
              Ocena območja (po vpeti širini {active.params.quadWidthCm} cm): širina ≈{' '}
              <strong className="text-foreground">{((quoteDims.topW + quoteDims.botW) / 200).toFixed(2)} m</strong>{' '}
              · višina ≈ <strong className="text-foreground">{((quoteDims.leftH + quoteDims.rightH) / 200).toFixed(2)} m</strong>
            </span>
          </div>
        )}
        {quoteInputs && (
          <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="viz-quote">
            <p className="text-xs text-muted-foreground">
              Stranka vidi predlog na svoji fotki — ti takoj dobiš odmerek za to območje.
            </p>
            <Button
              size="sm"
              className="min-h-10"
              onClick={() => onQuote?.(craft, quoteInputs)}
              data-testid="viz-quote-go"
            >
              <Calculator className="mr-1.5 h-4 w-4" />
              Pošlji v kalkulator
            </Button>
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
        {/* Plasti / območja */}
        <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Območja ({layers.length})
            </Label>
            <button
              onClick={() => setShowHandles((v) => !v)}
              className="text-xs text-primary hover:underline"
              aria-pressed={showHandles}
            >
              {showHandles ? 'Skrij vogališča' : 'Pokaži vogališča'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="viz-layer-chips">
            {layers.map((l, i) => {
              const c = resolveLayerColor(l);
              return (
                <span key={l.id} className="relative">
                  <button
                    onClick={() => setActiveId(l.id)}
                    aria-pressed={activeId === l.id}
                    className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${activeId === l.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
                    data-testid={`viz-layer-${i}`}
                  >
                    <span className="h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: c.hex }} />
                    {l.label}
                  </button>
                  {layers.length > 1 && activeId === l.id && (
                    <button
                      onClick={() => removeLayer(l.id)}
                      className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive"
                      aria-label={`Zbriši ${l.label}`}
                      data-testid={`viz-layer-del-${i}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
            {layers.length < MAX_LAYERS && (
              <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={addLayer} data-testid="viz-layer-add">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Območje
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Vleci 4 vogališča na rob objekta (npr. čelna ograja, vrata, stranski del) — vsako območje dobi svoj vzorec in barvo.
          </p>
          {surfaceOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {surfaceOptions.slice(0, 3).map((s, i) => (
                <Button key={i} size="sm" variant="outline" className="min-h-8 text-[11px]" onClick={() => applySurface(s)}>
                  <Crosshair className="mr-1 h-3 w-3" />
                  Ravnina: {s.label}
                </Button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="min-h-8 text-[11px]" onClick={resetQuad}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Ponastavi območje
            </Button>
          </div>
        </div>

        {/* Predlog iz števca palic (meritve) */}
        {barSuggest && barSuggest.count >= 2 && (
          <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-2.5" data-testid="viz-bar-suggest">
            <p className="text-[11px] font-semibold text-green-700">
              Izmerjeno s fotke: {barSuggest.count} palic · razmak {barSuggest.spacingCm} cm · debelina {barSuggest.elementCm} cm
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5 min-h-8 text-[11px]"
              onClick={() => {
                const patch: Partial<VizLayer> = { params: { ...active.params, spacingCm: barSuggest.spacingCm, elementCm: barSuggest.elementCm } };
                const hasSpacing = slidersForPattern(active.pattern).some((s) => s.key === 'spacingCm');
                if (!hasSpacing) patch.pattern = 'vertikalne';
                updateLayer(patch);
              }}
              data-testid="viz-use-bar-suggest"
            >
              <Ruler className="mr-1 h-3 w-3" />
              Uporabi izmerjene vrednosti
            </Button>
          </div>
        )}

        {/* Vzorci */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vzorec / slog — {active.label}
          </Label>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2" data-testid="viz-styles">
            {VIZ_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => updateLayer({ pattern: s.id })}
                title={s.hint}
                aria-pressed={active.pattern === s.id}
                className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors ${active.pattern === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
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
            <Badge variant="secondary" className="text-[10px]">
              {resolveLayerColor(active).label}{active.customHex ? ` · ${active.customHex}` : ''}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="viz-colors">
            {colors.map((c) => (
              <button
                key={c.id}
                onClick={() => updateLayer({ colorId: c.id, customHex: undefined })}
                title={c.label}
                aria-label={c.label}
                aria-pressed={active.colorId === c.id && !active.customHex}
                className={`h-9 w-9 rounded-lg border-2 transition-transform hover:scale-105 ${active.colorId === c.id && !active.customHex ? 'border-primary ring-2 ring-primary/30' : 'border-border'} ${isLightColor(c.hex) ? 'shadow-inner' : ''}`}
                style={{ backgroundColor: c.hex }}
                data-testid={`viz-color-${c.id}`}
              />
            ))}
            {customColors.length > 0 && (
              <span className="mx-1 h-9 w-px self-center bg-border" aria-hidden="true" />
            )}
            {customColors.map((c, i) => (
              <button
                key={c.id}
                onClick={() => updateLayer({ colorId: c.id, customHex: c.hex })}
                title={`Iz fotke · ${c.hex}`}
                aria-label={`Barva iz fotke ${c.hex}`}
                aria-pressed={active.customHex === c.hex}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-transform hover:scale-105 ${active.customHex === c.hex ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                style={{ backgroundColor: c.hex }}
                data-testid={`viz-custom-color-${i}`}
              />
            ))}
            <button
              onClick={() => setPickMode((p) => !p)}
              title="Vzorči barvo iz fotke — klikni na objekt, ki naj ostane isti (npr. fasado)"
              aria-pressed={pickMode}
              aria-label="Vzorči barvo iz fotografije"
              className={`flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border-2 px-2 text-[10px] font-medium transition-colors ${pickMode ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
              data-testid="viz-pick-color"
            >
              <Pipette className="h-3.5 w-3.5" />
              Iz fotke
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {groups.map((g) => VIZ_GROUP_LABELS[g]).join(' · ')} · „Iz fotke“ = vzorči dejansko barvo z objekta
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
                    {active.params[s.key]}{s.key === 'glassAlpha' ? '' : ' cm'}
                  </span>
                </div>
                <Slider
                  value={[active.params[s.key]]}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  onValueChange={(v) => updateLayer({ params: { ...active.params, [s.key]: v[0] ?? active.params[s.key] } })}
                  aria-label={s.label}
                />
              </div>
            ))}
            {!dims && active.pattern !== 'barva' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium" htmlFor="viz-quadw">
                  Realna širina območja (cm)
                </Label>
                <Input
                  id="viz-quadw"
                  type="number"
                  min={30}
                  max={5000}
                  value={active.params.quadWidthCm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) updateLayer({ params: { ...active.params, quadWidthCm: Math.max(30, Math.min(5000, v)) } });
                  }}
                />
                <p className="text-[11px] text-muted-foreground">Določa gostoto vzorca (razmak v cm).</p>
              </div>
            )}
          </div>
        )}

        {/* Predstavni list opcij */}
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FileImage className="h-3.5 w-3.5" />
              Predstavni list opcij
            </Label>
            <Badge variant="secondary" className="text-[10px]">{variants.length}/{MAX_VARIANTS}</Badge>
          </div>
          {variants.length > 0 && (
            <div className="space-y-1.5" data-testid="viz-variants">
              {variants.map((v, i) => {
                const c = v.customHex
                  ? { hex: v.customHex, label: 'Iz fotke' }
                  : VIZ_COLORS.find((cc) => cc.id === v.colorId);
                const st = VIZ_STYLES.find((s) => s.id === v.pattern);
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
                    <span className="h-4 w-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: c?.hex }} />
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{i + 1}. {st?.label}</strong> · {c?.label}
                    </span>
                    <button
                      onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Zbriši opcijo ${i + 1}`}
                      data-testid={`viz-variant-del-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={addVariant} data-testid="viz-variant-add">
              <CopyPlus className="mr-1 h-3.5 w-3.5" />
              Shrani kombinacijo
            </Button>
            {variants.length > 0 && (
              <>
                <Button size="sm" className="min-h-9 text-xs" onClick={downloadSheet} data-testid="viz-sheet-download">
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Prenesi list (PNG)
                </Button>
                <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={() => void saveSheetToGallery()} disabled={saving} data-testid="viz-sheet-save">
                  <Save className="mr-1 h-3.5 w-3.5" />
                  V galerijo
                </Button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Shrani 2–4 kombinacije vzorca/barve → ena slika z vsemi opcijami. Stranka izbere, ti naročiš.
          </p>
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
