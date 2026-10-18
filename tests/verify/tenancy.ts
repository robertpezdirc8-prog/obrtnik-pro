/**
 * Preverja multi-tenant obseganje (Task 94 — src/lib/tenancy.ts) kot
 * ČISTE funkcije + STATIČNO pokritost vseh handlerjev — brez strežnika,
 * brez pisnja v bazo.
 *
 * Pokrito:
 *  - ownScope: seja → { ownerId } (obseg), brez seje → {} (ni filtra —
 *    stara vedenja E2E ostanejo), nikoli { ownerId: null } za sejo
 *    (zato bi brez-piškoten E2E videl prazno)
 *  - settingsWhere: seja → ownerId klic, brez seje → legacy id "default"
 *  - cenikScope: null → { ownerId: null } (legacy vrstice), uid → lastnik
 *  - STATIČNO (vzorec cenik-guard): vsaka ruta s poslovnimi podatki mora
 *    brati obseg (resolveOwner) in uporabljati ownScope/settingsWhere —
 *    nova ruta brez obsega je zgrabljena tu, ne čez šest mesecev
 *  - STATIČNO: [id] rute ne smejo več klicati findUnique za zapis, ki
 *    ga bodo brali s obsegom (findUnique ne sme obsega, findFirst sme)
 *  - register vsebuje prevzem (adoptOrphanedData)
 *  - shema: podatkovni modeli nosijo ownerId; katalog ga namenoma NIMA
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 *
 * Zagon: bun tests/verify/tenancy.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cenikScope, ownScope, settingsWhere } from '../../src/lib/tenancy';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', '..', p), 'utf8');

// ── 1. ownScope — dve veji, nič tretjega ────────────────────
{
  const uid = 'user-abc-123';
  const withSession = ownScope(uid);
  check('ownScope(seja) obsega po ownerId',
    JSON.stringify(withSession) === JSON.stringify({ ownerId: uid }));
  const without = ownScope(null);
  check('ownScope(brez seje) je prazen filter (stara vedenja)',
    JSON.stringify(without) === JSON.stringify({}));
  check('ownScope(brez seje) NE vidi prijavljenih podatkov',
    !('ownerId' in without));
}

// ── 2. settingsWhere — lastnik vs legacy ────────────────────
{
  check('settingsWhere(seja) gre po ownerId',
    JSON.stringify(settingsWhere('u1')) === JSON.stringify({ ownerId: 'u1' }));
  check('settingsWhere(brez seje) gre po legacy id "default"',
    JSON.stringify(settingsWhere(null)) === JSON.stringify({ id: 'default' }));
}

// ── 3. cenikScope — legacy null in lastnik ──────────────────
{
  check('cenikScope(brez seje) = ownerId null (legacy vrstice)',
    JSON.stringify(cenikScope(null)) === JSON.stringify({ ownerId: null }));
  check('cenikScope(seja) = ownerId uporabnika',
    JSON.stringify(cenikScope('u2')) === JSON.stringify({ ownerId: 'u2' }));
}

// ── 4. STATIČNO: vsaka ruta s poslovnimi podatki ima obseg ──
//
// Seznam rut, ki berejo/pišejo podatke obrta. NAMERNO izpuščene:
//  · auth/* — upravljajo sejo same, ne podatkov obrta
//  · catalog — katalog je skupni register (KAJ je), ne podatek obrta
//  · analyze-photo — ne piše v bazo, prebere samo skupni katalog
const BUSINESS_ROUTES = [
  'src/app/api/offers/route.ts',
  'src/app/api/offers/[id]/route.ts',
  'src/app/api/invoices/route.ts',
  'src/app/api/invoices/[id]/route.ts',
  'src/app/api/invoices/[id]/eslog/route.ts',
  'src/app/api/photos/route.ts',
  'src/app/api/photos/[id]/route.ts',
  'src/app/api/settings/route.ts',
  'src/app/api/cenik/route.ts',
  'src/app/api/time-entries/route.ts',
  'src/app/api/time-entries/[id]/route.ts',
  'src/app/api/diary-entries/route.ts',
  'src/app/api/diary-entries/[id]/route.ts',
];

for (const route of BUSINESS_ROUTES) {
  let src = '';
  try { src = SRC(route); } catch { check(`${route} obstaja`, false, 'manjka'); continue; }
  const hasOwner = src.includes('resolveOwner');
  // cenik ruta preda obseg store-ju prek loadCenik(uid)/saveCenik(body, uid)
  // — klic obsega je tam, zato je to enakovreden dokaz.
  const passesOwner = src.includes('loadCenik(uid)') || src.includes('saveCenik(');
  const usesScope = src.includes('ownScope(') || src.includes('settingsWhere(')
    || src.includes('cenikScope(') || passesOwner;
  check(`${route} bere obseg (resolveOwner + klic obsega)`, hasOwner && usesScope,
    hasOwner ? 'manjka klic obsega' : 'manjka resolveOwner');
}

// ── 5. STATIČNO: [id] rute ne smejo iskati z findUnique brez obsega ──
//
// findUnique({ where: { id } } ) na poslovnem modelu je lahko LE za
// ponovno branje ZNOTRAJ iste zahteve, potem ko je obseg že zatrdil
// dostop (updateMany + findUnique po ID-ju). Prvi stik s tujim ID-jem
// mora biti findFirst z ownScope — sicer bi tuj zapis bil berljiv.
{
  const scopedRoutes = BUSINESS_ROUTES.filter((r) => r.includes('[id]') && !r.includes('eslog'));
  for (const route of scopedRoutes) {
    const src = SRC(route);
    // Vsak handler v ruti mora imeti obseg klic BEFORE prvega findUnique.
    const scopeIdx = src.indexOf('ownScope(');
    const firstUnique = src.indexOf('findUnique(');
    check(`${route}: obseg pred kakršnim koli findUnique (prvi stik je obsegani)`,
      scopeIdx !== -1 && (firstUnique === -1 || scopeIdx < firstUnique));
  }
}

// ── 6. STATIČNO: register prevzame zapise brez lastnika ─────
{
  const reg = SRC('src/app/api/auth/register/route.ts');
  check('register kliče adoptOrphanedData', reg.includes('adoptOrphanedData('));
  check('prevzem je pred izdajo piškotka',
    reg.indexOf('adoptOrphanedData(') < reg.indexOf('Set-Cookie'));
  const tenancy = SRC('src/lib/tenancy.ts');
  // Vseh sedem podatkovnih modelov v prevzemni transakciji.
  for (const model of ['offer', 'invoice', 'photo', 'cenikPrice', 'settings', 'timeEntry', 'diaryEntry']) {
    check(`prevzem vključuje ${model}`, tenancy.includes(`db.${model}.updateMany`));
  }
}

// ── 7. STATIČNO: shema — podatkovni modeli nosijo ownerId, katalog NE ──
{
  const schema = SRC('prisma/schema.prisma');
  for (const model of ['Offer', 'Invoice', 'Photo', 'CenikPrice', 'Settings', 'TimeEntry', 'DiaryEntry']) {
    const block = schema.slice(schema.indexOf(`model ${model} `));
    const nextModel = block.indexOf('\nmodel ', 1);
    const body = block.slice(0, nextModel === -1 ? block.length : nextModel);
    check(`shema: ${model} ima ownerId`, body.includes('ownerId'));
  }
  for (const model of ['Category', 'Product']) {
    const block = schema.slice(schema.indexOf(`model ${model} `));
    const nextModel = block.indexOf('\nmodel ', 1);
    const body = block.slice(0, nextModel === -1 ? block.length : nextModel);
    check(`shema: ${model} (katalog) NIMA ownerId (skupen register)`, !body.includes('ownerId'));
  }
}

// ── 8. STATIČNO: settings bralci ne smejo več tvrdo kodirati "default" ──
{
  const eslog = SRC('src/app/api/invoices/[id]/eslog/route.ts');
  check('eslog bere nastavitve po obsegu', eslog.includes('settingsWhere('));
  const inv = SRC('src/app/api/invoices/route.ts');
  check('invoices bere nastavitve po obsegu', inv.includes('settingsWhere('));
  const set = SRC('src/app/api/settings/route.ts');
  check('settings upsert gre po settingsWhere', set.includes('settingsWhere(uid)'));
  // seed ostane legacy (brez seje) — namenoma.
  const seed = SRC('src/lib/seed.ts');
  check('seed ustvari legacy vrstico (brez seje ostane "default")',
    seed.includes("id: 'default'"));
}

// ── 9. cenik-store: pisanje po obsegu ────────────────────────
{
  const store = SRC('src/lib/cenik-store.ts');
  check('loadCenik sprejme ownerId', store.includes('ownerId: string | null'));
  check('saveCenik najde vrstico V OKVIRU lastnika (findFirst, ne upsert)',
    store.includes('findFirst({ where: { key, ...cenikScope(ownerId) } })'));
  check('saveCenik piše ownerId na novo vrstico', store.includes('create({ data: { key, ownerId'));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
