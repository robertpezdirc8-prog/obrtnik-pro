'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Building, HardHat } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFieldMode } from '@/lib/store';
import type { SettingsDTO } from '@/lib/types';

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

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data.settings);
      toast({ title: 'Nastavitve shranjene ✓', description: 'Podatki se pojavijo na novih ponudbah.' });
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
  if (!settings) return null;

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
          <div className="space-y-1.5">
            <Label>DDV stopnja (%)</Label>
            <Input
              type="number" min={0} max={30} step={0.5}
              value={settings.vatRate}
              onChange={(e) => patch('vatRate', Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Urna postavka dela (€/h)</Label>
            <Input
              type="number" min={0} step={0.5}
              value={settings.laborRate}
              onChange={(e) => patch('laborRate', Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Veljavnost ponudbe (dni)</Label>
            <Input
              type="number" min={1} max={90} step={1}
              value={settings.quoteValidDays}
              onChange={(e) => patch('quoteValidDays', Number(e.target.value) || 15)}
            />
            <p className="text-xs text-muted-foreground">Izpiše se na PDF — zaščita pred nihanjem cen materiala</p>
          </div>
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
