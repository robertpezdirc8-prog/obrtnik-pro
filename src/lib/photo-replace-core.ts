// ─── Fotomenjava brez AI: deterministično jedro (FOTOZAMENJAVA) ──
// Cilj: na PRAVI fotki stranke zamenjaj staro ograjo z novo, sestavljeno
// iz PRAVIH materialnih tekstur — čista klasična obdelava slik, 0 AI,
// 0 generativnih modelov, 0 plačljivih API-jev, 0 omrežja, 0 canvasa.
//
// Cevovod (vse čiste funkcije, deterministične za enake vhode):
//  1. Maske (Uint8 mreža 0/255) — ročni čopič + samodejni predlog.
//  2. Samodejni predlog maske stare ograje — hevristika (nasičenost +
//     svetlost + vodoravni tek) z VEČINSKIM filtrom; NIKOLI ne trdi,
//     da je popolna — note vedno zahteva ročni pregled.
//  3. Klasično odstranjevanje (inpainting) — linearna interpolacija med
//     mejnimi piksli / kloniranje mejne vrstice; pri > 18 % pokritosti
//     ali manjkajoči mejimo NE izmišljuje ozadja ('manual-required' / 'partial').
//  4. Perspektivna postavitev novih elementov — homografija iz
//     homography.ts (meje elementov se računajo LINEARNO v cm-ravnini).
//  5. Okluzije (plasti) + svetlobno ujemanje obroča okoli štirikotnika.
//  6. Metapodatki različice + FNV-1a hash + iskrenost izvoza.
//
// NOVO ograjo IZRIŠE obstoječi renderer viz.ts (drawLayersOnQuad) —
// to jedro ga ne duplicira; to jedro skrbi za vse PRED in PO izrisu.

import { applyH, calibratePlane, orderQuad, solveHomography } from './homography';
import { pctToPx } from './measure-geometry';

// ─── Osnovni tipi ────────────────────────────────────────────

/** Strukturno kompatibilno z DOM ImageData — testabilno v bunu brez canvasa. */
export interface ImgData { width: number; height: number; data: Uint8ClampedArray }
export interface XY { x: number; y: number }
/** Štirikotnik v slikovnih pikslih (oglisča tl/tr/br/bl). */
export interface QuadPx { tl: XY; tr: XY; br: XY; bl: XY }

export const PHOTO_REPLACE_SCRIPT_VERSION = '1.0.0';
export const EXPORT_LABEL = 'VIZUALIZACIJA ZA PREDSTAVITEV — ni potrjen proizvodni načrt in ni dokaz barvne identičnosti na zaslonu.';

const MAX_PIXELS = 100_000_000; // varovala pomnilnika (100 Mpx)

// ─── Notranje pomagalke (validacija) ─────────────────────────

function assertImg(img: ImgData, name = 'slika'): void {
  if (!img || typeof img !== 'object') throw new Error(`${name}: manjka.`);
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) {
    throw new Error(`${name}: neveljavne dimenzije (${img.width}×${img.height}) — potrebne so pozitivne cele številke.`);
  }
  if (img.width * img.height > MAX_PIXELS) throw new Error(`${name}: prevelika (> ${MAX_PIXELS} pikslov).`);
  if (!(img.data instanceof Uint8ClampedArray) || img.data.length !== img.width * img.height * 4) {
    throw new Error(`${name}: podatkovni buffer se ne ujema z dimenzijami (pričakovano RGBA).`);
  }
}

function assertQuad(quad: QuadPx): void {
  if (!quad || typeof quad !== 'object') throw new Error('Štirikotnik manjka.');
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  if (pts.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('Štirikotnik ima neveljavna (ne-finite) oglisča.');
  }
}

function assertMask(m: MaskGrid): void {
  if (!m || typeof m !== 'object') throw new Error('Maska manjka.');
  if (!Number.isInteger(m.w) || !Number.isInteger(m.h) || m.w < 1 || m.h < 1) {
    throw new Error('Maska ima neveljavne dimenzije.');
  }
  if (!(m.data instanceof Uint8Array) || m.data.length !== m.w * m.h) {
    throw new Error('Maska: podatkovni buffer se ne ujema z dimenzijami.');
  }
}

/** Nova kopija slike (original OSTANE nespremenjen — zahteva issue). */
function cloneImg(img: ImgData): ImgData {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function px(img: ImgData, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

// ─── 2a Maske (Uint8 mreža, 0 ali 255) ───────────────────────

export interface MaskGrid { w: number; h: number; data: Uint8Array }

export function createMask(w: number, h: number): MaskGrid {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error('Neveljavne dimenzije maske — potrebne so pozitivne cele številke.');
  }
  if (w * h > MAX_PIXELS) throw new Error(`Maska je prevelika (> ${MAX_PIXELS} pikslov).`);
  return { w, h, data: new Uint8Array(w * h) };
}

/** Pobarvaj pravokotnik (vključno z mejama, orezano na masko). */
export function paintMaskRect(m: MaskGrid, x0: number, y0: number, x1: number, y1: number, value: 0 | 255): void {
  assertMask(m);
  if (value !== 0 && value !== 255) throw new Error('Vrednost maske mora biti 0 ali 255.');
  if (![x0, y0, x1, y1].every(Number.isFinite)) throw new Error('Neveljavne koordinate pravokotnika (ne-finite).');
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  const xa = Math.max(0, Math.ceil(x0));
  const xb = Math.min(m.w - 1, Math.floor(x1));
  const ya = Math.max(0, Math.ceil(y0));
  const yb = Math.min(m.h - 1, Math.floor(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) m.data[y * m.w + x] = value;
  }
}

/** Pobarvaj krog (piksli z (x−cx)²+(y−cy)² ≤ r²). */
export function paintMaskCircle(m: MaskGrid, cx: number, cy: number, r: number, value: 0 | 255): void {
  assertMask(m);
  if (value !== 0 && value !== 255) throw new Error('Vrednost maske mora biti 0 ali 255.');
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r < 0) {
    throw new Error('Neveljavni parametri kroga (cx, cy, r ≥ 0).');
  }
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(m.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(m.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) m.data[y * m.w + x] = value;
    }
  }
}

