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
  Layers, Plus, X, CopyPlus, FileImage, Trash2, Ruler, Pipette, Calculator, Wallpaper,
  Magnet, ChevronsLeftRight, Wand2, ClipboardList,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { processImage } from '@/lib/image-quality';
import type { CraftCategory, DetectedSurface } from '@/lib/camera-types';
import type { CraftInputs } from '@/lib/types';
import { drawQuadDimensions } from '@/lib/annotate';
import { orderQuad } from '@/lib/homography';
import { buildEdgeMap, snapPoint, type EdgeMap } from '@/lib/edge-detect';
import {
  VIZ_TEXTURES, getTextureById, preloadVizTextures, texturesForPattern,
} from '@/lib/viz-textures';
import {
  DEFAULT_VIZ_PARAMS, VIZ_COLORS, VIZ_GROUP_LABELS, VIZ_STYLES,
  buildOptionsSheet, colorGroupsForPattern, craftInputsFromQuad, defaultColorForPattern, defaultPatternForCraft,
  defaultQuadForLayer, defaultParamsForPattern, defaultTextureForPattern, dominantColorInQuad, drawLayersOnQuad, estimateQuadDimsCm, isLightColor, makeLayer,
  quadDimsFromWidthCm, resolveLayerColor, slidersForPattern,
  type QuadDimsCm, type SheetVariant, type VizLayer, type VizPattern, type VizParams,
} from '@/lib/viz';
import {
  buildVizProposal, printProposalCanvas,
  type ProposalLayerSpec, type ProposalMeasureRow, type ProposalEstimate, type ProposalCompany,
} from '@/lib/viz-proposal';
import { detectPatternInQuad, type PatternSuggestion } from '@/lib/pattern-detect';
import { runCalculator } from '@/lib/pricing';
import { CRAFT_INPUT_DEFAULTS } from '@/lib/defaults';
import { CRAFT_LABELS } from '@/lib/camera-types';
import type { CraftId } from '@/lib/types';

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
  /** Povzetek meritev s fotke (za predlog za stranko) — iz kamere. */
  measuresSummary?: ProposalMeasureRow[];
  /** Podatki obrtnika (iz Nastavitev) — dokument nosi NJEGOVO znamko. */
  company?: ProposalCompany | null;
  /** ID izvorne fotke v galeriji — vanjo se shrani viz-stanje (za projektni predlog). */
  photoId?: string | null;
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

