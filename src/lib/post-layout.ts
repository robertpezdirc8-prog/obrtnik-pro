// ─── Razpored stebrov + razrez polnil iz izmerjene trase ─────
// Čisto skriptno, 0 AI. Vhod: profil trase {runCm, dropCm} po odsekih
// (veriga iz fotke — Task 17 + segmentsDrop, Task 25) ali ravna daljica.
// Standardi montaže (research/task25):
//  · enakomerna porazdelitev: N = ceil(osnova / maxSpan) + 1 stebrov,
//    dejanski razmak = osnova / (N − 1) — brez "ostanka" na koncu;
//  · racked (sledi naklonu): razpon merjen po naklonu (skupni tek),
//    priporočeno do ~15° (≈ 27 %) — nad tem stopničasto;
//  · stepped (stopničasto): razpon merjen vodoravno (projekcija),
//    polnilo na spodnji strani višje za padec celote (razrez po meri).

import { formatCm } from './measure-geometry';

export type LayoutMode = 'racked' | 'stepped';

export interface PostLayoutInput {
  /** dolžine odsekov trase v cm (po naklonu) */
  segRunCm: number[];
  /** terenski dvig na odsek v cm, pozitivno = navzgor (isti indeks kot segRunCm) */
  segDropCm: number[];
  /** način montaže: racked (sledi naklonu) | stepped (stopničasto) */
  mode: LayoutMode;
  /** največji dovoljeni razmak stebrov v cm (privzeto 150) */
  maxSpanCm: number;
  /** bazna višina polnila v cm (privzeto 190) */
  panelHeightCm: number;
}

export interface PostPlan {
  /** lega stebra ob osnovi (cm od začetka: racked po trasi, stepped vodoravno) */
  xCm: number;
  /** relativna višina terena na stebrišču (cm; 0 = začetek trase) */
  groundCm: number;
  /** višina zgornjega roba ograje na stebrišču (cm; bazna višina + teren) */
  topCm: number;
}

export interface BayPlan {
  index: number;
  /** širina celote (razmak med stebri) v cm */
  widthCm: number;
  /** terenski dvig znotraj celote (cm; + navzgor, − navzdol) */
  riseCm: number;
  /** rezalna višina polnila v cm (stepped: bazna višina + |dvig celote|; racked: bazna višina) */
  cutHeightCm: number;
  /** dolžina vzdolžnice po naklonu v cm (racked, naklon > 2°) */
  slantCm: number | null;
}

export interface PostLayoutResult {
  mode: LayoutMode;
  /** skupni tek trase (po naklonu) v cm */
  runCm: number;
  /** vodoravni razpon trase v cm */
  spanCm: number;
  /** absolutna višinska razlika začetek → konec v cm */
  riseCm: number;
  /** naklon cele trase v stopinjah */
  slopeDeg: number;
  /** osnova za porazdelitev (racked: runCm, stepped: spanCm) */
  baseCm: number;
  postCount: number;
  /** dejanski enakomerni razmak v cm (na 0,1 cm) */
  spacingCm: number;
  /** največji dovoljeni razmak (vhod) */
  maxSpanCm: number;
  panelHeightCm: number;
  posts: PostPlan[];
  bays: BayPlan[];
  /** razrez polnil po velikostih: "3 × 150 × 190 cm", … */
  cutLines: string[];
  /** površina polnil za odmerkek (m², 2 dec.) */
  areaM2: number;
  warnings: string[];
}

const MAX_SPAN_MIN = 60;
const MAX_SPAN_MAX = 300;
const PANEL_H_MIN = 30;
const PANEL_H_MAX = 300;
/** priporočeni naklon za racked montažo (stopinje) — nad tem opozorilo */
export const RACKED_MAX_DEG = 15;
/** opozorilo pri stepped, če je padec celote > 30 % širine */
const STEPPED_DROP_WARN = 0.3;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Načrtuj razpored stebrov in razrez polnil po izmerjeni trasi.
 * Vrne null, kadar je vhod neuporaben (prekratka trasa ali ven iz razponov).
 */
