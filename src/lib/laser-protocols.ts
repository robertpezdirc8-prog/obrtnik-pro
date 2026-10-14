// ─── Protokoli laserskih merilnikov za ZNANE modele ─────────
// Vse je deterministično (0 AI). Razčlenjevalniki so napisani po
// javno dokumentiranih, neodvisno razvozlanih protokolih in
// preverjeni s fiksaturami iz dokumentiranih zajemov:
//
//  • Bosch GLM 120 C (BLE, GATT indikacije):
//    vir: lz1asl/CaveSurvey #150 (Feb 2021) — gatttool zapisi:
//      init        c0550201001a  (običajno značka 0x001e)
//      trigger     c05601001e    (dvakrat: prvič priprava+laser,
//                                drugič dejanska meritev)
//      indikacija  c0 55 10 06 08 54 05 6f 81 04 3f … ec
//      → bajti 7–10 = IEEE 754 float (little-endian) v METRIH
//        (6f 81 04 3f = 0,5176 m)
//  • Bosch GLM 20/PLR 15/GLM 50C/100C (serijski C0-okvir, tudi
//    prek BLE serial-like značk): vir: eevblog »Hacking the Bosch
//    GLM 20« (rtv, 2017) + philipptrenz/BOSCH-GLM-rangefinder:
//      okvir pošlji: [C0][ukaz][dolžina]([podatki])[kontrolna vsota]
//      okvir prejmi: [status][dolžina][podatki…][kontrolna vsota]
//      ukaz »meri«: C0 40 00 EE
//      odgovor: 00 04 13 0E 00 00 32
//      → podatki = uint32 little-endian × 0,05 mm
//        (0x00000E13 = 3603 → 180,15 mm)
//      statusi: 00 OK · 01 zamik · 03 kontrolna vsota · 04 neznan
//      ukaz · 05/0D dostop · 08 strojna napaka · 10 naprava ni pripravljena
//  • Generična značka: ASCII besedilo ("350", "3,50") ali surove
//    bajte uint16/uint32 little-endian v mm.
//
// Iskrenost: če naprava ne pošilja znanih okvirjev, razčlenjevalnik
// vrne null — nič ni ugibano. Sprožitvena zaporedja so KONSTANTE iz
// virov (brez lastnega računanja kontrolnih vsot). Best-effort
// pisanje v značko se jasno sporoči v UI.

// ── Modeli ──────────────────────────────────────────────────

export type LaserModelId =
  | 'auto'
  | 'bosch-glm120'
  | 'bosch-c0'
  | 'generic-text'
  | 'generic-bytes';

export interface LaserModelInfo {
  id: LaserModelId;
  name: string;
  hint: string;
}

export const LASER_MODELS: LaserModelInfo[] = [
  {
    id: 'auto',
    name: 'Samodejno (poskusi vse znane)',
    hint: 'Poskusi znane protokole in generično besedilo/bajte.',
  },
  {
    id: 'bosch-glm120',
    name: 'Bosch GLM 120 C',
    hint: 'BLE indikacije, razdalja kot float v metrih (dokumentiran protokol).',
  },
  {
    id: 'bosch-c0',
    name: 'Bosch GLM 50C / 100C / PLR',
    hint: 'C0-okvirji, razdalja = uint32 × 0,05 mm (dokumentiran protokol).',
  },
  {
    id: 'generic-text',
    name: 'Leica DISTO in ostali (besedilo)',
    hint: 'ASCII številke v besedilu ("350", "3,50").',
  },
  {
    id: 'generic-bytes',
    name: 'Generični modul (surovi bajti)',
    hint: 'uint16/uint32 little-endian v mm (tipični BLE moduli FFE0/FFF1).',
  },
];

