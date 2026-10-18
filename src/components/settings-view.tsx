'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Building, HardHat, Users, UserPlus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFieldMode } from '@/lib/store';
import { useSessionGate } from './auth/login-gate';
import { normalizeRole } from '@/lib/permissions';
import { formatDate, formatNum } from '@/lib/format';
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
  // Ekipa (Task 97): kartica je vidna SAMO prijavljenemu lastniku —
  // v privzetem načinu (brez seje) ni ekipe, ker ni komu pripisati.
  const sessionGate = useSessionGate();
  const isOwnerSession = sessionGate !== null && normalizeRole(sessionGate.user.role) === 'owner';

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

      {isOwnerSession && <TeamCard />}

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

// ─── Ekipa (Task 97): montirji mojega obrta ──────────────────
// Lastnik dodaja montirja po e-pošti; če račun še ne obstaja, mu
// ustvari začasno geslo. Odstranitev članstva = takojšnja izguba
// obsega na strežniku (Member vrstica); zgodovina montirjevega
// dela ostane. UI je le priročnik — API je pravilo (401/403).
interface TeamMemberDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

function TeamCard() {
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMemberDTO[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const nalozi = useCallback(async () => {
    try {
      const res = await fetch('/api/team', { cache: 'no-store' });
      if (!res.ok) {
        setMembers([]);
        return;
      }
      const d = (await res.json()) as { members?: TeamMemberDTO[] };
      setMembers(d.members ?? []);
    } catch {
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void nalozi();
  }, [nalozi]);

  const dodaj = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password: password || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; member?: TeamMemberDTO };
      if (!res.ok || !d.member) {
        setFormError(typeof d.error === 'string' ? d.error : 'Dodajanje ni uspelo.');
        return;
      }
      setEmail('');
      setName('');
      setPassword('');
      await nalozi();
      toast({
        title: 'Montir dodan ✓',
        description: password
          ? `Račun za ${d.member.email} je ustvarjen — geslo mu povej osebno (prijava, potem meni v glavi).`
          : `${d.member.email} je zdaj v tvojem obrtu.`,
      });
    } catch {
      setFormError('Strežnik ni dosegljiv.');
    } finally {
      setBusy(false);
    }
  };

  const odstrani = async (m: TeamMemberDTO) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/team/${m.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: 'Napaka', description: d.error ?? 'Odstranitev ni uspela.', variant: 'destructive' });
        return;
      }
      await nalozi();
      toast({ title: 'Montir odstranjen', description: `${m.email} ne vidi več podatkov obrta. Njegovi vnosi (ure, dnevnik, fotke) ostanejo.` });
    } catch {
      toast({ title: 'Napaka', description: 'Strežnik ni dosegljiv.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="team-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Ekipa obrta
        </CardTitle>
        <CardDescription>
          Montir se prijavi s svojim računom in vidi tvoje ponudbe, fotke, časovnico in dnevnik —
          cene, račune in nastavitve vidi SAMO lastnik.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Seznam članov */}
        <div className="space-y-2" data-testid="team-list">
          {members === null ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Nalagam ekipo…
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
              Ekipa je prazna — montirja dodaš spodaj (račun ustvariš ti, geslo mu povej osebno).
            </p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
                data-testid="team-member-row"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.name || m.email}
                    {m.name && <span className="ml-2 text-xs font-normal text-muted-foreground">{m.email}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">montir · od {formatDate(m.createdAt)}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-9 h-9 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => void odstrani(m)}
                  disabled={busy}
                  aria-label={`Odstrani ${m.email} iz ekipe`}
                  data-testid={`team-remove-${m.email}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Obrazec za dodajanje */}
        <div className="grid gap-3 rounded-lg border bg-secondary/30 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="team-email">E-pošta montirja</Label>
            <Input
              id="team-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="montir@e-pohta.si"
              autoComplete="email"
              data-testid="team-email-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Ime (neobvezno)</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-password">Geslo (samo nov račun)</Label>
            <Input
              id="team-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 8 znakov"
              autoComplete="new-password"
              data-testid="team-password-input"
            />
          </div>
          <div className="sm:col-span-3">
            <Button className="min-h-10 w-full sm:w-auto" onClick={() => void dodaj()} disabled={busy || email.trim() === ''} data-testid="team-add">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Dodaj montirja
            </Button>
            {formError && (
              <p role="alert" aria-live="polite" className="mt-2 text-sm text-destructive" data-testid="team-error">
                {formError}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
