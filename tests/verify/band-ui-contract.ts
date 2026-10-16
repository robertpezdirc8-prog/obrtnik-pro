/**
 * Vir-gledna pogodba dvotapnega predloga ravnine (FAZA-9).
 *
 * Zakaj obstaja: `tests/e2e-band-ui.ts` dokazuje obnašanje v brskalniku, tri
 * stvari pa brskalnik doseči NE more:
 *  1. ponastavitev ob MENJAVI fotografije — input živi samo v prazni veji, do
 *     ponovnega nalaganja fotke današnji UI sploh ne pride,
 *  2. vrstni red vrat v `baseRenderBlocker` — napačen vrstni red se v brskalniku
 *     pokaže samo, kadar manjka več stvari hkrati (Task 78 je en tak par —
 *     potrjen predlog brez mere — zajel v `e2e-fotomontaza-real.ts`, a
 *     ostale kombinacije brskalnik ne more naložiti brez fotk v repozitoriju),
 *  3. nova pots, ki bi ravnino TAJNO potrdila (ali jo tiho naredila SUGGESTED).
 *
 * Torej: te trditve so ZAKLEPI OBLIKE IZVORA, ne obnašanja. Če se besedilo
 * premakne, pade preizkus — ne uporabnik. Obnaški del dokazuje E2E; ta datoteka
 * preprečuje, da bi ga kdo tiho izpraznil.
 *
 * Deterministično: brez mreže, brez brskalnika, samo branje datotek.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, info?: string): void {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (info ? ' — ' + info : ''));
  }
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI_REL = 'src/components/camera/foto-replace.tsx';
const CORE_STATUS = 'src/lib/measurement-status.ts';
const CORE_ASSERT = 'src/lib/assertion.ts';
const E2E_REL = 'tests/e2e-band-ui.ts';
const BAND_LIB = 'src/lib/band-suggest.ts';

const ui = readFileSync(join(ROOT, UI_REL), 'utf-8');
const coreStatus = readFileSync(join(ROOT, CORE_STATUS), 'utf-8');
const coreAssert = readFileSync(join(ROOT, CORE_ASSERT), 'utf-8');
const e2e = readFileSync(join(ROOT, E2E_REL), 'utf-8');
const bandLib = readFileSync(join(ROOT, BAND_LIB), 'utf-8');

function countOf(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Rezina med sidroma. Vrne '' če začetno sidro manjka ALI ni enolično — tako
 *  napačno sidro pade kot MANJKAJOČA trditev, ne kot lažen uspeh. Končno sidro
 *  je prvi zadetek ZA začetnim, zato mora biti začetno sidro enolično (skupina 1). */
function slice(hay: string, from: string, to: string): string {
  const a = hay.indexOf(from);
  const b = hay.indexOf(to, a + from.length);
  if (a === -1 || b === -1 || countOf(hay, from) !== 1) return '';
  return hay.slice(a, b);
}

function ordered(hay: string, marks: string[], label: string): void {
  const idx = marks.map((m) => hay.indexOf(m));
  const allFound = idx.every((i) => i !== -1);
  const sorted = allFound && idx.every((v, k) => k === 0 || v > idx[k - 1]);
  check(label, sorted, allFound ? `vrstni red ${idx.join(', ')}` : 'manjkaja oznaka');
}

// ── 1. Sidra morajo biti enolična, sicer vsi zaklepi nimajo smisla ──
console.log('\n1) enoličnost sidr');
for (const a of [
  'if (tool === \'band\') {',
  'const baseRenderBlocker',
  'planeCm && quadComplete && !planeConfirmed',
  'setQuadPct(res.quadPct)',
  'originalCanvasRef.current = orig',
]) {
  check(`sidro enolično v UI: ${a.slice(0, 34)}`, countOf(ui, a) === 1, `najdeno ${countOf(ui, a)}×`);
}

// ── 2. Menjava fotografije ponastavi VSE, kar velja samo za sliko ──
console.log('\n2) ponastavitev ob menjavi slike (do te poti brskalnik ne pride)');
const swapReset = slice(ui, 'originalCanvasRef.current = orig', '}, [imgEl]);');
check('ucinek menjave slike je najden', swapReset.length > 0);
ordered(
  swapReset,
  ['setQuadPct(null);', 'setCornerCount(0);', 'setPlaneConfirmed(true);', 'setBandTaps(null);', 'setBandInfo(null);', 'setTool(\'corners\');'],
  'ob novi sliki se štirikotnik, potrjenost, kliki in info ponastavijo (potrjenost NE preživi)',
);
check(
  'za to ponastavitev je zapisana INVARANTA, ne opomba o varovalki',
  /invariant/.test(swapReset),
  'manjka beseda "invariant" v komentarju',
);

