'use client';

// ─── Okna/vrata — samodejni popis odprtin s fotke (meritvena skripta, 0 AI) ──
// Iz kandidatov analize (Task 24: vrata + okna z okvirji v % slike) zgradi
// standarden popis odprtin: oznake, širina × višina (kalibracija po referenci),
// površine, deduplikacija (IoU ≥ 0,5) in povzetek → kalkulator okna/vrata.
// Uporabnik lahko odprtine izključi (klik na okvir ali potrditveno polje) in
// dodaja manjkajoče ročno (2 klika: zgornje-levi, spodnje-desni kot).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  DoorOpen, Ruler, AlertTriangle, Copy, Check, Download, MousePointer2, Trash2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ScaleAgreement, ScaleSuggestion } from '@/lib/camera-types';
import {
  buildOpeningSchedule, downloadScheduleCsv, formatScheduleText,
  prefillOknaVrata, type OpeningBoxInput, type OpeningKind,
} from '@/lib/opening-schedule';

interface OpeningPanelProps {
  dataUrl: string | null;
  /** Kandidati odprtin iz analize (Task 24) — urejeni po zanesljivosti. */
  suggestions: ScaleSuggestion[];
  agreement: ScaleAgreement;
  /** Pošlji popis v kalkulator okna/vrata (windowCount, windowSize, doorCount). */
  onSendToCalculator?: (inputs: { windowCount?: number; windowSize?: number; doorCount?: number }) => void;
}

const KIND_LABEL: Record<OpeningKind, string> = { 'vrata': 'Vrata', 'okno': 'Okno' };
const KIND_COLOR: Record<OpeningKind, string> = { 'vrata': '#d97706', 'okno': '#16a34a' };

