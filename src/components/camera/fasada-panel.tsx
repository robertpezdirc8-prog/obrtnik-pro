'use client';

// ─── Fasada — meritvena skripta iz fotke (0 AI) ─────────────
// Zadnji obrt brez lastne skripte (napovedano v Task 30). Tok:
//  1) "Zaznaj linije obloge" → Radonova projekcija (kotlin deck-analysis):
//     smer linij → letve tečejo pravokotno; ritem pomeni oblogo, gladko = omet.
//  2) Merilo: samodejna referenca iz analize (vrata 200 / okno 120 cm)
//     ALI ročna izbira kandidata (Task 24 chips).
//  3) 4 kliki = oglisča stene → širina × višina + bruto m².
//  4) Odprtine (okna/vrata iz samodejne analize + ročni 2-klik dodajanje)
//     se odštejejo z rezom poligona (Sutherland–Hodgman) → NETO m².
//  5) Prefill kalkulatorja fasade: dolžina → facadePerimeter, višina →
//     facadeHeight, odprtine → openingsM2.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Layers, RotateCcw, Ruler, Wand2, AlertTriangle, Copy, Check, MousePointerClick, DoorOpen, Square } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzeFasadaLines, fasadaWallArea, fasadaPrefill,
  type RgbaImage, type FasadaLinesResult, type FasadaWallResult,
} from '@/lib/fasada-analysis';
import type { XY } from '@/lib/measure-geometry';
import { refBoxHeightPx } from '@/lib/measure-geometry';
import type { ScaleAgreement, ScaleSuggestion } from '@/lib/camera-types';
import { buildOpeningSchedule, type OpeningBoxInput, type OpeningKind } from '@/lib/opening-schedule';

interface FasadaPanelProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Kandidati odprtin iz analize (Task 24) — kalibracija + odprtine. */
  suggestions: ScaleSuggestion[];
  agreement: ScaleAgreement;
  /** Pošlji izmerjene mere v kalkulator fasade. */
  onSendToCalculator?: (inputs: { facadePerimeter?: number; facadeHeight?: number; openingsM2?: number }) => void;
}

const KIND_LABEL: Record<OpeningKind, string> = { 'vrata': 'Vrata', 'okno': 'Okno' };
const KIND_COLOR: Record<OpeningKind, string> = { 'vrata': '#d97706', 'okno': '#16a34a' };

const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',');
const fmt2 = (v: number): string => v.toFixed(2).replace('.', ',');