export function planPostLayout(input: PostLayoutInput): PostLayoutResult | null {
  const { mode } = input;
  const segRun = input.segRunCm.map((s) => Number(s)).filter((s) => Number.isFinite(s) && s > 0);
  const segDrop = input.segDropCm.map((d) => (Number.isFinite(d) ? Number(d) : 0));
  const maxSpan = Number(input.maxSpanCm);
  const panelH = Number(input.panelHeightCm);

  if (segRun.length === 0) return null;
  if (!Number.isFinite(maxSpan) || maxSpan < MAX_SPAN_MIN || maxSpan > MAX_SPAN_MAX) return null;
  if (!Number.isFinite(panelH) || panelH < PANEL_H_MIN || panelH > PANEL_H_MAX) return null;

  // profil: kumulativne lege (lokalne funkcije — brez spremembe vhoda)
  const runCm = r1(segRun.reduce((s, v) => s + v, 0));
  // vodoravne projekcije odsekov (stepped osnova)
  const segHoriz = segRun.map((run, i) => {
    const drop = Math.abs(segDrop[i] ?? 0);
    return Math.sqrt(Math.max(0, run * run - drop * drop));
  });
  const spanCm = r1(segHoriz.reduce((s, v) => s + v, 0));
  const riseCm = r1(Math.abs(segDrop.reduce((s, v) => s + v, 0)));
  const slopeDeg = spanCm > 0 ? Math.round((Math.atan(runCm === spanCm ? 0 : riseCm / spanCm) * 180) / Math.PI * 10) / 10 : 0;
  // dejanski naklon trase po odsekih → povprečni kot za racked opozorilo
  const worstDeg = (() => {
    let worst = 0;
    for (let i = 0; i < segRun.length; i++) {
      const h = Math.max(0.01, segHoriz[i]);
      const deg = (Math.atan(Math.abs(segDrop[i] ?? 0) / h) * 180) / Math.PI;
      if (deg > worst) worst = deg;
    }
    return Math.round(worst * 10) / 10;
  })();

  const baseCm = mode === 'racked' ? runCm : spanCm;
  if (baseCm < 40) return null;

  // enakomerna porazdelitev: N stebrov, N − 1 celot
  const bayCount = Math.max(1, Math.ceil(baseCm / maxSpan - 1e-9));
  const postCount = bayCount + 1;
  const spacingCm = r1(baseCm / bayCount);
  // širine celot: vse = razmak, zadnja = ostanek (vsota = osnova)
  const bayWidths: number[] = [];
  for (let i = 0; i < bayCount; i++) {
    bayWidths.push(i === bayCount - 1 ? r1(baseCm - spacingCm * (bayCount - 1)) : spacingCm);
  }

  // teren na poljubni legi ob osnovi (kumulativna interpolacija po profilu):
  // racked → lega po loku trase (kumulativni run); stepped → vodoravno (kumulativna projekcija)
  const groundAt = (x: number): number => {
    let acc = 0;
    let h = 0;
    for (let i = 0; i < segRun.length; i++) {
      const segLen = mode === 'racked' ? segRun[i] : segHoriz[i];
      const end = acc + segLen;
      const t = segLen > 0 ? Math.min(1, Math.max(0, (x - acc) / segLen)) : 0;
      if (x <= end) return h + (segDrop[i] ?? 0) * t;
      h += segDrop[i] ?? 0;
      acc = end;
    }
    return h;
  };

  const posts: PostPlan[] = [];
  {
    let acc = 0;
    for (let i = 0; i < postCount; i++) {
      const x = i === postCount - 1 ? baseCm : r1(acc);
      const g = groundAt(x);
      posts.push({ xCm: r1(x), groundCm: r1(g), topCm: r1(panelH + g) });
      acc += i < bayCount ? bayWidths[i] : 0;
    }
  }

  const bays: BayPlan[] = [];
  for (let i = 0; i < postCount - 1; i++) {
    const g0 = posts[i].groundCm;
    const g1 = posts[i + 1].groundCm;
    const rise = r1(g1 - g0);
    const width = bayWidths[i];
    // stepped: polnilo zapolni do terena na nižji strani → višje za |dvig celote|
    const cutH = mode === 'stepped' ? r1(panelH + Math.abs(rise)) : panelH;
    // racked: vzdolžnica po naklonu celote
    const segDeg = width > 0 ? (Math.atan(Math.abs(rise) / width) * 180) / Math.PI : 0;
    const slant = mode === 'racked' && segDeg > 2 ? r1(Math.hypot(width, Math.abs(rise))) : null;
    bays.push({ index: i + 1, widthCm: width, riseCm: rise, cutHeightCm: cutH, slantCm: slant });
  }

  // razrez polnil po PRIKAZANI velikosti (1,43 m × 1,90 m) — iste velikosti se združijo
  const bySize = new Map<string, { w: number; h: number; n: number }>();
  for (const b of bays) {
    const key = `${formatCm(b.widthCm)}x${formatCm(b.cutHeightCm)}`;
    const cur = bySize.get(key) ?? { w: b.widthCm, h: b.cutHeightCm, n: 0 };
    cur.n += 1;
    bySize.set(key, cur);
  }
  const cutLines = [...bySize.values()]
    .sort((a, b) => b.n - a.n || a.w - b.w)
    .map((v) => `${v.n} × ${formatCm(v.w)} × ${formatCm(v.h)}`);

  const areaM2 = Math.round((bays.reduce((s, b) => s + (b.widthCm * b.cutHeightCm) / 10000, 0)) * 100) / 100;

  const warnings: string[] = [];
  if (mode === 'racked' && worstDeg > RACKED_MAX_DEG) {
    warnings.push(`Naklon odseka ${worstDeg.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}° — večina sistemov priporoča stopničasto montažo nad ${RACKED_MAX_DEG}°.`);
  }
  if (mode === 'stepped' && riseCm > 0) {
    const worstBay = Math.max(...bays.map((b) => Math.abs(b.riseCm) / Math.max(1, b.widthCm)));
    if (worstBay > STEPPED_DROP_WARN) {
      warnings.push('Padec v posamezni celoti je velik — razmisli o racked montaži ali krajšem razponu.');
    }
  }
  if (riseCm === 0 && mode === 'stepped') {
    warnings.push('Tereno je ravno — stopničasta montaža ni potrebna.');
  }
  if (spacingCm > maxSpan + 0.05) {
    warnings.push('Razmak je večji od želenega (prekratka trasa za to število stebrov).');
  }

  return {
    mode,
    runCm,
    spanCm,
    riseCm,
    slopeDeg,
    baseCm: r1(baseCm),
    postCount,
    spacingCm,
    maxSpanCm: maxSpan,
    panelHeightCm: panelH,
    posts,
    bays,
    cutLines,
    areaM2,
    warnings,
  };
}