export function OpeningPanel({ dataUrl, suggestions, agreement, onSendToCalculator }: OpeningPanelProps) {
  const { toast } = useToast();
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [refId, setRefId] = useState<string | null>(null); // null = samodejno najboljša
  const [excluded, setExcluded] = useState<string[]>([]);
  const [manual, setManual] = useState<OpeningBoxInput[]>([]);
  const [addKind, setAddKind] = useState<OpeningKind | null>(null); // način dodajanja
  const [clicks, setClicks] = useState<[number, number][]>([]);
  const [copied, setCopied] = useState(false);
  const manualSeq = useRef(0);

  useEffect(() => {
    if (!dataUrl) return; // stari imgEl ostane — uporaba varna prek activeImg
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => { if (alive) setImgEl(null); };
    img.src = dataUrl;
    return () => { alive = false; };
  }, [dataUrl]);

  // veljavna slika samo, če ustreza trenutnemu dataUrl (zaščita pred starim stanjem)
  const activeImg = imgEl && imgEl.src === dataUrl ? imgEl : null;

  const schedule = useMemo(() => buildOpeningSchedule({
    suggestions,
    naturalWidth: activeImg?.naturalWidth ?? 0,
    naturalHeight: activeImg?.naturalHeight ?? 0,
    refId,
    manual,
    excludedIds: excluded,
    agreement,
  }), [suggestions, activeImg, refId, manual, excluded, agreement]);

  /** Klik na fotko: v načinu dodajanja zbira 2 oglišča, izven preklaplja vključenost. */
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
          const id = `manual-${manualSeq.current}`;
          setManual((prev) => [...prev, { id, kind: addKind, box: [bx, by, bw, bh], confidence: 80, source: 'rocno' }]);
          toast({ title: `${KIND_LABEL[addKind]} dodana v popis ✓`, description: 'Meritev sledi takoj po kalibraciji.' });
        }
        setClicks([]);
      }
    }
  };

  const toggleIncluded = (id: string) => {
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const copySummary = async () => {
    const text = formatScheduleText(schedule);
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
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    toast({ title: 'Popis kopiran', description: 'Tabela odprtin je v odložišču — prilepi v e-pošto ali WhatsApp.' });
  };

  const sendToCalc = () => {
    if (!onSendToCalculator) return;
    const prefill = prefillOknaVrata(schedule);
    if (Object.keys(prefill).length === 0) {
      toast({ title: 'Ni odprtin v popisu', description: 'Vključi vsaj eno vrata ali okno.', variant: 'destructive' });
      return;
    }
    onSendToCalculator(prefill);
    const parts: string[] = [];
    if (prefill.windowCount) parts.push(`${prefill.windowCount} okn`);
    if (prefill.doorCount) parts.push(`${prefill.doorCount} vrat`);
    if (prefill.windowSize) parts.push(`povpr. ${String(prefill.windowSize).replace('.', ',')} m²`);
    toast({ title: 'Poslano v kalkulator okna/vrata ✓', description: parts.join(' · ') });
  };

  if (!dataUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Naloži ali fotografiraj fasado / steno z odprtinami — skripta samodejno sestavi popis
        (vrata in okna z merami), kot ga zahteva dobavitelj oken.
      </p>
    );
  }

  const cal = schedule.calibration;
  const addMode = addKind !== null;
  const inc = schedule.openings.filter((o) => o.included);

  return (
    <div className="space-y-3" data-testid="opening-panel">
      {/* Fotka + SVG okvirji odprtin */}
      <div
        className="relative mx-auto w-fit overflow-hidden rounded-xl border bg-stone-100"
        data-testid="opening-stage"
        onClick={clickImage}
        role={addMode ? 'button' : undefined}
        aria-label={addMode ? `Dodajanje: klikni zgornje-levi, potem spodnje-desni kot ${KIND_LABEL[addKind!]}` : undefined}
      >
        <img src={dataUrl} alt="Fotografija odprtin" className="block max-h-64 w-auto" draggable={false} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {schedule.openings.map((o) => {
            const color = !o.included ? '#78716c' : KIND_COLOR[o.kind];
            return (
              <g key={o.id}>
                <rect
                  x={o.box[0]}
                  y={o.box[1]}
                  width={o.box[2]}
                  height={o.box[3]}
                  fill="none"
                  stroke={color}
                  strokeWidth={o.source === 'rocno' ? 0.5 : 0.35}
                  strokeDasharray={!o.included ? '1.5 1.5' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {clicks.length > 0 && clicks.map((p, i) => (
            <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={0.6} fill="#dc2626" vectorEffect="non-scaling-stroke" />
          ))}
          {clicks.length === 2 && (() => {
            const x0 = Math.min(clicks[0][0], clicks[1][0]);
            const y0 = Math.min(clicks[0][1], clicks[1][1]);
            return (
              <rect
                x={x0}
                y={y0}
                width={Math.abs(clicks[1][0] - clicks[0][0])}
                height={Math.abs(clicks[1][1] - clicks[0][1])}
                fill="none"
                stroke="#dc2626"
                strokeWidth={0.45}
                strokeDasharray="1.5 1.5"
                vectorEffect="non-scaling-stroke"
              />
            );
          })()}
        </svg>
        {/* oznake mer nad okvirji (HTML plast za čitljivost) */}
        <div className="pointer-events-none absolute inset-0">
          {schedule.openings.map((o) => (
            <div
              key={`l-${o.id}`}
              className="absolute rounded bg-black/70 px-1 py-px text-[10px] font-semibold leading-tight text-white"
              style={{
                left: `${o.box[0]}%`,
                top: `${o.box[1]}%`,
                transform: 'translateY(-100%)',
                color: !o.included ? '#d6d3d1' : '#fff',
              }}
            >
              {o.label}
              {o.widthCm !== null && o.heightCm !== null
                ? ` ${o.widthCm}×${o.heightCm}`
                : ''}
            </div>
          ))}
        </div>
        {addMode && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-center text-[11px] font-medium text-white">
            {clicks.length === 0
              ? `Klikni zgornje-levi kot ${KIND_LABEL[addKind!]}`
              : 'Zdaj klikni spodnje-desni kot'}
          </div>
        )}
      </div>

      {/* Kalibracija — izbira referenčne odprtine */}
      <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
        <Label className="text-xs font-medium">Merilo (referenca umeri vse odprtine)</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Merilo">
          {suggestions.length > 0 ? suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid={`opening-ref-${s.id}`}
              aria-pressed={(refId ?? suggestions[0]?.id) === s.id}
              onClick={() => setRefId(s.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                (refId ?? suggestions[0]?.id) === s.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <Ruler className="mr-1 inline h-3.5 w-3.5" />
              {s.label} ≈ {s.assumedCm} cm · {s.confidence}/100
            </button>
          )) : (
            <p className="text-xs text-amber-700">
              Ni zaznanih referenčnih odprtin — popis je brez mer. Dodaj odprtino ročno ali umeri v načinu »Dolžine«.
            </p>
          )}
        </div>
        {agreement === 'high' && suggestions.length >= 2 && (
          <p className="text-xs text-green-700">Merila kandidatov se ujemajo ✓ — mere so zanesljive.</p>
        )}
        {agreement === 'low' && (
          <p className="text-xs text-amber-700">Merila kandidatov se NE ujemajo — mere odprtin v globini so nezanesljive.</p>
        )}
      </div>

      {/* Ročno dodajanje */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ročno dodajanje odprtine">
        <span className="text-xs text-muted-foreground">Manjka odprtina?</span>
        {(['vrata', 'okno'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={addKind === k}
            data-testid={`opening-add-${k}`}
            onClick={() => { setAddKind(addKind === k ? null : k); setClicks([]); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
              addKind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
            }`}
          >
            <MousePointer2 className="mr-1 inline h-3.5 w-3.5" />
            Dodaj {KIND_LABEL[k].toLowerCase()} (2 klika)
          </button>
        ))}
        {(addMode || manual.length > 0) && (
          <button
            type="button"
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent min-h-[32px]"
            onClick={() => { setAddKind(null); setClicks([]); }}
          >
            Prekliči dodajanje
          </button>
        )}
        {manual.length > 0 && (
          <button
            type="button"
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent min-h-[32px]"
            data-testid="opening-clear-manual"
            onClick={() => setManual([])}
          >
            <Trash2 className="mr-1 inline h-3.5 w-3.5" />
            Počisti ročne ({manual.length})
          </button>
        )}
      </div>

      {/* Tabela popisa */}
      {schedule.openings.length > 0 && (
        <div className="overflow-hidden rounded-xl border" data-testid="opening-table">
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="sticky top-0 bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Vklj.</th>
                  <th className="px-3 py-2 font-medium">Odprtina</th>
                  <th className="px-3 py-2 font-medium">Širina × višina</th>
                  <th className="px-3 py-2 font-medium">m²</th>
                  <th className="px-3 py-2 font-medium">Vir</th>
                </tr>
              </thead>
              <tbody>
                {schedule.openings.map((o) => (
                  <tr key={o.id} className={`border-t ${o.included ? '' : 'opacity-50'}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={o.included}
                        onChange={() => toggleIncluded(o.id)}
                        aria-label={`Vključi ${o.label}`}
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{o.label}</span>
                      {o.widthPlausible === false && o.included && (
                        <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 text-[10px] text-amber-700">nepričakovana</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {o.widthCm !== null && o.heightCm !== null
                        ? `${o.widthCm} × ${o.heightCm} cm`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{o.areaM2 !== null ? String(o.areaM2).replace('.', ',') : '—'}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {o.source === 'rocno' ? 'ročno' : `auto ${o.confidence}/100`}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Povzetek */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="opening-doors">
          <div className="text-[11px] text-muted-foreground">Vrata</div>
          <div className="text-xl font-bold">{schedule.doorCount}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="opening-windows">
          <div className="text-[11px] text-muted-foreground">Okna</div>
          <div className="text-xl font-bold">{schedule.windowCount}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="opening-avg">
          <div className="text-[11px] text-muted-foreground">Povprečno okno</div>
          <div className="text-xl font-bold">
            {schedule.windowAvgM2 !== null ? `${String(schedule.windowAvgM2).replace('.', ',')} m²` : '—'}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2.5" data-testid="opening-total">
          <div className="text-[11px] text-muted-foreground">Skupaj odprtine</div>
          <div className="text-xl font-bold">
            {schedule.totalGlazingM2 !== null ? `${String(schedule.totalGlazingM2).replace('.', ',')} m²` : '—'}
          </div>
        </div>
      </div>

      {!cal && schedule.openings.length > 0 && (
        <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-700">
          Brez kalibracije — mere niso na voljo. Izberi referenco zgoraj ali umeri v načinu »Dolžine«.
        </Badge>
      )}

      {schedule.warnings.length > 0 && (
        <ul className="space-y-1" role="alert">
          {schedule.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Mere so iz fotke (napaka zaznave 2–5 %) — pred naročilom pri dobavitelju jih preveri z laserskim merilnikom.
        Klik na okvir na fotki izključi/vključi odprtino.
      </p>

      {/* Akcije */}
      {schedule.openings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {onSendToCalculator && (
            <Button size="sm" className="min-h-10" data-testid="opening-send" onClick={sendToCalc} disabled={inc.length === 0}>
              <DoorOpen className="mr-1.5 h-4 w-4" />
              Pošlji v kalkulator okna/vrata
            </Button>
          )}
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => void copySummary()} data-testid="opening-copy">
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? 'Kopirano' : 'Kopiraj popis'}
          </Button>
          <Button size="sm" variant="outline" className="min-h-10" onClick={() => downloadScheduleCsv(schedule, 'fotka')} data-testid="opening-csv">
            <Download className="mr-1.5 h-4 w-4" />
            Prenesi CSV
          </Button>
        </div>
      )}
    </div>
  );
}
