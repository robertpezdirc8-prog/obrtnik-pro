'use client';

// ─── Keramika — samodejna mreža ploščic iz fotke (meritvena skripta, 0 AI) ──
// Skripta iz fotke zazna mrežo fug (projekcija gradientov po kotih), prepozna
// vzorec polaganja (ravno / diagonalno / ribja kost), izmeri korak mreže in po
// kalibraciji (referenčni objekt ALI znana ploščica) predlaga velikost
// ploščice s snapom na uveljavljene formate. Izhod → kalkulator keramike
// (tilePattern določa odpadek: ravno 10 / diagonalno 15 / ribja kost 18 %).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Grid3X3, RotateCcw, Ruler, Wand2, AlertTriangle, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzeTileGrid, type RgbaImage, type TileGridResult, type TilePattern } from '@/lib/tile-grid';

interface TilePanelProps {
  dataUrl: string | null;
  /** Referenčni objekt analize (box v % slike + realna višina v cm). */
  reference: { box: [number, number, number, number]; assumedCm: number } | null;
  /** Pošlji prepoznan vzorec v kalkulator keramike (tilePattern). */
  onSendToCalculator?: (inputs: { tilePattern?: 'ravno' | 'diagonalno' | 'ribja-kost' }) => void;
}

type CalibChoice = 'auto' | 'known' | 'none';

const fmt1 = (v: number): string => v.toFixed(1).replace('.', ',');

const PATTERN_LABEL: Record<TilePattern, string> = {
  'ravno': 'Ravno',
  'diagonalno': 'Diagonalno (45°)',
  'ribja-kost': 'Ribja kost',
};

const PATTERN_WASTE: Record<TilePattern, number> = {
  'ravno': 10,
  'diagonalno': 15,
  'ribja-kost': 18,
};

