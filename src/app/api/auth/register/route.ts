// ─── POST /api/auth/register — ustvari PRVEGA uporabnika ──────
// Registracija je odprta SAMO dokler uporabnikov ni: aplikacija je
// namenjena enemu obratu, drugega računa ne sme narediti vsak, ki
// najde vrata. Po prvem računu so nadaljnji uporabniki (montirji,
// pravice) odločitev lastnika — issue #2. Ustvarjen račun je takoj
// prijavljen (sejni piškotek v odgovoru), saj je edini uporabnik.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  createSessionToken,
  emailProblem,
  hashPassword,
  normalizeEmail,
  passwordProblem,
  sessionCookie,
} from '@/lib/auth';
import { sessionSecret } from '@/lib/auth-guard';

export async function POST(req: NextRequest) {
  try {
    const count = await db.user.count();
    if (count > 0) {
      return NextResponse.json(
        { error: 'Registracija je zaprta — račun že obstaja. Uporabi prijavo.' },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = normalizeEmail(String(body.email ?? ''));
    // Ime je kozmetika (prikaže se v prijavnem kotu) — očistimo in skrajšamo.
    const name = String(body.name ?? '')
      .trim()
      .slice(0, 120);
    const password = String(body.password ?? '');

    const eProblem = emailProblem(email);
    if (eProblem) return NextResponse.json({ error: eProblem }, { status: 400 });
    const pProblem = passwordProblem(password);
    if (pProblem) return NextResponse.json({ error: pProblem }, { status: 400 });

    const user = await db.user.create({
      data: { email, name, passwordHash: hashPassword(password), role: 'owner' },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = createSessionToken(sessionSecret(), user.id, Date.now());
    const res = NextResponse.json({ user }, { status: 201 });
    res.headers.append('Set-Cookie', sessionCookie(token));
    return res;
  } catch (error) {
    // P2002 (unique email): med preverjanjem števca in ustvarjanjem je
    // lahko vzporedna zahteva že ustvarila račun — pošteno 409, ne 500.
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Račun že obstaja — prijavite se.' }, { status: 409 });
    }
    console.error('auth register error', error);
    return NextResponse.json({ error: 'Registracija ni uspela.' }, { status: 500 });
  }
}
