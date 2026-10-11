'use client';

// ─── Foto platno: AI okviri + AR merjenje po fotografiji ────
// Štirje načini:
//  1. "Prepoznavanje" — AI zaznani objekti (okviri z oznakami)
//  2. "Dolžine" — klikni 2 točki; prvi par umeri merilo, ostale
//     daljice se izmerijo samodejno v cm
//  3. "Površine" — klikaj oglišča (keramika, fasada, terasa) →
//     m² po Shoelace formuli + dolžine strani
//  4. "Koti" — klikni 3 točke → kot v stopinjah (naklon stopnic)
// Izvoz: kopiraj na odložišče ali prenesi CSV.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Ruler, Tags, RotateCcw, Check, X, Crosshair, Copy, Download,
  Square, TriangleRight, Undo2, Maximize,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { DetectedObject, PhotoMeasure, MeasureKind } from '@/lib/camera-types';
import {
  angleAt, centroidPct, downloadMeasuresCsv, formatCm, formatDeg, formatM2,
  lengthCm, measuresToText, polygonAreaM2, polygonSidesCm, type XY,
} from '@/lib/measure-geometry';

interface Pt { x: number; y: number } // % koordinati

interface PhotoCanvasProps {
  dataUrl: string;
  objects: DetectedObject[];
  referenceLabel?: string;
  referenceCm?: number;
  measures: PhotoMeasure[];
  setMeasures: (m: PhotoMeasure[]) => void;
}

type Mode = 'boxes' | 'length' | 'area' | 'angle';

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