/** Delež pikslov z vrednostjo 255 (0..1). */
export function maskCoverage(m: MaskGrid): number {
  assertMask(m);
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] === 255) n++;
  return n / (m.w * m.h);
}

/**
 * Za UI izris: zlije pravokotne run-e maske v VODORAVNE trake
 * (deterministično: enak obseg x + sosednji vrstici = isti trak).
 * Vsak trak je poligon v % slike: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].
 */
export function maskToPctPolys(m: MaskGrid): number[][][] {
  assertMask(m);
  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const open = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const closeBand = (b: { x0: number; y0: number; x1: number; y1: number }) => rects.push(b);
  for (let y = 0; y < m.h; y++) {
    const seen = new Set<string>();
    let x = 0;
    while (x < m.w) {
      if (m.data[y * m.w + x] === 255) {
        const rx0 = x;
        while (x < m.w && m.data[y * m.w + x] === 255) x++;
        const rx1 = x - 1;
        const key = `${rx0}:${rx1}`;
        seen.add(key);
        const ob = open.get(key);
        if (ob && ob.y1 === y - 1) ob.y1 = y;
        else {
          if (ob) { closeBand(ob); open.delete(key); }
          open.set(key, { x0: rx0, y0: y, x1: rx1, y1: y });
        }
      } else x++;
    }
    for (const [key, ob] of open) {
      if (!seen.has(key)) { closeBand(ob); open.delete(key); }
    }
  }
  for (const ob of open.values()) closeBand(ob);
  rects.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0 || a.x1 - b.x1 || a.y1 - b.y1);
  const pct = (v: number, d: number) => Math.round((v / d) * 100000) / 1000;
  return rects.map((r) => [
    [pct(r.x0, m.w), pct(r.y0, m.h)],
    [pct(r.x1 + 1, m.w), pct(r.y0, m.h)],
    [pct(r.x1 + 1, m.w), pct(r.y1 + 1, m.h)],
    [pct(r.x0, m.w), pct(r.y1 + 1, m.h)],
  ]);
}

/** Vrže napako, če maska in slika nimata enakih dimenzij. */
export function checkMaskDims(m: MaskGrid, img: ImgData): void {
  assertMask(m);
  assertImg(img);
  if (m.w !== img.width || m.h !== img.height) throw new Error('Maska in slika se ne ujemata.');
}

// ─── 2b Samodejni predlog maske stare ograje (hevristika) ────

export interface AutoMaskResult { mask: MaskGrid; confidence: number; note: string }

/**
 * Deterministična hevristika: znotraj štirikotnika pripada stari ograji
 * piksel, če je malo nasičen (sat < satMax) IN temen (luma < lumMax,
 * BT.601) — plus strukturni glas: vodoravni tek istorazrednih pikslov
 * ≥ edgeBias. Nato 2 prehoda 3×3 večinskega filtra (čisti osamljene).
 * confidence = delež pobarvanega znotraj štirikotnika; note VEDNO
 * zahteva ročni pregled (heuristika nikoli ni popolna).
 */
export function autoSuggestFenceMask(
  img: ImgData,
  quad: QuadPx,
  opts?: { satMax?: number; lumMax?: number; edgeBias?: number },
): AutoMaskResult {
  assertImg(img);
  assertQuad(quad);
  const satMax = opts?.satMax ?? 0.35;
  const lumMax = opts?.lumMax ?? 0.72;
  const edgeBias = Math.round(opts?.edgeBias ?? 6);
  if (!(satMax > 0 && satMax <= 1)) throw new Error('Neveljaven prag satMax — mora biti v (0, 1].');
  if (!(lumMax > 0 && lumMax <= 1)) throw new Error('Neveljaven prag lumMax — mora biti v (0, 1].');
  if (!(edgeBias >= 1)) throw new Error('Neveljaven prag edgeBias — mora biti ≥ 1.');

  const { width: w, height: h, data } = img;
  const pts = orderQuad([quad.tl, quad.tr, quad.br, quad.bl]);

  // notranjost štirikotnika: scanline po središčih pikslov (x+0.5, y+0.5)
  const inside = new Uint8Array(w * h);
  let insideCount = 0;
  const ys = pts.map((p) => p.y);
  const yMin = Math.max(0, Math.ceil(Math.min(...ys) - 0.5));
  const yMax = Math.min(h - 1, Math.floor(Math.max(...ys) - 0.5));
  for (let y = yMin; y <= yMax; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) { inside[y * w + x] = 1; insideCount++; }
    }
  }

  // razred "stara ograja": malo nasičena IN temnejša od povprečja scene
  const cls = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lum = (r * 299 + g * 587 + b * 114) / 1000 / 255; // BT.601, 0..1
      cls[i] = sat < satMax && lum < lumMax ? 1 : 0;
    }
  }

  // strukturni glas: vodoravni tek istih razredov ≥ edgeBias
  const vote = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && inside[y * w + x] === 1 && cls[y * w + x] === 1;
      if (on) { run++; continue; }
      if (run >= edgeBias) for (let xx = x - run; xx < x; xx++) vote[y * w + xx] = 1;
      run = 0;
    }
  }

  const cand = createMask(w, h);
  for (let i = 0; i < w * h; i++) if (inside[i] === 1 && cls[i] === 1 && vote[i] === 1) cand.data[i] = 255;

  // 2 prehoda 3×3 večinskega filtra (≥ 5 od 9) — čisti osamljene piksle
  const majority = (src: MaskGrid): MaskGrid => {
    const out = createMask(src.w, src.h);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= src.h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= src.w) continue;
            if (src.data[yy * src.w + xx] === 255) cnt++;
          }
        }
        out.data[y * src.w + x] = cnt >= 5 ? 255 : 0;
      }
    }
    return out;
  };
  const mask = majority(majority(cand));

  let painted = 0;
  for (let i = 0; i < w * h; i++) if (inside[i] === 1 && mask.data[i] === 255) painted++;
  const confidence = insideCount > 0 ? painted / insideCount : 0;
  return {
    mask,
    confidence,
    note: `Pokrito ${Math.round(confidence * 100)} % štirikotnika — preveri in popravi s čopičem.`,
  };
}

