// ─── /api/team — ekipa obrta (Task 97, vloge) ─────────────────
// Lastnik v svoj obrt doda MONTIRJA:
//  · račun montirja še ne obstaja → lastnik mu ustvari račun
//    (e-pošta + ime + začasno geslo) in ga takoj vpiše med člane —
//    registracija ostane ZAPRTA (ena namestitev = en obrt), nova
//    vrata ne nastanejo; geslo poda lastnik, montir si ga lahko
//    kasneje zamenja (v prihodnje);
//  · račun montirja že obstaja (role "montir", brez članstva) →
//    samo poveže (Member) — gesla lastnik ne potrebuje.
// Montir je lahko v NAJVEČ ENEM obrtu (resolveOwner po findFirst
// enoznačno reši obseg; dvoumnost bi bila varnostna luknja).
// Uporabnika z vlogo "owner" ni mogoče dodati kot montirja.
//
// Čuvaj: ALWAYS seja (sessionUser, kot pri logout-all) — brez
// prijave ni lastniške identitete, torej ni komu pripisati ekipe.
// Ne glede na AUTH_ENFORCED → 401 brez seje. Montir → 403 (matrika
// permissions: team je izključno lastniški resurs).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionUser } from '@/lib/auth-guard';
import { normalizeRole, MONTIR_FORBIDDEN_MESSAGE } from '@/lib/permissions';
import {
  emailProblem,
  hashPassword,
  normalizeEmail,
  passwordProblem,
} from '@/lib/auth';

const unauthorized = (): NextResponse =>
  NextResponse.json({ error: 'Zahtevana je prijava.' }, { status: 401 });
const forbidden = (): NextResponse =>
  NextResponse.json({ error: MONTIR_FORBIDDEN_MESSAGE }, { status: 403 });

/** ─── GET /api/team — seznam članov mojega obrta ─────────── */
export async function GET(req: Request) {
  const user = await sessionUser(req);
  if (!user) return unauthorized();
  if (normalizeRole(user.role) !== 'owner') return forbidden();
  try {
    const rows = await db.member.findMany({
      where: { ownerId: user.id },
      include: { user: { select: { email: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({
      members: rows.map((m) => ({
        id: m.id,
        email: m.user.email,
        name: m.user.name,
        role: m.user.role,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('GET /api/team failed:', error);
    return NextResponse.json({ error: 'Ekipe ni bilo mogoče naložiti' }, { status: 500 });
  }
}

/** ─── POST /api/team — dodaj montirja { email, name?, password? } ── */
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return unauthorized();
  if (normalizeRole(user.role) !== 'owner') return forbidden();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = normalizeEmail(String(body.email ?? ''));
    // Ime je kozmetika (vidi se v glavi in na ekipi) — kot pri registraciji.
    const name = String(body.name ?? '')
      .trim()
      .slice(0, 120);
    const password = typeof body.password === 'string' ? body.password : '';

    const eProblem = emailProblem(email);
    if (eProblem) return NextResponse.json({ error: eProblem }, { status: 400 });

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      // Lastnika (tudi samega sebe) ni mogoče spremeniti v montirja.
      if (normalizeRole(existing.role) !== 'montir') {
        return NextResponse.json(
          { error: 'Uporabnik s to e-pošto je lastnik obrta — montirja z njega ne morem narediti.' },
          { status: 400 },
        );
      }
      // Montir je lahko največ v enem obrtu (obseg mora biti enoznačen).
      const already = await db.member.findFirst({ where: { userId: existing.id } });
      if (already) {
        return NextResponse.json(
          { error: 'Ta montir že dela v obrtu — v v1 je montir največ v enem obrtu.' },
          { status: 400 },
        );
      }
      const member = await db.member.create({
        data: { ownerId: user.id, userId: existing.id },
      });
      return NextResponse.json(
        { member: { id: member.id, email: existing.email, name: existing.name, role: existing.role, createdAt: member.createdAt.toISOString() } },
        { status: 201 },
      );
    }

    // Novega montirja lastnik ustvari z začasnim geslom (isti pravili
    // jakosti kot pri registraciji) — brez nove odprte registracije.
    if (!password) {
      return NextResponse.json(
        { error: 'Za novega montirja potrebujete začasno geslo (najmanj 8 znakov).' },
        { status: 400 },
      );
    }
    const pProblem = passwordProblem(password);
    if (pProblem) return NextResponse.json({ error: pProblem }, { status: 400 });

    // Uporabnik + članstvo v ENI transakciji: brez "montirja brez obrta".
    const created = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name, passwordHash: hashPassword(password), role: 'montir' },
      });
      return tx.member.create({ data: { ownerId: user.id, userId: u.id } });
    });
    return NextResponse.json(
      { member: { id: created.id, email, name, role: 'montir', createdAt: created.createdAt.toISOString() } },
      { status: 201 },
    );
  } catch (error) {
    // P2002: vzporedni klic je že ustvaril e-pošto ali članstvo.
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'Račun ali članstvo že obstaja — osveži seznam ekipe.' },
        { status: 409 },
      );
    }
    console.error('POST /api/team failed:', error);
    return NextResponse.json({ error: 'Montirja ni bilo mogoče dodati.' }, { status: 500 });
  }
}
