'use client';

import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ClipboardList, FileText, Home, LayoutGrid, Settings, Hammer, ScanSearch, HardHat, Timer, NotebookPen, Wallet, LogOut, MonitorSmartphone, CircleUserRound } from 'lucide-react';
import { useDraft, useView, useFieldMode, type AppView } from '@/lib/store';
import { useSessionGate } from './auth/login-gate';
import { Dashboard } from './dashboard';
import { CalculatorsView } from './calculators-view';
import { OfferEditor } from './offer-editor';
import { OffersList } from './offers-list';
import { CatalogView } from './catalog-view';
import { CenikView } from './cenik-view';
import { SettingsView } from './settings-view';
import { TimesheetView } from './timesheet-view';
import { DiaryView } from './diary-view';
import { CameraView } from './camera/camera-view';

const NAV: { id: AppView; label: string; icon: React.ElementType }[] = [
  { id: 'domov', label: 'Domov', icon: Home },
  { id: 'kamera', label: 'Pametna kamera', icon: ScanSearch },
  { id: 'kalkulatorji', label: 'Nova ponudba', icon: ClipboardList },
  { id: 'cenik', label: 'Cenik', icon: Wallet },
  { id: 'ponudbe', label: 'Ponudbe', icon: FileText },
  { id: 'časovnica', label: 'Časovnica', icon: Timer },
  { id: 'dnevnik', label: 'Dnevnik', icon: NotebookPen },
  { id: 'katalog', label: 'Katalog', icon: LayoutGrid },
  { id: 'nastavitve', label: 'Nastavitve', icon: Settings },
];

export function AppShell() {
  const view = useView((s) => s.view);
  const setView = useView((s) => s.setView);
  const activeCraft = useView((s) => s.activeCraft);
  const draftCount = useDraft((s) => s.items.length);
  const fieldMode = useFieldMode((s) => s.enabled);
  const setFieldMode = useFieldMode((s) => s.set);
  // Seja iz LoginGata (Task 95): pri uklopljeni zaščiti v glavi pokaže
  // uporabniški meni (Odjava / Odjavi vse naprave); v privzetem načinu
  // je null in meni sploh ne izriše — UI ostane brez prijave.
  const sessionGate = useSessionGate();

  // Terenski način: razred na <html> — veliki gumbi, večja pisava, kontrast
  useEffect(() => {
    document.documentElement.classList.toggle('field-mode', fieldMode);
  }, [fieldMode]);

  // "Nova ponudba" pokaže kalkulatorje, dokler osnutek ni prazen,
  // potem urejevalnik ponudbe.
  const showEditor = view === 'kalkulatorji' && draftCount > 0 && !activeCraft;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Glava */}
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-14 items-center justify-between gap-3">
            <button
              onClick={() => setView('domov')}
              className="flex items-center gap-2.5 font-bold text-lg tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1"
              aria-label="Obrtnik Pro — domov"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Hammer className="h-4.5 w-4.5" />
              </span>
              Obrtnik<span className="text-primary">Pro</span>
            </button>
            <div className="flex items-center gap-2">
              {sessionGate && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`Prijava: ${sessionGate.user.email}`}
                    aria-label="Uporabniški meni — odjava"
                  >
                    <CircleUserRound className="h-5 w-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>
                      <p className="truncate text-sm font-semibold">{sessionGate.user.name || 'Lastnik obrta'}</p>
                      <p className="text-muted-foreground truncate text-xs font-normal">{sessionGate.user.email}</p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void sessionGate.odjava()} data-testid="menu-odjava">
                      <LogOut className="h-4 w-4" />
                      Odjava
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void sessionGate.odjaviVse()} data-testid="menu-odjava-vse">
                      <MonitorSmartphone className="h-4 w-4" />
                      Odjavi vse naprave
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                onClick={() => setFieldMode(!fieldMode)}
                aria-pressed={fieldMode}
                title="Terenski način — veliki gumbi in visok kontrast (rokavice, sonce)"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 min-h-[40px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  fieldMode
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                data-testid="field-mode-toggle"
              >
                <HardHat className="h-4.5 w-4.5" />
                <span className="hidden md:inline">Terenski način</span>
              </button>
              <Badge variant="secondary" className="hidden sm:inline-flex">
                Od fotke do ponudbe v 10 minutah
              </Badge>
            </div>
          </div>
          {/* Navigacija — na mobilnem se pomika po strani */}
          <nav className="flex gap-1 overflow-x-auto scroll-area -mx-1 px-1 pb-1.5" aria-label="Glavna navigacija">
            {NAV.map((n) => {
              const active = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[40px] ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <n.icon className="h-4 w-4 shrink-0" />
                  {n.label}
                  {n.id === 'kalkulatorji' && draftCount > 0 && (
                    <span className={`ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      active ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'
                    }`}>
                      {draftCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Vsebina */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {view === 'domov' && <Dashboard />}
        {view === 'kamera' && <CameraView />}
        {view === 'kalkulatorji' && (showEditor ? <OfferEditor /> : <CalculatorsView />)}
        {view === 'ponudbe' && <OffersList />}
        {view === 'časovnica' && <TimesheetView />}
        {view === 'dnevnik' && <DiaryView />}
        {view === 'katalog' && <CatalogView />}
        {view === 'cenik' && <CenikView />}
        {view === 'nastavitve' && <SettingsView />}
      </main>

      {/* Noga — prilepi se na dno, ko je vsebina krajša od zaslona */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Obrtnik Pro — ponudbe za ograje, keramiko, WPC in več</p>
          <p>Cene so orientacijske · DDV se izračuna po nastavitvah</p>
        </div>
      </footer>
    </div>
  );
}
