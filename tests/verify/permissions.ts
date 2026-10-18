/**
 * Preverja vloge znotraj obrta (Task 97 — src/lib/permissions.ts) kot
 * ČISTE funkcije + STATIČNO pokritost čuvaja, ekipa rut, sheme in UI.
 *
 * Pokrito:
 *  - normalizeRole: samo 'montir' je montir; nepoznan/načrtovan niz je
 *    owner (stari bazi po selitvi ne odpadejo pravice)
 *  - canAccess: owner sme VSE; montir ima TOČNO določen niz dovoljenj
 *    (izenačenje polnih množic — ne vzorca, ker "pozabljena ruta" je
 *    prav napaka, ki jo hočemo ujeti)
 *  - deny-by-default: matrika pokriva VSE resurse (novega vpisješ ali
 *    ti montirja ne bo videl) + sporočili 403 sta nesti in merljivi
 *  - STATIČNO čuvaj: requireAccess uporablja matriko, preverja članstvo
 *    (montir brez obrta zavrnjen ŽE pri branju) in vrača 401/403
 *  - STATIČNO tenancy: resolveOwner za montirja rešuje obseg iz Member
 *  - STATIČNO rute: VSEH 29 poslovnih handlerjev kliče requireAccess s
 *    pravilnim resursom in metodo (tabela tu — nova ruta brez vnosa je
 *    zgrabljena) + team rute (sessionUser, transakcija, P2002, obseg)
 *  - STATIČNO shema: model Member z unikatnim parom in obema relacijama
 *  - STATIČNO UI: montirjevi pogledi filtrirani, Ekipa kartica samo
 *    lastniku, dashboard ne sprašuje računov za montirja
 *
 * Rezultat: `REZULTAT: N OK, 0 NAPAK` + izhodna koda 1 ob napaki.
 *
 * Zagon: bun tests/verify/permissions.ts
 */

import { readFileSync } from 'node:fs';
import { canAccess, MONTIR_ALLOWED, MONTIR_FORBIDDEN_MESSAGE, MONTIR_NO_OBRT_MESSAGE, normalizeRole } from '../../src/lib/permissions';
import type { Method, Resource } from '../../src/lib/permissions';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const read = (p: string): string => {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
};
const SRC = (rel: string): string => read(`src/${rel}`);

