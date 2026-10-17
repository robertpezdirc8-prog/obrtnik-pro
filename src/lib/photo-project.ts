// ─── Projekt iz fotografij: združevanje analiz v ponudbo ────
// Čisto deterministično (brez omrežja, brez zunanjih storitev):
// za vsako analizirano fotografijo požene isto izračunsko skripto
// kot kalkulator (privzete vrednosti + predpolnitve analize +
// izmerjene meritve), nato postavke z enakim imenom sešteje.
// Primer: 2 fotki ograje po 8 m → ena postavka "Stebri" z 10,5 m.

import { runCalculator } from './pricing';
import { buildPrefillFromMeasures } from './measure-geometry';
import { normalizePhotoAnalysis, CRAFT_LABELS, type PhotoMeasure } from './camera-types';
import { CRAFT_INPUT_DEFAULTS } from './defaults';
import { applyCenik, readCenik, unpricedLines, type CenikValues } from './cenik';
import type { CalcLine, CraftId, CraftInputs } from './types';

/** Dejavnosti, za katere obstaja kalkulator (foto 'drugo' preskočimo). */
export const PROJECT_CRAFTS: CraftId[] = [
  'ograje',
  'stopnice',
  'keramika',
  'wpc-terasa',
  'okna-vrata',
  'nadstreški',
  'fasada',
];

/** Polja, ki jih beremo iz zapisa galerije (brez dataUrl — da je poceni). */
export interface PhotoProjectSource {
  id: string;
  title: string | null;
  craftId: string | null;
  analysis: string | null;
  measurements: string | null;
}

export interface ProjectGroup {
  craft: CraftId;
  craftLabel: string;
  photoCount: number;
  photoTitles: string[];
  lines: CalcLine[];
  /** brez DDV; `null` = vsaj ena vrstica nima vpisane cene */
  subtotal: number | null;
  /** koliko vrstic čaka na ceno — zaslon jih imenuje */
  unpriced: number;
}

export interface ProjectSummary {
  groups: ProjectGroup[];
  /** fotografije, ki so dejansko prispevale postavke */
  usedPhotos: number;
  /** preskočene (brez prepoznavne dejavnosti ali brez veljavnih mer) */
  skippedPhotos: number;
  /** skupaj brez DDV; `null`, dokler katera koli vrstica nima cene */
  total: number | null;
  unpriced: number;
}

interface AccGroup {
  titles: string[];
  lines: Map<string, { line: CalcLine; count: number }>;
}

/**
 * Sestavi povzetek projekta iz shranjenih fotografij.
 * Vrne skupine po dejavnosti s seštetimi postavkami — pripravljeno
 * za direkten vnos v osnutek ponudbe.
 *
 * `cenikValues` so VPISANE cene obrtnika (Task 88). Projekt izračuna
 * KOLIČINE; denar se pripne samo iz Cenika. Brez vpisane cene je
 * `subtotal` in `total` `null` — nikoli 0, nikoli ugibana urna postavka.
 * Prejšnji parameter `laborRate` s privzetkom `= 35` je cene celega
 * projekta gnal po številki, ki je obrtnik ni nastavil (Task 86/87).
 */
export function buildProjectFromPhotos(
  records: PhotoProjectSource[],
  cenikValues: CenikValues,
): ProjectSummary {
  const cenik = readCenik(cenikValues);
  const groups = new Map<CraftId, AccGroup>();
  let used = 0;
  let skipped = 0;

  for (const rec of records) {
    const craft = (rec.craftId ?? null) as CraftId | null;
    if (!craft || !PROJECT_CRAFTS.includes(craft)) {
      if (rec.craftId) skipped++;
      continue;
    }

    // 1) Predpolnitve iz shranjene analize (če obstaja)
    let prefill: Partial<CraftInputs> = {};
    try {
      if (rec.analysis) {
        const raw = JSON.parse(rec.analysis) as { analysis?: unknown };
        const a = normalizePhotoAnalysis(raw.analysis ?? raw);
        prefill = a.prefill ?? {};
      }
    } catch {
      /* brez analize → uporabijo se privzete vrednosti */
    }

    // 2) Meritve s fotografije → dodatne predpolnitve (daljice, površine…)
    let measures: PhotoMeasure[] = [];
    try {
      measures = rec.measurements ? (JSON.parse(rec.measurements) as PhotoMeasure[]) : [];
    } catch {
      measures = [];
    }
    if (!Array.isArray(measures)) measures = [];

    // 3) Isti izračun kot v kalkulatorju — ena skripta, en rezultat
    const inputs: CraftInputs = {
      ...CRAFT_INPUT_DEFAULTS,
      ...prefill,
      ...buildPrefillFromMeasures(craft, measures),
    };
    const { lines } = runCalculator(craft, inputs);
    if (lines.length === 0) {
      skipped++;
      continue;
    }
    used++;

    const g: AccGroup = groups.get(craft) ?? {
      titles: [],
      lines: new Map<string, { line: CalcLine; count: number }>(),
    };
    g.titles.push(rec.title ?? 'Zajem');
    for (const l of applyCenik(lines, cenik)) {
      const cur = g.lines.get(l.name);
      if (cur) {
        cur.line.quantity = r2(cur.line.quantity + l.quantity);
        cur.count += 1;
      } else {
        g.lines.set(l.name, { line: { ...l }, count: 1 });
      }
    }
    groups.set(craft, g);
  }

  const out: ProjectGroup[] = [];
  let total: number | null = 0;
  let unpricedTotal = 0;
  for (const [craft, g] of groups) {
    const lines: CalcLine[] = [...g.lines.values()].map(({ line, count }) => ({
      ...line,
      // Zaokroži na 2 decimalki — CV skripte lahko vrneta artefakte tipa 4,31999969…
      quantity: r2(line.quantity),
      description:
        count > 1
          ? [line.description, `seštevek po ${count} fotografijah`].filter(Boolean).join(' · ')
          : line.description,
    }));
    const unpriced = unpricedLines(lines).length;
    unpricedTotal += unpriced;
    // Brez vpisane cene se skupina NE sešteje v 0 — vsota projektira
    // denar, ki ga obrtnik še ni napisal.
    const subtotal = unpriced > 0 ? null : r2(lines.reduce((s, l) => s + l.quantity * (l.unitPrice as number), 0));
    if (subtotal !== null && total !== null) total = r2(total + subtotal);
    else total = null;
    out.push({
      craft,
      craftLabel: CRAFT_LABELS[craft],
      photoCount: g.titles.length,
      photoTitles: g.titles,
      lines,
      subtotal,
      unpriced,
    });
  }
  out.sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1));

  return {
    groups: out,
    usedPhotos: used,
    skippedPhotos: skipped,
    total: out.length === 0 ? 0 : total,
    unpriced: unpricedTotal,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
