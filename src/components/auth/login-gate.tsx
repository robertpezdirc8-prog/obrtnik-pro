'use client';

// ─── LoginGate: prijavna vrata pred aplikacijo ────────────────
// Vpraša /api/auth/session in odloči:
//  - zaščita ni uklopljena (AUTH_ENFORCED≠1) → aplikacija takoj,
//    brez utripanja prijave (privzeto stanje razvoja in E2E);
//  - prijavljen → aplikacija + kontekst seje (Task 95): AppShell v
//    glavi pokaže uporabniški meni (Odjava, Odjavi vse naprave);
//  - uveljavljeno in neprijavljen → prijava ali (ob prvem zagonu,
//    ko uporabnikov še ni) registracija lastnika.
// Dokler stanja ne vemo, ne bliskamo prijave — prikaže se isto
// »Nalagam Obrtnik Pro…« stojalo, ki ga rabi že dinamični uvoz.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SessionInfo {
  enforced: boolean;
  authenticated: boolean;
  usersExist: boolean;
  user?: { email: string; name: string; role: string };
}

// ─── Kontekst seje (Task 95) ─────────────────────────────────
// LoginGate JE edini vir resnice o seji (en klic /api/auth/session);
// AppShell prek konteksta prikaže meni in kliče odjavo brez svojega
// iskanja. Izven ponudnika (privzeti način, E2E) je null → UI gumba
// ne izriše, pravilno: tam prijava sploh ne obstaja.
export interface SessionGate {
  user: { email: string; name: string; role: string };
  /** Odjavi TA napravo (prekliče žeton v bazi + izteče piškotek). */
  odjava: () => Promise<void>;
  /** Odjavi VSE naprave (prekliče vse žive seje uporabnika). */
  odjaviVse: () => Promise<void>;
}

const SessionGateContext = createContext<SessionGate | null>(null);

/** Vrne sejo iz LoginGata ali null — klicatelj (AppShell) samo utiša
 *  uporabniški meni, ko prijava ni uklopljena. */
export function useSessionGate(): SessionGate | null {
  return useContext(SessionGateContext);
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionInfo | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nalozi = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      setStatus((await res.json()) as SessionInfo);
    } catch {
      // Strežnik/API ni dosegljiv: ne blokirajmo razvoja — enako kot
      // privzeta namestitev, aplikacija se odpre, API napake pa vidi
      // vsak posamezen zaslon sam.
      setStatus({ enforced: false, authenticated: false, usersExist: false });
    }
  }, []);

  useEffect(() => {
    void nalozi();
  }, [nalozi]);

  const poslji = async (url: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Napaka pri pošiljanju.');
        return;
      }
      setPassword('');
      await nalozi();
    } catch {
      setError('Strežnik ni dosegljiv.');
    } finally {
      setBusy(false);
    }
  };

  const odjava = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setStatus(null); // nazaj na stojalo, potem sveže stanje
      await nalozi();
    }
  };

  const odjaviVse = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout-all', { method: 'POST' });
    } finally {
      setStatus(null);
      await nalozi();
    }
  };

  if (!status || !status.enforced) return <>{children}</>;

  if (status.authenticated && status.user) {
    const gate: SessionGate = {
      user: status.user,
      odjava,
      odjaviVse,
    };
    return (
      <SessionGateContext.Provider value={gate}>
        {children}
      </SessionGateContext.Provider>
    );
  }

  const registracija = !status.usersExist;
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Obrtnik Pro</CardTitle>
          <CardDescription>
            {registracija
              ? 'Ustvari račun lastnika — edinega. Nadaljnje račune (montirje) doda lastnik v Nastavitvah → Ekipa.'
              : 'Prijava v delavnico.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void poslji(registracija ? '/api/auth/register' : '/api/auth/login');
            }}
          >
            {registracija && (
              <div className="grid gap-2">
                <Label htmlFor="lg-ime">Ime (neobvezno)</Label>
                <Input
                  id="lg-ime"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={120}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="lg-eposta">E-pošta</Label>
              <Input
                id="lg-eposta"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lg-geslo">Geslo</Label>
              <Input
                id="lg-geslo"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={registracija ? 'new-password' : 'current-password'}
              />
            </div>
            {error && (
              <p role="alert" aria-live="polite" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="h-11">
              {busy ? 'Pošiljam…' : registracija ? 'Ustvari račun' : 'Prijava'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
