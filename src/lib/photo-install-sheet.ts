// ─── MONTAŽNI LIST ZA MONTERJA (iz fotomontaže) ──────────────────────────
// Zakaj obstaja: ROKSAL na svoji strani o ograjah (prebrano 2026-10-19,
// roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/)
// dobesedno pravi:
//   »Pri načrtovanju prenove vaše ograje potrebujemo informacijo, na kakšni
//    razdalji so stebrički, saj bo ravno ta podatek vplival na izbo profila
//    in izkoristek materiala.«
//   »deske se spajajo na dolžino obvezno na stebru, zato razmak neposredno
//    vpliva na količino materiala in odpada«.
//
// Do danes je fotomontaža (photo-replace-core.ts) risala ENO ravnino brez
// vmesnih stebrov (`postEveryCm = null`), kosovnica (photo-bom.ts) pa je zato
// iskreno javila »stebri niso modelirani«. Ta modul zapre to vrzel brez
// izmišljanja: monter vpiše IZMERJEN razmak stebrov, modul pa iz njega
// deterministično izpelje celote, rez na stebru, število desk, rezalni načrt
// in odpad — ter pokaže RAZLIKO proti eni sami ravnini (to je denar, ki ga
// razmak stebrov požre ali prihrani).
//
// ISKRENOST (načela repozitorija):
//  - nič ne ocenjujemo: če širina ravnine ni izmerjena, list NI narejen in
//    `blockers` pove, kaj manjka (nobene številke, ki bi bila videti kot podatek);
//  - stebrov in pritrdil NE dodajamo v kosovnico — niso modelirani v upodobitvi;
//    list jih našteje kot OPOMNIK za monterja;
//  - meja razmika se citira iz roksal-span-rules.ts; kadar ROKSAL meje ne
//    objavi, modul NE ugiba, ampak reče UNKNOWN;
//  - cene niso del lista (ROKSAL cen ne prevajamo — vpiše jih obrtnik).
//
// Vse so čiste funkcije: isti vhodi → identičen list (determinizem).

import type { ReplaceMetadata } from './photo-replace-core';
import { cenikFor, CENIK_DATE, CENIK_SOURCE } from './roksal-cenik-2026';
import { ROKSAL_PROFILES } from './roksal-assets';
import { maxAllowedSpan } from './roksal-span-rules';

export const PHOTO_INSTALL_SHEET_VERSION = 'photo-install-sheet-v1';

export type BaySource = 'measured' | 'assumed';

export interface InstallerSheetInput {
  /** metapodatki shranjene različice fotomontaže (korak 7) */
  meta: ReplaceMetadata;
  /** razmak med stebri v cm — pri obnovi IZMERJEN na objektu, sicer predlog */
  bayCm: number;
  /** 'measured' = monter je meril; 'assumed' = predlog, list to pove na vrhu */
  baySource: BaySource;
  /** širina stebra v cm; null/undefined = tipen privzetek profila */
  postCm?: number | null;
  /** višina polnila v cm; null/undefined = višina ravnine iz fotomontaže */
  panelHeightCm?: number | null;
}

export interface InstallerBay {
  index: number;
  fromCm: number;
  toCm: number;
  widthCm: number;
  /** število desk v tej celoti */
  plankCount: number;
  /** dolžina reza deske v tej celoti (cm) */
  cutLenCm: number;
  /** zadnja celota je praviloma ožja — rez iz nje je drugačen */
  isLast: boolean;
}

export interface StockPlan {
  cutLenCm: number;
  /** koliko nabavnih profilov te dolžine potrebujemo */
  count: number;
  stockCm: number;
  /** koliko rezov gre iz enega profila */
  perStock: number;
  /** odpad na profil (cm) */
  wasteCm: number;
  /** odpad v % nabavljene dolžine */
  wastePct: number;
}

export interface SpanCheck {
  /** meja, ki jo sme monter uporabiti; 0 = ROKSAL je ne objavi */
  maxSpanCm: number;
  status: 'ok' | 'over' | 'unknown';
  /** dobesedni citat pravila, kadar meja obstaja */
  quote: string | null;
  source: string | null;
}