/** Prepozna model po imenu naprave, če je točno znan; sicer 'auto'. */
export function detectLaserModel(deviceName: string | null | undefined): LaserModelId {
  const n = (deviceName ?? '').toUpperCase().replace(/[\s-]+/g, ' ').trim();
  if (!n) return 'auto';
  // GLM 120 / GLM120C / GLM 120 C
  if (/\bGLM ?120/.test(n)) return 'bosch-glm120';
  // GLM 50C/100C/50-27 CG/PLR 15/30C/40C/50C — C0-okvirni protokol
  if (/\bGLM\b/.test(n) || /\bGLM\d/.test(n) || /\bPLR\b/.test(n)) return 'bosch-c0';
  return 'auto';
}

// ── Sprožitvena zaporedja (KONSTANTE iz dokumentacije, nič računanega) ──

/** GLM 120 C: omogoči indikacije (običajno značka 0x001f). */
export const GLM120_ENABLE_INDICATIONS: number[] = [0x02, 0x00];
/** GLM 120 C: inicializacija (običajno značka 0x001e) — brez tega
 *  indikacije ne vsebujejo meritev (vir: CaveSurvey #150). */
export const GLM120_INIT: number[] = [0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a];
/** GLM 120 C: sproži meritev — POŠLJI DVAKRAT (prvič priprava + laser,
 *  drugič dejanska meritev). */
export const GLM120_TRIGGER: number[] = [0xc0, 0x56, 0x01, 0x00, 0x1e];
/** GLM 120 C: način razdalje (privzeti). */
export const GLM120_MODE_DISTANCE: number[] = [0xc0, 0x55, 0x02, 0xf1, 0x01, 0xee];
/** Bosch C0 (GLM 50C/100C/PLR): ukaz »začni meritev«. */
export const BOSCH_C0_MEASURE: number[] = [0xc0, 0x40, 0x00, 0xee];

// ── Statusi Bosch C0 odgovora (vir: eevblog GLM 20) ─────────

const C0_STATUS_WARNINGS: Record<number, string> = {
  0x01: 'Naprava poroča komunikacijski zamik — poskusi znova.',
  0x03: 'Naprava je zavrla okvir (napačna kontrolna vsota) — poskusi znova.',
  0x04: 'Naprava ne prepozna ukaza — ta model morda ne podpira daljinskega sproženja.',
  0x05: 'Naprava zahteva višjo dostopno raven (dostop zavrnjen).',
  0x08: 'Strojna napaka naprave — preveri, ali je tarča vidna in baterija dovolj močna.',
  0x10: 'Naprava še ni pripravljena za meritve — počakaj trenutek in poskusi znova.',
  0x0d: 'Naprava je zavrla ukaz (dostop + strojna napaka).',
};

// ── Pomožne pretvorbe ───────────────────────────────────────

const CM_MIN = 1;
const CM_MAX = 50_000;

const inRange = (cm: number): boolean =>
  Number.isFinite(cm) && cm >= CM_MIN && cm <= CM_MAX;

export interface LaserParseResult {
  cm: number;
  /** Iskreno opozorilo naprave (npr. strojna napaka) — vrednost NI bila meritev. */
  warning?: string;
}

function finish(cmRaw: number, warning?: string): LaserParseResult | null {
  if (!Number.isFinite(cmRaw)) return null;
  const cm = Math.round(cmRaw * 10) / 10;
  if (!inRange(cm)) return null;
  return warning ? { cm, warning } : { cm };
}

// ── 1) Bosch GLM 120 C: GATT indikacija → float LE v metrih ──

/**
 * Razčleni GLM 120 C indikacijo. Meritev je okvir, ki se začne
 * z 0xC0 0x55 0x10 in ima v bajtih 7–10 IEEE 754 float
 * (little-endian) razdalje v METRIH. Ostali okvirji (odmevi ukazov,
 * pripravljenost) nimajo vrednosti → null. Dodatno strpnost pravilo:
 * katerikoli drug C0-okvir s smiselnim floatom (0,001–100 m) na
 * mestu 7–10 je sprejet (različice vdelane programske opreme),
 * vrednost 0 ali nesmiselna pa je zavržena.
 */
