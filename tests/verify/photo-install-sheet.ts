// Verifikacija MONTAŽNEGA LISTA ZA MONTERJA (photo-install-sheet.ts):
//   1) INVARIANTE: celote se sestejejo v trase; stebri so točno na mejah celot;
//      deske = vsota po celotah; metri = vsota rezov (nobena številka ni ocena);
//   2) SPAJANJE NA STEBRU: vodoravne deske se režejo po celoti (dva različna
//      reza, kadar zadnja celota ni enaka razmaku — ROKSAL: »spajajo se obvezno
//      na stebru«), pokončne po višini polnila;
//   3) ISKRENOST: brez izmerjene širine / brez razmaka / prekoračena meja →
//      `blockers` in NOBENE številke; meja razmika se citira, ne ugiba;
//   4) DETERMINIZEM: isti vhodi → identičen JSON lista in identičen HTML.
// Zagon: bun tests/verify/photo-install-sheet.ts
import {
  buildReplaceMetadata,
  computePlankLayouts,
  createMask,
  type ReplaceMetadata,
} from '../../src/lib/photo-replace-core';
import {
  buildInstallerSheet,
  buildInstallerSheetHtml,
  PHOTO_INSTALL_SHEET_VERSION,
} from '../../src/lib/photo-install-sheet';
import { maxAllowedSpan } from '../../src/lib/roksal-span-rules';
import { buildInstallerSheetMessage } from '../../src/lib/install-sheet-message';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};
const close = (a: number, b: number, eps = 0.051) => Math.abs(a - b) <= eps;

const QUAD: [[number, number], [number, number], [number, number], [number, number]] =
  [[10, 20], [90, 20], [90, 80], [10, 80]];
const IMG = { w: 1280, h: 890 };

const makeMeta = (o: {
  profileId: string; profileLabel: string;
  planeCm: { wCm: number | null; hCm: number };
  plankCm: number; gapCm: number; orientation: 'horizontal' | 'vertical';
}): ReplaceMetadata =>
  buildReplaceMetadata({
    profileId: o.profileId,
    profileLabel: o.profileLabel,
    catalogSku: null,
    texture: null,
    planeCm: o.planeCm,
    params: {
      pattern: o.orientation === 'horizontal' ? 'terasa' : 'vertikalne',
      elementCm: o.plankCm,
      spacingCm: o.gapCm,
      postEveryCm: 'null',
    },
    mask: createMask(IMG.w, IMG.h),
    layout: computePlankLayouts({
      quadPct: QUAD, imgSize: IMG,
      planeCm: { wCm: o.planeCm.wCm, hCm: o.planeCm.hCm },
      plankCm: o.plankCm, gapCm: o.gapCm, orientation: o.orientation,
      postCm: 6, postEveryCm: null,
    }),
    imgSize: IMG,
    inpaint: 'ok',
    warnings: [],
    createdAt: '2026-10-19T10:00:00.000Z',
  });

// POLNA-100: pokončno, deska 10 cm + reža 2 cm, tipen steber 6 cm.
const VERT = makeMeta({ profileId: 'polna-100', profileLabel: 'ROKSAL polna deska 100', planeCm: { wCm: 600, hCm: 190 }, plankCm: 10, gapCm: 2, orientation: 'vertical' });

console.log('Montažni list za monterja (photo-install-sheet) — deterministično, iskreno\n');

// ── 1) Celote, stebri, invariante ────────────────────────────────
{
  console.log('Celote med stebri (pokončno, trasa 600 cm, razmak 150 cm):');
  const s = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
  check('različica lista', s.version === PHOTO_INSTALL_SHEET_VERSION, s.version);
  check('brez blockers', s.blockers.length === 0, s.blockers);
  check('stebrov 5 (0, 150, 300, 450, 600)', s.postCount === 5 && s.postPositionsCm.join(',') === '0,150,300,450,600', s.postPositionsCm);
  check('celot 4', s.bays.length === 4, s.bays.length);
  check('vsota celot = trasa', close(s.bays.reduce((a, b) => a + b.widthCm, 0), 600), s.bays.reduce((a, b) => a + b.widthCm, 0));
  check('vsaka celota 150', s.bays.every((b) => close(b.widthCm, 150)), s.bays.map((b) => b.widthCm));
  check('steber je točno na meji celot', s.bays.every((b, i) => close(b.fromCm, s.postPositionsCm[i] as number) && close(b.toCm, s.postPositionsCm[i + 1] as number)), s.bays.map((b) => [b.fromCm, b.toCm]));
  check('desk na celoto 12 ((150+2)/12 = 12,67)', s.bays.every((b) => b.plankCount === 12), s.bays.map((b) => b.plankCount));
  check('skupaj 48 desk', s.boards === 48, s.boards);
  check('rez = višina polnila 190', s.bays.every((b) => close(b.cutLenCm, 190)), s.bays.map((b) => b.cutLenCm));
  check('metri 91,2', close(s.totalMeters, 91.2), s.totalMeters);
}