export function PhotoCanvas({ dataUrl, objects, referenceLabel, referenceCm, measures, setMeasures }: PhotoCanvasProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('boxes');
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [pending, setPending] = useState<Pt[]>([]);
  const [pxPerCm, setPxPerCm] = useState<number | null>(null);
  const [calibInput, setCalibInput] = useState<string>(referenceCm ? String(referenceCm) : '');
  const [calibOpen, setCalibOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  const needsScale = mode === 'length' || mode === 'area';
  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'boxes') return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt: Pt = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };

    // Površina: klik na prvo oglišče (blizu) zapre poligon
    if (mode === 'area' && pending.length >= 3) {
      const first = pending[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 4) {
        closeArea(pending);
        return;
      }
    }

    const next = [...pending, pt];

    if (mode === 'length') {
      if (next.length === 2) {
        if (pxPerCm === null) {
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

    if (mode === 'angle') {
      if (next.length === 3) {
        setPending([]);
        if (!imgSize) return;
        const deg = angleAt(next[0], next[1], next[2], imgSize);
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
    if (!imgSize || pxPerCm === null) {
      setPending(pts);
      setCalibOpen(true);
      return;
    }
    const area = polygonAreaM2(pts, imgSize, pxPerCm);
    const sides = polygonSidesCm(pts, imgSize, pxPerCm);
    setPending([]);
    if (area === null) return;
    setMeasures([...measures, {
      id: nextId(), label: `Površina ${countKind('area') + 1}`, kind: 'area', value: area,
      points: pts.map((p) => [p.x, p.y] as [number, number]), sides,
    }]);
  };

  const pushLength = (pts: Pt[]) => {
    if (!imgSize || pxPerCm === null) return;
    const cm = lengthCm(pts[0], pts[1], imgSize, pxPerCm);
    setMeasures([...measures, {
      id: nextId(), label: `Mer ${countKind('length') + 1}`, kind: 'length', value: cm,
      points: [pts[0], pts[1]].map((p) => [p.x, p.y] as [number, number]),
    }]);
  };

  const countKind = (kind: MeasureKind) => measures.filter((m) => m.kind === kind).length;

  const undoPending = () => setPending(pending.slice(0, -1));

  const confirmCalibration = (cmOverride?: number) => {
    const cm = cmOverride ?? Number(calibInput.replace(',', '.'));
    if (!Number.isFinite(cm) || cm <= 0 || pending.length < 2 || !imgSize) return;
    // merilo iz prvega para točk (ali vseh pending točk pri površini — vzamemo prvi par)
    const scale = Math.hypot(
      ((pending[1].x - pending[0].x) / 100) * imgSize.w,
      ((pending[1].y - pending[0].y) / 100) * imgSize.h,
    ) / cm;
    setPxPerCm(scale);

    if (mode === 'area' && pending.length >= 3) {
      const area = polygonAreaM2(pending, imgSize, scale);
      const sides = polygonSidesCm(pending, imgSize, scale);
      if (area !== null) {
        setMeasures([...measures, {
          id: nextId(), label: `Površina ${countKind('area') + 1}`, kind: 'area', value: area,
          points: pending.map((p) => [p.x, p.y] as [number, number]), sides,
        }]);
      }
      setPending([]);
    } else {
      const m: PhotoMeasure = {
        id: nextId(), label: 'Merilo (umerjanje)', kind: 'length',
        value: Math.round(cm * 10) / 10,
        points: [pending[0], pending[1]].map((p) => [p.x, p.y] as [number, number]),
      };
      setMeasures([...measures, m]);
      // če je bilo 3 točk (nesmiselno za length) — počisti
      setPending([]);
    }
    setCalibOpen(false);
  };

  const resetScale = () => {
    setPxPerCm(null);
    setMeasures([]);
    setPending([]);
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
  const lengthMeasures = measures.filter((m) => m.kind === 'length' || m.kind === 'laser');

  const modeHint: Record<Mode, string> = {
    boxes: 'AI zaznani objekti — klikni fotko za merjenje.',
    length: 'Klikni 2 točki za dolžino. Prvi par umeri merilo.',
    area: 'Klikaj oglišča površine; klik na prvo oglišče (ali gumb) zapre poligon.',
    angle: 'Klikni 3 točke: krak, oglišče kota, krak.',
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

        {pxPerCm !== null && needsScale ? (
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

      <p className="text-xs text-muted-foreground">{modeHint[mode]}</p>

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

        {/* AI okviri */}
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

          {/* čakajoče točke */}
          {pending.map((p, i) => (
            <circle key={`p-${i}`} cx={p.x} cy={p.y} r={0.7} className="fill-amber-500" />
          ))}
          {/* poligon v nastajanju */}
          {mode === 'area' && pending.length >= 2 && (
            <polygon
              points={pending.map((p) => `${p.x},${p.y}`).join(' ')}
              className="fill-amber-500/20 stroke-amber-500"
              strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
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
              {formatM2(m.value ?? 0)}
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

        {/* Nitka za čakajoče točke */}
        {pending.length > 0 && pending.map((p, i) => (
          <span key={`dot-${i}`} className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        ))}
      </div>

      {/* Pomožni gumbi za poligon */}
      {mode === 'area' && pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => closeArea(pending)} disabled={pending.length < 3 || (pxPerCm === null && pending.length < 2)} className="min-h-11">
            <Maximize className="mr-1.5 h-4 w-4" />
            Zapri površino ({pending.length} oglišč)
          </Button>
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

      {/* Umerjanje */}
      {calibOpen && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" role="dialog" aria-label="Umerjanje merila">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold">Umeri merilo — koliko cm je izbrana daljica?</p>
          </div>
          {referenceLabel && (
            <p className="text-xs text-muted-foreground">
              AI predlog: <strong>{referenceLabel} ≈ {referenceCm} cm</strong>
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
                        : m.kind === 'angle' ? 'text-orange-700' : 'text-green-700'
                  }>
                    {m.value === null ? '—' : m.kind === 'area' ? formatM2(m.value) : m.kind === 'angle' ? formatDeg(m.value) : formatCm(m.value)}
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

      {/* Merilo reset */}
      {pxPerCm !== null && needsScale && (
        <Button variant="ghost" size="sm" onClick={resetScale} className="h-8 text-xs">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Ponastavi merilo (zbriše meritve)
        </Button>
      )}
    </div>
  );
}