// ─── 2c Klasično odstranjevanje (inpainting) ─────────────────

export type InpaintStatus = 'ok' | 'partial' | 'manual-required';

export interface InpaintResult {
  image: ImgData;            // NOVA kopija (original ostane nespremenjen)
  status: InpaintStatus;
  coverage: number;          // delež maske v celotni sliki
  repairedPx: number;
  manualHint: string | null; // slovensko, ko status != 'ok'
}

/**
 * Deterministično polnjenje maske: po izbrani smeri linearna
 * interpolacija med najbližjima ne-maskiranima mejnima piksloma
 * (dolgi run-i > 24 px se KLONIRajo iz mejne vrstice/stolpca z
 * determinističnim odmikom (runIdx % 3) proti bandingu), plus 1-px
 * pereso na mejah (povprečje s sosednjim mejnim pikslom).
 * Iskrenost: > maxBlobCoverage → 'manual-required' (slika nespremenjena,
 * ozadja NE izmišljujemo); run ob robu slike (manjka meja) → 'partial'.
 */
export function inpaintMask(
  img: ImgData,
  mask: MaskGrid,
  opts?: { maxBlobCoverage?: number; direction?: 'vertical' | 'horizontal' | 'auto' },
): InpaintResult {
  assertImg(img);
  checkMaskDims(mask, img);
  const threshold = opts?.maxBlobCoverage ?? 0.18;
  if (!(threshold > 0 && threshold <= 1)) throw new Error('Neveljaven prag maxBlobCoverage — mora biti v (0, 1].');
  const dirOpt = opts?.direction ?? 'auto';
  if (dirOpt !== 'vertical' && dirOpt !== 'horizontal' && dirOpt !== 'auto') {
    throw new Error('Neveljavna smer polnjenja — dovoljeno: "vertical", "horizontal", "auto".');
  }

  const { width: w, height: h } = img;
  const isM = (x: number, y: number): boolean => mask.data[y * w + x] > 0;
  let masked = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 0) masked++;
  const coverage = masked / (w * h);

  const out = cloneImg(img); // original ostane nespremenjen

  if (coverage > threshold) {
    return {
      image: out,
      status: 'manual-required',
      coverage,
      repairedPx: 0,
      manualHint: `Za staro ograjo je skritih > ${Math.round(threshold * 100)} % slike — samodejna obnova ni zanesljiva. Označi manjkajoče ozadje ročno (kloniranje) ali posnami fotko z drugega zavihka.`,
    };
  }
  if (masked === 0) return { image: out, status: 'ok', coverage: 0, repairedPx: 0, manualHint: null };

  // smer: dolgi/tanki vz dolžni run-i → navpično polnjenje
  // (povprečna dolžina vz dolžnih runov ≥ 1,3 × povprečja vodoravnih)
  let dir: 'vertical' | 'horizontal' = 'horizontal';
  if (dirOpt === 'auto') {
    let vRuns = 0;
    let hRuns = 0;
    for (let x = 0; x < w; x++) {
      let inRun = false;
      for (let y = 0; y < h; y++) { const m = isM(x, y); if (m && !inRun) vRuns++; inRun = m; }
    }
    for (let y = 0; y < h; y++) {
      let inRun = false;
      for (let x = 0; x < w; x++) { const m = isM(x, y); if (m && !inRun) hRuns++; inRun = m; }
    }
    const avgV = vRuns > 0 ? masked / vRuns : 0;
    const avgH = hRuns > 0 ? masked / hRuns : 0;
    dir = vRuns > 0 && (hRuns === 0 || avgV >= 1.3 * avgH) ? 'vertical' : 'horizontal';
  } else dir = dirOpt;

  const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
    [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  const avg2 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
    [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
    ];
  const setPx = (x: number, y: number, c: [number, number, number]) => {
    const i = (y * w + x) * 4;
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2];
  };

  let partial = false;
  let repaired = 0;
  let runIdx = 0; // globalni števec runov (determinističen odmik kloniranja)

  const fillRun = (
    fixed: number,               // stolpec (vertical) ali vrstica (horizontal)
    s0: number, s1: number,      // začetek/konec runa vzdolž osi polnjenja
    vertical: boolean,
  ): void => {
    const L = s1 - s0 + 1;
    const hasA = s0 > 0;                       // meja na začetku (zgoraj / levo)
    const hasB = vertical ? s1 < h - 1 : s1 < w - 1; // meja na koncu (spodaj / desno)
    if (!hasA && !hasB) { partial = true; return; } // run čez celo os — ne polnimo
    if (!hasA || !hasB) partial = true;  // manjka ena meja → iskreno 'partial'
    const A = hasA
      ? (vertical ? px(img, fixed, s0 - 1) : px(img, s0 - 1, fixed))
      : null;
    const B = hasB
      ? (vertical ? px(img, fixed, s1 + 1) : px(img, s1 + 1, fixed))
      : null;
    const vals: [number, number, number][] = new Array(L);
    if (A && B && L > 24) {
      // kloniranje iz mejne VRSTICE (zgornje) / mejnega STOLPCA ( levega):
      // nadaljuje teksturo ozadja namesto ravnega gradienta; odmik
      // (runIdx % 3) px vz dolž meje preprečuje vidno banding
      const off = runIdx % 3;
      if (vertical) {
        const yb = s0 - 1;
        const sx = Math.min(w - 1, Math.max(0, fixed + off));
        for (let k = 0; k < L; k++) vals[k] = px(img, sx, yb);
      } else {
        const xb = s0 - 1;
        const sy = Math.min(h - 1, Math.max(0, fixed + off));
        for (let k = 0; k < L; k++) vals[k] = px(img, xb, sy);
      }
    } else if (A && B) {
      for (let k = 0; k < L; k++) vals[k] = mix(A, B, (k + 1) / (L + 1));
    } else if (A) {
      for (let k = 0; k < L; k++) vals[k] = [A[0], A[1], A[2]]; // klon navzdol/desno
    } else {
      for (let k = 0; k < L; k++) vals[k] = [B![0], B![1], B![2]]; // klon navzgor/levo
    }
    // 1-px peresa: prvi/zadnji polnjeni piksel povprečimo z mejnim
    if (A) vals[0] = avg2(vals[0], A);
    if (B) vals[L - 1] = avg2(vals[L - 1], B);
    for (let k = 0; k < L; k++) {
      if (vertical) setPx(fixed, s0 + k, vals[k]);
      else setPx(s0 + k, fixed, vals[k]);
    }
    repaired += L;
    runIdx++;
  };

  if (dir === 'vertical') {
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (isM(x, y)) {
          const y0 = y;
          while (y < h && isM(x, y)) y++;
          fillRun(x, y0, y - 1, true);
        } else y++;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (isM(x, y)) {
          const x0 = x;
          while (x < w && isM(x, y)) x++;
          fillRun(y, x0, x - 1, false);
        } else x++;
      }
    }
  }

  return {
    image: out,
    status: partial ? 'partial' : 'ok',
    coverage,
    repairedPx: repaired,
    manualHint: partial
      ? 'Obnova se opira na rob fotke (manjka ena meja za interpolacijo) — rezultat preveri in po potrebi popravi s čopičem.'
      : null,
  };
}

