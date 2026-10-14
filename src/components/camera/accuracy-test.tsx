'use client';

// ─── Test natančnosti — protokol Faza 7 (baseline §4) ───────
// Monter na objektu izmeri ZNANO dolžino (trak/laser = resnica),
// aplikacija izmeri isto z izbrano metodo; zapisek dobi napako.
// Iz nabora se računa iskrena statistika (mediana, P95, delež v
// toleranci). POGODBA: manj kot 5 meritev NE trdi nič. Zapiski
// živijo v localStorage (odjemalsko, do 100), izvoz CSV.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Download, FlaskConical, Plus, Trash2 } from 'lucide-react';
import {
  ACCURACY_METHODS, METHOD_LABEL, aggregateStats, downloadAccuracyCsv,
  entryError, type AccuracyEntry, type AccuracyMethod,
} from '@/lib/accuracy-test';
import { formatCm } from '@/lib/measure-geometry';
import { formatNum } from '@/lib/format';
import type { PhotoMeasure } from '@/lib/camera-types';

const STORAGE_KEY = 'accuracy-test-entries';
const MAX_ENTRIES = 100;

const VERDICT_STYLE: Record<string, string> = {
  'nezadostno': 'border-stone-300 bg-stone-50 text-stone-600',
  'potrebna-izboljsava': 'border-destructive/30 bg-destructive/10 text-destructive',
  'osnovno': 'border-amber-300 bg-amber-50 text-amber-800',
  'zanesljivo': 'border-green-300 bg-green-50 text-green-700',
};

interface AccuracyTestProps {
  /** Pripomočki (laser/glas/AR) — hitri vnos izmerjene vrednosti. */
  auxMeasures?: PhotoMeasure[];
}

let entrySeq = 0;
const newId = () => `acc${++entrySeq}-${Date.now()}`;

