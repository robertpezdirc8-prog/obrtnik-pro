// ─── Popis odprtin (okna/vrata) s fotke — meritvena skripta (0 AI) ─────────
// Iz zaznanih kandidatov odprtin (Task 24: vrata + okna z okvirji v % slike)
// zgradi standarden "window/door schedule": oznake, tip, širina × višina,
// površina, plavavost po DIN 18101 / EN 14351-1 pasovih, deduplikacija
// (ista odprtina kot vrata IN okno — IoU ≥ 0,5) in povzetek za kalkulator
// okna/vrata (windowCount, windowSize — povprečni m², doorCount).
// Eno merilo (referenčni kandidat) umeri VSE odprtine — fotogrametrijska
// enotnost fasade; soglasje meril (Task 24) je kontrola kakovosti popisa.

import type { ScaleAgreement, ScaleSuggestion } from './camera-types';

// ── Pasovi plavavosti (DIN 18101 vrata, EN 14351-1 okna) ─────
const DOOR_WIDTH_CM: [number, number] = [70, 110];
const DOOR_HEIGHT_CM: [number, number] = [180, 230];
const WINDOW_WIDTH_CM: [number, number] = [60, 180];
const WINDOW_HEIGHT_CM: [number, number] = [40, 260];
/** IoU prag = isti objekt (PASCAL VOC standard). */
const DEDUP_IOU = 0.5;
/** Zanesljivost, ki jo dobi ročno narisana odprtina (premaga samodejne). */
export const MANUAL_CONFIDENCE = 80;

export type OpeningKind = 'vrata' | 'okno';
export type OpeningSource = 'auto' | 'rocno';

/** Vhodna odprtina (samodejni kandidat ALI ročno narisana) — box v % slike. */
export interface OpeningBoxInput {
  id: string;
  kind: OpeningKind;
  box: [number, number, number, number]; // [x, y, w, h] v % slike (0–100)
  confidence: number; // 0–100
  source: OpeningSource;
}

/** Umeritev popisa — ena referenca meri vse odprtine. */
export interface OpeningCalibration {
  refId: string;
  refLabel: string;
  kind: OpeningKind;
  /** Predpostavljena višina referenčnega okvirja v cm (vrata 200, okno 120). */
  assumedCm: number;
  /** Naravnih pikslov slike na 1 cm. */
  pxPerCm: number;
  confidence: number;
}

/** Ena vrstica popisa odprtin. */
export interface OpeningEntry {
  id: string;
  kind: OpeningKind;
  label: string; // 'Vrata 1', 'Okno 2' (ali 'Vrata' / 'Okno', ko je samo en)
  box: [number, number, number, number];
  widthCm: number | null;
  heightCm: number | null;
  areaM2: number | null;
  confidence: number;
  source: OpeningSource;
  included: boolean;
  /** Ali širina pasti v pričakovani pas (DIN/EN); null brez kalibracije. */
  widthPlausible: boolean | null;
}

/** Celoten popis odprtin. */
export interface OpeningSchedule {
  calibration: OpeningCalibration | null;
  /** Vse odprtine (vključene + izključene), urejene: vrata, okna; po legi. */
  openings: OpeningEntry[];
  doorCount: number;
  windowCount: number;
  /** Povprečna površina vključenih oken (m²) — direktno za kalkulator. */
  windowAvgM2: number | null;
  doorAvgM2: number | null;
  /** Skupna površina vključenih odprtin (m²). */
  totalGlazingM2: number | null;
  /** Koliko samodejnih kandidatov je odstranil dedup (duplikati). */
  dedupCount: number;
  warnings: string[];
}