// ─── 2d Perspektivna postavitev novih elementov (homografija) ─

export interface PlankLayout { index: number; quad: QuadPx; isPost: boolean }

/**
 * Kanonična NOTRANJA širina ravnine (cm), uporabljena samo, kadar prava
 * širina NI znana. Homografija je pri polnih širinah deska invariantna na
 * izbiro te številke (H' = H ∘ A, dokaz v tests/verify/plank-layout-width.ts),
 * zato izris desk in rež ne more odvisati od nje. Pravilo 13 (FAZA-8 §6):
 * ta številka je implementacijski detajl in NIKOLI ne sme biti izpisana
 * kot mera — zunaj tega modula je edini izhod "širina ni znana".
 */
export const CANONICAL_PLANE_WIDTH_CM = 100;

export interface LayoutResult {
  planks: PlankLayout[];
  gaps: QuadPx[];
  posts: PlankLayout[];
  /** cm/px vzdolž zgornjega in spodnjega roba. `null` = širina ravnine ni
   *  izmerjena (pravilo 13: brez mera ni številke, tudi ne nulice). */
  scaleCmPerPxAtQuad: { top: number | null; bottom: number | null };
  /** Ali je širina ravnine (wCm) dejanska izmera? `false` = izris je brez
   *  stebrov in brez cm/px — geometrija je potrjena, merilo na osi širine ne. */
  widthKnown: boolean;
  warnings: string[];
}

/**
 * Postavitev elementov v PRAVI perspektivi: meje elementov se računajo
 * LINEARNO v cm-ravnini (kalibrirani štirikotnik iz homography.ts) in
 * preslikajo nazaj v piksle z INVERZNO homografijo. Enaki vhodi →
 * identična postavitev (determinizem). Konvencija oblog je usklajena
 * z viz.ts: element k zavzame ravnino [k·(element+reža), k·(element+reža)+element].
 */
