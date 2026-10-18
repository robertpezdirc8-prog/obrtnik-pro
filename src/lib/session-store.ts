// ─── Seje v bazi (Task 95): podatkovna plast ─────────────────
// Nad čisto plastjo v src/lib/auth.ts (hashToken, isLiveSessionRow,
// tokenExpiryMs). Vse, kar se dotika tabele Session, je TUKAJ:
// odpiranje pri prijavi/registraciji, preverjanje živosti v čuvaju,
// preklic pri odjavi (ena) in »Odjavi vse naprave« (vse), ter
// čiščenje izteklih in preklicanih vrstic ob prijavi (prune).
//
// ZAKAJ ena tabela in ne pomnilnik procesa: seja mora preživeti
// ponovni zagon in biti preklicljiva — pomnilniški seznam bi izgubil
// oba lastnosti. SQLite na enem stroju je dovolj: en dodaten SELECT
// na zaščiteno zahtevo (~mikrosekunde lokalno), zapisano, ne skrito.
//
// STIKALO: preverjanje živosti poteka VEDNO, kadar je žeton predstavljen
// (requireSession je vseeno območje AUTH_ENFORCED — ko zaščita ni
// uklopljena, guard sploh ne seže sem). sessionUser pa preverja živost
// ne glede na stikalo: veljaven piškotek brez žive vrstice je po
// selitvi enostavno odjavljen (stari 3-delni žetoni ali počiščena
// baza) — uporabnik se enkrat prijavi znova.

import { db } from '@/lib/db';
import {
  hashToken,
  isLiveSessionRow,
  tokenExpiryMs,
  type SessionRowLike,
} from '@/lib/auth';

/** Odpri sejo: vrstica s SHA-256 žetona in potekom iz žetona.
 *  Vrne true, če je zapis uspel; potek beremo iz žetona (ni drugega
 *  vira resnice), neznan/rokaven žeton zapiše z najmanjšim možnim
 *  potekom (neodvisno od tega ga guard zavrne zaradi podpisa). */
export async function openSession(userId: string, token: string, fallbackExpiresAt: Date): Promise<boolean> {
  const expMs = tokenExpiryMs(token) ?? fallbackExpiresAt.getTime();
  try {
    await db.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(expMs) },
    });
    return true;
  } catch (error) {
    // P2002: isti žeton bi odprl podvojeno vrstico. Z nonce-om v žetonu
    // se to ne sme zgoditi (dve prijavi = dva nonce-a); če pa vseeno
    // (ponovljen klic z istim žetonom), je obstoječa vrstica dovolj —
    // seje ne oviramo, napaka pa se zapiše v log strežnika.
    const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (code === 'P2002') return false;
    throw error;
  }
}

/** Ali je žeton živ (obstaja vrstica, ni preklicana, ni potekla)?
 *  Edini vir resnice za čuvaja in sessionUser. */
export async function isSessionLive(token: string, nowMs: number): Promise<boolean> {
  const row: SessionRowLike | null = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { tokenHash: true, expiresAt: true, revokedAt: true },
  });
  return isLiveSessionRow(row, token, nowMs);
}

/** Prekliči TO sejo (odjava). Vrne število preklicanih vrstic
 *  (0 je upravičen izid: neznan že iztečen žeton). */
export async function revokeSession(token: string, nowMs: number): Promise<number> {
  const res = await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(nowMs) },
  });
  return res.count;
}

/** Prekliči VSE seje uporabnika (»Odjavi vse naprave«). */
export async function revokeAllSessions(userId: string, nowMs: number): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(nowMs) },
  });
  return res.count;
}

/** Počisti iztečene in preklicane vrstice. Kliče prijava — tabela
 *  ostane majhna brez cron-a, eno-mašinska izbira, zapisana. */
export async function pruneSessions(nowMs: number): Promise<number> {
  const res = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: new Date(nowMs) } }, { revokedAt: { not: null } }] },
  });
  return res.count;
}
