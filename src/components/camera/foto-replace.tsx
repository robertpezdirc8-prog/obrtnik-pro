'use client';

// ─── Fotomontaža — zamenjava stare ograje BREZ AI (issue #14 FOTOZAMENJAVA) ──
// Voden postopek v 7 korakih nad ENO fotografijo:
//  1. Fotografija          — nalaganje / zajeta fotka (delovna kopija ≤ 1280 px, JPEG 0,82)
//  2. Ravnina stare ograje — 4 oglišča (tl→tr→br→bl) + realni meri v cm → CALIBRATED
//  3. Maska stare ograje   — samodejni predlog + čopič (dodaj/odstrani) + frontalni okluziji
//  4. Klasična obnova      — inpainting (linearna interpolacija, jedro photo-replace-core)
//                            + ročno kloniranje (izvor → žig); "Razveljavi obnovo"
//  5. Nova ograja          — ROKSAL profili z iskrenostjo (profileReadiness), brez gradiva = brez izrisa
//  6. Upodobi              — drawLayersOnQuad (viz.ts) + ambientna svetloba + stične sence + okluzije
//  7. Primerjava/detajl    — pred/po drsnik, 2× lupe, metapodatki, različice, izvoz PNG
//
// 0 AI / 0 generativnih modelov / 0 plačljivih API-jev — samo deterministične skripte.
// ORIGINALNA fotografija je NIKOLI spremenjena: originalCanvas ostane nespremenjen,
// vse izdaje (inpainting, kloniranje) potekajo na delovnem canvasu.
// Determinizem upodobitve: enaki vhodi → enaki piksli (brez Date.now()/Math.random()
// v upodobitveni poti; createdAt za metapodatke je podan od zunaj).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  ChevronDown, ChevronUp, Columns2, Download, Eraser, ImagePlus, Paintbrush, RotateCcw, Ruler, Save, ShoppingCart, Upload, ZoomIn,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { processImage } from '@/lib/image-quality';
import {
  EXPORT_LABEL,
  PHOTO_REPLACE_SCRIPT_VERSION,
  ambientLightFactor,
  autoSuggestFenceMask,
  buildReplaceMetadata,
  canExportResult,
  computePlankLayouts,
  createMask,
  frontPixelsFrom,
  inpaintMask,
  maskCoverage,
  maskToPctPolys,
  paintMaskCircle,
  shadowEdgesFor,
  type ImgData,
  type InpaintStatus,
  type LayoutResult,
  type MaskGrid,
  type QuadPx,
  type ReplaceMetadata,
  type XY,
} from '@/lib/photo-replace-core';
import { ROKSAL_PROFILES, assetById, profileReadiness, type RoksalProfile } from '@/lib/roksal-assets';
import { boardGapStamp } from '@/lib/roksal-span-rules';
import {
  defaultParamsForPattern,
  drawLayersOnQuad,
  type VizLayer,
  type VizPattern,
} from '@/lib/viz';
import { getTextureById, preloadVizTextures } from '@/lib/viz-textures';
import { buildBomFromMeta } from '@/lib/photo-bom';
import { InstallerSheetPanel } from './installer-sheet-panel';
import { plural } from '@/lib/install-plan';
import { calibratePlane, planeDistanceCm } from '@/lib/homography';
import { suggestBandQuadPct, type BandSuggestion } from '@/lib/band-suggest';
import {
  suggestProfiles,
  suggestionText,
  fmtNum,
  type ProfileSuggestResult,
} from '@/lib/photo-profile-suggest';
import {
  buildCompareLabels,
  compareExportFilename,
  computeCompareLayout,
  drawCompareExport,
} from '@/lib/photo-compare';
import { useDraft, useView } from '@/lib/store';
import { statusColor, statusHint, statusLabel, validateGeometry, validateMetric } from '@/lib/measurement-status';
import {
  canExportOrder, canRenderMontage, renderPromiseOf, renderPromiseHint,
  geometryColor, geometryHint, geometryLabel,
  type GeometricAssurance, type MetricAssurance, type RenderPromise,
} from '@/lib/assertion';
import type { CraftCategory } from '@/lib/camera-types';

// ─── Preslikava ROKSAL profil → barva v VIZ_COLORS (viz.ts) ──────
// Izbrana je kataloška barva, katere ton najbolje ustreza teksturi
// profila. VIZ_COLORS nima 'hrast' id-ja, zato lesena profila uporabita
// najbližji svetli WPC ton ('wpc-svetli-les'); RAL profila se upodobita
// FLAT s standardno barvo (RAL je gladka barvana kovina — realno;
// standardna referenca tex-ral-7016-standard ni render tekstura —
// vizTextureIdFor je ne najde v viz-textures → flat izris z barvo spodaj).
// Mapiranje je dokumentirano in deterministično — brez ugibanja med izrisom.
const PROFILE_COLOR_ID: Record<string, string> = {
  'wpc-deka-140': 'wpc-tikovina',       // tex-wpc-tikovina ↔ WPC tikovina
  'wpc-deka-140-antracit': 'wpc-siva',  // tex-wpc-siva ↔ WPC siva
  'alu-palice-18': 'ral-7016',          // RAL 7016 antracit (flat barva)
  'fasadna-obloga-8': 'wpc-svetli-les', // tex-hrast ↔ najbližji svetli lesni ton
  'piketna-18': 'wpc-svetli-les',       // tex-hrast ↔ najbližji svetli lesni ton
  'mreza-3d-125': 'ral-7016',           // RAL 7016 antracit (flat barva)
  // KUBO 80/42 — barva = najbližji VIZ_COLOR po povprečju dekorja
  // (izmerjeno v tests/make-kubo-tiles.ts: dekor-1 RGB(95,94,97),
  // dekor-2 RGB(177,148,125), dekor-3 RGB(154,127,97), dekor-4 RGB(110,99,89))
  'kubo-80-42': 'wpc-svetli-les',          // dekor-2 (svetli zlati) ↔ svetli les #B99B72
  'kubo-80-42-dekor-1': 'wpc-antracit',    // dekor-1 (temno sivi) ↔ antracit #3F4145
  'kubo-80-42-dekor-3': 'wpc-tikovina',    // dekor-3 (zlati teak) ↔ tikovina #8A6A48
  'kubo-80-42-dekor-4': 'wpc-oreh',        // dekor-4 (temno rjavo-sivi) ↔ oreh #5D4433
  // DEKA 150×25 — barva = najbližji VIZ_COLOR po povprečju dekorja
  // (izmerjeno v tests/make-deka-tiles.ts: dekor-1 RGB(97,100,104),
  // dekor-2 RGB(161,163,163), dekor-3 RGB(201,153,128),
  // dekor-4 RGB(177,146,130), dekor-5 RGB(212,172,131),
  // dekor-6 RGB(156,129,98), dekor-7 RGB(110,99,89))
  'roksal-deka-150': 'wpc-antracit',       // dekor-1 (temno sivi) ↔ antracit #3F4145 (d≈60)
  'roksal-deka-150-dekor-2': 'ral-9006',   // dekor-2 (svetlo sivi) ↔ RAL 9006 #A5A8A6 (d≈7 — najbližji)
  'roksal-deka-150-dekor-3': 'wpc-svetli-les', // dekor-3 ↔ svetli les #B99B72 (d≈21)
  'roksal-deka-150-dekor-4': 'wpc-svetli-les', // dekor-4 ↔ svetli les #B99B72 (d≈20)
  'roksal-deka-150-dekor-5': 'wpc-svetli-les', // dekor-5 ↔ svetli les #B99B72 (d≈36)
  'roksal-deka-150-dekor-6': 'wpc-tikovina',   // dekor-6 (srednje rjavi) ↔ tikovina #8A6A48 (d≈39)
  'roksal-deka-150-dekor-7': 'wpc-tikovina',   // dekor-7 (temno rjavi) ↔ tikovina #8A6A48 (d≈34)
  // OGRAJE POLNA/ROMB — barva = najbližji VIZ_COLOR po povprečju dekorja
  // (izmerjeno v tests/make-ograje-tiles.ts; temno sivi dekorji so
  // SEMANTIČNO preslikani v antracit — kot pri KUBO/deka, čeprav je
  // tikovina numerično ~0,3 bližje; svetli dekor-6 POLNA-100 → RAL 7035 d≈2)
  'polna-57-32': 'wpc-antracit',           // dekor 1/4 (temno sivi, kot KUBO dekor-1)
  'polna-57-32-dekor-2': 'wpc-svetli-les', // dekor 2/4 (kot KUBO dekor-2, d≈15)
  'polna-57-32-dekor-3': 'wpc-tikovina',   // dekor 3/4 (kot KUBO dekor-3, d≈36)
  'polna-57-32-dekor-4': 'wpc-oreh',       // dekor 4/4 (kot KUBO dekor-4 — semantično)
  'polna-100': 'wpc-antracit',             // dekor 1/8 (temno sivi, RGB(95,94,97))
  'polna-100-dekor-2': 'wpc-siva',         // dekor 2/8 (svetlo sivi, d≈7)
  'polna-100-dekor-3': 'wpc-svetli-les',   // dekor 3/8 (rožnato-rjavi, d≈38)
  'polna-100-dekor-4': 'wpc-tikovina',     // dekor 4/8 (rjavo-bež, d≈40)
  'polna-100-dekor-5': 'wpc-svetli-les',   // dekor 5/8 (svetli zlati, d≈15)
  'polna-100-dekor-6': 'ral-7035',         // dekor 6/8 (beli, RGB(199,198,197), d≈2)
  'polna-100-dekor-7': 'wpc-tikovina',     // dekor 7/8 (zlati teak, d≈37)
  'polna-100-dekor-8': 'wpc-tikovina',     // dekor 8/8 (temno rjavo-sivi, d≈33 — kot deka dekor-7)
  'polna-128': 'wpc-antracit',             // dekor 1/6 (temno sivi, RGB(95,94,97))
  'polna-128-dekor-2': 'wpc-siva',         // dekor 2/6 (svetlo sivi, d≈6)
  'polna-128-dekor-3': 'wpc-tikovina',     // dekor 3/6 (rjavo-bež, d≈40)
  'polna-128-dekor-4': 'wpc-svetli-les',   // dekor 4/6 (svetli zlati, d≈15)
  'polna-128-dekor-5': 'wpc-tikovina',     // dekor 5/6 (zlati teak, d≈39)
  'polna-128-dekor-6': 'wpc-tikovina',     // dekor 6/6 (temno rjavo-sivi, d≈33)
  'romb-67': 'wpc-antracit',               // dekor 1/7 (temno sivi, RGB(95,94,97))
  'romb-67-dekor-2': 'wpc-siva',           // dekor 2/7 (svetlo sivi, d≈6)
  'romb-67-dekor-3': 'wpc-svetli-les',     // dekor 3/7 (rožnato-rjavi, d≈38)
  'romb-67-dekor-4': 'wpc-tikovina',       // dekor 4/7 (rjavo-bež, d≈40)
  'romb-67-dekor-5': 'wpc-svetli-les',     // dekor 5/7 (svetli zlati, d≈16)
  'romb-67-dekor-6': 'wpc-tikovina',       // dekor 6/7 (zlati teak, d≈39)
  'romb-67-dekor-7': 'wpc-tikovina',       // dekor 7/7 (temno rjavo-sivi, d≈33)
};

/** ROKSAL asset id → id teksture v viz-textures ('tex-wpc-tikovina' → 'wpc-tikovina'). */
function vizTextureIdFor(roksalTextureId: string): string | null {
  const id = roksalTextureId.startsWith('tex-') ? roksalTextureId.slice(4) : roksalTextureId;
  return getTextureById(id) ? id : null;
}

// ─── Različice (v pomnilniku + localStorage, omejitev 10) ────────
interface VersionAux {
  factor: number;
  samples: number;
  topAlpha: number;
  bottomAlpha: number;
  warnings: string[];
  scaleTop: number | null;
  scaleBottom: number | null;
}
interface VersionRec {
  id: string;
  createdAt: string;
  profileLabel: string;
  meta: ReplaceMetadata;
  aux: VersionAux;
  dataUrl: string;
}
const VERSIONS_KEY = 'foto-replace-versions';
const VERSIONS_CAP = 10;

interface FotoReplaceProps {
  /** Trenutni zajem kamere (dataUrl + naravne dimenzije) — null = komponenta pokaže svoj nalagalnik. */
  photo?: { dataUrl: string; w: number; h: number } | null;
  craft: CraftCategory;
}

