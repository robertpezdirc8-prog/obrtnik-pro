// ─── Vizualizer: deterministična menjava ograj, vzorcev in barv ──
// Čisto skriptno, brez AI. Tehnika (iz raziskave, research/task10):
//  1. Štirikotnik (quad) na fotki = območje prenove (homografija iz 4 točk).
//  2. Vzorec (palice, lamele, pikete, mreža, steklo, deke, ploščice) se
//     nariše na pomočni canvas v ravninski teksturi z gostoto v cm.
//  3. Tekstura se perspektivno pravilno preslika v štirikotnik:
//     mreža N×N celic, vsaka v 2 trikotnika z afinsko preslikavo
//     (homografija reši artefakte 2-trikotniške nafine).
//  4. Senčenje: vzorec × izvorna fotka (multiply) ohranja sence scene +
//     kontaktna sence na dnu (tehnika barvnih vizualizerjev).
//  5. Prelakiranje ('barva'): piksli znotraj štirikotnika = izbrana barva
//     × normalizirana svetlost izvorne fotke → realistična menjava barve
//     obstoječe ograje/fasade z ohranjenimi senci.

import { applyH, orderQuad, solveHomography } from './homography';
import { drawQuadDimensions } from './annotate';
import type { CraftCategory } from './camera-types';
import type { CraftInputs } from './types';
import { getTextureImage, getTextureById } from './viz-textures';

// ─── Katalog vzorcev ─────────────────────────────────────────

export type VizPattern =
  | 'panel'        // polna plošča (privacy panel)
  | 'vertikalne'   // vertikalne palice (iron/alu)
  | 'horizontalne' // horizontalne lamele
  | 'lamele45'     // nagnjene lamele 45° (lamelni zaslon)
  | 'vozlik'       // diagonalna križna mreža (vozlik/trellis)
  | 'piketna'      // piketna ograja
  | 'mreza'        // varnostna mreža (3D mreža)
  | 'steklo'       // stekleni sistemi
  | 'terasa'       // WPC deke
  | 'ploscice'     // keramične ploščice
  | 'barva';       // samo prelakiranje (menjava barve)

export interface VizStyleInfo {
  id: VizPattern;
  label: string;
  hint: string;
  /** Za katere dejavnosti je vzorec smiselen (UI prioriteta). */
  crafts: CraftCategory[];
}

export const VIZ_STYLES: VizStyleInfo[] = [
  { id: 'vertikalne', label: 'Vertikalne palice', hint: 'Klasična alu/inox ograja z navpičnimi palicami', crafts: ['ograje', 'stopnice', 'okna-vrata'] },
  { id: 'panel', label: 'Polna plošča', hint: 'Zaprt panel — zasebnost (alete/perforirana pločevina)', crafts: ['ograje', 'fasada', 'okna-vrata'] },
  { id: 'horizontalne', label: 'Horizontalne lamele', hint: 'Vodoravne ali navpične lamele — fasadna obloga ali ograja', crafts: ['ograje', 'wpc-terasa', 'fasada'] },
  { id: 'lamele45', label: 'Lamelni zaslon 45°', hint: 'Nagnjene lamele — zaslon za zasebnost in senčenje', crafts: ['ograje', 'fasada', 'okna-vrata'] },
  { id: 'vozlik', label: 'Vozlik (križna mreža)', hint: 'Diagonalno križana mreža — klasična vozlik ograja ali nadstrešek', crafts: ['ograje', 'nadstreški', 'fasada'] },
  { id: 'piketna', label: 'Piketna ograja', hint: 'Klasična piketna ograja z ostrimi vrhovi', crafts: ['ograje'] },
  { id: 'mreza', label: 'Varnostna mreža', hint: 'Zvarena mreža 3D — varnostne ograje', crafts: ['ograje'] },
  { id: 'steklo', label: 'Stekleni sistemi', hint: 'Kaljeno steklo z prosojnostjo in odboji', crafts: ['ograje', 'wpc-terasa', 'stopnice'] },
  { id: 'terasa', label: 'WPC deke', hint: 'Teraske deske s fugami in lisico lesa', crafts: ['wpc-terasa', 'stopnice'] },
  { id: 'ploscice', label: 'Keramične ploščice', hint: 'Mreža ploščic s fugami (30×60, 60×60 …)', crafts: ['keramika'] },
  { id: 'barva', label: 'Samo barva (prelakiraj)', hint: 'Obstoječi objekt ostane, spremeni se barva', crafts: ['ograje', 'fasada', 'okna-vrata', 'wpc-terasa', 'nadstreški'] },
];

// ─── Barvne palete ───────────────────────────────────────────

export type VizColorGroup = 'ral' | 'wpc' | 'keramika' | 'fasada';

export interface VizColor {
  id: string;
  label: string;
  hex: string;
  group: VizColorGroup;
}

export const VIZ_COLORS: VizColor[] = [
  // RAL Classic — povšarsko barvanje aluminija (7016 in 9005 najbolj popularna)
  { id: 'ral-7016', label: 'RAL 7016 antracit', hex: '#383E42', group: 'ral' },
  { id: 'ral-9005', label: 'RAL 9005 črna', hex: '#121214', group: 'ral' },
  { id: 'ral-9006', label: 'RAL 9006 aluminij', hex: '#A5A8A6', group: 'ral' },
  { id: 'ral-7035', label: 'RAL 7035 svetlo siva', hex: '#C5C7C4', group: 'ral' },
  { id: 'ral-6005', label: 'RAL 6005 mahovo zelena', hex: '#114232', group: 'ral' },
  { id: 'ral-3005', label: 'RAL 3005 vinsko rdeča', hex: '#59191F', group: 'ral' },
  { id: 'ral-5010', label: 'RAL 5010 modra', hex: '#004F7C', group: 'ral' },
  { id: 'ral-8017', label: 'RAL 8017 rjava', hex: '#442F29', group: 'ral' },
  { id: 'ral-1015', label: 'RAL 1015 slonokoščena', hex: '#E6D2B5', group: 'ral' },
  { id: 'ral-9010', label: 'RAL 9010 čista bela', hex: '#F1EDE1', group: 'ral' },
  // WPC dekorji
  { id: 'wpc-tikovina', label: 'WPC tikovina', hex: '#8A6A48', group: 'wpc' },
  { id: 'wpc-svetli-les', label: 'WPC svetli les', hex: '#B99B72', group: 'wpc' },
  { id: 'wpc-oreh', label: 'WPC oreh', hex: '#5D4433', group: 'wpc' },
  { id: 'wpc-siva', label: 'WPC siva', hex: '#8E908E', group: 'wpc' },
  { id: 'wpc-antracit', label: 'WPC antracit', hex: '#3F4145', group: 'wpc' },
  // Keramika
  { id: 'ker-bela', label: 'Keramika bela mat', hex: '#E8E6E0', group: 'keramika' },
  { id: 'ker-siva', label: 'Keramika kamnita siva', hex: '#9D9C98', group: 'keramika' },
  { id: 'ker-antracit', label: 'Keramika antracit', hex: '#3C3E40', group: 'keramika' },
  { id: 'ker-bez', label: 'Keramika bež', hex: '#D8C9AC', group: 'keramika' },
  // Fasada
  { id: 'fas-bela', label: 'Fasada bela', hex: '#EDEAE2', group: 'fasada' },
  { id: 'fas-bez', label: 'Fasada bež', hex: '#DCCFB4', group: 'fasada' },
  { id: 'fas-oker', label: 'Fasada oker', hex: '#C9A96A', group: 'fasada' },
  { id: 'fas-siva', label: 'Fasada svetlo siva', hex: '#B9B9B4', group: 'fasada' },
  { id: 'fas-antracit', label: 'Fasada antracit', hex: '#46484B', group: 'fasada' },
  { id: 'fas-terakota', label: 'Fasada terakota', hex: '#B0684A', group: 'fasada' },
];