export function computePlankLayouts(args: {
  quadPct: [number, number][];        // 4 oglisča v % slike (tl,tr,br,bl po orderQuad)
  imgSize: { w: number; h: number };
  planeCm: { wCm: number | null; hCm: number };
  plankCm: number; gapCm: number;
  orientation: 'horizontal' | 'vertical';
  postCm: number;
  postEveryCm: number | null;         // null = brez vmesnih stebrov
}): LayoutResult {
  const { quadPct, imgSize, planeCm, plankCm, gapCm, orientation, postCm, postEveryCm } = args;
  if (!Array.isArray(quadPct) || quadPct.length !== 4 ||
    !quadPct.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    throw new Error('NEZADOSTNI PODATKI: štirikotnik mora imeti 4 točke [x, y] v % slike.');
  }
  if (!Number.isInteger(imgSize?.w) || !Number.isInteger(imgSize?.h) || imgSize.w < 1 || imgSize.h < 1) {
    throw new Error('NEZADOSTNI PODATKI: velikost slike mora biti par pozitivnih celih števil.');
  }
  const wGiven = planeCm?.wCm;
  const widthKnown = wGiven !== null && wGiven !== undefined;
  if (widthKnown && (!Number.isFinite(wGiven) || (wGiven as number) <= 0)) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine (wCm, hCm) morata biti pozitivni števili.');
  }
  if (!Number.isFinite(planeCm?.hCm) || planeCm.hCm <= 0) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine (wCm, hCm) morata biti pozitivni števili.');
  }
  if (!Number.isFinite(plankCm) || plankCm < 0.3) throw new Error('NEZADOSTNI PODATKI: debelina elementa (plankCm) mora biti ≥ 0,3 cm.');
  if (!Number.isFinite(gapCm) || gapCm < 0) throw new Error('NEZADOSTNI PODATKI: reža (gapCm) ne sme biti negativna.');
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error('NEZADOSTNI PODATKI: smer mora biti "horizontal" ali "vertical".');
  }
  // Brez znane širine je številko elementov določiti mogoče SAMO vodoravno
  // (takrat je prečna mera višina ravnine). Pravilo 11: izris potrebuje eno
  // samo dolžino — tu je to hCm. Za navpične deske bi bila tista dolžina wCm.
  if (!widthKnown && orientation !== 'horizontal') {
    throw new Error('NEZADOSTNI PODATKI: brez znane širine ravnine (wCm) je izris določen samo za vodoravne deske — število navpičnih elementov je odvisno od širine.');
  }
  if (!Number.isFinite(postCm) || postCm < 0) throw new Error('NEZADOSTNI PODATKI: širina stebra (postCm) ne sme biti negativna.');
  if (postCm > 0 && postCm < 0.5) throw new Error('NEZADOSTNI PODATKI: širina stebra pod 0,5 cm ni realna — preveri mere.');
  if (postEveryCm !== null && (!Number.isFinite(postEveryCm) || postEveryCm < 5)) {
    throw new Error('NEZADOSTNI PODATKI: razmak stebrov (postEveryCm) mora biti ≥ 5 cm ali null.');
  }
  const pitch = plankCm + gapCm;
  if (!(pitch > 0)) throw new Error('NEZADOSTNI PODATKI: element + reža morata biti > 0 cm.');

  // Kadar širina ni izmerjena, jo homografija dobi iz kanonične NOTRANJE
  // mere — izris polnih desk je na to izbiro nepremazen (dokaz: plank-layout-width).
  const wCm = widthKnown ? (wGiven as number) : CANONICAL_PLANE_WIDTH_CM;

  const size = { w: imgSize.w, h: imgSize.h };
  const quadPx = orderQuad(quadPct.map(([x, y]) => pctToPx({ x, y }, size)));
  const plane = calibratePlane(quadPct.map(([x, y]) => ({ x, y })), wCm, planeCm.hCm, size);
  if (!plane) throw new Error('NEZADOSTNI PODATKI: ravnine ni mogoče kalibrirati (degenerirana oglisča).');
  // INVERZNA homografija: ravnina (cm) → fotka (px). Natanko 4 točke
  // določijo homografijo, zato je to resnični inverz kalibracije.
  const planeQuad: XY[] = [
    { x: 0, y: 0 },
    { x: wCm, y: 0 },
    { x: wCm, y: planeCm.hCm },
    { x: 0, y: planeCm.hCm },
  ];
  const Hinv = solveHomography(planeQuad, quadPx);
  if (!Hinv) throw new Error('NEZADOSTNI PODATKI: ravnine ni mogoče kalibrirati (degenerirana oglisča).');

  const toPx = (x: number, y: number): XY => applyH(Hinv, x, y);
  const rectQuad = (x0: number, y0: number, x1: number, y1: number): QuadPx => ({
    tl: toPx(x0, y0), tr: toPx(x1, y0), br: toPx(x1, y1), bl: toPx(x0, y1),
  });

  // merilo (cm/px) na zgornji in spodnji stranici štirikotnika
  const dTop = Math.hypot(quadPx[1].x - quadPx[0].x, quadPx[1].y - quadPx[0].y);
  const dBottom = Math.hypot(quadPx[2].x - quadPx[3].x, quadPx[2].y - quadPx[3].y);
  if (dTop < 1e-9 || dBottom < 1e-9) throw new Error('NEZADOSTNI PODATKI: ravnine ni mogoče kalibrirati (degenerirana oglisča).');
  const scaleTop = widthKnown ? wCm / dTop : null;
  const scaleBottom = widthKnown ? wCm / dBottom : null;

  const warnings: string[] = [];
  if (scaleTop !== null && scaleBottom !== null) {
    const ratio = Math.max(scaleTop, scaleBottom) / Math.min(scaleTop, scaleBottom);
    if (ratio > 2.2) warnings.push('Močna perspektiva — preveri oglisča.');
  }

  // elementi: meje LINEARNO v cm-ravnini, št. elementov po dogovorjeni formuli
  const len = orientation === 'horizontal' ? planeCm.hCm : wCm;
  const n = Math.floor((len + gapCm) / pitch);
  const planks: PlankLayout[] = [];
  const gaps: QuadPx[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * pitch;
    const b = a + plankCm;
    planks.push({
      index: k,
      isPost: false,
      quad: orientation === 'horizontal' ? rectQuad(0, a, wCm, b) : rectQuad(a, 0, b, planeCm.hCm),
    });
    if (gapCm > 0 && k < n - 1) {
      const g0 = a + plankCm;
      const g1 = (k + 1) * pitch;
      gaps.push(orientation === 'horizontal' ? rectQuad(0, g0, wCm, g1) : rectQuad(g0, 0, g1, planeCm.hCm));
    }
  }
  if (n === 0) warnings.push('Ni elementov — preveri mere elementa in reže ter velikost ravnine.');
  if (n > 300) warnings.push(`Zelo veliko elementov (${n}) — preveri mere ali ravnino.`);

  // stebri: vedno NAVPIČNI traki na ravninskih x položajih (širina postCm)
  const posts: PlankLayout[] = [];
  if (postEveryCm !== null && postCm > 0) {
    if (!widthKnown) {
      warnings.push('Širina ravnine ni izmerjena — vmesni stebri niso izrisani (njihov položaj je odvisen od cm širine).');
    } else {
      for (let k = 0; k * postEveryCm + postCm <= wCm + 1e-9; k++) {
        const x0 = k * postEveryCm;
        posts.push({ index: k, isPost: true, quad: rectQuad(x0, 0, x0 + postCm, planeCm.hCm) });
      }
    }
  }

  // majhni elementi (< 4 px) — upodobitev ne bo zanesljiva
  const bboxMax = (q: QuadPx): number => {
    const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
    const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  let smallCount = 0;
  for (const el of [...planks, ...posts]) if (bboxMax(el.quad) < 4) smallCount++;
  if (smallCount > 0) warnings.push(`Nekateri elementi so v pikslih manjši od 4 px (${smallCount}) — preveri oglisča ali merilo.`);

  return { planks, gaps, posts, scaleCmPerPxAtQuad: { top: scaleTop, bottom: scaleBottom }, widthKnown, warnings };
}

