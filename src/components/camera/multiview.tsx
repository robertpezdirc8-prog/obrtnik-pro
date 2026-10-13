'use client';

// ─── Večpogled — klasična fotogrametrija iz dveh fotk (Faza 3, Task 37-b) ──
// Voden tok v 5 korakih nad PAROM fotografij:
//  1. Dve fotki — nalaganje (delovni kopiji ≤ 1024 px, JPEG 0,85, EXIF-varno
//     prek createImageBitmap 'from-image') + izbira načina fokusa kamere
//     (selfcal / preset / known) z izrecno razlago pričakovanega statusa mere.
//  2. Povezave — Shi-Tomasi vogali + NCC deskriptorji + mutual-best ujemanja
//     → RANSAC fundamentalna matrika (jedro multiview-core.ts). Točke ujemajočih
//     parov in epipolarne črte se izrišejo v SVG overlay čez fotki.
//  3. Referenca — 2 točki na fotki A (samodejno povezani na epipolarni črti v B)
//     + znana dolžina v cm → measureFromPair → statusna pogodba (validateMultiView).
//  4. Meritve — dodatni kliki → 3D razdalje verige (sosednji pari) + vsa
//     opozorila jedra (vključno s skoraj ravninsko sceno) + ponastavitev.
//  5. Izvoz — JSON poročilo s provenance in trajnim žigom "pomožna meritev".
//
// 0 AI / 0 omrežij / 0 novih odvisnosti — samo deterministična geometrija
// (RANSAC vzorčenje prek lcg(42)). Iskrenost: vsak neuspeh je ekspliciten
// (NEZADOSTNI PODATKI … / code + opozorila v slovenščini), nič skritih
// privzetkov; izvoz je VEDNO označen kot pomožna meritev.
// localStorage ni uporabljen (to je merilno orodje, ne galerija različic).

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Download, Link2, ListPlus, RotateCcw, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { fnv1aHash, type ImgData, type XY } from '@/lib/photo-replace-core';
import { multiViewChainToMeasures, MULTIVIEW_SHEET_NOTE } from '@/lib/multiview-sheet';
import type { PhotoMeasure } from '@/lib/camera-types';
import {
  MULTIVIEW_SCRIPT_VERSION,
  buildDescriptors,
  estimateFundamental,
  findCorners,
  lcg,
  matchFeatures,
  matchPointOnEpipolar,
  measureFromPair,
  toGrayscale,
  type Corner,
  type MVMatch,
  type PairMeasureResult,
} from '@/lib/multiview-core';
import {
  MAX_MULTIVIEW_RESIDUAL_PX,
  MIN_MULTIVIEW_INLIERS,
  explainWarning,
  makeProvenance,
  statusColor,
  statusHint,
  statusLabel,
  validateMultiView,
  type ScaleValidation,
} from '@/lib/measurement-status';

// ─── Konstante ───────────────────────────────────────────────────

/** Največja dimenzija delovne kopije fotke (px). */
const MAX_WORK_DIM = 1024;
/** Kvaliteta JPEG delovne kopije. */
const JPEG_QUALITY = 0.85;
/** Radij iskanja korespondence na epipolarni črti (px). */
const EPIPOLAR_RADIUS_PX = 28;
/** Največ izrisanih točk ujemajočih parov na fotko (preglednost). */
const MAX_DRAWN_POINTS = 60;
/** Največ izrisanih epipolarnih črt na fotki B. */
const MAX_DRAWN_EPIPOLARS = 12;

type FocalMode = 'selfcal' | 'preset' | 'known';

const FOCAL_LABELS: Record<FocalMode, string> = {
  selfcal: 'Oceni iz fotk (orientacijsko)',
  preset: 'Tipičen telefon (0,72 × širina)',
  known: 'Znan fokus (EXIF)',
};

// ─── Tipi stanja ─────────────────────────────────────────────────

/** Delovna kopija fotke: prikazni dataURL + piksli za jedro. */
interface MvPhoto {
  url: string; // delovna kopija (JPEG 0,85, ≤ 1024 px) — original datoteka ni spreminjana
  data: ImgData; // piksli delovne kopije (canvas.getImageData) za jedro
  w: number;
  h: number;
}

/** Stanje iskanja povezav (korak 2) — vhod za vse kasnejše izračune. */
interface FindState {
  matches: MVMatch[];
  F: number[];
  /** Indeksi inlierjev — kazalci v `matches` (RANSAC jih določa nad pari). */
  inliers: number[];
  meanResidualPx: number;
  cornersA: Corner[];
  cornersB: Corner[];
  grayA: Float64Array;
  grayB: Float64Array;
  sizeA: { width: number; height: number };
  sizeB: { width: number; height: number };
}

/** Kliknjena točka: položaj na fotki A + samodejna korespondenca na fotki B. */
interface ClickedPoint {
  a: XY;
  b: XY;
}

/** Oštevilčen marker na odru. */
interface StageLabel {
  xPct: number;
  yPct: number;
  text: string;
  tone: 'amber' | 'green';
}

// ─── Pomožniki (deterministični) ─────────────────────────────────

const fmtN = (v: number, d = 1): string =>
  v.toLocaleString('sl-SI', { minimumFractionDigits: d, maximumFractionDigits: d });

const pctOf = (v: number, total: number): number => Math.round((v / total) * 10000) / 100;

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Slike ni bilo mogoče dekodirati.'));
    img.src = url;
  });
}