/** Kratko večvrstično besedilo načrta (za kopiranje v beležko/WA). */
export function formatLayoutText(r: PostLayoutResult, label: string): string {
  const modeLbl = r.mode === 'racked' ? 'sledi naklonu (racked)' : 'stopničasto (stepped)';
  const lines: string[] = [];
  lines.push(`Razpored stebrov — ${label}`);
  lines.push(`Trasa: ${formatCm(r.runCm)} po naklonu · vodoravno ${formatCm(r.spanCm)} · dvig ${formatCm(r.riseCm)} · ${r.slopeDeg.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}°`);
  lines.push(`Montaža: ${modeLbl} · stebri: ${r.postCount} · razmak: ${formatCm(r.spacingCm)}`);
  lines.push('Celote:');
  for (const b of r.bays) {
    const rise = b.riseCm === 0 ? 'raven' : `${b.riseCm > 0 ? '+' : '−'}${formatCm(Math.abs(b.riseCm))}`;
    const slant = b.slantCm !== null ? ` · vzdolžnica ${formatCm(b.slantCm)}` : '';
    lines.push(`  ${b.index}. šir. ${formatCm(b.widthCm)} · dvig ${rise} · rez. viš. ${formatCm(b.cutHeightCm)}${slant}`);
  }
  lines.push(`Polnila: ${r.cutLines.join(' · ')}`);
  lines.push(`Površina polnil: ${r.areaM2.toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`);
  if (r.warnings.length > 0) lines.push(`Opozorila: ${r.warnings.join(' ')}`);
  return lines.join('\n');
}

/** CSV načrta (za Excel/LibreOffice,decimalna vejica). */
export function layoutToCsv(r: PostLayoutResult, label: string): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const num = (v: number) => String(v).replace('.', ',');
  const rows: string[] = [];
  rows.push([esc('Razpored stebrov'), esc(label)].join(','));
  rows.push(['vrsta,stevilo,razmak_cm,nacin,tek_cm,razpon_cm,dvig_cm,naklon_deg'].join(','));
  rows.push([
    esc('stebri'),
    String(r.postCount),
    num(r.spacingCm),
    esc(r.mode === 'racked' ? 'sledi naklonu' : 'stopničasto'),
    num(r.runCm),
    num(r.spanCm),
    num(r.riseCm),
    num(r.slopeDeg),
  ].join(','));
  rows.push(['celota,sirina_cm,dvig_cm,rezalna_visina_cm,vdolznica_cm'].join(','));
  for (const b of r.bays) {
    rows.push([
      String(b.index),
      num(b.widthCm),
      num(b.riseCm),
      num(b.cutHeightCm),
      b.slantCm !== null ? num(b.slantCm) : '',
    ].join(','));
  }
  rows.push(['razrez,velikost'].join(','));
  for (const line of r.cutLines) rows.push([esc(line)].join(','));
  rows.push([esc('povrsina_polnil_m2'), num(r.areaM2)].join(','));
  for (const w of r.warnings) rows.push([esc(`OPOZORILO: ${w}`)].join(','));
  return rows.join('\n');
}

/** Prenesi CSV z BOM (Excel prijazno). */
export function downloadLayoutCsv(r: PostLayoutResult, label: string): void {
  const csv = layoutToCsv(r, label);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `razpored-stebrov-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
