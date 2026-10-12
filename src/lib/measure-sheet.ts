// ─── Merilni list: fotka z anotiranimi merami + tabela ──────
// Hover measurement-PDF standard (raziskava task14/16): izvedenec
// dobi DOKUMENT — fotka z razsežnostnimi črtami/poligoni/koti in
// berljivo tabelo vrednosti. Vse čisto canvas-skripto, 0 AI.
// A4-portrait (1000×1414) → prenos PNG ali shranjevanje v galerijo.

import type { PhotoMeasure } from '@/lib/camera-types';
import { formatCm, formatDeg, formatM2 } from '@/lib/measure-geometry';
import { drawDimensionLine } from '@/lib/annotate';

const W = 1000;
const PAD = 48;
const PHOTO_MAX_H = 620;
const KIND_LABEL: Record<PhotoMeasure['kind'], string> = {
  length: 'dolžina',
  area: 'površina',
  angle: 'kot',
  chain: 'veriga (naklon)',
  laser: 'laser',
  voice: 'glas',
  xr: 'AR',
};

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('slike ni bilo mogoče prebrati'));
    img.src = dataUrl;
  });
}

const fmtSlDate = (d: Date): string =>
  d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });

function fmtValue(m: PhotoMeasure): string {
  if (m.value === null) return '—';
  if (m.kind === 'area') return formatM2(m.value);
  if (m.kind === 'angle') return formatDeg(m.value);
  return formatCm(m.value);
}

