// ─── Izvoz pred/po primerjave iz fotomontaže — deterministično, 0 AI ──────
// Kandidat #2 iz raziskave Task 63 (docs/task63-podobni-programi.md):
// tržni dokaz PaperPlan — pred/po par je ključna prodajna funkcija vizualizacije
// (stranka vidi razliko TUDI izven aplikacije: e-pošta, tisk, ponudba).
// Hkrati izpolnjuje izvirno zahtevo issue #14 („primerjava pred/po … shranjevanje
// končnega prikaza"): do zdaj je primerjava obstajala samo kot drsnik na zaslonu.
//
// NAČELA (ista kot pri enojnem izvozu, foto-replace.tsx onExport):
//  - enoten vir resnice za žig: EXPORT_LABEL iz photo-replace-core (ne kopija);
//  - isti izvozni prehod iskrenosti: canExportResult pokliče KOMPONENTA (enak
//    prehod kot enojni izvoz — „original" brez gradiva ne sme nositi žiga);
//  - determinizem: mere so čista matematika, oznake so iz metapodatkov z ISO
//    datumom (createdAt.slice(0,10)) — NI toLocaleDateString (okoljsko odvisno,
//    poučena napaka Task 64); enaki vhodi → identična slika in ime datoteke;
//  - PRED = NESPREMENJEN original (delovna kopija ≤ 1280 px, originalCanvas)
//    — nikoli delovni canvas z inpaintingom/kloniranjem.

import type { ReplaceMetadata } from './photo-replace-core';
import { EXPORT_LABEL } from './photo-replace-core';

const MAX_PIXELS = 100_000_000; // varovalo pomnilnika (enako kot v photo-replace-core)

export interface CompareRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompareLayout {
  canvasW: number;
  canvasH: number;
  /** kamor gre PRED (nespremenjen original, levo) */
  before: CompareRect;
  /** kamor gre PO (kompozit fotomontaže, desno) */
  after: CompareRect;
  /** navpični ločilni trak med slikama */
  divider: CompareRect;
  /** zgornji trak z oznakama PRED / PO */
  topStrip: CompareRect;
  /** spodnji trak z žigom + metapodatki */
  bottomStrip: CompareRect;
}

export interface CompareOptions {
  /** odmik besedila od robov (privzeto 12, enako kot enojni izvoz) */
  pad?: number;
  /** širina ločilnega traku (privzeto 2) */
  dividerPx?: number;
  /** višina vrstice besedila (privzeto 17, enako kot enojni izvoz) */
  lineH?: number;
  /** velikost pisave (privzeto 13, enako kot enojni izvoz) */
  fontSize?: number;
  /** št. prelomljenih vrstic žiga — meri komponenta z wrapText (privzeto 2) */
  zigLineCount?: number;
}

function assertDim(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`NEZADOSTNI PODATKI: ${name} mora biti pozitivno celo število (prejeto: ${v}).`);
  }
}

/** Varovalo pomnilnika na POVŠINI (enaka semantika kot v photo-replace-core). */
function assertArea(w: number, h: number, name: string): void {
  if (w * h > MAX_PIXELS) throw new Error(`NEZADOSTNI PODATKI: ${name} presega varovalo pomnilnika (${MAX_PIXELS} px).`);
}

function assertOpt(v: number | undefined, name: string, min: number): void {
  if (v === undefined) return;
  if (!Number.isInteger(v) || v < min) {
    throw new Error(`NEZADOSTNI PODATKI: opcija ${name} mora biti celo število ≥ ${min} (prejeto: ${v}).`);
  }
}

/**
 * Čista matematika postavitve pred/po: sliki sta normirani na SKUPNO višino
 * (min obeh višin, razmerje strani ohranjeno z zaokrožanjem ± 1 px), PRED levo,
 * PO desno, med njima ločilni trak, nad njima oznaki, pod njima žig + podatki.
 * V praksi imata obe sliki enake mere (kompozit je izrisan čez delovno kopijo),
*  funkcija pa je odporna tudi na različne mere.
 */