// ─── Pomožniki (deterministični) ─────────────────────────────────

/** ImageData → ImgData (jedro photo-replace-core je canvas-neodvisno). */
function imgDataFrom(c: HTMLCanvasElement): ImgData {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D kontekst ni na voljo.');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/** Točka znotraj štirikotnika (ray casting, enako kot jedro). */
function pointInQuad(x: number, y: number, q: QuadPx): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let ins = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

/** Delež maske (255) znotraj štirikotnika — pokritost označbe stare ograje. */
function quadMaskCoverage(m: MaskGrid, q: QuadPx): number {
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
  const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(m.w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(m.h - 1, Math.ceil(Math.max(...ys)));
  let inside = 0;
  let painted = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!pointInQuad(x + 0.5, y + 0.5, q)) continue;
      inside++;
      if (m.data[y * m.w + x] === 255) painted++;
    }
  }
  return inside > 0 ? painted / inside : 0;
}

/** Prelom besedila na vrstice za žig v izvozni sliki (determinističen). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const fmtN = (v: number | null, d = 2): string =>
  v === null ? '—' : v.toLocaleString('sl-SI', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Mali predogled upodobitve za mrežo primerjave profilov (determinističen, širina ≤ maxW). */
function thumbDataUrl(c: HTMLCanvasElement, maxW: number): string {
  const k = Math.min(1, maxW / c.width);
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(c.width * k));
  t.height = Math.max(1, Math.round(c.height * k));
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.8);
}

// ─── Komponenta ──────────────────────────────────────────────────