export function VizPanel({ dataUrl, craft, surfaces, reference, barSuggest, onQuote, onSaved, measuresSummary = [], company = null, photoId = null }: VizPanelProps) {
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
  /** Izbira barve z fotke: 'color' = nova barva · 'target' = cilj pametnega lakiranja. */
  const [pickMode, setPickMode] = useState<false | 'color' | 'target'>(false);
  const [customColors, setCustomColors] = useState<CustomColor[]>([]);
  /** Mere (razsežnostne črte) direktno na sliki — Hover measurement PDF slog. */
  const [showDims, setShowDims] = useState(true);
  /** Tick po prednalaganju tekstur (sproži ponovno upodobitev). */
  const [texTick, setTexTick] = useState(0);
  /** MAGNET: vogališče se pri spustu pripne na najmočnejši rob (Sobel karta). */
  const [edge, setEdge] = useState<EdgeMap | null>(null);
  const [magnet, setMagnet] = useState(true);
  /** Vlečenje pred/po lovilca direktno na platnu. */
  const [dividerDrag, setDividerDrag] = useState(false);
  /** Zaznani obstoječi vzorec v aktivnem območju (skripta, 0 AI). */
  const [patSug, setPatSug] = useState<PatternSuggestion | null>(null);
  /** Dominantna (obstoječa) barva materiala v aktivnem območju. */
  const [existingHex, setExistingHex] = useState<string | null>(null);

  const activeIdx = Math.max(0, layers.findIndex((l) => l.id === activeId));
  const active = layers[activeIdx] ?? layers[0];

  const updateLayer = useCallback((patch: Partial<VizLayer>) => {
    setLayers((ls) => ls.map((l) => (l.id === activeId ? { ...l, ...patch } : l)));
  }, [activeId]);

  // Sprememba vzorca → če barva aktivne plasti ni več veljavna, zamenjaj
  // (custom barva iz fotke je vedno veljavna — ni vezana na palete).
  // Ob zamenjavi barve se samodejno nastavi tudi materialna tekstura
  // (WPC/les/keramika/fasada — RAL ostane gladka barvana kovina).
  useEffect(() => {
    if (active.customHex) return;
    const groups = colorGroupsForPattern(active.pattern, craft);
    const cur = VIZ_COLORS.find((c) => c.id === active.colorId);
    if (!cur || !groups.includes(cur.group)) {
      const colorId = defaultColorForPattern(active.pattern).id;
      updateLayer({ colorId, textureId: defaultTextureForPattern(active.pattern, colorId, craft) });
    }
  }, [active.pattern, active.colorId, active.customHex, craft, updateLayer]);

  // Tekstura velja samo za vzorce z opačnimi površinami
  useEffect(() => {
    if (active.textureId && texturesForPattern(active.pattern).length === 0) {
      updateLayer({ textureId: undefined });
    }
  }, [active.pattern, active.textureId, updateLayer]);

  // Karta robov za magnet (enkrat na fotografijo) — isto kot foto platno
  useEffect(() => {
    if (!src) { setEdge(null); return; }
    let alive = true;
    buildEdgeMap(src).then((m) => {
      if (alive) setEdge(m);
    });
    return () => { alive = false; };
  }, [src]);

  // Prednalaganje teksturnih tile-ov (6 slik ≈ 380 KB skupaj)
  useEffect(() => {
    let alive = true;
    void preloadVizTextures(VIZ_TEXTURES.map((t) => t.id)).then(() => {
      if (alive) setTexTick((v) => v + 1);
    });
    return () => { alive = false; };
  }, []);

  // ── Zaznavanje obstoječega vzorca + barve (skripta, debounce med vlečenjem) ──
  useEffect(() => {
    if (!imgEl) { setPatSug(null); setExistingHex(null); return; }
    const t = setTimeout(() => {
      try {
        const pristine = pristineRef.current;
        let data: ImageData | null = null;
        if (pristine) data = pristine.getContext('2d')?.getImageData(0, 0, pristine.width, pristine.height) ?? null;
        if (!data) {
          const c = document.createElement('canvas');
          c.width = imgEl.naturalWidth;
          c.height = imgEl.naturalHeight;
          c.getContext('2d')!.drawImage(imgEl, 0, 0);
          data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        }
        setPatSug(detectPatternInQuad({ width: data.width, height: data.height, data: data.data as unknown as Uint8ClampedArray }, active.quad.map(([x, y]) => ({ x, y }))));
        const dom = dominantColorInQuad(imgEl, active.quad);
        setExistingHex(dom);
      } catch {
        /* detekcija ne sme ustaviti UI */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [imgEl, active.quad, activeId, texTick]);

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

  // ── Upodobitev: fotka → vse plasti → mere → pred/po ─────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const maxSide = 1100;
    const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(2, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(2, Math.round(imgEl.naturalHeight * scale));
    canvas.width = w;
    canvas.height = h;

    // Mere (razsežnostne črte) za plasti: aktivna kalibrirana po
    // referenci, ostale po ročni širini območja
    const annotateDims = (target: HTMLCanvasElement) => {
      if (!showDims) return;
      const tctx = target.getContext('2d');
      if (!tctx) return;
      for (const l of renderLayers) {
        const d = l.id === activeId && dims ? dims : quadDimsFromWidthCm(l.quad, target.width, target.height, l.params.quadWidthCm);
        if (!d) continue;
        const q = orderQuad(l.quad.map(([x, y]) => ({ x: (x / 100) * target.width, y: (y / 100) * target.height })));
        try {
          drawQuadDimensions(tctx, q, d);
        } catch {
          /* anotacija ne sme ustaviti upodobitve */
        }
      }
    };

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
    annotateDims(off);
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
    // Mere tudi na živem predogledu (export gre na off canvas)
    annotateDims(canvas);

    // ── Povečevalno steklo pri vlečenju vogališča (preciznost na mobilnem):
    // 3× vstavek NAD vogališčem s prečkico — prst ne zakrije točne lege ──
    if (dragging !== null) {
      const [qx, qy] = active.quad[dragging] ?? active.quad[0];
      const cx = (qx / 100) * w;
      const cy = (qy / 100) * h;
      const R = 46;
      const Z = 3;
      const srcW = (2 * R) / Z;
      // središče lupe nad vogališčem (prst je spodaj); če je vogal pri vrhu → pod
      let lx = cx;
      let ly = cy - R - 20;
      if (ly < R + 6) ly = cy + R + 20;
      lx = Math.max(R + 6, Math.min(w - R - 6, lx));
      ly = Math.max(R + 6, Math.min(h - R - 6, ly));
      ctx.save();
      // priključna črta vogališče → lupe
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      // obroč + povečana vsebina iz ČISTE fotke (robovi objekta ostanejo vidni)
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.save();
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pristine, cx - srcW / 2, cy - srcW / 2, srcW, srcW, lx - R, ly - R, 2 * R, 2 * R);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.98)';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(lx, ly, R + 2, 0, Math.PI * 2);
      ctx.stroke();
      // prečkica v središču = točna lega vogališča
      ctx.strokeStyle = 'rgba(255,215,90,0.98)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx - 10, ly);
      ctx.lineTo(lx + 10, ly);
      ctx.moveTo(lx, ly - 10);
      ctx.lineTo(lx, ly + 10);
      ctx.stroke();
      ctx.restore();
    }
  }, [imgEl, renderLayers, beforeAfter, craft, showDims, dims, activeId, texTick, dragging, active]);

  // ── Vlečenje vogalov ─────────────────────────────────────
  const pctFromEvent = (e: React.PointerEvent): [number, number] => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const onStageMove = (e: React.PointerEvent) => {
    // Lovilcec pred/po ima prednost (ločen od vogališč)
    if (dividerDrag) {
      const [x] = pctFromEvent(e);
      setBeforeAfter(Math.max(0, Math.min(100, Math.round(x))));
      return;
    }
    if (dragging === null) return;
    const p = pctFromEvent(e);
    setLayers((ls) => ls.map((l, i) =>
      i === activeIdx
        ? { ...l, quad: l.quad.map((pt, j) => (j === dragging ? p : pt)) as Quad }
        : l,
    ));
  };

  // Spust vogališča: magnet pripne na najmočnejši rob v bližini
  const endDrag = () => {
    if (dragging !== null && magnet && edge) {
      setLayers((ls) => ls.map((l, i) =>
        i === activeIdx
          ? {
              ...l,
              quad: l.quad.map((pt, j) => {
                if (j !== dragging) return pt;
                const s = snapPoint({ x: pt[0], y: pt[1] }, edge).point;
                return [Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10] as [number, number];
              }) as Quad,
            }
          : l,
      ));
    }
    setDragging(null);
  };

  // »Pripni na robove«: vseh 4 vogališč aktivnega območja naenkrat
  const snapCorners = () => {
    if (!edge) {
      toast({ title: 'Karta robov še ni pripravljena', description: 'Poskusi čez trenutek.' });
      return;
    }
    let snapped = 0;
    setLayers((ls) => ls.map((l, i) =>
      i === activeIdx
        ? {
            ...l,
            quad: l.quad.map((pt) => {
              const r = snapPoint({ x: pt[0], y: pt[1] }, edge);
              if (r.snapped) snapped += 1;
              return [Math.round(r.point.x * 10) / 10, Math.round(r.point.y * 10) / 10] as [number, number];
            }) as Quad,
          }
        : l,
    ));
    toast({
      title: snapped > 0 ? `Pripeto ${snapped}/4 vogališč na robove ✓` : 'Robov v bližini ni',
      description: snapped > 0 ? 'Območje sedi na robovih objekta.' : 'Vleči vogališča bližje robu objekta in poskusi znova.',
    });
  };

  const onStagePointerUp = () => {
    if (dividerDrag) setDividerDrag(false);
    else endDrag();
  };

  const onStagePointerLeave = () => {
    setDividerDrag(false);
    endDrag();
  };

  // Tipkovnica na lovilcecu (dostopnost): puščice premikajo primerjavo
  const onDividerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setBeforeAfter((v) => Math.max(0, v - 2));
    else if (e.key === 'ArrowRight') setBeforeAfter((v) => Math.min(100, v + 2));
    else return;
    e.preventDefault();
  };

  // ── Barva iz fotke (eyedropper): 7×7 patch na izvirni fotki ──
  // 'color' = nova barva za vzorec · 'target' = ciljna barva pametnega lakiranja
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
    const mode = pickMode;
    setPickMode(false);
    if (mode === 'target') {
      updateLayer({ smartRecolor: { targetHex: hex, tolerance: active.smartRecolor?.tolerance ?? 45 } });
      toast({ title: `Ciljna barva materiala: ${hex} ✓`, description: 'Lakira se samo material s to barvo — ozadje ostane.' });
      return;
    }
    const id = `fotka-${Date.now()}`;
    setCustomColors((cs) => [...cs.slice(-(MAX_CUSTOM - 1)), { id, hex }]);
    updateLayer({ colorId: id, customHex: hex });
    toast({ title: `Barva iz fotke: ${hex} ✓`, description: 'Uporabljena na aktivnem območju — deluje v vseh vzorcih.' });
  };

  // ── Pametno lakiranje: maska po barvni podobnosti ──
  const enableSmartRecolor = () => {
    if (active.smartRecolor) return;
    // samodejna ciljna barva: dominantna barva znotraj območja (histogram)
    const dom = imgEl ? dominantColorInQuad(imgEl, active.quad) : null;
    updateLayer({ smartRecolor: { targetHex: dom ?? '#808080', tolerance: 45 } });
    toast({
      title: 'Pametno lakiranje vklopljeno ✓',
      description: dom
        ? `Cilj materiala (samodejno): ${dom}. Klikni „Cilj iz fotke“, če želiš drugo barvo.`
        : 'Nastavi ciljno barvo s klikom na fotko.',
    });
  };

  const disableSmartRecolor = () => updateLayer({ smartRecolor: undefined });

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
    const exists = variants.some((v) => v.pattern === active.pattern && v.colorId === active.colorId && v.customHex === active.customHex && v.textureId === active.textureId && v.smartRecolor === active.smartRecolor);
    if (exists) {
      toast({ title: 'Ta kombinacija je že med opcijami', variant: 'destructive' });
      return;
    }
    if (variants.length >= MAX_VARIANTS) {
      toast({ title: `Največ ${MAX_VARIANTS} opcij`, description: 'Zbriši eno in poskusi znova.' });
      return;
    }
    setVariants((vs) => [...vs, { pattern: active.pattern, colorId: active.colorId, customHex: active.customHex, textureId: active.textureId, smartRecolor: active.smartRecolor }]);
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
        showDimensions: showDims,
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
        showDimensions: showDims,
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

  // ── Predlog za stranko (Hover: measure · design · estimate v enem) ──
  // En dokument: pred/po fotki + specifikacija območij + meritve + ocena.
  const buildProposalCanvas = (): HTMLCanvasElement | null => {
    const off = afterRef.current;
    if (!imgEl || !off) return null;
    const fmtM = (cm: number): string => (cm / 100).toLocaleString('sl-SI', { maximumFractionDigits: 1 });
    const layerSpecs: ProposalLayerSpec[] = renderLayers.map((l, i) => {
      const d = l.id === activeId && dims
        ? dims
        : quadDimsFromWidthCm(l.quad, off.width, off.height, l.params.quadWidthCm);
      const dimsLabel = d
        ? `${fmtM((d.topW + d.botW) / 2)} × ${fmtM((d.leftH + d.rightH) / 2)} m`
        : '—';
      const color = resolveLayerColor(l);
      const colorLabel = l.customHex ?? VIZ_COLORS.find((c) => c.id === l.colorId)?.label ?? color.hex;
      const paramsLabel = slidersForPattern(l.pattern)
        .map((s) =>
          s.key === 'glassAlpha'
            ? `${s.label.toLowerCase()} ${l.params[s.key]}`
            : `${s.label.toLowerCase()} ${(l.params[s.key] as number).toLocaleString('sl-SI', { maximumFractionDigits: 1 })} cm`,
        )
        .join(' · ');
      return {
        label: l.label ?? `Območje ${i + 1}`,
        patternLabel: VIZ_STYLES.find((s) => s.id === l.pattern)?.label ?? l.pattern,
        colorLabel,
        paramsLabel: paramsLabel || '—',
        dimsLabel,
        hex: color.hex,
      };
    });
    // Groba ocena: prefill iz dimenzij območja + privzete vrednosti → kalkulator
    let estimate: ProposalEstimate | null = null;
    if (craft !== 'drugo' && quoteDims) {
      try {
        const inp = { ...CRAFT_INPUT_DEFAULTS, ...craftInputsFromQuad(craft as CraftId, quoteDims) } as CraftInputs;
        const res = runCalculator(craft as CraftId, inp, 35);
        const total = res.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
        if (res.lines.length > 0 && total > 0) {
          estimate = {
            lines: res.lines.slice(0, 8).map((l) => ({
              name: l.name,
              qty: `${l.quantity.toLocaleString('sl-SI', { maximumFractionDigits: 2 })} ${l.unit}`,
              total: `${(l.quantity * l.unitPrice).toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
            })),
            totalNoVat: Math.round(total * 100) / 100,
          };
        }
      } catch {
        estimate = null; // ocena ne sme ustaviti dokumenta
      }
    }
    return buildVizProposal(imgEl, off, {
      craftLabel: CRAFT_LABELS[craft],
      layers: layerSpecs,
      existingLabel:
        patSug
          ? `${VIZ_STYLES.find((s) => s.id === patSug.pattern)?.label ?? patSug.pattern}${existingHex ? ` · obstoječa barva ${existingHex}` : ''}`
          : null,
      measures: measuresSummary.length > 0 ? measuresSummary : undefined,
      estimate,
      company,
    });
  };

  const openProposal = () => {
    const doc = buildProposalCanvas();
    if (!doc) {
      toast({ title: 'Predloga ni bilo mogoče zgraditi', variant: 'destructive' });
      return;
    }
    const ok = printProposalCanvas(doc, `Predlog prenove — ${CRAFT_LABELS[craft]}`);
    if (!ok) toast({ title: 'Brskalnik je zavrnil novo okno', description: 'Dovoli pojavna okna ali uporabi Prenesi.' });
  };

  const downloadProposal = () => {
    const doc = buildProposalCanvas();
    if (!doc) return;
    const a = document.createElement('a');
    a.href = doc.toDataURL('image/png');
    a.download = `predlog-${craft}-${Date.now()}.png`;
    a.click();
    toast({ title: 'Predlog prenesen ✓', description: 'En dokument: pred/po · mere · ocena — za stranko.' });
  };

  const saveProposalToGallery = async () => {
    const doc = buildProposalCanvas();
    if (!doc) return;
    setSaving(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Predlog za stranko — ${CRAFT_LABELS[craft]}`,
          craftId: craft,
          dataUrl: doc.toDataURL('image/jpeg', 0.85),
        }),
      });
      if (!res.ok) throw new Error();
      // Viz-stanje tudi k IZVORNI fotki → projektni predlog lahko
      // deterministično ponari "po" stran za vse fotke (0 AI).
      if (photoId) {
        try {
          await fetch(`/api/photos/${photoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vizState: JSON.stringify({
                craft,
                layers: renderLayers,
                dimsCm: quoteDims,
                existingHex: existingHex ?? null,
              }),
            }),
          });
        } catch { /* viz-stanje ni kritično */ }
      }
      toast({ title: 'Predlog shranjen v galerijo ✓', description: 'Pripravljen za pošiljanje stranki.' });
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

  const groups = colorGroupsForPattern(active.pattern, craft);
  const colors = VIZ_COLORS.filter((c) => groups.includes(c.group));
  const sliders = slidersForPattern(active.pattern);
  const surfaceOptions = surfaces.filter((s) => s.quad && s.quad.length === 4);
  const styleInfo = VIZ_STYLES.find((s) => s.id === active.pattern)!;
  const texOptions = texturesForPattern(active.pattern);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
      {/* ── Platno z predogledom ──────────────────────────── */}
      <div className="lg:col-span-3">
        <div
          ref={stageRef}
          className={`relative select-none overflow-hidden rounded-xl border bg-secondary ${pickMode ? 'cursor-crosshair' : ''}`}
          onPointerMove={onStageMove}
          onPointerUp={onStagePointerUp}
          onPointerLeave={onStagePointerLeave}
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
          {/* Vlečni lovilcec pred/po — industrijski standard vizualizerjev
              (CodyHouse image-comparison): palica + ročaj direktno na sliki,
              sinhroniziran z drsnikom pod platnom */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Pred po lovilcec"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={beforeAfter}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDividerDrag(true); }}
            onKeyDown={onDividerKeyDown}
            className={`absolute inset-y-0 z-10 w-7 -translate-x-1/2 cursor-col-resize touch-none `}
            style={{ left: `${beforeAfter}%` }}
            data-testid="viz-divider"
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.6)]" aria-hidden="true" />
            <span
              className={`absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-lg transition-transform ${dividerDrag ? 'scale-110 bg-primary' : 'bg-black/55 hover:scale-105'}`}
              aria-hidden="true"
            >
              <ChevronsLeftRight className="h-4 w-4 text-white" />
            </span>
          </div>
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
              {pickMode === 'target' ? 'Klikni na OBSTOJEČI material — to je cilj, ki ga menjavam' : 'Klikni na fotko — vzorčim barvo'}
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
          <Button size="sm" className="min-h-10" onClick={openProposal} data-testid="viz-proposal">
            <ClipboardList className="mr-1.5 h-4 w-4" />
            Predlog za stranko
          </Button>
          <Button size="sm" variant="outline" className="min-h-10" onClick={downloadProposal} data-testid="viz-proposal-download">
            <Download className="mr-1.5 h-4 w-4" />
            Prenesi predlog
          </Button>
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => void saveProposalToGallery()} disabled={saving} data-testid="viz-proposal-save">
            <Save className="mr-1.5 h-4 w-4" />
            Predlog v galerijo
          </Button>
          <Button size="sm" className="min-h-10" onClick={downloadPng} data-testid="viz-download">
            <Download className="mr-1.5 h-4 w-4" />
            Prenesi PNG
          </Button>
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => void saveToGallery()} disabled={saving} data-testid="viz-save">
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? 'Shranjujem…' : 'Shrani v galerijo'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-10"
            onClick={() => setShowDims((v) => !v)}
            aria-pressed={showDims}
            data-testid="viz-dims-toggle"
          >
            <Ruler className="mr-1.5 h-4 w-4" />
            {showDims ? 'Mere vidne' : 'Mere skrite'}
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" className="min-h-8 text-[11px]" onClick={resetQuad}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Ponastavi območje
            </Button>
            <Button
              size="sm"
              variant={magnet ? 'secondary' : 'ghost'}
              className="min-h-8 text-[11px]"
              onClick={() => setMagnet((v) => !v)}
              aria-pressed={magnet}
              data-testid="viz-magnet"
            >
              <Magnet className="mr-1 h-3 w-3" />
              Magnet {magnet ? 'vklopljen' : 'izklopljen'}
            </Button>
            <Button size="sm" variant="outline" className="min-h-8 text-[11px]" onClick={snapCorners} data-testid="viz-snap-corners">
              <Crosshair className="mr-1 h-3 w-3" />
              Pripni na robove
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Magnet ob spustu vogališča pripne na rob objekta (Sobel robovi) — „Pripni na robove“ poravna vsa štiri hkrati.
          </p>
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

        {/* Kaj je na fotki? — zaznavanje obstoječega vzorca (skripta) */}
        {patSug && (
          <div className="space-y-2 rounded-lg border border-teal-500/40 bg-teal-500/5 p-3" data-testid="viz-detect-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                Na fotki: <strong>{VIZ_STYLES.find((s) => s.id === patSug.pattern)?.label ?? patSug.pattern}</strong>{' '}
                <span className="text-muted-foreground">· {patSug.detail.toLowerCase()} · zanesljivost {patSug.confidence}</span>
              </p>
              {existingHex && (
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="inline-block h-4 w-4 rounded border border-border"
                    style={{ background: existingHex }}
                    aria-hidden="true"
                  />
                  {existingHex}
                </span>
              )}
            </div>
            {(() => {
              if (!patSug.pitchPx || patSug.direction === 'd45' || patSug.direction === 'd135' || !imgEl || !quoteDims) return null;
              const q = active.quad;
              const topPx = Math.hypot((q[1][0] - q[0][0]) / 100 * imgEl.naturalWidth, (q[1][1] - q[0][1]) / 100 * imgEl.naturalHeight);
              const botPx = Math.hypot((q[2][0] - q[3][0]) / 100 * imgEl.naturalWidth, (q[2][1] - q[3][1]) / 100 * imgEl.naturalHeight);
              const cmPerPx = (quoteDims.topW + quoteDims.botW) / Math.max(1, topPx + botPx);
              const pitchCm = patSug.pitchPx * cmPerPx;
              const widthCm = (patSug.barWidthPx ?? 0) * cmPerPx;
              if (pitchCm < 3 || pitchCm > 60) return null;
              return (
                <p className="text-[11px] text-muted-foreground" data-testid="viz-detect-pitch">
                  Izmerjena perioda: razmak ≈ <strong className="text-foreground">{pitchCm.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} cm</strong>
                  {widthCm >= 1 ? ` · debelina ≈ ${widthCm.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} cm` : ''}
                </p>
              );
            })()}
            <Button
              size="sm"
              variant="outline"
              className="min-h-9"
              onClick={() => {
                let params: VizParams = defaultParamsForPattern(patSug.pattern, active.params);
                if (patSug.pitchPx && patSug.direction && patSug.direction !== 'd45' && patSug.direction !== 'd135' && imgEl && quoteDims) {
                  const q = active.quad;
                  const topPx = Math.hypot((q[1][0] - q[0][0]) / 100 * imgEl.naturalWidth, (q[1][1] - q[0][1]) / 100 * imgEl.naturalHeight);
                  const botPx = Math.hypot((q[2][0] - q[3][0]) / 100 * imgEl.naturalWidth, (q[2][1] - q[3][1]) / 100 * imgEl.naturalHeight);
                  const cmPerPx = (quoteDims.topW + quoteDims.botW) / Math.max(1, topPx + botPx);
                  const pitchCm = patSug.pitchPx * cmPerPx;
                  const widthCm = (patSug.barWidthPx ?? 0) * cmPerPx;
                  if (pitchCm >= 3 && pitchCm <= 60) {
                    params = {
                      ...params,
                      spacingCm: Math.max(5, Math.min(20, Math.round((pitchCm - widthCm) * 2) / 2)),
                      elementCm: Math.max(1, Math.min(6, Math.round(widthCm * 10) / 10)),
                    };
                  }
                }
                updateLayer({ pattern: patSug.pattern, params });
                toast({ title: `Vzorec „${VIZ_STYLES.find((s) => s.id === patSug.pattern)?.label ?? patSug.pattern}“ uporabljen ✓`, description: 'Zaznano stanje preneseno v predlog — prilagodi po želji.' });
              }}
              data-testid="viz-detect-apply"
            >
              <Wand2 className="mr-1.5 h-4 w-4" />
              Uporabi zaznano
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
                onClick={() => updateLayer({ pattern: s.id, params: defaultParamsForPattern(s.id, active.params) })}
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

        {/* Tekstura materiala (realni tile-i iz kataloga) */}
        {texOptions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wallpaper className="mr-1 inline h-3.5 w-3.5" />
                Tekstura materiala
              </Label>
              {active.textureId && (
                <Badge variant="secondary" className="text-[10px]" data-testid="viz-tex-active">
                  {getTextureById(active.textureId)?.label}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5" data-testid="viz-textures">
              <button
                onClick={() => updateLayer({ textureId: undefined })}
                title="Brez teksture — čista barva"
                aria-pressed={!active.textureId}
                aria-label="Brez teksture"
                className={`flex h-10 w-10 items-center justify-center rounded-lg border-2 text-muted-foreground transition-transform hover:scale-105 ${!active.textureId ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                data-testid="viz-tex-none"
              >
                <X className="h-4 w-4" />
              </button>
              {texOptions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => updateLayer({ textureId: t.id })}
                  title={t.label}
                  aria-label={`Tekstura ${t.label}`}
                  aria-pressed={active.textureId === t.id}
                  className={`h-10 w-10 rounded-lg border-2 bg-cover bg-center transition-transform hover:scale-105 ${active.textureId === t.id ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                  style={{ backgroundImage: `url(${t.src})` }}
                  data-testid={`viz-tex-${t.id}`}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Realen material se zrcalno tlakuje po opačnih delih vzorca — reže ostanejo, barva pa teksturo poveže z izbiro.
            </p>
          </div>
        )}

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
                onClick={() => updateLayer({
                  colorId: c.id,
                  customHex: undefined,
                  // samodejni material: tekstura sledi izbrani barvi (0 AI)
                  textureId: defaultTextureForPattern(active.pattern, c.id, craft),
                })}
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
                onClick={() => updateLayer({ colorId: c.id, customHex: c.hex, textureId: undefined })}
                title={`Iz fotke · ${c.hex}`}
                aria-label={`Barva iz fotke ${c.hex}`}
                aria-pressed={active.customHex === c.hex}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-transform hover:scale-105 ${active.customHex === c.hex ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                style={{ backgroundColor: c.hex }}
                data-testid={`viz-custom-color-${i}`}
              />
            ))}
            <button
              onClick={() => setPickMode((p) => (p === 'color' ? false : 'color'))}
              title="Vzorči barvo iz fotke — klikni na objekt, ki naj ostane isti (npr. fasado)"
              aria-pressed={pickMode === 'color'}
              aria-label="Vzorči barvo iz fotografije"
              className={`flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border-2 px-2 text-[10px] font-medium transition-colors ${pickMode === 'color' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
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

        {/* Način lakiranja (samo vzorec 'barva'): celotno območje ali pametna selekcija materiala */}
        {active.pattern === 'barva' && (
          <div className="space-y-3 rounded-lg border bg-secondary/30 p-3" data-testid="viz-recolor-card">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Wand2 className="mr-1 inline h-3.5 w-3.5" />
              Način lakiranja
            </Label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={disableSmartRecolor}
                aria-pressed={!active.smartRecolor}
                className={`min-h-11 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${!active.smartRecolor ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
                data-testid="viz-recolor-all"
              >
                <PaintBucket className="mr-1.5 inline h-4 w-4" />
                Celotno območje
              </button>
              <button
                onClick={enableSmartRecolor}
                aria-pressed={!!active.smartRecolor}
                className={`min-h-11 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${active.smartRecolor ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/50'}`}
                data-testid="viz-recolor-smart"
              >
                <Wand2 className="mr-1.5 inline h-4 w-4" />
                Samo material (selekcija)
              </button>
            </div>
            {active.smartRecolor ? (
              <div className="space-y-3" data-testid="viz-smart-controls">
                <div className="flex items-center gap-2">
                  <span
                    className="h-8 w-8 shrink-0 rounded-md border-2 border-border"
                    style={{ backgroundColor: active.smartRecolor.targetHex }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 text-xs">
                    <p className="font-medium">Cilj: barva obstoječega materiala</p>
                    <p className="truncate text-muted-foreground">{active.smartRecolor.targetHex} · lakira se samo material s to barvo</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Toleranca podobnosti</span>
                    <span className="text-muted-foreground">{active.smartRecolor.tolerance}</span>
                  </div>
                  <Slider
                    value={[active.smartRecolor.tolerance]}
                    min={5}
                    max={120}
                    step={1}
                    onValueChange={(v) => updateLayer({ smartRecolor: { ...active.smartRecolor!, tolerance: v[0] ?? 45 } })}
                    aria-label="Toleranca podobnosti barve"
                    data-testid="viz-smart-tolerance"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={pickMode === 'target' ? 'secondary' : 'outline'}
                    className="min-h-9 text-xs"
                    onClick={() => setPickMode((p) => (p === 'target' ? false : 'target'))}
                    aria-pressed={pickMode === 'target'}
                    data-testid="viz-pick-target"
                  >
                    <Pipette className="mr-1.5 h-3.5 w-3.5" />
                    Cilj iz fotke
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-9 text-xs" onClick={enableSmartRecolor}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Samodejna dominantna
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Klikni na obstoječo kovino/les na fotki (ali pusti samodejno) → skripta prelakira SAMO piksle te barve z izbrano novo barvo; ozadje za režami ostane nedotaknjeno. Višja toleranca = širše zajete odtenki.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                „Celotno območje“ pobarva vse znotraj štirikotnika. Za realistično menjavo barve obstoječe ograje (reže ostanejo) izberi „Samo material“.
              </p>
            )}
          </div>
        )}

        {/* Smer obloge (samo horizontalne lamele) — fasadna obloga */}
        {active.pattern === 'horizontalne' && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Smer obloge</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Smer obloge">
              {([
                { v: false, label: 'Vodoravno' },
                { v: true, label: 'Navpično' },
              ] as const).map((o) => (
                <button
                  key={o.label}
                  type="button"
                  data-testid={`viz-obloga-${o.v ? 'vert' : 'horiz'}`}
                  aria-pressed={!!active.params.oblogaVert === o.v}
                  onClick={() => updateLayer({ params: { ...active.params, oblogaVert: o.v } })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                    !!active.params.oblogaVert === o.v
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
                const tx = v.textureId ? getTextureById(v.textureId) : null;
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
                    <span className="h-4 w-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: c?.hex }} />
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{i + 1}. {st?.label}{tx ? ` · ${tx.label}` : ''}{v.smartRecolor ? ' · selekcija' : ''}</strong> · {c?.label}
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