export const VIZ_GROUP_LABELS: Record<VizColorGroup, string> = {
  ral: 'RAL (kovina)',
  wpc: 'WPC dekorji',
  keramika: 'Keramika',
  fasada: 'Fasada',
};

/** Katere palete ponudimo za dani vzorec (izbirno glede na dejavnost). */
export function colorGroupsForPattern(p: VizPattern, craft?: CraftCategory): VizColorGroup[] {
  switch (p) {
    case 'terasa': return ['wpc'];
    case 'ploscice': return ['keramika'];
    case 'barva': return ['ral', 'fasada', 'wpc', 'keramika'];
    case 'steklo': return ['ral'];
    // Fasadna obloga: kovina (RAL) ali WPC dekorji — kalkulator ponuja
    // WPC (52 €/m²), les in pločevino, vizualizer naj obe možnosti pokaže.
    case 'horizontalne':
    case 'lamele45':
    case 'panel':
    case 'vozlik':
      return craft === 'fasada' ? ['ral', 'wpc'] : ['ral'];
    default: return ['ral'];
  }
}

/** Privzet vzorec za dejavnost (ko uporabnik prije iz analize). */
export function defaultPatternForCraft(craft: CraftCategory): VizPattern {
  switch (craft) {
    case 'keramika': return 'ploscice';
    case 'wpc-terasa': return 'terasa';
    case 'fasada': return 'barva';
    case 'stopnice': return 'terasa';
    case 'okna-vrata': return 'panel';
    case 'nadstreški': return 'barva';
    default: return 'vertikalne';
  }
}

/** Privzeta barva za paleto (prva). */
export function defaultColorForPattern(p: VizPattern): VizColor {
  const groups = colorGroupsForPattern(p);
  const first = VIZ_COLORS.find((c) => c.group === groups[0]);
  return first ?? VIZ_COLORS[0];
}

// ─── Parametri vzorca (cm na ravnini) ────────────────────────

export interface VizParams {
  /** razmak med palicami / lamelami / žicami v cm */
  spacingCm: number;
  /** širina palice / lamele / deke v cm */
  elementCm: number;
  /** velikost ploščice v cm (stranica) */
  tileCm: number;
  /** fuga med ploščicami v cm */
  jointCm: number;
  /** prosojnost stekla (0–1) */
  glassAlpha: number;
  /** realna širina štirikotnika v cm (določa gostoto vzorca) */
  quadWidthCm: number;
  /** fasadna obloga: navpična smer lamel (privzeto vodoravno) */
  oblogaVert?: boolean;
}

export const DEFAULT_VIZ_PARAMS: VizParams = {
  spacingCm: 11,
  elementCm: 1.8,
  tileCm: 60,
  jointCm: 0.3,
  glassAlpha: 0.35,
  quadWidthCm: 600,
  oblogaVert: false,
};

/** Kazalci za drsnike po vzorcu: [min, max, korak, oznaka]. */
export interface VizSliderSpec { key: 'spacingCm' | 'elementCm' | 'tileCm' | 'jointCm' | 'glassAlpha'; label: string; min: number; max: number; step: number }

export function slidersForPattern(p: VizPattern): VizSliderSpec[] {
  switch (p) {
    case 'vertikalne':
    case 'piketna':
      return [
        { key: 'spacingCm', label: 'Razmak palic', min: 5, max: 20, step: 0.5 },
        { key: 'elementCm', label: 'Debelina palice', min: 1, max: 6, step: 0.2 },
      ];
    case 'horizontalne':
      return [
        { key: 'elementCm', label: 'Višina lamele', min: 4, max: 20, step: 0.5 },
        { key: 'spacingCm', label: 'Reža med lamelami', min: 0.5, max: 8, step: 0.5 },
      ];
    case 'lamele45':
      return [
        { key: 'elementCm', label: 'Širina lamele', min: 2, max: 16, step: 0.5 },
        { key: 'spacingCm', label: 'Reža med lamelami', min: 1, max: 12, step: 0.5 },
      ];
    case 'vozlik':
      return [
        { key: 'spacingCm', label: 'Mreža vozlika', min: 8, max: 30, step: 1 },
        { key: 'elementCm', label: 'Debelina letve', min: 1.5, max: 8, step: 0.5 },
      ];
    case 'panel':
      return [{ key: 'spacingCm', label: 'Razmak stikov panelov', min: 60, max: 160, step: 5 }];
    case 'mreza':
      return [
        { key: 'spacingCm', label: 'Očesce mreže', min: 5, max: 20, step: 0.5 },
        { key: 'elementCm', label: 'Debelina žice', min: 0.3, max: 1.5, step: 0.1 },
      ];
    case 'terasa':
      return [
        { key: 'elementCm', label: 'Širina deke', min: 8, max: 30, step: 0.5 },
        { key: 'spacingCm', label: 'Fuga med dekami', min: 0.2, max: 1.5, step: 0.1 },
      ];
    case 'ploscice':
      return [
        { key: 'tileCm', label: 'Velikost ploščice', min: 15, max: 120, step: 5 },
        { key: 'jointCm', label: 'Fuga', min: 0.1, max: 1, step: 0.1 },
      ];
    case 'steklo':
      return [{ key: 'glassAlpha', label: 'Prosojnost stekla', min: 0.1, max: 0.7, step: 0.05 }];
    default:
      return [];
  }
}

// ─── Pomožne barvne funkcije (deterministične) ───────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(rgb: [number, number, number], f: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

/** Približna svetlost barve 0–255 (za avtomatske temne/svetle detajle). */
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// ─── Ravninska tekstura vzorca ───────────────────────────────

/**
 * Zrcalno tlakovanje teksture po canvasu (mirror tiling) — vsak
 * drugi tile je zrcaljen, zato so šivi med tili nevidni tudi na
 * ne-popolnoma seamless sliki (deterministična tehnika).
 */
