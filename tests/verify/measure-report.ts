// Numerična verifikacija measure-report (bun, brez brskalnika) — Task 40
// Ročno izračunana resnica: SVG tloris (Y-zrcaljenje, oznake, iskrenost),
// HTML poročilo (iztiskanje, sl-SI format, iskrenost, varnost).
import {
  buildSketchSvg,
  buildMeasureReportHTML,
  LEVEL_LABEL,
  MEASURE_REPORT_VERSION,
  type MeasureReportOptions,
} from '../../src/lib/measure-report';
import { closeRoomPolygon, type WallInput } from '../../src/lib/room-sketch';
import type { PhotoMeasure } from '../../src/lib/camera-types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(got)}`);
  }
}

const mk = (
  id: string,
  label: string,
  kind: PhotoMeasure['kind'],
  value: number | null,
  points: [number, number][] = [],
): PhotoMeasure => ({ id, label, kind, value, points });

// ── Fiksature ───────────────────────────────────────────────
// Pravokotna soba 5 × 3 m: napaka 5 cm → adjusted, ploščina 15,07 m²
const rectWalls: WallInput[] = [
  { lengthCm: 500, angleDeg: 90 },
  { lengthCm: 300, angleDeg: 90 },
  { lengthCm: 505, angleDeg: 90 },
  { lengthCm: 300, angleDeg: 90 },
];
const adjustedSketch = closeRoomPolygon(rectWalls)!;

// Zaprt kvadrat 4 × 4 m → closed, 16 m²
const closedSketch = closeRoomPolygon([
  { lengthCm: 400, angleDeg: 90 },
  { lengthCm: 400, angleDeg: 90 },
  { lengthCm: 400, angleDeg: 90 },
  { lengthCm: 400, angleDeg: 90 },
])!;
check('fiksatura: kvadrat closed', closedSketch.level === 'closed', closedSketch.level);
check('fiksatura: kvadrat 16 m²', Math.abs(closedSketch.areaM2! - 16) < 0.01, closedSketch.areaM2);
check('fiksatura: pravokotnik adjusted 15,07 m²', adjustedSketch.level === 'adjusted' && Math.abs(adjustedSketch.areaM2! - 15.07) < 0.01, adjustedSketch);

// Odprt poligon (300 cm napake) → open, ploščina null
const openSketch = closeRoomPolygon([
  { lengthCm: 500, angleDeg: 90 },
  { lengthCm: 300, angleDeg: 90 },
  { lengthCm: 500, angleDeg: 90 },
  { lengthCm: 600, angleDeg: 90 },
])!;
check('fiksatura: open brez ploščine', openSketch.level === 'open' && openSketch.areaM2 === null, openSketch);

// ── 1) buildSketchSvg — geometrija in iskrenost ─────────────
{
  const svg = buildSketchSvg(closedSketch);
  check('SVG: vsebuje <svg in viewBox', svg.includes('<svg') && svg.includes('viewBox="0 0 560 400"'), svg.slice(0, 120));

  // Y-zrcaljenje: matematično CCW tloris — točka (0,0) mora biti v SVG SPODAJ
  // (velik y), točka (0,400) zgoraj (mali y). Vertices kvadrata: (0,0),(400,0),(400,400),(0,400),(0,0).
  const ys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  check('SVG: 4 oglišča (brez podvojenega)', ys.length === 4, ys);
  const cyOf = (py: number): number => {
    // rekonstruiraj transformacijo iz knjižnice: PAD 40, H 400, k = min(480/400, 320/400) = 0,8
    const PAD = 40;
    const k = 0.8;
    return 400 - PAD - py * k;
  };
  const yBottom = cyOf(0); // SVG y za matematični (0,0) — največji
  const yTop = cyOf(400); // SVG y za matematični (0,400) — najmanjši
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  check('SVG: Y zrcaljen — (0,0) spodaj', Math.abs(maxY - yBottom) < 1.5, { maxY, yBottom });
  check('SVG: Y zrcaljen — (0,400) zgoraj', Math.abs(minY - yTop) < 1.5, { minY, yTop });

  check('SVG: 4 oznake stranic "400 cm"', (svg.match(/400 cm/g) ?? []).length === 4, svg.match(/400 cm/g));
  check('SVG: closed — brez ≈ in brez črtkanja', !svg.includes('≈') && !svg.includes('stroke-dasharray'), null);
  check('SVG: closed — polnilna barva čez', svg.includes('rgba(217,119,6,0.10)'), null);
  check('SVG: žig površine 16 m²', svg.includes('16 m²'), svg.match(/[\d,]+ m²/g));
  check('SVG: determinističen', buildSketchSvg(closedSketch) === svg, null);

  // adjusted → ≈ oznake
  const svgAdj = buildSketchSvg(adjustedSketch);
  check('SVG adjusted: ≈ predpona', svgAdj.includes('≈ '), null);
  check('SVG adjusted: dolžine Bowditch 501,6', svgAdj.includes('≈ 501,6 cm') && svgAdj.includes('≈ 503,4 cm'), svgAdj.match(/≈ [\d,]+ cm/g));

  // open → črtkano rdeča, brez žiga ploščine
  const svgOpen = buildSketchSvg(openSketch);
  check('SVG open: stroke-dasharray', svgOpen.includes('stroke-dasharray="7 5"'), null);
  check('SVG open: rdeča obroba', svgOpen.includes('#dc2626'), null);
  check('SVG open: brez žiga ploščine', !svgOpen.includes('m²</text>'), null);
}