// ─── 2e Okluzije (plasti) + svetlobno ujemanje ───────────────

export type ReplaceLayer =
  | { kind: 'background'; image: ImgData }            // fotka po odstranitvi stare ograje
  | { kind: 'fence'; render: 'viz-drawLayersOnQuad' } // NOVO ograjo izriše OBSTOJEČI renderer viz.ts
  | { kind: 'front'; image: ImgData; mask: MaskGrid } // originalni piksli pred ograjo (rastline, zid …)
  | { kind: 'shadow'; strength: number; side: 'top' | 'bottom' }; // deterministična stična senca

const LAYER_ORDER: Record<string, number> = { background: 0, fence: 1, shadow: 2, front: 3 };

/** Uredi plasti: background → fence → shadow → front. Neznana plast vrže napako. */
export function orderLayers(layers: ReplaceLayer[]): ReplaceLayer[] {
  if (!Array.isArray(layers)) throw new Error('Plasti morajo biti podane kot tabela.');
  for (const l of layers) {
    if (!l || typeof (l as { kind?: unknown }).kind !== 'string' || !((l as { kind: string }).kind in LAYER_ORDER)) {
      throw new Error(`Neznana plast: ${String((l as { kind?: unknown })?.kind)}.`);
    }
  }
  return [...layers].sort((a, b) => LAYER_ORDER[a.kind] - LAYER_ORDER[b.kind]);
}

/** Originalni piksli SAMO kjer je maska pobarvana — sicer prozorno (alpha 0). */
export function frontPixelsFrom(img: ImgData, frontMask: MaskGrid): ImgData {
  checkMaskDims(frontMask, img);
  const out: ImgData = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.width * img.height * 4) };
  for (let i = 0; i < img.width * img.height; i++) {
    if (frontMask.data[i] > 0) {
      out.data[i * 4] = img.data[i * 4];
      out.data[i * 4 + 1] = img.data[i * 4 + 1];
      out.data[i * 4 + 2] = img.data[i * 4 + 2];
      out.data[i * 4 + 3] = 255;
    }
  }
  return out;
}

/**
 * Svetlobno ujemanje: povprečna svetlost obroča okoli štirikotnika
 * (BT.601 luma, normalizirana) / 0,62 referenčna svetlost → clamp
 * 0,72..1,4 (isti razpon kot viz.ts ambient). sampleCount = št.
 * vzorčenih pikslov obroča (zunaj štirikotnika, znotraj ringPx).
 */
export function ambientLightFactor(img: ImgData, quad: QuadPx, ringPx: number): { factor: number; sampleCount: number } {
  assertImg(img);
  assertQuad(quad);
  if (!Number.isFinite(ringPx) || ringPx <= 0) throw new Error('Neveljaven radij obroča (ringPx) — mora biti > 0.');
  const pts = orderQuad([quad.tl, quad.tr, quad.br, quad.bl]);
  const { width: w, height: h, data } = img;
  const xsAll = pts.map((p) => p.x);
  const ysAll = pts.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xsAll) - ringPx));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xsAll) + ringPx));
  const y0 = Math.max(0, Math.floor(Math.min(...ysAll) - ringPx));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ysAll) + ringPx));

  const inside = (tx: number, ty: number): boolean => {
    let ins = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > ty) !== (b.y > ty) && tx < ((b.x - a.x) * (ty - a.y)) / (b.y - a.y) + a.x) ins = !ins;
    }
    return ins;
  };
  const distToSeg = (tx: number, ty: number, ax: number, ay: number, bx: number, by: number): number => {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = tx - ax;
    const wy = ty - ay;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
    return Math.hypot(wx - t * vx, wy - t * vy);
  };

  let sum = 0;
  let cnt = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (inside(cx, cy)) continue;
      let d = Infinity;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        d = Math.min(d, distToSeg(cx, cy, a.x, a.y, b.x, b.y));
      }
      if (d <= ringPx) {
        const i4 = (y * w + x) * 4;
        sum += (data[i4] * 299 + data[i4 + 1] * 587 + data[i4 + 2] * 114) / 1000 / 255;
        cnt++;
      }
    }
  }
  if (cnt === 0) return { factor: 1, sampleCount: 0 }; // brez vzorcev → nevtralno
  const factor = Math.max(0.72, Math.min(1.4, sum / cnt / 0.62));
  return { factor: Math.round(factor * 10000) / 10000, sampleCount: cnt };
}

