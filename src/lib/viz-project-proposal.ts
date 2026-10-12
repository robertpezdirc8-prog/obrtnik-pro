// ─── Projektni predlog za stranko: več fotk, EN dokument ────
// Nadgradnja enojnega predloga (viz-proposal, task18/22): če je
// obrtnik vizualiziral VEČ fotografij (vsaka s shranjenim stanjem
// plasti), se zgradi EN dokument z več pred/po pari — po enim na
// fotko — in skupno grobo oceno po območjih. Isti standard kot
// Hover "whole-project owner report", vendar čisto skriptno (0 AI):
// "po" stran DETERMINISTIČNO ponariš iz shranjenih plasti
// (drawLayersOnQuad), ocene pa so izpis obstoječega kalkulatorja.

import type { ProposalCompany } from './viz-proposal';

const W = 1240;
const PAD = 56;
/** Višina enega pred/po para (manjša kot pri enojnem predlogu). */
const PAIR_H = 300;
const ROW_H = 30;

const fmtSlDate = (d: Date): string =>
  d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtEUR = (n: number): string =>
  `${n.toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** En par (fotka) v projektnem predlogu. */
export interface ProjectPairSpec {
  /** Oznaka fotke, npr. "F1". */
  id: string;
  /** Dejavnost fotke, npr. "Ograje". */
  craftLabel: string;
  beforeImg: HTMLImageElement;
  /** Ponarizano "po" stanje (drawLayersOnQuad iz shranjenih plasti). */
  afterCanvas: HTMLCanvasElement;
  /** Povzetek območij fotke, npr. "Vertikalne palice · RAL 7016". */
  summary: string;
  /** Ocenjene mere, npr. "6,0 × 1,9 m" (ali "—" brez kalibracije). */
  dimsLabel: string;
  /** Groba ocena fotke brez DDV (€) ali null (neznana dejavnost/mere). */
  estimateTotal: number | null;
}

export interface VizProjectProposalOptions {
  pairs: ProjectPairSpec[];
  /** Podatki obrtnika (iz Nastavitev) ali null. */
  company?: ProposalCompany | null;
  /** Opomba scene/projekta v podnaslov (neobvezno). */
  note?: string | null;
}

function headerHeight(opts: VizProjectProposalOptions): number {
  return opts.company?.logo ? 148 : 118;
}

/** Skupna višina dokumenta (dinamična po številu parov). */
function layoutHeights(opts: VizProjectProposalOptions): number {
  const headerH = headerHeight(opts);
  const n = Math.min(opts.pairs.length, 4);
  const pairsH = n > 0 ? n * (24 + PAIR_H + 18) : 0; // napisek + par + razmak
  const estRows = Math.min(opts.pairs.length, 4);
  const estH = estRows > 0 ? 26 + 30 + estRows * ROW_H + 34 : 0;
  return headerH + 24 + pairsH + estH + 64;
}

/**
 * Zgradi projektni predlog za stranko (A4-portrait canvas):
 * glava → N × (pred/po par + povzetek) → groba ocena po fotkah → noga.
 */
export function buildVizProjectProposal(
  opts: VizProjectProposalOptions,
): HTMLCanvasElement | null {
  const pairs = opts.pairs.slice(0, 4);
  if (pairs.length === 0) return null;
  const now = new Date();
  const H = layoutHeights(opts);
  const innerW = W - PAD * 2;
  const gap = 24;
  const eachW = Math.floor((innerW - gap) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Glava (isti vzorec kot enojni predlog) ───────────────
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText('Projektni predlog — za stranko', PAD, 60);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#57534e';
  const nWord = pairs.length === 1 ? 'fotografija' : pairs.length === 2 ? 'fotografiji' : pairs.length === 3 || pairs.length === 4 ? 'fotografije' : 'fotografij';
  const sub = [
    `${pairs.length} ${nWord}`,
    opts.note ? opts.note.slice(0, 48) : null,
    fmtSlDate(now),
  ].filter(Boolean).join(' · ');
  ctx.fillText(sub, PAD, 84);
  ctx.textAlign = 'right';
  const headerH = headerHeight(opts);
  const comp = opts.company;
  if (comp?.logo) {
    const lw = Math.min(200, comp.logo.naturalWidth || 200);
    const lh = Math.min(44, (comp.logo.naturalHeight || 44) * (lw / Math.max(1, comp.logo.naturalWidth || 200)));
    ctx.drawImage(comp.logo, W - PAD - lw, 20, lw, lh);
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#1c1917';
    ctx.fillText(comp.name, W - PAD, 88);
    if (comp.contact) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#78716c';
      ctx.fillText(comp.contact.slice(0, 68), W - PAD, 106);
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#a8a29e';
    ctx.fillText('skriptna vizualizacija (0 AI)', W - PAD, 122);
  } else if (comp?.name) {
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#1c1917';
    ctx.fillText(comp.name, W - PAD, 60);
    if (comp.contact) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#78716c';
      ctx.fillText(comp.contact.slice(0, 68), W - PAD, 80);
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#a8a29e';
    ctx.fillText('skriptna vizualizacija (0 AI)', W - PAD, 96);
  } else {
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#b45309';
    ctx.fillText('Obrtnik Pro', W - PAD, 60);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#78716c';
    ctx.fillText('skriptna vizualizacija (0 AI)', W - PAD, 80);
  }
  ctx.strokeStyle = '#e7e5e4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, headerH - 18);
  ctx.lineTo(W - PAD, headerH - 18);
  ctx.stroke();

  // ── Pari: pred/po + povzetek ─────────────────────────────
  let y = headerH + 24;
  const drawFrame = (x: number, imgSrc: HTMLImageElement | HTMLCanvasElement, label: string, tint: string) => {
    const sw = imgSrc instanceof HTMLCanvasElement ? imgSrc.width : imgSrc.naturalWidth;
    const sh = imgSrc instanceof HTMLCanvasElement ? imgSrc.height : imgSrc.naturalHeight;
    const s = Math.max(eachW / sw, PAIR_H / sh);
    const dw = sw * s;
    const dh = sh * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, eachW, PAIR_H);
    ctx.clip();
    ctx.fillStyle = '#0c0a09';
    ctx.fillRect(x, y, eachW, PAIR_H);
    ctx.drawImage(imgSrc, x + (eachW - dw) / 2, y + (PAIR_H - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, eachW + 1, PAIR_H + 1);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = tint;
    ctx.fillText(label, x, y - 8);
  };

  for (const p of pairs) {
    drawFrame(PAD, p.beforeImg, `TRENUTNO — ${p.id} · ${p.craftLabel}`, '#78716c');
    drawFrame(PAD + eachW + gap, p.afterCanvas, `PREDLOG — ${p.id}`, '#b45309');
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#44403c';
    const cap = `${p.id} · ${p.summary} · mere ${p.dimsLabel}`;
    ctx.fillText(cap.slice(0, 118), PAD, y + PAIR_H + 14);
    y += 24 + PAIR_H + 18;
  }

  // ── Groba ocena po fotkah ────────────────────────────────
  const anyEstimate = pairs.some((p) => p.estimateTotal !== null);
  if (anyEstimate) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#1c1917';
    ctx.fillText('Groba ocena (material + delo, brez DDV)', PAD, y + 18);
    const estTop = y + 26;
    ctx.fillStyle = '#fafaf9';
    ctx.fillRect(PAD, estTop, innerW, 30);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#44403c';
    ctx.fillText('FOTKA', PAD + 12, estTop + 19);
    ctx.fillText('PREDLOG', PAD + 90, estTop + 19);
    ctx.fillText('MERE (OCENA)', PAD + 700, estTop + 19);
    ctx.textAlign = 'right';
    ctx.fillText('SKUPAJ', W - PAD - 12, estTop + 19);
    let ry = estTop + 30;
    let sum = 0;
    pairs.forEach((p, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = '#f7f6f4';
        ctx.fillRect(PAD, ry, innerW, ROW_H);
      }
      ctx.textAlign = 'left';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = '#1c1917';
      ctx.fillText(p.id, PAD + 12, ry + 20);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#57534e';
      ctx.fillText(p.craftLabel + ' · ' + p.summary.slice(0, 52), PAD + 90, ry + 20);
      ctx.fillText(p.dimsLabel, PAD + 700, ry + 20);
      ctx.textAlign = 'right';
      if (p.estimateTotal !== null) {
        sum += p.estimateTotal;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#166534';
        ctx.fillText(fmtEUR(p.estimateTotal), W - PAD - 12, ry + 20);
      } else {
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = '#a8a29e';
        ctx.fillText('—', W - PAD - 12, ry + 20);
      }
      ry += ROW_H;
    });
    ry += 8;
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(PAD, ry, innerW, 26);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('SKUPAJ (brez DDV)', PAD + 12, ry + 17);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtEUR(sum)} · DDV 22 % prištejemo po ponudbi`, W - PAD - 12, ry + 17);
  }

  // ── Noga ─────────────────────────────────────────────────
  ctx.textAlign = 'left';
  if (opts.company?.name) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#78716c';
    ctx.fillText(
      `Pripravil: ${opts.company.name}${opts.company.contact ? ` · ${opts.company.contact}` : ''}`.slice(0, 110),
      PAD,
      H - 44,
    );
  }
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#a8a29e';
  ctx.fillText(
    'Vizualizacije so skriptni predogled (0 AI) — odtenek se lahko razlikuje glede na svetlobo; mere so orientacijske. Točen odmerek potrdimo na terenu.',
    PAD,
    H - 26,
  );

  return canvas;
}

/** Tisk projektnega predloga (isti vzorec kot printProposalCanvas). */
export function printProjectProposalCanvas(canvas: HTMLCanvasElement, title: string): boolean {
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