/** Rezalni načrt, pripravljen za žago: katere deske (številke) so katere dolžine. */
export interface CutListRow {
  /** celota (1..n) */
  bay: number;
  /** številke desk v tej celoti (1-based, vodoravno po ograji) */
  boardFrom: number;
  boardTo: number;
  /** dolžina reza te deske v cm */
  cutLenCm: number;
  /** oznaka za delavnico: »12–13: 190 cm« */
  label: string;
}

export interface InstallerSheet {
  version: string;
  profileId: string;
  profileLabel: string;
  orientation: 'horizontal' | 'vertical';
  /** dolžina trase (širina ravnine iz fotomontaže) v cm; null = ni izmerjena */
  runCm: number | null;
  panelHeightCm: number;
  bayCm: number;
  baySource: BaySource;
  postCm: number;
  /** lege osi stebrov od začetka trase (cm), vedno vključuje oba konca */
  postPositionsCm: number[];
  postCount: number;
  bays: InstallerBay[];
  boards: number;
  cutLenCm: number;
  totalMeters: number;
  stocks: StockPlan[];
  /** primerjava: ena sama ravnina brez vmesnih stebrov (kot doslej) */
  singleRun: {
    boards: number;
    cutLenCm: number;
    totalMeters: number;
    stocks: StockPlan[];
  };
  /** dodatni odpad v cm, ki ga prinese spajanje na stebrih (lahko negativen) */
  extraWasteCm: number;
  /** rezalni načrt po deskah (za žago) */
  cutList: CutListRow[];
  /** uradni ROKSAL cenik za izbrani profil (orientacija, ne avtomatska cena) */
  cenik: { code: string; name: string; unit: string; net: number; gross: number; date: string; source: string } | null;
  span: SpanCheck;
  /** list NI narejen — monter mora najprej izmeriti/odločiti */
  blockers: string[];
  warnings: string[];
  /** dobesedni viri, na katere se list sklicuje */
  sources: string[];
  /** merilna kontrola vnesene širine proti strukturi ograje (iz metapodatkov) */
  measureCheck?: string | null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Ista opozorila se ne ponavljajo (npr. isto manjkajoče gradivo za dva reza). */
const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Uradne nabavne dolžine po družinah — prevzeto iz photo-bom.ts (isti vir). */
const FAMILY_STOCK_CM: Array<{ prefix: string; stockCm: number; vir: string }> = [
  { prefix: 'polna-57-32', stockCm: 580, vir: 'uradna stran: 57 × 32 × 5800 mm' },
  { prefix: 'polna-100', stockCm: 580, vir: 'uradna stran: 100 × 12 × 5800 mm' },
  { prefix: 'polna-128', stockCm: 220, vir: 'uradna stran: 128 × 16 × 2200 mm (pokončno)' },
  { prefix: 'romb-67', stockCm: 580, vir: 'uradna stran: 67 × 26 × 5800 mm' },
];

export const JOIN_ON_POST_SOURCE =
  'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/ — ' +
  '»deske se spajajo na dolžino obvezno na stebru, zato razmak neposredno vpliva ' +
  'na količino materiala in odpada«';

export const POST_SPACING_IS_KEY_SOURCE =
  'roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/ — ' +
  '»Pri načrtovanju prenove vaše ograje potrebujemo informacijo, na kakšni razdalji ' +
  'so stebrički, saj bo ravno ta podatek vplival na izbiro profila in izkoristek materiala.«';

/** Rezalni načrt za ENO dolžino reza; [] kadar uradne nabavne dolžine ni. */
function stockPlanFor(cutLenCm: number, boards: number, profileId: string, warnings: string[]): StockPlan[] {
  if (boards <= 0 || cutLenCm <= 0) return [];
  const fam = FAMILY_STOCK_CM.find((f) => profileId.startsWith(f.prefix)) ?? null;
  if (!fam) {
    warnings.push('Uradna nabavna dolžina za ta profil ni objavljena — rezalni načrt ni nastavljen (vpiši št. paketov ročno).');
    return [];
  }
  if (cutLenCm > fam.stockCm) {
    warnings.push(
      `Rez ${r1(cutLenCm)} cm presega uradno nabavno dolžino (${fam.stockCm} cm, ${fam.vir}) — ` +
        'rezalni načrt ni nastavljen; deske bi se morale spajati še po dolžini, kar ta list ne modelira.',
    );
    return [];
  }
  const perStock = Math.max(1, Math.floor(fam.stockCm / cutLenCm));
  const count = Math.ceil(boards / perStock);
  const totalStockCm = count * fam.stockCm;
  const wasteCm = totalStockCm - boards * cutLenCm;
  return [{
    cutLenCm: r1(cutLenCm),
    count,
    stockCm: fam.stockCm,
    perStock,
    wasteCm: r1(wasteCm),
    wastePct: r1((wasteCm / totalStockCm) * 100),
  }];
}

/**
 * Zgradi montažni list za monterja iz metapodatkov fotomontaže.
 * Nikoli ne vrže za manjkajoče meritve — vrne `blockers`, ker je to list,
 * ki ga monter dopolni (razen za pokvarjene metapodatke, kar je napaka klica).
 */
export function buildInstallerSheet(input: InstallerSheetInput): InstallerSheet {
  const meta: ReplaceMetadata | undefined = input?.meta;
  if (!meta || typeof meta !== 'object') {
    throw new Error('NEZADOSTNI PODATKI: metapodatki fotomontaže manjkajo.');
  }

  const warnings: string[] = [];
  const blockers: string[] = [];
  const sources: string[] = [POST_SPACING_IS_KEY_SOURCE, JOIN_ON_POST_SOURCE];

  const profile = ROKSAL_PROFILES.find((p) => p.id === meta.profileId) ?? null;
  if (!profile) warnings.push(`Profil ${meta.profileId} ni več v katalogu — uporabljene shranjene mere različice.`);

  const numParam = (k: string): number | null => {
    const v = meta.params?.[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const plankCm = profile ? profile.plankCm : numParam('elementCm');
  const gapCm = profile ? profile.gapCm : numParam('spacingCm');
  const orientation: 'horizontal' | 'vertical' =
    profile ? profile.orientation : meta.params?.pattern === 'terasa' ? 'horizontal' : 'vertical';

  const runCm: number | null = meta.planeCm?.wCm ?? null;
  const panelHeightCm = input.panelHeightCm ?? meta.planeCm?.hCm ?? 0;
  const postCm = input.postCm ?? profile?.postCm ?? 0;
  const bayCm = Number.isFinite(input.bayCm) ? r1(input.bayCm) : 0;
  const baySource: BaySource = input.baySource === 'measured' ? 'measured' : 'assumed';

  const base: InstallerSheet = {
    version: PHOTO_INSTALL_SHEET_VERSION,
    profileId: meta.profileId,
    profileLabel: meta.profileLabel,
    orientation,
    runCm,
    panelHeightCm: r1(panelHeightCm),
    bayCm,
    baySource,
    postCm,
    postPositionsCm: [],
    postCount: 0,
    bays: [],
    boards: 0,
    cutLenCm: 0,
    totalMeters: 0,
    stocks: [],
    singleRun: { boards: 0, cutLenCm: 0, totalMeters: 0, stocks: [] },
    extraWasteCm: 0,
    cutList: [],
    cenik: null,
    span: { maxSpanCm: 0, status: 'unknown', quote: null, source: null },
    blockers,
    warnings,
    sources,
    measureCheck:
      typeof meta.params?.measureCheck === 'string' && meta.params.measureCheck
        ? meta.params.measureCheck
        : null,
  };

  if (runCm === null) {
    blockers.push(
      'ŠIRINA RAVNINE NI IZMERJENA: brez ene izmerjene dolžine ni rezov ne metrov. ' +
        'Izmeri dolžino trase in potrdi umerjanje ravnine (pravilo 11).',
    );
  } else if (!(runCm > 0)) {
    blockers.push('ŠIRINA RAVNINE NI VELJAVNA: izmerjena dolžina mora biti pozitivna.');
  }
  if (!(bayCm > 0)) {
    blockers.push('RAZMAK STEBROV NI VNESEN: to je po ROKSALovih besedah ključni podatek za izbiro profila in izkoristek materiala.');
  } else if (bayCm < 10) {
    blockers.push(`RAZMAK STEBROV ${bayCm} cm ni realen (spodnja meja tega lista je 10 cm) — preveri meritev.`);
  }
  if (plankCm === null || gapCm === null) {
    blockers.push('MERE ELEMENTA/REŽE NISO ZNANE: profil ni v katalogu, shranjene mere pa jih ne vsebujejo.');
  }
  if (!(panelHeightCm > 0)) {
    blockers.push('VIŠINA POLNILA NI ZNANA: brez nje ni dolžine reza pri pokončnih deskah.');
  }

  // ── Meja razmika stebrov: citirana, nikoli ugibana ──────────────
  const verdict = maxAllowedSpan({ family: 'ograja', context: 'posts', panelHeightCm });
  const span: SpanCheck = {
    maxSpanCm: verdict.maxSpanCm,
    status: verdict.maxSpanCm > 0 ? (bayCm > verdict.maxSpanCm ? 'over' : 'ok') : 'unknown',
    quote: verdict.binding ? verdict.binding.quote : null,
    source: verdict.binding ? verdict.binding.source : null,
  };
  base.span = span;
  if (span.status === 'over') {
    blockers.push(
      `RAZMAK ${bayCm} cm PRESEGA MEJO ${verdict.maxSpanCm} cm (${span.source ?? 'vir v pravilu'}). ` +
        `${span.quote ?? ''} — dodaj stebre ali izberi drug profil.`,
    );
  } else if (span.status === 'unknown') {
    warnings.push(
      'ROKSAL za ta profil MEJE razmika stebrov ne objavi — list je zato ne postavi sam. ' +
        'Razmak mora potrditi monter (navodila stroke), sicer številke niso mejene.',
    );
  }
  if (baySource === 'assumed') {
    warnings.push(
      'Razmak stebrov je PREDLOG, ne meritev na objektu. List je zato osnutek — ' +
        'pred naročilom materiala razmak izmeri (ROKSAL: razmak vpliva na izbiro profila in izkoristek).',
    );
  }
  warnings.push(
    'Stebri in pritrdilni material v tem listu NISO kosovnica: upodobitev jih ne modelira. ' +
      'List jih navaja kot opomnik — količine vpiši iz kataloga dobavitelja.',
  );

  if (blockers.length > 0 || plankCm === null || gapCm === null || runCm === null) {
    return { ...base, warnings: uniq(warnings) };
  }

  // ── Celote med stebri (spajanje NA stebru je ROKSALovo pravilo) ──
  const pitch = plankCm + gapCm;
  const bayCount = Math.max(1, Math.ceil(runCm / bayCm - 1e-9));
  const positions: number[] = [];
  for (let i = 0; i < bayCount; i += 1) positions.push(r1(i * bayCm));
  const lastPos = positions[positions.length - 1] as number;
  if (lastPos < r1(runCm)) positions.push(r1(runCm));
  else positions[positions.length - 1] = r1(runCm);

  const bays: InstallerBay[] = [];
  for (let i = 0; i < positions.length - 1; i += 1) {
    const fromCm = positions[i] as number;
    const toCm = positions[i + 1] as number;
    const widthCm = r1(toCm - fromCm);
    const plankCount = orientation === 'vertical'
      ? Math.floor((widthCm + gapCm) / pitch)
      : Math.floor((panelHeightCm + gapCm) / pitch);
    const cutLenCm = orientation === 'vertical' ? panelHeightCm : widthCm;
    bays.push({
      index: i + 1,
      fromCm,
      toCm,
      widthCm,
      plankCount,
      cutLenCm: r1(cutLenCm),
      isLast: i === positions.length - 2,
    });
  }

  const boards = bays.reduce((s, b) => s + b.plankCount, 0);
  const totalMeters = r1(bays.reduce((s, b) => s + b.plankCount * b.cutLenCm, 0) / 100);

  // ── Rezalni načrt: ločeno po dolžini reza (zadnja celota je ožja) ──
  const byLen = new Map<number, number>();
  for (const b of bays) byLen.set(b.cutLenCm, (byLen.get(b.cutLenCm) ?? 0) + b.plankCount);
  const stocks: StockPlan[] = [];
  for (const [len, n] of byLen) stocks.push(...stockPlanFor(len, n, meta.profileId, warnings));
  stocks.sort((a, b) => b.cutLenCm - a.cutLenCm);
  if (stocks.length > 1) {
    warnings.push(
      `Dva različna reza (${stocks.map((s) => `${s.cutLenCm} cm`).join(' in ')}) — ` +
        'zadnja celota je ožja od razmaka, zato je ne mešaj v isti nabavni kos.',
    );
  }

  // ── Primerjava: ena sama ravnina brez vmesnih stebrov (kot doslej) ──
  const singleBoards = orientation === 'vertical'
    ? Math.floor((runCm + gapCm) / pitch)
    : Math.floor((panelHeightCm + gapCm) / pitch);
  const singleCut = orientation === 'vertical' ? panelHeightCm : runCm;
  const singleStocks = stockPlanFor(singleCut, singleBoards, meta.profileId, []);
  const singleRun = {
    boards: singleBoards,
    cutLenCm: r1(singleCut),
    totalMeters: r1((singleBoards * singleCut) / 100),
    stocks: singleStocks,
  };

  const sumWaste = (list: StockPlan[]): number => list.reduce((s, x) => s + x.wasteCm, 0);
  const extraWasteCm = r1(sumWaste(stocks) - sumWaste(singleStocks));

  if (boards > 300) warnings.push(`Zelo veliko elementov (${boards}) — preveri mere ali ravnino.`);
  if (bays.length > 0) {
    const last = bays[bays.length - 1] as InstallerBay;
    if (last.widthCm < 30) {
      warnings.push(
        `Zadnja celota je široka samo ${last.widthCm} cm — preveri, ali se razmak stebrov izide; ` +
          'ozek ostanek je najpogostejši vir odpadka.',
      );
    }
  }

  // Rezalni načrt za žago: deske po celotah, z zaporednimi številkami.
  let boardNo = 0;
  const cutList: CutListRow[] = bays.map((b) => {
    const from = boardNo + 1;
    boardNo += b.plankCount;
    const to = boardNo;
    return {
      bay: b.index,
      boardFrom: from,
      boardTo: to,
      cutLenCm: b.cutLenCm,
      label:
        b.plankCount === 1
          ? `deska ${from}: ${b.cutLenCm.toFixed(0)} cm`
          : `deske ${from}–${to}: ${b.cutLenCm.toFixed(0)} cm`,
    };
  });

  // Uradni cenik (orientacija): prva vnosna družina profila.
  const family = meta.profileId.replace(/-dekor-\d+$/, '');
  const cenikItem = cenikFor(family)[0] ?? null;

  return {
    ...base,
    cutList,
    cenik: cenikItem
      ? {
          code: cenikItem.code,
          name: cenikItem.name,
          unit: cenikItem.unit,
          net: cenikItem.net,
          gross: cenikItem.gross,
          date: CENIK_DATE,
          source: CENIK_SOURCE.fences,
        }
      : null,
    postPositionsCm: positions,
    postCount: positions.length,
    bays,
    boards,
    cutLenCm: orientation === 'vertical' ? r1(panelHeightCm) : r1((bays[0] as InstallerBay).cutLenCm),
    totalMeters,
    stocks,
    singleRun,
    extraWasteCm,
    blockers,
    warnings: uniq(warnings),
    span,
  };
}


// ─── Tisk/PDF: montažni list kot HTML (brez odvisnosti, brez mreže) ───────

export interface SheetHtmlOptions {
  /** datum izdaje (podan od zunaj = determinizem); privzeto prazno polje */
  datum?: string;
  obrtnik?: string;
  objekt?: string;
  /** fotomontaža (data URL) — če je ni, je na listu prostor za nalepko */
  imageDataUrl?: string | null;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cm = (n: number): string => `${n.toFixed(1).replace('.', ',')} cm`;

/** Zgradi natisljiv HTML montažnega lista. Vse številke pridejo iz `sheet`. */
export function buildInstallerSheetHtml(sheet: InstallerSheet, opts: SheetHtmlOptions = {}): string {
  const ready = sheet.blockers.length === 0 && sheet.bays.length > 0;
  const rowsPosts = sheet.postPositionsCm
    .map((p, i) => `<tr><td>${i + 1}</td><td>${cm(p)}</td><td>${i === 0 ? '—' : cm(p - (sheet.postPositionsCm[i - 1] as number))}</td></tr>`)
    .join('');
  const rowsBays = sheet.bays
    .map((b) => `<tr><td>${b.index}${b.isLast ? ' (zadnja)' : ''}</td><td>${cm(b.fromCm)} – ${cm(b.toCm)}</td><td>${cm(b.widthCm)}</td><td>${b.plankCount}</td><td>${cm(b.cutLenCm)}</td></tr>`)
    .join('');
  const rowsStock = sheet.stocks
    .map((s) => `<tr><td>${cm(s.cutLenCm)}</td><td>${s.count}</td><td>${cm(s.stockCm)}</td><td>${s.perStock}</td><td>${cm(s.wasteCm)} (${s.wastePct.toFixed(1).replace('.', ',')} %)</td></tr>`)
    .join('');

  const blockers = sheet.blockers.length
    ? `<section class="block"><h2>LIST NI NATISLJIV — manjka</h2><ul>${sheet.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>`
    : '';
  const warnings = sheet.warnings.length
    ? `<section><h2>Opozorila (iskreno)</h2><ul>${sheet.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>`
    : '';
  const spanLine = sheet.span.status === 'unknown'
    ? 'ROKSAL meje za ta profil ne objavi — razmak potrjuje monter.'
    : `${sheet.span.maxSpanCm} cm${sheet.span.status === 'over' ? ' — PREKORAČENO' : ' — v mejah'}`;

  return `<!DOCTYPE html>
<html lang="sl"><head><meta charset="utf-8"><title>Montažni list — ${esc(sheet.profileLabel)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 12px/1.45 ui-sans-serif, system-ui, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .box { border: 1px solid #bbb; padding: 8px 10px; }
  .block { border: 2px solid #b00020; padding: 10px 12px; background: #fff4f4; }
  .block h2 { border: 0; color: #b00020; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; font-variant-numeric: tabular-nums; }
  th { background: #f2f2f2; font-weight: 600; }
  .kpi { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .kpi div { border: 1px solid #bbb; padding: 6px 10px; min-width: 110px; }
  .kpi b { display: block; font-size: 17px; }
  img.shot { width: 100%; max-height: 95mm; object-fit: contain; border: 1px solid #bbb; background: #eee; }
  .sign { display: flex; gap: 24px; margin-top: 26px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; }
  .src { font-size: 10px; color: #444; }
  footer { margin-top: 18px; font-size: 10px; color: #666; }
</style></head><body>
<div class="head">
  <div>
    <h1>MONTAŽNI LIST ZA MONTERJA</h1>
    <div class="muted">${esc(sheet.profileLabel)}</div>
    <div class="muted">Razmak stebrov: <b>${cm(sheet.bayCm)}</b> (${sheet.baySource === 'measured' ? 'izmerjen' : 'PREDLOG — ni izmerjen'})</div>
  </div>
  <div class="box">
    <div>Obrt: <b>${esc(opts.obrtnik ?? '—')}</b></div>
    <div>Objekt: ${esc(opts.objekt ?? '—')}</div>
    <div>Datum: ${esc(opts.datum ?? '—')}</div>
    <div class="muted">${sheet.version}</div>
  </div>
</div>

${blockers}


${opts.imageDataUrl ? `<img class="shot" src="${esc(opts.imageDataUrl)}" alt="fotomontaža">` : '<p class="muted">Fotomontaža ni priložena — prilepi izpis iz koraka 7.</p>'}

<section>
  <h2>1. Izmera in meja</h2>
  <div class="kpi">
    <div>Trasa<b>${sheet.runCm === null ? '—' : cm(sheet.runCm)}</b></div>
    <div>Višina polnila<b>${cm(sheet.panelHeightCm)}</b></div>
    <div>Stebrov<b>${sheet.postCount}</b></div>
    <div>Desk<b>${ready ? sheet.boards : '—'}</b></div>
    <div>Skupaj metrov<b>${ready ? `${sheet.totalMeters.toFixed(2).replace('.', ',')} m` : '—'}</b></div>
  </div>
  <p class="muted">Meja razmika po ROKSALovih pravilih: ${esc(spanLine)}</p>
</section>

${ready ? `
<section><h2>2. Lega stebrov (od začetka trase)</h2>
<table><thead><tr><th>#</th><th>Lega</th><th>Razmak do prejšnjega</th></tr></thead><tbody>${rowsPosts}</tbody></table>
<p class="muted">Deske se po ROKSALovih navodilih spajajo NA stebru — zato so celote med stebri ločene.</p></section>

<section><h2>3. Celote in deske</h2>
<table><thead><tr><th>Celota</th><th>Od – do</th><th>Širina</th><th>Desk</th><th>Rez deske</th></tr></thead><tbody>${rowsBays}</tbody></table></section>

<section><h2>4. Rezalni načrt (za žago) in nabavni kosi</h2>
${sheet.cutList.length > 0 ? `<table><thead><tr><th>Deske (številke po ograji)</th><th>Celota</th><th>Dolžina reza</th></tr></thead><tbody>${sheet.cutList.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.bay}</td><td>${cm(c.cutLenCm)}</td></tr>`).join('')}</tbody></table>` : ''}
${sheet.stocks.length ? `<table><thead><tr><th>Rez</th><th>Nabavnih kosov</th><th>Nabavna dolžina</th><th>Rezov na kos</th><th>Odpad</th></tr></thead><tbody>${rowsStock}</tbody></table>` : '<p class="muted">Rezalni načrt ni nastavljen (glej opozorila).</p>'}
<p class="muted">Primerjava z eno samo ravnino brez vmesnih stebrov: ${sheet.singleRun.boards} desk, ${sheet.singleRun.totalMeters.toFixed(2).replace('.', ',')} m —
razlika v odpadku: <b>${sheet.extraWasteCm > 0 ? '+' : ''}${cm(sheet.extraWasteCm)}</b>.</p></section>
` : ''}

${warnings}

${sheet.cenik ? `<section><h2>Uradni ROKSAL cenik (orientacija)</h2>
<p><b>${esc(sheet.cenik.code)}</b> — ${esc(sheet.cenik.name)}: ${sheet.cenik.net.toFixed(2).replace('.', ',')} € neto / ${sheet.cenik.gross.toFixed(2).replace('.', ',')} € brutto na ${esc(sheet.cenik.unit)}.
Cenik z dne ${esc(sheet.cenik.date)} — ${esc(sheet.cenik.source)}. V ponudbo ceno vpiše obrtnik; tu je le referenca.</p></section>` : ''}

<section><h2>Opomnik za monterja (ni kosovnica)</h2>
<ul class="muted">
  <li>Stebri: ${sheet.postCm > 0 ? `profil stebra ${cm(sheet.postCm)}` : 'profil stebra ni znan'} — količino vpiši iz kataloga.</li>
  <li>Pritrdila: predvrtanje je obvezno, luknja 1 mm večja od vijaka (ROKSAL FAQ).</li>
  <li>Deske se spajajo na dolžino obvezno na stebru; stebri morajo biti v ravnini.</li>
  ${sheet.measureCheck ? `<li>${esc(sheet.measureCheck)}</li>` : ''}
</ul></section>

<section class="src"><h2>Viri</h2><ul>${sheet.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>

<div class="sign"><div>Izmeril / datum</div><div>Naročnik / datum</div><div>Montiral / datum</div></div>
<footer>Narejeno iz fotomontaže ${esc(sheet.profileId)} — številke so izračunane iz vnesenih mer, ne ocenjene. Cene niso del lista.</footer>
</body></html>`;
}

