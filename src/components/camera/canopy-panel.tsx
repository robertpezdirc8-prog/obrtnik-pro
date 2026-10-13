'use client';

// ─── Nadstrešek — samodejna meritev s fotke (meritvena skripta, 0 AI) ──
// Dve fotki, en panel: FRONTALNA fotka → rob kritine (Hough) → ŠIRINA
// (kalibracija po referenci); STRANSKA fotka → poševni rob → NAKLON
// (brezplačen) + GLOBINA = vodoravna projekcija. Delna mera (širina)
// preživi menjavo fotke (živi v staršu — camera-view). Kombiniran
// rezultat (površina, kritina po naklonu, stebri) → prefill kalkulatorja.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Umbrella, Wand2, RotateCcw, AlertTriangle, Copy, Check, MousePointerClick, Ruler } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  detectCanopyLine, measureFromPoints, refPxPerCm, suggestPosts, measureCanopy, formatCanopyText,
  type RgbaImage, type PctLine, type CanopyMode, type CanopyMeasureResult,
} from '@/lib/canopy-analysis';
import type { XY } from '@/lib/measure-geometry';
import { refBoxHeightPx } from '@/lib/measure-geometry';

export interface CanopyPartial {
  /** Širina v cm (null = ni izmerjena). */
  widthCm: number | null;
  /** Izvor: oznaka fotke (rep dataUrl) ali 'rocno'. */
  widthTag: string | null;
  /** Globina v cm (vodoravna projekcija) ali null. */
  depthCm: number | null;
  /** Naklon v stopinjah ali null. */
  slopeDeg: number | null;
  depthTag: string | null;
}

interface CanopyPanelProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Delna mera, ki preživi menjavo fotke (lastnik: camera-view). */
  partial: CanopyPartial | null;
  onPartial: (p: CanopyPartial) => void;
  /** Pošlji izmerjene mere v kalkulator nadstreškov. */
  onSendToCalculator?: (inputs: { canopyWidth?: number; canopyDepth?: number; canopyPosts?: number; canopyCover?: 'ploc' | 'polikar' | 'steklo' }) => void;
}

type Cover = 'ploc' | 'polikar' | 'steklo';

const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',');
const fmt2 = (v: number): string => v.toFixed(2).replace('.', ',');
const tagOf = (dataUrl: string): string => dataUrl.slice(-24);
const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

const SLOPE_CHIPS = [5, 10, 15, 20];
const POST_CHIPS = [2, 3, 4];
const COVERS: { v: Cover; label: string }[] = [
  { v: 'ploc', label: 'Pločevina' },
  { v: 'polikar', label: 'Polikarbonat' },
  { v: 'steklo', label: 'Steklo' },
];