export function AccuracyTest({ auxMeasures = [] }: AccuracyTestProps) {
  const [entries, setEntries] = useState<AccuracyEntry[] | null>(null);
  const [label, setLabel] = useState('');
  const [method, setMethod] = useState<AccuracyMethod>('foto-mera');
  const [trueIn, setTrueIn] = useState('');
  const [measuredIn, setMeasuredIn] = useState('');
  const [tolerance, setTolerance] = useState('2');

  // localStorage samo odjemalsko (brez hydration mismatch; asinhrono —
  // pravilo react-hooks/set-state-in-effect zahteva mejo)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setEntries(
              parsed.filter(
                (e): e is AccuracyEntry =>
                  !!e && typeof e === 'object' && 'id' in e && 'trueCm' in e && 'measuredCm' in e,
              ),
            );
            return;
          }
        }
      } catch {
        // pokvarjen zapis → zacni prazno
      }
      setEntries([]);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const save = (next: AccuracyEntry[]) => {
    setEntries(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // polna kvota — stanje ostane do osvežitve (iskreno vedenje)
    }
  };

  const tol = parseFloat(tolerance) > 0 ? parseFloat(tolerance) : 2;
  const stats = useMemo(() => aggregateStats(entries ?? [], tol), [entries, tol]);
  const lastAux = [...auxMeasures].reverse().find((m) => m.value !== null && m.value > 0);

  const addEntry = () => {
    const trueCm = parseFloat(trueIn);
    const measuredCm = parseFloat(measuredIn);
    if (!Number.isFinite(trueCm) || trueCm <= 0 || !Number.isFinite(measuredCm) || measuredCm <= 0) return;
    const entry: AccuracyEntry = {
      id: newId(),
      label: label.trim() || `Test ${(entries?.length ?? 0) + 1}`,
      method,
      trueCm,
      measuredCm,
      recordedAt: new Date().toISOString(),
    };
    save([...(entries ?? []), entry].slice(-MAX_ENTRIES));
    setLabel('');
    setTrueIn('');
    setMeasuredIn('');
  };

  const removeEntry = (id: string) => save((entries ?? []).filter((e) => e.id !== id));

  return (
    <div className="space-y-4" data-testid="accuracy-test">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <FlaskConical className="h-4 w-4 text-amber-600" aria-hidden />
          Test natančnosti — protokol na objektu
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Izmeri znano dolžino s trakom (resnica), isto dolžino izmeri z metodo aplikacije in zapiši
          par. Aplikacija NE trdi natančnosti, dokler je sam ne izmeriš — ta protokol je ta dokaz
          (Faza 7). Manj kot 5 testov = brez trditev.
        </p>
      </div>

      {/* vnos zapiska */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
          Oznaka testa
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="npr. Vrata dnevna soba"
            className="h-11"
            aria-label="Oznaka testa"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Metoda
          <Select value={method} onValueChange={(v) => setMethod(v as AccuracyMethod)}>
            <SelectTrigger className="h-11" aria-label="Metoda merjenja">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCURACY_METHODS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Toleranca (± %)
          <Input
            type="number"
            inputMode="decimal"
            min="0.1"
            step="0.5"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="h-11"
            aria-label="Toleranca v odstotkih"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Resnica — trak/laser (cm)
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.5"
            placeholder="npr. 200"
            value={trueIn}
            onChange={(e) => setTrueIn(e.target.value)}
            className="h-11"
            aria-label="Resnica iz traku v centimetrih"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Izmerjeno z aplikacijo (cm)
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.5"
            placeholder="npr. 202"
            value={measuredIn}
            onChange={(e) => setMeasuredIn(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            className="h-11"
            aria-label="Izmerjena vrednost aplikacije v centimetrih"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-11 min-h-11" onClick={addEntry} disabled={!trueIn || !measuredIn}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Zapiši test
        </Button>
        {lastAux && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 min-h-11"
            onClick={() => setMeasuredIn(String(lastAux.value))}
          >
            Iz zadnje meritve: {lastAux.label} ({formatCm(lastAux.value!)})
          </Button>
        )}
      </div>

      {/* sodba + statistika */}
      {stats.n > 0 && (
        <div className="space-y-2">
          <div
            className={`inline-flex rounded-lg border px-3 py-1.5 text-xs font-semibold ${VERDICT_STYLE[stats.verdict]}`}
            data-testid="accuracy-verdict"
          >
            {stats.verdictLabel}
          </div>
          <p className="text-xs text-muted-foreground">{stats.verdictHint}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Meritev</p>
              <p className="text-sm font-bold">{stats.n}</p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Mediana</p>
              <p className="text-sm font-bold">{formatNum(stats.medianPct, 2)} %</p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">P95</p>
              <p className="text-sm font-bold">{formatNum(stats.p95Pct, 2)} %</p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Najslabša</p>
              <p className="text-sm font-bold">{formatNum(stats.maxPct, 2)} %</p>
            </div>
            <div className="rounded-xl border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">V toleranci</p>
              <p className="text-sm font-bold">{Math.round(stats.passRate * 100)} %</p>
            </div>
          </div>
        </div>
      )}

      {/* seznam zapiskov */}
      {(entries?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold">Zapiski ({entries!.length})</h4>
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => downloadAccuracyCsv(entries!, tol)}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                CSV
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive">
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Počisti vse
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Počistim vse zapiski testa?</AlertDialogTitle>
                    <AlertDialogDescription>
                      To izbriše {entries!.length} zapiskov natančnosti. Tega ni mogoče razveljaviti.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Prekliči</AlertDialogCancel>
                    <AlertDialogAction onClick={() => save([])}>Počisti</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          </div>
          <ul className="max-h-96 space-y-1 overflow-y-auto scroll-area pr-1" aria-label="Zapiski testa natančnosti">
            {[...(entries ?? [])].reverse().map((e) => {
              const err = entryError(e, tol);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">
                      {METHOD_LABEL[e.method]}
                    </Badge>
                    <span className="truncate font-medium">{e.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatCm(e.trueCm)} → {formatCm(e.measuredCm)}
                    </span>
                    <strong className={err.pass ? 'text-green-700' : 'text-destructive'}>
                      {formatNum(err.pct, 2)} %
                    </strong>
                    <button
                      onClick={() => removeEntry(e.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Izbriši zapis ${e.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
