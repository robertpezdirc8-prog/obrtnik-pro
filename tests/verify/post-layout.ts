// Numerična verifikacija post-layout (bun, brez brskalnika) — Task 25
import {
  planPostLayout,
  formatLayoutText,
  layoutToCsv,
  RACKED_MAX_DEG,
  type PostLayoutResult,
} from '../../src/lib/post-layout';

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
const close = (a: number, b: number, tol = 0.2) => Math.abs(a - b) <= tol;

// 1) RAVNA trasa 10 m @ max 1,5 m → 8 stebrov, razmak 142,9 cm, vse celote enake
{
  const r = planPostLayout({ segRunCm: [1000], segDropCm: [0], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 });
  check('ravna: načrt obstaja', r !== null, r);
  check('ravna: 8 stebrov (ceil(1000/150)=7 celot + 1)', r?.postCount === 8, r?.postCount);
  check('ravna: razmak 142,9 cm ≤ 150', close(r?.spacingCm ?? 0, 142.9) && (r?.spacingCm ?? 0) <= 150, r?.spacingCm);
  check('ravna: 7 celot', r?.bays.length === 7, r?.bays.length);
  check('ravna: vsota širin = 1000', close(r!.bays.reduce((s, b) => s + b.widthCm, 0), 1000, 0.5), r!.bays.map((b) => b.widthCm));
  check('ravna: razrez v eni vrstici (7 × …)', r?.cutLines.length === 1 && r.cutLines[0].startsWith('7 ×'), r?.cutLines);
  check('ravna: brez opozoril', r?.warnings.length === 0, r?.warnings);
  check('ravna: površina ≈ 7 · 1,429 · 1,90 = 19,0 m²', close(r!.areaM2, 19.0, 0.2), r!.areaM2);
}

// 2) KLANEC racked: 506 + 500 cm, dvig 100 na 1. odseku → tops rastejo, potem konstanta
{
  const r = planPostLayout({ segRunCm: [506, 500], segDropCm: [100, 0], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 });
  check('klanec racked: run 1006, span ~996, rise 100', close(r!.runCm, 1006) && close(r!.spanCm, 996) && close(r!.riseCm, 100), [r!.runCm, r!.spanCm, r!.riseCm]);
  check('klanec racked: zadnji tops = 290 (190 + 100 dvig)', r!.posts.every((p, i) => (i >= 4 ? close(p.topCm, 290) : true)), r!.posts.map((p) => p.topCm));
  check('klanec racked: 1. top = 190', close(r!.posts[0].topCm, 190), r!.posts[0].topCm);
  check('klanec racked: dvigi celot [28,4×3, 14,8, 0×3]', r!.bays[0].riseCm === 28.4 && r!.bays[3].riseCm === 14.8 && r!.bays[6].riseCm === 0, r!.bays.map((b) => b.riseCm));
  check('klanec racked: cut višine = 190 (bazna)', r!.bays.every((b) => b.cutHeightCm === 190), r!.bays.map((b) => b.cutHeightCm));
  check('klanec racked: vzdolžnica > širine na naklonu', (r!.bays[0].slantCm ?? 0) > r!.bays[0].widthCm, r!.bays[0].slantCm);
  check('klanec racked: brez opozorila (max odsek ~11° < 15°)', r!.warnings.length === 0, r!.warnings);
}

// 3) KLANEC stepped: rezalne višine po padcu celote
{
  const r = planPostLayout({ segRunCm: [506, 500], segDropCm: [100, 0], mode: 'stepped', maxSpanCm: 150, panelHeightCm: 190 });
  check('klanec stepped: osnova = span (~996)', close(r!.baseCm, 996, 0.5), r!.baseCm);
  const rises = r!.bays.map((b) => Math.abs(b.riseCm));
  const cuts = r!.bays.map((b) => b.cutHeightCm);
  check('klanec stepped: cut = 190 + |dvig celote|', r!.bays.every((b, i) => close(b.cutHeightCm, 190 + rises[i], 0.1)), cuts);
  check('klanec stepped: vzdolžnice null', r!.bays.every((b) => b.slantCm === null), r!.bays.map((b) => b.slantCm));
  check('klanec stepped: razrez 3 velikosti', r!.cutLines.length === 3, r!.cutLines);
}

// 4) STRM odsek 35° racked → opozorilo nad 15°
{
  const r = planPostLayout({ segRunCm: [600], segDropCm: [346], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 });
  check('strm: opozorilo na racked limit', r!.warnings.some((w) => w.includes('stopničasto')), r!.warnings);
  check('strm: limit konstanta 15°', RACKED_MAX_DEG === 15, RACKED_MAX_DEG);
}

// 5) PADAJOČ teren (dvig negativen) → tops padajo
{
  const r = planPostLayout({ segRunCm: [700, 300], segDropCm: [-80, -40], mode: 'stepped', maxSpanCm: 200, panelHeightCm: 190 });
  check('padec: prvi top = 190, zadnji = 70 (190 − 120)', close(r!.posts[0].topCm, 190) && close(r!.posts.at(-1)!.topCm, 70), r!.posts.map((p) => p.topCm));
  check('padec: cut višji od bazne na padajočih celotah', r!.bays.every((b) => b.cutHeightCm > 190), r!.bays.map((b) => b.cutHeightCm));
}

// 6) RAVNO tereno + stepped → opozorilo "ni potreben"
{
  const r = planPostLayout({ segRunCm: [900], segDropCm: [0], mode: 'stepped', maxSpanCm: 150, panelHeightCm: 190 });
  check('ravno + stepped: opozorilo', r!.warnings.some((w) => w.includes('ni potrebna')), r!.warnings);
}

// 7) Neveljavni vhodi → null
{
  check('prekratka trasa → null', planPostLayout({ segRunCm: [10], segDropCm: [0], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 }) === null, null);
  check('razmak izven 60–300 → null', planPostLayout({ segRunCm: [1000], segDropCm: [0], mode: 'racked', maxSpanCm: 500, panelHeightCm: 190 }) === null, null);
  check('višina izven 30–300 → null', planPostLayout({ segRunCm: [1000], segDropCm: [0], mode: 'racked', maxSpanCm: 150, panelHeightCm: 500 }) === null, null);
  check('prazen profil → null', planPostLayout({ segRunCm: [], segDropCm: [], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 }) === null, null);
}

// 8) Oblikovanje: besedilo + CSV
{
  const r = planPostLayout({ segRunCm: [506, 500], segDropCm: [100, 0], mode: 'racked', maxSpanCm: 150, panelHeightCm: 190 }) as PostLayoutResult;
  const txt = formatLayoutText(r, 'Veriga 1');
  check('besedilo: glava z oznako', txt.startsWith('Razpored stebrov — Veriga 1'), txt.split('\n')[0]);
  check('besedilo: vsebuje stebri + razmak', txt.includes('stebri: 8') && txt.includes('razmak'), txt);
  check('besedilo: decimalna vejica', txt.includes('1,44 m'), txt);
  const csv = layoutToCsv(r, 'Veriga 1');
  check('csv: vrstica stebri', csv.includes('"stebri",8'), csv.split('\n')[2]);
  check('csv: 7 celot', csv.split('\n').filter((l) => /^\d+,/.test(l)).length === 7, csv.split('\n').filter((l) => /^\d+,/.test(l)).length);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
