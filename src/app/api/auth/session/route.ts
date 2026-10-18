// ─── GET /api/auth/session — »kdo sem in kako stojim?« ─────────
// Vedno 200 (ne 401): UI samo vpraša po stanju. `enforced=false`
// pomeni, da namestitev zaščite NI uklopila (lokalni razvoj, E2E,
// tablica brez .env sprememb) — prijavni zaslon se tedaj sploh ne
// prikaže. `usersExist` loči prvi zagon (registracija lastnika) od
// normalne prijave.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAuthEnforced, sessionUser } from '@/lib/auth-guard';

export async function GET(req: NextRequest) {
  const enforced = isAuthEnforced();
  try {
    const [users, user] = await Promise.all([db.user.count(), sessionUser(req)]);
    return NextResponse.json({
      enforced,
      authenticated: user !== null,
      usersExist: users > 0,
      ...(user ? { user: { email: user.email, name: user.name, role: user.role } } : {}),
    });
  } catch (error) {
    // Tabela User še ne obstaja (baza brez db:push) → iskreno stanje:
    // uporabnikov ni, ni prijavljen. Ne 500 — prijavni zaslon mora
    // ostati uporaben, napaka pa je zapisana v log strežnika.
    console.error('auth session error', error);
    return NextResponse.json({ enforced, authenticated: false, usersExist: false });
  }
}
