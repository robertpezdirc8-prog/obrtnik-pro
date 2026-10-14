'use client';

// ─── Skica prostora: tloris iz meritev sten ─────────────────
// Vnos sten (laser/glas/ročno) + notranji koti → samozapirajoč se
// tloris (Bowditch porazdelitev napake — klasična geodezija, 0 AI).
// Površina/obseg → predpolnitev kalkulatorjev (keramika, WPC terasa,
// fasada). Iskrenost: če se poligon ne zapre (> 5 %), površina NI
// izračunana — napaka je eksplicitna.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Wand2, Ruler } from 'lucide-react';
import { closeRoomPolygon, type WallInput } from '@/lib/room-sketch';
import { formatCm, formatM2 } from '@/lib/measure-geometry';
import { formatNum } from '@/lib/format';
import type { PhotoMeasure } from '@/lib/camera-types';
import type { CraftInputs } from '@/lib/types';

interface SketchWall extends WallInput {
  id: string;
}

interface RoomSketchProps {
  /** Pripomoški (laser/glas/AR) — hitri vnos »→ stena«. */
  auxMeasures: PhotoMeasure[];
  onPrefill: (
    craft: 'keramika' | 'wpc-terasa' | 'fasada',
    inputs: Partial<CraftInputs>,
  ) => void;
}

let wallSeq = 0;
const newWall = (lengthCm: number, angleDeg = 90, label?: string): SketchWall => ({
  id: `wall${++wallSeq}-${Date.now()}`,
  lengthCm,
  angleDeg,
  label,
});

