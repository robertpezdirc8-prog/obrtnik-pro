'use client';

// ─── Foto platno: zaznani okviri + AR merjenje po fotografiji ────
// Načini:
//  1. "Prepoznavanje" — zaznani objekti (okviri) + ravnine
//  2. "Dolžine" — klikni 2 točki; umerjanje z znano dolžino ALI
//     kalibrirana ravnina (perspektivna korekcija)
//  3. "Površine" — klikaj oglišča → m² + dolžine strani
//  4. "Koti" — 3 točke → kot v stopinjah
//  5. "Ravnina" — 4 oglišča + realna širina/višina → homografija:
//     vse nadaljnje meritve na ravnini so prave, tudi če je posnetek
//     poševn (single-view metrology)
//  Magnet: klik se pripne na najmočnejši rob v bližini (Sobel karta).
// Izvoz: kopiraj na odložišče ali prenesi CSV.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Ruler, Tags, RotateCcw, Check, X, Crosshair, Copy, Download,
  Square, TriangleRight, Undo2, Maximize, Magnet, Layers3, Sparkles, Route,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { DetectedObject, DetectedSurface, PhotoMeasure, MeasureKind } from '@/lib/camera-types';
import {
  angleAt, centroidPct, chainStats, downloadMeasuresCsv, formatCm, formatDeg, formatM2, formatSlope,
  lengthCm, measuresToText, polygonAreaM2, polygonSidesCm, type XY,
} from '@/lib/measure-geometry';
import { buildEdgeMap, snapPoint, type EdgeMap } from '@/lib/edge-detect';
import {
  calibratePlane, planeAngleDeg, planeChainStats, planeDistanceCm, planePolygonAreaM2,
  planeSidesCm, type PlaneCalib,
} from '@/lib/homography';

interface Pt { x: number; y: number } // % koordinati

interface PhotoCanvasProps {
  dataUrl: string;
  objects: DetectedObject[];
  surfaces?: DetectedSurface[];
  referenceLabel?: string;
  referenceCm?: number;
  /** Okvir referenčnega objekta v % — omogoča enoklikovno umerjanje. */
  referenceBox?: [number, number, number, number] | null;
  measures: PhotoMeasure[];
  setMeasures: (m: PhotoMeasure[]) => void;
}

type Mode = 'boxes' | 'length' | 'area' | 'angle' | 'chain' | 'plane';

/** Največ točk verige (trasa ograje — zadošča za vse realne primere). */
const MAX_CHAIN = 16;

let measureSeq = 0;
const nextId = () => `m${++measureSeq}-${Date.now()}`;

/** Referenčni objekti za hitro umerjanje (cm). */
const QUICK_REFS: Array<{ label: string; cm: number }> = [
  { label: 'Vrata 200', cm: 200 },
  { label: 'Okno 120', cm: 120 },
  { label: 'Ploščica 60', cm: 60 },
  { label: 'Ploščica 30', cm: 30 },
  { label: 'Kartica 8,6', cm: 8.6 },
  { label: 'Oseba 170', cm: 170 },
];