/** Deterministična stična senca: 0,18·strength zgoraj / 0,10·strength spodaj (clamp 0..1). */
export function shadowEdgesFor(quad: QuadPx, strength: number): { topAlpha: number; bottomAlpha: number } {
  assertQuad(quad);
  if (!Number.isFinite(strength) || strength < 0) throw new Error('Neveljavna jakost sence (strength) — mora biti ≥ 0.');
  return { topAlpha: Math.min(1, 0.18 * strength), bottomAlpha: Math.min(1, 0.10 * strength) };
}

// ─── 2f Metapodatki različice + determinizem + izvoz ─────────

const FNV_OFFSET = BigInt('0xcbf29ce484222325'); // FNV-1a 64-bit offset basis
const FNV_PRIME = BigInt('0x100000001b3');       // FNV-1a 64-bit prime
const FNV_MASK = (BigInt(1) << BigInt(64)) - BigInt(1);

/** Deterministični FNV-1a 64-bit, hex 16 znakov (lastna implementacija, brez odvisnosti). */
export function fnv1aHash(bytes: Uint8Array): string {
  if (!bytes || typeof bytes.length !== 'number') throw new Error('fnv1aHash: vhod mora biti Uint8Array.');
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Hash maske: dimenzije + vsebina (FNV-1a). Sprememba piksla → drug hash. */
export function maskHash(m: MaskGrid): string {
  assertMask(m);
  const head = new TextEncoder().encode(`${m.w}x${m.h}:`);
  const bytes = new Uint8Array(head.length + m.data.length);
  bytes.set(head, 0);
  bytes.set(m.data, head.length);
  return fnv1aHash(bytes);
}

// kanonična serializacija štirikotnika (2 decimalni mesti → stabilen JSON/hash)
function quadSer(q: QuadPx): string {
  const parts = [q.tl.x, q.tl.y, q.tr.x, q.tr.y, q.br.x, q.br.y, q.bl.x, q.bl.y];
  if (parts.some((v) => !Number.isFinite(v))) throw new Error('NEZADOSTNI PODATKI: postavitev vsebuje neveljavne (ne-finite) koordinate.');
  return parts.map((v) => String(Math.round(v * 100) / 100)).join(',');
}

function layoutHash(layout: LayoutResult): string {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.planks) ||
    !Array.isArray(layout.gaps) || !Array.isArray(layout.posts)) {
    throw new Error('NEZADOSTNI PODATKI: postavitev (layout) manjka ali je neveljavna.');
  }
  const s = JSON.stringify({
    p: layout.planks.map((l) => `${l.index}:${l.isPost ? 1 : 0}:${quadSer(l.quad)}`),
    g: layout.gaps.map((q) => quadSer(q)),
    s: layout.posts.map((l) => `${l.index}:${quadSer(l.quad)}`),
  });
  return fnv1aHash(new TextEncoder().encode(s));
}

export interface ReplaceMetadata {
  scriptVersion: string;
  profileId: string;
  profileLabel: string;
  catalogSku: string | null;
  texture: { id: string; src: string | null; origin: AssetOriginRef; verification: AssetVerificationRef; realCm: number } | null;
  planeCm: { wCm: number | null; hCm: number };
  params: Record<string, number | string | boolean>;
  maskHash: string;
  layoutHash: string;
  imgSize: { w: number; h: number };
  inpaint: InpaintStatus;
  warnings: string[];
  exportLabel: string;
  createdAt: string; // podan od zunaj (determinizem: isti vhodi → isti JSON)
}

// tipa kot pri roksal-assets (struktorno, brez uvoza odvisnosti)
type AssetOriginRef = 'roksal-original' | 'real-photo' | 'user-upload' | 'standard-reference';
type AssetVerificationRef = 'verified' | 'unverified' | 'missing';

export interface ReplaceMetadataInput {
  profileId: string;
  profileLabel: string;
  catalogSku: string | null;
  texture: ReplaceMetadata['texture'];
  planeCm: { wCm: number | null; hCm: number };
  params: Record<string, number | string | boolean>;
  mask: MaskGrid;
  layout: LayoutResult;
  imgSize: { w: number; h: number };
  inpaint: InpaintStatus;
  warnings: string[];
  createdAt: string;
}

/**
 * Zgradi metapodatke različice. DETERMINIZEM: enaki vhodi (enak
 * createdAt) → identičen JSON. maskHash/layoutHash iz FNV-1a.
 */
