// ─── Merilno poročilo: skica prostora + vse meritve v enem tisku ──
// Raziskava (magicplan Report PDF, 2dscanner/ushpo smernice): standard
// merilnega poročila na objektu je EEN dokument — tloris z dimenzijami
// (vektorsko) + tabela meritev + naslovni blok z znamko + iskrena
// opozorila. To združi Skico prostora (Bowditch tloris) in merilni
// list (fotka/laser/glas/AR) v en HTML → tisk/PDF. 0 AI,
// deterministično (pri `now` podanem).

import type { PhotoMeasure } from '@/lib/camera-types';
import type { RoomSketchResult } from '@/lib/room-sketch';
import { formatCm, formatDeg, formatM2 } from '@/lib/measure-geometry';
import { formatNum } from '@/lib/format';

export const MEASURE_REPORT_VERSION = 'measure-report-v1';

const KIND_LABEL: Record<PhotoMeasure['kind'], string> = {
  length: 'dolžina',
  area: 'površina',
  angle: 'kot',
  chain: 'veriga (naklon)',
  laser: 'laser',
  voice: 'glas',
  xr: 'AR',
};

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmtSlDate = (d: Date): string =>
  d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });

function fmtValue(m: PhotoMeasure): string {
  if (m.value === null) return '—';
  if (m.kind === 'area') return formatM2(m.value);
  if (m.kind === 'angle') return formatDeg(m.value);
  return formatCm(m.value);
}

export const LEVEL_LABEL: Record<RoomSketchResult['level'], string> = {
  closed: 'Zaprla se je ✓ — napaka znotraj tolerance',
  adjusted: 'Poravnano (Bowditch) — rahlo popravljene dolžine',
  open: 'Se ne zapre — površina NI izračunana',
};

/** Vektorska SVG skica tlorisa (Y zrcaljen, oznake stranic,
 *  ≈ pri adjusted, prekinitveno črtkano pri open). Deterministično. */