/**
 * EXIF-varno prevučitev datoteke na delovno kopijo ≤ 1024 px (JPEG 0,85)
 * + ImgData piksli za jedro (isto vedenje kot processImage v image-quality,
 * samo z delovno dimenzijo fotogrametrije 1024 px).
 */
async function loadWorkPhoto(file: File): Promise<MvPhoto> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D kontekst ni na voljo.');
    ctx.drawImage(bmp, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', JPEG_QUALITY);
    const px = ctx.getImageData(0, 0, w, h);
    const data: ImgData = { width: px.width, height: px.height, data: px.data };
    await loadImageEl(url); // zgodnja validacija, da je dataURL dekodirljiv
    return { url, data, w, h };
  } finally {
    bmp.close?.();
  }
}

/**
 * Epipolarna črta l = F·[x,y,1]ᵀ na fotki B, izrezana na rob slike (w×h):
 * presečišča s štirimi robovi → dve najbolj oddaljeni točki.
 * Null pri degenerirani črti (skoraj vse koeficiente 0) ali brez presečišč.
 */
function epipolarSegment(F: number[], x: number, y: number, w: number, h: number): [XY, XY] | null {
  const a = F[0] * x + F[1] * y + F[2];
  const b = F[3] * x + F[4] * y + F[5];
  const c = F[6] * x + F[7] * y + F[8];
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  if (!(Math.hypot(a, b) > 1e-9)) return null; // degenerirana črta → preskoči
  const pts: XY[] = [];
  const push = (px: number, py: number) => {
    if (!(px >= -0.5 && px <= w - 0.5 && py >= -0.5 && py <= h - 0.5)) return;
    for (const q of pts) {
      if (Math.abs(q.x - px) < 0.01 && Math.abs(q.y - py) < 0.01) return;
    }
    pts.push({ x: px, y: py });
  };
  if (Math.abs(b) > 1e-9) {
    push(0, -c / b);
    push(w - 1, (-(a * (w - 1)) - c) / b);
  }
  if (Math.abs(a) > 1e-9) {
    push(-c / a, 0);
    push((-(b * (h - 1)) - c) / a, h - 1);
  }
  if (pts.length < 2) return null;
  let best: [XY, XY] | null = null;
  let bestD = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
      if (d > bestD) {
        bestD = d;
        best = [pts[i], pts[j]];
      }
    }
  }
  return best;
}

/** Klik na odru → piksli delovne slike (prek getBoundingClientRect). */
function clickToImagePx(e: { clientX: number; clientY: number; currentTarget: HTMLElement }, w: number, h: number): XY {
  const r = e.currentTarget.getBoundingClientRect();
  const x = r.width > 0 ? ((e.clientX - r.left) / r.width) * w : 0;
  const y = r.height > 0 ? ((e.clientY - r.top) / r.height) * h : 0;
  return {
    x: Math.max(0, Math.min(w - 1, Math.round(x))),
    y: Math.max(0, Math.min(h - 1, Math.round(y))),
  };
}

// ─── Odru (fotka + SVG overlay + markerji) ───────────────────────