export function TilePanel({ dataUrl, reference, onSendToCalculator }: TilePanelProps) {
  const { toast } = useToast();
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [calib, setCalib] = useState<CalibChoice>(reference ? 'auto' : 'none');
  const [knownTile, setKnownTile] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TileGridResult | null>(null);
  const [patternSel, setPatternSel] = useState<TilePattern | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!dataUrl) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = dataUrl;
    return () => { alive = false; };
  }, [dataUrl]);

  const reset = () => { setResult(null); setPatternSel(null); };
  useEffect(() => { reset(); }, [dataUrl]);

  /** pxPerCm iz referenčnega objekta, preklučeno na delovno ločljivost analize. */
  const refPxPerCm = useCallback((workScale: number): number | null => {
    if (!imgEl || !reference) return null;
    const [bx0, by0, bx1, by1] = reference.box;
    const boxH = ((by1 - by0) / 100) * imgEl.naturalHeight;
    if (boxH < 8) return null;
    const v = (boxH * workScale) / Math.max(1, reference.assumedCm);
    return v > 0.05 && Number.isFinite(v) ? v : null;
  }, [imgEl, reference]);

  const run = async () => {
    if (!imgEl || busy) return;
    setBusy(true);
    setResult(null);
    setPatternSel(null);
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

      const useKnown = calib === 'known' && Number.isFinite(Number(knownTile.replace(',', '.')));
      const pxPerCm = calib === 'auto' ? refPxPerCm(scale) : null;
      const r = analyzeTileGrid({
        img,
        pxPerCm,
        knownTileCm: useKnown ? Number(knownTile.replace(',', '.')) : null,
      });
      setResult(r);
      setPatternSel(r.ok ? r.pattern : null);
      if (!r.ok) toast({ title: 'Mreže nisem zaznal', description: r.warnings[0] ?? 'Poskusi z bolj frontno fotko ploščic.', variant: 'destructive' });
    } catch {
      toast({ title: 'Analiza ni uspela', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const summaryText = (r: TileGridResult): string => {
    const L: string[] = ['Keramika (samodejna mreža ploščic)'];
    L.push(`- Vzorec: ${PATTERN_LABEL[patternSel ?? r.pattern]} (odpadek ${PATTERN_WASTE[patternSel ?? r.pattern]} %)`);
    L.push(`- Kot mreže: ${fmt1(r.angleDeg)}°`);
    if (r.tileWCm !== null) {
      const snapTxt = r.snapW !== null ? ` (uveljavljen format ${r.snapW}${r.snapH !== null ? `×${r.snapH}` : ''})` : '';
      L.push(`- Velikost ploščice: ≈ ${fmt1(r.tileWCm)}${r.tileHCm !== null ? ` × ${fmt1(r.tileHCm)}` : ''} cm${snapTxt}`);
    }
    if (r.tilesVisible !== null) L.push(`- Vidnih ploščic: ~${r.tilesVisible}`);
    L.push(`- Zanesljivost: ${r.confidence}/100 (${r.verdict})`);
    return L.join('\n');
  };

  const copySummary = async (r: TileGridResult) => {
    try {
      await navigator.clipboard.writeText(summaryText(r));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const sendToCalc = (r: TileGridResult) => {
    if (!onSendToCalculator) return;
    const p = patternSel ?? r.pattern;
    onSendToCalculator({ tilePattern: p });
    toast({ title: 'Poslano v kalkulator keramike ✓', description: `Vzorec: ${PATTERN_LABEL[p]} · odpadek ${PATTERN_WASTE[p]} %` });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži ali fotografiraj položene ploščice (fuge vidne), potem tu dobiš samodejno analizo:
        vzorec polaganja, velikost ploščice in priporočen odpadek.
      </p>
    );
  }

  const refLabel = reference ? (reference.assumedCm >= 150 ? 'Vrata' : 'Referenca') : null;
  const shown = result?.ok ? result : null;
  const activePattern = patternSel ?? shown?.pattern ?? 'ravno';

  return (
    <div className="space-y-3" data-testid="tile-panel">
      {/* Slika + anotacije fug */}
      <div className="relative overflow-hidden rounded-xl border bg-stone-100">
        <img src={dataUrl} alt="Fotografija ploščic" className="mx-auto max-h-64 w-auto object-contain" />
        {shown && shown.lines.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {shown.lines.map((l, i) => (
              <line
                key={`f${i}`}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke={l.dir === 1 ? '#16a34a' : '#d97706'}
                strokeWidth={l.dir === 1 ? 1.6 : 1.2}
                opacity={0.75}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {!shown && (
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            Fuge naj bodo vidne — slikaj frontno na mrežo ploščic
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
            Znam ploščico
          </button>
          <button
            type="button"
            aria-pressed={calib === 'none'}
            onClick={() => setCalib('none')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              calib === 'none' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            Samo vzorec
          </button>
        </div>
        {calib === 'known' && (
          <div className="flex items-center gap-2">
            <Input
              id="tile-known-cm"
              inputMode="decimal"
              placeholder="npr. 60"
              value={knownTile}
              onChange={(e) => setKnownTile(e.target.value)}
              className="max-w-28 min-h-10"
              aria-label="Znana velikost ploščice v cm"
            />
            <span className="text-xs text-muted-foreground">cm (dolžina ploščice — korak fug)</span>
          </div>
        )}
        {calib === 'auto' && !reference && (
          <p className="text-xs text-amber-700">Referenčni objekt ni zaznan — vpiši znano ploščico ali uporabi samo vzorec.</p>
        )}
      </div>

      {/* Akcije */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="min-h-10"
          data-testid="tile-run"
          onClick={() => void run()}
          disabled={busy}
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          {busy ? 'Zaznavam mrežo…' : 'Zaznaj mrežo ploščic'}
        </Button>
        <Button size="sm" variant="outline" className="min-h-10" onClick={reset} data-testid="tile-reset">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Ponastavi
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Skripta meri KORAK fug (ploščica + fuga) — prava ploščica je za fugo (2–4 mm) manjša.
        Prepoznani vzorec določa odpadek: ravno 10 %, diagonalno 15 %, ribja kost 18 %.
      </p>

      {/* Rezultat */}
      {shown && (
        <div className="space-y-3 rounded-xl border p-3" data-testid="tile-result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Grid3X3 className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Samodejna mreža ploščic</span>
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

          {/* Vzorec — prepoznan predlog, uporabnik potrdi/preklopi */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Vzorec polaganja (predlog iz fotke)</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Vzorec polaganja">
              {(['ravno', 'diagonalno', 'ribja-kost'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  data-testid={`tile-pattern-${p}`}
                  aria-pressed={activePattern === p}
                  onClick={() => setPatternSel(p)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                    activePattern === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {PATTERN_LABEL[p]} · {PATTERN_WASTE[p]} %
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="tile-angle">
              <div className="text-[11px] text-muted-foreground">Kot mreže</div>
              <div className="text-xl font-bold">{fmt1(shown.angleDeg)} <span className="text-sm font-medium">°</span></div>
            </div>
            {shown.tileWCm !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="tile-size">
                <div className="text-[11px] text-muted-foreground">Velikost ploščice</div>
                <div className="text-xl font-bold">
                  ≈ {fmt1(shown.tileWCm)}
                  {shown.tileHCm !== null ? ` × ${fmt1(shown.tileHCm)}` : ''}
                  <span className="text-sm font-medium"> cm</span>
                </div>
              </div>
            )}
            {shown.snapW !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Uveljavljen format</div>
                <div className="text-xl font-bold" data-testid="tile-snap">
                  {shown.snapW}{shown.snapH !== null ? ` × ${shown.snapH}` : ''}
                </div>
              </div>
            )}
            {shown.tilesVisible !== null && (
              <div className="rounded-lg bg-secondary/50 p-2.5">
                <div className="text-[11px] text-muted-foreground">Vidnih ploščic</div>
                <div className="text-xl font-bold">~{shown.tilesVisible}</div>
              </div>
            )}
          </div>

          {shown.pxPerCm === null && (
            <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-700">
              Brez kalibracije — prikazan samo vzorec; za cm vpiši znano ploščico ali umeri po referenci.
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
              <Button size="sm" className="min-h-10" data-testid="tile-send" onClick={() => sendToCalc(shown)}>
                <Grid3X3 className="mr-1.5 h-4 w-4" />
                Pošlji v kalkulator keramike
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary(shown)} data-testid="tile-copy">
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? 'Kopirano' : 'Kopiraj povzetek'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