export function parseBoschGlm120Indication(bytes: Uint8Array): LaserParseResult | null {
  if (bytes.length < 11) return null;
  if (bytes[0] !== 0xc0) return null;
  const isDocumentedMeasure = bytes[1] === 0x55 && bytes[2] === 0x10 && bytes[3] === 0x06;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meters = dv.getFloat32(7, true);
  if (!Number.isFinite(meters) || meters <= 0.001 || meters > 100) {
    // odmev/pripravljenost ali neveljaven float — ni meritve
    return null;
  }
  if (!isDocumentedMeasure) {
    // strpna varianta: C0-okvir s smiselnim floatom, ni dokumentirane
    // merilne oblike — vrednost sprejmemo, vendar z opozorilom
    return finish(meters * 100, 'Nedokumentirana oblika okvirja — vrednost preveri s trakom.');
  }
  return finish(meters * 100);
}

// ── 2) Bosch C0-odgovor: [status][len][data…][csum] → u32 LE × 0,05 mm ──

/**
 * Razčleni Bosch C0 odgovor (GLM 20/PLR 15 serije; po viru enako za
 * GLM 50C/100C prek serial-like BLE značk). Status ≠ 0x00 → opozorilo
 * in NI vrednosti (iskreno — ne ugibamo).
 */
export function parseBoschC0Response(bytes: Uint8Array): LaserParseResult | null {
  if (bytes.length < 3) return null;
  const status = bytes[0];
  if (status !== 0x00) {
    return { cm: 0, warning: C0_STATUS_WARNINGS[status] ?? `Naprava je vrnila status 0x${status.toString(16).padStart(2, '0')} — meritve ni bilo.` };
  }
  const len = bytes[1];
  if (len < 4 || bytes.length < 2 + len) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = dv.getUint32(2, true); // little-endian
  const mm = raw * 0.05;
  return finish(mm / 10); // mm → cm
}

// ── 3) Generično besedilo (ASCII "350", "3,50") ─────────────

export function parseGenericText(bytes: Uint8Array): LaserParseResult | null {
  try {
    const text = new TextDecoder().decode(bytes).trim();
    // Izrecno navedena enota v besedilu se upošteva; golo število je
    // cm (dosedanje vedenje aplikacije, E2E-verificirano) — nič ugibanja.
    const mm = text.match(/(\d+(?:[.,]\d+)?)\s*mm\b/i);
    if (mm) return finish(parseFloat(mm[1].replace(',', '.')) / 10);
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*m(?:\b|[^a-zà-ž])/i);
    if (m) return finish(parseFloat(m[1].replace(',', '.')) * 100);
    const bare = text.match(/\d+(?:[.,]\d+)?/);
    if (!bare) return null;
    const v = parseFloat(bare[0].replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    return finish(v);
  } catch {
    return null;
  }
}

// ── 4) Generični surovi bajti: uint16/uint32 LE v mm ────────

export function parseGenericBytes(bytes: Uint8Array): LaserParseResult | null {
  if (bytes.length === 2) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return finish(dv.getUint16(0, true) / 10); // mm → cm
  }
  if (bytes.length === 4) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return finish(dv.getUint32(0, true) / 10); // mm → cm
  }
  return null;
}

// ── Skupni vhod (DataView iz BLE dogodka) ───────────────────

/**
 * Razčleni BLE notifikacijo po izbranem modelu. Pri 'auto' poskusi
 * po vrsti: GLM 120 C → Bosch C0 → besedilo → surovi bajti (protokolni
 * okvirji pred besedilom, ker bi jih besedilno razčlenjevanje pokvarilo).
 * Vrne null, če nič ne ustreza — nič ni ugibano.
 */