function drawMirroredTexture(
  ctx: CanvasRenderingContext2D,
  tex: HTMLImageElement | HTMLCanvasElement,
  W: number,
  H: number,
  tilePx = 256,
): void {
  const tw = tilePx;
  const th = tilePx;
  for (let y = 0; y < H; y += th) {
    for (let x = 0; x < W; x += tw) {
      const flipX = (x / tw) % 2 === 1;
      const flipY = (y / th) % 2 === 1;
      ctx.save();
      ctx.translate(x + tw / 2, y + th / 2);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(tex, -tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
  }
}

/** Regija elementa vzorca (palica/deka/ploščica) za teksturo: matrika + pravokotnik. */
interface TexRegion {
  m: { a: number; b: number; c: number; d: number; e: number; f: number };
  r: [number, number, number, number];
}

/**
 * Tekstura materiala na elemente vzorca. BREZ regij: 'source-atop'
 * po celem canvasu (polne površine — panel). Z regijami: tekstura
 * samo v pravokotnikih elementov (palice, lamele, deke, ploščice) —
 * črno ozadje med elementi (sence) ostane nedotaknjeno.
 */
function applyTextureFill(
  ctx: CanvasRenderingContext2D,
  texture: HTMLImageElement | HTMLCanvasElement,
  rgb: [number, number, number],
  W: number,
  H: number,
  tintAlpha = 0.42,
  regions?: TexRegion[],
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  if (regions && regions.length > 0) {
    for (const rg of regions) {
      ctx.save();
      ctx.setTransform(rg.m.a, rg.m.b, rg.m.c, rg.m.d, rg.m.e, rg.m.f);
      ctx.beginPath();
      ctx.rect(rg.r[0], rg.r[1], rg.r[2], rg.r[3]);
      ctx.clip();
      drawMirroredTexture(ctx, texture, W, H, 256);
      // barvni pran: tekstura ohrani material, barva ga poveže z izbiro
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${tintAlpha})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  } else {
    drawMirroredTexture(ctx, texture, W, H, 256);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${tintAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/**
 * Nariše vzorec v ravnino (teksturni canvas). `pxPerCm` povezuje
 * realne cm-parametre s piksli teksture. Tekstura predstavlja celoten
 * štirikotnik (širina = quadWidthCm). Kadar je podana materialna
 * tekstura, se opačni deli vzorca prekrijejo z realnim materialom.
 */
export function buildPatternCanvas(
  pattern: VizPattern,
  colorHex: string,
  params: VizParams,
  texW: number,
  texH: number,
  texture?: HTMLImageElement | HTMLCanvasElement,
): HTMLCanvasElement {
  const tex = document.createElement('canvas');
  tex.width = Math.max(2, Math.round(texW));
  tex.height = Math.max(2, Math.round(texH));
  const ctx = tex.getContext('2d')!;
  const pxPerCm = tex.width / Math.max(1, params.quadWidthCm);
  const rgb = hexToRgb(colorHex);
  const W = tex.width;
  const H = tex.height;

  const baseFill = (f = 1) => {
    // f <= 0 = PROZORNO ozadje (reže med palicami/lamelami — skozi njih
    // se vidi scena na fotki). Prej je `shade(rgb, 0)` napolnil z ČRNO
    // (opakno!) — vse reže so bile črne → "animiran" videz vizualizerja.
    if (f <= 0) {
      ctx.clearRect(0, 0, W, H);
      return;
    }
    ctx.fillStyle = shade(rgb, f);
    ctx.fillRect(0, 0, W, H);
  };

  // Regije elementov za teksturo (palice, deke, ploščice …)
  const texRegions: TexRegion[] = [];
  const mark = (x: number, y: number, w: number, h: number) => {
    const m = ctx.getTransform();
    texRegions.push({ m: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }, r: [x, y, w, h] });
  };

  switch (pattern) {
    case 'panel': {
      baseFill(1);
      // Subtilen vertikalen gradient (streha svetli, dno temnejši)
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Stiki med paneli (določa spacingCm)
      const jointPx = params.spacingCm * pxPerCm;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      for (let x = jointPx; x < W; x += jointPx) ctx.fillRect(Math.round(x), 0, Math.max(1, Math.round(pxPerCm * 0.5)), H);
      // Vrhunski rob plošče
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(0, 0, W, Math.max(1, Math.round(pxPerCm)));
      break;
    }
    case 'vertikalne': {
      baseFill(0); // prozorno ozadje (vidi se scena skozi reže)
      const gap = Math.max(2, params.spacingCm * pxPerCm);
      const w = Math.max(1, params.elementCm * pxPerCm);
      for (let x = 0; x < W; x += gap + w) {
        // palica s cilindričnim sencenjem (svetel sredinski pas)
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, shade(rgb, 0.72));
        g.addColorStop(0.45, shade(rgb, 1.12));
        g.addColorStop(1, shade(rgb, 0.62));
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, w, H);
        mark(x, 0, w, H);
      }
      break;
    }
    case 'horizontalne': {
      // Fasadna obloga: vodoravne (privzeto) ALI navpične lamele
      // (params.oblogaVert) — enako senčenje, zasukano za 90°.
      if (params.oblogaVert) {
        baseFill(0);
        const gapV = Math.max(1.5, params.spacingCm * pxPerCm);
        const wV = Math.max(1, params.elementCm * pxPerCm);
        for (let x = 0; x < W; x += gapV + wV) {
          const g = ctx.createLinearGradient(x, 0, x + wV, 0);
          g.addColorStop(0, shade(rgb, 1.08));
          g.addColorStop(0.55, shade(rgb, 0.92));
          g.addColorStop(1, shade(rgb, 0.66));
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, wV, H);
          mark(x, 0, wV, H);
        }
        break;
      }
      baseFill(0);
      const gap = Math.max(1.5, params.spacingCm * pxPerCm);
      const h = Math.max(1, params.elementCm * pxPerCm);
      for (let y = 0; y < H; y += gap + h) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, shade(rgb, 1.08));
        g.addColorStop(0.55, shade(rgb, 0.92));
        g.addColorStop(1, shade(rgb, 0.66));
        ctx.fillStyle = g;
        ctx.fillRect(0, y, W, h);
        mark(0, y, W, h);
      }
      break;
    }
    case 'lamele45': {
      // Nagnjene lamele (lamelni zaslon): vzporedne palice pod 45°
      // s cilindričnim senčenjem pravokotno na lamele.
      // Pokritost: u = (x+y)/√2 ∈ [0, 0,71·(W+H)] za vsak piksel canvasa,
      // zato pasovi tečejo od 0 do 0,75·(W+H) — robovi vedno pokriti.
      baseFill(0);
      const gap = Math.max(2, params.spacingCm * pxPerCm);
      const w = Math.max(1.5, params.elementCm * pxPerCm);
      const span = (W + H) * 0.75 + w;
      ctx.save();
      ctx.rotate(Math.PI / 4);
      for (let x = 0; x < span; x += gap + w) {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, shade(rgb, 0.70));
        g.addColorStop(0.45, shade(rgb, 1.14));
        g.addColorStop(1, shade(rgb, 0.60));
        ctx.fillStyle = g;
        ctx.fillRect(x, -(W + H), w, 2 * (W + H));
        mark(x, -(W + H), w, 2 * (W + H));
      }
      ctx.restore();
      break;
    }
    case 'vozlik': {
      // Diagonalna križna mreža (vozlik/trellis): dve mreži diagonalnih
      // pasov (±45°) s cilindričnim senčenjem; vozlišča rahlo temnejša
      // (prekrivanje letvi). Pokritost pasov do 0,75·(W+H) — robovi pokriti.
      baseFill(0);
      const gap = Math.max(2, params.spacingCm * pxPerCm);
      const w = Math.max(1.5, params.elementCm * pxPerCm);
      const span = (W + H) * 0.75 + w;
      const drawDiagonals = (dir: 1 | -1, lighten: number) => {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(dir * Math.PI / 4);
        for (let x = -(W + H) / 2; x < span; x += gap + w) {
          const g = ctx.createLinearGradient(x, 0, x + w, 0);
          g.addColorStop(0, shade(rgb, 0.66 * lighten));
          g.addColorStop(0.45, shade(rgb, 1.1 * lighten));
          g.addColorStop(1, shade(rgb, 0.58 * lighten));
          ctx.fillStyle = g;
          ctx.fillRect(x, -(W + H), w, 2 * (W + H));
          if (dir === 1) mark(x, -(W + H), w, 2 * (W + H)); // tekstura samo na zgornji smeri
        }
        ctx.restore();
      };
      // spodnja diagonalna smer nekoliko temnejša (zasenčena letvica),
      // zgornja svetlejša → realističen preplet
      drawDiagonals(-1, 0.82);
      drawDiagonals(1, 1.0);
      break;
    }
    case 'piketna': {
      baseFill(0);
      const gap = Math.max(2, params.spacingCm * pxPerCm);
      const w = Math.max(1.5, params.elementCm * pxPerCm);
      const pointH = Math.min(H * 0.12, w * 2);
      const bodyTop = pointH;
      for (let x = 0; x < W; x += gap + w) {
        // oster vrh
        ctx.fillStyle = shade(rgb, 1.05);
        ctx.beginPath();
        ctx.moveTo(x, bodyTop);
        ctx.lineTo(x + w / 2, 0);
        ctx.lineTo(x + w, bodyTop);
        ctx.closePath();
        ctx.fill();
        // telo pikete s sencenjem
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, shade(rgb, 0.78));
        g.addColorStop(0.5, shade(rgb, 1.1));
        g.addColorStop(1, shade(rgb, 0.68));
        ctx.fillStyle = g;
        ctx.fillRect(x, bodyTop, w, H - bodyTop);
        mark(x, 0, w, H); // vrh + telo (tekstura zadelo samo piketo)
      }
      // dva vodoravna nosilca (tatice)
      const railH = Math.max(2, 3 * pxPerCm);
      ctx.fillStyle = shade(rgb, 0.9);
      ctx.fillRect(0, H * 0.28, W, railH);
      ctx.fillRect(0, H * 0.72 - railH, W, railH);
      break;
    }
    case 'mreza': {
      baseFill(0);
      const cell = Math.max(2, params.spacingCm * pxPerCm);
      const wire = Math.max(1, params.elementCm * pxPerCm);
      ctx.fillStyle = shade(rgb, 0.95);
      for (let x = 0; x <= W; x += cell) { ctx.fillRect(Math.round(x - wire / 2), 0, wire, H); mark(Math.round(x - wire / 2), 0, wire, H); }
      for (let y = 0; y <= H; y += cell) { ctx.fillRect(0, Math.round(y - wire / 2), W, wire); mark(0, Math.round(y - wire / 2), W, wire); }
      // svetlejši presek za plastiko
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let x = 0; x <= W; x += cell) ctx.fillRect(Math.round(x - wire / 2), 0, Math.max(1, wire * 0.35), H);
      break;
    }
    case 'steklo': {
      // Prosojno steklo: svetlo-modrik ton + diagonalni odboji
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(200, 220, 226, ${params.glassAlpha})`;
      ctx.fillRect(0, 0, W, H);
      // Diagonalni odbojni pasovi (deterministični)
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 4);
      const stripe = Math.max(6, W * 0.09);
      for (let x = -W; x < W; x += stripe * 2.6) {
        const g = ctx.createLinearGradient(x, 0, x + stripe, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${Math.min(0.5, params.glassAlpha + 0.12)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, -H, stripe, H * 2);
      }
      ctx.restore();
      // Okvir (rob)
      ctx.strokeStyle = shade(rgb, 0.8);
      ctx.lineWidth = Math.max(2, 2.5 * pxPerCm);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
      break;
    }
    case 'terasa': {
      baseFill(0);
      const plank = Math.max(2, params.elementCm * pxPerCm);
      const gapPx = Math.max(1, params.spacingCm * pxPerCm);
      const seedR = (n: number) => {
        const x = Math.sin(n * 127.1) * 43758.5453;
        return x - Math.floor(x);
      };
      let row = 0;
      for (let y = 0; y < H; y += plank + gapPx, row++) {
        // lisica lesa: vodoravne valovite linije (determinističen pseudo-naključni vzorec)
        const tone = 0.9 + seedR(row + 1) * 0.22;
        const g = ctx.createLinearGradient(0, y, 0, y + plank);
        g.addColorStop(0, shade(rgb, tone * 1.05));
        g.addColorStop(0.6, shade(rgb, tone));
        g.addColorStop(1, shade(rgb, tone * 0.82));
        ctx.fillStyle = g;
        ctx.fillRect(0, y, W, plank);
        mark(0, y, W, plank);
        // stružnice
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        const lines = 3;
        for (let i = 1; i <= lines; i++) {
          const ly = y + (plank * i) / (lines + 1);
          ctx.fillRect(0, Math.round(ly), W, 1);
        }
        // endne razpoke (kompenzacija) vsaka deka
        const seamX = Math.round(W * (0.28 + seedR(row + 7) * 0.44));
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(seamX, y, 1, plank);
      }
      break;
    }
    case 'ploscice': {
      const tile = Math.max(4, params.tileCm * pxPerCm);
      const joint = Math.max(1, params.jointCm * pxPerCm);
      ctx.fillStyle = shade(rgb, 0.55); // fuga
      ctx.fillRect(0, 0, W, H);
      const seedT = (n: number) => {
        const x = Math.sin(n * 311.7) * 125829.447;
        return x - Math.floor(x);
      };
      let idx = 0;
      for (let y = 0; y < H; y += tile + joint) {
        for (let x = 0; x < W; x += tile + joint, idx++) {
          const tone = 0.94 + seedT(idx + 1) * 0.10; // subtilen tonalni varing ploščic
          ctx.fillStyle = shade(rgb, tone);
          ctx.fillRect(x, y, tile, tile);
          mark(x, y, tile, tile);
          // rahel svetel rob (bevel)
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(x, y, tile, Math.max(1, tile * 0.04));
        }
      }
      break;
    }
    case 'barva':
    default:
      baseFill(1);
      break;
  }
  if (texture) applyTextureFill(ctx, texture, rgb, W, H, 0.42, texRegions.length > 0 ? texRegions : undefined);
  return tex;
}

// ─── Perspektivna preslikava teksture v štirikotnik ─────────

interface Px { x: number; y: number }

/** Razširi trikotnik od težišča za ~0,7 px — zapre šive med celicami. */
function expandTriangle(a: Px, b: Px, c: Px): [Px, Px, Px] {
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const grow = (p: Px): Px => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = 1 + 0.7 / len;
    return { x: cx + dx * k, y: cy + dy * k };
  };
  return [grow(a), grow(b), grow(c)];
}

/** Afinska preslikava: 3 izvorne → 3 ciljne točke. Vrne matriko [a,b,c,d,e,f] (s → d). */
function affineFrom3(s0: Px, s1: Px, s2: Px, d0: Px, d1: Px, d2: Px): number[] | null {
  // det(M), M vrstice = [s_i.x, s_i.y, 1]
  const detM = s0.x * (s1.y - s2.y) - s0.y * (s1.x - s2.x) + (s1.x * s2.y - s2.x * s1.y);
  if (Math.abs(detM) < 1e-9) return null;
  // Cramer za [a,b,e] (x-komponenta) in [c,d,f] (y-komponenta)
  const detA = d0.x * (s1.y - s2.y) - s0.y * (d1.x - d2.x) + (d1.x * s2.y - d2.x * s1.y);
  const detB = s0.x * (d1.x - d2.x) - d0.x * (s1.x - s2.x) + (s1.x * d2.x - d1.x * s2.x);
  const detE = s0.x * (s1.y * d2.x - s2.y * d1.x) - s0.y * (s1.x * d2.x - s2.x * d1.x) + d0.x * (s1.x * s2.y - s2.x * s1.y);
  const detC = d0.y * (s1.y - s2.y) - s0.y * (d1.y - d2.y) + (d1.y * s2.y - d2.y * s1.y);
  const detD = s0.x * (d1.y - d2.y) - d0.y * (s1.x - s2.x) + (s1.x * d2.y - d1.y * s2.x);
  const detF = s0.x * (s1.y * d2.y - s2.y * d1.y) - s0.y * (s1.x * d2.y - s2.x * d1.y) + d0.y * (s1.x * s2.y - s2.x * s1.y);
  const out = [detA / detM, detB / detM, detC / detM, detD / detM, detE / detM, detF / detM];
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

function drawTriangleTextured(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement,
  s: [Px, Px, Px],
  d: [Px, Px, Px],
): void {
  const m = affineFrom3(s[0], s[1], s[2], d[0], d[1], d[2]);
  if (!m) return;
  const [A, B, C] = expandTriangle(d[0], d[1], d[2]);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(tex, 0, 0);
  ctx.restore();
}

/** Privzeta realna širina štirikotnika po dejavnosti (cm). */
function defaultQuadWidthCm(craft: CraftCategory): number {
  switch (craft) {
    case 'keramika': return 400;
    case 'wpc-terasa': return 400;
    case 'fasada': return 800;
    case 'stopnice': return 120;
    case 'okna-vrata': return 200;
    case 'nadstreški': return 500;
    default: return 600; // ograje
  }
}

/**
 * Senčenje vzorca po pikslih: vzorec × normalizirana svetlost izvorne
 * fotke (lum/meanLum, omejeno 0,45–1,7). Vzorec ostane prekrit (opaken),
 * dobi pa sence in odboje scene — tehnika barvnih vizualizerjev.
 * Maska = inverzna homografija štirikotnika.
 */
function shadePatternPixels(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  quadPx: Px[],
  strength: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // Svetlost izvorne fotke (ločen canvas, enake mere)
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(img, 0, 0, W, H);
  const photo = tctx.getImageData(0, 0, W, H).data;

  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const Hm = solveHomography(quadPx, unit); // piksel → (u,v)
  if (!Hm) return;

  const xs = quadPx.map((p) => p.x);
  const ys = quadPx.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));

  const lumAt = (i: number) => 0.2126 * photo[i] + 0.7152 * photo[i + 1] + 0.0722 * photo[i + 2];

  // 1. prehod: povprečna svetlost fotke znotraj štirikotnika
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      sum += lumAt((y * W + x) * 4);
      count++;
    }
  }
  if (count === 0) return;
  const meanLum = sum / count;

  // 2. prehod: vzorec × (svetlost / povprečje)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      const factor = Math.max(0.45, Math.min(1.7, lumAt(i) / Math.max(6, meanLum)));
      const f = 1 - strength + strength * factor;
      data[i] = Math.max(0, Math.min(255, Math.round(data[i] * f)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] * f)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] * f)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Nariše vzorec na glavni canvas znotraj štirikotnika (v % slike):
 *  1. tekstura v ravnini → 2. homografija → 3. mreža trikotnikov →
 *  4. piksčno senčenje s svetlostjo fotke → 5. kontaktna sence.
 * `refCmPerPx` (opcijsko) kalibrira gostoto vzorca na realne cm.
 */
export function drawPatternOnQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  quadPct: [number, number][],
  pattern: VizPattern,
  colorHex: string,
  params: VizParams,
  craft: CraftCategory,
  texture?: HTMLImageElement | HTMLCanvasElement,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (W < 4 || H < 4 || quadPct.length !== 4) return;

  const quadPx = orderQuad(
    quadPct.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H })),
  );

  // Realna širina štirikotnika: kalibrirana (refCmPerPx) ali privzetek po dejavnosti
  const topPx = Math.hypot(quadPx[1].x - quadPx[0].x, quadPx[1].y - quadPx[0].y);
  const botPx = Math.hypot(quadPx[2].x - quadPx[3].x, quadPx[2].y - quadPx[3].y);
  const avgWpx = (topPx + botPx) / 2;
  const quadWCm = params.quadWidthCm > 20 ? params.quadWidthCm : defaultQuadWidthCm(craft);
  const pxPerCm = avgWpx / Math.max(30, quadWCm);

  // Višina teksture: srednja višina stranic × pxPerCm
  const leftPx = Math.hypot(quadPx[3].x - quadPx[0].x, quadPx[3].y - quadPx[0].y);
  const rightPx = Math.hypot(quadPx[2].x - quadPx[1].x, quadPx[2].y - quadPx[1].y);
  const quadHCm = ((leftPx + rightPx) / 2) / pxPerCm;

  // 1) Tekstura v ravnini (omejena ločljivost za hitrost)
  const texW = Math.min(720, Math.max(180, Math.round(avgWpx * 1.4)));
  const texH = Math.max(90, Math.round((texW * quadHCm) / Math.max(30, quadWCm)));
  const tex = buildPatternCanvas(pattern, colorHex, { ...params, quadWidthCm: quadWCm }, texW, texH, texture);

  // 2) Homografija: enotski kvadrat → štirikotnik (px)
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const Hm = solveHomography(unit, quadPx);
  if (!Hm) return;

  // 3) Mreža celic (adaptivna: 8–22)
  const n = Math.max(8, Math.min(22, Math.round(Math.min(W, H) / 34)));
  const path = new Path2D();
  path.moveTo(quadPx[0].x, quadPx[0].y);
  for (let i = 1; i < 4; i++) path.lineTo(quadPx[i].x, quadPx[i].y);
  path.closePath();

  ctx.save();
  ctx.clip(path);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      const v0 = j / n, v1 = (j + 1) / n;
      const d00 = applyH(Hm, u0, v0);
      const d10 = applyH(Hm, u1, v0);
      const d11 = applyH(Hm, u1, v1);
      const d01 = applyH(Hm, u0, v1);
      const s00 = { x: u0 * texW, y: v0 * texH };
      const s10 = { x: u1 * texW, y: v0 * texH };
      const s11 = { x: u1 * texW, y: v1 * texH };
      const s01 = { x: u0 * texW, y: v1 * texH };
      drawTriangleTextured(ctx, tex, [s00, s10, s11], [d00, d10, d11]);
      drawTriangleTextured(ctx, tex, [s00, s11, s01], [d00, d11, d01]);
    }
  }

  // 4) Senčenje: vzorec × normalizirana svetlost fotke (piksčno,
  //    prekrit vzorec z senci scene — brez prosojnosti)
  ctx.restore();
  shadePatternPixels(ctx, img, quadPx, 0.8);

  // 5) Kontaktna sence na dnu (ograva "utemelji" objekt)
  const bottomY = Math.max(quadPx[0].y, quadPx[1].y, quadPx[2].y, quadPx[3].y);
  const topY = Math.min(quadPx[0].y, quadPx[1].y, quadPx[2].y, quadPx[3].y);
  const qx0 = Math.min(quadPx[0].x, quadPx[1].x, quadPx[2].x, quadPx[3].x);
  const qx1 = Math.max(quadPx[0].x, quadPx[1].x, quadPx[2].x, quadPx[3].x);
  const gH = Math.min(H * 0.25, (bottomY - topY) * 0.55);
  if (gH > 4) {
    ctx.save();
    ctx.clip(path);
    const g = ctx.createLinearGradient(0, bottomY - gH, 0, bottomY);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(qx0, topY, qx1 - qx0, bottomY - topY);
    ctx.restore();
  }
}

// ─── Prelakiranje: menjava barve obstoječega objekta ─────────

/**
 * Pikslno prelakira območje štirikotnika: nova barva × normalizirana
 * svetlost izvorne fotke (multiply z ohranjenimi senci). Maska =
 * inverzna homografija (piksel → enotski kvadrat; znotraj = pobarvan).
 */
export function recolorQuadPixels(
  ctx: CanvasRenderingContext2D,
  quadPct: [number, number][],
  colorHex: string,
  strength = 0.92,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (W < 4 || H < 4 || quadPct.length !== 4) return;

  const quadPx = orderQuad(
    quadPct.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H })),
  );
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const Hm = solveHomography(quadPx, unit); // piksel → (u,v)
  if (!Hm) return;

  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // Meja štirikotnika
  const xs = quadPx.map((p) => p.x);
  const ys = quadPx.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));

  const [cr, cg, cb] = hexToRgb(colorHex);

  // 1. prehod: povprečna svetlost znotraj maske
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count++;
    }
  }
  if (count === 0) return;
  const meanLum = sum / count;

  // 2. prehod: barva × (svetlost / povprečje)
  const satBoost = 1.06; // subtilen dvig nasičenosti, da barva ne umre v sivi
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / Math.max(1, meanLum);
      const nr = Math.max(0, Math.min(255, cr * lum * satBoost));
      const ng = Math.max(0, Math.min(255, cg * lum * satBoost));
      const nb = Math.max(0, Math.min(255, cb * lum * satBoost));
      data[i] = Math.round(data[i] * (1 - strength) + nr * strength);
      data[i + 1] = Math.round(data[i + 1] * (1 - strength) + ng * strength);
      data[i + 2] = Math.round(data[i + 2] * (1 - strength) + nb * strength);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ─── Pametno lakiranje: recolor po barvni podobnosti (maska) ──
// Tehnika iz raziskave task17 (Capture One / RawTherapee CCM): maska
// po podobnosti barve z featherjem, recolor z ohranjeno svetlosti.
// Lakira SAMO materiale, ki barvno ustrezajo ciljni barvi (kovina
// ograje), ozadje/reže/prirodost ostanejo nedotaknjeni — čisto
// piksčna skripta, 0 AI.

export interface SmartRecolor {
  /** Ciljna barva (obstoječi material, ki ga menjavaš) v hex. */
  targetHex: string;
  /** Toleranca podobnosti 5–120 (razdalja barv, normalizirano 0–255). */
  tolerance: number;
}

/** Utežena RGB razdalja (redmean) normalizirana na 0–255. */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const d = Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
  return (d / 441.67) * 255;
}

/** Smoothstep — mehak prehod maske (feather brez trdih robov). */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Dominantna barva znotraj štirikotnika (deterministični histogram
 * 5 bitov/kanal): tipična barva materiala, ki ga uporabnik želi menjati.
 * Uporabna kot samodejna ciljna barva pametnega lakiranja.
 */
export function dominantColorInQuad(
  img: HTMLImageElement | HTMLCanvasElement,
  quadPct: [number, number][],
): string | null {
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (iw < 8 || ih < 8 || quadPct.length !== 4) return null;
  const scale = Math.min(1, 480 / Math.max(iw, ih));
  const W = Math.max(2, Math.round(iw * scale));
  const H = Math.max(2, Math.round(ih * scale));
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tctx) return null;
  tctx.drawImage(img, 0, 0, W, H);
  const data = tctx.getImageData(0, 0, W, H).data;

  const quadPx = orderQuad(quadPct.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H })));
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const Hm = solveHomography(quadPx, unit);
  if (!Hm) return null;

  const xs = quadPx.map((p) => p.x);
  const ys = quadPx.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));

  // histogram: 5 bitov/kanal → 32³ košar
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const b = bins.get(key);
      if (b) { b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; }
      else bins.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  if (!best || best.n < 12) return null;
  return `#${[best.r / best.n, best.g / best.n, best.b / best.n]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Pametno lakiranje: prelakira SAMO piksle znotraj štirikotnika, katerih
 * barva je podobna ciljni barvi obstoječega materiala (maska po podobnosti
 * s smoothstep featherjem). Nova barva × normalizirana svetlost izvorne
 * fotke → sence/odboji ohranjeni, ozadje za režami ostane nedotaknjeno.
 */
export function recolorQuadPixelsMasked(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  quadPct: [number, number][],
  colorHex: string,
  smart: SmartRecolor,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (W < 4 || H < 4 || quadPct.length !== 4) return;

  // Izvorna fotka (za svetlost) — če je ctx že fotka + plasti, svetlost
  // vseeno teče iz izvorne slike (pristne sence objekta)
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(img, 0, 0, W, H);
  const photo = tctx.getImageData(0, 0, W, H).data;

  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  const quadPx = orderQuad(
    quadPct.map(([x, y]) => ({ x: (x / 100) * W, y: (y / 100) * H })),
  );
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const Hm = solveHomography(quadPx, unit); // piksel → (u,v)
  if (!Hm) return;

  const xs = quadPx.map((p) => p.x);
  const ys = quadPx.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));

  const [tr, tg, tb] = hexToRgb(smart.targetHex);
  const tol = Math.max(5, Math.min(120, smart.tolerance));
  const [cr, cg, cb] = hexToRgb(colorHex);
  const satBoost = 1.06;
  const lumAt = (i: number) => 0.2126 * photo[i] + 0.7152 * photo[i + 1] + 0.0722 * photo[i + 2];

  // 1. prehod: povprečna svetlost MOČNO maskiranih pikslov (alpha ≥ 0,5)
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      const d = colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb);
      if (1 - d / tol < 0.5) continue;
      sum += lumAt(i);
      count++;
    }
  }
  if (count === 0) return;
  const meanLum = sum / count;

  // 2. prehod: mehka maska × recolor z ohranjeno svetlosti
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hm, x + 0.5, y + 0.5);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const i = (y * W + x) * 4;
      const d = colorDistance(data[i], data[i + 1], data[i + 2], tr, tg, tb);
      const alpha = smoothstep(1 - d / tol);
      if (alpha <= 0.004) continue;
      const factor = Math.max(0.45, Math.min(1.7, lumAt(i) / Math.max(6, meanLum)));
      const nr = Math.max(0, Math.min(255, cr * factor * satBoost));
      const ng = Math.max(0, Math.min(255, cg * factor * satBoost));
      const nb = Math.max(0, Math.min(255, cb * factor * satBoost));
      const k = alpha * 0.94;
      data[i] = Math.round(data[i] * (1 - k) + nr * k);
      data[i + 1] = Math.round(data[i + 1] * (1 - k) + ng * k);
      data[i + 2] = Math.round(data[i + 2] * (1 - k) + nb * k);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ─── Ocena dimenzij štirikotnika iz referenčnega objekta ────