export function buildSketchSvg(result: RoomSketchResult, opts?: { width?: number; height?: number }): string {
  const pts = result.vertices;
  if (pts.length < 3) return '';
  const W = opts?.width ?? 560;
  const H = opts?.height ?? 400;
  const PAD = 40;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 1);
  const spanY = Math.max(Math.max(...ys) - minY, 1);
  const k = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const tx = (x: number) => PAD + (x - minX) * k;
  const ty = (y: number) => H - PAD - (y - minY) * k; // SVG y raste navzdol → zrcalimo
  const open = result.level === 'open';

  const ring = pts.map((p) => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(' ');

  // oznake stranic na sredini vsake stranice (i → i+1 z ovitkom)
  const sideLabels = Array.from({ length: result.n }, (_, i) => {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = tx((a.x + b.x) / 2);
    const my = ty((a.y + b.y) / 2) - 6;
    const raw = `${formatNum(result.adjustedSidesCm[i], 1)} cm`;
    const text = result.level === 'adjusted' ? `≈ ${raw}` : raw;
    return `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#57534e" font-family="Arial, sans-serif">${esc(text)}</text>`;
  }).join('\n      ');

  // oglišča (brez podvojenega zadnjega)
  const dots = pts
    .slice(0, result.n)
    .map((p) => `<circle cx="${tx(p.x).toFixed(1)}" cy="${ty(p.y).toFixed(1)}" r="3.6" fill="#d97706" />`)
    .join('\n      ');

  // površina v centroidu (povprečje oglišč — dovolj za oznako poročila)
  let areaStamp = '';
  if (result.areaM2 !== null) {
    const cx = tx(xs.slice(0, result.n).reduce((s, v) => s + v, 0) / result.n);
    const cy = ty(ys.slice(0, result.n).reduce((s, v) => s + v, 0) / result.n);
    const label = formatM2(result.areaM2);
    areaStamp = `<g><rect x="${(cx - 44).toFixed(1)}" y="${(cy - 12).toFixed(1)}" width="88" height="24" rx="6" fill="rgba(255,255,255,0.92)" stroke="#e7e5e4" /><text x="${cx.toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#166534" font-family="Arial, sans-serif">${esc(label)}</text></g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tloris prostora z merami stranic">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" />
    <polygon points="${ring}" fill="${open ? 'none' : 'rgba(217,119,6,0.10)'}" stroke="${open ? '#dc2626' : '#d97706'}" stroke-width="2.5" ${open ? 'stroke-dasharray="7 5"' : ''} fill-rule="evenodd" />
    ${sideLabels}
      ${dots}
      ${areaStamp}
  </svg>`;
}

export interface MeasureReportOptions {
  /** Vse meritve (fotka + pripomočki: laser/glas/AR). */
  measures: PhotoMeasure[];
  /** Skica prostora (tloris) — opcija. */
  sketch: RoomSketchResult | null;
  /** Dejavnost za podnaslov (npr. »Keramika«). */
  craftLabel?: string;
  /** Opomba scene iz analize. */
  scene?: string | null;
  /** Podatki obrta (naslovni blok nosi NJOVO znamko). */
  company?: { name: string; contact?: string; taxNumber?: string } | null;
  /** Lokacija/objekt (opcija). */
  location?: string | null;
  /** Datum poročila (privzeto zdaj) — za deterministične teste. */
  now?: Date;
}

/** Zgradi celoten HTML merilnega poročila (A4 tisk). */
export function buildMeasureReportHTML(opts: MeasureReportOptions): string {
  const now = opts.now ?? new Date();
  const rows = opts.measures.filter((m) => m.value !== null);
  const sketch = opts.sketch;
  const comp = opts.company ?? null;

  const companyBlock = comp?.name
    ? `<div class="company"><h1>${esc(comp.name)}</h1>${comp.contact ? `<p>${esc(comp.contact)}</p>` : ''}${comp.taxNumber ? `<p>Davčna št.: ${esc(comp.taxNumber)}</p>` : ''}</div>`
    : `<div class="company"><h1 class="brand">Obrtnik Pro</h1><p>skriptno merjenje (0 AI)</p></div>`;

  const sketchSection = sketch
    ? `
  <h2>Skica prostora (tloris)</h2>
  <div class="sketch-wrap">${buildSketchSvg(sketch)}</div>
  <div class="chips">
    <div class="chip"><span class="label">Površina tlorisa</span><strong class="${sketch.areaM2 !== null ? 'good' : 'bad'}">${sketch.areaM2 !== null ? formatM2(sketch.areaM2) : '— (se ne zapre)'}</strong></div>
    <div class="chip"><span class="label">Obseg</span><strong>${formatCm(sketch.perimeterCm)}</strong></div>
    <div class="chip"><span class="label">Ovojnica (L × Š)</span><strong>${formatNum(sketch.bboxM.lengthM)} × ${formatNum(sketch.bboxM.widthM)} m</strong></div>
    <div class="chip"><span class="label">Stene / kotno zaprtje</span><strong>${sketch.n} / ${formatNum(sketch.angularMisclosureDeg, 1)}°</strong></div>
  </div>
  <p class="level ${sketch.level}">${esc(LEVEL_LABEL[sketch.level])} · zapiralna napaka ${formatNum(sketch.closureErrorCm, 1)} cm (${formatNum(sketch.closureErrorPct, 2)} % obsega)</p>
  ${
    sketch.warnings.length > 0
      ? `<ul class="warn">${sketch.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>`
      : ''
  }
  <p class="note">Ovojnica (L × Š) je pri ne-pravokotnih prostorih večja od tlorisa — za odmerek po dolžini × širini velja ovojnica, dejanska površina je površina poligona zgoraj.</p>`
    : '';

  const measureRows = rows
    .map(
      (m, i) => `<tr>
        <td>${esc(KIND_LABEL[m.kind])}</td>
        <td>${esc(m.label)}</td>
        <td class="r"><strong>${esc(fmtValue(m))}</strong></td>
      </tr>`,
    )
    .join('');

  const measuresSection = `
  <h2>Meritve (${rows.length})</h2>
  ${
    rows.length > 0
      ? `<table><thead><tr><th>VRSTA</th><th>OZNAKA</th><th class="r">VREDNOST</th></tr></thead><tbody>${measureRows}</tbody></table>`
      : '<p class="empty">Brez zabeleženih meritev.</p>'
  }`;

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8">
<title>Merilno poročilo${opts.craftLabel ? ` — ${esc(opts.craftLabel)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #292524; margin: 0; padding: 32px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #a16207; padding-bottom: 16px; margin-bottom: 20px; }
  .company h1 { margin: 0 0 4px; font-size: 19px; color: #854d0e; }
  .company h1.brand { color: #b45309; }
  .company p { margin: 2px 0; color: #57534e; }
  .meta { text-align: right; }
  .meta .num { font-size: 20px; font-weight: 700; color: #854d0e; }
  .meta p { margin: 2px 0; color: #57534e; }
  h2 { font-size: 13px; color: #854d0e; text-transform: uppercase; letter-spacing: 0.5px; margin: 18px 0 8px; }
  .sketch-wrap { border: 1px solid #e7e5e4; border-radius: 8px; padding: 8px; background: #fff; }
  .sketch-wrap svg { width: 100%; height: auto; display: block; }
  .chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
  .chip { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 8px 10px; }
  .chip .label { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; color: #a8a29e; margin-bottom: 2px; }
  .chip strong { font-size: 13px; }
  .chip strong.good { color: #166534; }
  .chip strong.bad { color: #b91c1c; }
  .level { margin: 10px 0 0; padding: 8px 12px; border-radius: 6px; font-size: 12px; }
  .level.closed { background: #f0fdf4; border-left: 3px solid #16a34a; color: #166534; }
  .level.adjusted { background: #fffbeb; border-left: 3px solid #d97706; color: #92400e; }
  .level.open { background: #fef2f2; border-left: 3px solid #dc2626; color: #b91c1c; }
  .warn { margin: 8px 0 0; padding-left: 20px; color: #92400e; font-size: 12px; }
  .note { color: #78716c; font-size: 11.5px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #854d0e; color: #fff; text-align: left; padding: 7px 10px; font-size: 11.5px; }
  th.r, td.r { text-align: right; }
  td { padding: 7px 10px; border-bottom: 1px solid #e7e5e4; }
  tr:nth-child(even) td { background: #fafaf9; }
  .empty { color: #78716c; }
  .foot { margin-top: 28px; border-top: 1px solid #e7e5e4; padding-top: 10px; color: #78716c; font-size: 11px; display: flex; justify-content: space-between; gap: 16px; }
  @media print { body { padding: 16px; } .sketch-wrap { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="head">
    ${companyBlock}
    <div class="meta">
      <div class="num">MERILNO POROČILO</div>
      <p>Datum: ${fmtSlDate(now)}</p>
      ${opts.craftLabel ? `<p>Dejavnost: ${esc(opts.craftLabel)}</p>` : ''}
      ${opts.location ? `<p>Lokacija: ${esc(opts.location)}</p>` : ''}
      ${opts.scene ? `<p>${esc(opts.scene.slice(0, 90))}</p>` : ''}
    </div>
  </div>
  ${sketchSection}
  ${measuresSection}
  <div class="foot">
    <span>Izmeril: ${esc(comp?.name ?? 'Obrtnik Pro')}${comp?.contact ? ` · ${esc(comp.contact)}` : ''}</span>
    <span>Vrednosti orientacijske — končni odmerek potrdimo na terenu (trak/laser). ${MEASURE_REPORT_VERSION}</span>
  </div>
</body>
</html>`;
}

/** Skrito okvirčno tiskanje (iframe) — deluje tudi na mobilnem
 *  Safariju, kjer je window.open + print zanesljivo blokiran.
 *  Vrne false, če DOM/tisk ni dosegljiv. */
export function printMeasureReport(html: string): boolean {
  if (typeof document === 'undefined') return false;
  const body = document.body;
  if (!body) return false;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Tisk merilnega poročila');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
  body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // brskalnik brez tiskalnega API — pusti vsebino (uporabnik lahko odpre ročno)
    }
    // okvirček odstranimo šele čez minuto (tiskalni dialog potrebuje dokument)
    window.setTimeout(() => iframe.remove(), 60_000);
  }, 350);
  return true;
}
