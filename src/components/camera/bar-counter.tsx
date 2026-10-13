'use client';

// ─── Števec palic: trak čez vrsto palic → št. kosov, razmak, debelina ──
// Deterministična meritvena skripta (0 AI): uporabnik klikne 2 točki
// čez vrsto ograjnih palic/lamel/piket, vpiše realno dolžino (ali vzame
// predlog iz referenčnega objekta analize) in skripta iz projekcijskega
// profila prešteje palice ter izmeri razmak/debelino v cm.
// Rezultat gre v meritve IN kot predlog parametrov v Vizualizer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Hash, RotateCcw, Wand2, Ruler, LayoutGrid, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { refBoxHeightPx } from '@/lib/measure-geometry';
import {
  analyzeBarStrip, calibrateStrip, suggestVizParams,
  type BarDims, type PctPoint, type RgbaImage, type VizBarSuggest,
} from '@/lib/bar-count';

interface BarCounterProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  onMeasure: (label: string, cm: number) => void;
  onSuggest: (s: VizBarSuggest) => void;
}

type Pt = PctPoint;

function distPct(a: Pt, b: Pt, w: number, h: number): number {
  const dx = ((b.x - a.x) / 100) * w;
  const dy = ((b.y - a.y) / 100) * h;
  return Math.hypot(dx, dy);
}

const CONF_STYLE: Record<BarDims['confidence'], { label: string; cls: string }> = {
  visoka: { label: 'kakovost: visoka', cls: 'text-green-700 border-green-300 bg-green-50' },
  srednja: { label: 'kakovost: srednja', cls: 'text-amber-700 border-amber-300 bg-amber-50' },
  nizka: { label: 'kakovost: nizka', cls: 'text-red-700 border-red-300 bg-red-50' },
};