export interface QuadDimsCm {
  topW: number;
  botW: number;
  leftH: number;
  rightH: number;
}

/**
 * Oceni realne dimenzije štirikotnika (cm) z merilom iz referenčnega
 * objekta (npr. vrata ≈ 200 cm): cmPerPx = assumedCm / višina okvirja.
 * Ocena velja, kadar sta referenca in štirikotnik približno v isti
 * ravnini (za vizualizer je to dovolj natančno za gostoto vzorca).
 */
export function estimateQuadDimsCm(
  quadPct: [number, number][],
  imgW: number,
  imgH: number,
  ref: { box: [number, number, number, number]; assumedCm: number },
): QuadDimsCm | null {
  if (quadPct.length !== 4 || imgW < 4 || imgH < 4) return null;
  const refHpx = (ref.box[3] / 100) * imgH;
  if (refHpx < 8) return null;
  const cmPerPx = ref.assumedCm / refHpx;
  const q = orderQuad(quadPct.map(([x, y]) => ({ x: (x / 100) * imgW, y: (y / 100) * imgH })));
  const dist = (a: Px, b: Px) => Math.hypot(b.x - a.x, b.y - a.y) * cmPerPx;
  return {
    topW: Math.round(dist(q[0], q[1])),
    botW: Math.round(dist(q[3], q[2])),
    leftH: Math.round(dist(q[0], q[3])),
    rightH: Math.round(dist(q[1], q[2])),
  };
}

