// ─── Test natančnosti: referenčni nabor + statistika napak ────
// Baseline Faza 7 (docs/MEASUREMENT-BASELINE.md §4): »številke o
// napaki NISO merjene — cilji ostanejo cilji, ne obljube«. Ta
// skripta je orodje za neodvisen preizkus na objektu: monter izmeri
// znano dolžino (trak/laser = resnica), aplikacija izmeri isto z
// svojo metodo, zapisek dobi absolutno/relativno napako. Iz nabora
// se računa iskrena statistika (mediana, P95, delež v toleranci).
// 0 AI, deterministično. Enote: cm.

export type AccuracyMethod =
  | 'foto-mera'
  | 'skica-prostora'
  | 'vecpogled'
  | 'ar'
  | 'laser'
  | 'rocno';

export const ACCURACY_METHODS: Array<{ id: AccuracyMethod; label: string }> = [
  { id: 'foto-mera', label: 'Foto mera (referenca)' },
  { id: 'skica-prostora', label: 'Skica prostora' },
  { id: 'vecpogled', label: 'Večpogled (2 fotki)' },
  { id: 'ar', label: 'AR merjenje' },
  { id: 'laser', label: 'Laser (kontrola)' },
  { id: 'rocno', label: 'Ročni vnos s fotke' },
];

export const METHOD_LABEL: Record<AccuracyMethod, string> = Object.fromEntries(
  ACCURACY_METHODS.map((m) => [m.id, m.label]),
) as Record<AccuracyMethod, string>;

export interface AccuracyEntry {
  id: string;
  /** Oznaka testa (»Vrata dnevna soba«). */
  label: string;
  method: AccuracyMethod;
  /** Resnica iz traku/urejenega laserja (cm). */
  trueCm: number;
  /** Vrednost, ki jo je izmerila aplikacija (cm). */
  measuredCm: number;
  /** Opomba (referenca, razmere …). */
  note?: string;
  recordedAt: string;
}

export interface EntryError {
  absCm: number;
  pct: number;
  pass: boolean;
}

/** Napaka posameznega zapiska (relativno na resnico). */
export function entryError(e: AccuracyEntry, tolerancePct: number): EntryError {
  const absCm = Math.abs(e.measuredCm - e.trueCm);
  const pct = e.trueCm > 0 ? (absCm / e.trueCm) * 100 : Infinity;
  return { absCm, pct, pass: pct <= tolerancePct };
}

export type AccuracyVerdict = 'nezadostno' | 'potrebna-izboljsava' | 'osnovno' | 'zanesljivo';

export interface AccuracyStats {
  n: number;
  /** Mediana relativne napake (%). */
  medianPct: number;
  /** Povprečje relativne napake (%). */
  meanPct: number;
  /** 95. percentil relativne napake (%) — linearna interpolacija. */
  p95Pct: number;
  /** Največja relativna napaka (%). */
  maxPct: number;
  /** Delež zapiskov v toleranci (0–1). */
  passRate: number;
  verdict: AccuracyVerdict;
  verdictLabel: string;
  verdictHint: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Iskrena statistika nabora. POGODBA: manj kot 5 meritev NE sme
 *  trditi nič o natančnosti ('nezadostno'). */
export function aggregateStats(entries: AccuracyEntry[], tolerancePct: number): AccuracyStats {
  const n = entries.length;
  if (n === 0) {
    return {
      n: 0,
      medianPct: NaN,
      meanPct: NaN,
      p95Pct: NaN,
      maxPct: NaN,
      passRate: 0,
      verdict: 'nezadostno',
      verdictLabel: 'Ni meritev',
      verdictHint: 'Dodaj vsaj 5 testov na realnem objektu (znana dolžina + izmerjena dolžina).',
    };
  }
  const errs = entries.map((e) => entryError(e, tolerancePct).pct);
  const sorted = [...errs].sort((a, b) => a - b);
  const medianPct = percentile(sorted, 0.5);
  const meanPct = errs.reduce((s, x) => s + x, 0) / n;
  const p95Pct = percentile(sorted, 0.95);
  const maxPct = sorted[sorted.length - 1];
  const passRate = errs.filter((p) => p <= tolerancePct).length / n;

  let verdict: AccuracyVerdict;
  let verdictLabel: string;
  let verdictHint: string;
  if (n < 5) {
    verdict = 'nezadostno';
    verdictLabel = `Premalo meritev (${n}/5)`;
    verdictHint =
      'Za trditev o natančnosti potrebuje vsaj 5 testov. Številke spodaj so informativne, DOKAZ še ni.';
  } else if (medianPct <= tolerancePct && p95Pct <= tolerancePct) {
    verdict = 'zanesljivo';
    verdictLabel = 'Zanesljivo v toleranci';
    verdictHint = `Mediana in P95 sta pod toleranco ${tolerancePct} % — nabor ${n} meritev podpira trditev.`;
  } else if (medianPct <= tolerancePct) {
    verdict = 'osnovno';
    verdictLabel = 'Mediana v toleranci, izstopajoči primeri';
    verdictHint = `Mediana je v toleranci, ampak P95 (${percentile(sorted, 0.95).toFixed(1)} %) je nad ${tolerancePct} % — preveri pogoje izstopajočih testov (pošen fotke, referenca, svetloba).`;
  } else {
    verdict = 'potrebna-izboljsava';
    verdictLabel = 'Nad toleranco';
    verdictHint = `Mediana (${medianPct.toFixed(1)} %) je nad toleranco ${tolerancePct} % — najpogosteje zmotna referenca ali pošen posnetek. Testiraj na ravnini z jasno referenco.`;
  }
  return { n, medianPct, meanPct, p95Pct, maxPct, passRate, verdict, verdictLabel, verdictHint };
}

/** CSV z BOM in ; ločilom (slovenski Excel). */
export function statsToCsv(entries: AccuracyEntry[], tolerancePct: number): string {
  const head = 'oznaka;metoda;resnica_cm;izmerjeno_cm;napaka_cm;napaka_pct;v_toleranci;cas';
  const rows = entries.map((e) => {
    const err = entryError(e, tolerancePct);
    return [
      e.label.replace(/;/g, ','),
      METHOD_LABEL[e.method],
      e.trueCm,
      e.measuredCm,
      err.absCm.toFixed(2).replace('.', ','),
      err.pct.toFixed(2).replace('.', ','),
      err.pass ? 'DA' : 'NE',
      e.recordedAt,
    ].join(';');
  });
  return '\uFEFF' + [head, ...rows].join('\n');
}

/** Prenos CSV datoteke (kot downloadMeasuresCsv v measure-geometry). */
export function downloadAccuracyCsv(
  entries: AccuracyEntry[],
  tolerancePct: number,
  filename = 'test-natanchnosti.csv',
): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([statsToCsv(entries, tolerancePct)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