export function buildReplaceMetadata(input: ReplaceMetadataInput): ReplaceMetadata {
  if (!input || typeof input !== 'object') throw new Error('buildReplaceMetadata: vhod manjka.');
  if (typeof input.profileId !== 'string' || input.profileId.trim().length === 0) throw new Error('NEZADOSTNI PODATKI: profileId je obvezen.');
  if (typeof input.profileLabel !== 'string' || input.profileLabel.trim().length === 0) throw new Error('NEZADOSTNI PODATKI: profileLabel je obvezen.');
  if (input.catalogSku !== null && (typeof input.catalogSku !== 'string' || input.catalogSku.length === 0)) {
    throw new Error('NEZADOSTNI PODATKI: catalogSku mora biti null ali neprazen niz (SKU se ne izmišljuje).');
  }
  if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) throw new Error('NEZADOSTNI PODATKI: createdAt je obvezen (podan od zunaj).');
  const wGivenMeta = input.planeCm?.wCm;
  const widthKnownMeta = wGivenMeta !== null && wGivenMeta !== undefined;
  if (widthKnownMeta && (!Number.isFinite(wGivenMeta) || (wGivenMeta as number) <= 0)) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine morata biti pozitivni števili (ali null, kadar širina ni izmerjena).');
  }
  if (!Number.isFinite(input.planeCm?.hCm) || input.planeCm.hCm <= 0) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine morata biti pozitivni števili (ali null, kadar širina ni izmerjena).');
  }
  // Pravilo 13: shranjena različica NE SME trditi, da pozna širino, če jo je
  // geometrija računala iz kanonične notranje mere — in obratno.
  if (input.layout && typeof input.layout === 'object'
    && typeof input.layout.widthKnown === 'boolean' && input.layout.widthKnown !== widthKnownMeta) {
    throw new Error(
      widthKnownMeta
        ? 'NESKLADJJE: metapodatki trdijo izmerjeno širino ravnine, postavitev pa je izračunana brez nje (kanonična notranja mera).'
        : 'NESKLADJJE: postavitev je izračunana iz izmerjene širine ravnine, metapodatki pa širine ne poznajo.',
    );
  }
  if (!Number.isInteger(input.imgSize?.w) || !Number.isInteger(input.imgSize?.h) || input.imgSize.w < 1 || input.imgSize.h < 1) {
    throw new Error('NEZADOSTNI PODATKI: velikost slike mora biti par pozitivnih celih števil.');
  }
  assertMask(input.mask);
  if (input.mask.w !== input.imgSize.w || input.mask.h !== input.imgSize.h) {
    throw new Error('Maska in slika se ne ujemata.');
  }
  if (input.inpaint !== 'ok' && input.inpaint !== 'partial' && input.inpaint !== 'manual-required') {
    throw new Error('NEZADOSTNI PODATKI: stanje inpaint mora biti "ok", "partial" ali "manual-required".');
  }
  if (!Array.isArray(input.warnings) || input.warnings.some((s) => typeof s !== 'string')) {
    throw new Error('NEZADOSTNI PODATKI: opozorila morajo biti tabela nizov.');
  }
  if (typeof input.params !== 'object' || input.params === null || Array.isArray(input.params)) {
    throw new Error('NEZADOSTNI PODATKI: parametri morajo biti objekt.');
  }
  if (input.texture !== null) {
    const t = input.texture;
    if (typeof t !== 'object' || typeof t.id !== 'string' || t.id.length === 0 ||
      (t.src !== null && typeof t.src !== 'string') ||
      (t.origin !== 'roksal-original' && t.origin !== 'real-photo' && t.origin !== 'user-upload' && t.origin !== 'standard-reference') ||
      (t.verification !== 'verified' && t.verification !== 'unverified' && t.verification !== 'missing') ||
      !Number.isFinite(t.realCm)) {
      throw new Error('NEZADOSTNI PODATKI: tekstura ni veljavna.');
    }
  }
  return {
    scriptVersion: PHOTO_REPLACE_SCRIPT_VERSION,
    profileId: input.profileId,
    profileLabel: input.profileLabel,
    catalogSku: input.catalogSku,
    texture: input.texture === null ? null : { ...input.texture },
    planeCm: { wCm: input.planeCm.wCm, hCm: input.planeCm.hCm },
    params: { ...input.params },
    maskHash: maskHash(input.mask),
    layoutHash: layoutHash(input.layout),
    imgSize: { w: input.imgSize.w, h: input.imgSize.h },
    inpaint: input.inpaint,
    warnings: [...input.warnings],
    exportLabel: EXPORT_LABEL,
    createdAt: input.createdAt,
  };
}

/**
 * Iskrenost izvoza: če gradivo manjka (canRender false ali ni teksture),
 * izvoz NI dovoljen z oznako "original" — razlog v slovenščini.
 */
export function canExportResult(meta: ReplaceMetadata, readiness: { canRender: boolean }): { allowed: boolean; reason: string | null } {
  if (!meta || typeof meta !== 'object') throw new Error('canExportResult: metapodatki manjkajo.');
  if (!readiness || typeof readiness.canRender !== 'boolean') throw new Error('canExportResult: readiness.canRender mora biti boolean.');
  if (!readiness.canRender) {
    return {
      allowed: false,
      reason: 'Izvoz ni dovoljen: za izbrani profil manjka original ROKSAL gradivo — vizualizacija z nadomestnim gradivom ne sme nositi oznake original.',
    };
  }
  if (!meta.texture || meta.texture.src === null) {
    return { allowed: false, reason: 'Izvoz ni dovoljen: materialna tekstura ni na voljo (original ROKSAL gradivo manjka).' };
  }
  return { allowed: true, reason: null };
}
