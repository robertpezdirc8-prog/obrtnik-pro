'use client';

// ─── WPC terasa — samodejna analiza desk iz fotke (meritvena skripta, 0 AI) ──
// Skripta iz fotke zazna smer vrst desk (Radonova projekcija po kotih), izmeri
// korak in režo ter po kalibraciji (referenčni objekt ALI znana širina deske)
// predlaga širino deske s snapom na standardne WPC formate. Uporabnik klikne
// 4 oglisča terase → površina + stranice → prefill kalkulatorja WPC terase
// (deckLength, deckWidth, joistSpacing — predlog je ROKSALov spodnji rob pasu
// 33–35 cm, NE več »ravno 0,4 / diagonalno 0,3«).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers, RotateCcw, Ruler, Wand2, AlertTriangle, Copy, Check, MousePointerClick } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzeDeck, deckQuadArea, JOIST_SUGGEST_M, type RgbaImage, type DeckResult } from '@/lib/deck-analysis';
import { maxAllowedSpan } from '@/lib/roksal-span-rules';
import type { XY } from '@/lib/measure-geometry';
import { refBoxHeightPx } from '@/lib/measure-geometry';

interface DeckPanelProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Pošlji izmerjene mere v kalkulator WPC terase. */
  onSendToCalculator?: (inputs: { deckLength?: number; deckWidth?: number; joistSpacing?: number }) => void;
}

type CalibChoice = 'auto' | 'known' | 'none';

const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',');
const fmt2 = (v: number): string => v.toFixed(2).replace('.', ',');

const BAND = maxAllowedSpan({ family: 'terasa', context: 'battens' });
/** Znotraj objavljenega pasu sta oba robu. Nad pasom so možnosti, ki jih
 *  aplikacija označi kot preširoke — monter jih vseeno lahko izbere, ker je
 *  vpisana vrednost lahko dejanska meritev obstoječe podkonstrukcije. */
const JOIST_OPTIONS = [BAND.maxSpanCm / 100, (BAND.binding?.bandCm?.[1] ?? 35) / 100, 0.4, 0.45, 0.5];

