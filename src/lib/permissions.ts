// ─── Vloge znotraj obrta (Task 97): matrika dovoljenj ────────
// ČISTO jedro — brez uvozov, brez DOM, brez strežnika. Enoten vir
// resnice o tem, kaj sme katera vloga. Strežniški čuvaj (auth-guard
// requireAccess) to matriko UVELJAVLJA; UI (app-shell) po njej
// SKRIJE menije, ki jih vloga ne sme odpreti — API pa je pravilo,
// UI le priročen (403 je zadnja obrambna črta).
//
// ZAKAJ na črnem/belem seznamu in ne "samo izjeme": polovica napak
// pri dovoljenjih je "pozabil sem na to ruto". Tu je VSAKA poslovna
// ruta izpisana — če kdo doda novo in je ne vpisje, tipuje
// privzeto ZAVRNJENO za montirja (deny-by-default, glej canAccess).
//
// Pravilo obsega (tenancy.ts, nespremenjeno): montir NE dobi
// lastnikovih podatkov po vlagi — obseg mu da vrstica Member
// (dodajanje prek /api/team). Dovoljenje pove, KAJ sme; članstvo
// pove, ČIJIH podatkov se dotika. Oboje mora veljati.

/** Vloga uporabnika v sistemu. Niz v bazi je prost — normalizeRole
 *  ga stisne na ta dva (nepoznan niz = "owner", da stari bazi po
 *  selitvi ne odpadejo pravice lastnika). */
export type Role = 'owner' | 'montir';

/** Poslovne rute (brez /api/auth/* — tiste so sejne, ne poslovne). */
export type Resource =
  | 'offers'
  | 'invoices'
  | 'photos'
  | 'cenik'
  | 'catalog'
  | 'time-entries'
  | 'diary-entries'
  | 'settings'
  | 'team'
  | 'analyze-photo';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Montirjeva vloga v besedilu (za UI in sporočila). */
export const MONTIR_LABEL = 'montir';
export const OWNER_LABEL = 'lastnik obrta';

/** "montir" → montir; vse ostalo → owner. Deloma tudi null/undefined
 *  (klic iz plasti, kjer role še ni bila prebrana). */
export function normalizeRole(role: string | null | undefined): Role {
  return role === 'montir' ? 'montir' : 'owner';
}

/** Kaj sme MONTIR — izrecno, metoda po metodi. VSE OSTALO je zanj
 *  zavrnjeno (deny-by-default). Razmislek vrstica po vrstici:
 *  · offers GET — montir mora videti, kaj montira (izmera, količine);
 *    POST/PATCH/DELETE — posel lastnika (cene, številčenje, stranka).
 *  · photos GET/POST — fotkanje na terenu JE montirjevo delo; PATCH
 *    (preimenoval/analiza) in DELETE pa sta lastniška popravka.
 *  · time-entries GET/POST/PATCH — ura je montirjeva (piše kaj je
 *    delal); DELETE in obračun (billedAt) sta lastniška.
 *  · diary-entries GET/POST/PATCH — terenski dnevnik piše tisti, ki
 *    dela; DELETE je lastniška odločitev (zgodovina = dokaz).
 *  · analyze-photo POST — orodje na terenu, montir ga uporablja.
 *  · invoices, cenik, settings, team, catalog — DENAR IN POGODBA:
 *    izključno lastnik. */
export const MONTIR_ALLOWED: Readonly<Record<Resource, readonly Method[]>> = {
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

/** Ali sme vloga na resursu metodo? Owner sme VSE; montir samo
 *  izrecno dovoljene (MONTIR_ALLOWED); nepoznan resurs/metoda → false
 *  (deny-by-default tudi za hrošč v klicu). */
export function canAccess(resource: Resource, method: Method, role: Role): boolean {
  if (role === 'owner') return true;
  return MONTIR_ALLOWED[resource]?.includes(method) ?? false;
}

/** Sporočilo 403 — enotno povsod, da klient (toast) pokaže isti tekst
 *  in da preverba lahko meri natančno to besedilo. */
export const MONTIR_FORBIDDEN_MESSAGE =
  'Za to dejanje potrebuješ vlogo lastnika obrta.';

/** Montir, ki še NI član nobenega obrta (Task 97): zavrnjen je že pri
 *  branju — obseg mu nima koga pripisati, legacy ne-filtriran obseg
 *  ("brez seje vidi vse") pa bi bil varnostna luknja za prijavljenega
 *  človeka. Počaka povabilo lastnika (Nastavitve → Ekipa). */
export const MONTIR_NO_OBRT_MESSAGE =
  'Nisi član nobenega obrta — za uporabo podatkov potrebuješ povabilo lastnika obrta.';
