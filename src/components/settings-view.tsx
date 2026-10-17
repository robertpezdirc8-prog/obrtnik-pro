'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Building, HardHat } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFieldMode } from '@/lib/store';
import { formatNum } from '@/lib/format';
import type { SettingsDTO } from '@/lib/types';
import {
  numberProblemSentence,
  parseNumberInput,
  readSettings,
  SETTINGS_INPUT_BOUNDS,
  settingsProblemShort,
  settingsProblemText,
  settingsWindowHint,
  type SettingsField,
} from '@/lib/settings-inputs';

/** Vsa številčna polja nastavitev — seznam vzame REGISTRA, da se ne more
 *  raziti (nova nastavitev brez okna tu ne more ostati). */
const SETTINGS_NUMBER_FIELDS = SETTINGS_INPUT_BOUNDS.map((b) => b.field as SettingsField);

export function SettingsView() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fieldMode = useFieldMode((s) => s.enabled);
  const setFieldMode = useFieldMode((s) => s.set);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setSettings(d.settings ?? null))
      .catch(() => toast({ title: 'Napaka', description: 'Nastavitev ni bilo mogoče naložiti.', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  const patch = (key: keyof SettingsDTO, value: string | number) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  // ─── Številčna polja: VPISANO ostane dobesedno ─────────────
  // Stara različica je vsak `onChange` prevedla z `Number(v) || 0` oziroma
  // `|| 15`, torej je izprazniti polje pomenilo tiho zapisati 0 ali 15. Zdaj
  // gre vnos skozi `raw` (string), preden je kaj shranjeno; če je zunaj
  // okna, ga pokažemo z razlogom in ga NE pošljemo na strežnik.
  const [raw, setRaw] = useState<Partial<Record<SettingsField, string>>>({});

  const draft = useMemo<SettingsDTO | null>(() => {
    if (!settings) return null;
    const d = { ...settings };
    for (const f of SETTINGS_NUMBER_FIELDS) {
      const typed = raw[f];
      if (typed !== undefined) d[f] = parseNumberInput(typed);
    }
    return d;
  }, [settings, raw]);

  const readings = draft ? readSettings(draft) : null;

  const save = async () => {
    if (!settings || !draft || !readings) return;
    // Nekaj je vpisano, a zunaj okna → ta polja NE grejo na strežnik (nič se
    // ne popravi in nič se ne izmisli); ostala se shrani normalno.
    const blocked = SETTINGS_NUMBER_FIELDS.filter((f) => readings[f].problem);
    // Pošljemo OSNUTEK (`draft`), ne `settings`: monter, ki vpíše 33,7 in
    // pritisne Shrani, mora tudi DOBITI 33,7. Z `{ ...settings }` bi bila na
    // strežnik odposlana STARA vrednost, odgovor pa »Nastavitve shranjene ✓« —
    // tiho neshranjenje, ki ga enotski test ne vidi, ker ne pozna gumba.
    const payload: Partial<SettingsDTO> = { ...draft };
    for (const f of blocked) delete payload[f];
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
      setRaw((prev) => {
        const next = { ...prev };
        for (const f of SETTINGS_NUMBER_FIELDS) if (!readings[f].problem) delete next[f];
        return next;
      });
      toast(
        blocked.length === 0
          ? { title: 'Nastavitve shranjene ✓', description: 'Podatki se pojavijo na NOVIH dokumentih; že izdane ponudbe in računi ostanejo takšni, kot so bili izdani.' }
          : {
              title: 'Delno shranjeno',
              description:
                `${blocked.map((f) => settingsProblemShort(readings[f].problem!)).join(', ')} — ` +
                'vpisane vrednosti niso shranjene in niso popravljene; dokumenti zanje uporabljajo zadnjo veljavno vrednost.',
              variant: 'destructive',
            },
      );
    } catch {
      toast({ title: 'Napaka', description: 'Shranjevanje ni uspelo.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Nalagam nastavitve…
      </div>
    );
  }
  if (!settings || !draft || !readings) return null;

  /** Ena vrstica polja: vpis DOBESEDNO iz `raw`, namig ali zavrnitev iz REGISTRA. */
  const numberField = (field: SettingsField, label: string, extra?: string) => {
    const r = readings[field];
    const typed = raw[field];
    // Shranjena vrednost se prikaže Z VEJICO: `String(33.7)` bi v polju
    // pokazalo "33.7", monter pa številko bere kot 33,7. Brez veljavne
    // shranjene številke je polje PRAZNO — ni nadomestne vrednosti.
    const stored = settings[field];
    const shown = Number.isFinite(stored) ? formatNum(stored, 2) : '';
    return (
      <div className="space-y-1.5" data-settings-field={field}>
        <Label htmlFor={`settings-${field}`}>{label}</Label>
        <Input
          id={`settings-${field}`}
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={r.problem ? true : undefined}
          value={typed ?? shown}
          onChange={(e) => setRaw((p) => ({ ...p, [field]: e.target.value }))}
        />
        <p className={`text-xs ${r.problem ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`} data-testid="settings-field-problem">
          {r.problem
            ? r.problem.side === 'nan' && (typed ?? '').trim() !== ''
              ? `${numberProblemSentence(label, typed ?? '')}. Te vrednosti ne shranimo.`
              : settingsProblemText(r.problem)
            : settingsWindowHint(field, extra)}
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nastavitve podjetja</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ti podatki se izpišejo na PDF ponudbah.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building className="h-4 w-4 text-primary" />
            Podatki podjetja
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Ime podjetja / obrta</Label>
            <Input value={settings.companyName} onChange={(e) => patch('companyName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Lastnik</Label>
            <Input value={settings.ownerName} onChange={(e) => patch('ownerName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Davčna številka</Label>
            <Input value={settings.taxNumber} onChange={(e) => patch('taxNumber', e.target.value)} placeholder="SI12345678" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Naslov</Label>
            <Input value={settings.address} onChange={(e) => patch('address', e.target.value)} placeholder="Ulica 1, 1000 Ljubljana" />
          </div>
          <div className="space-y-1.5">
            <Label>Telefon</Label>
            <Input value={settings.phone} onChange={(e) => patch('phone', e.target.value)} inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label>E-pošta</Label>
            <Input value={settings.email} onChange={(e) => patch('email', e.target.value)} inputMode="email" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>IBAN (za akontacije)</Label>
            <Input value={settings.iban} onChange={(e) => patch('iban', e.target.value)} placeholder="SI56 1234 1234 1234 123" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Privzete cene</CardTitle>
          <CardDescription>Uporabijo se pri novih ponudbah in kalkulatorjih.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {numberField('vatRate', 'DDV stopnja (%)')}
          {numberField('laborRate', 'Urna postavka dela (€/h)')}
          {numberField('quoteValidDays', 'Veljavnost ponudbe (dni)', 'Izpiše se na PDF')}
          {numberField('depositPercent', 'Akontacija (%)', 'Izpiše se na PDF in v SMS povzetku')}
          {numberField('paymentDays', 'Rok plačila računa (dni)', 'Izpiše se na računu kot datum zapadlosti')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <HardHat className="h-4 w-4 text-primary" />
            Terenski način
          </CardTitle>
          <CardDescription>
            Za delo v rokavicah in na soncu: veliki gumbi (≥ 48 px), večja pisava in močan kontrast.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div>
              <Label className="text-sm font-medium">Aktiviraj terenski način</Label>
              <p className="text-xs text-muted-foreground">Shranjeno v brskalniku · hiter preklop tudi z gumbom v glavi</p>
            </div>
            <Switch
              checked={fieldMode}
              onCheckedChange={setFieldMode}
              aria-label="Terenski način"
              data-testid="field-mode-switch"
            />
          </div>
        </CardContent>
      </Card>

      <Button className="min-h-11 w-full sm:w-auto" onClick={save} disabled={saving} size="lg">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Shrani nastavitve
      </Button>
    </div>
  );
}