/** Približna svetlost izvorne barve — za UI (svetle swatch-e dobijo temnejši rob). */
export function isLightColor(hex: string): boolean {
  return luminance(hexToRgb(hex)) > 160;
}

/**
 * Dimenzije štirikotnika, kadar referenčnega objekta ni: uporabnik
 * vpiše realno širino (cm), višina pa sledi razmerju strani fotke.
 * Deterministična geometrija (brez AI) — dovolj natančno za
 * prefill kalkulatorja in gostoto vzorca.
 */
export function quadDimsFromWidthCm(
  quadPct: [number, number][],
  imgW: number,
  imgH: number,
  widthCm: number,
): QuadDimsCm | null {
  if (quadPct.length !== 4 || imgW < 4 || imgH < 4 || widthCm < 30) return null;
  const q = orderQuad(quadPct.map(([x, y]) => ({ x: (x / 100) * imgW, y: (y / 100) * imgH })));
  const topPx = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
  const botPx = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
  const avgWpx = (topPx + botPx) / 2;
  if (avgWpx < 4) return null;
  const cmPerPx = widthCm / avgWpx;
  const leftPx = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
  const rightPx = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
  return {
    topW: Math.round(topPx * cmPerPx),
    botW: Math.round(botPx * cmPerPx),
    leftH: Math.round(leftPx * cmPerPx),
    rightH: Math.round(rightPx * cmPerPx),
  };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Preslikava ocenjenih dimenzij območja (cm) v vhode kalkulatorja
 * za dano dejavnost — zapre zanko "stranka vidi vizualizacijo →
 * obrtnik takoj dobi odmerek" (raziskava task13: jedro vrednosti
 * Hover Design Pro). Vrne samo polja, ki so iz geometrije izvedljiva.
 */
