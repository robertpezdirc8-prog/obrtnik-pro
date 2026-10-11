// ─── Geometrijski pogon merjenja (dolžine · površine · koti) ──
// Vse točke so podane v % slike (0–100). Izračuni tečejo v
// NARAVNIH pikslih slike (ImgSize), da so koti in površine
// pravilni tudi, kadar je prikaz raztegnjen
// (SVG preserveAspectRatio="none").

import type { PhotoMeasure } from './camera-types';
import type { CraftInputs } from './types';

export interface XY {
  x: number;
  y: number;
}
/** Točka: objekt ali tuple [x, y] (kot PhotoMeasure.points). */
export type PtLike = XY | readonly [number, number];
export interface ImgSize {
  w: number;
  h: number;
}

function asXY(p: PtLike): XY {
  return 'x' in p ? { x: p.x, y: p.y } : { x: p[0], y: p[1] };
}

/** Pretvori % točko v naravne piksle slike. */
export function pctToPx(p: XY, size: ImgSize): XY {
  return { x: (p.x / 100) * size.w, y: (p.y / 100) * size.h };
}

/** Razdalja med dvema točkama v naravnih pikslih slike. */
export function pxDistance(a: PtLike, b: PtLike, size: ImgSize): number {
  const A = pctToPx(asXY(a), size);
  const B = pctToPx(asXY(b), size);
  return Math.hypot(B.x - A.x, B.y - A.y);
}

