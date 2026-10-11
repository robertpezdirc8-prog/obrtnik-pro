'use client';

// ─── Foto platno: AI okviri objektov + merjenje po fotografiji ──
// Dva načina:
//  1. "Prepoznavanje" — prikaz AI zaznanih objektov (AR oznake)
//  2. "Merjenje" — klikni 2 točki: prvi par umeri merilo (vneseš
//     pravo dolžino), vsak nadaljnji par pa se izmeri samodejno v cm.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Ruler, Tags, RotateCcw, Check, X, Crosshair } from 'lucide-react';
import type { DetectedObject, PhotoMeasure } from '@/lib/camera-types';

interface Pt { x: number; y: number } // % koordinati

interface PhotoCanvasProps {
  dataUrl: string;
  objects: DetectedObject[];
  referenceLabel?: string;
  referenceCm?: number;
  measures: PhotoMeasure[];
  setMeasures: (m: PhotoMeasure[]) => void;
}

let measureSeq = 0;

export function PhotoCanvas({ dataUrl, objects, referenceLabel, referenceCm, measures, setMeasures }: PhotoCanvasProps) {
  const [mode, setMode] = useState<'boxes' | 'measure'>('boxes');
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [pending, setPending] = useState<Pt[]>([]);
  const [pxPerCm, setPxPerCm] = useState<number | null>(null);
  const [calibInput, setCalibInput] = useState<string>(referenceCm ? String(referenceCm) : '');
  const [calibOpen, setCalibOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'measure') return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
    const next = [...pending, pt];
    if (next.length === 2) {
      if (pxPerCm === null) {
        setPending(next);
        setCalibOpen(true);
      } else {
        setPending([]);
        const m = makeMeasure(next, pxPerCm, imgSize, false);
        if (m) setMeasures([...measures, m]);
      }
    } else {
      setPending(next);
    }
  };

  const confirmCalibration = () => {
    const cm = Number(calibInput.replace(',', '.'));
    if (!Number.isFinite(cm) || cm <= 0 || pending.length !== 2 || !imgSize) return;
    const scale = pxDistance(pending[0], pending[1], imgSize) / cm;
    setPxPerCm(scale);
    const m = makeMeasure(pending, scale, imgSize, true);
    if (m) setMeasures([...measures, m]);
    setCalibOpen(false);
    setPending([]);
  };

  const cancelCalibration = () => {
    setCalibOpen(false);
    setPending([]);
  };

  const resetScale = () => {
    setPxPerCm(null);
    setMeasures([]);
    setPending([]);
  };

  const removeMeasure = (id: string) => setMeasures(measures.filter((m) => m.id !== id));

  return (
    <div className="space-y-3">
      {/* Preklop načina */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5 bg-secondary/50">
          <button
            onClick={() => { setMode('boxes'); setPending([]); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === 'boxes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={mode === 'boxes'}
          >
            <Tags className="h-4 w-4" />
            Prepoznavanje
          </button>
          <button
            onClick={() => setMode('measure')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${mode === 'measure' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={mode === 'measure'}
          >
            <Ruler className="h-4 w-4" />
            Merjenje
          </button>
        </div>

        {pxPerCm !== null ? (
          <Badge variant="outline" className="gap-1.5">
            <Check className="h-3 w-3 text-green-600" />
            Merilo: 1 cm ≈ {(1 / pxPerCm).toFixed(1)} px
          </Badge>
        ) : mode === 'measure' ? (
          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
            Klikni 2 točki z znano dolžino za umerjanje
          </Badge>
        ) : null}

        {pxPerCm !== null && (
          <Button variant="ghost" size="sm" onClick={resetScale} className="h-8 text-xs">
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Ponastavi merilo
          </Button>
        )}
      </div>

      {/* Fotografija z overlay */}
      <div
        ref={boxRef}
        onClick={addPoint}
        className={`relative w-full overflow-hidden rounded-xl border bg-secondary select-none ${mode === 'measure' ? 'cursor-crosshair' : ''}`}
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

        {/* Merjene daljice + točke */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full pointer-events-none">
          {measures.map((m) => (
            <g key={m.id}>
              <line
                x1={m.points[0][0]} y1={m.points[0][1]}
                x2={m.points[1][0]} y2={m.points[1][1]}
                stroke="currentColor" strokeWidth={2.5}
                className="text-green-600" vectorEffect="non-scaling-stroke" strokeDasharray={m.cm === null ? '6 4' : undefined}
              />
            </g>
          ))}
          {pending.map((p, i) => (
            <circle key={`p-${i}`} cx={p.x} cy={p.y} r={0.7} className="fill-amber-500" />
          ))}
          {pending.length === 1 && (
            <line
              x1={pending[0].x} y1={pending[0].y}
              x2={pending[0].x} y2={pending[0].y}
              stroke="transparent"
            />
          )}
        </svg>

        {/* Oznake izmerjenih dolžin */}
        {measures.filter((m) => m.cm !== null).map((m) => {
          const mx = (m.points[0][0] + m.points[1][0]) / 2;
          const my = (m.points[0][1] + m.points[1][1]) / 2;
          return (
            <span
              key={`lbl-${m.id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
              style={{ left: `${mx}%`, top: `${my}%` }}
            >
              {m.label}: {formatCm(m.cm!)}
            </span>
          );
        })}

        {/* Nitka za čakajoči par */}
        {pending.length === 1 && (
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow"
            style={{ left: `${pending[0].x}%`, top: `${pending[0].y}%` }}
          />
        )}
      </div>

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
            <Button size="sm" onClick={confirmCalibration} disabled={!calibInput}>
              <Check className="mr-1 h-4 w-4" />
              Umeri
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelCalibration}>
              <X className="mr-1 h-4 w-4" />
              Prekliči
            </Button>
          </div>
        </div>
      )}

      {/* Seznam meritev */}
      {measures.length > 0 && (
        <div className="rounded-xl border p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Izmerjeno ({measures.length})</Label>
          </div>
          <ul className="space-y-1">
            {measures.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm">
                <span className="font-medium">{m.label}</span>
                <span className="flex items-center gap-2">
                  <strong className={m.cm === null ? 'text-muted-foreground' : 'text-green-700'}>
                    {m.cm === null ? '—' : formatCm(m.cm)}
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
    </div>
  );
}

// ─── Pomožne funkcije ───────────────────────────────────────

function pxDistance(a: Pt, b: Pt, size: { w: number; h: number }): number {
  const ax = (a.x / 100) * size.w;
  const ay = (a.y / 100) * size.h;
  const bx = (b.x / 100) * size.w;
  const by = (b.y / 100) * size.h;
  return Math.hypot(bx - ax, by - ay);
}

function makeMeasure(pts: Pt[], scale: number | null, size: { w: number; h: number } | null, isCalibration: boolean): PhotoMeasure | null {
  if (!size) return null;
  measureSeq += 1;
  return {
    id: `m${measureSeq}-${Date.now()}`,
    label: isCalibration ? 'Merilo (umerjanje)' : `Mer ${measureSeq}`,
    cm: scale && size ? Math.round(pxDistance(pts[0], pts[1], size) / scale * 10) / 10 : null,
    points: [[pts[0].x, pts[0].y], [pts[1].x, pts[1].y]],
  };
}

function formatCm(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2).replace('.', ',')} m` : `${cm.toFixed(0)} cm`;
}