export function parseLaserValue(dv: DataView, model: LaserModelId = 'auto'): LaserParseResult | null {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  if (model === 'bosch-glm120') return parseBoschGlm120Indication(bytes);
  if (model === 'bosch-c0') return parseBoschC0Response(bytes);
  if (model === 'generic-text') return parseGenericText(bytes);
  if (model === 'generic-bytes') return parseGenericBytes(bytes);
  // auto
  return (
    parseBoschGlm120Indication(bytes) ??
    parseBoschC0Response(bytes) ??
    parseGenericText(bytes) ??
    parseGenericBytes(bytes)
  );
}

// ── Samopreizkus: fiksature iz dokumentiranih zajemov ───────

export interface SelfTestRow {
  name: string;
  ok: boolean;
  detail: string;
}

function bytesOf(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

/**
 * Preveri razčlenjevalnike proti VSEM dokumentiranim zajemom (vir zgoraj).
 * Deterministično — ista koda teče tudi v tests/verify/laser-protocols.ts.
 */
export function protocolSelfTest(): SelfTestRow[] {
  const rows: SelfTestRow[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    rows.push({ name, ok, detail });
  };
  const near = (a: number, b: number, eps = 0.05): boolean => Math.abs(a - b) <= eps;

  // 1) GLM 120 C dokumentirana merilna indikacija (CaveSurvey #150)
  const glm120 = parseBoschGlm120Indication(
    bytesOf(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0x6f, 0x81, 0x04, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xec),
  );
  check('GLM 120 C: 0,5176 m → 51,8 cm', near(glm120?.cm ?? -1, 51.8), `dobi ${glm120?.cm ?? 'null'} cm`);

  // 2) GLM 120 C odmev priprave (brez meritve) → null
  const glm120Echo = parseBoschGlm120Indication(
    bytesOf(0xc0, 0x55, 0x10, 0x02, 0x09, 0x53, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc2),
  );
  check('GLM 120 C: odmev priprave → ni meritve', glm120Echo === null, 'biti mora null');

  // 3) GLM 120 C pripravljenost (brez C0) → null
  const glm120Armed = parseBoschGlm120Indication(
    bytesOf(0x00, 0x10, 0x02, 0x08, 0x53, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8),
  );
  check('GLM 120 C: pripravljenost (00 okvir) → ni meritve', glm120Armed === null, 'biti mora null');

  // 4) Bosch C0 dokumentiran odgovor (eevblog): 00 04 13 0E 00 00 32 → 180,15 mm
  const c0 = parseBoschC0Response(bytesOf(0x00, 0x04, 0x13, 0x0e, 0x00, 0x00, 0x32));
  check('Bosch C0: 0x00000E13 × 0,05 mm → 18,0 cm', near(c0?.cm ?? -1, 18.0), `dobi ${c0?.cm ?? 'null'} cm`);

  // 5) Bosch C0 strojna napaka → opozorilo, brez vrednosti
  const c0err = parseBoschC0Response(bytesOf(0x08, 0x00, 0x45));
  check('Bosch C0: status 08 → opozorilo o strojni napaki', c0err !== null && c0err.cm === 0 && !!c0err.warning, c0err?.warning ?? 'brez opozorila');

  // 6) Generično besedilo "350" → 350 cm
  const text = parseGenericText(new TextEncoder().encode(' 350 '));
  check('Besedilo: "350" → 350 cm', (text?.cm ?? -1) === 350, `dobi ${text?.cm ?? 'null'} cm`);

  // 7) Generične bajte: u16 LE 3500 mm → 350 cm
  const u16 = parseGenericBytes(bytesOf(0xac, 0x0d));
  check('Bajte u16 LE: 3500 mm → 350 cm', (u16?.cm ?? -1) === 350, `dobi ${u16?.cm ?? 'null'} cm`);

  // 8) Samodejni način: GLM 120 okvir prek skupnega vhoda
  const auto = parseLaserValue(
    new DataView(bytesOf(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0x6f, 0x81, 0x04, 0x3f).buffer),
    'auto',
  );
  check('Samodejno: GLM 120 okvir → 51,8 cm', near(auto?.cm ?? -1, 51.8), `dobi ${auto?.cm ?? 'null'} cm`);

  return rows;
}