export interface BuildOpeningScheduleArgs {
  /** Kandidati iz analize (Task 24) — že urejeni po zanesljivosti. */
  suggestions: ScaleSuggestion[];
  naturalWidth: number;
  naturalHeight: number;
  /** Id izbrane referenčne odprtine; null/izostanek = samodejno najboljša. */
  refId?: string | null;
  /** Ročno narisane odprtine (2 klik uporabnika). */
  manual?: OpeningBoxInput[];
  /** Id-ji odprtin, ki jih je uporabnik izključil. */
  excludedIds?: string[];
  /** Soglasje meril iz analize (Task 24) — za opozorilo. */
  agreement?: ScaleAgreement;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** IoU dveh boxov v % slike (razmerje je neodvisno od prostora). */
export function openingIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ax1 = a[0] + a[2];
  const ay1 = a[1] + a[3];
  const bx1 = b[0] + b[2];
  const by1 = b[1] + b[3];
  const ix0 = Math.max(a[0], b[0]);
  const iy0 = Math.max(a[1], b[1]);
  const ix1 = Math.min(ax1, bx1);
  const iy1 = Math.min(ay1, by1);
  const iw = ix1 - ix0;
  const ih = iy1 - iy0;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const areaA = Math.max(0, a[2]) * Math.max(0, a[3]);
  const areaB = Math.max(0, b[2]) * Math.max(0, b[3]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function plausibleFor(kind: OpeningKind, wCm: number | null, hCm: number | null): boolean {
  if (wCm === null || hCm === null) return false;
  const [wLo, wHi] = kind === 'vrata' ? DOOR_WIDTH_CM : WINDOW_WIDTH_CM;
  const [hLo, hHi] = kind === 'vrata' ? DOOR_HEIGHT_CM : WINDOW_HEIGHT_CM;
  return wCm >= wLo && wCm <= wHi && hCm >= hLo && hCm <= hHi;
}

/**
 * Zgradi popis odprtin iz kandidatov + ročnih odprtin.
 * Čisto funkcija — brez DOM, testabilno v bun.
 */
export function buildOpeningSchedule(args: BuildOpeningScheduleArgs): OpeningSchedule {
  const { suggestions, naturalWidth, naturalHeight } = args;
  const excluded = new Set(args.excludedIds ?? []);
  const warnings: string[] = [];

  // ── 1) Kalibracija: izbrana ALI najboljša referenca ──────────
  const refCandidates = suggestions.filter((s) => s.box[2] > 0 && s.box[3] > 0);
  let ref: ScaleSuggestion | null = null;
  if (args.refId) {
    ref = refCandidates.find((s) => s.id === args.refId) ?? null;
    if (!ref && refCandidates.length > 0) {
      warnings.push(`Izbrana referenca ni več na voljo — uporabljam najboljšo zaznano.`);
    }
  }
  if (!ref) ref = refCandidates[0] ?? null;

  let calibration: OpeningCalibration | null = null;
  if (ref && naturalWidth > 0 && naturalHeight > 0) {
    const refHpx = (ref.box[3] / 100) * naturalHeight;
    const pxPerCm = refHpx / Math.max(1, ref.assumedCm);
    if (pxPerCm > 0.01 && Number.isFinite(pxPerCm)) {
      calibration = {
        refId: ref.id,
        refLabel: ref.label,
        kind: ref.kind,
        assumedCm: ref.assumedCm,
        pxPerCm,
        confidence: ref.confidence,
      };
    } else {
      warnings.push('Referenčni okvir je premajhen za umeritev — mere niso na voljo.');
    }
  }
  if (!calibration && refCandidates.length > 0) {
    warnings.push('Merila ni bilo mogoče umeriti — vpiši znano višino ali izberi drugo referenco.');
  }

  // ── 2) Zberi odprtine: samodejni kandidati + ročne ───────────
  const inputs: OpeningBoxInput[] = refCandidates.map((s) => ({
    id: s.id,
    kind: s.kind,
    box: [s.box[0], s.box[1], s.box[2], s.box[3]],
    confidence: s.confidence,
    source: 'auto' as const,
  }));
  for (const m of args.manual ?? []) {
    if (m.box[2] <= 0 || m.box[3] <= 0) continue;
    inputs.push({ ...m, source: 'rocno', confidence: MANUAL_CONFIDENCE });
  }

  // ── 3) Deduplikacija: IoU ≥ 0,5 = ista odprtina ──────────────
  // Ročna VEDNO premaga samodejno; sicer zmaga višja zanesljivost.
  let dedupCount = 0;
  const kept: OpeningBoxInput[] = [];
  for (const c of inputs) {
    const overlapIdx = kept.findIndex((k) => openingIoU(k.box, c.box) >= DEDUP_IOU);
    if (overlapIdx === -1) {
      kept.push(c);
      continue;
    }
    const k = kept[overlapIdx];
    const cWins = c.source === 'rocno' && k.source !== 'rocno';
    const kWins = k.source === 'rocno' && c.source !== 'rocno';
    if (cWins) kept[overlapIdx] = c;
    else if (!kWins && c.confidence > k.confidence) kept[overlapIdx] = c;
    dedupCount++;
  }
  if (dedupCount > 0) {
    warnings.push(
      `${dedupCount} ${dedupCount === 1 ? 'odprtina je bila zaznana dvakrat' : 'odprtini sta bili zaznani dvakrat'} (vrata + okno) — upoštevana enkrat.`,
    );
  }

  // ── 4) Meritev + oznake ──────────────────────────────────────
  // Urejanje: vrata pred okni; znotraj tipa levo→desno, zgoraj→navzdol.
  const order = (a: OpeningBoxInput, b: OpeningBoxInput): number => {
    if (a.kind !== b.kind) return a.kind === 'vrata' ? -1 : 1;
    if (Math.abs(a.box[1] - b.box[1]) > 8) return a.box[1] - b.box[1];
    return a.box[0] - b.box[0];
  };
  kept.sort(order);

  const doorTotal = kept.filter((c) => c.kind === 'vrata').length;
  const winTotal = kept.filter((c) => c.kind === 'okno').length;
  const doorSeen: Record<number, boolean> = {};
  const winSeen: Record<number, boolean> = {};

  const openings: OpeningEntry[] = kept.map((c) => {
    let widthCm: number | null = null;
    let heightCm: number | null = null;
    let areaM2: number | null = null;
    if (calibration) {
      const wPx = (c.box[2] / 100) * naturalWidth;
      const hPx = (c.box[3] / 100) * naturalHeight;
      widthCm = Math.round(wPx / calibration.pxPerCm);
      heightCm = Math.round(hPx / calibration.pxPerCm);
      areaM2 = Math.round(((widthCm * heightCm) / 10000) * 100) / 100;
    }
    // oznake: 'Vrata'/'Okno' ko je tip enkraten, sicer 'Vrata N'/'Okno N'
    let label = c.kind === 'vrata' ? 'Vrata' : 'Okno';
    if (c.kind === 'vrata' && doorTotal > 1) {
      let n = 0;
      for (let i = 0; i < kept.length; i++) {
        if (kept[i].kind !== 'vrata') continue;
        n++;
        if (kept[i].id === c.id) break;
      }
      label = `Vrata ${n}`;
    } else if (c.kind === 'okno' && winTotal > 1) {
      let n = 0;
      for (let i = 0; i < kept.length; i++) {
        if (kept[i].kind !== 'okno') continue;
        n++;
        if (kept[i].id === c.id) break;
      }
      label = `Okno ${n}`;
    }
    if (c.kind === 'vrata') doorSeen[doorTotal] = true;
    else winSeen[winTotal] = true;

    return {
      id: c.id,
      kind: c.kind,
      label,
      box: [round1(c.box[0]), round1(c.box[1]), round1(c.box[2]), round1(c.box[3])],
      widthCm,
      heightCm,
      areaM2,
      confidence: c.confidence,
      source: c.source,
      included: !excluded.has(c.id),
      widthPlausible: plausibleFor(c.kind, widthCm, heightCm),
    };
  });

  // ── 5) Povzetek (samo vključene) ─────────────────────────────
  const inc = openings.filter((o) => o.included);
  const doors = inc.filter((o) => o.kind === 'vrata');
  const wins = inc.filter((o) => o.kind === 'okno');
  const areas = inc.map((o) => o.areaM2).filter((a): a is number => a !== null);
  const winAreas = wins.map((o) => o.areaM2).filter((a): a is number => a !== null);
  const doorAreas = doors.map((o) => o.areaM2).filter((a): a is number => a !== null);
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

  // ── 6) Opozorila ─────────────────────────────────────────────
  if (calibration === null && kept.length > 0) {
    warnings.unshift('Popis je brez kalibracije — mere neznane. Umeri po referenci (vrata/okno).');
  }
  if (args.agreement === 'low') {
    warnings.push('Merila zaznanih referenc se NE ujemajo — odprtine v globini so lahko napačno izmerjene.');
  }
  const impl = inc.filter((o) => o.widthPlausible === false);
  if (impl.length > 0) {
    warnings.push(
      `Nepričakovane mere: ${impl.map((o) => o.label).join(', ')} — preveri ali je to res odprtina (lahko jo izključiš).`,
    );
  }

  return {
    calibration,
    openings,
    doorCount: doors.length,
    windowCount: wins.length,
    windowAvgM2: winAreas.length > 0 ? round1(mean(winAreas) * 10) / 10 : null,
    doorAvgM2: doorAreas.length > 0 ? round1(mean(doorAreas) * 10) / 10 : null,
    totalGlazingM2: areas.length > 0 ? Math.round(mean(areas) * areas.length * 100) / 100 : null,
    dedupCount,
    warnings,
  };
}

// ── Izvoz: besedilo + CSV (vzorec post-layout.ts) ────────────

export function formatScheduleText(s: OpeningSchedule): string {
  const L: string[] = ['Popis odprtin (okna/vrata) — s fotke, skriptno 0 AI'];
  if (s.calibration) {
    L.push(
      `- Merilo: ${s.calibration.refLabel} ≈ ${s.calibration.assumedCm} cm (${s.calibration.confidence}/100)`,
    );
  } else {
    L.push('- Merilo: NEUMERJENO (mere niso na voljo)');
  }
  L.push(`- Vrata: ${s.doorCount} · Okna: ${s.windowCount}`);
  if (s.windowAvgM2 !== null) L.push(`- Povprečno okno: ${String(s.windowAvgM2).replace('.', ',')} m²`);
  if (s.totalGlazingM2 !== null) L.push(`- Skupaj površina odprtin: ${String(s.totalGlazingM2).replace('.', ',')} m²`);
  L.push('');
  L.push('VRSTA;OZNAKA;ŠIRINA cm;VIŠINA cm;POVRŠINA m²;VIR');
  for (const o of s.openings) {
    if (!o.included) continue;
    const f = (v: number | null): string => (v === null ? '—' : String(v).replace('.', ','));
    L.push(
      [
        o.kind === 'vrata' ? 'Vrata' : 'Okno',
        o.label,
        f(o.widthCm),
        f(o.heightCm),
        o.areaM2 === null ? '—' : String(o.areaM2).replace('.', ','),
        o.source === 'rocno' ? 'ročno' : 'samodejno',
      ].join(';'),
    );
  }
  for (const w of s.warnings) L.push(`OPOZORILO: ${w}`);
  return L.join('\n');
}

export function scheduleToCsv(s: OpeningSchedule, label: string): string {
  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const num = (v: number | null): string => (v === null ? '' : String(v).replace('.', ','));
  const rows: string[] = [];
  rows.push([esc('Popis odprtin'), esc(label)].join(','));
  rows.push('vrsta,oznaka,sirina_cm,visina_cm,povrsina_m2,vir,zanesljivost_0_100,vkljuceno');
  for (const o of s.openings) {
    rows.push(
      [
        esc(o.kind === 'vrata' ? 'vrata' : 'okno'),
        esc(o.label),
        num(o.widthCm),
        num(o.heightCm),
        num(o.areaM2),
        esc(o.source === 'rocno' ? 'rocno' : 'samodejno'),
        String(o.confidence),
        o.included ? '1' : '0',
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function downloadScheduleCsv(s: OpeningSchedule, label: string): void {
  const csv = scheduleToCsv(s, label);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `popis-odprtin-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Prefill kalkulatorja okna/vrata ──────────────────────────

export interface OknaVrataPrefill {
  windowCount?: number;
  windowSize?: number;
  doorCount?: number;
}

/**
 * Preslika popis v polja kalkulatorja okna/vrata:
 * št. oken, povprečna velikost okna (m²), št. vrat — samo vključene.
 */
export function prefillOknaVrata(s: OpeningSchedule): OknaVrataPrefill {
  const out: OknaVrataPrefill = {};
  if (s.windowCount > 0) out.windowCount = s.windowCount;
  if (s.doorCount > 0) out.doorCount = s.doorCount;
  if (s.windowAvgM2 !== null) out.windowSize = clamp(Math.round(s.windowAvgM2 * 100) / 100, 0.5, 20);
  return out;
}