// ── 2) buildMeasureReportHTML — vsebina in varnost ──────────
const measures: PhotoMeasure[] = [
  mk('m1', 'Širina sobe', 'laser', 412),
  mk('m2', 'Višina', 'length', 250),
  mk('m3', 'Tla', 'area', 15.07),
  mk('m4', 'Kot', 'angle', 90),
];
const base: MeasureReportOptions = {
  measures,
  sketch: adjustedSketch,
  craftLabel: 'Keramika',
  company: { name: 'Obrt Novak s.p.', contact: 'Janez · 040 123 456', taxNumber: 'SI12345678' },
  location: 'Kranj, Cesta 1',
  now: new Date(2026, 1, 14, 10, 0, 0),
};

{
  const html = buildMeasureReportHTML(base);
  check('HTML: naslov MERILNO POROČILO', html.includes('MERILNO POROČILO'), null);
  check('HTML: ime obrta', html.includes('Obrt Novak s.p.'), null);
  check('HTML: davčna št.', html.includes('SI12345678'), null);
  check('HTML: datum 14. 02. 2026', html.includes('14. 02. 2026'), html.match(/Datum:[^<]*/));
  check('HTML: dejavnost Keramika', html.includes('Dejavnost: Keramika'), null);
  check('HTML: lokacija', html.includes('Kranj, Cesta 1'), null);

  // skica: SVG vgrajen + statistika v sl-SI formatu
  check('HTML: vsebuje SVG skico', html.includes('<svg'), null);
  check('HTML: površina 15,07 m²', html.includes('15,07 m²'), null);
  check('HTML: obseg 16,05 m (formatCm)', html.includes('16,05 m'), html.match(/Obseg[\s\S]{0,120}/));
  check('HTML: ovojnica 5,03 m', html.includes('5,03'), null);
  check('HTML: sodba adjusted', html.includes(LEVEL_LABEL.adjusted), null);
  check('HTML: zapiralna napaka 0,31 %', html.includes('0,31 %'), html.match(/zapiralna napaka[^<]*/));
  check('HTML: opozorilo Bowditch v poročilu', html.includes('Zaprtje poravnano po Bowditchu'), null);

  // tabela meritev: vse 4 vrstice z oznakami vrst
  check('HTML: 4 vrstice tabel', (html.match(/<tr>/g) ?? []).length >= 4, (html.match(/<tr>/g) ?? []).length);
  check('HTML: laser 4,12 m', html.includes('4,12 m'), html.match(/laser[\s\S]{0,80}/));
  check('HTML: površina 15,07 m² v tabeli', html.includes('15,07 m²'), null);
  check('HTML: kot 90°', html.includes('90°'), null);

  // iskrenost: noga + verzija
  check('HTML: iskrena noga (orientacijske)', html.includes('orientacijske'), null);
  check('HTML: verzija poročila', html.includes(MEASURE_REPORT_VERSION), null);

  // varnost: iztiskanje uporabniških nizov
  const xss: MeasureReportOptions = {
    ...base,
    measures: [mk('x', '<script>alert(1)</script>', 'laser', 100)],
    location: '"pokvarjeno" & <nevarno>',
  };
  const hx = buildMeasureReportHTML(xss);
  check('HTML: <script> iztiskan', !hx.includes('<script>alert') && hx.includes('&lt;script&gt;'), null);
  check('HTML: narekovaji in & iztiskani', hx.includes('&quot;pokvarjeno&quot; &amp; &lt;nevarno&gt;'), null);
  check('HTML: determinističen (isti now)', buildMeasureReportHTML(base) === html, null);
}

// brez skice — samo meritve; brez meritev — iskreno prazno
{
  const noSketch = buildMeasureReportHTML({ ...base, sketch: null });
  check('HTML brez skice: ni SVG sekcije', !noSketch.includes('<svg'), null);
  check('HTML brez skice: tabela ostane', noSketch.includes('Meritve (4)'), noSketch.match(/Meritve \(\d\)/));
  check('HTML brez skice: naslov ostane', noSketch.includes('MERILNO POROČILO'), null);

  const empty = buildMeasureReportHTML({
    measures: [],
    sketch: null,
    company: null,
    now: new Date(2026, 5, 1),
  });
  check('HTML prazno: iskreno »Brez zabeleženih meritev«', empty.includes('Brez zabeleženih meritev'), null);
  check('HTML prazno: privzeta znamka Obrtnik Pro', empty.includes('Obrtnik Pro'), null);
}

// open skica v poročilu — ploščina NI trdna
{
  const hOpen = buildMeasureReportHTML({ ...base, sketch: openSketch, now: new Date(2026, 1, 14) });
  check('HTML open: ploščina — (se ne zapre)', hOpen.includes('— (se ne zapre)'), hOpen.match(/Površina[\s\S]{0,120}/));
  check('HTML open: sodba open', hOpen.includes(LEVEL_LABEL.open), null);
  check('HTML open: ni žiga m² v SVG', !hOpen.includes('m²</text>'), null);
}

console.log(`\n${pass + fail} preverjanj · ${pass} OK · ${fail} NAPAK`);
if (fail > 0) process.exit(1);