// ── 2) Rezalni načrt + primerjava z eno ravnino ──────────────────
{
  console.log('\nRezalni načrt in odpad (polna-100, uradnih 580 cm):');
  const s = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
  check('en sam rez (vse celote enake)', s.stocks.length === 1, s.stocks.length);
  const st = s.stocks[0]!;
  check('rezov na kos 3 (580/190)', st.perStock === 3, st.perStock);
  check('nabavnih kosov 16 (48/3)', st.count === 16, st.count);
  check('odpad 160 cm', close(st.wasteCm, 160), st.wasteCm);
  check('odpad 1,7 %', close(st.wastePct, 1.7), st.wastePct);
  check('primerjava: ena ravnina = 50 desk', s.singleRun.boards === 50, s.singleRun.boards);
  check('primerjava: ena ravnina = 17 kosov', s.singleRun.stocks[0]!.count === 17, s.singleRun.stocks[0]);
  check('razlika odpadka −200 cm (stebri zmanjšajo odpad)', close(s.extraWasteCm, -200), s.extraWasteCm);
}

// ── 3) Zadnja celota ožja + vodoravne deske (spajanje na stebru) ──
{
  console.log('\nZadnja celota ožja (trasa 500, razmak 150) — vodoravne deske:');
  const meta = makeMeta({ profileId: 'wpc-deka-140', profileLabel: 'WPC deka 140', planeCm: { wCm: 500, hCm: 180 }, plankCm: 14, gapCm: 0.4, orientation: 'horizontal' });
  const s = buildInstallerSheet({ meta, bayCm: 150, baySource: 'measured', panelHeightCm: 180 });
  check('stebrov 5 (zadnji na 500)', s.postPositionsCm.join(',') === '0,150,300,450,500', s.postPositionsCm);
  check('zadnja celota 50', close(s.bays.at(-1)!.widthCm, 50), s.bays.at(-1));
  check('zadnja celota označena', s.bays.at(-1)!.isLast === true, s.bays.at(-1));
  check('vodoravno: deske po višini ((180+0,4)/14,4 = 12)', s.bays.every((b) => b.plankCount === 12), s.bays.map((b) => b.plankCount));
  check('vodoravno: rez = širina celote (150 / 50)', close(s.bays[0]!.cutLenCm, 150) && close(s.bays.at(-1)!.cutLenCm, 50), s.bays.map((b) => b.cutLenCm));
  check('dva različna reza (150 in 50) — deske se režejo po celoti', s.bays[0]!.cutLenCm !== s.bays.at(-1)!.cutLenCm, s.bays.map((b) => b.cutLenCm));
  check('za deko 140 ROKSAL nabavne dolžine ne objavi → brez plana (iskreno)', s.stocks.length === 0, s.stocks);
  check('opozorilo: nabavna dolžina ni objavljena', s.warnings.some((w) => w.includes('Uradna nabavna dolžina za ta profil ni objavljena')), s.warnings);
  check('skupaj 48 desk (4 celote × 12)', s.boards === 48, s.boards);

  // ostanek 20 cm (trasa 470) → to je res ozek ostanek in list mora opozoriti
  const narrow = makeMeta({ profileId: 'wpc-deka-140', profileLabel: 'WPC deka 140', planeCm: { wCm: 470, hCm: 180 }, plankCm: 14, gapCm: 0.4, orientation: 'horizontal' });
  const sn = buildInstallerSheet({ meta: narrow, bayCm: 150, baySource: 'measured', panelHeightCm: 180 });
  check('ostanek 20 cm → opozorilo', sn.warnings.some((w) => w.includes('široka samo 20')), sn.warnings);
}

// ── 4) Iskrenost: česa list NOČE izračunati ──────────────────────
{
  console.log('\nIskrenost (brez meritev ni številk):');
  const noWidth = makeMeta({ profileId: 'wpc-deka-140', profileLabel: 'WPC deka 140', planeCm: { wCm: null, hCm: 180 }, plankCm: 14, gapCm: 0.4, orientation: 'horizontal' });
  const s1 = buildInstallerSheet({ meta: noWidth, bayCm: 150, baySource: 'assumed', panelHeightCm: 190 });
  check('brez širine → blockers', s1.blockers.some((b) => b.includes('ŠIRINA RAVNINE NI IZMERJENA')), s1.blockers);
  check('brez širine → 0 desk (nobene izmišljene številke)', s1.boards === 0 && s1.bays.length === 0, [s1.boards, s1.bays.length]);
  check('brez širine → 0 metrov', s1.totalMeters === 0, s1.totalMeters);

  const s2 = buildInstallerSheet({ meta: VERT, bayCm: 0, baySource: 'assumed', panelHeightCm: 190 });
  check('brez razmaka → blocker', s2.blockers.some((b) => b.includes('RAZMAK STEBROV NI VNESEN')), s2.blockers);

  const s3 = buildInstallerSheet({ meta: VERT, bayCm: 5, baySource: 'measured', panelHeightCm: 190 });
  check('razmak 5 cm → ni realen', s3.blockers.some((b) => b.includes('ni realen')), s3.blockers);

  const s4 = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'assumed', panelHeightCm: 190 });
  check('predlog razmaka → opozorilo PREDLOG', s4.warnings.some((w) => w.includes('PREDLOG')), s4.warnings);
  check('stebri niso kosovnica → opozorilo', s4.warnings.some((w) => w.includes('NISO kosovnica')), s4.warnings);

  let thrown = '';
  try { buildInstallerSheet({ meta: undefined as unknown as ReplaceMetadata, bayCm: 150, baySource: 'measured' }); }
  catch (e) { thrown = e instanceof Error ? e.message : String(e); }
  check('brez metapodatkov → jasna napaka', thrown.includes('NEZADOSTNI PODATKI'), thrown);
}


