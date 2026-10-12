// ─── Predlog za stranko: en dokument iz vizualizerja ─────────
// Hover standard ("Measure, Design, Estimate all in one place",
// raziskava task18): izvedenec po obisku pošlje stranki EN dokument:
//   1. pred/po fotografiji (trenutno stanje ↔ skriptni predlog),
//   2. specifikacijo območij (vzorec, barva, parametri, ocenjene mere),
//   3. povzetek meritev s fotke (dolžine, površine, naklon),
//   4. grobo oceno po postavkah (iz kalkulatorja — material + delo).
// Vse čisto canvas-skripto (0 AI). A4-portrait (1240 × dinamično),
// prenos PNG / shranjevanje v galerijo / tisk v PDF.

import { loadImage } from './measure-sheet';

const W = 1240;
const PAD = 56;
const PAIR_MAX_H = 640;
const ROW_H = 30;

const fmtSlDate = (d: Date): string =>
  d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtEUR = (n: number): string =>
  `${n.toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export interface ProposalLayerSpec {
  /** Oznaka območja, npr. "Območje 1". */
  label: string;
  /** Napis vzorca, npr. "Vertikalne palice". */
  patternLabel: string;
  /** Napis barve, npr. "RAL 7016 antracit" ali "#8a5a2a". */
  colorLabel: string;
  /** Parametri v cm, npr. "razmak 12 cm · element 2,4 cm". */
  paramsLabel: string;
  /** Ocenjene mere, npr. "6,2 × 1,8 m" (ali "—" brez kalibracije). */
  dimsLabel: string;
  /** Barvni vzorec (swatch) v tabeli. */
  hex: string;
}

export interface ProposalMeasureRow {
  label: string;
  value: string;
}

export interface ProposalEstimateLine {
  name: string;
  qty: string;
  total: string;
}

export interface ProposalEstimate {
  lines: ProposalEstimateLine[];
  /** Skupaj brez DDV (€). */
  totalNoVat: number;
  /** DDV stopnja v % (privzeto 22 — slovenska splošna stopnja). */
  vatRate?: number;
}

export interface VizProposalOptions {
  craftLabel: string;
  layers: ProposalLayerSpec[];
  /** Podnaslov (opis scene iz analize) ali null. */
  scene?: string | null;
  /** Zaznani obstoječi vzorec/barva (skripta) — pod oznako TRENUTNO STANJE. */
  existingLabel?: string | null;
  measures?: ProposalMeasureRow[];
  estimate?: ProposalEstimate | null;
}

/** Skupna višina posameznega bloka (za dinamično višino platna). */
function layoutHeights(opts: VizProposalOptions, pairH: number): { specH: number; measH: number; estH: number; H: number } {
  const headerH = 118;
  const pairTop = headerH + 30;
  const specTop = pairTop + pairH + 30;
  const specH = 34 + Math.min(opts.layers.length, 6) * ROW_H; // glava + vrstice
  let y = specTop + specH;
  let measH = 0;
  if (opts.measures && opts.measures.length > 0) {
    y += 26; // naslov bloka
    measH = 30 + Math.min(opts.measures.length, 8) * ROW_H;
    y += measH;
  }
  let estH = 0;
  if (opts.estimate && opts.estimate.lines.length > 0) {
    y += 26;
    estH = 30 + Math.min(opts.estimate.lines.length, 8) * ROW_H + 34; // glava + vrstice + skupaj
    y += estH;
  }
  const H = y + 64; // noga
  return { specH, measH, estH, H };
}

/**
 * Zgradi predlog za stranko (A4-portrait canvas):
 * glava → pred/po par → specifikacija območij → meritve → ocena → noga.
 */
export function buildVizProposal(
  beforeImg: HTMLImageElement,
  afterCanvas: HTMLCanvasElement,
  opts: VizProposalOptions,
): HTMLCanvasElement | null {
  const now = new Date();
  const innerW = W - PAD * 2;
  const gap = 24;
  const eachW = Math.floor((innerW - gap) / 2);
  const aspect = beforeImg.naturalHeight / Math.max(1, beforeImg.naturalWidth);
  const pairH = Math.min(PAIR_MAX_H, Math.max(180, Math.round(eachW * aspect)));

  const { specH, measH, estH, H } = layoutHeights(opts, pairH);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Glava ────────────────────────────────────────────────
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText('Predlog prenove — za stranko', PAD, 60);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#57534e';
  const nLayers = opts.layers.length;
  const sub = [
    opts.craftLabel,
    `${nLayers} ${nLayers === 1 ? 'območje' : nLayers === 2 ? 'območji' : 'območij'}`,
    opts.scene ? opts.scene.slice(0, 60) : null,
    fmtSlDate(now),
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(sub, PAD, 84);
  ctx.textAlign = 'right';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#b45309';
  ctx.fillText('Obrtnik Pro', W - PAD, 60);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#78716c';
  ctx.fillText('skriptna vizualizacija (0 AI)', W - PAD, 80);
  ctx.strokeStyle = '#e7e5e4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 100);
  ctx.lineTo(W - PAD, 100);
  ctx.stroke();

  // ── Pred / po par ────────────────────────────────────────
  const pairTop = 118 + 30;
  const drawFrame = (x: number, imgSrc: HTMLImageElement | HTMLCanvasElement, label: string, tint: string) => {
    const sw = imgSrc instanceof HTMLCanvasElement ? imgSrc.width : imgSrc.naturalWidth;
    const sh = imgSrc instanceof HTMLCanvasElement ? imgSrc.height : imgSrc.naturalHeight;
    const s = Math.max(eachW / sw, pairH / sh); // cover — izpolni okvir brez deformacije
    const dw = sw * s;
    const dh = sh * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, pairTop, eachW, pairH);
    ctx.clip();
    ctx.fillStyle = '#0c0a09';
    ctx.fillRect(x, pairTop, eachW, pairH);
    ctx.drawImage(imgSrc, x + (eachW - dw) / 2, pairTop + (pairH - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, pairTop - 0.5, eachW + 1, pairH + 1);
    // oznaka nad okvirjem
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = tint;
    ctx.fillText(label, x, pairTop - 10);
  };
  drawFrame(PAD, beforeImg, `TRENUTNO STANJE${opts.existingLabel ? ` — ${opts.existingLabel}` : ''}`, '#78716c');
  drawFrame(PAD + eachW + gap, afterCanvas, `PREDLOG — ${opts.layers[0]?.patternLabel ?? 'nov videz'}`, '#b45309');

  // ── Pomožna risba tabele ─────────────────────────────────
  const tableHeader = (y: number, cols: { text: string; x: number; align?: CanvasTextAlign }[]) => {
    ctx.fillStyle = '#fafaf9';
    ctx.fillRect(PAD, y, innerW, 30);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#44403c';
    for (const c of cols) {
      ctx.textAlign = c.align ?? 'left';
      ctx.fillText(c.text, PAD + c.x, y + 19);
    }
  };
  const tableRow = (y: number, i: number, cols: { text: string; x: number; bold?: boolean; color?: string; align?: CanvasTextAlign }[], h = ROW_H) => {
    if (i % 2 === 1) {
      ctx.fillStyle = '#f7f6f4';
      ctx.fillRect(PAD, y, innerW, h);
    }
    for (const c of cols) {
      ctx.font = `${c.bold ? 'bold ' : ''}12px system-ui, sans-serif`;
      ctx.textAlign = c.align ?? 'left';
      ctx.fillStyle = c.color ?? '#1c1917';
      ctx.fillText(c.text, PAD + c.x, y + 20);
    }
  };

  // ── Specifikacija območij ────────────────────────────────
  let y = 118 + 30 + pairH + 30;
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#1c1917';
  ctx.fillText('Predlog območij', PAD, y - 8);
  tableHeader(y, [
    { text: 'OBMOČJE', x: 12 },
    { text: 'VZOREC', x: 110 },
    { text: 'BARVA', x: 320 },
    { text: 'PARAMETRI', x: 560 },
    { text: 'MERE (OCENA)', x: innerW - 130, align: 'right' },
  ]);
  y += 30;
  opts.layers.slice(0, 6).forEach((l, i) => {
    tableRow(y, i, [
      { text: l.label, x: 12, bold: true },
      { text: l.patternLabel, x: 110 },
      { text: l.colorLabel, x: 320, color: '#57534e' },
      { text: l.paramsLabel, x: 560, color: '#57534e' },
      { text: l.dimsLabel, x: innerW - 130, align: 'right', bold: true, color: '#166534' },
    ]);
    // swatch barve pred napisom barve
    ctx.fillStyle = l.hex;
    ctx.strokeStyle = '#d6d3d1';
    ctx.fillRect(PAD + 300, y + 8, 14, 14);
    ctx.strokeRect(PAD + 300, y + 8, 14, 14);
    y += ROW_H;
  });

  // ── Meritve (povzetek) ───────────────────────────────────
  if (opts.measures && opts.measures.length > 0) {
    y += 26;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#1c1917';
    ctx.fillText('Meritve s fotografije', PAD, y - 8);
    tableHeader(y, [
      { text: 'MERITEV', x: 12 },
      { text: 'VREDNOST', x: innerW - 130, align: 'right' },
    ]);
    y += 30;
    opts.measures.slice(0, 8).forEach((m, i) => {
      tableRow(y, i, [
        { text: m.label, x: 12 },
        { text: m.value, x: innerW - 130, align: 'right', bold: true, color: '#166534' },
      ]);
      y += ROW_H;
    });
  }

  // ── Ocena (brez DDV) ─────────────────────────────────────
  if (opts.estimate && opts.estimate.lines.length > 0) {
    y += 26;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#1c1917';
    ctx.fillText('Groba ocena (material + delo, brez DDV)', PAD, y - 8);
    tableHeader(y, [
      { text: 'POSTAVKA', x: 12 },
      { text: 'KOLIČINA', x: 640, align: 'right' },
      { text: 'SKUPAJ', x: innerW - 130, align: 'right' },
    ]);
    y += 30;
    opts.estimate.lines.slice(0, 8).forEach((l, i) => {
      tableRow(y, i, [
        { text: l.name, x: 12 },
        { text: l.qty, x: 640, align: 'right', color: '#57534e' },
        { text: l.total, x: innerW - 130, align: 'right', bold: true },
      ]);
      y += ROW_H;
    });
    // vsota
    const vat = opts.estimate.vatRate ?? 22;
    y += 8;
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(PAD, y, innerW, 26);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('SKUPAJ (brez DDV)', PAD + 12, y + 17);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtEUR(opts.estimate.totalNoVat)} · DDV ${vat} % prištejemo po ponudbi`, W - PAD - 12, y + 17);
    y += 26;
  }

  // ── Noga ─────────────────────────────────────────────────
  ctx.textAlign = 'left';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#a8a29e';
  ctx.fillText(
    'Vizualizacija je skriptni predogled (0 AI) — odtenek se lahko razlikuje glede na svetlobo; mere so orientacijske. Točen odmerek potrdimo na terenu.',
    PAD,
    H - 26,
  );

  return canvas;
}

/** Odpri predlog v novem oknu za tisk / shranjevanje kot PDF
 *  (isti vzorec kot openOfferPDF v pdf.ts). */
export function printProposalCanvas(canvas: HTMLCanvasElement, title: string): boolean {
  const w = window.open('', '_blank', 'width=920,height=1040');
  if (!w) return false;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  w.document.open();
  w.document.write(`<!DOCTYPE html>
<html lang="sl">
<head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f5f4; display: flex; justify-content: center; }
  img { width: 100%; max-width: 1240px; height: auto; display: block; background: #fff; }
  @media print { body { background: #fff; } img { max-width: 100%; } }
</style></head>
<body><img src="${img}" alt="${title.replace(/</g, '&lt;')}"></body>
</html>`);
  w.document.close();
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 500);
  return true;
}

export { loadImage };
