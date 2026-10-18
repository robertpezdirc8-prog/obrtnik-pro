'use client';

import dynamic from 'next/dynamic';
import { LoginGate } from '@/components/auth/login-gate';

const AppShell = dynamic(
  () => import('@/components/app-shell').then((m) => m.AppShell),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">Nalagam Obrtnik Pro…</span>
        </div>
      </div>
    ),
  },
);

export default function Home() {
  // LoginGate (Task 93) vpraša sejo in samo pri UKLOPLJENI zaščiti
  // (AUTH_ENFORCED=1) pokaže prijavo — privzeto teče skozi.
  return (
    <LoginGate>
      <AppShell />
    </LoginGate>
  );
}