/** Anotira meritve na fotko (koordinatni sistem `photo` območja). */
function annotateMeasures(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  measures: PhotoMeasure[],
): void {
  // Točke meritev so v % slike (0–100) → preslikava v območje fotke
  const scale = dw / 100;
  // Risanje fotke z eksaktnim razmerjem (drawImage poveže obe mreži)
  ctx.drawImage(img, dx, dy, dw, dh);
  const sx = (x: number): number => dx + x * scale;
  const sy = (y: number): number => dy + y * scale;

  let idx = 0;
  for (const m of measures) {
    if (m.kind === 'length' && m.points.length === 2) {
      const a = { x: sx(m.points[0][0]), y: sy(m.points[0][1]) };
      const b = { x: sx(m.points[1][0]), y: sy(m.points[1][1]) };
      // izmenični odmik (nad/pod) — zmanjša prekrivanja
      drawDimensionLine(ctx, a, b, m.label ? `${m.label} · ${fmtValue(m)}` : fmtValue(m), {
        offset: idx % 2 === 0 ? 18 : -18,
        fontPx: 12,
      });
      idx += 1;
    } else if (m.kind === 'area' && m.points.length >= 3) {
      // poligon: polprosojen n premik črt + oznaka v centroidu
      ctx.save();
      ctx.beginPath();
      m.points.forEach(([px, py], i) => {
        const X = sx(px);
        const Y = sy(py);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(56,132,255,0.14)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();

      const cx = m.points.reduce((s, p) => s + p[0], 0) / m.points.length;
      const cy = m.points.reduce((s, p) => s + p[1], 0) / m.points.length;
      const label = `${m.label ? m.label + ' · ' : ''}${fmtValue(m)}`;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = sx(cx) - (tw / 2 + 6);
      const by = sy(cy) - 10;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 12, 20, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(15,15,18,0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx(cx), by + 10.5);
      ctx.restore();
      idx += 1;
    } else if (m.kind === 'chain' && m.points.length >= 2) {
      // veriga: polilinja + razsežnostna črta na vsak odsek (izmenični odmik)
      const P = m.points.map(([px, py]) => ({ x: sx(px), y: sy(py) }));
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(13,148,136,0.95)'; // teal
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      P.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      for (const p of P) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(13,148,136,0.95)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
      // razsežnostne črte po odsekih (dolžine so v m.sides)
      const sides = m.sides ?? [];
      for (let i = 1; i < P.length && i <= sides.length; i++) {
        const segLabel = sides[i - 1] !== undefined ? formatCm(sides[i - 1]) : '';
        if (!segLabel) continue;
        drawDimensionLine(ctx, P[i - 1], P[i], segLabel, {
          offset: idx % 2 === 0 ? 14 : -14,
          fontPx: 10,
        });
        idx += 1;
      }
    } else if (m.kind === 'angle' && m.points.length === 3) {
      // oglišče sredi (points[1]) — dve kraki + lok + oznaka
      const v = { x: sx(m.points[1][0]), y: sy(m.points[1][1]) };
      const p1 = { x: sx(m.points[0][0]), y: sy(m.points[0][1]) };
      const p2 = { x: sx(m.points[2][0]), y: sy(m.points[2][1]) };
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(v.x, v.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
      const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
      const R = 22;
      ctx.beginPath();
      ctx.arc(v.x, v.y, R, a1, a2, false);
      ctx.strokeStyle = 'rgba(255,215,90,0.98)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      const label = `${m.label ? m.label + ' · ' : ''}${fmtValue(m)}`;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const mid = a1 + (a2 - a1) / 2;
      const lx = v.x + Math.cos(mid) * (R + 26);
      const ly = v.y + Math.sin(mid) * (R + 26);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.roundRect(lx - (tw / 2 + 6), ly - 10, tw + 12, 20, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(15,15,18,0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 0.5);
      ctx.restore();
      idx += 1;
    }
  }
}

export interface MeasureSheetOptions {
  /** Dejavnost (npr. »Ograje«) za naslov. */
  craftLabel?: string;
  /** Opomba scene (iz analize) v podnaslov. */
  scene?: string | null;
}

/**
 * Zgradi merilni list (A4-portrait canvas): glava, fotka z anotacijami,
 * tabela vseh meritev, noga. Vrne null, če sliko ni.
 */
export function buildMeasureSheet(
  img: HTMLImageElement,
  measures: PhotoMeasure[],
  opts: MeasureSheetOptions = {},
): HTMLCanvasElement | null {
  const rows = measures.filter((m) => m.value !== null);
  if (rows.length === 0) return null;

  const now = new Date();
  // Fotka: širina W−2·PAD, višina po razmerju (omejeno na PHOTO_MAX_H)
  const innerW = W - PAD * 2;
  const photoH = Math.min(PHOTO_MAX_H, Math.max(160, Math.round((img.naturalHeight / img.naturalWidth) * innerW)));
  const photoW = Math.round((img.naturalWidth / img.naturalHeight) * photoH);
  const photoX = PAD + (innerW - photoW) / 2;

  const headerH = 108;
  const tableTop = headerH + photoH + 26;
  const rowH = 34;
  const tableH = 34 + Math.min(rows.length, 14) * rowH; // glava tabele + vrstice
  const H = tableTop + tableH + 58;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Podlaga
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Glava
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Merilni list${opts.craftLabel ? ` — ${opts.craftLabel}` : ''}`, PAD, 58);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#57534e';
  const sub = [
    `${rows.length} ${rows.length === 1 ? 'meritev' : rows.length >= 2 && rows.length <= 4 ? 'meritvi' : 'meritev'}`,
    opts.scene ? opts.scene.slice(0, 64) : null,
    fmtSlDate(now),
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(sub, PAD, 80);
  ctx.textAlign = 'right';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#b45309';
  ctx.fillText('Obrtnik Pro', W - PAD, 58);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#78716c';
  ctx.fillText('skriptno merjenje s fotografije', W - PAD, 78);
  ctx.strokeStyle = '#e7e5e4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 96);
  ctx.lineTo(W - PAD, 96);
  ctx.stroke();

  // Fotka + anotacije
  ctx.save();
  ctx.strokeStyle = '#d6d3d1';
  ctx.lineWidth = 1;
  ctx.strokeRect(photoX - 1, headerH - 1, photoW + 2, photoH + 2);
  ctx.restore();
  annotateMeasures(ctx, img, photoX, headerH, photoW, photoH, measures);

  // Tabela
  let y = tableTop;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(PAD, y, innerW, 30);
  ctx.fillStyle = '#44403c';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText('VRSTA', PAD + 12, y + 19);
  ctx.fillText('OZNAKA', PAD + 130, y + 19);
  ctx.textAlign = 'right';
  ctx.fillText('VREDNOST', W - PAD - 12, y + 19);
  y += 30;

  rows.slice(0, 14).forEach((m, i) => {
    if (i % 2 === 1) {
      ctx.fillStyle = '#f7f6f4';
      ctx.fillRect(PAD, y, innerW, rowH);
    }
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#78716c';
    ctx.fillText(KIND_LABEL[m.kind], PAD + 12, y + 21);
    ctx.fillStyle = '#1c1917';
    const label = m.label.length > 44 ? `${m.label.slice(0, 43)}…` : m.label;
    ctx.fillText(label, PAD + 130, y + 21);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#166534';
    ctx.fillText(fmtValue(m), W - PAD - 12, y + 21);
    y += rowH;
  });
  if (rows.length > 14) {
    ctx.textAlign = 'left';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#78716c';
    ctx.fillText(`… in še ${rows.length - 14} meritev (glej CSV izvoz)`, PAD + 12, y + 16);
    y += 22;
  }

  // Noga
  ctx.textAlign = 'left';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#a8a29e';
  ctx.fillText(`Skriptno merjenje (0 AI) — vrednosti orientacijske; končni odmerek potrdimo na terenu. · ${fmtSlDate(now)}`, PAD, H - 24);

  return canvas;
}
