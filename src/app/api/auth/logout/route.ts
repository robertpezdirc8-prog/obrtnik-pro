// ─── POST /api/auth/logout ────────────────────────────────────
// Seja je brezstanjski podpisani žeton — »odjava« je piškotek z
// Max-Age=0 na klientu. Žeton sam po sebi ostaja veljaven do poteka
// (7 dni): to je znana lastnost brezstanjskih sej brez seznama
// preklicanih žetonov, zapisana, ne skrita. Če bo kdaj rabil
// »odjavi vse naprave«, bo to selitev na seznam žetonov v bazi.

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}