export function FotoReplace({ photo, craft }: FotoReplaceProps) {
  const { toast } = useToast();
  const addDraftItems = useDraft((s) => s.addItems);
  const setMontage = useDraft((s) => s.setMontage);
  const setView = useView((s) => s.setView);
  const setActiveCraft = useView((s) => s.setActiveCraft);

  // ── Stanje: fotografija + canvasi ──
  const ownUpload = useRef<{ dataUrl: string } | null>(null);
  const [uploadTick, setUploadTick] = useState(0);
  const effectiveSrc = ownUpload.current?.dataUrl ?? photo?.dataUrl ?? null;
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null); // NESPREMENJEN original
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);     // delovna kopija (vse izdaje)
  const [workTick, setWorkTick] = useState(0);                      // delovna kopija spremenjena

  // ── Stanje: orodja na prizorišču ──
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'corners' | 'band' | 'brush' | 'clone' | 'measure' | 'none'>('corners');
  const [quadPct, setQuadPct] = useState<[number, number][] | null>(null);
  const [cornerCount, setCornerCount] = useState(0);
  /**
   * FAZA-9: je štirikotnik potrdil človek? `false` samo takrat, ko ga rodil
   * pasovni predlog — jedro takrat geometrijo drži na SUGGESTED in izris
   * ostane zaprt. Ročna oglišča in demo kvadrant ostanejo potrjeni.
   */
  const [planeConfirmed, setPlaneConfirmed] = useState(true);
  const [bandTaps, setBandTaps] = useState<[number, number][] | null>(null);
  const [bandInfo, setBandInfo] = useState<BandSuggestion | null>(null);
  const dragCornerRef = useRef<number | null>(null);
  const paintingRef = useRef(false);
  const lastPaintRef = useRef<XY | null>(null);
  const polyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [wCm, setWCm] = useState('');
  const [hCm, setHCm] = useState('');

  // ── Stanje: maske ──
  const oldMaskRef = useRef<MaskGrid | null>(null);
  const frontMaskRef = useRef<MaskGrid | null>(null);
  const [oldPolys, setOldPolys] = useState<number[][][]>([]);
  const [frontPolys, setFrontPolys] = useState<number[][][]>([]);
  const [frontCov, setFrontCov] = useState(0);
  const [autoInfo, setAutoInfo] = useState<{ confidence: number; note: string } | null>(null);
  const [covTick, setCovTick] = useState(0);
  const [brushTarget, setBrushTarget] = useState<'old' | 'front'>('old');
  const [brushMode, setBrushMode] = useState<'add' | 'remove'>('add');
  const [brushSize, setBrushSize] = useState(16);

  // ── Stanje: kloniranje ──
  const [cloneStage, setCloneStage] = useState<'off' | 'source' | 'stamp'>('off');
  const cloneSrcRef = useRef<XY | null>(null);
  const [cloneSrcUi, setCloneSrcUi] = useState<XY | null>(null);

  // ── Stanje: obnova + profili + rezultat ──
  const [inpaintRes, setInpaintRes] = useState<{
    status: InpaintStatus; coverage: number; repairedPx: number; manualHint: string | null;
  } | null>(null);
  const [busyInpaint, setBusyInpaint] = useState(false);

  // ── Kandidat #3 (Task 66): izmeri obstoječo desko → predlog najbližjega profila ──
  const [measurePts, setMeasurePts] = useState<[number, number][] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [busyRender, setBusyRender] = useState(false);

  // ── Primerjava profilov: ista fotka/ravnina/maska → vse omogočene barve (navdih D2K/VisualFencePro) ──
  interface ComparisonCard {
    profileId: string;
    label: string;
    honestyLabel: string;
    canRender: boolean;
    blockedReason: string | null;
    thumbUrl: string | null; // mali JPEG — celotni canvas ostane v pomnilniku seje
  }
  const [comparisons, setComparisons] = useState<ComparisonCard[] | null>(null);
  const [busyCompare, setBusyCompare] = useState(false);
  const compareCanvasRef = useRef<Map<string, { meta: ReplaceMetadata; aux: VersionAux }>>(new Map());
  const compareCompRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<{
    meta: ReplaceMetadata; aux: VersionAux; dataUrl: string;
  } | null>(null);
  const [comparePct, setComparePct] = useState(100);
  const [metaOpen, setMetaOpen] = useState(false);
  const [exportBlocked, setExportBlocked] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRec[]>([]);
  const [lens, setLens] = useState({ x: 0, y: 0, on: false });

  const origDispRef = useRef<HTMLCanvasElement>(null);
  const resDispRef = useRef<HTMLCanvasElement>(null);

  const dims = imgEl ? { w: imgEl.naturalWidth, h: imgEl.naturalHeight } : null;

  // ── Nalaganje slike (naravne dimenzije so vir resnice; w/h propsa sta informativna) ──
  useEffect(() => {
    if (!effectiveSrc) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = effectiveSrc;
    return () => { alive = false; };
  }, [effectiveSrc, uploadTick]);

  // ── Canvasa (original nespremenjen + delovna kopija) ob novi fotki; stanje se ponastavi ──
  useEffect(() => {
    if (!imgEl) {
      originalCanvasRef.current = null;
      workCanvasRef.current = null;
      setWorkTick((t) => t + 1);
      return;
    }
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    const mk = (): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    const orig = mk();
    const work = mk();
    orig.getContext('2d')!.drawImage(imgEl, 0, 0);
    work.getContext('2d')!.drawImage(orig, 0, 0);
    originalCanvasRef.current = orig;
    workCanvasRef.current = work;
    oldMaskRef.current = null;
    frontMaskRef.current = null;
    cloneSrcRef.current = null;
    setOldPolys([]);
    setFrontPolys([]);
    setFrontCov(0);
    setAutoInfo(null);
    setInpaintRes(null);
    setQuadPct(null);
    setCornerCount(0);
    // Nova fotografija ⇒ nobena ravnina ni potrjena in noben predlog ne sme
    // preživeti menjave slike: potrditev velja samo za tisto sliko, na kateri
    // jo je monter pogledal (invariant, ne varovalka).
    setPlaneConfirmed(true);
    setBandTaps(null);
    setBandInfo(null);
    setTool('corners');
    setCloneStage('off');
    setCloneSrcUi(null);
    setProfileId(null);
    setResult(null);
    resultCanvasRef.current = null;
    setComparePct(100);
    setWorkTick((t) => t + 1);
  }, [imgEl]);

  // ── Različice iz localStorage (odjemalsko, varno) ──
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VERSIONS_KEY);
      if (raw) setVersions(JSON.parse(raw) as VersionRec[]);
    } catch { /* različice niso kritične */ }
  }, []);

  // ── Izris prizorišča: delovna kopija + preko nje SVG (oglišča, maske) ──
  useEffect(() => {
    const cv = stageCanvasRef.current;
    const src = workCanvasRef.current;
    if (!cv || !src || !imgEl) return;
    if (cv.width !== src.width || cv.height !== src.height) {
      cv.width = src.width;
      cv.height = src.height;
    }
    cv.getContext('2d')!.drawImage(src, 0, 0);
  }, [imgEl, workTick]);

  // ── Priprava poligonov maske za SVG (maskToPctPolys — trakti v % fotke) ──
  const recomputeMaskMeta = useCallback(() => {
    const om = oldMaskRef.current;
    setOldPolys(om ? maskToPctPolys(om) : []);
    const fm = frontMaskRef.current;
    setFrontPolys(fm ? maskToPctPolys(fm) : []);
    setFrontCov(fm ? maskCoverage(fm) : 0);
    setCovTick((t) => t + 1);
  }, []);

  // recompute med vlečenjem čopiča (throttle 200 ms) — takojšnji ob spustu
  const schedulePolyRecompute = useCallback(() => {
    if (polyTimerRef.current) return;
    polyTimerRef.current = setTimeout(() => {
      polyTimerRef.current = null;
      recomputeMaskMeta();
    }, 200);
  }, [recomputeMaskMeta]);

  // ── Izpeljano: štirikotnik, ravnina, profili, postavitev ──
  const quadPx = useMemo<QuadPx | null>(() => {
    if (!quadPct || quadPct.length !== 4 || !dims) return null;
    const map = (p: [number, number]): XY => ({ x: (p[0] / 100) * dims.w, y: (p[1] / 100) * dims.h });
    return { tl: map(quadPct[0]), tr: map(quadPct[1]), br: map(quadPct[2]), bl: map(quadPct[3]) };
  }, [quadPct, dims]);

  /**
   * Ravnina iz vnosov monterja. Širina sme ostati PRAZNA — pravilo 11
   * (FAZA-8 §6): vrata fotomontaže ne sprašujejo po merilu, izris pa
   * potrebuje eno samo dolžino. Kadar je širina neznana, jo jedro
   * računa iz kanonične notranje mere (desk je polne širine — rezultat
   * je na izbiro številke nepremazen), izris navpičnih desk pa JE
   * nedoločen in jedro to pove z eksplicitno napako.
   */
  const planeCm = useMemo<{ wCm: number | null; hCm: number } | null>(() => {
    const h = Number(hCm.replace(',', '.'));
    if (!Number.isFinite(h) || h <= 0) return null;
    if (wCm.trim() === '') return { wCm: null, hCm: h };
    const w = Number(wCm.replace(',', '.'));
    if (!Number.isFinite(w) || w <= 0) return null;
    return { wCm: w, hCm: h };
  }, [wCm, hCm]);

  /** Para trditev (geometrija / merilo) — obe osi ločeno, nikoli seštejeni. */
  const assurance = useMemo<{ geo: GeometricAssurance; met: MetricAssurance }>(() => {
    const planeCalibrated = !!planeCm && !!quadPct && quadPct.length === 4 && !!dims;
    const geo = validateGeometry({ method: 'plane-homography', planeCalibrated, planeConfirmed }).assurance;
    // Merilo nosi samo tista dimenzija, ki jo je monter dejansko vtipkal.
    // Kadar širina NI izmerjena, os merila v širini nima ničesar — stanje je
    // NONE (manjka mera), ne ASSUMED (domneva). Po pravilu 14 to zapre vrata
    // naročilnici in jih pusti odprte za izris; jedro isto pove z napako
    // 'KOSOVNICA NI DOLOČENA', tu pa jo prehitimo pred klikom.
    const met: MetricAssurance = !planeCalibrated || planeCm?.wCm === null ? 'NONE' : 'REFERENCED';
    return { geo, met };
  }, [planeCm, quadPct, dims]);

  const selProfile = useMemo(
    () => ROKSAL_PROFILES.find((p) => p.id === profileId) ?? null,
    [profileId],
  );

  // kalibracija ravnine za merjenje (ista homografija kot v jedru — ni duplikata)
  const measurePlane = useMemo(() => {
    if (!quadPct || quadPct.length !== 4 || !planeCm || !dims) return null;
    // Nepotrjen predlog nima domene veljavnosti: številka cm, izmerjena čez
    // samodejni štirikotnik, bi bila trditev iz nečesa, kar monter še samo
    // preverja. Enako pravilo kot pri zaprtih vratih izrisa (FAZA-9).
    if (!planeConfirmed) return null;
    // Izmera poljubne razdalje v cm potrebuje OBOJE smeri v cm; brez
    // izmerjene širine je canonična notranja mera lahko usedena za perspektivo,
    // ne pa za številke cm (pravilo 13).
    if (planeCm.wCm === null) return null;
    return calibratePlane(quadPct.map(([x, y]) => ({ x, y })), planeCm.wCm, planeCm.hCm, dims);
  }, [quadPct, planeCm, dims, planeConfirmed]);

  // izmerjena deska → najbližji uradni profili (čista knjižnica photo-profile-suggest)
  const measureSuggest = useMemo<{
    distanceCm: number | null; error: string | null; suggest: ProfileSuggestResult | null;
  }>(() => {
    if (!measurePlane || !dims || !measurePts || measurePts.length !== 2) {
      return { distanceCm: null, error: null, suggest: null };
    }
    const [a, b] = measurePts;
    const d = planeDistanceCm(measurePlane, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, dims);
    if (d === null) {
      return { distanceCm: null, error: 'Meritve ni bilo mogoče izračunati (degenerirana kalibracija).', suggest: null };
    }
    try {
      return { distanceCm: d, error: null, suggest: suggestProfiles(d) };
    } catch (e) {
      return { distanceCm: d, error: e instanceof Error ? e.message : String(e), suggest: null };
    }
  }, [measurePlane, dims, measurePts]);

  const layoutInfo = useMemo<{ layout: LayoutResult | null; error: string | null }>(() => {
    if (!quadPct || !planeCm || !dims) return { layout: null, error: null };
    const p = selProfile ?? ROKSAL_PROFILES[0];
    try {
      const layout = computePlankLayouts({
        quadPct,
        imgSize: dims,
        planeCm,
        plankCm: p.plankCm,
        gapCm: p.gapCm,
        orientation: p.orientation,
        postCm: p.postCm,
        postEveryCm: null, // vmesni stebri v tej različici niso modelirani (iskreno v opombah)
      });
      return { layout, error: null };
    } catch (e) {
      return { layout: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [quadPct, planeCm, dims, selProfile]);

  // pokritost maske znotraj štirikotnika (korak 3)
  const oldQuadCov = useMemo(() => {
    void covTick;
    if (!oldMaskRef.current || !quadPx) return null;
    return quadMaskCoverage(oldMaskRef.current, quadPx);
  }, [covTick, quadPx]);

  const baseRenderBlocker = useMemo<string | null>(() => {
    if (!imgEl) return 'Najprej naloži fotografijo (korak 1).';
    if (!quadPct || !quadPx) return 'Označi 4 oglišča ravnine stare ograje (korak 2).';
    // VRATNI RED: domena veljavnosti geometrije je hujša pomanjkljivost kot
    // manjkajoči centimeter — izris je zaprt zaradi nepotrjenega predloga, ne
    // zaradi višine, in korak 6 mora reči tisto, kar res drži (izmerjeno v
    // brskalniku: vrstni red je napovedal cm pred predlogom).
    if (!canRenderMontage(assurance.geo)) {
      // Drugi del istega pouka, izmerjen 2026-10-16 na PRAVI fotki (Task 78):
      // ko je predlog POTRJEN, `geo` vseeno ostane pod `FITTED`, ker
      // `planeCalibrated` potrebuje tudi vnos cm. Takrat oglišča niso kriva —
      // manjka mera, in to je treba tudi reči; sicer monter gleda v 4/4
      // potrjena oglišča in jim piše, da jih naj označi.
      if (planeConfirmed && !planeCm) return 'Vnesi višino ravnine v cm (korak 2). Širino lahko pustiš prazno.';
      return planeConfirmed
        ? 'Geometrija ravnine ni potrjena (4 oglišča) — brez nje izris ni utemeljen.'
        : 'Štirikotnik je samodejni predlog in ga monter še ni potrdil — izris je zaprt, dokler oglišč ne pregledaš (korak 2).';
    }
    if (layoutInfo.error) return layoutInfo.error;
    if (!layoutInfo.layout) return 'Postavitev elementov ni izračunana (korak 2).';
    if (!inpaintRes) return 'Zaženi odstranitev stare ograje (korak 4).';
    return null;
  }, [imgEl, quadPct, quadPx, planeCm, planeConfirmed, assurance, layoutInfo, inpaintRes]);

  /**
   * Obložen izris (najdba F3): jedrna funkcija, ne lokalna logika — parameter je
   * tudi izbrani profil, ker par (geo, met) pri pokončnem profilu NE zadostuje.
   */
  const renderPromise = useMemo<RenderPromise>(
    () => renderPromiseOf({
      geo: assurance.geo,
      widthMeasured: planeCm !== null && planeCm.wCm !== null,
      profileOrientation: selProfile ? selProfile.orientation : null,
    }),
    [assurance.geo, planeCm, selProfile],
  );

  const renderBlocker = useMemo<string | null>(() => {
    if (baseRenderBlocker) return baseRenderBlocker;
    if (!selProfile) return 'Izberi profil nove ograje (korak 5).';
    const readiness = profileReadiness(selProfile);
    if (!readiness.canRender) return readiness.honestyLabel;
    return null;
  }, [baseRenderBlocker, selProfile]);

  // ── Vpis koordinat iz pointer dogodkov ──
  const stagePct = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const el = stageRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };
  const stageNatural = (e: { clientX: number; clientY: number }): XY | null => {
    const el = stageRef.current;
    if (!el || !dims) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: Math.max(0, Math.min(dims.w - 1, Math.round(((e.clientX - r.left) / r.width) * dims.w))),
      y: Math.max(0, Math.min(dims.h - 1, Math.round(((e.clientY - r.top) / r.height) * dims.h))),
    };
  };

  // ── Čopič: pobarvaj krog v aktivno masko (MaskGrid v ločljivosti delovne kopije) ──
  const ensureMask = (target: 'old' | 'front'): MaskGrid | null => {
    if (!dims) return null;
    if (target === 'old' && !oldMaskRef.current) oldMaskRef.current = createMask(dims.w, dims.h);
    if (target === 'front' && !frontMaskRef.current) frontMaskRef.current = createMask(dims.w, dims.h);
    return target === 'old' ? oldMaskRef.current : frontMaskRef.current;
  };

  const paintAt = (nx: number, ny: number) => {
    const m = ensureMask(brushTarget);
    if (!m) return;
    paintMaskCircle(m, nx, ny, brushSize, brushMode === 'add' ? 255 : 0);
  };

  const paintStroke = (from: XY | null, to: XY) => {
    if (!from) { paintAt(to.x, to.y); return; }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(1, brushSize / 2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      paintAt(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
    }
  };

  // ── Kloniraj: žig prekopira ORIGINALNE (pred obnovo) piksle z odmikom (cilj − izvor) ──
  const stampAt = (t: XY) => {
    const src = cloneSrcRef.current;
    const work = workCanvasRef.current;
    const orig = originalCanvasRef.current;
    if (!src || !work || !orig) return;
    const ctx = work.getContext('2d')!;
    const dx = t.x - src.x;
    const dy = t.y - src.y;
    ctx.save();
    ctx.beginPath();
    ctx.arc(t.x, t.y, brushSize, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(orig, dx, dy); // originalni piksel s = t − (t − izvor) = izvor
    ctx.restore();
    setWorkTick((v) => v + 1);
  };

  // ── Pointer dogodki prizorišča ──
  const handleHitHandle = (p: [number, number]): number | null => {
    if (!quadPct) return null;
    const el = stageRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const tolX = (16 / r.width) * 100;
    const tolY = (16 / r.height) * 100;
    for (let i = 0; i < 4; i++) {
      const [qx, qy] = quadPct[i];
      if (Math.abs(qx - p[0]) <= tolX && Math.abs(qy - p[1]) <= tolY) return i;
    }
    return null;
  };

  const onStageDown = (e: React.PointerEvent) => {
    if (!imgEl) return;
    e.preventDefault();
    const p = stagePct(e);
    const n = stageNatural(e);
    if (!p || !n) return;
    if (tool === 'corners') {
      if (!quadPct || quadPct.length < 4) {
        // zaporedno postavljanje: 1 = zgornji levi … 4 = spodnji levi
        const becomesFourth = (quadPct?.length ?? 0) + 1 >= 4;
        setQuadPct((prev) => {
          const arr = (prev ? [...prev] : []) as [number, number][];
          if (arr.length < 4) arr.push(p);
          return arr;
        });
        setCornerCount((c) => Math.min(4, c + 1));
        // Četrtročno oglišče postavi človek → ravnina je potrjena. Vlečenje
        // predlaganega oglišča SAMEGA ne pomeni potrditve.
        if (becomesFourth) { setPlaneConfirmed(true); setBandInfo(null); }
        return;
      }
      dragCornerRef.current = handleHitHandle(p);
      return;
    }
    if (tool === 'band') {
      const taps = [...(bandTaps ?? []), p] as [number, number][];
      if (taps.length < 2) { setBandTaps(taps); return; }
      setBandTaps(null);
      const orig = originalCanvasRef.current;
      if (!orig) {
        toast({ title: 'Predlog ni mogoč', description: 'Ni nespremenjenega originala — osveži stran in naloži fotko znova.', variant: 'destructive' });
        return;
      }
      let res: ReturnType<typeof suggestBandQuadPct> = null;
      try {
        res = suggestBandQuadPct(
          imgDataFrom(orig),
          { xPct: taps[0][0], yPct: taps[0][1] },
          { xPct: taps[1][0], yPct: taps[1][1] },
        );
      } catch (err) {
        toast({ title: 'Predlog ni mogoč', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
        return;
      }
      if (!res) {
        toast({
          title: 'Pasu ograje ni bilo mogoče najti',
          description: 'Modul noče ugibati — klikni dve točki bolj sredinsko ob robu ograje (pestro ozadje, močna senca ali prekratka razdalja med klikoma lahko zakrijejo tirnici) ali označi 4 oglišča ročno.',
          variant: 'destructive',
        });
        return;
      }
      setQuadPct(res.quadPct);
      setCornerCount(4);
      setPlaneConfirmed(false);
      setBandInfo(res.band);
      setTool('corners');
      setMeasurePts(null); // predlog ni kalibracija — morebitna mera ne velja več
      toast({
        title: 'Predlog štirikotnika — ŠE NI potrjen',
        description: 'Zgornja in spodnja tirnica sta iz fotke, levi in desni rob sta tvoja klika. Preveri oglišča in klikni »Potrdi predlog« — izris je do takrat zaprt.',
      });
      return;
    }
    if (tool === 'measure') {
      if (!measurePlane) {
        // Vrsta pogojev je namenjena: najprej se preveri, kaj merjenju dejansko
        // manjka — sicer toast trdi napačen razlog (npr. manjkajočo širino, ko
        // je širina zapisana, ravnina pa je še nepotrjen predlog).
        const noPlane = !quadPct || quadPct.length !== 4 || !dims;
        let why = 'Merjenje po fotki potrebuje oglisča ravnine + realne mere (korak 2) — sicer izmera ne bi bila prava.';
        if (!noPlane && !planeConfirmed) {
          why = 'Štirikotnik je samodejni predlog in še ni potrjen — centimetri čezenj ne veljajo. Potrdi ga ali označi oglišča (korak 2).';
        } else if (planeCm && planeCm.wCm === null) {
          why = 'Merjenje deske potrebuje tudi izmerjeno širino ravnine (vpiši jo v koraku 2) — brez cm razdalja v pikslih ni mera.';
        }
        toast({ title: 'Najprej kalibriraj ravnino', description: why, variant: 'destructive' });
        return;
      }
      // 1. klik = začetek, 2. = konec meritve; tretji klik začne NOVO meritev
      setMeasurePts((prev) => (prev && prev.length === 2 ? [p] : [...(prev ?? []), p] as [number, number][]));
      return;
    }
    if (tool === 'clone') {
      if (cloneStage === 'source') {
        cloneSrcRef.current = n;
        setCloneSrcUi(n);
        setCloneStage('stamp');
        toast({ title: 'Izvor kloniranja nastavljen ✓', description: 'Zdaj klikni ali vleci po ciljnem območju — prekopirajo se ORIGINALNI piksli.' });
        return;
      }
      if (cloneStage === 'stamp' && cloneSrcRef.current) {
        stampAt(n);
        paintingRef.current = true;
      }
      return;
    }
    if (tool === 'brush') {
      paintStroke(null, n);
      lastPaintRef.current = n;
      paintingRef.current = true;
      schedulePolyRecompute();
    }
  };

  const onStageMove = (e: React.PointerEvent) => {
    if (!imgEl) return;
    if (dragCornerRef.current !== null) {
      const p = stagePct(e);
      if (!p) return;
      const idx = dragCornerRef.current;
      setQuadPct((prev) => (prev ? prev.map((q, i) => (i === idx ? p : q)) as [number, number][] : prev));
      return;
    }
    if (!paintingRef.current) return;
    const n = stageNatural(e);
    if (!n) return;
    if (tool === 'brush') {
      paintStroke(lastPaintRef.current, n);
      lastPaintRef.current = n;
      schedulePolyRecompute();
    } else if (tool === 'clone' && cloneStage === 'stamp') {
      stampAt(n);
    }
  };

  const endStagePointer = () => {
    if (dragCornerRef.current !== null) dragCornerRef.current = null;
    if (paintingRef.current) {
      paintingRef.current = false;
      lastPaintRef.current = null;
      recomputeMaskMeta();
    }
  };

  // ── Korak 2: oglišča ──
  const resetQuad = () => {
    setQuadPct(null);
    setCornerCount(0);
    setTool('corners');
    setPlaneConfirmed(true);
    setBandTaps(null);
    setBandInfo(null);
    setMeasurePts(null); // kalibracija pade — meritve ni več prava
    dragCornerRef.current = null;
  };

  /**
   * Potrditev predloga (FAZA-9): MONTER je oglišča pogledal in rekel, da
   * držijo. To je edini gumb, ki iz SUGGESTED naredi FITTED — predlog se sam
   * ne more potrditi, ker pasovni modul nima domene veljavnosti (izmerjeno:
   * na fotkah izven zajema znaša napaka predloga do +37 %).
   */
  const confirmSuggestion = () => {
    setPlaneConfirmed(true);
    setBandInfo(null);
    toast({ title: 'Ravnina potrjena', description: 'Izris montaže je od tukaj naprej utemeljen na tvojih ogliščih.' });
  };

  /**
   * Demo kvadrant (E2E zasilni gumb, determinističen): napolni štirikotnik
   * s fiksnim sredinskim pasom fotke (12–88 % × 48–92 %) — brez naključja,
   * iskreno označen kot testni pripomoček. Uporablja se, kadar je klikanje
   * oglišč v avtomatiziranem preizkusu nestabilno.
   */
  const demoQuad = () => {
    setQuadPct([[12, 48], [88, 48], [88, 92], [12, 92]]);
    setCornerCount(4);
    setTool('corners');
    setPlaneConfirmed(true); // gumb pritisne človek (ali test) — ni samodejni predlog
    setBandInfo(null);
  };

  // ── Korak 3: samodejni predlog + čopič + ovire ──
  const onAutoSuggest = () => {
    const work = workCanvasRef.current;
    const q = quadPx;
    if (!work || !q) return;
    try {
      const img = imgDataFrom(work);
      const res = autoSuggestFenceMask(img, q);
      oldMaskRef.current = res.mask;
      setAutoInfo({ confidence: res.confidence, note: res.note });
      recomputeMaskMeta();
    } catch (err) {
      toast({ title: 'Samodejni predlog ni uspel', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const clearMask = (target: 'old' | 'front') => {
    if (target === 'old') {
      oldMaskRef.current = null;
      setAutoInfo(null);
      setOldPolys([]);
    } else {
      frontMaskRef.current = null;
      setFrontPolys([]);
      setFrontCov(0);
    }
    setCovTick((t) => t + 1);
  };

  // ── Korak 4: obnova ozadja ──
  const onInpaint = () => {
    const work = workCanvasRef.current;
    const mask = oldMaskRef.current;
    if (!work || !mask || !dims) return;
    setBusyInpaint(true);
    try {
      const img = imgDataFrom(work);
      const res = inpaintMask(img, mask);
      // Rezultat pobarvamo NA DELOVNO KOPIJO (original ostane nespremenjen)
      const wctx = work.getContext('2d')!;
      const outId = wctx.createImageData(res.image.width, res.image.height);
      outId.data.set(res.image.data);
      wctx.putImageData(outId, 0, 0);
      setInpaintRes({ status: res.status, coverage: res.coverage, repairedPx: res.repairedPx, manualHint: res.manualHint });
      setWorkTick((v) => v + 1);
    } catch (err) {
      toast({ title: 'Obnova ni uspela', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setBusyInpaint(false);
    }
  };

  const onUndoRepair = () => {
    const work = workCanvasRef.current;
    const orig = originalCanvasRef.current;
    if (!work || !orig) return;
    work.getContext('2d')!.drawImage(orig, 0, 0);
    setInpaintRes(null);
    setWorkTick((v) => v + 1);
    toast({ title: 'Obnova razveljavljena', description: 'Delovna kopija je spet enaka originalu.' });
  };

  // ── Korak 6: upodobi fotomontažo (deterministični cevovod) ──
  // Jedro je ločeno od stanja: renderForProfile(profile, layout, createdAt) vrne artefakt
  // brez stranskih učinkov na state (isti vhodi → isti piksli; createdAt podan od zunaj) —
  // isti cevovod uporablja "Upodobi" za izbrani profil IN primerjava vseh profilov na isti fotki.
  const renderForProfile = async (
    profile: RoksalProfile,
    layout: LayoutResult,
    createdAt: string,
  ): Promise<{ comp: HTMLCanvasElement; meta: ReplaceMetadata; aux: VersionAux; dataUrl: string }> => {
    const work = workCanvasRef.current;
    const q = quadPx;
    const qp = quadPct;
    const pc = planeCm;
    const d = dims;
    const mask = oldMaskRef.current;
    if (!work || !q || !qp || !pc || !d || !mask) throw new Error('Manjkajo vhodi upodobitve (fotka, ravnina ali maska).');
    const readiness = profileReadiness(profile);
    if (!readiness.canRender) throw new Error(readiness.honestyLabel);

    {
      const W = d.w;
      const H = d.h;

      // tekstura prednalaganje (viz-textures cache — drawLayersOnQuad jo bere sinhrono)
      const vizTexId = profile.textureId ? vizTextureIdFor(profile.textureId) : null;
      if (vizTexId) await preloadVizTextures([vizTexId]);

      // plast nove ograje iz profila (obstoječi renderer viz.ts izriše deske/reže/teksturo)
      const fenceLayer: VizLayer = {
        id: 'fr-fence',
        label: `Nova ograja — ${profile.label}`,
        quad: qp,
        pattern: profile.pattern as VizPattern,
        colorId: PROFILE_COLOR_ID[profile.id] ?? 'wpc-tikovina',
        textureId: vizTexId ?? undefined,
        params: {
          ...defaultParamsForPattern(profile.pattern as VizPattern),
          elementCm: profile.plankCm,
          spacingCm: profile.gapCm,
          // 0 = širina NI izmerjena → viz vzame gostoto teksture iz katalogove
          // privzete širine (defaultQuadWidthCm), ne iz izmišljene mere te ograje.
          quadWidthCm: pc.wCm ?? 0,
          quadHeightCm: pc.hCm, // prava višina ravnine → pravo število elementov navpično (skladno s postavitvijo po homografiji)
        },
      };

      // 1+2) pomožni canvas: delovna kopija (obnovljeno ozadje) + nova ograja čez štirikotnik
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d', { willReadFrequently: true })!;
      octx.drawImage(work, 0, 0);
      drawLayersOnQuad(octx, work, [fenceLayer], craft);

      // 3) ambientno ujemanje: faktor iz obroča okoli štirikotnika ORIGINALNE (delovne) fotke,
      //    pomnožijo se SAMO opačni piksli novih elementov (masa desk + stebrov iz postavitve)
      const amb = ambientLightFactor(imgDataFrom(work), q, 12);
      const pm = document.createElement('canvas');
      pm.width = W;
      pm.height = H;
      const pmctx = pm.getContext('2d', { willReadFrequently: true })!;
      pmctx.fillStyle = '#ffffff';
      const fillQuad = (qd: QuadPx) => {
        pmctx.beginPath();
        pmctx.moveTo(qd.tl.x, qd.tl.y);
        pmctx.lineTo(qd.tr.x, qd.tr.y);
        pmctx.lineTo(qd.br.x, qd.br.y);
        pmctx.lineTo(qd.bl.x, qd.bl.y);
        pmctx.closePath();
        pmctx.fill();
      };
      for (const l of layout.planks) fillQuad(l.quad);
      for (const p of layout.posts) fillQuad(p.quad);
      const plankAlpha = pmctx.getImageData(0, 0, W, H).data;
      const offData = octx.getImageData(0, 0, W, H);
      const px = offData.data;
      const f = amb.factor;
      for (let i = 0; i < W * H; i++) {
        if (plankAlpha[i * 4] > 127) {
          px[i * 4] = Math.max(0, Math.min(255, Math.round(px[i * 4] * f)));
          px[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(px[i * 4 + 1] * f)));
          px[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(px[i * 4 + 2] * f)));
        }
      }
      octx.putImageData(offData, 0, 0);

      // 4) stične sence na zgornjem/spodnjem robu štirikotnika (deterministični alfa iz jedra)
      const se = shadowEdgesFor(q, 1);
      const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
      const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
      const topY = Math.min(...ys);
      const bottomY = Math.max(...ys);
      const qx0 = Math.min(...xs);
      const qx1 = Math.max(...xs);
      const path = new Path2D();
      path.moveTo(q.tl.x, q.tl.y);
      path.lineTo(q.tr.x, q.tr.y);
      path.lineTo(q.br.x, q.br.y);
      path.lineTo(q.bl.x, q.bl.y);
      path.closePath();
      const qh = Math.max(1, bottomY - topY);
      const stripH = Math.max(6, Math.min(H * 0.2, qh * 0.35));
      const drawStrip = (alpha: number, fromTop: boolean) => {
        if (alpha <= 0) return;
        octx.save();
        octx.clip(path);
        const g = fromTop
          ? octx.createLinearGradient(0, topY, 0, topY + stripH)
          : octx.createLinearGradient(0, bottomY, 0, bottomY - stripH);
        g.addColorStop(0, `rgba(0,0,0,${alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = g;
        octx.fillRect(qx0, fromTop ? topY : bottomY - stripH, Math.max(1, qx1 - qx0), stripH);
        octx.restore();
      };
      drawStrip(se.topAlpha, true);
      drawStrip(se.bottomAlpha, false);

      // 5) kompozit: delovna kopija + senčena nova ograja
      const comp = document.createElement('canvas');
      comp.width = W;
      comp.height = H;
      const cctx = comp.getContext('2d')!;
      cctx.drawImage(work, 0, 0);
      cctx.drawImage(off, 0, 0);

      // 6) frontalni okluziji: ORIGINALNI piksli kjer je maska ovir (rastline, zid …)
      const fm = frontMaskRef.current;
      let frontUsed = false;
      if (fm) {
        let any = false;
        for (let i = 0; i < fm.data.length; i++) if (fm.data[i] > 0) { any = true; break; }
        if (any) {
          const fp = frontPixelsFrom(imgDataFrom(originalCanvasRef.current ?? work), fm);
          const tmp = document.createElement('canvas');
          tmp.width = W;
          tmp.height = H;
          const tctx = tmp.getContext('2d')!;
          const tmpId = tctx.createImageData(fp.width, fp.height);
          tmpId.data.set(fp.data);
          tctx.putImageData(tmpId, 0, 0);
          cctx.drawImage(tmp, 0, 0); // drawImage spošta alfa (putImageData bi PREDPISAL piksle)
          frontUsed = true;
        }
      }

      // metapodatki različice (createdAt podan od zunaj — deterministični JSON za enake vhode)
      const texAsset = assetById(profile.textureId);
      const warnings = [...layout.warnings];
      if (inpaintRes && inpaintRes.status !== 'ok') warnings.push('Ozadje pod novo ograjo ni v celoti obnovljeno — reže lahko pokažejo staro ograjo.');
      if (!frontUsed) warnings.push('Frontalni okluziji so prazni — nič ni narisano pred novo ograjo.');
      const meta = buildReplaceMetadata({
        profileId: profile.id,
        profileLabel: profile.label,
        catalogSku: profile.catalogSku,
        texture: texAsset
          ? { id: texAsset.id, src: texAsset.src, origin: texAsset.origin, verification: texAsset.verification, realCm: texAsset.realCm }
          : null,
        planeCm: pc,
        params: {
          pattern: profile.pattern,
          elementCm: profile.plankCm,
          spacingCm: profile.gapCm,
          quadWidthCm: pc.wCm === null ? 'ni izmerjena' : Math.round(pc.wCm),
          postEveryCm: 'null',
          materialHonesty: readiness.honestyLabel, // iskrenost gradiva v metapodatkih (original vs. realna fotka)
        },
        mask,
        layout,
        imgSize: { w: W, h: H },
        inpaint: inpaintRes?.status ?? 'ok',
        warnings,
        createdAt,
      });

      const dataUrl = comp.toDataURL('image/jpeg', 0.92);
      return {
        comp,
        meta,
        aux: {
          factor: amb.factor,
          samples: amb.sampleCount,
          topAlpha: se.topAlpha,
          bottomAlpha: se.bottomAlpha,
          warnings,
          scaleTop: layout.scaleCmPerPxAtQuad.top,
          scaleBottom: layout.scaleCmPerPxAtQuad.bottom,
        },
        dataUrl,
      };
    }
  };

  const onRender = async () => {
    if (!selProfile || !layoutInfo.layout) return;
    setBusyRender(true);
    try {
      const art = await renderForProfile(selProfile, layoutInfo.layout, new Date().toISOString());
      resultCanvasRef.current = art.comp;
      setResult({ meta: art.meta, aux: art.aux, dataUrl: art.dataUrl });
      setComparePct(100);
      setExportBlocked(null);
    } catch (err) {
      toast({ title: 'Upodobitev ni uspela', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setBusyRender(false);
    }
  };

  // ── Korak 6 (priloga): primerjava vseh omogočenih profilov na ISTI fotki/ravnini/maski ──
  // (navdih konkurenca D2K "generate again with a different material or color to compare
  // options on the same photo" — pri nas deterministično, 0 AI, z iskrenimi razlogi za blokado)
  const onCompareProfiles = async () => {
    if (baseRenderBlocker) return;
    const d = dims;
    const qp = quadPct;
    const pc = planeCm;
    if (!d || !qp || !pc) return;
    setBusyCompare(true);
    try {
      const now = new Date().toISOString();
      const cards: ComparisonCard[] = [];
      compareCanvasRef.current.clear();
      compareCompRef.current.clear();
      for (const p of ROKSAL_PROFILES) {
        const readiness = profileReadiness(p);
        const blocked = (reason: string): ComparisonCard => ({
          profileId: p.id, label: p.label, honestyLabel: readiness.honestyLabel,
          canRender: false, blockedReason: reason, thumbUrl: null,
        });
        if (!readiness.canRender) { cards.push(blocked(readiness.honestyLabel)); continue; }
        let layout: LayoutResult;
        try {
          layout = computePlankLayouts({
            quadPct: qp, imgSize: d, planeCm: pc,
            plankCm: p.plankCm, gapCm: p.gapCm, orientation: p.orientation,
            postCm: p.postCm, postEveryCm: null, // iskreno: vmesni stebri niso modelirani
          });
        } catch (e) { cards.push(blocked(e instanceof Error ? e.message : String(e))); continue; }
        try {
          const art = await renderForProfile(p, layout, now);
          compareCompRef.current.set(p.id, art.comp);
          compareCanvasRef.current.set(p.id, { meta: art.meta, aux: art.aux });
          cards.push({
            profileId: p.id, label: p.label, honestyLabel: readiness.honestyLabel,
            canRender: true, blockedReason: null, thumbUrl: thumbDataUrl(art.comp, 440),
          });
        } catch (e) { cards.push(blocked(e instanceof Error ? e.message : String(e))); }
      }
      setComparisons(cards);
      const ok = cards.filter((c) => c.canRender).length;
      toast({ title: 'Primerjava profilov pripravljena ✓', description: `${ok} upodabljanj iz iste fotke, ravnine in maske — klikni za celotni prikaz.` });
    } finally {
      setBusyCompare(false);
    }
  };

  const loadComparison = (card: ComparisonCard) => {
    const comp = compareCompRef.current.get(card.profileId);
    const rec = compareCanvasRef.current.get(card.profileId);
    if (!comp || !rec) return;
    resultCanvasRef.current = comp;
    setResult({ meta: rec.meta, aux: rec.aux, dataUrl: comp.toDataURL('image/jpeg', 0.92) });
    setProfileId(card.profileId); // korak 5 pokaže isti profil kot pred/po pogled
    setComparePct(100);
    setExportBlocked(null);
  };

  // Primerjava je vezana na TRENUTNO delovno kopijo + vnos — vsak popravek (čopič, kloniranje,
  // obnova, oglisča, mere, ovire) jo razveljavi (iskrenost: ne prikazujemo zastarelih upodobitev).
  useEffect(() => {
    setComparisons(null);
  }, [workTick, quadPct, wCm, hCm, frontPolys]);

  // ── Korak 7: različice + izvoz ──
  const onSaveVersion = () => {
    if (!result) return;
    const rec: VersionRec = {
      id: `${result.meta.createdAt}-${result.meta.profileId}`,
      createdAt: result.meta.createdAt,
      profileLabel: result.meta.profileLabel,
      meta: result.meta,
      aux: result.aux,
      dataUrl: result.dataUrl,
    };
    const next = [rec, ...versions.filter((v) => v.id !== rec.id)].slice(0, VERSIONS_CAP);
    setVersions(next);
    try {
      window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(next));
      toast({ title: 'Različica shranjena ✓', description: `Skupaj ${next.length} (omejitev ${VERSIONS_CAP}).` });
    } catch {
      toast({
        title: 'Različica shranjena v seji',
        description: 'Lokalna shramba je polna — različica ostane samo do osvežitve strani.',
        variant: 'destructive',
      });
    }
  };

  const loadVersion = (v: VersionRec) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resultCanvasRef.current = c;
      setResult({ meta: v.meta, aux: v.aux, dataUrl: v.dataUrl });
      setComparePct(100);
      setExportBlocked(null);
    };
    img.onerror = () => toast({ title: 'Različice ni bilo mogoče naložiti', variant: 'destructive' });
    img.src = v.dataUrl;
  };

  // ── Korak 7: kosovnica (BOM) iz shranjenih metapodatkov — deterministično, 0 AI ──
  // Štetje desk = ista formula kot v upodobitvi (computePlankLayouts); cene ostanejo 0
  // (ROKSAL cen ne prevajamo); stebri/pritrdilni material se NE izmišljajo — opozorilo.
  const onAddBom = () => {
    if (!result) return;
    // Par trditve SHRANJENE različice — ne live stanja drsnikov (pravilo 14).
    const storedGeo: GeometricAssurance = 'FITTED';
    const storedMet: MetricAssurance = result.meta.planeCm.wCm === null ? 'NONE' : 'REFERENCED';
    if (!canExportOrder(storedGeo, storedMet)) {
      toast({
        title: 'Naročilnica ni mogoča',
        description: 'Geometrija ravnine je potrjena, merila v širini pa ni: iz te fotomontaže se da pokazati videz, ne pa izračunati dolžin rezov. Izmeri eno samo dolžino (širino ali višino) in potrdi umerjanje.',
        variant: 'destructive',
      });
      return;
    }
    let bom;
    try {
      bom = buildBomFromMeta(result.meta);
    } catch (err) {
      toast({ title: 'Kosovnica ni mogoča', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      return;
    }
    if (bom.items.length === 0) {
      toast({ title: 'Ni postavk za dodajo', description: bom.warnings.join(' '), variant: 'destructive' });
      return;
    }
    addDraftItems(bom.items);
    // Metapodatki fotomontaže se shranijo skupaj z osnutkom ponudbe —
    // od tod je pozneje mogoč natisniti MONTAŽNI LIST za monterja.
    setMontage({ meta: result.meta });
    toast({
      title: `Material v ponudbo: ${bom.items.length} ${plural(bom.items.length, ['postavka', 'postavki', 'postavke', 'postavk'])} ✓`,
      description:
        `${bom.boards} ${plural(bom.boards, ['kos', 'kosa', 'kosi', 'kosov'])} × rez ${Math.round(bom.cutLenCm * 10) / 10} cm (${bom.totalMeters.toFixed(2)} m)` +
        `${bom.stocks ? ` — ${bom.stocks.count} ${plural(bom.stocks.count, ['nabaven profil', 'nabavna profila', 'nabavni profili', 'nabavnih profilov'])}` : ''}. Cene vpiši v ponudbi; stebri in pritrdilni material niso modelirani.`,
    });
    setActiveCraft(null); // da se pokaže osnutek ponudbe (OfferEditor)
    setView('kalkulatorji');
  };

  const onExport = () => {
    if (!result) return;
    const profile = ROKSAL_PROFILES.find((p) => p.id === result.meta.profileId) ?? null;
    const canRender = profile ? profileReadiness(profile).canRender : false;
    const chk = canExportResult(result.meta, { canRender });
    if (!chk.allowed) {
      setExportBlocked(chk.reason);
      toast({ title: 'Izvoz blokiran', description: chk.reason ?? undefined, variant: 'destructive' });
      return;
    }
    setExportBlocked(null);
    const src = resultCanvasRef.current;
    if (!src) return;
    // izvozni canvas = kompozit + žig oznake (temen pas + belo besedilo)
    const fs = 13;
    const lineH = 17;
    const pad = 12;
    const meas = document.createElement('canvas').getContext('2d')!;
    meas.font = `${fs}px system-ui, sans-serif`;
    const metaLine = `Profil: ${result.meta.profileLabel} · ${new Date(result.meta.createdAt).toLocaleString('sl-SI')}`;
    const labelLines = wrapText(meas, EXPORT_LABEL, Math.max(200, src.width - 2 * pad));
    const stripH = pad * 2 + labelLines.length * lineH + lineH + 6;
    const ec = document.createElement('canvas');
    ec.width = src.width;
    ec.height = src.height + stripH;
    const ectx = ec.getContext('2d')!;
    ectx.drawImage(src, 0, 0);
    ectx.fillStyle = 'rgba(28,25,23,0.94)'; // stone-800
    ectx.fillRect(0, src.height, ec.width, stripH);
    ectx.fillStyle = '#ffffff';
    ectx.font = `${fs}px system-ui, sans-serif`;
    ectx.textBaseline = 'top';
    let y = src.height + pad;
    for (const line of labelLines) {
      ectx.fillText(line, pad, y);
      y += lineH;
    }
    ectx.fillStyle = '#d6d3d1'; // stone-300
    ectx.fillText(metaLine, pad, y + 2);
    ec.toBlob((blob) => {
      if (!blob) {
        toast({ title: 'Izvoza ni bilo mogoče pripraviti', variant: 'destructive' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fotomontaza-${result.meta.profileId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: 'PNG izvožen ✓', description: 'Oznaka za predstavitev je žigosana v sliki.' });
    }, 'image/png');
  };

  // ── Korak 7: izvoz pred/po para (kandidat #2 iz raziskave Task 63) ──
  // PRED = NESPREMENJEN original (originalCanvasRef), PO = kompozit. Isti izvozni
  // prehod iskrenosti kot enojni izvoz (canExportResult) in isti žig (EXPORT_LABEL,
  // enoten vir resnice). Brez originala v sejanu → iskrena napaka (ne ugibamo).
  const onExportCompare = () => {
    if (!result) return;
    const before = originalCanvasRef.current;
    const after = resultCanvasRef.current;
    if (!before || !after) {
      toast({
        title: 'Primerjava ni mogoča',
        description: 'Originalna fotografija ni naložena v tem sejanu — naloži fotko in upodobi različico znova (ali uporabi „Izvozi PNG\u201c samo za rezultat).',
        variant: 'destructive',
      });
      return;
    }
    const profile = ROKSAL_PROFILES.find((p) => p.id === result.meta.profileId) ?? null;
    const canRender = profile ? profileReadiness(profile).canRender : false;
    const chk = canExportResult(result.meta, { canRender });
    if (!chk.allowed) {
      setExportBlocked(chk.reason);
      toast({ title: 'Izvoz blokiran', description: chk.reason ?? undefined, variant: 'destructive' });
      return;
    }
    setExportBlocked(null);
    try {
      const opts = { pad: 12, dividerPx: 2, lineH: 17, fontSize: 13 };
      const meas = document.createElement('canvas').getContext('2d')!;
      meas.font = `${opts.fontSize}px system-ui, sans-serif`;
      // 1. prehod: širina ne obstaja od št. vrstic žiga → meri na širino postavitve
      const probe = computeCompareLayout(before.width, before.height, after.width, after.height, opts);
      const zigLines = wrapText(meas, EXPORT_LABEL, Math.max(200, probe.canvasW - 2 * opts.pad));
      // 2. prehod: prava postavitev z dejanskim številom vrstic
      const layout = computeCompareLayout(before.width, before.height, after.width, after.height, { ...opts, zigLineCount: zigLines.length });
      const labels = buildCompareLabels(result.meta);
      const ec = drawCompareExport({ before, after, layout, labels, zigLines, opts });
      ec.toBlob((blob) => {
        if (!blob) {
          toast({ title: 'Izvoza ni bilo mogoče pripraviti', variant: 'destructive' });
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = compareExportFilename(result.meta);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast({ title: 'Primerjava pred/po izvožena ✓', description: `Ena datoteka: PRED levo, PO desno, žigosano. (${compareExportFilename(result.meta)})` });
      }, 'image/png');
    } catch (err) {
      toast({ title: 'Izvoza ni bilo mogoče pripraviti', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  // ── Lastni nalagalnik (fallback, če kamera ni posnela) ──
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      // EXIF-varno (createImageBitmap 'from-image'), delovna kopija ≤ 1280 px JPEG 0,82
      const processed = await processImage(file);
      ownUpload.current = { dataUrl: processed.dataUrl };
      setUploadTick((t) => t + 1); // sproži ponovno nalaganje <img>/canvasov
    } catch {
      toast({ title: 'Datoteke ni bilo mogoče prebrati kot sliko.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  // ── Izris rezultata na zaslon (pred/po canvasa) ──
  // `result` v odvisnostih: ko se rezultat prvič upodobi, se mora TUDI
  // originalni prikazni canvas narisati (do takrat je stage sploh ni v DOM —
  // efekt ob samem imgEl se ne izvede znova → desna polovica primerjave bi
  // ostala prazna/abela).
  useEffect(() => {
    const cv = origDispRef.current;
    if (!cv || !imgEl) return;
    cv.width = imgEl.naturalWidth;
    cv.height = imgEl.naturalHeight;
    cv.getContext('2d')!.drawImage(imgEl, 0, 0);
  }, [imgEl, result]);

  useEffect(() => {
    const cv = resDispRef.current;
    if (!cv) return;
    const src = result ? resultCanvasRef.current : null;
    if (!src) {
      cv.width = 2;
      cv.height = 2;
      cv.getContext('2d')!.clearRect(0, 0, 2, 2);
      return;
    }
    cv.width = src.width;
    cv.height = src.height;
    cv.getContext('2d')!.drawImage(src, 0, 0);
  }, [result]);

  // ── UI pomožniki ──
  const quadComplete = quadPct !== null && quadPct.length === 4;
  const toolHint =
    tool === 'corners' && !quadComplete
      ? `Klikni ${['zgornji LEVI', 'zgornji DESNI', 'spodnji DESNI', 'spodnji LEVI'][cornerCount] ?? 'oglišče'} kot ravnine (${Math.min(cornerCount + 1, 4)}/4).`
      : tool === 'corners' && quadComplete
        ? planeConfirmed
          ? 'Oglišča lahko vlečeš za natančnost.'
          : 'Predlog je na zaslonu — preveri, da tirnici ležita na robu ograje, in ga potrdi (ali popravi z vlečenjem). Izris ostane zaprt, dokler ga ne potrdiš.'
        : tool === 'band'
          ? bandTaps && bandTaps.length === 1
            ? 'Klikni še DESNO stran ograje (na višini sredine trakova) — pas išče zgornji in spodnji rob vodoravno.'
            : 'Klikni LEVO in DESNO stran ograje, vsako na višini sredine trakova. Modul poišče zgornji in spodnji rob; levi in desni ostaneta tvoja klika.'
          : tool === 'measure'
          ? measurePts && measurePts.length === 2
            ? 'Izmerjeno — klikni še enkrat za novo meritev ali izberi predlog profila (korak 5).'
            : measurePts && measurePts.length === 1
              ? 'Klikni drugi rob deske (čez širino ENE deske, ne čez celo polje).'
              : 'Klikni prvi rob deske, ki jo želiš izmeriti.'
          : tool === 'brush'
            ? brushTarget === 'old'
              ? `Čopič (stara ograja): ${brushMode === 'add' ? 'dodaja' : 'odstranjuje'} označbo.`
              : `Čopič (ovire): ${brushMode === 'add' ? 'dodaja' : 'odstranjuje'} frontalne okluzije.`
            : tool === 'clone'
              ? cloneStage === 'source'
                ? 'Klikni izvorno točko na NEOKRNJENEM ozadju.'
                : 'Klikni ali vleci po cilju — žiga originalne piksle.'
              : 'Izberi orodje v korakih 2–5.';

  const cursorCls =
    tool === 'none' ? 'cursor-default' : tool === 'corners' ? 'cursor-crosshair' : tool === 'band' ? 'cursor-crosshair' : tool === 'measure' ? 'cursor-crosshair' : tool === 'clone' ? 'cursor-copy' : 'cursor-cell';

  return (
    <div className="space-y-4" data-testid="foto-replace">
      {/* ── KORAK 1: fotografija + prizorišče za označevanje ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">1</span>
              Fotografija
            </h3>
            {imgEl && dims && (
              <Badge variant="secondary" className="text-[10px]" data-testid="fr-dims">
                delovna kopija {dims.w}×{dims.h} px · original nespremenjen
              </Badge>
            )}
          </div>

          {!imgEl ? (
            <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
              <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {photo?.dataUrl
                  ? 'Zajeta fotografija se nalaga…'
                  : 'Ni zajete fotografije — naloži fotko stare ograje (ali posnemi novo v zavihku Zajem + analiza).'}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="fr-upload">
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? 'Obdelujem…' : 'Naloži fotografijo'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Delovna kopija: največ 1280 px, JPEG 0,82 (EXIF-varno prevučitev). Original ostane nespremenjen — izvod je samo za izvoz.
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-left text-xs text-muted-foreground" data-testid="fr-photo-tips">
                <li>Fotkaj v dnevni svetlobi, čim bolj čelno od ograje in dovolj odmaknjeno, da je celoten tek vidn.</li>
                <li>Izogibaj se močnim sencam čez ograjo ter avtom/odpadkom pred njo (ovire označi v koraku 3).</li>
                <li>Vedno posnameš tudi realno širino in višino ravnine (trak ali laser) — brez mer ni pravega merila (korak 2).</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <div
                ref={stageRef}
                className={`relative select-none overflow-hidden rounded-lg border bg-stone-100 touch-none ${cursorCls}`}
                onPointerDown={onStageDown}
                onPointerMove={onStageMove}
                onPointerUp={endStagePointer}
                onPointerLeave={endStagePointer}
                data-testid="fr-stage"
              >
                <canvas ref={stageCanvasRef} className="block w-full" />
                {/* oglišča + maske (SVG v % — enako kot foto-canvas point clicking) */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {quadPct && quadPct.length >= 2 && (
                    // nepotrjen predlog = črtkana obroba — ista zanka kot pri
                    // manjkajočih ogliščih, ker je stanje enako: še ne velja
                    <polygon
                      points={[...quadPct, ...(quadComplete ? [] : [quadPct[0]])].map(([x, y]) => `${x},${y}`).join(' ')}
                      fill="rgba(245,158,11,0.10)"
                      stroke="#d97706"
                      strokeWidth={quadComplete && planeConfirmed ? 1.5 : 1}
                      strokeDasharray={quadComplete && planeConfirmed ? undefined : '6 4'}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {/* dvotapni vnos (FAZA-9): klika leva/desna stran ograje */}
                  {bandTaps && bandTaps.length >= 1 && (
                    <g>
                      {bandTaps.map(([x, y], i) => (
                        <circle key={`bt${i}`} cx={x} cy={y} r={1.2} fill="#2563eb" stroke="white" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                  )}
                  {oldPolys.map((poly, i) => (
                    <polygon key={`om${i}`} points={poly.map(([x, y]) => `${x},${y}`).join(' ')} fill="rgba(245,158,11,0.42)" stroke="rgba(180,83,9,0.8)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  {frontPolys.map((poly, i) => (
                    <polygon key={`fm${i}`} points={poly.map(([x, y]) => `${x},${y}`).join(' ')} fill="rgba(68,64,60,0.55)" stroke="rgba(41,37,36,0.85)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  {/* merjenje deske (kandidat #3): črta + točki */}
                  {measurePts && measurePts.length >= 1 && (
                    <g>
                      {measurePts.map(([x, y], i) => (
                        <circle key={`mp${i}`} cx={x} cy={y} r={1.2} fill="#16a34a" stroke="white" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                      ))}
                      {measurePts.length === 2 && (
                        <line
                          x1={measurePts[0][0]} y1={measurePts[0][1]}
                          x2={measurePts[1][0]} y2={measurePts[1][1]}
                          stroke="#16a34a" strokeWidth="2" vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </g>
                  )}
                </svg>
                {/* ročice oglišč (samo vizualno — klik/vlek lovi prizorišče) */}
                {quadPct && tool === 'corners' && quadPct.map(([x, y], i) => (
                  <span
                    key={`h${i}`}
                    className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-600 shadow"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  />
                ))}
                {/* izvor kloniranja (križ) */}
                {cloneSrcUi && tool === 'clone' && (
                  <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(cloneSrcUi.x / (dims?.w ?? 1)) * 100}%`, top: `${(cloneSrcUi.y / (dims?.h ?? 1)) * 100}%` }}>
                    <span className="block h-5 w-0.5 -translate-x-[9px] bg-green-600" />
                    <span className="absolute top-[9px] left-0 block h-0.5 w-5 -translate-y-1/2 bg-green-600" />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="fr-tool-hint">{toolHint}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 2: ravnina stare ograje ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">2</span>
            Ravnina stare ograje
          </h3>
          <p className="text-sm text-muted-foreground">
            Klikni 4 oglisča ravnine ograje na fotografiji (zgornji levi → zgornji desni → spodnji desni → spodnji levi),
            ali uporabi »Predlog ravnine« in klikni samo levo ter desno stran ograje — zgornji in spodnji rob poišče iz fotke.
            Nato vnesi REALNO širino in višino ravnine v cm — perspektiva novih elementov sledi tem merama.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={tool === 'corners' ? 'default' : 'outline'} onClick={() => { setTool('corners'); }} data-testid="fr-tool-corners">
              {quadComplete ? 'Premakni oglisča' : 'Označi oglisča'}
            </Button>
            <Button
              size="sm"
              variant={tool === 'band' ? 'default' : 'outline'}
              onClick={() => { setBandTaps(null); setTool('band'); }}
              disabled={!imgEl}
              data-testid="fr-tool-band"
              title="Dva klika: leva in desna stran ograje. Zgornji in spodnji rob poišče modul — predlog moraš še potrditi."
            >
              Predlog ravnine (2 klika)
            </Button>
            <Button size="sm" variant="ghost" onClick={resetQuad} data-testid="fr-reset-quad">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Ponastavi oglisča
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={demoQuad} data-testid="fr-demo-quad" title="Testni pripomoček: deterministični sredinski pas">
              Demo kvadrant (test)
            </Button>
            <Badge variant={quadComplete ? 'default' : 'secondary'} className="text-[10px]" data-testid="fr-quad-status">
              {quadComplete
                ? planeConfirmed
                  ? 'ravnina označena (4/4)'
                  : 'predlog (4/4) — ŠE NI potrjen'
                : `oglišča: ${cornerCount}/4`}
            </Badge>
          </div>

          {/* Potrditev predloga (FAZA-9): vrata izrisa odpre samo človek, nikoli modul. */}
          {quadComplete && !planeConfirmed && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid="fr-suggest-confirm">
              <p className="text-xs text-amber-900">
                Ravnina je <strong>samodejni predlog</strong> iz zgornje in spodnje tirnice fotke. Povprečna
                zanesljivost robov: {bandInfo ? `zgornja ${(bandInfo.top.support * 100).toFixed(0)} %, spodnja ${(bandInfo.bottom.support * 100).toFixed(0)} %` : 'ni na voljo'}.
                Izris je zaprt, dokler oglišč ne pogledaš in potrdiš — predlog ne ve, ali je na sliki sploh ograja.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={confirmSuggestion} data-testid="fr-confirm-suggestion">
                  Potrdi predlog
                </Button>
                <Button size="sm" variant="outline" onClick={resetQuad} data-testid="fr-reject-suggestion">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Označi ročno
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">Širina ravnine (cm)</span>
              <Input
                type="number"
                inputMode="decimal"
                min={20}
                step={1}
                placeholder="npr. 500"
                value={wCm}
                onChange={(e) => setWCm(e.target.value)}
                data-testid="fr-plane-w"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Višina ravnine (cm)</span>
              <Input
                type="number"
                inputMode="decimal"
                min={20}
                step={1}
                placeholder="npr. 120"
                value={hCm}
                onChange={(e) => setHCm(e.target.value)}
                data-testid="fr-plane-h"
              />
            </label>
          </div>

          {planeCm && planeCm.wCm === null ? (
            <div className="space-y-1 rounded-lg border border-green-200 bg-green-50 p-3">
              <Badge
                className={cn(statusColor('AUTO_SUGGESTED').badge, 'whitespace-normal text-left leading-snug')}
                data-testid="fr-plane-status"
              >
                Širina ravnine NI izmerjena
              </Badge>
              <p className="text-xs text-green-900">
                {quadComplete
                  ? <>Geometrija: {planeConfirmed ? 'potrjena (4 oglišča)' : 'PREDLAGANA in še NE potrjena'} · merilo: samo izmerjena višina ravnine ({fmtN(planeCm.hCm, 0)} cm).
                    Širine ni izmeril nihče, zato je ne prikazujemo kot mero.
                    Izris: {renderPromiseHint(renderPromise)} — naročilnica: {canExportOrder(assurance.geo, assurance.met) ? 'mogoča' : 'NI mogoča'} (pravilo 11 in 14, FAZA-8).</>
                  : <>Višina je izmerjena ({fmtN(planeCm.hCm, 0)} cm), širina ne, oglišča pa še niso dokončana (manj kot 4/4) —
                    zato ni ne geometrije ne mere. Označi 4 oglisča.</>}
              </p>
            </div>
          ) : planeCm && quadComplete && !planeConfirmed ? (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Badge className={geometryColor('SUGGESTED').badge} data-testid="fr-plane-status">
                {geometryLabel('SUGGESTED')}
              </Badge>
              <p className="text-xs text-amber-900">
                {geometryHint('SUGGESTED')} Vneseni meri ({fmtN(planeCm.wCm, 0)}×{fmtN(planeCm.hCm, 0)} cm) sta resnični, a
                perspektiva še NI umerjena — predlog ravnine lahko leži na napačni črti. Potrdi predlog ali označi oglišča
                sam: izris {renderPromiseHint(renderPromise)}, naročilnica{' '}
                {canExportOrder(assurance.geo, assurance.met) ? 'mogoča' : 'NI mogoča'} (pravilo 11 in 14, FAZA-8).
              </p>
            </div>
          ) : planeCm && quadComplete ? (
            <div className="space-y-1 rounded-lg border border-green-200 bg-green-50 p-3">
              <Badge className={statusColor('CALIBRATED').badge} data-testid="fr-plane-status">
                {statusLabel('CALIBRATED')} · znane mere
              </Badge>
              <p className="text-xs text-green-900">
                {statusHint('CALIBRATED')} Perspektiva sledi vnesenima merama ravnine ({fmtN(planeCm.wCm, 0)}×{fmtN(planeCm.hCm, 0)} cm)
                — metoda: znane mere, transformacija: ravninska homografija (4 oglišča).
              </p>
            </div>
          ) : (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Badge className="border-amber-300 bg-amber-100 text-amber-800" data-testid="fr-plane-missing">Ni kalibracije</Badge>
              <p className="text-xs text-amber-900">
                Brez realnih mer ravnine nova ograja NE bo upodobljena v pravem merilu — vnesi širino in višino (iz traku ali laserja).
              </p>
            </div>
          )}

          {layoutInfo.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="fr-quad-error">
              {layoutInfo.error}
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 3: maska stare ograje + frontalni okluziji ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">3</span>
            Označi staro ograjo (maska)
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onAutoSuggest} disabled={!quadPx} data-testid="fr-auto-suggest">
              <Paintbrush className="mr-2 h-4 w-4" />
              Samodejno predlagaj
            </Button>
            {autoInfo && (
              <Badge variant="secondary" className="text-[10px]" data-testid="fr-auto-note">
                zanesljivost {Math.round(autoInfo.confidence * 100)} %
              </Badge>
            )}
          </div>
          {autoInfo && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" data-testid="fr-auto-note-text">
              {autoInfo.note} Hevristika NIKOLI ni popolna — obvezno preveri in popravi s čopičem.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Cilj:</span>
            <Button
              size="sm"
              variant={brushTarget === 'old' ? 'default' : 'outline'}
              onClick={() => { setBrushTarget('old'); setTool('brush'); }}
              data-testid="fr-target-old"
            >
              Stara ograja
            </Button>
            <Button
              size="sm"
              variant={brushTarget === 'front' ? 'default' : 'outline'}
              onClick={() => { setBrushTarget('front'); setTool('brush'); }}
              data-testid="fr-target-front"
            >
              Ovire pred ograjo
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Način:</span>
            <Button
              size="sm"
              variant={brushMode === 'add' ? 'default' : 'outline'}
              onClick={() => { setBrushMode('add'); setTool('brush'); }} // cilj (stara ograja/ovire) OSTANE kot je
              data-testid="fr-brush-add"
            >
              {brushTarget === 'front' ? 'Dodaj oviro' : 'Dodaj'}
            </Button>
            <Button
              size="sm"
              variant={brushMode === 'remove' ? 'default' : 'outline'}
              onClick={() => { setBrushMode('remove'); setTool('brush'); }} // cilj (stara ograja/ovire) OSTANE kot je
              data-testid="fr-brush-remove"
            >
              {brushTarget === 'front' ? 'Odstrani oviro' : 'Odstrani'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setBrushMode('add'); setTool('brush'); }} title="Preklopi na dodajanje">
              <Paintbrush className="h-3.5 w-3.5" />
            </Button>
          </div>

          <label className="block space-y-1 sm:max-w-xs">
            <span className="text-xs font-medium">Velikost čopiča: {brushSize} px</span>
            <input
              type="range"
              min={4}
              max={40}
              step={2}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full accent-amber-600"
              data-testid="fr-brush-size"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="fr-coverage">
            <span>
              Pokritost čez štirikotnik:{' '}
              <strong className="text-foreground">{oldQuadCov === null ? '—' : `${Math.round(oldQuadCov * 100)} %`}</strong>
            </span>
            <span>
              Ovire (delež fotke): <strong className="text-foreground">{Math.round(frontCov * 100)} %</strong>
            </span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => clearMask('old')}>Počisti masko</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => clearMask('front')}>
                <Eraser className="mr-1 h-3 w-3" />
                Počisti ovire
              </Button>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Rumena = stara ograja (bo odstranjena). Temno siva = frontalni okluziji PRED ograjo (rastline, zid, rešetka) — ostanejo na fotki. Obei maski sta v ločljivosti delovne kopije.
          </p>
        </div>
      </div>

      {/* ── KORAK 4: klasična obnova ozadja ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">4</span>
            Odstrani staro ograjo (klasična obnova)
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onInpaint} disabled={!oldMaskRef.current || busyInpaint || !quadPx} data-testid="fr-inpaint">
              {busyInpaint ? 'Obnavljam…' : 'Odstrani staro ograjo'}
            </Button>
            <Button size="sm" variant="outline" onClick={onUndoRepair} disabled={!inpaintRes} data-testid="fr-undo">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Razveljavi obnovo
            </Button>
          </div>

          {inpaintRes && (
            <div className="space-y-1" data-testid="fr-inpaint-status">
              {inpaintRes.status === 'ok' && (
                <div className="space-y-1 rounded-lg border border-green-200 bg-green-50 p-3">
                  <Badge className="border-green-300 bg-green-100 text-green-800">Ozadje obnovljeno</Badge>
                  <p className="text-xs text-green-900">
                    Ozadje je zapolnjeno z linearno interpolacijo mejnih pikslov ({inpaintRes.repairedPx.toLocaleString('sl-SI')} pikslov,
                    pokritost maske {Math.round(inpaintRes.coverage * 100)} % fotke).
                  </p>
                </div>
              )}
              {inpaintRes.status === 'partial' && (
                <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <Badge className="border-amber-300 bg-amber-100 text-amber-800">Delno obnovljeno</Badge>
                  <p className="text-xs text-amber-900">{inpaintRes.manualHint}</p>
                </div>
              )}
              {inpaintRes.status === 'manual-required' && (
                <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <Badge variant="destructive">Zahteva ročni popravek</Badge>
                  <p className="text-xs text-destructive">{inpaintRes.manualHint}</p>
                  <p className="text-xs text-muted-foreground">Uporabi kloniranje spodaj — ozadja NE izmišljujemo (iskrenost).</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Ročni popravek ozadja (kloniraj):</span>
            <Button
              size="sm"
              variant={tool === 'clone' && cloneStage === 'source' ? 'default' : 'outline'}
              onClick={() => { setTool('clone'); setCloneStage('source'); }}
              data-testid="fr-clone-source"
            >
              1) Nastavi izvor
            </Button>
            <Button
              size="sm"
              variant={tool === 'clone' && cloneStage === 'stamp' ? 'default' : 'outline'}
              disabled={!cloneSrcUi}
              onClick={() => { setTool('clone'); setCloneStage('stamp'); }}
              data-testid="fr-clone-stamp"
            >
              2) Žig
            </Button>
            {cloneSrcUi && (
              <Badge variant="secondary" className="text-[10px]">
                izvor: {cloneSrcUi.x}, {cloneSrcUi.y} px
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Žig prekopira ORIGINALNE (pred obnovo) piksle z odmikom cilj − izvor — deterministično, brez generiranja.
            Originalna fotografija je vedno nespremenjena; vse izdaje so na delovni kopiji.
          </p>
        </div>
      </div>

      {/* ── KORAK 5: nova ograja iz ROKSAL profilov ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">5</span>
            Nova ograja iz ROKSAL profilov
          </h3>

          {/* Kandidat #3 (Task 66): izmeri obstoječo desko → predlog najbližjega profila */}
          <div className="space-y-2 rounded-lg border border-green-200 bg-green-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={tool === 'measure' ? 'default' : 'outline'}
                disabled={!imgEl || !measurePlane}
                onClick={() => { setTool('measure'); }}
                data-testid="fr-measure-btn"
              >
                <Ruler className="mr-2 h-4 w-4" />
                Izmeri obstoječo desko na fotki
              </Button>
              <span className="text-xs text-muted-foreground">
                Klikni 2 roba ENE deske na kalibrirani ravnini → sistem predlaga najbližje uradne profile.
              </span>
            </div>
            {!imgEl || !measurePlane ? (
              <p className="text-xs text-amber-900" data-testid="fr-measure-need">
                {planeCm && planeCm.wCm === null
                  ? 'Merjenje deske potrebuje TUDI izmerjeno širino ravnine (izris je geometrijsko potrjen, mere pa ni). Vpiši širino ali izmeri eno dolžino — brez cm na ravnini razdalja v pikslih ni mera.'
                  : 'Merjenje potrebuje fotografijo + kalibrirano ravnino (korak 2: oglisča + realni meri) — sicer izmera ne bi bila prava.'}
              </p>
            ) : measureSuggest.error ? (
              <p className="text-xs text-destructive" role="alert" data-testid="fr-measure-error">{measureSuggest.error}</p>
            ) : measureSuggest.suggest && measureSuggest.distanceCm !== null ? (
              <div className="space-y-2" data-testid="fr-suggest-panel">
                <p className="text-xs font-semibold text-green-900" data-testid="fr-measure-result">
                  Izmerjena širina deske: {fmtNum(measureSuggest.distanceCm, 1)} cm — najbližji profili:
                </p>
                {measureSuggest.suggest.warnings.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-900" data-testid="fr-measure-warnings">
                    {measureSuggest.suggest.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                  </ul>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {measureSuggest.suggest.suggestions.map((s) => {
                    const vars = measureSuggest.suggest?.variants[s.profile.id] ?? [];
                    const r = profileReadiness(s.profile);
                    return (
                      <button
                        key={s.profile.id}
                        type="button"
                        disabled={!r.canRender}
                        onClick={() => { setProfileId(s.profile.id); setTool('corners'); }}
                        data-testid={`fr-suggest-${s.profile.id}`}
                        className={`min-w-0 rounded-lg border p-2.5 text-left transition-colors ${
                          profileId === s.profile.id ? 'border-amber-600 bg-amber-50 ring-1 ring-amber-600' : 'hover:border-amber-600 hover:bg-white'
                        } ${r.canRender ? '' : 'cursor-not-allowed opacity-60'}`}
                      >
                        <span className="block truncate text-xs font-semibold">{s.profile.label}</span>
                        <Badge
                          className={`mt-1 h-auto py-0.5 whitespace-normal break-words text-left text-[10px] ${
                            s.quality === 'exact'
                              ? 'border-green-300 bg-green-100 text-green-800'
                              : s.quality === 'close'
                                ? 'border-amber-300 bg-amber-100 text-amber-800'
                                : 'border-stone-300 bg-stone-100 text-stone-700'
                          }`}
                          data-testid={`fr-suggest-quality-${s.profile.id}`}
                        >
                          {suggestionText(s)}
                        </Badge>
                        {vars.length > 1 && (
                          <span className="mt-1 block text-[10px] text-muted-foreground">{vars.length} barvnih različic istega profila</span>
                        )}
                        {!r.canRender && (
                          <span className="mt-1 block text-[10px] text-destructive">{r.honestyLabel}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground" data-testid="fr-suggest-disclaimer">
                  Predlog je najbližji profil po ŠIRINI — enakost mere NE dokazuje istovetnosti (obstoječa ograja je lahko
                  druga znamka). Pred zamudno naročilom preveri material, presek in debelino. Klik predloga ga izbere (enako kot mreža spodaj).
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {ROKSAL_PROFILES.map((p) => {
              const r = profileReadiness(p);
              // žig reže: številka v katalogu je lahko ROKSALova objava ALI
              // privzetek izračuna — kartica mora povedati, katera (Task 82).
              const gapStamp = boardGapStamp(p.id);
              const tex = assetById(p.textureId);
              const selected = profileId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!r.canRender}
                  onClick={() => setProfileId(p.id)}
                  data-testid={`fr-profile-${p.id}`}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selected ? 'border-amber-600 bg-amber-50 ring-1 ring-amber-600' : 'hover:bg-secondary/50'
                  } ${r.canRender ? '' : 'cursor-not-allowed opacity-60'}`}
                >
                  <span className="flex items-start gap-3">
                    {tex?.src ? (
                      <img src={tex.src} alt={tex.label} className="h-11 w-11 shrink-0 rounded-md border object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-stone-100 text-[9px] text-stone-500">brez gradiva</span>
                    )}
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block truncate text-sm font-semibold">{p.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        element {fmtN(p.plankCm, p.plankCm < 2 ? 1 : 0)} cm · reža {fmtN(p.gapCm, 1)} cm · {p.orientation === 'horizontal' ? 'vodoravno' : 'navpično'} · steber {fmtN(p.postCm, 1)} cm
                      </span>
                      <span
                        className={`block text-[10px] ${gapStamp.published ? 'text-green-700' : 'text-amber-700'}`}
                        data-testid={`fr-gap-stamp-${p.id}`}
                      >
                        reža: {gapStamp.stamp}
                      </span>
                      <Badge
                        className={`h-auto py-0.5 whitespace-normal break-words text-left ${
                          r.honestyLabel.startsWith('Gradivo manjka')
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : r.isOriginal
                              ? 'border-green-300 bg-green-100 text-green-800'
                              : 'border-amber-300 bg-amber-100 text-amber-800'
                        }`}
                        data-testid={`fr-honesty-${p.id}`}
                      >
                        {r.honestyLabel}
                      </Badge>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Izvoznik izda NARAVNO fotografijo materiala, kjer original ROKSAL posnetek manjka — izvoz z oznako original je dokler gradivo manjka blokiran (iskrenost registra).
          </p>
        </div>
      </div>

      {/* ── KORAK 6: upodobi fotomontažo ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">6</span>
            Upodobi fotomontažo
          </h3>
          {baseRenderBlocker ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" data-testid="fr-render-blocker">
              {baseRenderBlocker}
            </p>
          ) : (
            <div className="space-y-2">
              {renderBlocker && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" data-testid="fr-render-blocker">
                  {renderBlocker}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!renderBlocker && (
                  <Button onClick={() => void onRender()} disabled={busyRender} data-testid="fr-render">
                    {busyRender ? 'Upodabljam…' : 'Upodobi'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => void onCompareProfiles()}
                  disabled={busyCompare || busyRender}
                  data-testid="fr-compare-all"
                >
                  {busyCompare ? 'Primerjam profile…' : 'Primerjaj profile na tej fotki'}
                </Button>
                <span className="text-xs text-muted-foreground">Ista ravnina + ista maska → vse omogočene barve/materiali za izbiro stranke.</span>
              </div>
            </div>
          )}

          {comparisons && (
            <div className="space-y-2" data-testid="fr-compare-grid">
              <p className="text-xs font-medium">
                Primerjava profilov ({comparisons.filter((c) => c.canRender).length} upodabljanj iz iste fotke):
              </p>
              <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                {comparisons.map((c) => (
                  <button
                    key={c.profileId}
                    type="button"
                    disabled={!c.canRender || !c.thumbUrl}
                    onClick={() => loadComparison(c)}
                    data-testid={`fr-cmp-${c.profileId}`}
                    className={`rounded-lg border p-2 text-left transition-colors ${
                      c.canRender ? 'hover:border-amber-600 hover:bg-amber-50/50' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    {c.thumbUrl ? (
                      <img src={c.thumbUrl} alt={c.label} className="aspect-[4/3] w-full rounded-md border object-cover" />
                    ) : (
                      <span className="flex aspect-[4/3] w-full items-center justify-center rounded-md border bg-stone-100 p-2 text-center text-[10px] text-stone-600">
                        {c.blockedReason ?? 'blokirano'}
                      </span>
                    )}
                    <span className="mt-1.5 block truncate text-xs font-semibold">{c.label}</span>
                    <Badge
                      className={`mt-1 h-auto py-0.5 whitespace-normal break-words text-left text-[10px] ${
                        c.honestyLabel.startsWith('Gradivo manjka')
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : c.honestyLabel.startsWith('Standardna')
                            ? 'border-amber-300 bg-amber-100 text-amber-800'
                            : 'border-green-300 bg-green-100 text-green-800'
                      }`}
                    >
                      {c.honestyLabel}
                    </Badge>
                    {c.canRender && (
                      <span className="mt-1 block text-[10px] text-muted-foreground">klikni → celotni pred/po prikaz</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Celotne upodobitve ostanejo v pomnilniku seje — klik naloži rezultat v pred/po pogled (korak 7). Vsak popravek
                fotke (čopič, kloniranje, oglisča, mere, ovire) primerjavo prekliče — znova jo pripravi na trenutnem stanju.
              </p>
            </div>
          )}

          {result && (
            <div className="space-y-3 pt-1">
              <div
                className="relative overflow-hidden rounded-lg border"
                data-testid="fr-result-stage"
                onPointerMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setLens({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, on: true });
                }}
                onPointerLeave={() => setLens((l) => ({ ...l, on: false }))}
              >
                <canvas ref={origDispRef} className="block w-full" />
                <canvas
                  ref={resDispRef}
                  className="absolute inset-0 block h-full w-full"
                  style={{ clipPath: `inset(0 ${100 - comparePct}% 0 0)` }}
                  data-testid="fr-result-canvas"
                />
                {lens.on && (
                  <span
                    className="pointer-events-none absolute h-28 w-28 rounded-full border-2 border-white shadow-lg"
                    data-testid="fr-zoom"
                    style={{
                      left: `calc(${lens.x * 100}% - 56px)`,
                      top: `calc(${lens.y * 100}% - 56px)`,
                      backgroundImage: `url(${result.dataUrl})`,
                      backgroundSize: '200% 200%',
                      backgroundPosition: `${lens.x * 100}% ${lens.y * 100}%`,
                    }}
                  />
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium">Pred / po (levi del = fotomontaža, desni = original): {comparePct} %</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={comparePct}
                  onChange={(e) => setComparePct(Number(e.target.value))}
                  className="w-full accent-amber-600"
                  data-testid="fr-compare"
                />
              </label>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ZoomIn className="h-3.5 w-3.5" />
                Detajl: pomakni kazalec po rezultatu — 2× povečevalno steklo sledi kazalcu.
              </p>

              <p className="text-xs text-muted-foreground" data-testid="fr-provenance">
                Perspektiva: ravnina {result.meta.planeCm.wCm === null ? `${fmtN(result.meta.planeCm.hCm, 0)} cm visoka, širina ni izmerjena` : `${fmtN(result.meta.planeCm.wCm, 0)}×${fmtN(result.meta.planeCm.hCm, 0)} cm`} · merilo vzdolž robov: zgornji {fmtN(result.aux.scaleTop, 3)} cm/px, spodnji {fmtN(result.aux.scaleBottom, 3)} cm/px · ambientna svetloba: faktor {fmtN(result.aux.factor)} ({result.aux.samples} vzorcev) · sence: {fmtN(result.aux.topAlpha)} / {fmtN(result.aux.bottomAlpha)}
              </p>

              {result.aux.warnings.length > 0 && (
                <ul className="space-y-1" data-testid="fr-warnings">
                  {result.aux.warnings.map((w) => (
                    <li key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 7: primerjava, detajl, različica ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">7</span>
            Primerjava, detajl, različica
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onSaveVersion} disabled={!result} data-testid="fr-save-version">
              <Save className="mr-1.5 h-4 w-4" />
              Shrani različico
            </Button>
            <Button size="sm" onClick={onExport} disabled={!result} data-testid="fr-export">
              <Download className="mr-1.5 h-4 w-4" />
              Izvozi PNG
            </Button>
            <Button size="sm" variant="outline" onClick={onExportCompare} disabled={!result} data-testid="fr-compare-export">
              <Columns2 className="mr-1.5 h-4 w-4" />
              Izvozi pred/po
            </Button>
            <Button size="sm" variant="outline" onClick={onAddBom} disabled={!result} data-testid="fr-bom">
              <ShoppingCart className="mr-1.5 h-4 w-4" />
              Material v ponudbo
            </Button>
            {result && (
              <Badge variant="secondary" className="text-[10px]" data-testid="fr-version-script">
                skripta v{result.meta.scriptVersion}
              </Badge>
            )}
          </div>
          {exportBlocked && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive" data-testid="fr-export-blocked">
              {exportBlocked}
            </p>
          )}

          {result && (
            <InstallerSheetPanel meta={result.meta} imageDataUrl={result.dataUrl} />
          )}

          {result && (
            <div className="space-y-1">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setMetaOpen((o) => !o)} data-testid="fr-meta-toggle">
                {metaOpen ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                Metapodatki različice (JSON)
              </Button>
              {metaOpen && (
                <pre className="max-h-72 overflow-auto rounded-lg border bg-stone-950 p-3 text-[10px] leading-relaxed text-stone-100" data-testid="fr-metadata">
                  {JSON.stringify(result.meta, null, 2)}
                </pre>
              )}
              <p className="text-[11px] text-muted-foreground">
                Enaki vhodi (enak createdAt) → identičen JSON — determinizem skripte v{PHOTO_REPLACE_SCRIPT_VERSION}.
              </p>
            </div>
          )}

          {versions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Shranjene različice ({versions.length}/{VERSIONS_CAP})</p>
              <ul className="space-y-1" data-testid="fr-versions">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => loadVersion(v)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                    >
                      <span className="truncate font-medium">{v.profileLabel}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString('sl-SI', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            0 AI — samo deterministične skripte: klasična obdelava slik (maske, interpolacija, kloniranje) + obstoječi izrisnik vzorcev iz vizualizerja.
          </p>
        </div>
      </div>
    </div>
  );
}