function MvStage({
  photo,
  testid,
  clickable,
  onClick,
  svg,
  labels,
  alt,
}: {
  photo: MvPhoto;
  testid: string;
  clickable?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  svg?: React.ReactNode;
  labels?: StageLabel[];
  alt: string;
}) {
  return (
    <div className="flex justify-center">
      <div
        className={`relative select-none overflow-hidden rounded-lg border bg-stone-100 ${clickable ? 'cursor-crosshair' : ''}`}
        onClick={onClick}
        data-testid={testid}
      >
        <img src={photo.url} alt={alt} draggable={false} className="block max-h-[420px] w-auto max-w-full" />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${photo.w} ${photo.h}`}
          aria-hidden="true"
        >
          {svg}
        </svg>
        {(labels ?? []).map((l, i) => (
          <span
            key={`lb-${i}`}
            className={`pointer-events-none absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-bold text-white shadow ${
              l.tone === 'amber' ? 'bg-amber-600' : 'bg-green-600'
            }`}
            style={{ left: `${l.xPct}%`, top: `${l.yPct}%` }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Komponenta ──────────────────────────────────────────────────

export function MultiView({ onAddMeasures }: { onAddMeasures?: (measures: PhotoMeasure[]) => void } = {}) {
  const { toast } = useToast();

  // ── Korak 1: fotki + fokus ──
  const [photoA, setPhotoA] = useState<MvPhoto | null>(null);
  const [photoB, setPhotoB] = useState<MvPhoto | null>(null);
  const [uploading, setUploading] = useState<'a' | 'b' | null>(null);
  const fileARef = useRef<HTMLInputElement>(null);
  const fileBRef = useRef<HTMLInputElement>(null);
  const [focalMode, setFocalMode] = useState<FocalMode>('selfcal');
  const [focalPxInput, setFocalPxInput] = useState('');

  // ── Korak 2: povezave ──
  const [find, setFind] = useState<FindState | null>(null);
  const [busyFind, setBusyFind] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  // ── Korak 3: referenca ──
  const [refPts, setRefPts] = useState<ClickedPoint[]>([]);
  const [refCm, setRefCm] = useState('');
  const [busyRef, setBusyRef] = useState(false);
  const [refConfirmed, setRefConfirmed] = useState(false);

  // ── Korak 4: meritve ──
  const [extraPts, setExtraPts] = useState<ClickedPoint[]>([]);
  const [result, setResult] = useState<PairMeasureResult | null>(null);
  const [busyMeasure, setBusyMeasure] = useState(false);

  // Zrcali seq za hitre zaporedne klike (dva klika v istem tiku ne smeta izgubiti točke).
  const refPtsRef = useRef<ClickedPoint[]>([]);
  const extraPtsRef = useRef<ClickedPoint[]>([]);

  const busy = busyFind || busyRef || busyMeasure;

  const refCmVal = useMemo<number | null>(() => {
    const v = Number(refCm.replace(',', '.'));
    return Number.isFinite(v) && v >= 10 ? v : null;
  }, [refCm]);

  /** Osnovni pari za geometrijo = RANSAC inlierji iz koraka 2 (isti indeks v obeh tabelah). */
  const basePairs = useMemo<{ a: XY[]; b: XY[] } | null>(() => {
    if (!find) return null;
    const a = find.inliers.map((k) => {
      const m = find.matches[k];
      const c = find.cornersA[m.ai];
      return { x: c.x, y: c.y };
    });
    const b = find.inliers.map((k) => {
      const m = find.matches[k];
      const c = find.cornersB[m.bi];
      return { x: c.x, y: c.y };
    });
    return { a, b };
  }, [find]);

  /** Informativna validacija geometrije (korak 2) — reference je še ni, zato "known". */
  const findVal = useMemo<ScaleValidation | null>(() => {
    if (!find) return null;
    return validateMultiView({
      inlierCount: find.inliers.length,
      meanResidualPx: find.meanResidualPx,
      focalMode,
      referenceKnown: true,
    });
  }, [find, focalMode]);

  const geomGood = !!find && find.inliers.length >= MIN_MULTIVIEW_INLIERS && find.meanResidualPx <= MAX_MULTIVIEW_RESIDUAL_PX;

  /** Status pogodbe za trenutni rezultat (značke meritev + izvoz). */
  const mvStatus = useMemo<ScaleValidation | null>(() => {
    if (!result) return null;
    return validateMultiView({
      inlierCount: result.inliers.length,
      meanResidualPx: result.meanResidualPx ?? Number.POSITIVE_INFINITY,
      focalMode,
      referenceKnown: true,
    });
  }, [result, focalMode]);

  // ── Ponastavitve tokov (iskrenost: zastareli izračuni se izbrišejo) ──
  const resetRefFlow = useCallback(() => {
    refPtsRef.current = [];
    extraPtsRef.current = [];
    setRefPts([]);
    setExtraPts([]);
    setResult(null);
    setRefConfirmed(false);
  }, []);

  // ── Nalaganje fotk (korak 1) ──
  const onFile = async (side: 'a' | 'b', file: File | undefined) => {
    if (!file) return;
    setUploading(side);
    try {
      const p = await loadWorkPhoto(file);
      if (side === 'a') setPhotoA(p);
      else setPhotoB(p);
      setFind(null);
      setFindError(null);
      resetRefFlow();
      toast({
        title: `Fotka ${side === 'a' ? 'A' : 'B'} naložena ✓`,
        description: `Delovna kopija ${p.w}×${p.h} px (≤ 1024 px, JPEG 0,85). Original ostane nespremenjen.`,
      });
    } catch {
      toast({ title: 'Datoteke ni bilo mogoče prebrati kot sliko.', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const onFocalChange = (m: FocalMode) => {
    setFocalMode(m);
    // rezultat je odvisen od fokusa → zastarel (referenčni kliki ostanejo)
    extraPtsRef.current = [];
    setExtraPts([]);
    setResult(null);
    setRefConfirmed(false);
  };

  // ── Korak 2: iskanje povezav (sinhroni izračun v setTimeout, da UI izriše) ──
  const onFind = () => {
    if (!photoA || !photoB || busy) return;
    setBusyFind(true);
    setFindError(null);
    resetRefFlow();
    setTimeout(() => {
      try {
        const grayA = toGrayscale(photoA.data);
        const grayB = toGrayscale(photoB.data);
        const cornersA = findCorners(grayA, photoA.w, photoA.h);
        const cornersB = findCorners(grayB, photoB.w, photoB.h);
        const descA = buildDescriptors(grayA, photoA.w, photoA.h, cornersA);
        const descB = buildDescriptors(grayB, photoB.w, photoB.h, cornersB);
        const matches = matchFeatures(
          cornersA,
          descA,
          cornersB,
          descB,
          { width: photoA.w, height: photoA.h },
          { width: photoB.w, height: photoB.h },
          { maxDisplacementPct: 25 },
        );
        if (matches.length < 8) {
          setFind(null);
          setFindError(
            `NEZADOSTNI PODATKI: premalo ujemajočih točk (${matches.length}). Posnemi fotki z večjim prekrivanjem in več strukture (brez praznih sten).`,
          );
          return;
        }
        const fr = estimateFundamental(
          photoA.w,
          photoA.h,
          photoB.w,
          photoB.h,
          matches.map((m) => ({ x: cornersA[m.ai].x, y: cornersA[m.ai].y })),
          matches.map((m) => ({ x: cornersB[m.bi].x, y: cornersB[m.bi].y })),
          lcg(42),
        );
        if (!fr) {
          setFind(null);
          setFindError(
            'NEZADOSTNI PODATKI: geometrija ujemajočih parov je degenerirana (npr. kolinearne točke ali ponavljajoč se vzorec) — fundamentalna matrika ni izračunljiva. Posnemi fotki z jasno 3D strukturo.',
          );
          return;
        }
        setFind({
          matches,
          F: fr.F,
          inliers: fr.inliers,
          meanResidualPx: fr.meanResidualPx,
          cornersA,
          cornersB,
          grayA,
          grayB,
          sizeA: { width: photoA.w, height: photoA.h },
          sizeB: { width: photoB.w, height: photoB.h },
        });
      } finally {
        setBusyFind(false);
      }
    }, 30);
  };

  /** Samodejna povezava klika na fotki A prek epipolarne črte; null → iskrena zavrnitev. */
  const matchClick = (p: XY): XY | null => {
    if (!photoA || !photoB || !find) return null;
    const m = matchPointOnEpipolar(
      find.grayA,
      find.sizeA.width,
      find.sizeA.height,
      p.x,
      p.y,
      find.grayB,
      find.sizeB.width,
      find.sizeB.height,
      find.F,
      { radiusPx: EPIPOLAR_RADIUS_PX },
    );
    return m ? { x: m.x, y: m.y } : null;
  };

  const rejectClick = () => {
    toast({
      title: 'Točke ni mogoče povezati z drugo fotko — klikni bližje jasni strukturi (oglji, spoji).',
      variant: 'destructive',
    });
  };

  // ── Korak 3: klik referenčnih točk ──
  const canClickRef = !!photoA && !!photoB && !!find && !busy && !refConfirmed && refPts.length < 2;

  const onRefClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canClickRef || !photoA) return;
    const p = clickToImagePx(e, photoA.w, photoA.h);
    const b = matchClick(p);
    if (!b) {
      rejectClick();
      return;
    }
    const next = refPtsRef.current.length >= 2 ? refPtsRef.current : [...refPtsRef.current, { a: p, b }];
    refPtsRef.current = next;
    setRefPts(next);
  };

  // ── Izračun meritve (measureFromPair) — referenca + dodatne točke ──
  // ptsA/ptsB: NAJPREJ ujemajoči kornerski pari (inlierji iz koraka 2), nato
  // referenčni točki (indeksa base.n in base.n+1), na KONEC dodatne meritvene
  // točke — isti indeks v obeh tabelah (par = isti fizikalni točki).
  const computeMeasure = useCallback(
    (extras: ClickedPoint[]): PairMeasureResult | null => {
      if (!photoA || !photoB || !basePairs || refPts.length !== 2 || refCmVal === null) return null;
      const ptsA: XY[] = [...basePairs.a, refPts[0].a, refPts[1].a, ...extras.map((p) => p.a)];
      const ptsB: XY[] = [...basePairs.b, refPts[0].b, refPts[1].b, ...extras.map((p) => p.b)];
      const refAi = basePairs.a.length;
      const extraStart = refAi + 2;
      // veriga: razdalje med SODEDNJIMI dodatnimi točkami (M1–M2, M2–M3, …)
      const queries = extras.slice(0, -1).map((_, k) => ({ ai: extraStart + k, bi: extraStart + k + 1 }));
      const focalPx =
        focalMode === 'known'
          ? Number(focalPxInput.replace(',', '.'))
          : focalMode === 'preset'
            ? 0.72 * Math.max(photoA.w, photoB.w)
            : null;
      return measureFromPair({
        wA: photoA.w,
        hA: photoA.h,
        wB: photoB.w,
        hB: photoB.h,
        ptsA,
        ptsB,
        rand: lcg(42),
        focalMode,
        focalPx,
        reference: { ai: refAi, bi: refAi + 1, cm: refCmVal },
        queries,
      });
    },
    [photoA, photoB, basePairs, refPts, refCmVal, focalMode, focalPxInput],
  );

  const canConfirmRef = !!photoA && !!photoB && !!find && !!basePairs && basePairs.a.length >= 8 && refPts.length === 2 && refCmVal !== null && !busy;

  const onRefConfirm = () => {
    if (!canConfirmRef) return;
    setBusyRef(true);
    setTimeout(() => {
      try {
        const res = computeMeasure([]);
        setResult(res);
        setExtraPts([]);
        const val = res
          ? validateMultiView({
              inlierCount: res.inliers.length,
              meanResidualPx: res.meanResidualPx ?? Number.POSITIVE_INFINITY,
              focalMode,
              referenceKnown: true,
            })
          : null;
        setRefConfirmed(!!res && res.ok && !!val && val.ok);
      } finally {
        setBusyRef(false);
      }
    }, 30);
  };

  // ── Korak 4: klik merilnih točk + ponovni izračun verige ──
  const canClickMeasure = refConfirmed && !!photoA && !busy;

  const onMeasureClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canClickMeasure || !photoA) return;
    const p = clickToImagePx(e, photoA.w, photoA.h);
    const b = matchClick(p);
    if (!b) {
      rejectClick();
      return;
    }
    const extras = [...extraPtsRef.current, { a: p, b }];
    extraPtsRef.current = extras;
    setExtraPts(extras);
    setBusyMeasure(true);
    setTimeout(() => {
      try {
        setResult(computeMeasure(extras));
      } finally {
        setBusyMeasure(false);
      }
    }, 30);
  };

  const onResetMeasures = () => {
    if (busy) return;
    extraPtsRef.current = [];
    setExtraPts([]);
    setBusyMeasure(true);
    setTimeout(() => {
      try {
        setResult(computeMeasure([])); // referenca ostane
      } finally {
        setBusyMeasure(false);
      }
    }, 30);
  };

  // ── Korak 5: izvoz JSON poročila ──
  const canExport = !!result && result.ok && !!photoA && !!photoB && refPts.length === 2 && refCmVal !== null;

  const onExport = () => {
    if (!canExport || !result || !result.F || !photoA || !photoB || !mvStatus || mvStatus.status === null) return;
    const now = new Date().toISOString();
    const chain = result.distancesCm ?? [];
    const sum = Math.round(chain.reduce((s, d) => s + d.cm, 0) * 10) / 10;
    const refPct = {
      A: refPts.map((p) => [pctOf(p.a.x, photoA.w), pctOf(p.a.y, photoA.h)] as [number, number]),
      B: refPts.map((p) => [pctOf(p.b.x, photoB.w), pctOf(p.b.y, photoB.h)] as [number, number]),
    };
    const report = {
      scriptVersion: MULTIVIEW_SCRIPT_VERSION,
      vrsta: 'VECPogled-TRIANGULACIJA',
      oznaka: 'VIZUALIZACIJA / POMOŽNA MERITEV — za proizvodno mero preveri s trakom ali laserjem',
      fotke: { wA: photoA.w, hA: photoA.h, wB: photoB.w, hB: photoB.h },
      fokus: { mode: focalMode, focalPx: result.focalPx, selfCal: result.focalSelfCal },
      geometrija: {
        inliers: result.inliers.length,
        meanResidualPx: result.meanResidualPx,
        FHash: fnv1aHash(new TextEncoder().encode(result.F.map((v) => v.toFixed(6)).join(','))),
      },
      status: mvStatus,
      reference: { cm: refCmVal, točki: refPct },
      meritve: chain.map((d) => ({ i: d.i, j: d.j, cm: d.cm, status: mvStatus.status })),
      warnings: result.warnings,
      provenance: makeProvenance({
        method: 'multi-view',
        status: mvStatus.status ?? 'AUTO_SUGGESTED',
        valueCm: chain.length > 0 ? sum : null,
        points: refPct.A.map(([x, y]) => ({ x, y })),
        reference: { valueCm: refCmVal, label: 'multi-view referenca', assumed: focalMode !== 'known' },
        createdAt: now,
        note: 'Triangulacija iz dveh fotk',
      }),
      createdAt: now,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `vecpogled-porocilo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast({ title: 'Poročilo izvoženo ✓', description: 'Pomožna meritev — za proizvodnjo preveri s trakom/laserjem.' });
  };

  // ── SVG vsebine overlayov ──
  const matchCircles = (which: 'a' | 'b'): React.ReactNode => {
    if (!find) return null;
    const corners = which === 'a' ? find.cornersA : find.cornersB;
    const inlierSet = new Set(find.inliers);
    return find.matches.slice(0, MAX_DRAWN_POINTS).map((m, k) => {
      const c = corners[which === 'a' ? m.ai : m.bi];
      return (
        <circle
          key={`mp-${which}-${k}`}
          cx={c.x}
          cy={c.y}
          r={7}
          fill={inlierSet.has(k) ? 'rgba(22,163,74,0.85)' : 'rgba(120,113,108,0.55)'}
          stroke="#ffffff"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      );
    });
  };

  const epipolarLines = (): React.ReactNode => {
    if (!find) return null;
    return find.inliers.slice(0, MAX_DRAWN_EPIPOLARS).map((k) => {
      const m = find.matches[k];
      const c = find.cornersA[m.ai];
      const seg = epipolarSegment(find.F, c.x, c.y, find.sizeB.width, find.sizeB.height);
      if (!seg) return null; // črta skoraj vzporedna robu → preskoči
      return (
        <line
          key={`ep-${k}`}
          x1={seg[0].x}
          y1={seg[0].y}
          x2={seg[1].x}
          y2={seg[1].y}
          stroke="rgba(234,88,12,0.8)"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      );
    });
  };

  const refLabels = (which: 'a' | 'b'): StageLabel[] => {
    const p = which === 'a' ? photoA : photoB;
    if (!p) return [];
    return refPts.map((pt, i) => ({
      xPct: pctOf(which === 'a' ? pt.a.x : pt.b.x, p.w),
      yPct: pctOf(which === 'a' ? pt.a.y : pt.b.y, p.h),
      text: String(i + 1),
      tone: 'amber' as const,
    }));
  };

  const extraLabels = (which: 'a' | 'b'): StageLabel[] => {
    const p = which === 'a' ? photoA : photoB;
    if (!p) return [];
    return extraPts.map((pt, i) => ({
      xPct: pctOf(which === 'a' ? pt.a.x : pt.b.x, p.w),
      yPct: pctOf(which === 'a' ? pt.a.y : pt.b.y, p.h),
      text: `M${i + 1}`,
      tone: 'green' as const,
    }));
  };

  const refLineA = (): React.ReactNode => {
    if (refPts.length !== 2) return null;
    return (
      <line
        x1={refPts[0].a.x}
        y1={refPts[0].a.y}
        x2={refPts[1].a.x}
        y2={refPts[1].a.y}
        stroke="#d97706"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    );
  };

  const chainLinesA = (): React.ReactNode =>
    extraPts.slice(0, -1).map((p, k) => {
      const q = extraPts[k + 1];
      return (
        <line
          key={`ch-${k}`}
          x1={p.a.x}
          y1={p.a.y}
          x2={q.a.x}
          y2={q.a.y}
          stroke="rgba(68,64,60,0.75)"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      );
    });

  // ── Skupni izračuni za prikaz meritev ──
  const chain = result?.distancesCm ?? [];
  const chainSum = chain.reduce((s, d) => s + d.cm, 0);
  const errPxFor = (idx: number): number | null => result?.points3D?.find((p) => p.i === idx)?.errPx ?? null;

  // ── Faza 4: veriga → merilni list (glavni tok, brez vzporednega jedra) ──
  const canAddSheet = canExport && chain.length > 0 && mvStatus?.status != null && !!onAddMeasures;
  const onAddToSheet = () => {
    if (!canAddSheet || !result || !mvStatus?.status) return;
    try {
      const rows = multiViewChainToMeasures({ distancesCm: result.distancesCm ?? [], status: mvStatus.status });
      if (rows.length === 0) return;
      onAddMeasures?.(rows);
      toast({
        title: `${rows.length} ${rows.length === 1 ? 'meritev dodana' : 'meritve dodane'} v merilni list ✓`,
        description: `Status ${statusLabel(mvStatus.status)} — pomožna meritev (za proizvodnjo preveri s trakom/laserjem).`,
      });
    } catch (err) {
      toast({
        title: 'Uvoz ni mogoč',
        description: err instanceof Error ? err.message : 'Neznana napaka.',
        variant: 'destructive',
      });
    }
  };

  const statusBadge = (s: ScaleValidation | null) => {
    const st = s?.status ?? null;
    if (!st) return null;
    return (
      <Badge className={`${statusColor(st).badge} text-[10px]`} data-testid="mv-status-badge">
        {statusLabel(st)}
      </Badge>
    );
  };

  return (
    <div className="space-y-4" data-testid="multiview">
      <p className="text-sm text-muted-foreground">
        Klasična fotogrametrija iz dveh fotk (0 AI): povezave med fotkami → fundamentalna matrika → fokus → 3D
        triangulacija → merilo po znani dolžini. Vsak neuspešni izračun je izrecno izpisan (NEZADOSTNI PODATKI …);
        izvoz je vedno označen kot <span className="font-medium text-amber-800">pomožna meritev</span>.
      </p>

      {/* ── KORAK 1: dve fotki + fokus ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">1</span>
            Dve fotki
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { side: 'a' as const, title: 'Fotka A — izhodiščni pogled', photo: photoA, fileRef: fileARef, tid: 'mv-upload-a' },
              { side: 'b' as const, title: 'Fotka B — drugi pogled', photo: photoB, fileRef: fileBRef, tid: 'mv-upload-b' },
            ]).map(({ side, title, photo, fileRef, tid }) => (
              <div key={side} className="space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{title}</span>
                  {photo && (
                    <Badge variant="secondary" className="text-[10px]">
                      delovna kopija {photo.w}×{photo.h} px
                    </Badge>
                  )}
                </div>
                {photo ? (
                  <img
                    src={photo.url}
                    alt={title}
                    draggable={false}
                    className="mx-auto max-h-72 w-auto max-w-full rounded border object-contain"
                  />
                ) : (
                  <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Ni naložene fotke.</p>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onFile(side, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading !== null || busy}
                  data-testid={tid}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading === side ? 'Obdelujem…' : photo ? 'Zamenjaj fotko' : 'Naloži fotko'}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Posnemi isti objekt z dveh mest: vsaj 60 % skupnega pogleda, večji kot med posnetkoma, FIKSNI zoom (ne
            ostri znova med posnetkoma).
          </p>

          <div className="space-y-2 rounded-lg border bg-secondary/40 p-3">
            <span className="text-xs font-semibold">Fokus kamere</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fokus kamere" data-testid="mv-focal-mode">
              {(['selfcal', 'preset', 'known'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={focalMode === m}
                  onClick={() => onFocalChange(m)}
                  disabled={busy}
                  className={`min-h-11 rounded-md border px-3 text-xs font-medium transition-colors ${
                    focalMode === m
                      ? 'border-amber-600 bg-amber-100 text-amber-900'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {FOCAL_LABELS[m]}
                </button>
              ))}
            </div>
            {focalMode === 'known' && (
              <label className="block space-y-1">
                <span className="text-xs font-medium">Fokus v pikslih (iz EXIF ali specifikacije naprave)</span>
                <Input
                  type="number"
                  min={1}
                  step="any"
                  inputMode="decimal"
                  value={focalPxInput}
                  onChange={(e) => setFocalPxInput(e.target.value)}
                  placeholder="npr. 3450"
                  className="min-h-11 max-w-56"
                  data-testid="mv-focal-px"
                />
              </label>
            )}
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Razlaga mere:
              {focalMode === 'known' ? (
                <Badge className="border-green-300 bg-green-100 text-green-800 text-[10px]">CALIBRATED — znan fokus</Badge>
              ) : (
                <Badge className="border-amber-300 bg-amber-100 text-amber-800 text-[10px]">
                  AUTO_SUGGESTED (orientacijska — fokus {focalMode === 'selfcal' ? 'ocenjen iz fotk' : 'preset telefona'})
                </Badge>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ── KORAK 2: povezave ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">2</span>
            Povezave (klasična fotogrametrija)
          </h3>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={onFind} disabled={!photoA || !photoB || busy} data-testid="mv-find">
                  <Link2 className="mr-2 h-4 w-4" />
                  Poišči povezave
                </Button>
                {busyFind && (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-transparent" aria-hidden="true" />
                    Iskanje povezav…
                  </span>
                )}
                {!photoA || !photoB ? (
                  <span className="text-xs text-muted-foreground">Najprej naloži obe fotki (korak 1).</span>
                ) : null}
              </div>

              {findError && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive" data-testid="mv-find-error">
                  {findError}
                </p>
              )}

              {find && (
                <div className="space-y-2 rounded-lg border bg-secondary/40 p-3" data-testid="mv-find-result">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">povezave</Badge>
                    <span className="text-sm font-semibold">
                      {find.inliers.length} inlierjev / {find.matches.length} parov
                    </span>
                    <span className="text-sm text-muted-foreground">srednja residuala: {fmtN(find.meanResidualPx, 1)} px</span>
                    {geomGood ? (
                      <Badge className="border-green-300 bg-green-100 text-green-800 text-[10px]">geometrija zadostna</Badge>
                    ) : (
                      <Badge className="border-amber-300 bg-amber-100 text-amber-800 text-[10px]">geometrija šibka</Badge>
                    )}
                  </div>
                  {findVal && !findVal.ok && (
                    <p className="text-xs text-amber-900">{explainWarning(findVal.code)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Zelena pika = RANSAC inlier, siva = ostali pari (največ {MAX_DRAWN_POINTS} za preglednost). Oranžne
                    črte na fotki B = epipolarne črte inlierjev iz fotke A (do {MAX_DRAWN_EPIPOLARS}): točka iz A mora
                    ležati na svoji črti v B.
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Kaj se računa</p>
              <p>
                Shi-Tomasi vogali + NCC ujemanja (mutual-best) → Hartley-normalizirani 8-točkovni algoritem + RANSAC
                (determinističen, lcg(42)) → Gauss–Newton rafiniranje fundamentalne matrike.
              </p>
              <p>Šibka geometrija (premalo inlierjev ali visoka residuala) blokira meritve — to je zahtevano, ne napaka.</p>
            </aside>
          </div>

          {find && photoA && photoB && (
            <div className="grid gap-3 sm:grid-cols-2">
              <MvStage
                photo={photoA}
                testid="mv-stage-a"
                alt="Fotka A s točkami ujemajočih parov"
                svg={matchCircles('a')}
                labels={[...refLabels('a'), ...extraLabels('a')]}
              />
              <MvStage
                photo={photoB}
                testid="mv-stage-b"
                alt="Fotka B s točkami ujemajočih parov in epipolarnimi črtami"
                svg={
                  <>
                    {matchCircles('b')}
                    {epipolarLines()}
                  </>
                }
                labels={[...refLabels('b'), ...extraLabels('b')]}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 3: referenca ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">3</span>
            Referenca (znana dolžina)
          </h3>

          {!find ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              Najprej poišči povezave med fotkama (korak 2) — brez fundamentalne matrike ni epipolarne geometrije.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                <p className="text-sm text-muted-foreground">
                  Klikni 2 točki na fotki A, katerih realna razdalja znaš (npr. robovi vrat, znani odsek ograje). Vsaka
                  točka se samodejno poveže na fotki B po epipolarni črti.
                </p>

                {photoA && photoB && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MvStage
                      photo={photoA}
                      testid="mv-click-a"
                      clickable={canClickRef}
                      onClick={onRefClick}
                      svg={refLineA()}
                      labels={refLabels('a')}
                      alt="Fotka A — klik za referenčni točki"
                    />
                    <MvStage
                      photo={photoB}
                      testid="mv-ref-stage-b"
                      alt="Fotka B — samodejne korespondence referenčnih točk"
                      labels={refLabels('b')}
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={refPts.length === 2 ? 'default' : 'secondary'} className="text-[10px]">
                    točke: {refPts.length}/2
                  </Badge>
                  {refConfirmed && <Badge className="border-green-300 bg-green-100 text-green-800 text-[10px]">referenca zaključena</Badge>}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium">Realna dolžina med točkama (cm)</span>
                    <Input
                      type="number"
                      min={10}
                      step="any"
                      inputMode="decimal"
                      value={refCm}
                      onChange={(e) => setRefCm(e.target.value)}
                      placeholder="npr. 80"
                      className="min-h-11 w-40"
                      data-testid="mv-ref-cm"
                    />
                  </label>
                  <Button onClick={onRefConfirm} disabled={!canConfirmRef} data-testid="mv-ref-confirm">
                    Zaključi referenco
                  </Button>
                  {busyRef && (
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-transparent" aria-hidden="true" />
                      Računam merilo…
                    </span>
                  )}
                  {refPts.length === 2 && refCmVal === null && (
                    <span className="text-xs text-amber-800">Vnesi dolžino (najmanj 10 cm).</span>
                  )}
                  {basePairs && basePairs.a.length < 8 && (
                    <span className="text-xs text-destructive">Premalo inlierjev za geometrijo (potrebnih ≥ 8).</span>
                  )}
                </div>

                {result && mvStatus && (
                  <div className="space-y-1 rounded-lg border bg-secondary/40 p-3" data-testid="mv-ref-status">
                    {result.ok ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          {statusBadge(mvStatus)}
                          <span className="text-sm">{mvStatus.message}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Naslednji korak: {mvStatus.nextStep} {statusHint(mvStatus.status ?? 'AUTO_SUGGESTED')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Fokus: {result.focalPx !== null ? `${fmtN(result.focalPx, 0)} px` : '—'}
                          {result.focalSelfCal ? ' (ocenjen iz fotk)' : ''} · merilo: {result.scaleCmPerUnit !== null ? `${fmtN(result.scaleCmPerUnit, 4)} cm / enota 3D` : '—'}
                        </p>
                        {!mvStatus.ok && (
                          <p className="text-xs text-amber-900">
                            Geometrija ne doseže zanesljivosti ({mvStatus.code}) — dodatne meritve ostajajo zaklenjene.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                        <p className="font-semibold">Napaka: {result.code}</p>
                        {result.warnings.map((w) => (
                          <p key={w}>{w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {refConfirmed && (
                  <p className="text-xs text-muted-foreground">
                    Referenca je zaključena — klikanje v tem koraku je izklopljeno; dodatne merilne točke dodajaš v
                    koraku 4.
                  </p>
                )}
              </div>

              <aside className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Dobra referenca</p>
                <p>Izberi čim večji znan odsek (vrata 80–200 cm, odsek ograje) — napaka označbe se pri teh merah pomnoži.</p>
                <p>Če točke ni mogoče povezati, klikni bližje jasni strukturi (oglji, spoji) — točka se NE doda.</p>
              </aside>
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 4: meritve ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">4</span>
            Meritve (3D razdalje)
          </h3>

          {!refConfirmed ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              Zaključi referenco (korak 3), da se merilo v cm izračuna — brez nje so razdalje izmišljene.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                <p className="text-sm text-muted-foreground">
                  Klikni dodatne točke na fotki A — vsaka se samodejno poveže na fotko B. Razdalje se računajo kot
                  veriga med SODEDNJIMI točkami (M1–M2, M2–M3, …) v 3D.
                </p>

                {photoA && photoB && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MvStage
                      photo={photoA}
                      testid="mv-measure-stage-a"
                      clickable={canClickMeasure}
                      onClick={onMeasureClick}
                      svg={
                        <>
                          {refLineA()}
                          {chainLinesA()}
                        </>
                      }
                      labels={[...refLabels('a'), ...extraLabels('a')]}
                      alt="Fotka A — klik za merilne točke"
                    />
                    <MvStage
                      photo={photoB}
                      testid="mv-measure-stage-b"
                      alt="Fotka B — samodejne korespondence merilnih točk"
                      labels={[...refLabels('b'), ...extraLabels('b')]}
                    />
                  </div>
                )}

                {busyMeasure && (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-transparent" aria-hidden="true" />
                    Trianguliram…
                  </span>
                )}

                {result && !result.ok && (
                  <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                    <p className="font-semibold">Meritev ni bila izračunana: {result.code}</p>
                    {result.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                )}

                {chain.length > 0 && (
                  <ul className="space-y-1" data-testid="mv-measures">
                    {chain.map((d, idx) => {
                      const e1 = errPxFor(d.i);
                      const e2 = errPxFor(d.j);
                      return (
                        <li
                          key={`${d.i}-${d.j}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-2 text-sm"
                        >
                          <span className="font-medium">
                            M{idx + 1}–M{idx + 2}: {fmtN(d.cm)} cm
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            {(e1 !== null || e2 !== null) && (
                              <span className="text-[10px] text-muted-foreground">
                                napaka točk: {e1 !== null ? fmtN(e1, 2) : '—'} / {e2 !== null ? fmtN(e2, 2) : '—'} px
                              </span>
                            )}
                            {statusBadge(mvStatus)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {result && result.ok && chain.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {extraPts.length === 1
                      ? 'Dodaj še eno točko za prvo razdaljo.'
                      : 'Dodaj vsaj 2 točki na fotko A za prvo razdaljo.'}
                  </p>
                )}
                {chain.length > 1 && (
                  <p className="text-sm font-semibold" data-testid="mv-chain-sum">
                    Skupna vsota verige: {fmtN(chainSum)} cm
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={onResetMeasures}
                    disabled={busy || extraPts.length === 0}
                    data-testid="mv-reset-measures"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Ponastavi meritve
                  </Button>
                  <span className="text-xs text-muted-foreground">Referenca ostane — ponastavijo se samo dodatne točke.</span>
                </div>

                {result && result.warnings.length > 0 && (
                  <ul className="space-y-1" data-testid="mv-warnings">
                    {result.warnings.map((w) => (
                      <li key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <aside className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Kaj pomeni veriga</p>
                <p>Razdalje so med sosednjimi označenimi točkami v 3D (tudi v globino) — ne med vsemi pari.</p>
                <p>Opozorila jedra (npr. skoraj ravninska scena → nezanesljiva globina) so vedno izpisana spodaj.</p>
              </aside>
            </div>
          )}
        </div>
      </div>

      {/* ── KORAK 5: izvoz ── */}
      <div className="rounded-xl border bg-card">
        <div className="p-4 sm:p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">5</span>
            Izvoz poročila
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onExport} disabled={!canExport || busy} data-testid="mv-export">
              <Download className="mr-2 h-4 w-4" />
              Izvozi poročilo (JSON)
            </Button>
            {onAddMeasures && (
              <Button onClick={onAddToSheet} disabled={!canAddSheet || busy} variant="outline" data-testid="mv-add-sheet">
                <ListPlus className="mr-2 h-4 w-4" />
                Dodaj meritve v merilni list
              </Button>
            )}
            <Badge className="border-amber-300 bg-amber-100 text-amber-800 text-[10px]">
              Pomožna meritev — za proizvodnjo preveri s trakom/laserjem.
            </Badge>
          </div>
          {canAddSheet && (
            <p className="text-xs text-muted-foreground">
              Meritve gredo v zavihek Orodja → »Dodane meritve« z oznako statusa ({statusLabel(mvStatus?.status ?? 'AUTO_SUGGESTED')})
              in naprej v merilni list + kalkulator. {MULTIVIEW_SHEET_NOTE}
            </p>
          )}
          {!canExport && (
            <p className="text-xs text-muted-foreground">
              Izvoz se omogoči po uspešno zaključeni referenci (korak 3) — poročilo brez veljavne geometrije ne bi
              smelo obstajati.
            </p>
          )}
          {canExport && (
            <p className="text-xs text-muted-foreground">
              Poročilo vsebuje: verzijo skripte, dimenzije fotk, fokus, geometrijo (inlierji, residuala, hash F),
              status pogodbe, referenco v %, meritve, vsa opozorila in sledljivost (provenance).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