/** Kot pri oglišču v (med daljicama v→a in v→c) v stopinjah (0–180). */
export function angleAt(a: PtLike, v: PtLike, c: PtLike, size: ImgSize): number {
  const A = pctToPx(asXY(a), size);
  const V = pctToPx(asXY(v), size);
  const C = pctToPx(asXY(c), size);
  const v1 = { x: A.x - V.x, y: A.y - V.y };
  const v2 = { x: C.x - V.x, y: C.y - V.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;
  const ang = Math.atan2(Math.abs(cross), dot);
  return Math.round(((ang * 180) / Math.PI) * 10) / 10;
}

/**
 * Površina poligona (Shoelace formula) v m² glede na kalibrirano
 * merilo (pxPerCm = naravnih pikslov na 1 cm). Vrne null, če je
 * točk premalo ali merilo ni kalibrirano.
 */
export function polygonAreaM2(
  points: PtLike[],
  size: ImgSize,
  pxPerCm: number,
): number | null {
  if (points.length < 3 || !pxPerCm || pxPerCm <= 0) return null;
  const px = points.map((p) => pctToPx(asXY(p), size));
  let sum = 0;
  for (let i = 0; i < px.length; i++) {
    const a = px[i];
    const b = px[(i + 1) % px.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const areaPx2 = Math.abs(sum) / 2;
  const cm2 = areaPx2 / (pxPerCm * pxPerCm);
  return Math.round((cm2 / 10_000) * 100) / 100; // na 0,01 m²
}

/** Obseg poligona v cm. */
export function polygonPerimeterCm(
  points: PtLike[],
  size: ImgSize,
  pxPerCm: number,
): number | null {
  if (points.length < 3 || !pxPerCm || pxPerCm <= 0) return null;
  const sides = polygonSidesCm(points, size, pxPerCm);
  const sum = sides.reduce((s, v) => s + v, 0);
  return Math.round(sum * 10) / 10;
}

/** Dolžine posameznih strani poligona v cm. */
export function polygonSidesCm(
  points: PtLike[],
  size: ImgSize,
  pxPerCm: number,
): number[] {
  if (points.length < 3 || !pxPerCm || pxPerCm <= 0) return [];
  const sides: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sides.push(Math.round((pxDistance(a, b, size) / pxPerCm) * 10) / 10);
  }
  return sides;
}

/** Daljica v cm pri kalibriranem merilu. */
export function lengthCm(
  a: PtLike,
  b: PtLike,
  size: ImgSize,
  pxPerCm: number,
): number | null {
  if (!pxPerCm || pxPerCm <= 0) return null;
  return Math.round((pxDistance(a, b, size) / pxPerCm) * 10) / 10;
}

/** Težišče poligona v % (za postavitev oznake). */
export function centroidPct(points: PtLike[]): XY {
  const xy = points.map(asXY);
  const n = xy.length || 1;
  const x = xy.reduce((s, p) => s + p.x, 0) / n;
  const y = xy.reduce((s, p) => s + p.y, 0) / n;
  return { x, y };
}

// ─── Oblikovanje ────────────────────────────────────────────

export function formatCm(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2).replace('.', ',')} m` : `${Math.round(cm)} cm`;
}

export function formatM2(m2: number): string {
  return `${m2.toLocaleString('sl-SI', { maximumFractionDigits: 2 })} m²`;
}

export function formatDeg(deg: number): string {
  return `${deg.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}°`;
}

// ─── Izvoz meritev (besedilo / CSV) ─────────────────────────

const KIND_LABELS: Record<string, string> = {
  length: 'Dolžina',
  area: 'Površina',
  angle: 'Kot',
  laser: 'Laser',
  voice: 'Glas',
};

export function measuresToText(measures: PhotoMeasure[]): string {
  if (measures.length === 0) return '';
  return measures
    .map((m) => {
      if (m.kind === 'area') return `${m.label} (površina): ${m.value !== null ? formatM2(m.value) : '—'}`;
      if (m.kind === 'angle') return `${m.label} (kot): ${m.value !== null ? formatDeg(m.value) : '—'}`;
      return `${m.label}: ${m.value !== null ? formatCm(m.value) : '—'}`;
    })
    .join('\n');
}

export function measuresToCsv(measures: PhotoMeasure[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows: string[] = ['vrsta,oznaka,vrednost,enota,opomba'];
  for (const m of measures) {
    const kind = KIND_LABELS[m.kind] ?? m.kind;
    if (m.kind === 'area') {
      rows.push([esc(kind), esc(m.label), m.value !== null ? String(m.value).replace('.', ',') : '', 'm²', m.sides?.length ? `strani: ${m.sides.map((s) => formatCm(s)).join(' + ')}` : ''].join(','));
    } else if (m.kind === 'angle') {
      rows.push([esc(kind), esc(m.label), m.value !== null ? String(m.value).replace('.', ',') : '', '°', ''].join(','));
    } else {
      rows.push([esc(kind), esc(m.label), m.value !== null ? String(Math.round(m.value * 10) / 10).replace('.', ',') : '', 'cm', ''].join(','));
    }
  }
  return rows.join('\n');
}

/** Sproži prenos CSV datoteke v brskalniku. */
export function downloadMeasuresCsv(measures: PhotoMeasure[], filename = 'meritve.csv'): void {
  const csv = measuresToCsv(measures);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Glasovni parser slovenskih meritev ─────────────────────

const SLO_UNITS: Array<{ re: RegExp; cmPerUnit: number }> = [
  { re: /\b(mm|milimetri|milimetra|milimetrov)\b/, cmPerUnit: 0.1 },
  { re: /\b(cm|centimeter|centimetra|centimetri|centimetrov)\b/, cmPerUnit: 1 },
  { re: /\b(m|meter|metra|metri|metrovi|metrovi|metrov)\b/, cmPerUnit: 100 },
];

const SLO_NUM_WORDS: Record<string, number> = {
  nic: 0, ena: 1, en: 1, eden: 1, dva: 2, dve: 2, tri: 3, stiri: 4,
  pet: 5, sest: 6, sedem: 7, osem: 8, devet: 9, deset: 10,
  enajst: 11, dvanajst: 12, trinajst: 13, stirinajst: 14, petnajst: 15,
  sestnajst: 16, sedemnajst: 17, osemnajst: 18, devetnajst: 19, dvajset: 20,
  trideset: 30, stirideset: 40, petdeset: 50, sestdeset: 60,
  sedemdeset: 70, osemdeset: 80, devetdeset: 90,
  sto: 100, dvesto: 200, tristo: 300, stiristo: 400, petsto: 500,
  seststo: 600, sedemsto: 700, osemsto: 800, devetsto: 900, tisoc: 1000,
};

/** "triinpetdeset" → 53, "dvaintrideset" → 32, … */
function parseCompoundSlovenianNumber(word: string): number | null {
  const m = word.match(/^(ena|en|dva|dve|tri|stiri|pet|sest|sedem|osem|devet)in(dvajset|trideset|stirideset|petdeset|sestdeset|sedemdeset|osemdeset|devetdeset)$/);
  if (!m) return null;
  const units: Record<string, number> = { ena: 1, en: 1, dva: 2, dve: 2, tri: 3, stiri: 4, pet: 5, sest: 6, sedem: 7, osem: 8, devet: 9 };
  const tens: Record<string, number> = { dvajset: 20, trideset: 30, stirideset: 40, petdeset: 50, sestdeset: 60, sedemdeset: 70, osemdeset: 80, devetdeset: 90 };
  return (units[m[1]] ?? 0) + (tens[m[2]] ?? 0);
}

export interface ParsedMeasure {
  cm: number;
  note: string;
}

/**
 * Razume slovensko izgovorjeno meritev:
 *  "dva metra petdeset" → 250 cm · "320 centimetrov" → 320 cm
 *  "trideset pet" → 350 cm (govorna oblika) · "2,5 m" → 250 cm
 * Vrne null, če v besedilu ni prepoznavne vrednosti.
 */
export function parseSloMeasure(input: string): ParsedMeasure | null {
  const text = input
    .toLowerCase()
    .replace(/[.,;!?]/g, (c) => (c === ',' || c === '.' ? c : ' '))
    .replace(/č/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .trim();
  if (!text) return null;

  // 1) Zberi številke (cifre ali besedne)
  const tokens = text.split(/\s+/);
  const nums: number[] = [];
  let unitCm: number | null = null;

  for (const raw of tokens) {
    const t = raw.replace(/[^a-z0-9,.\-]/g, '');
    if (!t) continue;

    // enota?
    for (const u of SLO_UNITS) {
      if (u.re.test(t)) {
        if (unitCm === null) unitCm = u.cmPerUnit;
      }
    }

    // cifra (tudi decimalna)
    const numMatch = t.match(/^(\d+)(?:[.,](\d{1,2}))?$/);
    if (numMatch) {
      const whole = parseInt(numMatch[1], 10);
      const frac = numMatch[2] ? parseInt(numMatch[2], 10) / Math.pow(10, numMatch[2].length) : 0;
      nums.push(whole + frac);
      continue;
    }

    // sestavljena beseda (triinpetdeset)
    const compound = parseCompoundSlovenianNumber(t);
    if (compound !== null) {
      nums.push(compound);
      continue;
    }

    // besedna številka (brez šumnikov — prevedeno zgoraj)
    const wordNum = SLO_NUM_WORDS[t];
    if (wordNum !== undefined) {
      nums.push(wordNum);
    }
  }

  if (nums.length === 0) return null;

  // 2) Interpretacija
  let cm: number;
  if (unitCm !== null) {
    const base = nums[0];
    // "dvesto petdeset" (cm) → 250; "dva metra petdeset" → 2 + 50/100 m
    if (nums.length === 2 && unitCm === 100) {
      cm = base * 100 + (nums[1] < 100 ? nums[1] : 0);
    } else if (nums.length === 2 && nums[0] >= 100) {
      cm = base + nums[1];
    } else {
      cm = base * unitCm;
    }
  } else {
    if (nums.length === 1) {
      cm = nums[0]; // privzeto cm
    } else if (nums.length === 2) {
      // "tri petdeset" (govorno 3,50 m) ali "dvesto petdeset"
      cm = nums[0] >= 100 ? nums[0] + nums[1] : nums[0] * 100 + nums[1];
    } else {
      cm = nums.slice(0, 3).reduce((s, n) => s + n, 0);
    }
  }

  cm = Math.round(cm * 10) / 10;
  if (!Number.isFinite(cm) || cm < 1 || cm > 50_000) return null;

  return { cm, note: text };
}

// ─── Preslikava meritev → polja kalkulatorja ────────────────

/**
 * Iz izmerjenih vrednosti (dolžine, površine, laser, glas) zgradi
 * predpolnitve za kalkulator izbrane dejavnosti. Uporabi najdaljši
 * in drugo najdaljšo merjeno dolžino ter največjo površino.
 */
export function buildPrefillFromMeasures(
  craft: string,
  measures: PhotoMeasure[],
): Partial<CraftInputs> {
  const lens = measures
    .filter(
      (m) =>
        (m.kind === 'length' || m.kind === 'laser' || m.kind === 'voice') &&
        m.value !== null &&
        m.value >= 20, // pod 20 cm so detajli (držala, ročaji…)
    )
    .map((m) => m.value as number)
    .sort((a, b) => b - a);

  const areas = measures
    .filter((m) => m.kind === 'area' && m.value !== null && m.value >= 0.2)
    .map((m) => m.value as number)
    .sort((a, b) => b - a);

  const toM = (cm: number) => Math.round((cm / 100) * 100) / 100;
  const L1 = lens[0] !== undefined ? toM(lens[0]) : undefined;
  const L2 = lens[1] !== undefined ? toM(lens[1]) : undefined;
  const A1 = areas[0];

  switch (craft) {
    case 'ograje':
      return L1 !== undefined ? { length: L1 } : {};
    case 'stopnice':
      return L1 !== undefined ? { railingLength: L1, railingNeeded: true } : {};
    case 'keramika':
      return {
        ...(L1 !== undefined ? { floorLength: L1 } : {}),
        ...(L2 !== undefined ? { floorWidth: L2 } : {}),
      };
    case 'wpc-terasa':
      return {
        ...(L1 !== undefined ? { deckLength: L1 } : {}),
        ...(L2 !== undefined ? { deckWidth: L2 } : {}),
      };
    case 'nadstreški':
      return {
        ...(L1 !== undefined ? { canopyWidth: L1 } : {}),
        ...(L2 !== undefined ? { canopyDepth: L2 } : {}),
      };
    case 'okna-vrata':
      return A1 !== undefined ? { windowSize: A1 } : {};
    case 'fasada':
      return L1 !== undefined ? { facadeHeight: L1 } : {};
    default:
      return {};
  }
}