export function computeCompareLayout(
  beforeW: number,
  beforeH: number,
  afterW: number,
  afterH: number,
  opts?: CompareOptions,
): CompareLayout {
  assertDim(beforeW, 'širina PRED');
  assertDim(beforeH, 'višina PRED');
  assertDim(afterW, 'širina PO');
  assertDim(afterH, 'višina PO');
  assertArea(beforeW, beforeH, 'PRED');
  assertArea(afterW, afterH, 'PO');
  const pad = opts?.pad ?? 12;
  const dividerPx = opts?.dividerPx ?? 2;
  const lineH = opts?.lineH ?? 17;
  const fontSize = opts?.fontSize ?? 13;
  const zigLines = opts?.zigLineCount ?? 2;
  assertOpt(pad, 'pad', 0);
  assertOpt(dividerPx, 'dividerPx', 0);
  assertOpt(lineH, 'lineH', 1);
  assertOpt(fontSize, 'fontSize', 1);
  assertOpt(zigLines, 'zigLineCount', 0);

  const commonH = Math.min(beforeH, afterH);
  const bW = Math.round((beforeW * commonH) / beforeH);
  const aW = Math.round((afterW * commonH) / afterH);

  const topH = pad + lineH + pad;
  const bottomH = pad * 2 + (zigLines + 1) * lineH + 6; // +1 vrstica za metapodatke (enako enojnemu izvozu)
  const canvasW = bW + dividerPx + aW;
  const canvasH = topH + commonH + bottomH;
  assertArea(canvasW, canvasH, 'izvožena slika pred/po'); // dve veliki sliki stran ob strani

  return {
    canvasW,
    canvasH,
    before: { x: 0, y: topH, w: bW, h: commonH },
    after: { x: bW + dividerPx, y: topH, w: aW, h: commonH },
    divider: { x: bW, y: 0, w: dividerPx, h: canvasH },
    topStrip: { x: 0, y: 0, w: canvasW, h: topH },
    bottomStrip: { x: 0, y: topH + commonH, w: canvasW, h: bottomH },
  };
}

export interface CompareLabels {
  /** oznaka leve slike */
  pred: string;
  /** oznaka desne slike */
  po: string;
  /** vrstica s kontekstom (ravnina, mere, datum ISO, različica skripte) */
  metaLine: string;
  /** žig — ENOTEN vir resnice: EXPORT_LABEL iz photo-replace-core */
  zig: string;
}

/**
 * Oznake iz metapodatkov različice — deterministične (ISO datum, ni lokalizacije).
 * Manjkajoče mere elementa/reže se IZPUSTIJO (iskreno — ne ugibamo); datum brez
 * ISO oblike → „neznan datum" (ne crash, iskrena oznaka).
 */
export function buildCompareLabels(meta: ReplaceMetadata): CompareLabels {
  if (!meta || typeof meta !== 'object') throw new Error('NEZADOSTNI PODATKI: metapodatki manjkajo.');
  const wCmLbl = meta.planeCm?.wCm ?? null;
  if (wCmLbl !== null && (!Number.isFinite(wCmLbl) || wCmLbl <= 0)) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine morajo biti pozitivni števili.');
  }
  if (!Number.isFinite(meta.planeCm?.hCm) || meta.planeCm.hCm <= 0) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine morajo biti pozitivni števili.');
  }
  const date = typeof meta.createdAt === 'string' && meta.createdAt.length >= 10 ? meta.createdAt.slice(0, 10) : 'neznan datum';
  const el = meta.params?.elementCm;
  const sp = meta.params?.spacingCm;
  const mere =
    typeof el === 'number' && Number.isFinite(el) && el > 0 && typeof sp === 'number' && Number.isFinite(sp) && sp >= 0
      ? ` · element ${el} cm + reža ${sp} cm`
      : ''; // manjkajoče mere se izpustijo — ne ugibajo se
  return {
    pred: 'PRED — originalna fotografija (delovna kopija)',
    po: `PO — fotomontaža: ${meta.profileLabel}`,
    // Pravilo 13 (FAZA-8): neznana širina je IZPISANA, ne tiho nadomeščena.
    metaLine: wCmLbl === null
      ? `Ravnina ${Math.round(meta.planeCm.hCm)} cm visoka, širina NI izmerjena${mere} · ${date} · skripta v${meta.scriptVersion}`
      : `Ravnina ${Math.round(wCmLbl)} × ${Math.round(meta.planeCm.hCm)} cm${mere} · ${date} · skripta v${meta.scriptVersion}`,
    zig: EXPORT_LABEL,
  };
}

