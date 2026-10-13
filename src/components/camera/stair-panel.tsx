'use client';

// ─── Stopnice — samodejni profil iz fotke (meritvena skripta, 0 AI) ──
// Frontalni pogled: nosilci se preštejejo iz projekcijskega profila.
// Stranski pogled: uporabnik klikne vrh in dno stopnišča; skripta prešteje
// riserje vzdolž linije. Kalibracija: referenčni objekt analize ALI znana
// višinska razlika. Izhod → kalkulator stopnic (steps, totalRiseCm, ograja).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Footprints, RotateCcw, Ruler, Wand2, AlertTriangle, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzeStairProfile, type PctPoint, type RgbaImage, type StairMode, type StairProfileResult } from '@/lib/stair-profile';
import { formatCm, refBoxHeightPx } from '@/lib/measure-geometry';

interface StairPanelProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Pošlji izračun v kalkulator stopnic (steps, totalRiseCm, railingLength). */
  onSendToCalculator?: (inputs: { steps?: number; totalRiseCm?: number; railingLength?: number }) => void;
}

type CalibChoice = 'auto' | 'known' | 'none';

const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',');

export function StairPanel({ dataUrl, reference, onSendToCalculator }: StairPanelProps) {
  const { toast } = useToast();
  const stageRef = useRef<HTMLDivElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<StairMode>('front');
  const [pts, setPts] = useState<PctPoint[]>([]);
  const [calib, setCalib] = useState<CalibChoice>(reference ? 'auto' : 'none');
  const [knownRise, setKnownRise] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StairProfileResult | null>(null);
  const [copied, setCopied] = useState(false);
  /** Vsebinski okvir slike znotraj stage (object-contain letterbox). */
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

  const reset = () => { setPts([]); setResult(null); };
  useEffect(() => { reset(); }, [dataUrl, mode]);

  const clickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgEl || busy || mode !== 'side' || pts.length >= 2) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !content) return;
    const ox = rect.left + (content.ox / 100) * rect.width;
    const oy = rect.top + (content.oy / 100) * rect.height;
    const dw = (content.w / 100) * rect.width;
    const dh = (content.h / 100) * rect.height;
    if (dw < 2 || dh < 2) return;
    const p: PctPoint = {
      x: Math.max(0, Math.min(100, ((e.clientX - ox) / dw) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - oy) / dh) * 100)),
    };
    setPts((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  };

  /** pxPerCm iz referenčnega objekta (isti vir kot BarCounter).
   *  LEKCIJA Task 30: referenceBox = [x0, y0, ŠIRINA, VIŠINA] — box[3] je višina. */
  const refPxPerCm = (): number | null => {
    if (!imgEl || !reference) return null;
    const boxH = refBoxHeightPx(reference.box, imgEl.naturalHeight);
    if (boxH < 8) return null;
    const v = boxH / Math.max(1, reference.assumedCm);
    return v > 0.05 && Number.isFinite(v) ? v : null;
  };

  const run = async () => {
    if (!imgEl || busy) return;
    setBusy(true);
    setResult(null);
    try {
      // RGBA iz img elementa (delovna ločljivost omejena na 900 px dolgo stran)
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

      const useKnown = calib === 'known' && Number.isFinite(Number(knownRise.replace(',', '.')));
      const pxPerCm = calib === 'auto' ? refPxPerCm() : null;
      const line: [PctPoint, PctPoint] | undefined =
        mode === 'side' && pts.length === 2 ? [pts[0], pts[1]] : undefined;
      const r = analyzeStairProfile({
        img, mode, line,
        pxPerCm,
        knownRiseCm: useKnown ? Number(knownRise.replace(',', '.')) : null,
      });
      setResult(r);
      if (!r.ok) toast({ title: 'Stopnic nisem preštel', description: r.warnings[0] ?? 'Poskusi drugi pogled.', variant: 'destructive' });
    } catch {
      toast({ title: 'Analiza ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const summaryText = (r: StairProfileResult): string => {
    const L: string[] = [`Stopnice (samodejni profil, ${r.mode === 'front' ? 'frontalni' : 'stranski'} pogled)`];
    L.push(`- Št. stopnic: ${r.steps}`);
    if (r.riserCm !== null) L.push(`- Višina stopnice: ${fmt1(r.riserCm)} cm`);
    if (r.goingCm !== null) L.push(`- Globina teka: ${fmt1(r.goingCm)} cm${r.comfort?.goingEstimated ? ' (ocena po Blondelu)' : ''}`);
    if (r.totalRiseCm !== null) L.push(`- Višinska razlika: ${fmt1(r.totalRiseCm)} cm`);
    if (r.railingLengthCm !== null) L.push(`- Dolžina ograje (po naklonu): ${fmt1(r.railingLengthCm)} cm`);
    if (r.slopeDeg !== null) L.push(`- Naklon: ${fmt1(r.slopeDeg)}°`);
    if (r.comfort) L.push(`- Komfort 2R+G: ${fmt1(r.comfort.value)} cm (${r.comfort.ok ? 'OK' : 'izven 60–66'})`);
    L.push(`- Zanesljivost: ${r.confidence}/100 (${r.verdict})`);
    return L.join('\n');
  };

  const copySummary = async (r: StairProfileResult) => {
    try {
      await navigator.clipboard.writeText(summaryText(r));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const sendToCalc = (r: StairProfileResult) => {
    if (!onSendToCalculator) return;
    const inputs: { steps?: number; totalRiseCm?: number; railingLength?: number } = { steps: r.steps };
    if (r.totalRiseCm !== null) inputs.totalRiseCm = Math.round(r.totalRiseCm);
    if (r.railingLengthCm !== null) inputs.railingLength = Math.round(r.railingLengthCm) / 100;
    onSendToCalculator(inputs);
    toast({ title: 'Poslano v kalkulator stopnic ✓', description: `Št. stopnic: ${r.steps}${inputs.totalRiseCm ? ` · višina ${inputs.totalRiseCm} cm` : ''}` });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži ali fotografiraj stopnice, potem tu dobiš samodejni profil: število stopenj,
        višino stopnice, globino teka in dolžino ograje.
      </p>
    );
  }

  const refLabel = reference ? (reference.assumedCm >= 150 ? 'Vrata' : 'Referenca') : null;

  return (
    <div className="space-y-3" data-testid="stair-panel">
      {/* Način pogleda */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Način pogleda stopnic">
        {([['front', 'Spredaj (nosilci)'], ['side', 'S strani (profil)']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            data-testid={`stair-mode-${m}`}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Slika + anotacije */}
      <div
        ref={stageRef}
        data-testid="stair-stage"
        onClick={clickStage}
        className={`relative overflow-hidden rounded-xl border bg-stone-100 ${mode === 'side' ? 'cursor-crosshair' : ''}`}
      >
        <img src={dataUrl} alt="Fotografija stopnic" className="mx-auto max-h-64 w-auto object-contain" />
        {content && mode === 'side' && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {pts.map((p, i) => (
              <circle
                key={`p${i}`}
                cx={content.ox + (p.x / 100) * content.w}
                cy={content.oy + (p.y / 100) * content.h}
                r={0.9}
                fill={i === 0 ? '#d97706' : '#15803d'}
                stroke="#fff"
                strokeWidth={0.3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {pts.length === 2 && (
              <line
                x1={content.ox + (pts[0].x / 100) * content.w}
                y1={content.oy + (pts[0].y / 100) * content.h}
                x2={content.ox + (pts[1].x / 100) * content.w}
                y2={content.oy + (pts[1].y / 100) * content.h}
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
        {content && result?.ok && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {result.peaksPct.map((p, i) => (
              <line
                key={`k${i}`}
                x1={content.ox + (Math.max(0, p.x - 9) / 100) * content.w}
                y1={content.oy + (p.y / 100) * content.h}
                x2={content.ox + (Math.min(100, p.x + 9) / 100) * content.w}
                y2={content.oy + (p.y / 100) * content.h}
                stroke="#16a34a"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {mode === 'side' && pts.length < 2 && (
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            {pts.length === 0 ? 'Klikni VRH stopnišča (zgornji nosilec)' : 'Zdaj klikni DNO stopnišča (spodnji nosilec)'}
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
            Znana višinska razlika
          </button>
          <button
            type="button"
            aria-pressed={calib === 'none'}
            onClick={() => setCalib('none')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              calib === 'none' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            Samo število
          </button>
        </div>
        {calib === 'known' && (
          <div className="flex items-center gap-2">
            <Input
              id="stair-known-rise"
              inputMode="decimal"
              placeholder="npr. 148"
              value={knownRise}
              onChange={(e) => setKnownRise(e.target.value)}
              className="max-w-32 min-h-10"
              aria-label="Znana višinska razlika v cm"
            />
            <span className="text-xs text-muted-foreground">cm skupne višinske razlike</span>
          </div>
        )}
        {calib === 'auto' && !reference && (
          <p className="text-xs text-amber-700">Referenčni objekt ni zaznan — uporabi znano višinsko razliko ali izmeri merilo.</p>
        )}
      </div>

      {/* Akcije */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="min-h-10"
          data-testid="stair-run"
          onClick={() => void run()}
          disabled={busy || (mode === 'side' && pts.length < 2)}
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          {busy ? 'Preštevam…' : 'Zaznaj stopnice'}
        </Button>
        <Button size="sm" variant="outline" className="min-h-10" onClick={reset} data-testid="stair-reset">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Ponastavi
        </Button>
      </div>
      {mode === 'front' && (
        <p className="text-xs text-muted-foreground">
          Sprednji pogled: skripta prešteje nosilce iz vodoravnih linij. Globino teka nato oceni po
          Blondelovem pravilu (2R + G ≈ 63 cm) — za izmerjen tek uporabi stranski pogled.
        </p>
      )}

      {/* Rezultat */}
      {result?.ok && (
        <div className="space-y-3 rounded-xl border p-3" data-testid="stair-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Samodejni profil stopnic</span>
            </div>
            <Badge
              variant="outline"
              className={
                result.verdict === 'visoka'
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : result.verdict === 'srednja'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-red-300 bg-red-50 text-red-700'
              }
            >
              zanesljivost {result.confidence}/100 · {result.verdict}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="stair-steps">
              <div className="text-[11px] text-muted-foreground">Št. stopnic</div>
              <div className="text-xl font-bold">{result.steps}</div>
            </div>
            {result.riserCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Višina stopnice</div>
                <div className="text-xl font-bold">{fmt1(result.riserCm)} <span className="text-sm font-medium">cm</span></div>
              </div>
            )}
            {result.goingCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Globina teka{result.comfort?.goingEstimated ? ' (ocena)' : ''}</div>
                <div className="text-xl font-bold">{fmt1(result.goingCm)} <span className="text-sm font-medium">cm</span></div>
              </div>
            )}
            {result.totalRiseCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Višinska razlika</div>
                <div className="text-xl font-bold">{fmt1(result.totalRiseCm)} <span className="text-sm font-medium">cm</span></div>
              </div>
            )}
            {result.railingLengthCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Ograja (po naklonu)</div>
                <div className="text-xl font-bold">{formatCm(result.railingLengthCm)}</div>
              </div>
            )}
            {result.slopeDeg !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Naklon</div>
                <div className="text-xl font-bold">{fmt1(result.slopeDeg)} <span className="text-sm font-medium">°</span></div>
              </div>
            )}
          </div>

          {result.comfort && (
            <Badge
              variant="outline"
              className={`whitespace-normal ${result.comfort.ok ? 'border-green-300 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}
            >
              Komfort 2R+G = {fmt1(result.comfort.value)} cm · {result.comfort.ok ? 'v priporočenem pasu 60–66 ✓' : 'izven priporočenega pasu 60–66'}
            </Badge>
          )}

          {result.warnings.length > 0 && (
            <ul className="space-y-1" role="alert">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {onSendToCalculator && (
              <Button size="sm" className="min-h-10" data-testid="stair-send" onClick={() => sendToCalc(result)}>
                <Footprints className="mr-1.5 h-4 w-4" />
                Pošlji v kalkulator stopnic
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary(result)} data-testid="stair-copy">
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? 'Kopirano' : 'Kopiraj povzetek'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