export function FasadaPanel({ dataUrl, reference, suggestions, agreement, onSendToCalculator }: FasadaPanelProps) {
  const { toast } = useToast();
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [calib, setCalib] = useState<'auto' | 'none'>('auto');
  const [refId, setRefId] = useState<string | null>(null); // null = samodejno najboljša
  const [excluded, setExcluded] = useState<string[]>([]);
  const [manual, setManual] = useState<OpeningBoxInput[]>([]);
  const [addKind, setAddKind] = useState<OpeningKind | null>(null);
  const [clicks, setClicks] = useState<[number, number][]>([]);
  const [lines, setLines] = useState<FasadaLinesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [quadPts, setQuadPts] = useState<XY[]>([]);
  const [wall, setWall] = useState<FasadaWallResult | null>(null);
  const [copied, setCopied] = useState(false);
  const manualSeq = useRef(0);

  useEffect(() => {
    if (!dataUrl) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = dataUrl;
    return () => { alive = false; };
  }, [dataUrl]);

  const activeImg = imgEl && imgEl.src === dataUrl ? imgEl : null;

  const workScale = useMemo(() => {
    if (!activeImg) return 1;
    return Math.min(1, 900 / Math.max(activeImg.naturalWidth, activeImg.naturalHeight));
  }, [activeImg]);

  const workSize = useMemo(() => ({
    w: activeImg ? activeImg.naturalWidth * workScale : 0,
    h: activeImg ? activeImg.naturalHeight * workScale : 0,
  }), [activeImg, workScale]);

  const schedule = useMemo(() => buildOpeningSchedule({
    suggestions,
    naturalWidth: activeImg?.naturalWidth ?? 0,
    naturalHeight: activeImg?.naturalHeight ?? 0,
    refId,
    manual,
    excludedIds: excluded,
    agreement,
  }), [suggestions, activeImg, refId, manual, excluded, agreement]);

  /** Delovni pxPerCm: kalibracija popisa (naravni px) × workScale, sicer referenca analize. */
  const pxPerCm = useCallback((): number | null => {
    if (calib !== 'auto') return null;
    if (schedule.calibration && workSize.w > 0) {
      const v = schedule.calibration.pxPerCm * workScale;
      return v > 0.05 && Number.isFinite(v) ? v : null;
    }
    if (!activeImg || !reference) return null;
    const boxH = refBoxHeightPx(reference.box, activeImg.naturalHeight);
    if (boxH < 8) return null;
    const v = (boxH * workScale) / Math.max(1, reference.assumedCm);
    return v > 0.05 && Number.isFinite(v) ? v : null;
  }, [calib, schedule.calibration, workScale, activeImg, reference, workSize.w]);

  // vključene odprtine → pravokotniki v delovnih px (za rez stene)
  const openingRects = useMemo(() => schedule.openings
    .filter((o) => o.included)
    .map((o) => ({
      rect: {
        x0: (o.box[0] / 100) * workSize.w,
        y0: (o.box[1] / 100) * workSize.h,
        x1: ((o.box[0] + o.box[2]) / 100) * workSize.w,
        y1: ((o.box[1] + o.box[3]) / 100) * workSize.h,
      },
      label: o.label,
    })), [schedule.openings, workSize]);

  // površina stene (odvisna od oglisč, merila in odprtin)
  useEffect(() => {
    if (quadPts.length !== 4 || workSize.w <= 0) { setWall(null); return; }
    setWall(fasadaWallArea(quadPts, pxPerCm(), workSize, openingRects));
  }, [quadPts, workSize, openingRects, pxPerCm]);

  const reset = () => {
    setLines(null); setQuadPts([]); setWall(null);
    setExcluded([]); setManual([]); setClicks([]); setAddKind(null);
  };

  const runLines = async () => {
    if (!activeImg || busy) return;
    setBusy(true);
    try {
      const w = Math.max(8, Math.round(activeImg.naturalWidth * workScale));
      const h = Math.max(8, Math.round(activeImg.naturalHeight * workScale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas ni na voljo');
      ctx.drawImage(activeImg, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const r = analyzeFasadaLines({ width: w, height: h, data: data.data } as RgbaImage);
      setLines(r);
      if (!r.ok) {
        toast({ title: 'Ritema obloge nisem zaznal', description: r.warnings[0] ?? 'Gladka stena? Površino lahko vseeno izmeriš po oglisčih.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Analiza ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  /** Klik na fotko: dodajanje odprtin (2 klika) → vogali stene → izključitev odprtine. */
  const clickImage = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (addKind) {
      const p: [number, number] = [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))];
      const next = clicks.length >= 2 ? [p] : [...clicks, p];
      setClicks(next);
      if (next.length === 2) {
        const bx = Math.min(next[0][0], next[1][0]);
        const by = Math.min(next[0][1], next[1][1]);
        const bw = Math.abs(next[1][0] - next[0][0]);
        const bh = Math.abs(next[1][1] - next[0][1]);
        if (bw < 0.5 || bh < 0.5) {
          toast({ title: 'Okvir je premajhen', description: 'Klikni dve bolj razmaknjeni oglišči.', variant: 'destructive' });
        } else {
          manualSeq.current += 1;
          setManual((prev) => [...prev, { id: `manual-${manualSeq.current}`, kind: addKind, box: [bx, by, bw, bh], confidence: 80, source: 'rocno' }]);
        }
        setClicks([]);
      }
      return;
    }
    if (quadPts.length < 4) {
      if (x < -0.5 || x > 100.5 || y < -0.5 || y > 100.5) return;
      setQuadPts((prev) => [...prev, { x, y }]);
      return;
    }
    // 4 oglisča sta že: klik na okvir odprtine jo vključi/izključi
    const hit = schedule.openings.find((o) =>
      x >= o.box[0] && x <= o.box[0] + o.box[2] && y >= o.box[1] && y <= o.box[1] + o.box[3]);
    if (hit) {
      setExcluded((prev) => (prev.includes(hit.id) ? prev.filter((v) => v !== hit.id) : [...prev, hit.id]));
    }
  };

  const summaryText = (): string => {
    const L: string[] = ['Fasada (meritvena skripta s fotke)'];
    if (lines?.ok) {
      L.push(`- Obloga: linije ≈ ${lines.orientation} (${fmt1(lines.cladAngleDeg)}°), letve pravokotno nanje`);
      if (lines.pitchPx !== null && pxPerCm()) L.push(`- Ritem obloge: ≈ ${fmt1(lines.pitchPx / (pxPerCm() ?? 1))} cm`);
    }
    if (wall?.ok) {
      L.push(`- Stena: ${fmt2((wall.wallWidthCm ?? 0) / 100)} × ${fmt2((wall.wallHeightCm ?? 0) / 100)} m`);
      L.push(`- Bruto ${fmt2(wall.grossM2 ?? 0)} m² − odprtine ${fmt2(wall.openingsM2)} m² (${wall.openingsCount}) = NETO ${fmt2(wall.netM2 ?? 0)} m²`);
    }
    L.push('Kalkulator: bruto = dolžina × višina stene; za celo hišo dodaj ostale stene.');
    return L.join('\n');
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
    if (!onSendToCalculator || !wall?.ok) return;
    const pf = fasadaPrefill(wall);
    if (pf.facadePerimeter === undefined || pf.facadeHeight === undefined) {
      toast({ title: 'Mere manjkajo', description: 'Izmeri steno (4 oglisča) z umerjenim merilom.', variant: 'destructive' });
      return;
    }
    onSendToCalculator(pf);
    toast({ title: 'Poslano v kalkulator fasade ✓', description: `stena ${fmt2(pf.facadePerimeter)} × ${fmt2(pf.facadeHeight)} m · odprtine ${fmt2(pf.openingsM2 ?? 0)} m²` });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži ali fotografiraj steno fasade — skripta zazna linije obloge, izmeri steno po 4
        oglisčih, odšteje odprtine (okna/vrata) in predpolnje kalkulator.
      </p>
    );
  }

  const cal = schedule.calibration;
  const calibLabel = cal ? `${cal.refLabel} ≈ ${cal.assumedCm} cm` : reference ? `Referenca ≈ ${reference.assumedCm} cm` : 'Referenca (ni zaznana)';
  const hasCalib = calib === 'auto' && (cal !== null || reference !== null);
  const shownWall = wall?.ok ? wall : null;
  const addMode = addKind !== null;

  return (
    <div className="space-y-3" data-testid="fasada-panel">
      {/* Fotka + anotacije: linije obloge, stena, odprtine */}
      <div
        className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border bg-stone-100"
        data-testid="fasada-image"
        onClick={clickImage}
        role="application"
        aria-label="Fotografija fasade — klik za oglisča stene ali odprtine"
      >
        <img src={dataUrl} alt="Fotografija fasade" className="block max-h-64 w-auto" draggable={false} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {lines?.ok && lines.lines.map((l, i) => (
            <line
              key={`cl${i}`}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke="#16a34a" strokeWidth={1.2} opacity={0.55}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {schedule.openings.map((o) => (
            <rect
              key={`o${o.id}`}
              x={o.box[0]} y={o.box[1]} width={o.box[2]} height={o.box[3]}
              fill="none"
              stroke={!o.included ? '#78716c' : KIND_COLOR[o.kind]}
              strokeWidth={o.source === 'rocno' ? 0.5 : 0.35}
              strokeDasharray={!o.included ? '1.5 1.5' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {quadPts.length > 0 && (
            quadPts.length === 4 ? (
              <polygon
                points={quadPts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="rgba(217,119,6,0.14)"
                stroke="#d97706"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <polyline
                points={quadPts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none" stroke="#d97706" strokeWidth={2}
                strokeDasharray="2 1.5"
                vectorEffect="non-scaling-stroke"
              />
            )
          )}
          {clicks.map((p, i) => (
            <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={0.6} fill="#dc2626" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* oznake odprtin (HTML plast za čitljivost) */}
        <div className="pointer-events-none absolute inset-0">
          {schedule.openings.map((o) => (
            <div
              key={`l-${o.id}`}
              className="absolute rounded bg-black/70 px-1 py-px text-[10px] font-semibold leading-tight text-white"
              style={{ left: `${o.box[0]}%`, top: `${o.box[1]}%`, transform: 'translateY(-100%)', color: !o.included ? '#d6d3d1' : '#fff' }}
            >
              {o.label}{o.widthCm !== null && o.heightCm !== null ? ` ${o.widthCm}×${o.heightCm}` : ''}
            </div>
          ))}
          {quadPts.map((p, i) => (
            <span
              key={`n${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        {!shownWall && quadPts.length < 4 && !addMode && (
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            Klikni 4 vogale stene ({quadPts.length}/4) — najprej umeri po referenci
          </div>
        )}
        {addMode && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            {clicks.length === 0 ? `Klikni zgornje-levi kot ${KIND_LABEL[addKind!]}` : 'Zdaj klikni spodnje-desni kot'}
          </div>
        )}
      </div>

      {/* Kalibracija */}
      <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
        <Label className="text-xs font-medium">Merilo (referenca: vrata 200 / okno 120 cm)</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Merilo">
          {suggestions.length > 0 ? suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid={`fasada-ref-${s.id}`}
              aria-pressed={(refId ?? suggestions[0]?.id) === s.id}
              onClick={() => { setRefId(s.id); setCalib('auto'); }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                calib === 'auto' && (refId ?? suggestions[0]?.id) === s.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <Ruler className="mr-1 inline h-3.5 w-3.5" />
              {s.label} ≈ {s.assumedCm} cm · {s.confidence}/100
            </button>
          )) : (
            <button
              type="button"
              aria-pressed={calib === 'auto'}
              disabled={!reference}
              onClick={() => setCalib('auto')}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] disabled:opacity-40 ${
                calib === 'auto' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <Ruler className="mr-1 inline h-3.5 w-3.5" />
              {calibLabel}
            </button>
          )}
          <button
            type="button"
            aria-pressed={calib === 'none'}
            onClick={() => setCalib('none')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              calib === 'none' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            Brez merila
          </button>
        </div>
        {calib === 'auto' && !cal && !reference && (
          <p className="text-xs text-amber-700">Referenčni objekt ni zaznan — fotka mora prikazovati vrata (≈200 cm) ali okno (≈120 cm).</p>
        )}
      </div>

      {/* Akcije */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-10" data-testid="fasada-run" onClick={() => void runLines()} disabled={busy}>
          <Wand2 className="mr-1.5 h-4 w-4" />
          {busy ? 'Zaznavam linije…' : 'Zaznaj linije obloge'}
        </Button>
        <Button size="sm" variant="outline" className="min-h-10" onClick={reset} data-testid="fasada-reset">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Ponastavi
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Linije obloge določijo smer podkonstrukcije (letve tečejo pravokotno). Nato klikni 4 vogale
        stene — odprtine se samodejno odštejejo.
      </p>

      {/* Rezultat linij */}
      {lines?.ok && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3" data-testid="fasada-lines">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Obloga: {lines.orientation}</span>
          <Badge
            variant="outline"
            className={
              lines.verdict === 'visoka'
                ? 'border-green-300 bg-green-50 text-green-700'
                : lines.verdict === 'srednja'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-red-300 bg-red-50 text-red-700'
            }
          >
            zanesljivost {lines.confidence}/100
          </Badge>
          <span className="text-xs text-muted-foreground">
            {lines.orientation === 'vodoravno' ? 'letve navpično' : lines.orientation === 'navpično' ? 'letve vodoravno' : 'smer preveri na terenu'}
            {lines.linesVisible !== null ? ` · ~${lines.linesVisible} linij` : ''}
          </span>
        </div>
      )}

      {/* Rezultat stene */}
      {shownWall && (
        <div className="space-y-3 rounded-xl border p-3" data-testid="fasada-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Square className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Površina stene</span>
            </div>
            {!hasCalib && (
              <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-700">
                Brez merila — umeri po referenci za cm
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="fasada-width">
              <div className="text-[11px] text-muted-foreground">Dolžina stene</div>
              <div className="text-xl font-bold">{fmt2((shownWall.wallWidthCm ?? 0) / 100)} <span className="text-sm font-medium">m</span></div>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="fasada-height">
              <div className="text-[11px] text-muted-foreground">Višina stene</div>
              <div className="text-xl font-bold">{fmt2((shownWall.wallHeightCm ?? 0) / 100)} <span className="text-sm font-medium">m</span></div>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="fasada-gross">
              <div className="text-[11px] text-muted-foreground">Bruto</div>
              <div className="text-xl font-bold">{fmt2(shownWall.grossM2 ?? 0)} <span className="text-sm font-medium">m²</span></div>
            </div>
            <div className="rounded-lg bg-green-50 p-2.5" data-testid="fasada-net">
              <div className="text-[11px] text-muted-foreground">Neto (− odprtine)</div>
              <div className="text-xl font-bold text-green-700">{fmt2(shownWall.netM2 ?? 0)} <span className="text-sm font-medium">m²</span></div>
            </div>
          </div>

          {/* Odprtine */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <DoorOpen className="h-3.5 w-3.5" />
                Odprtine ({shownWall.openingsCount}) · vsota {fmt2(shownWall.openingsM2)} m²
              </Label>
              <div className="flex gap-1.5">
                {(['okno', 'vrata'] as OpeningKind[]).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={addKind === k ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs"
                    data-testid={`fasada-add-${k}`}
                    aria-pressed={addKind === k}
                    onClick={() => { setAddKind(addKind === k ? null : k); setClicks([]); }}
                  >
                    + {KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
            </div>
            {schedule.openings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ni odprtin — če jih fotka prikazuje, dodaj z "+ Okno / + Vrata" (2 klika) ali jih vpiši v kalkulator.
              </p>
            ) : (
              <ul className="max-h-36 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {schedule.openings.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: !o.included ? '#78716c' : KIND_COLOR[o.kind] }} aria-hidden />
                      <span className={o.included ? '' : 'text-muted-foreground line-through'}>
                        {o.label}{o.widthCm !== null && o.heightCm !== null ? ` · ${fmt1(o.widthCm)} × ${fmt1(o.heightCm)} cm` : ''}{o.areaM2 !== null && o.included ? ` · ${fmt2(o.areaM2)} m²` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid={`fasada-toggle-${o.id}`}
                      onClick={() => setExcluded((prev) => (prev.includes(o.id) ? prev.filter((v) => v !== o.id) : [...prev, o.id]))}
                      className="min-h-[28px] rounded px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-pressed={!o.included}
                    >
                      {o.included ? 'Izključi' : 'Vključi'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {shownWall.warnings.length > 0 && (
            <ul className="space-y-1" role="alert">
              {shownWall.warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {onSendToCalculator && (
              <Button size="sm" className="min-h-10" data-testid="fasada-send" onClick={sendToCalc} disabled={!hasCalib}>
                <Layers className="mr-1.5 h-4 w-4" />
                Pošlji v kalkulator fasade
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary()} data-testid="fasada-copy">
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? 'Kopirano' : 'Kopiraj povzetek'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <MousePointerClick className="mr-1 inline h-3.5 w-3.5" />
            Klik na okvir odprtine jo vključi/izključi. Površina je orientacijska (napaka 2–8 % pri
            poševni fotki); kalkulator računa bruto = dolžina × višina — za celo hišo dodaj ostale stene.
          </p>
        </div>
      )}
    </div>
  );
}