const METHODS: readonly Method[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const RESOURCES: readonly Resource[] = [
  'offers', 'invoices', 'photos', 'cenik', 'catalog',
  'time-entries', 'diary-entries', 'settings', 'team', 'analyze-photo',
];

// ── 1. normalizeRole ─────────────────────────────────────────
{
  check('normalizeRole: "montir" → montir', normalizeRole('montir') === 'montir');
  check('normalizeRole: "owner" → owner', normalizeRole('owner') === 'owner');
  check('normalizeRole: "MONTIR" (velike) → owner (case-sensitive, javno)',
    normalizeRole('MONTIR') === 'owner');
  check('normalizeRole: nepoznan niz → owner (stari uporabnik ne izgubi pravic)',
    normalizeRole('admin') === 'owner');
  check('normalizeRole: prazen niz → owner', normalizeRole('') === 'owner');
  check('normalizeRole: null/undefined → owner', normalizeRole(null) === 'owner' && normalizeRole(undefined) === 'owner');
}

// ── 2. canAccess — owner sme VSE ─────────────────────────────
{
  const all = RESOURCES.every((r) => METHODS.every((m) => canAccess(r, m, 'owner')));
  check('owner: vseh 10 resursov × 5 metod = 50/50 dovoljenih', all);
}

// ── 3. canAccess — montir: TOČNA množica dovoljenj ───────────
{
  const expected: Record<Resource, readonly Method[]> = {
    'offers': ['GET'],
    'photos': ['GET', 'POST'],
    'time-entries': ['GET', 'POST', 'PATCH'],
    'diary-entries': ['GET', 'POST', 'PATCH'],
    'analyze-photo': ['POST'],
    'invoices': [],
    'cenik': [],
    'catalog': [],
    'settings': [],
    'team': [],
  };
  let ok = true;
  const diffs: string[] = [];
  for (const r of RESOURCES) {
    const got = METHODS.filter((m) => canAccess(r, m, 'montir'));
    const want = expected[r];
    const same = got.length === want.length && want.every((m) => got.includes(m));
    if (!same) { ok = false; diffs.push(`${r}: pričakovano [${want}], dobljeno [${got}]`); }
  }
  check('montir: matrika točna (razlika pomeni NAPAKO)', ok, diffs.join(' | '));

  // MONTIR_ALLOWED je enoten vir — dobljene množice morajo biti tudi
  // dobesedno v matriki (in obratno), da ni dveh resnic.
  const tableOk = RESOURCES.every((r) => {
    const listed = MONTIR_ALLOWED[r];
    const got = METHODS.filter((m) => canAccess(r, m, 'montir'));
    return listed.length === got.length && got.every((m) => listed.includes(m));
  });
  check('montir: MONTIR_ALLOWED = canAccess (eni vir resnice)', tableOk);
  check('montir: matrika pokriva VSE resurse (deny-by-default vpisano)',
    RESOURCES.every((r) => Array.isArray(MONTIR_ALLOWED[r])));
}

// ── 4. Sporočili 403 ─────────────────────────────────────────
{
  check('sporočilo 403 (vloga) omenja lastnika obrta',
    MONTIR_FORBIDDEN_MESSAGE.length > 10 && MONTIR_FORBIDDEN_MESSAGE.includes('lastnika obrta'));
  check('sporočilo 403 (brez obrta) omenja povabilo',
    MONTIR_NO_OBRT_MESSAGE.length > 10 && MONTIR_NO_OBRT_MESSAGE.includes('povabilo'));
  check('sporočili sta različni (dve različni razlogi, ne eno megléno)',
    (MONTIR_FORBIDDEN_MESSAGE as string) !== MONTIR_NO_OBRT_MESSAGE);
}

// ── 5. Čuvaj (auth-guard) ────────────────────────────────────
{
  const g = SRC('lib/auth-guard.ts');
  check('requireAccess obstaja in je izvožen', g.includes('export async function requireAccess('));
  check('requireAccess uporablja matriko (canAccess) + normalizeRole',
    g.includes('canAccess(resource, method, role)') && g.includes('normalizeRole(user.role)'));
  check('requireAccess: 401 brez seje z ISTO besedo kot requireSession',
    g.includes("error: 'Zahtevana je prijava.'"));
  check('requireAccess: 403 z besedilom iz matrike', g.includes('MONTIR_FORBIDDEN_MESSAGE'));
  check('requireAccess: montir brez članstva zavrnjen ŽE pri branju (db.member.findFirst)',
    g.includes('db.member.findFirst(') && g.includes('where: { userId: user.id },') &&
    g.includes('MONTIR_NO_OBRT_MESSAGE'));
  check('requireAccess: brez uklopljene zaščite vedno null (lokalni način)',
    /requireAccess\([\s\S]{0,120}if \(!isAuthEnforced\(\)\) return null;/.test(g));
}

// ── 6. Tenancy: obseg montirja ───────────────────────────────
{
  const t = SRC('lib/tenancy.ts');
  check('resolveOwner: montir → obseg iz članstva (db.member.findFirst)',
    t.includes("normalizeRole(user.role) === 'montir'") && t.includes('db.member.findFirst'));
  check('resolveOwner: brez članstva → null (prazni seznami v dev načinu)',
    t.includes('return m?.ownerId ?? null;'));
  check('resolveOwner: lastnik ostane sam sebi obseg', t.includes('return user.id;'));
}

// ── 7. Ekipa rute ────────────────────────────────────────────
{
  const r = SRC('app/api/team/route.ts');
  check('team: ALWAYS seja (sessionUser, 401) — brez prijave ni lastnika',
    r.includes('const user = await sessionUser(req);') && r.includes("'Zahtevana je prijava.'"));
  check('team: samo lastnik (montir → 403)', r.includes("normalizeRole(user.role) !== 'owner'"));
  check('team: nov račun + članstvo v ENI transakciji (brez montirja brez obrta)',
    r.includes('db.$transaction') && r.includes("role: 'montir'") && r.includes('tx.member.create'));
  check('team: geslo gre skozi isti register pravil (passwordProblem + hashPassword)',
    r.includes('passwordProblem(password)') && r.includes('hashPassword(password)'));
  check('team: lastnika ni mogoče pretvoriti v montirja',
    r.includes('je lastnik obrta — montirja z njega ne morem narediti'));
  check('team: montir največ v enem obrtu (findFirst članstva pred dodajanjem)',
    r.includes("db.member.findFirst({ where: { userId: existing.id } })"));
  check('team: P2002 (dvojna e-pošta/članstvo) → pošten 409', r.includes("'P2002'") && r.includes('409'));
  check('team: e-pošta preverjena z istim registrom (emailProblem)',
    r.includes('emailProblem(email)'));
}
{
  const d = SRC('app/api/team/[id]/route.ts');
  check('team/[id]: deleteMany Z OBSEGOM (ownerId) — tuj član je enak neznanemu',
    d.includes('db.member.deleteMany({ where: { id, ownerId: user.id } })'));
  check('team/[id]: count 0 → 404', d.includes("error: 'Člana ni bilo mogoče najti.'") && d.includes('404'));
  check('team/[id]: ALWAYS seja + samo lastnik',
    d.includes('const user = await sessionUser(req);') && d.includes("normalizeRole(user.role) !== 'owner'"));
}

// ── 8. STATIČNA pokritost vseh poslovnih handlerjev ──────────
{
  // resurs + pričakovane metode za vsako rutno datoteko (29 handlerjev)
  const MAP: Array<[string, Resource, readonly Method[]]> = [
    ['app/api/analyze-photo/route.ts', 'analyze-photo', ['POST']],
    ['app/api/catalog/route.ts', 'catalog', ['GET']],
    ['app/api/cenik/route.ts', 'cenik', ['GET', 'PUT']],
    ['app/api/diary-entries/route.ts', 'diary-entries', ['GET', 'POST']],
    ['app/api/diary-entries/[id]/route.ts', 'diary-entries', ['PATCH', 'DELETE']],
    ['app/api/invoices/route.ts', 'invoices', ['GET', 'POST']],
    ['app/api/invoices/[id]/route.ts', 'invoices', ['PATCH']],
    ['app/api/invoices/[id]/eslog/route.ts', 'invoices', ['GET']],
    ['app/api/offers/route.ts', 'offers', ['GET', 'POST']],
    ['app/api/offers/[id]/route.ts', 'offers', ['GET', 'PATCH', 'DELETE']],
    ['app/api/photos/route.ts', 'photos', ['GET', 'POST']],
    ['app/api/photos/[id]/route.ts', 'photos', ['GET', 'PATCH', 'DELETE']],
    ['app/api/photos/[id]/image/route.ts', 'photos', ['GET']],
    ['app/api/settings/route.ts', 'settings', ['GET', 'PUT']],
    ['app/api/time-entries/route.ts', 'time-entries', ['GET', 'POST']],
    ['app/api/time-entries/[id]/route.ts', 'time-entries', ['PATCH', 'DELETE']],
  ];
  let ok = true; const diffs: string[] = []; let count = 0;
  for (const [file, resource, methods] of MAP) {
    const src = read(`src/${file}`);
    if (!src) { ok = false; diffs.push(`${file}: datoteka manjka`); continue; }
    // vsak handler mora klicati requireAccess z ISTIM resursom in svojo metodo
    const parts = src.split(/(?=export async function (?:GET|POST|PATCH|PUT|DELETE))/);
    for (const part of parts) {
      const m = /export async function (GET|POST|PATCH|PUT|DELETE)/.exec(part);
      if (!m) continue;
      count++;
      const expected = `requireAccess(req, '${resource}', '${m[1]}')`;
      if (!methods.includes(m[1] as Method)) {
        ok = false; diffs.push(`${file}: nepričakovana metoda ${m[1]}`);
        continue;
      }
      if (!part.includes(expected)) {
        ok = false; diffs.push(`${file}: manjka ${expected}`);
      }
    }
    if (src.includes('requireSession(')) {
      ok = false; diffs.push(`${file}: ostanki requireSession`);
    }
  }
  check(`vseh ${count} poslovnih handlerjev kliče requireAccess z resursom+metodo`, ok, diffs.join(' | '));
  check('handlerjev je pričakovanih 29', count === 29, String(count));
}

// ── 9. Shema ─────────────────────────────────────────────────
{
  const s = read('prisma/schema.prisma');
  check('shema: model Member obstaja', s.includes('model Member {'));
  check('shema: članstvo unikatno po paru (ownerId, userId)', s.includes('@@unique([ownerId, userId])'));
  check('shema: iskanje po montirju indeksirano', s.includes('@@index([userId])'));
  check('shema: obe relaciji imenovani (OwnerMembers/MemberUser)',
    s.includes('@relation("OwnerMembers"') && s.includes('@relation("MemberUser"'));
  check('shema: izbris uporabnika pomete članstva (Cascade)',
    /model Member \{[\s\S]*?onDelete: Cascade[\s\S]*?onDelete: Cascade/.test(s.slice(s.indexOf('model Member {'), s.indexOf('model Session'))));
}

// ── 10. UI ───────────────────────────────────────────────────
{
  const shell = SRC('components/app-shell.tsx');
  check('lupina: montir vidi samo svoje poglede (MONTIR_VIEWS + filter)',
    shell.includes('MONTIR_VIEWS') && shell.includes('NAV.filter((n) => MONTIR_VIEWS.includes(n.id))'));
  check('lupina: vloga iz konteksta seje (normalizeRole), brez seje = lastnik',
    shell.includes('normalizeRole(sessionGate?.user.role)'));
  check('lupina: shranjen pogled, ki ga vloga ne vidi, vrne na domov',
    shell.includes("setView('domov')"));

  const settings = SRC('components/settings-view.tsx');
  check('nastavitve: Ekipa kartica obstaja in je samo za lastnika',
    settings.includes('function TeamCard()') && settings.includes('isOwnerSession && <TeamCard />'));
  check('nastavitve: ekipa kliče /api/team (GET seznam + POST dodajanje + DELETE odstranjevanje)',
    settings.includes("fetch('/api/team'") && settings.includes('method: \'POST\'') &&
    settings.includes('method: \'DELETE\''));
  check('nastavitve: v privzetem načinu (brez seje) ekipa ni izrisana',
    settings.includes('sessionGate !== null && normalizeRole(sessionGate.user.role)') === false
      ? false
      : settings.includes("normalizeRole(sessionGate.user.role) === 'owner'"));

  const dash = SRC('components/dashboard.tsx');
  check('dashboard: montir ne sprašuje računov (fetch if !isMontir)',
    dash.includes('const isMontir =') && dash.includes('if (!isMontir) {'));
  check('dashboard: terjatve in kalkulatorji skriti za montirja',
    (dash.match(/!isMontir && \(/g) ?? []).length >= 2);

  const gate = SRC('components/auth/login-gate.tsx');
  check('prijava: registracija pove, da montirje doda lastnik (Ekipa)',
    gate.includes('montirje) doda lastnik v Nastavitvah'));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