// ── 3. Vrstni red vrat: domena veljavnosti je hujša od manjkajočega cm ──
console.log('\n3) vrstni red vrat izrisu');
const blocker = slice(ui, 'const baseRenderBlocker', 'const renderPromise = useMemo');
check('baseRenderBlocker je najden', blocker.length > 0);
ordered(
  blocker,
  ['if (!canRenderMontage(assurance.geo)) {', "'Vnesi višino ravnine v cm", 'if (layoutInfo.error)'],
  'nepotrjena geometrija ovira IZPRED centimetrov in IZPRED layout napake',
);
check('nepotrjen predlog ima ločeno besedilo (ne izposoji si višino)', /samodejni predlog/.test(blocker));
check(
  'potrjena in nepotrjena geometrija se ločita z ternarjem, ne z isto besedo',
  /planeConfirmed\s*\?[\s\S]{0,160}:/.test(blocker),
);
check('planeConfirmed je odvisnost mema (sicer bi bil blok zamrznjen)', /planeCm, planeConfirmed/.test(blocker));
check(
  'vrstni red ima utemeljitev z BRKALNIŠKO MERITVIJO, ne le z opisom',
  /izmerjeno[\s\S]{0,40}brskalnik/.test(blocker),
);
// Task 78, izmerjeno na PRAVI fotki: monter potrdi predlog, mere pa nima —
// `geo` ostane pod FITTED (planeCalibrated rabi cm), stara različica pa mu je
// pisala, naj označi oglišča, ki jih je že potrdil. Potrjena ravnina brez mere
// sme dobiti SAMO besedilo o meri.
const confirmedNoCm = slice(blocker, 'if (!canRenderMontage(assurance.geo)) {', 'return planeConfirmed');
check('veja za potrjeno ravnino brez mere obstaja', /planeConfirmed && !planeCm/.test(confirmedNoCm), 'manjka zgodnji return');
check('ta veja IMENUJE mero', confirmedNoCm.includes('Vnesi višino ravnine v cm'));
check('ta veja NE sme kriviti oglišč', !confirmedNoCm.includes('Geometrija ravnine ni potrjena'));
check(
  'isto dokazuje tudi E2E na pravi fotki (brez vnesene mere)',
  existsSync(join(ROOT, 'tests/e2e-fotomontaza-real.ts')) &&
    readFileSync(join(ROOT, 'tests/e2e-fotomontaza-real.ts'), 'utf-8').includes('manjkajočo mero v cm'),
  'e2e-fotomontaza-real.ts mora glasiti isto trditev',
);

// ── 4. Amber namestitev mora stati PRED zeleno ──
console.log('\n4) zelena značka ne sme prekriti predloga');
const amberIdx = ui.indexOf('planeCm && quadComplete && !planeConfirmed');
const greenIdx = ui.indexOf(') : planeCm && quadComplete ? (');
check('amber veja je najdena', amberIdx !== -1);
check('zelena veja je najdena', greenIdx !== -1);
check('amber veja PRIJE zelene (sicer SUGGESTED dobi Kalibrirano)', amberIdx !== -1 && greenIdx !== -1 && amberIdx < greenIdx, `amber ${amberIdx}, zelena ${greenIdx}`);
const amberBlock = ui.slice(amberIdx, greenIdx);
check('amber ima fr-plane-status test-id (E2E to bere)', /data-testid="fr-plane-status"/.test(amberBlock));
check('amber besedilo izvira iz JEDRA: label', amberBlock.includes("geometryLabel('SUGGESTED')"));
check('amber besedilo izvira iz JEDRA: hint', amberBlock.includes("geometryHint('SUGGESTED')"));
check('amber barva izvira iz JEDRA: color', amberBlock.includes("geometryColor('SUGGESTED').badge"));
check('amber NE sme uporabiti CALIBRATED značke', !/CALIBRATED/.test(amberBlock));
check('amber pove, da sta MERI resnična (ne zavrača vnesenega)', /sta resnični/.test(amberBlock));
check('amber pove, da perspektiva NE sme biti umerjena', /še NI umerjena/.test(amberBlock));
check(
  ' veja s samo višino loči potrjeno od PREDLAGANE (tretja neiskrenost)',
  /planeConfirmed \? 'potrjena \(4 oglišča\)' : 'PREDLAGANA in še NE potrjena'/.test(ui),
);

