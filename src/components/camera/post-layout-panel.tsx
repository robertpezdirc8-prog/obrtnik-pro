'use client';

// ─── Razpored stebrov + razrez polnil (Task 25, 0 AI) ────────
// Iz izmerjene trase (veriga čez teren ali navadna daljica) deterministično
// načrtuje: število stebrov, enakomerni razmak, širine celot, dvige na celoto,
// rezalne višine polnil in razrez — racked (sledi naklonu) ali stepped
// (stopničasto). Vhod: PhotoMeasure iz camera-view (sides + segmentsDrop).

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Columns3, Copy, Download, TriangleAlert, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PhotoMeasure } from '@/lib/camera-types';
import {
  planPostLayout, formatLayoutText, downloadLayoutCsv,
  type LayoutMode, type PostLayoutResult,
} from '@/lib/post-layout';
import { formatCm } from '@/lib/measure-geometry';

const MAX_SPANS = [100, 125, 150, 175, 200, 250];

/** Kandidati za razpored: verige (profil) in daljice/laser/glas/AR ≥ 100 cm (ravno). */
export function layoutSources(measures: PhotoMeasure[]): PhotoMeasure[] {
  const chains = measures.filter((m) => m.kind === 'chain' && (m.sides?.length ?? 0) >= 1 && m.value !== null);
  const flats = measures.filter(
    (m) => (m.kind === 'length' || m.kind === 'laser' || m.kind === 'voice' || m.kind === 'xr') &&
      m.value !== null && m.value >= 100,
  );
  return [...chains, ...flats];
}

/** Profil trase za izbrano meritev (cm po naklonu + dvigi). */
function profileOf(m: PhotoMeasure): { segRunCm: number[]; segDropCm: number[] } {
  if (m.kind === 'chain' && m.sides?.length) {
    const segRunCm = m.sides;
    const drops = m.segmentsDrop;
    const segDropCm = segRunCm.map((_, i) => (drops && drops.length === segRunCm.length ? drops[i] : 0));
    return { segRunCm, segDropCm };
  }
  return { segRunCm: [m.value ?? 0], segDropCm: [0] };
}

interface PostLayoutPanelProps {
  measures: PhotoMeasure[];
}

export function PostLayoutPanel({ measures }: PostLayoutPanelProps) {
  const { toast } = useToast();
  const sources = useMemo(() => layoutSources(measures), [measures]);
  const [srcId, setSrcId] = useState<string | null>(null);
  const [mode, setMode] = useState<LayoutMode>('racked');
  const [maxSpan, setMaxSpan] = useState(150);
  const [panelH, setPanelH] = useState(190);

  // učinkoviti vir: izbrani, sicer prvi (verige imajo prednost — glej layoutSources)
  const src = sources.find((s) => s.id === srcId) ?? sources[0] ?? null;
  const layout: PostLayoutResult | null = useMemo(() => {
    if (!src) return null;
    const { segRunCm, segDropCm } = profileOf(src);
    return planPostLayout({ segRunCm, segDropCm, mode, maxSpanCm: maxSpan, panelHeightCm: panelH });
  }, [src, mode, maxSpan, panelH]);

  const copyPlan = async () => {
    if (!layout || !src) return;
    const text = formatLayoutText(layout, src.label);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback (headless/starejši brskalniki): začasni textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast({ title: 'Načrt kopiran', description: 'Razpored stebrov je v odložišču — prilepi v beležko, e-pošto ali WhatsApp.' });
  };

  if (sources.length === 0) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Izmeri traso (način »Veriga« na fotki) ali vsaj eno dolžino ≥ 1 m — skripta
          samodejno razporedi stebre, izračuna dvige in razreže polnila.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="post-layout">
      {/* Vir + nastavitve */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Izmerjena trasa</span>
          <Select value={src?.id} onValueChange={(v) => setSrcId(v)}>
            <SelectTrigger className="min-h-11 w-full" aria-label="Izmerjena trasa">
              <SelectValue placeholder="Izberi meritev" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label} · {formatCm(s.value ?? 0)}{s.kind === 'chain' ? ' (naklon)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Največji razmak stebrov</span>
          <Select
            value={String(maxSpan)}
            onValueChange={(v) => setMaxSpan(Number(v))}
          >
            <SelectTrigger className="min-h-11 w-full" aria-label="Največji razmak stebrov">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAX_SPANS.map((s) => (
                <SelectItem key={s} value={String(s)}>{(s / 100).toFixed(2).replace('.', ',')} m</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Način montaže */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Način montaže</span>
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Način montaže">
            {([
              ['racked', 'Sledi naklonu'],
              ['stepped', 'Stopničasto'],
            ] as [LayoutMode, string][]).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={`flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors min-h-10 ${mode === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
        {/* Višina polnila */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Višina polnila (cm)</span>
          <Input
            type="number"
            inputMode="decimal"
            min={30}
            max={300}
            step={5}
            value={panelH}
            onChange={(e) => setPanelH(Number(e.target.value))}
            className="min-h-11"
            aria-label="Višina polnila v centimetrih"
          />
        </label>
      </div>

      {layout && src ? (
        <>
          {/* Povzetek */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/50 p-3 sm:grid-cols-4" data-testid="post-layout-summary">
            {[
              ['Stebri', String(layout.postCount)],
              ['Razmak', formatCm(layout.spacingCm)],
              ['Dvig', formatCm(layout.riseCm)],
              ['Naklon', `${layout.slopeDeg.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}°`],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
                <p className="text-sm font-bold">{v}</p>
              </div>
            ))}
          </div>

          {/* Opozorila */}
          {layout.warnings.length > 0 && (
            <ul className="space-y-1" role="alert">
              {layout.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {/* Celote */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Celote ({layout.bays.length}) — širina · dvig terena · rezalna višina polnila
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto scroll-area pr-1" data-testid="post-layout-bays">
              {layout.bays.map((b) => (
                <li key={b.index} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-xs">
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">{b.index}</Badge>
                  </span>
                  <span className="font-medium">{formatCm(b.widthCm)}</span>
                  <span className={b.riseCm === 0 ? 'text-muted-foreground' : 'font-medium'}>
                    {b.riseCm === 0 ? 'raven' : `${b.riseCm > 0 ? '+' : '−'}${formatCm(Math.abs(b.riseCm))}`}
                  </span>
                  <span className="font-medium">{formatCm(b.cutHeightCm)}</span>
                  {b.slantCm !== null && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">vzd. {formatCm(b.slantCm)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Razrez */}
          <div className="space-y-1 rounded-xl border p-3" data-testid="post-layout-cuts">
            <p className="text-xs font-medium text-muted-foreground">Razrez polnil — {layout.areaM2.toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² skupaj</p>
            <ul className="space-y-0.5 text-sm">
              {layout.cutLines.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <Columns3 className="h-3.5 w-3.5 text-primary" />
                  {c}
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-muted-foreground">
              {layout.mode === 'racked'
                ? 'Vzdolžnice sledijo terenu; polnila v bazni višini.'
                : 'Polnila na nižji strani zapolnijo padec — rezalna višina po celoti.'}
            </p>
          </div>

          {/* Akcije */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-10" onClick={() => void copyPlan()} data-testid="post-layout-copy">
              <Copy className="mr-1.5 h-4 w-4" />
              Kopiraj načrt
            </Button>
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => downloadLayoutCsv(layout, src.label)} data-testid="post-layout-csv">
              <Download className="mr-1.5 h-4 w-4" />
              Prenesi CSV
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