export function RoomSketch({ auxMeasures, onPrefill }: RoomSketchProps) {
  const [walls, setWalls] = useState<SketchWall[]>([]);
  const [lenIn, setLenIn] = useState('');
  const [angIn, setAngIn] = useState('90');

  const addWall = (lengthCm: number, angleDeg: number, label?: string) => {
    if (!Number.isFinite(lengthCm) || lengthCm <= 0) return;
    setWalls((w) => [...w, newWall(lengthCm, angleDeg, label)]);
  };

  const updateWall = (id: string, patch: Partial<SketchWall>) =>
    setWalls((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const result = useMemo(() => closeRoomPolygon(walls), [walls]);

  // ── SVG risba ─────────────────────────────────────────────
  const svg = useMemo(() => {
    if (!result || result.vertices.length < 3) return null;
    const pts = result.vertices;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const W = 460;
    const H = 340;
    const PAD = 34;
    const k = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    // SVG y raste navzdol → zrcalimo
    const tx = (x: number) => PAD + (x - minX) * k;
    const ty = (y: number) => H - PAD - (y - minY) * k;
    const ring = pts.map((p) => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(' ');
    // oznake stranic: sredina stranice i (i → i+1 z ovitkom)
    const sideMid = Array.from({ length: result.n }, (_, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      return {
        x: tx((a.x + b.x) / 2),
        y: ty((a.y + b.y) / 2),
        text: `${result.adjustedSidesCm[i]} cm`,
      };
    });
    const verts = pts.slice(0, result.n).map((p) => ({ x: tx(p.x), y: ty(p.y) }));
    return { W, H, ring, sideMid, verts, open: result.level === 'open' };
  }, [result]);

  const usableAux = auxMeasures.filter((m) => m.value !== null && m.value > 0);

  return (
    <div className="space-y-4" data-testid="room-sketch">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Wand2 className="h-4 w-4 text-amber-600" aria-hidden />
            Skica prostora — tloris iz meritev
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Dodaj stene po obodu (laser/glas/ročno) in kote. Poligon se zapre z Bowditchovo
            porazdelitvijo napake (klasična geodezija). Kot = notranji kot ob <strong>koncu</strong>{' '}
            stene (90° pravokotno, 270° vdolben L-kot).
          </p>
        </div>
        {walls.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs text-destructive hover:text-destructive"
            onClick={() => setWalls([])}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Počisti
          </Button>
        )}
      </div>

      {/* vnos: dolžina + kot */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Dolžina stene (cm)
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.5"
            placeholder="npr. 400"
            value={lenIn}
            onChange={(e) => setLenIn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addWall(parseFloat(lenIn), parseFloat(angIn) || 90);
                setLenIn('');
              }
            }}
            className="h-11 w-32"
            aria-label="Dolžina stene v centimetrih"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Kot (°)
          <Input
            type="number"
            inputMode="numeric"
            min="20"
            max="340"
            step="5"
            value={angIn}
            onChange={(e) => setAngIn(e.target.value)}
            className="h-11 w-24"
            aria-label="Notranji kot ob koncu stene v stopinjah"
          />
        </label>
        <Button
          size="sm"
          className="h-11 min-h-11"
          onClick={() => {
            addWall(parseFloat(lenIn), parseFloat(angIn) || 90);
            setLenIn('');
          }}
          disabled={!lenIn || !(parseFloat(lenIn) > 0)}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Dodaj steno
        </Button>
      </div>

      {/* hitri vnos iz pripomočkov (laser/glas/AR) */}
      {usableAux.length > 0 && (
        <div className="rounded-xl border bg-accent/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <Ruler className="h-3.5 w-3.5 text-amber-600" aria-hidden />
            Izmerjeno s pripomočki — klikni za steno:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {usableAux.map((m) => (
              <button
                key={m.id}
                onClick={() => addWall(m.value!, 90, m.label)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px]"
                aria-label={`Dodaj steno ${m.label}, ${formatCm(m.value!)}`}
              >
                <span className="mr-1 text-muted-foreground">{m.label}</span>
                <strong className="text-green-700">{formatCm(m.value!)}</strong>
                <span className="ml-1 text-amber-600">→ stena</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* seznam sten */}
      {walls.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto scroll-area pr-1" aria-label="Seznam sten">
          {walls.map((w, i) => (
            <li
              key={w.id}
              className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm"
            >
              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                {w.label ? `${i + 1} · ${w.label}` : `Stena ${i + 1}`}
              </Badge>
              <Input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.5"
                value={w.lengthCm}
                onChange={(e) => updateWall(w.id, { lengthCm: parseFloat(e.target.value) })}
                className="h-9 w-24 text-sm"
                aria-label={`Dolžina stene ${i + 1} v centimetrih`}
              />
              <span className="text-xs text-muted-foreground">cm</span>
              <span className="ml-auto flex items-center gap-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min="20"
                  max="340"
                  step="5"
                  value={w.angleDeg}
                  onChange={(e) =>
                    updateWall(w.id, { angleDeg: parseFloat(e.target.value) || 90 })
                  }
                  className="h-9 w-18 text-sm"
                  aria-label={`Kot ob koncu stene ${i + 1} v stopinjah`}
                />
                <span className="text-xs text-muted-foreground">°</span>
                <button
                  onClick={() => setWalls((list) => list.filter((x) => x.id !== w.id))}
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Izbriši steno ${i + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* rezultat */}
      {!result && walls.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Za tloris so potrebne vsaj 3 veljavne stene.
        </p>
      )}

      {result && (
        <div className="space-y-3">
          {/* status */}
          <div className="flex flex-wrap items-center gap-2">
            {result.level === 'closed' && (
              <Badge className="border-green-300 bg-green-50 text-green-700" data-testid="skica-status">
                Zaprla se je ✓ napaka {result.closureErrorCm} cm
              </Badge>
            )}
            {result.level === 'adjusted' && (
              <Badge className="border-amber-300 bg-amber-50 text-amber-800" data-testid="skica-status">
                Poravnano (Bowditch) · napaka {result.closureErrorCm} cm ({result.closureErrorPct} %)
              </Badge>
            )}
            {result.level === 'open' && (
              <Badge variant="destructive" data-testid="skica-status">
                Se ne zapre · napaka {result.closureErrorCm} cm ({result.closureErrorPct} %)
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {result.n} sten · kotno zaprtje {result.angularMisclosureDeg}°
            </span>
          </div>

          {/* risba */}
          {svg && (
            <div className="overflow-x-auto rounded-xl border bg-background p-2">
              <svg
                viewBox={`0 0 ${svg.W} ${svg.H}`}
                className="mx-auto block h-auto w-full max-w-[460px]"
                role="img"
                aria-label={`Tloris prostora: ${result.n} sten, ${result.areaM2 !== null ? formatM2(result.areaM2) : 'se ne zapre'}`}
                data-testid="room-sketch-svg"
              >
                <polygon
                  points={svg.ring}
                  fill={svg.open ? 'transparent' : 'rgba(217,119,6,0.10)'}
                  stroke={svg.open ? '#dc2626' : '#d97706'}
                  strokeWidth={2.5}
                  strokeDasharray={svg.open ? '6 4' : undefined}
                  fillRule="evenodd"
                />
                {svg.sideMid.map((m, i) => (
                  <text
                    key={i}
                    x={m.x}
                    y={m.y - 5}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="600"
                    fill="#57534e"
                  >
                    {result.level === 'adjusted' ? `≈ ${m.text}` : m.text}
                  </text>
                ))}
                {svg.verts.map((v, i) => (
                  <circle key={i} cx={v.x} cy={v.y} r={3.4} fill="#d97706" />
                ))}
              </svg>
            </div>
          )}

          {/* statistika */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Površina tlorisa</p>
              <p className="text-sm font-bold text-green-700" data-testid="skica-area">
                {result.areaM2 !== null ? formatM2(result.areaM2) : '— (se ne zapre)'}
              </p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Obseg</p>
              <p className="text-sm font-bold">{formatCm(result.perimeterCm)}</p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Ovojnica (L × Š)</p>
              <p className="text-sm font-bold">
                {formatNum(result.bboxM.lengthM)} × {formatNum(result.bboxM.widthM)} m
              </p>
            </div>
          </div>

          {/* opozorila — iskrenost */}
          {result.warnings.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {result.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {result.level !== 'open' && (
            <p className="text-xs text-muted-foreground">
              Ovojnica (L × Š) je pri ne-pravokotnih prostorih večja od tlorisa — kalkulator
              (dolžina × širina) jo uporabi za odmerek. Dejanska površina je površina poligona
              zgoraj.
            </p>
          )}

          {/* prefill kalkulatorjev */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              size="sm"
              className="h-11 min-h-11 flex-1"
              disabled={!result.prefill.keramika}
              onClick={() => result.prefill.keramika && onPrefill('keramika', result.prefill.keramika)}
            >
              Keramika — tla
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 min-h-11 flex-1"
              disabled={!result.prefill['wpc-terasa']}
              onClick={() =>
                result.prefill['wpc-terasa'] && onPrefill('wpc-terasa', result.prefill['wpc-terasa'])
              }
            >
              WPC terasa
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 min-h-11 flex-1"
              disabled={!result.prefill.fasada}
              onClick={() => result.prefill.fasada && onPrefill('fasada', result.prefill.fasada)}
            >
              Fasada — obseg
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