export function CanopyPanel({ dataUrl, reference, partial, onPartial, onSendToCalculator }: CanopyPanelProps) {
  const { toast } = useToast();
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<CanopyMode>(partial?.widthCm == null ? 'width' : 'depth');
  const [points, setPoints] = useState<XY[]>([]);
  const [proposal, setProposal] = useState<PctLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slopeSel, setSlopeSel] = useState<number | null>(partial?.slopeDeg ?? null);
  const [postsSel, setPostsSel] = useState<number | null>(null);
  const [coverSel, setCoverSel] = useState<Cover>('ploc');
  const [manualW, setManualW] = useState('');
  const [manualD, setManualD] = useState('');
  const imgBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dataUrl) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = dataUrl;
    return () => { alive = false; };
  }, [dataUrl]);

  const p = partial ?? { widthCm: null, widthTag: null, depthCm: null, slopeDeg: null, depthTag: null };
  const tag = dataUrl ? tagOf(dataUrl) : null;

  /** Merilo na delovni sliki (iz referenčnega okvirja v naravnih pikslih). */
  const calcPxPerCm = useCallback((workScale: number): number | null => {
    if (!imgEl || !reference) return null;
    // box = [x0, y0, ŠIRINA, VIŠINA] v % (buildScaleSuggestions) — box[3] je višina
    const boxH = refBoxHeightPx(reference.box, imgEl.naturalHeight);
    return refPxPerCm(boxH, reference.assumedCm, workScale);
  }, [imgEl, reference]);

  const workOf = (img: HTMLImageElement): { work: { w: number; h: number }; scale: number; rgba: RgbaImage } | null => {
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(8, Math.round(img.naturalWidth * scale));
    const h = Math.max(8, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { work: { w, h }, scale, rgba: { width: w, height: h, data: data.data } };
  };

  /** Shrani meritev načina v delno stanje (preživi menjavo fotke). */
  const saveMeasure = (m: ReturnType<typeof measureFromPoints>, mMode: CanopyMode) => {
    const next: CanopyPartial = { ...p };
    if (mMode === 'width') {
      if (m.lenCm === null) {
        toast({
          title: 'Kalibracija manjka',
          description: 'Širine ne morem prevesti v cm — umeri po referenci (vrata/okno) ali vpiši širino ročno.',
          variant: 'destructive',
        });
        return false;
      }
      next.widthCm = Math.round(m.lenCm * 10) / 10;
      next.widthTag = tag;
      onPartial(next);
      toast({
        title: `Širina shranjena: ${fmt2(next.widthCm / 100)} m ✓`,
        description: 'Zdaj naloži/zamenjaj na STRANSKO fotko za globino in naklon.',
      });
      setMode('depth');
    } else {
      next.slopeDeg = Math.round(m.angleDeg * 10) / 10;
      next.depthTag = tag;
      if (m.horizCm !== null) {
        next.depthCm = Math.round(m.horizCm * 10) / 10;
        toast({
          title: `Globina ${fmt2(next.depthCm! / 100)} m · naklon ${fmt1(next.slopeDeg!)}° ✓`,
          description: m.lenCm !== null ? `Poševno: ${fmt2(m.lenCm / 100)} m · dvig ${fmt1(m.riseCm ?? 0)} cm` : undefined,
        });
      } else {
        toast({
          title: `Naklon ${fmt1(next.slopeDeg!)}° shranjen ✓`,
          description: 'Brez kalibracije je samo kot — globino umeri ali vpiši ročno.',
        });
      }
      onPartial(next);
    }
    setSlopeSel(next.slopeDeg);
    return true;
  };

  /** Klik na fotko = merilna točka (2 točki → meritev). */
  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgEl || points.length >= 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < -0.5 || x > 100.5 || y < -0.5 || y > 100.5) return;
    const next = [...points, { x, y }];
    setPoints(next);
    setProposal(null);
    if (next.length === 2) {
      const wk = workOf(imgEl);
      if (!wk) return;
      const ppc = calcPxPerCm(wk.scale);
      const m = measureFromPoints(next[0], next[1], wk.work, ppc);
      saveMeasure(m, mode);
      setTimeout(() => setPoints([]), 900); // pokaži točki, počisti po meritvi
    }
  };

  /** Samodejna detekcija roba kritine za aktivni način. */
  const run = async () => {
    if (!imgEl || busy) return;
    setBusy(true);
    setProposal(null);
    try {
      const wk = workOf(imgEl);
      if (!wk) throw new Error('canvas ni na voljo');
      const r = detectCanopyLine(wk.rgba, mode);
      if (!r.ok || !r.seg) {
        toast({ title: 'Roba kritine nisem zaznal', description: r.warnings[0] ?? 'Poskusi z 2 klikoma na robu kritine.', variant: 'destructive' });
        return;
      }
      const a: XY = { x: r.seg.x1, y: r.seg.y1 };
      const b: XY = { x: r.seg.x2, y: r.seg.y2 };
      setPoints([a, b]);
      const ppc = calcPxPerCm(wk.scale);
      const m = measureFromPoints(a, b, wk.work, ppc);
      if (mode === 'width' && m.lenCm === null) {
        // pokaži predlog kot črtkano linijo — uporabnik umeri in klikne
        setProposal(r.seg);
        toast({
          title: `Rob zaznan (trdost ${Math.round(r.strength * 100)} %), kalibracija manjka`,
          description: 'Umeri po referenci ali vpiši širino ročno — potem znova Zaznaj.',
        });
        return;
      }
      saveMeasure(m, mode);
    } catch {
      toast({ title: 'Analiza ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const resetPoints = () => {
    setPoints([]); setProposal(null);
  };

  const setManualWidth = (s: string) => {
    setManualW(s);
    const v = num(s);
    if (v) onPartial({ ...p, widthCm: Math.round(v * 1000) / 10, widthTag: 'rocno' });
  };
  const setManualDepth = (s: string) => {
    setManualD(s);
    const v = num(s);
    if (v) onPartial({ ...p, depthCm: Math.round(v * 1000) / 10, depthTag: 'rocno' });
  };

  const widthM = p.widthCm ? p.widthCm / 100 : null;
  const depthM = p.depthCm ? p.depthCm / 100 : null;
  const res: CanopyMeasureResult = measureCanopy({
    widthM, depthM, slopeDeg: slopeSel, posts: postsSel,
  });
  const activePosts = postsSel ?? res.posts ?? null;

  const srcLabel = (t: string | null): string =>
    t === 'rocno' ? 'ročno' : t !== null && tag !== null && t === tag ? 'trenutna fotka' : t ? 'druga fotka' : '';

  const summaryText = (): string => {
    if (widthM === null || depthM === null) return '';
    const m = measureCanopy({ widthM, depthM, slopeDeg: slopeSel, posts: activePosts });
    return formatCanopyText({ ...m, widthM, depthM, slopeDeg: slopeSel });
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const sendToCalc = () => {
    if (!onSendToCalculator) return;
    if (widthM === null || depthM === null) {
      toast({
        title: 'Manjka širina ali globina',
        description: 'Kalkulator potrebuje obe meri — izmeri frontalno + stransko fotko ali vpiši ročno.',
        variant: 'destructive',
      });
      return;
    }
    onSendToCalculator({
      canopyWidth: Number(widthM.toFixed(2)),
      canopyDepth: Number(depthM.toFixed(2)),
      canopyPosts: activePosts ?? undefined,
      canopyCover: coverSel,
    });
    toast({ title: 'Poslano v kalkulator nadstreškov ✓', description: `${fmt2(widthM)} × ${fmt2(depthM)} m · ${activePosts ?? 2} stebri · ${COVERS.find((c) => c.v === coverSel)?.label}` });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži FRONTALNO fotko nadstreška (rob kritine vodoravno, vrata/okno v kadru za merilo) —
        skripta zazna rob in izmeri širino; s STRANSKO fotko dobiš še globino in naklon.
      </p>
    );
  }

  const refLabel = reference ? (reference.assumedCm >= 150 ? 'Vrata' : 'Referenca') : null;
  const bothDone = widthM !== null && depthM !== null;

  return (
    <div className="space-y-3" data-testid="canopy-panel">
      {/* Slika + točke/predlog */}
      <div
        ref={imgBoxRef}
        className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border bg-stone-100"
        data-testid="canopy-image"
        onClick={addPoint}
        role="application"
        aria-label="Fotografija nadstreška — klik za merilni točki"
      >
        <img src={dataUrl} alt="Fotografija nadstreška" className="mx-auto max-h-64 w-auto object-contain" />
        {proposal && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line
              x1={proposal.x1} y1={proposal.y1} x2={proposal.x2} y2={proposal.y2}
              stroke="#d97706" strokeWidth={2} strokeDasharray="4 3" opacity={0.85} vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {points.length === 2 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line
              x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y}
              stroke="#16a34a" strokeWidth={2} opacity={0.85} vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {points.map((pt, i) => (
          <span
            key={`p${i}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
            style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
          >
            {i + 1}
          </span>
        ))}
        <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[11px] font-medium text-white">
          {mode === 'width' ? 'Frontalna fotka: 2 klika na sprednji rob kritine (ali Zaznaj)' : 'Stranska fotka: 2 klika po robu kritine od stene do spredaj'}
        </div>
      </div>

      {/* Način + kalibracija */}
      <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Merilni način">
          <span className="text-xs font-medium">Meri:</span>
          <button
            type="button"
            data-testid="canopy-mode-width"
            aria-pressed={mode === 'width'}
            onClick={() => { setMode('width'); resetPoints(); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              mode === 'width' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            1 · Širina (fronta){p.widthCm != null ? ` · ${fmt2(p.widthCm / 100)} m ✓` : ''}
          </button>
          <button
            type="button"
            data-testid="canopy-mode-depth"
            aria-pressed={mode === 'depth'}
            onClick={() => { setMode('depth'); resetPoints(); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              mode === 'depth' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            2 · Globina + naklon (stran){p.depthCm != null ? ` · ${fmt2(p.depthCm / 100)} m ✓` : ''}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
          {refLabel ? (
            <span className="text-xs text-muted-foreground">
              Merilo: <span className="font-medium text-foreground">{refLabel} {reference!.assumedCm} cm</span> (iz analize)
            </span>
          ) : (
            <span className="text-xs text-amber-700">
              Referenčni objekt ni zaznan — širine ne morem prevesti v cm. Vpiši jo ročno v rezultatu.
            </span>
          )}
        </div>
        {mode === 'depth' && p.widthCm != null && p.depthCm == null && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
            Širina je shranjena ({fmt2(p.widthCm / 100)} m). Naloži/zamenjaj na <b>STRANSKO</b> fotko
            (rob kritine od stene do spredaj) in klikni Zaznaj — naklon dobiš brez kalibracije.
          </p>
        )}
        {bothDone && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800" role="status">
            Obе mere izmerjene ({fmt2(widthM!)} × {fmt2(depthM!)} m) — spodaj preveri površino, stebre in kritino ter pošlji v kalkulator.
          </p>
        )}
      </div>

      {/* Akcije */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-10" data-testid="canopy-run" onClick={() => void run()} disabled={busy}>
          <Wand2 className="mr-1.5 h-4 w-4" />
          {busy ? 'Zaznavam rob…' : mode === 'width' ? 'Zaznaj rob kritine (širina)' : 'Zaznaj rob kritine (naklon)'}
        </Button>
        <Button size="sm" variant="outline" className="min-h-10" onClick={() => { resetPoints(); }} data-testid="canopy-clear">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Počisti točke
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Naklon je KOT in je brezplačen (kalibracija ni potrebna); kalibracija je potrebna samo za cm
        (širina, globina). Klikni 2 točki ali pusti skripto — predlog lahko vedno popraviš s klikoma.
      </p>

      {/* Rezultat */}
      <div className="space-y-3 rounded-xl border p-3" data-testid="canopy-result">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Umbrella className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Meritev nadstreška</span>
          </div>
          {(p.widthCm != null || p.depthCm != null) && (
            <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
              {p.widthCm != null ? `Š ${fmt2(p.widthCm / 100)} m` : 'Š —'} · {p.depthCm != null ? `G ${fmt2(p.depthCm / 100)} m` : 'G —'}{p.slopeDeg != null ? ` · ${fmt1(p.slopeDeg)}°` : ''}
            </Badge>
          )}
        </div>

        {/* Stanje mer */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="canopy-width-state">
            <div className="text-[11px] text-muted-foreground">Širina (fronta)</div>
            <div className="text-lg font-bold">
              {p.widthCm != null ? <>≈ {fmt2(p.widthCm / 100)} <span className="text-xs font-medium">m</span></> : '—'}
            </div>
            {p.widthTag && <div className="text-[10px] text-muted-foreground">{srcLabel(p.widthTag)}</div>}
          </div>
          <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="canopy-depth-state">
            <div className="text-[11px] text-muted-foreground">Globina{p.slopeDeg != null ? ` (naklon ${fmt1(p.slopeDeg)}°)` : ''}</div>
            <div className="text-lg font-bold">
              {p.depthCm != null ? <>≈ {fmt2(p.depthCm / 100)} <span className="text-xs font-medium">m</span></> : '—'}
            </div>
            {p.depthTag && <div className="text-[10px] text-muted-foreground">{srcLabel(p.depthTag)}</div>}
          </div>
        </div>

        {/* Ročni vnos */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="canopy-manual-w" className="text-xs font-medium">Širina ročno (m)</Label>
            <Input
              id="canopy-manual-w" inputMode="decimal" placeholder="npr. 4,8" value={manualW}
              onChange={(e) => setManualWidth(e.target.value)} className="min-h-10" aria-label="Širina nadstreška v metrih"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="canopy-manual-d" className="text-xs font-medium">Globina ročno (m)</Label>
            <Input
              id="canopy-manual-d" inputMode="decimal" placeholder="npr. 3" value={manualD}
              onChange={(e) => setManualDepth(e.target.value)} className="min-h-10" aria-label="Globina nadstreška v metrih"
            />
          </div>
        </div>

        {/* Naklon */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Naklon kritine</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Naklon kritine">
            {p.slopeDeg != null && (
              <button
                type="button" aria-pressed={slopeSel === p.slopeDeg} onClick={() => setSlopeSel(p.slopeDeg)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  slopeSel === p.slopeDeg ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                Merjeno · {fmt1(p.slopeDeg)}°
              </button>
            )}
            {SLOPE_CHIPS.map((s) => (
              <button
                key={s} type="button" aria-pressed={slopeSel === s} onClick={() => setSlopeSel(s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  slopeSel === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                {s}°{s === 10 && p.slopeDeg == null ? ' · običajno' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Geometrija */}
        {res.ok && widthM !== null && depthM !== null ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="canopy-geometry">
              <div className="rounded-lg bg-green-50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Površina</div>
                <div className="text-lg font-bold" data-testid="canopy-area">{fmt2(res.areaM2 ?? 0)} <span className="text-xs font-medium">m²</span></div>
              </div>
              <div className="rounded-lg bg-green-50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Kritina po naklonu</div>
                <div className="text-lg font-bold">{res.roofAreaM2 !== null ? fmt2(res.roofAreaM2) : fmt2(res.areaM2 ?? 0)} <span className="text-xs font-medium">m²</span></div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Dvig spredaj</div>
                <div className="text-lg font-bold">{res.riseCm !== null ? fmt1(res.riseCm) : '—'} <span className="text-xs font-medium">cm</span></div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Odmerek (Š × G)</div>
                <div className="text-sm font-bold">{fmt2(widthM)} × {fmt2(depthM)} m</div>
              </div>
            </div>

            {/* Stebri */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Št. stebrov (predlog po razponu — jeklo 80×80)</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Število stebrov">
                {POST_CHIPS.map((n) => (
                  <button
                    key={n} type="button" aria-pressed={activePosts === n} onClick={() => setPostsSel(n)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                      activePosts === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                    }`}
                  >
                    {n} kos{n === res.posts ? ' · predlog' : ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Kritina */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Kritina</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Kritina">
                {COVERS.map((c) => (
                  <button
                    key={c.v} type="button" aria-pressed={coverSel === c.v} onClick={() => setCoverSel(c.v)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                      coverSel === c.v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Za površino, dvig in predlog stebrov potrebuje še {widthM === null ? 'širino (frontalna fotka ali ročno)' : 'globino (stranska fotka ali ročno)'}.
          </p>
        )}

        {res.warnings.length > 0 && (
          <ul className="space-y-1" role="alert">
            {res.warnings.map((w, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {onSendToCalculator && (
            <Button size="sm" className="min-h-10" data-testid="canopy-send" onClick={sendToCalc}>
              <Umbrella className="mr-1.5 h-4 w-4" />
              Pošlji v kalkulator nadstreškov
            </Button>
          )}
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary()} disabled={widthM === null || depthM === null} data-testid="canopy-copy">
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? 'Kopirano' : 'Kopiraj povzetek'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Mere so orientacijske (napaka 2–8 % pri poševni fotki) — za natančen odmerek preveri
          z laserjem. Globina je vodoravna projekcija stranske daljice (D = L·cos α).
        </p>
      </div>
    </div>
  );
}