// ── 5. SUGGESTED sme nastati samo na enem mestu ──
console.log('\n5) edin izvor nepotrjene ravnine');
check('setPlaneConfirmed(false) ima ENO samo povodišče (pasovni predlog)', countOf(ui, 'setPlaneConfirmed(false)') === 1, `${countOf(ui, 'setPlaneConfirmed(false)')}×`);
check('setPlaneConfirmed(true) ima 5 mest (menjava slike, 4. oglišče, reset, potrdi, demo)', countOf(ui, 'setPlaneConfirmed(true)') === 5, `${countOf(ui, 'setPlaneConfirmed(true)')}×`);
const bandHandler = slice(ui, 'if (tool === \'band\') {', "if (tool === 'measure') {");
check('pasovni handler je najden', bandHandler.length > 0);
ordered(bandHandler, ['Pasu ograje ni bilo mogoče najti', 'setQuadPct(res.quadPct)', 'setPlaneConfirmed(false)'], 'zavrnitev se pojavi PRED nastankom predloga, predlog pa pred nastavitvijo nepotrjenosti');
check('predlog NE kalibrira mere (merilna mesta se pobrišejo)', bandHandler.includes('setMeasurePts(null); // predlog ni kalibracija'));
check('potrditev je ločen gumb (človek, ne modul)', ui.includes('const confirmSuggestion = () => {') && ui.includes('setPlaneConfirmed(true);'));
check('demo kvadrant se NE more postaviti kot predlog', /setPlaneConfirmed\(true\); \/\/ gumb pritisne/.test(ui));
check('četrto oglišče (človek) potrdi ravnino, vlečenje predlaganega oglišča NE', /if \(becomesFourth\) \{ setPlaneConfirmed\(true\)/.test(ui));

// ── 6. Jedro, ne UI, drži prag ──
console.log('\n6) jedrne trditve');
check('MIN_GEOMETRY_FOR_RENDER = FITTED', /MIN_GEOMETRY_FOR_RENDER: GeometricAssurance = 'FITTED'/.test(coreAssert));
check('canRenderMontage je odveden od praga, ne ročna primerjava', coreAssert.includes('geometryAtLeast(geo, MIN_GEOMETRY_FOR_RENDER)'));
check('SUGGESTED je v jedru poimenovan "Predlagana geometrija"', coreAssert.includes("SUGGESTED: 'Predlagana geometrija'"));
check('UI NE ponavlja jedrne besede (sicer bi jo lahko izpraznil brez vednosti)', !ui.includes('Predlagana geometrija'));
check('UI uvozi geometrijski besednjak iz jedra', /geometryColor, geometryHint, geometryLabel/.test(ui));
check('merilno jedro pozna planeConfirmed', coreStatus.includes('planeConfirmed?: boolean;'));
check('merilno jedro obravnava FALSE eksplicitno (undefined ≠ false)', coreStatus.includes('if (input.planeConfirmed === false) {'));

// ── 7. Izris ima en sam vhod ──
console.log('\n7) vhod v izris');
check('en sam gumb za izris (void onRender)', countOf(ui, 'void onRender()') === 1, `${countOf(ui, 'void onRender()')}×`);
check('en sam fr-render test-id', countOf(ui, 'data-testid="fr-render"') === 1);

// ── 8. Pasovni modul ne obljublja nagiba ──
console.log('\n8) pasovni modul (vir-gledno, dopolnjuje band-suggest 54/54)');
const bandExports = bandLib.split('\n').filter((l) => l.startsWith('export '));
check('noben izvoz nima nagiba v imenu (naklon NE ocenjuje)', !/tilt|nagib/i.test(bandExports.join('\n')), bandExports.join(' | ').slice(0, 120));
check(
  'dokumentirana trditev »NAKLONA modul NE OCENJUJE« je še vedno na mestu',
  /NAKLONA modul NE OCENJUJE/.test(bandLib),
  'kdo jo je prepisal — prepis mora biti zavestna odločitev, ne stranski produkt',
);
check('modul sam sebe imenuje PREDLOG (planeConfirmed: false v pogodbi)', bandLib.includes('planeConfirmed: false'));

// ── 9. E2E zaklep: en sintetični dogodek na klic, pošten v naslovu ──
console.log('\n9) merilna higiena v E2E');
check('E2E ima ENO samo mesto za mousePressed (en dogodek na klic)', countOf(e2e, "type: 'mousePressed'") === 1, `${countOf(e2e, "type: 'mousePressed'")}×`);
check('E2E ima ENO mesto za mouseReleased', countOf(e2e, "type: 'mouseReleased'") === 1);
check('E2E scrolla oder v viewport pred klikom (sicer klik pade tiho)', e2e.includes('scrollIntoView'));
check('E2E eksplicitno zavrne klik zunaj viewporta', /zunaj viewporta/.test(e2e));
check('E2E v naslovu pove, česa NE pokriva', e2e.includes('NE POKRIVA'));
check(
  'E2E preveri, da je posnetek res NAPISAN (velikost + vrž ob praznem odgovoru)',
  /statSync\(p\)\.size/.test(e2e) && /captureScreenshot vrnil/.test(e2e),
  'dokaz bi lahko izginil tiho — zgodovinski bug te datoteke',
);
check(
  'E2E razpakira CDP odgovor ENKROT (ne `params ?? msg`, kar je tiho sprlo zaslone)',
  /\.result \?\? \{\}/.test(e2e) && !/msg\.params \?\? \(msg as/.test(e2e),
);
check('E2E napoti na to datoteko (sklic živi)', e2e.includes('verify/band-ui-contract.ts'));
check('ta skript je v sweepu (ime se ujame z vzorcem tests/verify/*.ts)', /band-ui-contract\.ts$/.test(fileURLToPath(import.meta.url)));

console.log('');
console.log(`REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