/** Deterministično ime datoteke (enak profil + enak datum → enako ime). */
export function compareExportFilename(meta: ReplaceMetadata): string {
  if (!meta || typeof meta !== 'object') throw new Error('NEZADOSTNI PODATKI: metapodatki manjkajo.');
  return `fotomontaza-primerjava-${meta.profileId}.png`;
}

export interface CompareDrawInputs {
  /** NESPREMENJEN original (originalCanvas) */
  before: HTMLCanvasElement;
  /** kompozit fotomontaže (resultCanvas) */
  after: HTMLCanvasElement;
  layout: CompareLayout;
  labels: CompareLabels;
  /** prelomljene vrstice žiga (wrapText v komponenti — brskalna meritev) */
  zigLines: string[];
  opts?: CompareOptions;
}

/**
 * Izriše izvozno sliko pred/po na nov canvas (brskalni API — dokazan v E2E
 * s pravo izvoženo datoteko). Barvna shema enaka enojnemu izvozu: temen
 * spodnji trak (stone-800) z belim žigom, svetel zgornji trak s temnimi
 * oznakami PRED/PO.
 */
export function drawCompareExport(inp: CompareDrawInputs): HTMLCanvasElement {
  const { layout, labels, zigLines } = inp;
  const pad = inp.opts?.pad ?? 12;
  const lineH = inp.opts?.lineH ?? 17;
  const fontSize = inp.opts?.fontSize ?? 13;

  const ec = document.createElement('canvas');
  ec.width = layout.canvasW;
  ec.height = layout.canvasH;
  const ctx = ec.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D kontekst ni na voljo.');

  // 1) ozadje + sliki (drawImage skalira na normirani pravokotnik)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  ctx.drawImage(inp.before, layout.before.x, layout.before.y, layout.before.w, layout.before.h);
  ctx.drawImage(inp.after, layout.after.x, layout.after.y, layout.after.w, layout.after.h);

  // 2) ločilni trak (temen, polna višina)
  ctx.fillStyle = '#1c1917'; // stone-900
  ctx.fillRect(layout.divider.x, layout.divider.y, layout.divider.w, layout.divider.h);

  // 3) zgornji trak: oznaki PRED / PO (svetel trak, temno besedilo, na sredino polovic)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(layout.topStrip.x, layout.topStrip.y, layout.topStrip.w, layout.topStrip.h);
  ctx.fillStyle = '#1c1917';
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillText(labels.pred, layout.before.x + layout.before.w / 2, layout.topStrip.y + pad);
  ctx.fillText(labels.po, layout.after.x + layout.after.w / 2, layout.topStrip.y + pad);
  ctx.textAlign = 'left';

  // 4) spodnji trak: žig (prelomljene vrstice) + vrstica podatkov — enako enojnemu izvozu
  ctx.fillStyle = 'rgba(28,25,23,0.94)'; // stone-800
  ctx.fillRect(layout.bottomStrip.x, layout.bottomStrip.y, layout.bottomStrip.w, layout.bottomStrip.h);
  ctx.fillStyle = '#ffffff';
  let y = layout.bottomStrip.y + pad;
  for (const line of zigLines) {
    ctx.fillText(line, pad, y);
    y += lineH;
  }
  ctx.fillStyle = '#d6d3d1'; // stone-300
  ctx.fillText(labels.metaLine, pad, y + 2);

  return ec;
}
