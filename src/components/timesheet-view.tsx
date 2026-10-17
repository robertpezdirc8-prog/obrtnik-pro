'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { CRAFTS } from '@/lib/crafts-meta';
import { type AppView, useDraft, useTimer, useView } from '@/lib/store';
import { formatEUR, formatNum } from '@/lib/format';
import { parseNumberInput, readSettings, settingsProblemText } from '@/lib/settings-inputs';
import {
  billableHours, computeTimeStats, formatHours, formatMinutesHM,
  hoursToInvoiceItems, todayDay, weekStartDay,
  type TimeEntryInput,
} from '@/lib/time-tracking';
import { CircleStop, Clock3, Coins, Play, Plus, Trash2, Undo2 } from 'lucide-react';

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('sl-SI', { weekday: 'short' }).format(new Date(`${day}T12:00:00.000Z`));
}
function dayLabel(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
}

export function TimesheetView() {
  const { toast } = useToast();
  const setView = useView((s: { setView: (v: AppView) => void }) => s.setView);
  const addDraftItems = useDraft((s) => s.addItems);
  const setDraftCustomer = useDraft((s) => s.setCustomer);

  const [entries, setEntries] = useState<TimeEntryInput[] | null>(null);
  const [customers, setCustomers] = useState<string[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Časomer ──
  const startedAt = useTimer((s) => s.startedAt);
  const startTimer = useTimer((s) => s.start);
  const stopTimer = useTimer((s) => s.stop);
  const timerLabel = useTimer((s) => s.label);
  const setTimerLabel = useTimer((s) => s.setLabel);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mounted, setMounted] = useState(false);
  const startRef = useRef<number>(0);

  // ── Vnosni obrazec ──
  const [formDay, setFormDay] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formHours, setFormHours] = useState('');
  const [formCustomer, setFormCustomer] = useState('');
  const [formCraft, setFormCraft] = useState('drugo');
  const [formRate, setFormRate] = useState('');

  // ── Brisanje ──
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/time-entries');
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      toast({ title: 'Napaka', description: 'Časovnice ni bilo mogoče naložiti.', variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    setMounted(true);
    const d = new Date();
    setNow(d);
    const today = todayDay(d);
    setFormDay(today);
    setFormRate('');
    void load();
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        // Predpolnimo SAMO veljavno nastavljeno postavko in samo, dokler
        // monter v polje še ni ničesar vpisal. Stari začetnih 35 €/h je bil
        // izmišljen podatek (Task 86) — zdaj ga ni več nikoli.
        const delo = readSettings({ laborRate: s?.settings?.laborRate }).laborRate;
        if (!delo.problem) setFormRate((cur) => (cur === '' ? formatNum(delo.value, 2) : cur));
      })
      .catch(() => undefined);
    fetch('/api/offers')
      .then((r) => r.json())
      .then((o) => {
        const names = [...new Set((o?.offers ?? []).map((x: { customerName: string }) => x.customerName).filter(Boolean))] as string[];
        setCustomers(names);
      })
      .catch(() => undefined);
  }, [load]);

  // Tiktakanje časomera (samo na klientu, brez hydration mismatch)
  useEffect(() => {
    if (!mounted || !startedAt) return;
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [mounted, startedAt]);

  const stats = useMemo(
    () => (entries && now ? computeTimeStats(entries, now) : null),
    [entries, now],
  );

  const startWork = () => {
    startTimer();
    startRef.current = Date.now();
    toast({ title: 'Časomer teče', description: 'Ura teče tudi po osvežitvi strani.' });
  };

  const stopWork = () => {
    const started = stopTimer();
    if (!started) return;
    const minutes = Math.max(1, Math.round((Date.now() - new Date(started).getTime()) / 60000));
    setFormDay(todayDay(new Date()));
    setFormHours(String(Math.round((minutes / 60) * 100) / 100));
    if (timerLabel.trim() !== '') setFormDesc(timerLabel.trim());
    toast({ title: 'Ura ustavljena', description: `Izmerjeno ${formatMinutesHM(minutes)} — preveri vnos in shrani.` });
  };

  const discardWork = () => {
    stopTimer();
    setTimerLabel('');
    setElapsedSec(0);
    toast({ title: 'Časomer preklican', description: 'Merjenje ni bilo shranjeno.' });
  };

  const submitEntry = async () => {
    const hoursNum = Number(formHours.replace(',', '.'));
    const delo = readSettings({ laborRate: parseNumberInput(formRate) }).laborRate;
    const minutes = Math.round(hoursNum * 60);
    if (!formDesc.trim()) {
      toast({ title: 'Manjka opis', description: 'Napiši, kaj si delal.', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1) {
      toast({ title: 'Neveljavne ure', description: 'Vpiši število ur (npr. 1,75).', variant: 'destructive' });
      return;
    }
    // Vpisane urne postavke NE nadomeščamo z nastavljeno: stara različica je
    // ob `0` ali neštevilk tiho shranila uro po privzetki, monter pa je na
    // zaslonu videl svojo številko. Zdaj vnos zavrnemo z razlogom.
    if (delo.problem) {
      toast({ title: 'Urna postavka ni shranjena', description: settingsProblemText(delo.problem), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day: formDay,
          description: formDesc.trim(),
          minutes,
          hourlyRate: delo.value,
          customerName: formCustomer.trim() || null,
          craftId: formCraft === 'drugo' ? null : formCraft,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? 'Shranjevanje ni uspelo');
      }
      setFormDesc('');
      setFormHours('');
      setTimerLabel('');
      await load();
      toast({ title: 'Vnos shranjen', description: `${formatMinutesHM(minutes)} na dan ${dayLabel(formDay)}.` });
    } catch (err) {
      toast({ title: 'Napaka', description: err instanceof Error ? err.message : 'Shranjevanje ni uspelo.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const markBilled = async (ids: string[], ref: string) => {
    try {
      await Promise.all(ids.map((id) =>
        fetch(`/api/time-entries/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billedAt: new Date().toISOString(), billedRef: ref }),
        })));
      await load();
      toast({ title: ref === 'osnutek ponudbe' ? 'Ure so v osnutku ponudbe' : 'Označeno kot obračunano', description: `${ids.length} vnosov.` });
    } catch {
      toast({ title: 'Napaka', description: 'Žiga ni bilo mogoče shraniti.', variant: 'destructive' });
    }
  };

  const unmarkBilled = async (id: string) => {
    try {
      await fetch(`/api/time-entries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billedAt: null }),
      });
      await load();
      toast({ title: 'Obračun razveljavljen' });
    } catch {
      toast({ title: 'Napaka', description: 'Razveljavitev ni uspela.', variant: 'destructive' });
    }
  };

  const addCustomerToDraft = (name: string, ids: string[]) => {
    const group = (entries ?? []).filter((e) => ids.includes(e.id));
    const items = hoursToInvoiceItems(group);
    if (items.length === 0) return;
    addDraftItems(items.map((it) => ({
      key: it.key, name: it.name, description: it.description,
      quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice,
    })));
    setDraftCustomer({ customerName: name === 'Brez stranke' ? '' : name });
    void markBilled(ids, 'osnutek ponudbe');
    setView('kalkulatorji');
  };

  const deleteEntry = async () => {
    if (!deleteId) return;
    try {
      await fetch(`/api/time-entries/${deleteId}`, { method: 'DELETE' });
      await load();
      toast({ title: 'Vnos izbrisan' });
    } catch {
      toast({ title: 'Napaka', description: 'Brisanje ni uspelo.', variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  };

  const timerRunning = mounted && startedAt !== null;
  const elapsedLabel = timerRunning
    ? `${String(Math.floor(elapsedSec / 3600)).padStart(2, '0')}:${String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`
    : null;

  const maxBar = stats ? Math.max(1, ...stats.last7Days.map((d) => d.minutes)) : 1;

  return (
    <div className="space-y-6" data-testid="timesheet-view">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Časovnica</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Oddelane ure → obračun na četrt ure → postavka v ponudbo. Čas se šteje na 0,25 h — zaokroževanje je vedno izpisano.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Časomer ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4.5 w-4.5 text-primary" />
              Časomer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {timerRunning ? (
              <>
                <div className="flex items-center gap-3" role="status" aria-live="polite">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                  </span>
                  <span className="font-mono text-3xl font-bold tabular-nums" data-testid="timer-elapsed">{elapsedLabel}</span>
                </div>
                <Input
                  value={timerLabel}
                  onChange={(e) => setTimerLabel(e.target.value)}
                  placeholder="Kaj počneš? (neobvezno, prenese se v opis)"
                  aria-label="Opis tekočega dela"
                  className="min-h-11"
                />
                <div className="flex gap-2">
                  <Button onClick={stopWork} className="min-h-11 flex-1" data-testid="timer-stop">
                    <CircleStop className="h-4 w-4" />
                    Ustavi in pripravi vnos
                  </Button>
                  <Button onClick={discardWork} variant="outline" className="min-h-11" aria-label="Prekliči merjenje">
                    Prekliči
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Začni ob prihodu na delo — ura teče naprej tudi, če osvežiš stran ali zapreš zavihek.
                </p>
                <Button onClick={startWork} className="min-h-11 w-full text-base" data-testid="timer-start">
                  <Play className="h-4 w-4" />
                  Začni delo
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Ročni vnos ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4.5 w-4.5 text-primary" />
              Ročni vnos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ts-day">Dan</Label>
                <Input id="ts-day" type="date" value={formDay} onChange={(e) => setFormDay(e.target.value)} className="min-h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ts-hours">Ure (npr. 1,75)</Label>
                <Input
                  id="ts-hours" inputMode="decimal" placeholder="1,75"
                  value={formHours} onChange={(e) => setFormHours(e.target.value)}
                  className="min-h-11" data-testid="ts-hours"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ts-desc">Opis opravila</Label>
              <Input
                id="ts-desc" value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Montaža ograje — balkon" className="min-h-11" data-testid="ts-desc"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ts-cust">Stranka (neobvezno)</Label>
                <Input
                  id="ts-cust" list="ts-customers" value={formCustomer}
                  onChange={(e) => setFormCustomer(e.target.value)} placeholder="Ana Kovač"
                  className="min-h-11" data-testid="ts-cust"
                />
                <datalist id="ts-customers">
                  {customers.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ts-rate">Urna postavka (€/h)</Label>
                <Input
                  id="ts-rate" inputMode="decimal" value={formRate}
                  onChange={(e) => setFormRate(e.target.value)} className="min-h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Dejavnost</Label>
              <Select value={formCraft} onValueChange={setFormCraft}>
                <SelectTrigger className="min-h-11" aria-label="Dejavnost">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drugo">Drugo</SelectItem>
                  {CRAFTS.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submitEntry} disabled={saving} className="min-h-11 w-full" data-testid="ts-submit">
              {saving ? 'Shranjujem…' : 'Shrani vnos'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Statistika ── */}
      {stats && now && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Koliko sem delal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-secondary/40 p-3" data-testid="stat-today">
                  <p className="text-xs text-muted-foreground">Danes</p>
                  <p className="text-xl font-bold">{formatHours(stats.todayMinutes)}</p>
                </div>
                <div className="rounded-xl border bg-secondary/40 p-3" data-testid="stat-week">
                  <p className="text-xs text-muted-foreground">Ta teden (od {dayLabel(weekStartDay(todayDay(now)))})</p>
                  <p className="text-xl font-bold">{formatHours(stats.weekMinutes)}</p>
                </div>
                <div className="rounded-xl border bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">Ta mesec</p>
                  <p className="text-xl font-bold">{formatHours(stats.monthMinutes)}</p>
                </div>
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" data-testid="stat-unbilled">
                  <p className="text-xs text-amber-700">Neobračunano</p>
                  <p className="text-xl font-bold text-amber-800">{formatHours(stats.unbilledMinutes)}</p>
                  <p className="text-xs text-amber-700">≈ {formatEUR(stats.unbilledEarned)} (na 0,25 h)</p>
                </div>
              </div>
              <div className="rounded-xl border p-3" data-testid="stat-avg">
                {stats.avgHoursPerDay !== null ? (
                  <>
                    <p className="text-xs text-muted-foreground">Povprečno na delovni dan ({stats.daysWithWork} dni)</p>
                    <p className="text-xl font-bold">{formatNum(stats.avgHoursPerDay)} h</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground" title={`Pod ${3} dnevi povprečja ne trdimo`}>
                    Povprečje na dan: — premalo podatkov ({stats.daysWithWork} dni; trdimo šele od 3)
                  </p>
                )}
              </div>
              {/* Zadnjih 7 dni */}
              <div className="flex items-end gap-1.5 pt-1" aria-label="Oddelane ure po dnevih, zadnjih 7 dni">
                {stats.last7Days.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-all"
                      style={{ height: `${d.minutes > 0 ? Math.max(6, Math.round((d.minutes / maxBar) * 64)) : 4}px` }}
                      title={`${dayLabel(d.day)}: ${formatMinutesHM(d.minutes)}`}
                      role="img"
                      aria-label={`${dayLabel(d.day)}: ${formatMinutesHM(d.minutes)}`}
                    />
                    <span className="text-[10px] text-muted-foreground">{shortDay(d.day)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Neobračunano po strankah ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="h-4.5 w-4.5 text-primary" />
                Neobračunano po strankah
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.byCustomer.length === 0 ? (
                <p className="text-sm text-muted-foreground">Vse ure so obračunane. 👍</p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto scroll-area pr-1" data-testid="unbilled-list">
                  {stats.byCustomer.map((c) => {
                    const ids = (entries ?? [])
                      .filter((e) => !(e.billedAt !== null) && ((e.customerName ?? '').trim() || 'Brez stranke') === c.customerName)
                      .map((e) => e.id);
                    return (
                      <div key={c.customerName} className="rounded-xl border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{c.customerName}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatMinutesHM(c.minutes)} → obračun {formatNum(c.billableHours)} h · {formatEUR(c.earned)}
                            </p>
                          </div>
                          <Badge variant="secondary">{ids.length}</Badge>
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <Button
                            size="sm" className="min-h-11 flex-1" data-testid={`to-draft-${ids[0]}`}
                            onClick={() => addCustomerToDraft(c.customerName, ids)}
                          >
                            <Plus className="h-4 w-4" />
                            V osnutek ponudbe
                          </Button>
                          <Button
                            size="sm" variant="outline" className="min-h-11"
                            onClick={() => void markBilled(ids, 'brez ponudbe')}
                            aria-label={`Označi ${c.customerName} kot obračunano brez ponudbe`}
                          >
                            Obračunano
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Seznam vnosov ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vsi vnosi</CardTitle>
        </CardHeader>
        <CardContent>
          {entries === null ? (
            <p className="text-sm text-muted-foreground">Nalagam…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ts-empty">
              Še ni vnosov — zaženi časomer ali dodaj ročni vnos.
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto scroll-area pr-1" data-testid="ts-list">
              {entries.map((e) => {
                const bh = billableHours(e.minutes);
                const billed = e.billedAt !== null;
                return (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl border p-3">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-xs text-muted-foreground">{dayLabel(e.day)}</p>
                      <p className="font-bold">{formatHours(e.minutes)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.customerName ? `${e.customerName} · ` : ''}
                        obračun {formatNum(bh)} h × {formatNum(e.hourlyRate)} €/h = {formatEUR(bh * e.hourlyRate)}
                      </p>
                    </div>
                    {billed ? (
                      <button
                        onClick={() => void unmarkBilled(e.id)}
                        title={`Obračunano (${e.billedRef ?? ''}) — klik za razveljavitev`}
                        className="shrink-0"
                        aria-label="Razveljavi obračun"
                      >
                        <Badge className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100" data-testid={`billed-${e.id}`}>
                          <Undo2 className="h-3 w-3" />
                          {e.billedRef === 'osnutek ponudbe' ? 'v ponudbi' : 'obračunano'}
                        </Badge>
                      </button>
                    ) : (
                      <Badge variant="outline" className="shrink-0 border-amber-300 text-amber-700">neobračunano</Badge>
                    )}
                    <Button
                      size="icon" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(e.id)}
                      aria-label={`Izbriši vnos ${e.description}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbrišem vnos?</AlertDialogTitle>
            <AlertDialogDescription>
              Izbrisanih ur ni mogoče vrniti. Če si se zmotil pri času, raje vnos popravi z novim.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={deleteEntry} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