// ── 5) Meja razmika: citirana, ne ugibana ───────────────────────
{
  console.log('\nMeja razmika stebrov (iz roksal-span-rules):');
  const v = maxAllowedSpan({ family: 'ograja', context: 'posts', panelHeightCm: 190 });
  const s = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
  check('verdict in list se ujemata', s.span.maxSpanCm === v.maxSpanCm, [s.span.maxSpanCm, v.maxSpanCm]);
  if (v.maxSpanCm > 0) {
    check('meja obstaja → status ok/over', s.span.status === (150 > v.maxSpanCm ? 'over' : 'ok'), s.span.status);
    check('citat je priložen', typeof s.span.quote === 'string' && s.span.quote.length > 10, s.span.quote);
    const over = buildInstallerSheet({ meta: VERT, bayCm: v.maxSpanCm + 20, baySource: 'measured', panelHeightCm: 190 });
    check('prekoračitev → blocker', over.blockers.some((b) => b.includes('PRESEGA MEJO')), over.blockers);
    check('prekoračitev → ni desk', over.boards === 0, over.boards);
  } else {
    check('brez objavljene meje → status unknown', s.span.status === 'unknown', s.span.status);
    check('brez meje → opozorilo, da meje ni', s.warnings.some((w) => w.includes('MEJE razmika stebrov ne objavi')), s.warnings);
    check('brez meje → citata ni (ni izmišljen)', s.span.quote === null && s.span.source === null, s.span);
  }
}

// ── 6) Determinizem + tisk ──────────────────────────────────────
{
  console.log('\nDeterminizem in tisk:');
  const a = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
  const b = buildInstallerSheet({ meta: VERT, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
  check('isti vhodi → identičen JSON', JSON.stringify(a) === JSON.stringify(b));

  const html = buildInstallerSheetHtml(a, { datum: '2026-10-19', obrtnik: 'ROKSAL Kranj — montaža', objekt: 'Novo mesto 12' });
  check('HTML: naslov lista', html.includes('MONTAŽNI LIST ZA MONTERJA'));
  check('HTML: profil', html.includes('ROKSAL polna deska 100'));
  check('HTML: lega stebrov', html.includes('Lega stebrov'));
  check('HTML: celote in deske', html.includes('Celote in deske'));
  check('HTML: rezalni načrt', html.includes('Rezalni načrt'));
  check('HTML: viri (ROKSAL citat)', html.includes('spajajo na dolžino obvezno na stebru'));
  check('HTML: ni cene (nobene številke €)', !html.includes('€'), 'vsebuje €');
  check('HTML: determinističen', html === buildInstallerSheetHtml(b, { datum: '2026-10-19', obrtnik: 'ROKSAL Kranj — montaža', objekt: 'Novo mesto 12' }));
  check('HTML: escaper', buildInstallerSheetHtml(a, { obrtnik: '<script>x</script>' }).includes('&lt;script&gt;'), 'ni escapano');

  const blocked = buildInstallerSheet({ meta: VERT, bayCm: 0, baySource: 'assumed', panelHeightCm: 190 });
  const htmlBlocked = buildInstallerSheetHtml(blocked, {});
  check('HTML: blokiran list to pove', htmlBlocked.includes('LIST NI NATISLJIV'), 'ni opozorila');
  check('HTML: blokiran list nima tabele stebrov', !htmlBlocked.includes('Lega stebrov'), 'tabela je');
  const cutHtml = buildInstallerSheetHtml(a, {});
  check('HTML: rezalni načrt je v listu', cutHtml.includes('Rezalni načrt (za žago)') && cutHtml.includes('deske 1–12: 190'), 'izrez');
  check('HTML: rezalni načrt je v sporočilu', buildInstallerSheetMessage({ sheet: a }).includes('Rezalni načrt (za žago)'), 'sporočilo');
  check('opozorila so unikatna (React key + ni ponavljanja)', new Set(a.warnings).size === a.warnings.length, a.warnings);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);