export function DeckPanel({ dataUrl, reference, onSendToCalculator }: DeckPanelProps) {
  const { toast } = useToast();
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [calib, setCalib] = useState<CalibChoice>(reference ? 'auto' : 'none');
  const [knownBoard, setKnownBoard] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [diagonalSel, setDiagonalSel] = useState<boolean | null>(null);
  const [joistSel, setJoistSel] = useState<number | null>(null);
  const [quadPts, setQuadPts] = useState<XY[]>([]);
  const [area, setArea] = useState<{ lengthCm: number; widthCm: number; areaM2: number } | null>(null);
  const [copied, setCopied] = useState(false);
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

  const reset = () => {
    setResult(null); setDiagonalSel(null); setJoistSel(null);
    setQuadPts([]); setArea(null);
  };

  /** pxPerCm iz referenčnega objekta, preklučeno na delovno ločljivost analize.
   *  LEKCIJA Task 30: referenceBox = [x0, y0, ŠIRINA, VIŠINA] — box[3] je višina. */
  const refPxPerCm = useCallback((workScale: number): number | null => {
    if (!imgEl || !reference) return null;
    const boxH = refBoxHeightPx(reference.box, imgEl.naturalHeight);
    if (boxH < 8) return null;
    const v = (boxH * workScale) / Math.max(1, reference.assumedCm);
    return v > 0.05 && Number.isFinite(v) ? v : null;
  }, [imgEl, reference]);

  const run = async () => {
    if (!imgEl || busy) return;
    setBusy(true);
    setResult(null);
    setDiagonalSel(null);
    setJoistSel(null);
    try {
      const scale = Math.min(1, 900 / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
      const w = Math.max(8, Math.round(imgEl.naturalWidth * scale));
      const h = Math.max(8, Math.round(imgEl.naturalHeight * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas ni na voljo');
      ctx.drawImage(imgEl, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const img: RgbaImage = { width: w, height: h, data: data.data };

      const useKnown = calib === 'known' && Number.isFinite(Number(knownBoard.replace(',', '.')));
      const pxPerCm = calib === 'auto' ? refPxPerCm(scale) : null;
      const r = analyzeDeck({
        img,
        pxPerCm,
        knownBoardCm: useKnown ? Number(knownBoard.replace(',', '.')) : null,
      });
      setResult(r);
      if (r.ok) {
        setDiagonalSel(r.diagonal);
        setJoistSel(r.joistSpacingSuggestM);
        setQuadPts([]);
        setArea(null);
      } else {
        toast({ title: 'Desk nisem zaznal', description: r.warnings[0] ?? 'Poskusi z bolj frontno fotko terase.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Analiza ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  /** Klik na fotko = oglišče terase (4 klika → površina). */
  const addCorner = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgEl || !result?.ok || quadPts.length >= 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // zaščita pred zastarelmi koordinatami (npr. scroll med kliki) —
    // oglisče izven slike ignoriramo, da površina ne zajame "zunaj" fotke
    if (x < -0.5 || x > 100.5 || y < -0.5 || y > 100.5) return;
    const next = [...quadPts, { x, y }];
    setQuadPts(next);
    if (next.length === 4) {
      const scale = Math.min(1, 900 / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
      const q = deckQuadArea(next, result.pxPerCm, { w: imgEl.naturalWidth * scale, h: imgEl.naturalHeight * scale });
      if (q.ok && q.lengthCm !== null && q.widthCm !== null && q.areaM2 !== null) {
        setArea({ lengthCm: q.lengthCm, widthCm: q.widthCm, areaM2: q.areaM2 });
        if (q.warnings.length > 0) toast({ title: 'Površina izmerjena', description: q.warnings[0] });
      } else {
        setQuadPts([]);
        toast({ title: 'Površine ne morem izmeriti', description: q.warnings[0] ?? 'Preveri kalibracijo in oglisča.', variant: 'destructive' });
      }
    }
  };

  const setPattern = (diag: boolean) => {
    setDiagonalSel(diag);
    setJoistSel(JOIST_SUGGEST_M);
  };

  const summaryText = (r: DeckResult): string => {
    const L: string[] = ['WPC terasa (samodejna analiza desk)'];
    const diag = diagonalSel ?? r.diagonal;
    L.push(`- Vgradnja: ${diag ? 'diagonalno' : 'ravno'} (predlog nosilcev ${fmt2(JOIST_SUGGEST_M)} m — ROKSALov spodnji rob objavljenega pasu)`);
    L.push(`- Smer desk: ≈ ${fmt1(r.boardAngleDeg)}° (0 = vodoravno)`);
    if (r.boardCm !== null) {
      const snapTxt = r.snapBoard !== null ? ` (standard ${fmt1(r.snapBoard)} cm)` : '';
      L.push(`- Širina deske: ≈ ${fmt1(r.boardCm)} cm${snapTxt}`);
    }
    if (r.gapCm !== null) L.push(`- Reža med deskami: ≈ ${fmt1(r.gapCm)} cm`);
    if (r.boardsVisible !== null) L.push(`- Vidnih rež/vrst: ~${r.boardsVisible}`);
    if (area) L.push(`- Terasa: ${fmt2(area.lengthCm / 100)} × ${fmt2(area.widthCm / 100)} m ≈ ${fmt2(area.areaM2)} m²`);
    L.push(`- Zanesljivost: ${r.confidence}/100 (${r.verdict})`);
    return L.join('\n');
  };

  const copySummary = async (r: DeckResult) => {
    try {
      await navigator.clipboard.writeText(summaryText(r));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const sendToCalc = (r: DeckResult) => {
    if (!onSendToCalculator) return;
    if (!area) {
      toast({ title: 'Najprej izmeri površino', description: 'Klikni 4 oglisča terase na fotki (ali vpiši mere ročno v kalkulatorju).', variant: 'destructive' });
      return;
    }
    onSendToCalculator({
      deckLength: Number((area.lengthCm / 100).toFixed(2)),
      deckWidth: Number((area.widthCm / 100).toFixed(2)),
      joistSpacing: joistSel ?? r.joistSpacingSuggestM,
    });
    toast({ title: 'Poslano v kalkulator WPC terase ✓', description: `${fmt2(area.lengthCm / 100)} × ${fmt2(area.widthCm / 100)} m · nosilci ${(joistSel ?? r.joistSpacingSuggestM).toFixed(2).replace('.', ',')} m` });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži ali fotografiraj položeno teraso (reže med deskami vidne), potem tu dobiš samodejno
        analizo: smer in širino desk, režo, predlog nosilcev in površino za odmerek.
      </p>
    );
  }

  const refLabel = reference ? (reference.assumedCm >= 150 ? 'Vrata' : 'Referenca') : null;
  const shown = result?.ok ? result : null;
  const activeDiag = diagonalSel ?? shown?.diagonal ?? false;

  return (
    <div className="space-y-3" data-testid="deck-panel">
      {/* Slika + anotacije rež + oglisča terase */}
      <div
        className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border bg-stone-100"
        data-testid="deck-image"
        onClick={addCorner}
        role="application"
        aria-label="Fotografija terase — klik za oglisča"
      >
        <img src={dataUrl} alt="Fotografija terase" className="mx-auto max-h-64 w-auto object-contain" />
        {shown && shown.lines.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {shown.lines.map((l, i) => (
              <line
                key={`g${i}`}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke="#16a34a"
                strokeWidth={1.4}
                opacity={0.7}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {quadPts.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon
              points={quadPts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={quadPts.length === 4 ? 'rgba(22,163,74,0.18)' : 'rgba(217,119,6,0.12)'}
              stroke="#16a34a"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {quadPts.map((p, i) => (
          <span
            key={`c${i}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {i + 1}
          </span>
        ))}
        {!shown && (
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            Reže med deskami naj bodo vidne — slikaj teraso bolj frontno
          </div>
        )}
      </div>

      {/* Kalibracija */}
      <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
        <Label className="text-xs font-medium">Kalibracija (px → cm)</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kalibracija">
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
            {refLabel ? `${refLabel} ${reference!.assumedCm} cm` : 'Referenca (ni zaznana)'}
          </button>
          <button
            type="button"
            aria-pressed={calib === 'known'}
            onClick={() => setCalib('known')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              calib === 'known' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            Znam desko
          </button>
          <button
            type="button"
            aria-pressed={calib === 'none'}
            onClick={() => setCalib('none')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              calib === 'none' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            Samo smer
          </button>
        </div>
        {calib === 'known' && (
          <div className="flex items-center gap-2">
            <Input
              id="deck-known-cm"
              inputMode="decimal"
              placeholder="npr. 14"
              value={knownBoard}
              onChange={(e) => setKnownBoard(e.target.value)}
              className="max-w-28 min-h-10"
              aria-label="Znana širina deske v cm"
            />
            <span className="text-xs text-muted-foreground">cm (širina deske — najpogostejša 14)</span>
          </div>
        )}
        {calib === 'auto' && !reference && (
          <p className="text-xs text-amber-700">Referenčni objekt ni zaznan — vpiši znano desko ali uporabi samo smer.</p>
        )}
      </div>

      {/* Akcije */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="min-h-10"
          data-testid="deck-run"
          onClick={() => void run()}
          disabled={busy}
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          {busy ? 'Zaznavam deske…' : 'Zaznaj deske'}
        </Button>
        <Button size="sm" variant="outline" className="min-h-10" onClick={reset} data-testid="deck-reset">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Ponastavi
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Po zaznavi klikni 4 vogale terase na fotki → površina. Skripta meri KORAK vrst
        (deska + reža) in režo (širina na pol globine temne vrzeli).
      </p>

      {/* Rezultat */}
      {shown && (
        <div className="space-y-3 rounded-xl border p-3" data-testid="deck-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Samodejna analiza desk</span>
            </div>
            <Badge
              variant="outline"
              className={
                shown.verdict === 'visoka'
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : shown.verdict === 'srednja'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-red-300 bg-red-50 text-red-700'
              }
            >
              zanesljivost {shown.confidence}/100 · {shown.verdict}
            </Badge>
          </div>

          {/* Vgradnja — predlog iz fotke, uporabnik potrdi/preklopi */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Vgradnja (predlog iz fotke — nosilci pravokotno na deske)</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Vgradnja">
              <button
                type="button"
                data-testid="deck-pattern-ravno"
                aria-pressed={!activeDiag}
                onClick={() => setPattern(false)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  !activeDiag ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                Ravno polaganje
              </button>
              <button
                type="button"
                data-testid="deck-pattern-diagonalno"
                aria-pressed={activeDiag}
                onClick={() => setPattern(true)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  activeDiag ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                Diagonalno polaganje
              </button>
            </div>
          </div>

          {/* Razmak nosilcev (m) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Razmak nosilcev (m)</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Razmak nosilcev">
              {JOIST_OPTIONS.map((j) => (
                <button
                  key={j}
                  type="button"
                  aria-pressed={joistSel === j}
                  onClick={() => setJoistSel(j)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                    joistSel === j ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {fmt2(j)} m{j === JOIST_SUGGEST_M ? ' · predlog (ROKSAL)' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="deck-angle">
              <div className="text-[11px] text-muted-foreground">Smer desk</div>
              <div className="text-xl font-bold">{fmt1(shown.boardAngleDeg)} <span className="text-sm font-medium">°</span></div>
            </div>
            {shown.boardCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="deck-board">
                <div className="text-[11px] text-muted-foreground">Širina deske</div>
                <div className="text-xl font-bold">≈ {fmt1(shown.boardCm)} <span className="text-sm font-medium">cm</span></div>
              </div>
            )}
            {shown.gapCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="deck-gap">
                <div className="text-[11px] text-muted-foreground">Reža</div>
                <div className="text-xl font-bold">≈ {fmt1(shown.gapCm)} <span className="text-sm font-medium">cm</span></div>
              </div>
            )}
            {shown.snapBoard !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Standard</div>
                <div className="text-xl font-bold" data-testid="deck-snap">{fmt1(shown.snapBoard)}</div>
              </div>
            )}
          </div>

          {/* Površina — 4 klika */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <MousePointerClick className="h-3.5 w-3.5" />
                Površina terase — klikni 4 vogale na fotki
              </Label>
              {quadPts.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setQuadPts([]); setArea(null); }}>
                  Počisti oglisča
                </Button>
              )}
            </div>
            {!area ? (
              <p className="text-xs text-muted-foreground" data-testid="deck-quad-hint">
                {quadPts.length === 0
                  ? '1. oglišče: klikni zgornji levi vogal terase…'
                  : quadPts.length === 1
                    ? '2. oglišče: zgornji desni vogal…'
                    : quadPts.length === 2
                      ? '3. oglišče: spodnji desni vogal…'
                      : '4. oglišče: spodnji levi vogal…'}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2" data-testid="deck-area">
                <div className="rounded-lg bg-green-50 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Dolžina</div>
                  <div className="text-lg font-bold">{fmt2(area.lengthCm / 100)} <span className="text-xs font-medium">m</span></div>
                </div>
                <div className="rounded-lg bg-green-50 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Širina</div>
                  <div className="text-lg font-bold">{fmt2(area.widthCm / 100)} <span className="text-xs font-medium">m</span></div>
                </div>
                <div className="rounded-lg bg-green-50 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Površina</div>
                  <div className="text-lg font-bold">{fmt2(area.areaM2)} <span className="text-xs font-medium">m²</span></div>
                </div>
              </div>
            )}
            {quadPts.length === 4 && !area && (
              <p className="text-xs text-amber-700">Oglišča so oddana, kalibracija manjka — umeri in ponovno klikni oglisča.</p>
            )}
          </div>

          {shown.pxPerCm === null && (
            <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-700">
              Brez kalibracije — prikazana samo smer; za cm vpiši znano desko ali umeri po referenci.
            </Badge>
          )}

          {shown.warnings.length > 0 && (
            <ul className="space-y-1" role="alert">
              {shown.warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {onSendToCalculator && (
              <Button size="sm" className="min-h-10" data-testid="deck-send" onClick={() => sendToCalc(shown)}>
                <Layers className="mr-1.5 h-4 w-4" />
                Pošlji v kalkulator WPC terase
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary(shown)} data-testid="deck-copy">
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? 'Kopirano' : 'Kopiraj povzetek'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Površina je orientacijska (napaka 2–8 % pri poševni fotki) — za natančne mere
            preveri z laserjem ali umeri Ravnino na glavnem platnu.
          </p>
        </div>
      )}
    </div>
  );
}