export function craftInputsFromQuad(
  craft: CraftCategory,
  dims: QuadDimsCm,
): Partial<CraftInputs> {
  const wM = r2((dims.topW + dims.botW) / 200); // povprečna širina v m
  const hM = r2((dims.leftH + dims.rightH) / 200); // povprečna višina v m
  const longM = r2(Math.max(wM, hM));
  const shortM = r2(Math.min(wM, hM));
  switch (craft) {
    case 'ograje':
      return { length: wM, height: hM };
    case 'stopnice':
      // širina odprtja/ograje na stopnicah
      return wM > 0.3 ? { railingLength: wM, railingNeeded: true } : {};
    case 'keramika':
      return { floorLength: longM, floorWidth: shortM };
    case 'wpc-terasa':
      return { deckLength: longM, deckWidth: shortM };
    case 'okna-vrata':
      return wM > 0.2 && hM > 0.2 ? { windowSize: r2(wM * hM) } : {};
    case 'nadstreški':
      return { canopyWidth: wM, canopyDepth: hM };
    case 'fasada':
      return { facadePerimeter: wM, facadeHeight: hM };
    default:
      return {};
  }
}

// ─── Plasti: več območij prenove na isti fotografiji ─────────
// (raziskava task11: realna scena ima več odsekov — čelna ograja,
// vrata, stranski del; vsak lahko dobi svoj vzorec/barvo)

