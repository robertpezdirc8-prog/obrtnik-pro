// ─── Multi-tenant obseganje podatkov (Task 94 — issue #2) ────
//
// VSILJIVA ENOSTAVNOST, ki jo aplikacija do zdaj ni imela: vsi
// poslovni podatki (ponudbe, računi, fotografije, cenik, nastavitve,
// časovnica, dnevnik) so nosili NIKOGAR — vsak, ki je videl API, je
// videl tuje ponudbe in tuje cene. Task 93 je postavil prijavo; tu
// je drugi polovica: prijavljeni uporabnik vidi SAMO svoje podatke.
//
// PRAVILA (dva načina, ena koda):
//  · SEJA (veljaven piškotek) → obseg `ownerId = uporabnik`. Vsi
//    bralni klici so filtrirani, vsak zapis nosi ownerId lastnika.
//  · BREZ SEJE (lokalni način, E2E, verify skripte, tablica brez
//    prijave) → OBSEG NE FILTRIRA: vedenje je kot pred Taskom 94.
//    ZAKAJ: 59 verify skript in E2E preverbe kličejo API brez seje;
//    če bi brez seje viden bil samo prazen obseg, bi bil polovica
//    preverb utišana. Lokalna instalacija brez AUTH_ENFORCED je po
//    definiciji odprta — to je odločitev namestitve, ne kode.
//
// PREVZEM: baza, ki je živela pred prijavo, ima zapise z ownerId
// = null. Prvi registrirani lastnik jih PREVZAME (transakcija v
// /api/auth/register) — njegovi ostanejo. S tem se prijava ne
// »izgubi podatkov«, kar je bil glavni strah pred prijavo.
//
// ŠTEVILČENJE (pošteno izrečeno): številke ponudb in računov so
// GLOBALNO unikatne (@@unique), ker je SQLite ena datoteka in en
// obrat ena instalacija. Dva obrta na isti bazi si ne moreta dela­ti
// številke 2026-001 — to je namerna omejitev, ne napaka.

import { sessionUser } from '@/lib/auth-guard';
import { db } from '@/lib/db';

/** ownerId prijavljenega uporabnika ali null (brez seje / lokalni način).
 *  Za razliko od `requireSession` NE odgovarja z 401 — obseg ni čuvaj,
 *  ampak filter; čuvaj ostane ločen (koda čuva, namestitev odloča). */
export async function resolveOwner(req: Request): Promise<string | null> {
  const user = await sessionUser(req);
  return user?.id ?? null;
}

/** Where fragment za sezname in iskanje po ID-ju:
 *  · seja  → samo zapisi lastnika;
 *  · brez seje → {} (ni filtra — stara vedenja ostanejo).
 *  Uporaba: `db.offer.findMany({ where: ownScope(uid) })` ali
 *  `db.offer.findFirst({ where: { id, ...ownScope(uid) } })` —
 *  pri po ID-ju ZAVEDIKO findUnique, ker Prisma dovoli dodatna
 *  polja v where samo pri findFirst (in sicer tiho, brez 403:
 *  tuj zapis je "ne obstaja", ne "obstaja, a ni tvoj"). */
export function ownScope(ownerId: string | null): { ownerId: string } | Record<string, never> {
  return ownerId ? { ownerId } : {};
}

/** Where klic za NASTAVITVE: en obrat = ena vrstica. Prijavljen
 *  uporabnik jo bere po ownerId (UNIQUE); brez seje po legacy id
 *  "default" (vrstica lokalnega načina, ki jo posame seje prevzamejo). */
export function settingsWhere(ownerId: string | null): { ownerId: string } | { id: string } {
  return ownerId ? { ownerId } : { id: 'default' };
}

/** Cenikova vrstica: ključ je unikaten V OKVIRU lastnika. Brez seje
 *  vidimo legacy vrstice (ownerId = null) — kot pred Taskom 94. */
export function cenikScope(ownerId: string | null): { ownerId: string | null } {
  return { ownerId: ownerId ?? null };
}

/** Prevzem vseh zapisov brez lastnika — kliče ga REGISTRACIJA prvega
 *  uporabnika (edina meta ownerId=null, ki sme nastopiti). V eni
 *  transakciji: ali prevzame VSE ali NIČ — pol prevzeti baza je
 *  slabši od neprevzete. Katalog se NE prevzame: je skupen register. */
export async function adoptOrphanedData(userId: string): Promise<void> {
  await db.$transaction([
    db.offer.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.invoice.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.photo.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.cenikPrice.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.settings.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.timeEntry.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
    db.diaryEntry.updateMany({ where: { ownerId: null }, data: { ownerId: userId } }),
  ]);
}