export function BarCounter({ dataUrl, reference, onMeasure, onSuggest }: BarCounterProps) {
  const { toast } = useToast();
  const stageRef = useRef<HTMLDivElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [a, setA] = useState<Pt | null>(null);
  const [b, setB] = useState<Pt | null>(null);
  const [realCm, setRealCm] = useState('');
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<BarDims | null>(null);
  /** Vsebinski okvir slike znotraj stage (object-contain letterbox) v % stage-a. */
  const [content, setContent] = useState<{ ox: number; oy: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!dataUrl) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = dataUrl;
    return () => { alive = false; };
  }, [dataUrl]);

  // Vsebinski okvir (object-contain): kliki in SVG morajo slediti sliki,
  // ne letterbox praznine okoli nje.
  const updateContent = useCallback(() => {
    const stage = stageRef.current;
    const img = stage?.querySelector('img');
    if (!stage || !img || !img.naturalWidth || !img.naturalHeight) { setContent(null); return; }
    const r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    setContent({
      ox: ((r.width - dw) / 2 / r.width) * 100,
      oy: ((r.height - dh) / 2 / r.height) * 100,
      w: (dw / r.width) * 100,
      h: (dh / r.height) * 100,
    });
  }, []);

  useEffect(() => {
    updateContent();
    window.addEventListener('resize', updateContent);
    return () => window.removeEventListener('resize', updateContent);
  }, [imgEl, updateContent]);

  const reset = () => { setA(null); setB(null); setDims(null); setRealCm(''); };

  // Novo fotko → počisti
  useEffect(() => { reset(); }, [dataUrl]);

  // Predlog realne dolžine iz referenčnega objekta (px→cm skala)
  // LEKCIJA Task 30: referenceBox = [x0, y0, ŠIRINA, VIŠINA] — box[3] je višina.
  const refSuggestCm = useMemo(() => {
    if (!imgEl || !reference || !a || !b) return null;
    const boxH = refBoxHeightPx(reference.box, imgEl.naturalHeight);
    if (boxH < 8) return null;
    const pxPerCm = boxH / Math.max(1, reference.assumedCm);
    const segPx = distPct(a, b, imgEl.naturalWidth, imgEl.naturalHeight);
    const cm = segPx / pxPerCm;
    return cm >= 10 && cm <= 3000 ? Math.round(cm) : null;
  }, [imgEl, reference, a, b]);

  const clickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgEl || busy) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !content) return;
    // preslikaj clientXY → % vsebine slike (ne stage-a)
    const ox = rect.left + (content.ox / 100) * rect.width;
    const oy = rect.top + (content.oy / 100) * rect.height;
    const dw = (content.w / 100) * rect.width;
    const dh = (content.h / 100) * rect.height;
    if (dw < 2 || dh < 2) return;
    const p: Pt = {
      x: Math.max(0, Math.min(100, ((e.clientX - ox) / dw) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - oy) / dh) * 100)),
    };
    setDims(null);
    if (!a || (a && b)) { setA(p); setB(null); }
    else setB(p);
  };

  const run = () => {
    if (!imgEl || !a || !b) return;
    const cm = Number(realCm);
    if (!Number.isFinite(cm) || cm < 10) {
      toast({ title: 'Vpiši realno dolžino med točkama (≥ 10 cm)', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const cv = document.createElement('canvas');
      cv.width = imgEl.naturalWidth;
      cv.height = imgEl.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(imgEl, 0, 0);
      const imageData = ctx.getImageData(0, 0, cv.width, cv.height);
      const img: RgbaImage = { width: imageData.width, height: imageData.height, data: imageData.data };
      const prof = analyzeBarStrip({ img, p0: a, p1: b });
      const d = calibrateStrip(prof, cm);
      setDims(d);
      if (d.count < 2) {
        toast({
          title: 'Palic ni bilo mogoče prešteti',
          description: 'Potegni trak pravokotno čez vrsto palic, čez vsaj 3–4 palice.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: 'Analiza traku ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const sendMeasures = () => {
    if (!dims || dims.count < 2) return;
    onMeasure('Razmak palic (os–os)', Math.round(dims.pitchCm * 10) / 10);
    if (dims.barWidthCm >= 0.3) onMeasure('Debelina palice', Math.round(dims.barWidthCm * 10) / 10);
    toast({ title: 'Meritve dodane ✓', description: `Razmak ${dims.pitchCm.toFixed(1)} cm · debelina ${dims.barWidthCm.toFixed(1)} cm` });
  };

  const sendToViz = () => {
    if (!dims || dims.count < 2) return;
    onSuggest(suggestVizParams(dims));
    toast({ title: 'Predlog poslan v Vizualizer ✓', description: 'Zavihek Vizualizer — uporabi izmerjene vrednosti.' });
  };

  const hasBoth = a !== null && b !== null;
  const conf = dims ? CONF_STYLE[dims.confidence] : null;

  // Geometrija overlayja (SVG viewBox 0 0 100 100)
  const segLen = imgEl && a && b ? distPct(a, b, imgEl.naturalWidth, imgEl.naturalHeight) : 0;

  return (
    <div className="space-y-3" data-testid="bar-counter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Hash className="h-4 w-4 text-primary" />
          Števec palic — trak čez vrsto
        </h3>
        <Badge variant="secondary" className="text-[10px]">skripta · 0 AI</Badge>
      </div>

      {!dataUrl && (
        <p className="text-sm text-muted-foreground">
          Najprej posneti ali naloži fotografijo (zavihek Zajem) — potem klikni 2 točki čez vrsto palic.
        </p>
      )}

      {dataUrl && (
        <>
          <p className="text-xs text-muted-foreground">
            Klikni <strong>2 točki</strong> na fotki: trak naj poteka pravokotno čez vrsto palic
            (čez vsaj 3–4 palice). Točki naj bosta nad znano dolžino (npr. razpon med stebri).
          </p>

          <div
            ref={stageRef}
            onClick={clickStage}
            className="relative overflow-hidden rounded-lg border bg-secondary/30 cursor-crosshair select-none"
            data-testid="bar-stage"
          >
            <img src={dataUrl} alt="Fotografija za štetje palic" className="block max-h-72 w-full object-contain" draggable={false} />
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute"
              style={{
                left: `${content?.ox ?? 0}%`,
                top: `${content?.oy ?? 0}%`,
                width: `${content?.w ?? 100}%`,
                height: `${content?.h ?? 100}%`,
              }}
            >
              {a && (
                <circle cx={a.x} cy={a.y} r="1.1" fill="#16a34a" stroke="white" strokeWidth="0.35" data-testid="bar-point-a" />
              )}
              {b && (
                <circle cx={b.x} cy={b.y} r="1.1" fill="#16a34a" stroke="white" strokeWidth="0.35" data-testid="bar-point-b" />
              )}
              {a && b && (
                <>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#16a34a" strokeWidth="0.7" strokeDasharray="2 1.2" />
                  {/* pas ± ~1,4 % manjše dimenzije slike */}
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="#16a34a" strokeOpacity="0.18" strokeWidth="2.8" strokeLinecap="butt"
                  />
                </>
              )}
              {a && b && dims && dims.positions.length >= 2 && (() => {
                // črtice na središčih palic vzdolž traku (pravokotno na trak)
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const px = (-dy / len) * 1.6;
                const py = (dx / len) * 1.6;
                return dims.positions.map((f, i) => {
                  const cx = a.x + dx * f;
                  const cy = a.y + dy * f;
                  return (
                    <line
                      key={i}
                      x1={cx - px} y1={cy - py} x2={cx + px} y2={cy + py}
                      stroke="#fbbf24" strokeWidth="0.5" strokeLinecap="round"
                    />
                  );
                });
              })()}
            </svg>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label className="text-xs font-medium" htmlFor="bar-realcm">
                Realna dolžina med točkama (cm)
              </Label>
              <Input
                id="bar-realcm"
                type="number"
                min={10}
                max={3000}
                placeholder="npr. 150"
                value={realCm}
                onChange={(e) => setRealCm(e.target.value)}
                data-testid="bar-realcm"
              />
              {refSuggestCm !== null && (
                <button
                  className="text-[11px] font-medium text-primary underline underline-offset-2"
                  onClick={() => setRealCm(String(refSuggestCm))}
                  data-testid="bar-ref-suggest"
                >
                  Predlog iz referenčnega objekta: {refSuggestCm} cm
                </button>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" className="min-h-10" onClick={run} disabled={!hasBoth || busy} data-testid="bar-run">
                <Wand2 className="mr-1.5 h-4 w-4" />
                {busy ? 'Štejem…' : 'Preštej palice'}
              </Button>
              <Button size="sm" variant="ghost" className="min-h-10" onClick={reset} disabled={busy} aria-label="Ponastavi trak">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!hasBoth && (
            <p className="text-[11px] text-muted-foreground">
              {a ? 'Zdaj klikni drugo točko…' : 'Klikni prvo točko…'} · dolžina traku: {segLen > 0 ? 'ok' : '—'}
            </p>
          )}

          {dims && (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3" data-testid="bar-result">
              {dims.count >= 2 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="text-[11px]" data-testid="bar-count">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      {dims.count} palic na traku
                    </Badge>
                    {conf && (
                      <Badge variant="outline" className={`text-[10px] ${conf.cls}`} data-testid="bar-conf">
                        {conf.label}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-[10px] text-muted-foreground">Razmak (os–os)</p>
                      <p className="font-bold" data-testid="bar-pitch">{dims.pitchCm.toFixed(1)} cm</p>
                    </div>
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-[10px] text-muted-foreground">Debelina palice</p>
                      <p className="font-bold" data-testid="bar-width">{dims.barWidthCm.toFixed(1)} cm</p>
                    </div>
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-[10px] text-muted-foreground">Reža</p>
                      <p className="font-bold">{dims.gapCm.toFixed(1)} cm</p>
                    </div>
                    <div className="rounded-md border bg-card p-2">
                      <p className="text-[10px] text-muted-foreground">Kosov / meter</p>
                      <p className="font-bold">{dims.barsPerMeter.toFixed(1)}</p>
                    </div>
                  </div>
                  {dims.confidence === 'nizka' && (
                    <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Slab kontrast ali nepravilen trak — poskusi širši pas čez izrazite palice.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={sendMeasures} data-testid="bar-to-measures">
                      <Ruler className="mr-1 h-3.5 w-3.5" />
                      V meritve
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-9 text-xs" onClick={sendToViz} data-testid="bar-to-viz">
                      <LayoutGrid className="mr-1 h-3.5 w-3.5" />
                      V Vizualizer
                    </Button>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Ni zaznanih palic — trak naj poteka pravokotno čez vrsto, ne vzporedno.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