export function PhotoCanvas({
  dataUrl, objects, surfaces, referenceLabel, referenceCm, referenceBox, measures, setMeasures,
}: PhotoCanvasProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('boxes');
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [pending, setPending] = useState<Pt[]>([]);
  const [pxPerCm, setPxPerCm] = useState<number | null>(null);
  const [calibInput, setCalibInput] = useState<string>(referenceCm ? String(referenceCm) : '');
  const [calibOpen, setCalibOpen] = useState(false);

  // Magnet (pripenjanje na robove)
  const [magnet, setMagnet] = useState(true);
  const [edge, setEdge] = useState<EdgeMap | null>(null);

  // Merilna ravnina (perspektivna korekcija)
  const [plane, setPlane] = useState<PlaneCalib | null>(null);
  const [planeQuad, setPlaneQuad] = useState<Pt[] | null>(null);
  const [planeDialog, setPlaneDialog] = useState(false);
  const [planeW, setPlaneW] = useState('');
  const [planeH, setPlaneH] = useState('');

  const boxRef = useRef<HTMLDivElement>(null);

  // Karta robov za magnet (asinhrono, enkrat na sliko)
  useEffect(() => {
    let alive = true;
    buildEdgeMap(dataUrl).then((m) => {
      if (alive) setEdge(m);
    });
    return () => { alive = false; };
  }, [dataUrl]);

  const snap = (p: Pt): Pt => (magnet ? snapPoint(p, edge).point : p);

  const hasScale = plane !== null || pxPerCm !== null;
  const needsScale = (mode === 'length' || mode === 'area' || mode === 'chain') && !hasScale;

  // ── Merjenje: ravnina (perspektiva) ima prednost pred merilom ──
  const measureLen = (a: Pt, b: Pt): number | null => {
    if (!imgSize) return null;
    if (plane) return planeDistanceCm(plane, a, b, imgSize);
    if (pxPerCm) return lengthCm(a, b, imgSize, pxPerCm);
    return null;
  };

  const measureAreaOf = (pts: Pt[]): { area: number | null; sides: number[] } => {
    if (!imgSize) return { area: null, sides: [] };
    if (plane) {
      return { area: planePolygonAreaM2(pts, plane, imgSize), sides: planeSidesCm(pts, plane, imgSize) };
    }
    if (pxPerCm) {
      return { area: polygonAreaM2(pts, imgSize, pxPerCm), sides: polygonSidesCm(pts, imgSize, pxPerCm) };
    }
    return { area: null, sides: [] };
  };

  const measureAngle = (a: Pt, v: Pt, c: Pt): number | null => {
    if (!imgSize) return null;
    if (plane) return planeAngleDeg(a, v, c, plane, imgSize);
    return angleAt(a, v, c, imgSize);
  };

  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'boxes') return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw: Pt = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
    const pt = snap(raw);

    // Površina: klik na prvo oglišče (blizu) zapre poligon
    if (mode === 'area' && pending.length >= 3) {
      const first = pending[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 4) {
        closeArea(pending);
        return;
      }
    }

    const next = [...pending, pt];

    if (mode === 'plane') {
      if (next.length === 4) {
        setPlaneQuad(next);
        setPending([]);
        setPlaneW('');
        setPlaneH('');
        setPlaneDialog(true);
      } else {
        setPending(next);
      }
      return;
    }

    if (mode === 'length') {
      if (next.length === 2) {
        if (!hasScale) {
          setPending(next);
          setCalibOpen(true);
        } else {
          setPending([]);
          pushLength(next);
        }
        return;
      }
      setPending(next);
      return;
    }

    if (mode === 'chain') {
      // Veriga: točke se zbirajo; brez merila odpremo umerjanje po 2. točki
      // (prvi odsek definira merilo, nato nadaljuješ z odbijanjem trase)
      if (next.length === 2 && !hasScale) {
        setPending(next);
        setCalibOpen(true);
        return;
      }
      if (next.length >= MAX_CHAIN) {
        finishChain(next);
        return;
      }
      setPending(next);
      return;
    }

    if (mode === 'angle') {
      if (next.length === 3) {
        setPending([]);
        const deg = measureAngle(next[0], next[1], next[2]);
        if (deg === null) return;
        setMeasures([...measures, {
          id: nextId(), label: `Kot ${countKind('angle') + 1}`, kind: 'angle', value: deg,
          points: next.map((p) => [p.x, p.y] as [number, number]),
        }]);
        return;
      }
      setPending(next);
      return;
    }

    // area
    setPending(next);
  };

  const closeArea = (pts: Pt[]) => {
    if (!imgSize || !hasScale) {
      setPending(pts);
      setCalibOpen(true);
      return;
    }
    const { area, sides } = measureAreaOf(pts);
    setPending([]);
    if (area === null) return;
    setMeasures([...measures, {
      id: nextId(), label: `Površina ${countKind('area') + 1}`, kind: 'area', value: area,
      points: pts.map((p) => [p.x, p.y] as [number, number]), sides,
    }]);
  };

  const pushLength = (pts: Pt[]) => {
    const cm = measureLen(pts[0], pts[1]);
    if (cm === null) return;
    setMeasures([...measures, {
      id: nextId(), label: `Mer ${countKind('length') + 1}`, kind: 'length', value: cm,
      points: [pts[0], pts[1]].map((p) => [p.x, p.y] as [number, number]),
    }]);
  };

  // ── Veriga / naklon: skupni tek trase + naklon (ravnina ima prednost) ──
  const finishChain = (pts: Pt[]) => {
    if (!imgSize || pts.length < 2) return;
    let segments: number[] = [];
    let total: number | null = null;
    let slope: number | null = null;
    if (plane) {
      const st = planeChainStats(pts, plane, imgSize);
      if (st) { segments = st.segmentsCm; total = st.totalCm; slope = st.slopeDeg; }
    } else if (pxPerCm) {
      const st = chainStats(pts, imgSize, pxPerCm);
      if (st) { segments = st.segmentsCm; total = st.totalCm; slope = st.slopeDeg; }
    }
    if (total === null) return;
    setPending([]);
    setMeasures([...measures, {
      id: nextId(),
      label: `Veriga ${countKind('chain') + 1}`,
      kind: 'chain',
      value: total,
      points: pts.map((p) => [p.x, p.y] as [number, number]),
      sides: segments,
      slopeDeg: slope ?? 0,
    }]);
    toast({
      title: `Veriga: skupaj ${formatCm(total)}${slope !== null ? ` · naklon ${formatSlope(slope)}` : ''}`,
      description: `${segments.length} ${segments.length === 1 ? 'odsek' : segments.length === 2 ? 'odseka' : 'odsekov'} — skupni tek gre v kalkulator kot dolžina.`,
    });
  };

  const countKind = (kind: MeasureKind) => measures.filter((m) => m.kind === kind).length;

  const undoPending = () => setPending(pending.slice(0, -1));

  const confirmCalibration = (cmOverride?: number, ptsOverride?: Pt[]) => {
    const cm = cmOverride ?? Number(calibInput.replace(',', '.'));
    const P = ptsOverride ?? pending;
    if (!Number.isFinite(cm) || cm <= 0 || P.length < 2 || !imgSize) return;
    // merilo iz prvega para točk
    const scale = Math.hypot(
      ((P[1].x - P[0].x) / 100) * imgSize.w,
      ((P[1].y - P[0].y) / 100) * imgSize.h,
    ) / cm;
    setPxPerCm(scale);

    const isAreaFlow = ptsOverride === undefined && mode === 'area' && P.length >= 3;
    if (isAreaFlow) {
      const area = polygonAreaM2(P, imgSize, scale);
      const sides = polygonSidesCm(P, imgSize, scale);
      if (area !== null) {
        setMeasures([...measures, {
          id: nextId(), label: `Površina ${countKind('area') + 1}`, kind: 'area', value: area,
          points: P.map((p) => [p.x, p.y] as [number, number]), sides,
        }]);
      }
      setPending([]);
    } else if (ptsOverride === undefined && mode === 'chain') {
      // Veriga: prvi odsek definira merilo — brez dodatne meritve,
      // točki ostaneta v verigi in nadaljuješ z odbijanjem trase
      setCalibOpen(false);
    } else {
      const m: PhotoMeasure = {
        id: nextId(), label: 'Merilo (umerjanje)', kind: 'length',
        value: Math.round(cm * 10) / 10,
        points: [P[0], P[1]].map((p) => [p.x, p.y] as [number, number]),
      };
      setMeasures([...measures, m]);
      setPending([]);
    }
    setCalibOpen(false);
  };

  /** Enoklikovno umerjanje po okvirju reference iz analize (navpična stranica). */
  const useReferenceBoxCalib = () => {
    if (!referenceBox || !referenceCm || !referenceLabel) return;
    const [x, y, w, h] = referenceBox;
    const cx = x + w / 2;
    const seg: Pt[] = [{ x: cx, y }, { x: cx, y: y + h }];
    setPending(seg);
    confirmCalibration(referenceCm, seg);
  };

  const confirmPlane = () => {
    const w = Number(planeW.replace(',', '.'));
    const h = Number(planeH.replace(',', '.'));
    if (!planeQuad || !imgSize || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    const calib = calibratePlane(planeQuad, w, h, imgSize);
    if (!calib) {
      toast({
        title: 'Ravnine ni bilo mogoče umeriti',
        description: 'Preveri, da so oglišča res na robovih ravnine in da ni preveč majhna.',
        variant: 'destructive',
      });
      return;
    }
    setPlane(calib);
    const areaM2 = Math.round(((w * h) / 10_000) * 100) / 100;
    setMeasures([...measures, {
      id: nextId(), label: `Ravnina ${w}×${h} cm`, kind: 'area', value: areaM2,
      points: planeQuad.map((p) => [p.x, p.y] as [number, number]),
      sides: [w, h],
    }]);
    setPlaneQuad(null);
    setPlaneDialog(false);
    toast({
      title: 'Ravnina umerjena ✓',
      description: 'Nadaljnje meritve na tej ravnini so popravljene za perspektivo.',
    });
  };

  const applyDetectedSurface = (s: DetectedSurface) => {
    if (!s.quad || s.quad.length !== 4) return;
    setPlaneQuad(s.quad.map(([x, y]) => ({ x, y })));
  };

  const resetScale = () => {
    setPxPerCm(null);
    setPlane(null);
    setMeasures([]);
    setPending([]);
    setPlaneQuad(null);
  };

  const removeMeasure = (id: string) => setMeasures(measures.filter((m) => m.id !== id));

  const copyMeasures = async () => {
    try {
      await navigator.clipboard.writeText(measuresToText(measures));
      toast({ title: 'Meritve kopirane ✓', description: 'Prilepi jih v zapiske ali e-pošto.' });
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  // ─── SVG pomožni render ────────────────────────────────────
  const areaMeasures = measures.filter((m) => m.kind === 'area');
  const angleMeasures = measures.filter((m) => m.kind === 'angle');
  const chainMeasures = measures.filter((m) => m.kind === 'chain');
  const lengthMeasures = measures.filter((m) => m.kind === 'length' || m.kind === 'laser');
  const detectedSurfaces = (surfaces ?? []).filter((s) => s.quad && s.quad.length === 4);

  const modeHint: Record<Mode, string> = {
    boxes: 'Zaznani objekti in ravnine — preklopi v način merjenja za meritve.',
    length: 'Klikni 2 točki za dolžino. Prvi par umeri merilo (ali umeri ravnino).',
    area: 'Klikaj oglišča površine; klik na prvo oglišče (ali gumb) zapre poligon.',
    angle: 'Klikni 3 točke: krak, oglišče kota, krak.',
    chain: 'Klikaj točke vzdolž ograje (tudi čez klanec) — nato „Zaključi verigo“ za skupni tek in naklon.',
    plane: 'Klikni 4 oglišča znano ravnine (stena, fasada, tla) → vnesi realno širino in višino.',
  };

  return (
    <div className="space-y-3">
      {/* Preklop načina */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border p-0.5 bg-secondary/50">
          {([
            ['boxes', 'Prepoznavanje', <Tags key="i" className="h-4 w-4" />],
            ['length', 'Dolžine', <Ruler key="i" className="h-4 w-4" />],
            ['area', 'Površine', <Square key="i" className="h-4 w-4" />],
            ['angle', 'Koti', <TriangleRight key="i" className="h-4 w-4" />],
            ['chain', 'Veriga', <Route key="i" className="h-4 w-4" />],
            ['plane', 'Ravnina', <Layers3 key="i" className="h-4 w-4" />],
          ] as Array<[Mode, string, React.ReactNode]>).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => { setMode(m); setPending([]); }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={mode === m}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Magnet */}
        <button
          onClick={() => setMagnet(!magnet)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${magnet ? 'border-primary/50 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={magnet}
          aria-label="Magnet: pripenjanje točk na robove"
          title="Klik se pripne na najbližji rob (okvir, fuga, rob stene)"
        >
          <Magnet className="h-4 w-4" />
          Magnet
        </button>

        {mode === 'plane' ? (
          plane ? (
            <Badge variant="outline" className="gap-1.5">
              <Check className="h-3 w-3 text-green-600" />
              Ravnina umerjena
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
              Klikni 4 oglišča ravnine
            </Badge>
          )
        ) : plane ? (
          <Badge variant="outline" className="gap-1.5">
            <Check className="h-3 w-3 text-green-600" />
            Ravnina umerjena — meritve popravljene za perspektivo
          </Badge>
        ) : pxPerCm !== null && (mode === 'length' || mode === 'area' || mode === 'chain') ? (
          <Badge variant="outline" className="gap-1.5">
            <Check className="h-3 w-3 text-green-600" />
            Merilo umerjeno
          </Badge>
        ) : needsScale ? (
          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
            Najprej umeri merilo (2 točki z znano dolžino)
          </Badge>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {modeHint[mode]}
        {magnet && mode !== 'boxes' ? ' Magnet: točke se pripnejo na robove.' : ''}
      </p>

      {/* Fotografija z overlay */}
      <div
        ref={boxRef}
        onClick={addPoint}
        className={`relative w-full overflow-hidden rounded-xl border bg-secondary select-none ${mode !== 'boxes' ? 'cursor-crosshair' : ''}`}
      >
        <img
          src={dataUrl}
          alt="Zajeta fotografija z oznakami"
          className="block w-full"
          onLoad={(e) => {
            const el = e.currentTarget;
            setImgSize({ w: el.naturalWidth, h: el.naturalHeight });
          }}
        />

        {/* Zaznani okviri */}
        {mode === 'boxes' &&
          objects
            .filter((o) => o.box)
            .map((o, i) => {
              const [x, y, w, h] = o.box!;
              return (
                <div
                  key={`box-${i}`}
                  className="absolute rounded-md border-2 border-primary/90 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
                  style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
                  aria-label={`Zaznano: ${o.label}`}
                >
                  <span className="absolute -top-0.5 left-0 -translate-y-full whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow max-w-[200%] truncate">
                    {o.label}
                    {o.estWidthCm && o.estHeightCm ? ` ≈ ${o.estWidthCm}×${o.estHeightCm} cm` : o.estHeightCm ? ` ≈ ${o.estHeightCm} cm` : ''}
                  </span>
                </div>
              );
            })}

        {/* Vsi izrisi meritev */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full pointer-events-none">
          {/* Prepoznane ravnine (prepoznavanje) */}
          {mode === 'boxes' && detectedSurfaces.map((s, i) => (
            <polygon
              key={`surf-${i}`}
              points={s.quad!.map(([x, y]) => `${x},${y}`).join(' ')}
              className="fill-amber-500/15 stroke-amber-500"
              strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* kalibrirana ravnina */}
          {plane && planeQuad === null && mode !== 'boxes' && measures.filter((m) => m.label.startsWith('Ravnina')).slice(-1).map((m) => (
            <polygon
              key={`plane-${m.id}`}
              points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
              className="fill-primary/10 stroke-primary"
              strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* daljice */}
          {lengthMeasures.map((m) => (
            <line
              key={m.id}
              x1={m.points[0][0]} y1={m.points[0][1]}
              x2={m.points[1][0]} y2={m.points[1][1]}
              stroke="currentColor" strokeWidth={2.5}
              className="text-green-600" vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* površine */}
          {areaMeasures.map((m) => (
            <polygon
              key={m.id}
              points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
              className="fill-green-500/20 stroke-green-600"
              strokeWidth={2.5} vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* koti */}
          {angleMeasures.map((m) => (
            <g key={m.id}>
              <polyline
                points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none" stroke="currentColor" strokeWidth={2.5}
                className="text-orange-600" vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}

          {/* verige (trasa ograje) */}
          {chainMeasures.map((m) => (
            <polyline
              key={m.id}
              points={m.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke="currentColor" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round"
              className="text-teal-600" vectorEffect="non-scaling-stroke"
            />
          ))}
          {chainMeasures.map((m) => (
            <g key={`cd-${m.id}`}>
              {m.points.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={0.7} className="fill-teal-600" />
              ))}
            </g>
          ))}

          {/* čakajoče točke */}
          {pending.map((p, i) => (
            <circle key={`p-${i}`} cx={p.x} cy={p.y} r={0.7} className="fill-amber-500" />
          ))}
          {/* poligon v nastajanju (površina ali ravnina) */}
          {(mode === 'area' || mode === 'plane') && pending.length >= 2 && (
            <polygon
              points={pending.map((p) => `${p.x},${p.y}`).join(' ')}
              className="fill-amber-500/20 stroke-amber-500"
              strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
            />
          )}
          {/* veriga v nastajanju */}
          {mode === 'chain' && pending.length >= 2 && (
            <polyline
              points={pending.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke="currentColor" strokeWidth={2}
              strokeDasharray="6 4" className="text-teal-500" vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Oznake vrednosti */}
        {lengthMeasures.filter((m) => m.value !== null).map((m) => {
          const mx = (m.points[0][0] + m.points[1][0]) / 2;
          const my = (m.points[0][1] + m.points[1][1]) / 2;
          return (
            <span key={`lbl-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${mx}%`, top: `${my}%` }}>
              {m.label}: {formatCm(m.value!)}
            </span>
          );
        })}
        {areaMeasures.map((m) => {
          const c = centroidPct(m.points);
          return (
            <span key={`lbla-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-green-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
              {m.label.startsWith('Ravnina') ? 'Ravnina · ' : ''}{formatM2(m.value ?? 0)}
            </span>
          );
        })}
        {angleMeasures.map((m) => {
          const v = m.points[1];
          return (
            <span key={`lblx-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${v[0]}%`, top: `${v[1]}%` }}>
              {formatDeg(m.value ?? 0)}
            </span>
          );
        })}
        {/* oznake verig: skupni tek + naklon v težišču trase */}
        {chainMeasures.filter((m) => m.value !== null).map((m) => {
          const c = centroidPct(m.points);
          return (
            <span key={`lblc-${m.id}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-teal-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
              {m.label}: {formatCm(m.value!)}{m.slopeDeg !== undefined && m.slopeDeg >= 1 ? ` · ${formatSlope(m.slopeDeg)}` : ''}
            </span>
          );
        })}
        {/* oznake prepoznanih ravnin */}
        {mode === 'boxes' && detectedSurfaces.map((s, i) => {
          const c = centroidPct(s.quad!);
          return (
            <span key={`surflbl-${i}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
              {s.label}{s.estAreaM2 ? ` ≈ ${formatM2(s.estAreaM2)}` : ''}
            </span>
          );
        })}

        {/* Nitka za čakajoče točke */}
        {pending.length > 0 && pending.map((p, i) => (
          <span key={`dot-${i}`} className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        ))}
      </div>

      {/* Pomožni gumbi za poligon / verigo */}
      {((mode === 'area' || mode === 'plane') || (mode === 'chain' && pending.length > 0)) && pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mode === 'area' ? (
            <Button size="sm" onClick={() => closeArea(pending)} disabled={pending.length < 3 || (pxPerCm === null && pending.length < 2)} className="min-h-11">
              <Maximize className="mr-1.5 h-4 w-4" />
              Zapri površino ({pending.length} oglišč)
            </Button>
          ) : mode === 'chain' ? (
            <Button size="sm" onClick={() => finishChain(pending)} disabled={pending.length < 2 || !hasScale} className="min-h-11" data-testid="chain-finish">
              <Route className="mr-1.5 h-4 w-4" />
              Zaključi verigo ({pending.length} {pending.length === 1 ? 'točka' : pending.length === 2 ? 'točki' : pending.length < 5 ? 'točke' : 'točk'})
            </Button>
          ) : (
            <Button size="sm" onClick={() => { setPlaneQuad(pending); setPending([]); setPlaneW(''); setPlaneH(''); setPlaneDialog(true); }} disabled={pending.length < 4} className="min-h-11">
              <Layers3 className="mr-1.5 h-4 w-4" />
              Umeri ravnino ({pending.length}/4 oglišč)
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={undoPending} className="min-h-11">
            <Undo2 className="mr-1.5 h-4 w-4" />
            Razveljavi točko
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending([])} className="min-h-11">
            <X className="mr-1.5 h-4 w-4" />
            Prekini
          </Button>
        </div>
      )}

      {/* Umerjanje merila */}
      {calibOpen && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" role="dialog" aria-label="Umerjanje merila">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold">Umeri merilo — koliko cm je izbrana daljica?</p>
          </div>
          {referenceLabel && (
            <p className="text-xs text-muted-foreground">
              Predlog analize: <strong>{referenceLabel} ≈ {referenceCm} cm</strong>
              {referenceBox && (
                <button
                  onClick={useReferenceBoxCalib}
                  className="ml-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-accent"
                  aria-label={`Samodejno umeri po referenci iz analize: ${referenceLabel}`}
                >
                  <Sparkles className="h-3 w-3" />
                  Umeri samodejno po okvirju analize
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REFS.map((r) => (
              <button
                key={r.cm}
                onClick={() => { setCalibInput(String(r.cm)); confirmCalibration(r.cm); }}
                className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-accent min-h-[32px]"
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

      {/* Umerjanje ravnine */}
      {planeDialog && planeQuad && (
        <div className="rounded-xl border border-primary/40 bg-accent/40 p-3 space-y-2" role="dialog" aria-label="Umerjanje ravnine">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Ravnina: koliko cm sta realna širina in višina?</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Npr. fasadna stena 600 × 280 cm ali terasa 350 × 300 cm. Po umeritvi so
            <strong> vse meritve na ravnini prave</strong>, kljub poševnemu posnetku.
          </p>
          {detectedSurfaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Prepoznane ravnine:</span>
              {detectedSurfaces.map((s, i) => (
                <button
                  key={`rav-${i}`}
                  onClick={() => applyDetectedSurface(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${planeQuad && s.quad && planeQuad.length === 4 && s.quad.every((q, j) => Math.abs(q[0] - planeQuad[j].x) < 0.01 && Math.abs(q[1] - planeQuad[j].y) < 0.01) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'}`}
                  aria-label={`Uporabi prepoznano ravnino: ${s.label}`}
                >
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              autoFocus
              type="number"
              inputMode="decimal"
              min={10}
              placeholder="širina (cm)"
              value={planeW}
              onChange={(e) => setPlaneW(e.target.value)}
              className="max-w-36"
              aria-label="Realna širina ravnine v centimetrih"
            />
            <Input
              type="number"
              inputMode="decimal"
              min={10}
              placeholder="višina (cm)"
              value={planeH}
              onChange={(e) => setPlaneH(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmPlane(); }}
              className="max-w-36"
              aria-label="Realna višina ravnine v centimetrih"
            />
            <Button size="sm" onClick={confirmPlane} disabled={!planeW || !planeH} className="min-h-11">
              <Check className="mr-1 h-4 w-4" />
              Umeri ravnino
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPlaneDialog(false); setPlaneQuad(null); }} className="min-h-11">
              <X className="mr-1 h-4 w-4" />
              Prekliči
            </Button>
          </div>
        </div>
      )}

      {/* Seznam meritev */}
      {measures.length > 0 && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-sm font-semibold">Izmerjeno ({measures.length})</Label>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void copyMeasures()}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                Kopiraj
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => downloadMeasuresCsv(measures)}>
                <Download className="mr-1 h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto scroll-area pr-1">
            {measures.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
                    {m.kind === 'area' ? 'm²' : m.kind === 'angle' ? '°' : 'cm'}
                  </Badge>
                  <span className="truncate font-medium">{m.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <strong className={
                    m.value === null ? 'text-muted-foreground'
                      : m.kind === 'area' ? 'text-green-700'
                        : m.kind === 'chain' ? 'text-teal-700'
                          : m.kind === 'angle' ? 'text-orange-700' : 'text-green-700'
                  }>
                    {m.value === null ? '—' : m.kind === 'area' ? formatM2(m.value) : m.kind === 'angle' ? formatDeg(m.value) : formatCm(m.value)}
                    {m.kind === 'chain' && m.slopeDeg !== undefined && m.slopeDeg >= 1 ? ` · ${formatSlope(m.slopeDeg)}` : ''}
                  </strong>
                  <button
                    onClick={() => removeMeasure(m.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Izbriši ${m.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Merilo/ravnina reset */}
      {(pxPerCm !== null || plane !== null) && (mode === 'length' || mode === 'area' || mode === 'chain' || mode === 'plane') && (
        <div className="flex flex-wrap gap-2">
          {plane !== null && (
            <Button variant="ghost" size="sm" onClick={() => setPlane(null)} className="h-8 text-xs">
              <Layers3 className="mr-1 h-3.5 w-3.5" />
              Izbriši ravnino (meritve ostanejo)
            </Button>
          )}
          {pxPerCm !== null && (
            <Button variant="ghost" size="sm" onClick={resetScale} className="h-8 text-xs">
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Ponastavi merilo (zbriše meritve)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