export interface VizLayer {
  id: string;
  label: string;
  /** 4 oglišča v % slike */
  quad: [number, number][];
  pattern: VizPattern;
  colorId: string;
  /** Barva iz fotke (eyedropper) — preglasi paletni colorId. */
  customHex?: string;
  /** Materialna tekstura (katalog viz-textures) — opačni deli vzorca. */
  textureId?: string;
  /** Pametno lakiranje (samo vzorec 'barva'): maska po barvni podobnosti. */
  smartRecolor?: SmartRecolor;
  params: VizParams;
}

/** Efektivna barva plasti: custom iz fotke, sicer katalog. */
export function resolveLayerColor(l: VizLayer): VizColor {
  if (l.customHex) {
    return { id: l.colorId, label: 'Iz fotke', hex: l.customHex, group: 'ral' };
  }
  return VIZ_COLORS.find((c) => c.id === l.colorId) ?? VIZ_COLORS[0];
}

/** Privzeti štirikotniki za nova območja (razporejeni po fotki). */
const LAYER_QUAD_PRESETS: [number, number][][] = [
  [[12, 46], [88, 46], [88, 88], [12, 88]],
  [[10, 6], [62, 6], [62, 40], [10, 40]],
  [[68, 10], [94, 10], [94, 42], [68, 42]],
  [[14, 44], [46, 44], [46, 68], [14, 68]],
];

export function defaultQuadForLayer(index: number): [number, number][] {
  const i = Math.max(0, Math.min(LAYER_QUAD_PRESETS.length - 1, index));
  return LAYER_QUAD_PRESETS[i].map(([x, y]) => [x, y] as [number, number]);
}

/** Nova plast s privzetim vzorcem/barvo za dejavnost. */
export function makeLayer(id: string, index: number, craft: CraftCategory): VizLayer {
  const pattern = defaultPatternForCraft(craft);
  return {
    id,
    label: `Območje ${index + 1}`,
    quad: defaultQuadForLayer(index),
    pattern,
    colorId: defaultColorForPattern(pattern).id,
    params: { ...DEFAULT_VIZ_PARAMS },
  };
}

/** Nariše vse plasti zaporedno (fotka mora biti že narisana na ctx). */
export function drawLayersOnQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  layers: VizLayer[],
  craft: CraftCategory,
): void {
  for (const l of layers) {
    const hex = resolveLayerColor(l).hex;
    const texture = getTextureImage(l.textureId) ?? undefined;
    try {
      if (l.pattern === 'barva' && l.smartRecolor) {
        recolorQuadPixelsMasked(ctx, img, l.quad, hex, l.smartRecolor);
      } else if (l.pattern === 'barva') recolorQuadPixels(ctx, l.quad, hex);
      else drawPatternOnQuad(ctx, img, l.quad, l.pattern, hex, l.params, craft, texture);
    } catch {
      /* posamezna plast ne sme ustaviti upodobitve */
    }
  }
}

// ─── Predstavni list opcij (2×N mreža variant za stranko) ────

export interface SheetVariant {
  pattern: VizPattern;
  colorId: string;
  /** Barva iz fotke (eyedropper) — če je nastavljena, preglosi colorId. */
  customHex?: string;
  /** Materialna tekstura (katalog viz-textures). */
  textureId?: string;
  /** Pametno lakiranje (maska po barvni podobnosti) aktivne plasti. */
  smartRecolor?: SmartRecolor;
}

interface SheetOpts {
  title: string;
  subtitle: string;
  footer: string;
  /** Razsežnostne črte (mere) na vsaki celici. */
  showDimensions?: boolean;
}

/**
 * Zgradi "predstavni list" — ista fotka z istimi območji, vsaka celica
 * z drugo kombinacijo vzorca/barve na aktivni plasti (ostale plasti
 * ostanejo). 2 stolpca, oznake + zavihki "OPCIJA n". Deterministični
 * canvas kompozit (0 AI) — standardna predstavitev opcij stranki.
 */
export function buildOptionsSheet(
  img: HTMLImageElement | HTMLCanvasElement,
  layers: VizLayer[],
  activeLayerId: string,
  variants: SheetVariant[],
  craft: CraftCategory,
  opts: SheetOpts,
): HTMLCanvasElement | null {
  const imgW = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const imgH = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (imgW < 8 || imgH < 8 || variants.length === 0) return null;

  const margin = 24;
  const gap = 20;
  const labelH = 42;
  const headerH = 96;
  const footerH = 34;

  // Velikost celice: ohrani razmerje fotke, omeji višino
  let cellW = 620;
  let cellH = Math.round((cellW * imgH) / imgW);
  if (cellH > 480) {
    cellH = 480;
    cellW = Math.max(280, Math.round((cellH * imgW) / imgH));
  }
  if (cellH < 220) {
    cellH = 220;
    cellW = Math.max(280, Math.round((cellH * imgW) / imgH));
  }

  const cols = 2;
  const rows = Math.ceil(variants.length / cols);
  const sheetW = cols * cellW + (cols + 1) * margin;
  const sheetH = headerH + rows * (cellH + gap) + footerH + gap;

  const sheet = document.createElement('canvas');
  sheet.width = sheetW;
  sheet.height = sheetH;
  const ctx = sheet.getContext('2d')!;

  // Ozadje + glava
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, sheetW, sheetH);
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, sheetW, headerH);
  ctx.fillStyle = '#fafafa';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(opts.title, margin, 42);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(opts.subtitle.slice(0, 90), margin, 70);
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Obrtnik Pro · skriptni predogled', sheetW - margin, 42);
  ctx.textAlign = 'left';

  // Celice z variantami
  variants.forEach((v, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = margin + col * (cellW + gap);
    const y = headerH + gap + row * (cellH + gap);

    // "Po" slika celice: vse plasti, aktivna z varianto
    const cell = document.createElement('canvas');
    cell.width = cellW;
    cell.height = cellH;
    const cctx = cell.getContext('2d')!;
    cctx.drawImage(img, 0, 0, cellW, cellH);
    const cellLayers = layers.map((l) =>
      l.id === activeLayerId
        ? { ...l, pattern: v.pattern, colorId: v.colorId, customHex: v.customHex, textureId: v.textureId, smartRecolor: v.smartRecolor }
        : l,
    );
    drawLayersOnQuad(cctx, img, cellLayers, craft);

    // Mere direktno na sliki (raziskava task14: Hover measurement PDF)
    if (opts.showDimensions) {
      for (const l of cellLayers) {
        const d = quadDimsFromWidthCm(l.quad, cellW, cellH, l.params.quadWidthCm);
        if (!d) continue;
        const q = orderQuad(l.quad.map(([x, y]) => ({ x: (x / 100) * cellW, y: (y / 100) * cellH })));
        try {
          drawQuadDimensions(cctx, q, d);
        } catch {
          /* anotacija ne sme ustaviti lista */
        }
      }
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(cell, x, y, cellW, cellH);
    ctx.restore();

    // Oznaka na dnu celice
    const grad = ctx.createLinearGradient(0, y + cellH - labelH - 14, 0, y + cellH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.66)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + cellH - labelH - 14, cellW, labelH + 14);

    const color: VizColor = v.customHex
      ? { id: v.colorId, label: 'Iz fotke', hex: v.customHex, group: 'ral' }
      : VIZ_COLORS.find((c) => c.id === v.colorId) ?? VIZ_COLORS[0];
    const style = VIZ_STYLES.find((s) => s.id === v.pattern);
    const texLabel = v.textureId ? getTextureById(v.textureId)?.label : null;
    ctx.fillStyle = color.hex;
    ctx.fillRect(x + 10, y + cellH - labelH + 2, 22, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.strokeRect(x + 10.5, y + cellH - labelH + 2.5, 21, 21);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(`${idx + 1} · ${style?.label ?? v.pattern}${texLabel ? ` · ${texLabel}` : ''}${v.smartRecolor ? ' · selekcija' : ''}`, x + 42, y + cellH - 16);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(color.label, x + 42, y + cellH - 33);
  });

  // Noga
  ctx.fillStyle = '#71717a';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(opts.footer, margin, sheetH - gap + 8);

  return sheet;
}
