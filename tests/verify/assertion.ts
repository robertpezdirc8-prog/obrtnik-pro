// Verifikacija dveh osi (FAZA-8): GEOMETRY/METRIC urejanje, TOTALNA tabela
// 25 parov projekcije, vsaka vrstica preglednice §3.2.1, poštenostne
// invariante, oznake/razlage/barve, agregata worst* in vratni pogoji
// (canRenderMontage NE sprašuje po cm; canExportOrder da NE pri
// katalogski višini).
// Zagon: bun tests/verify/assertion.ts
import {
  GEOMETRY_ORDER, METRIC_ORDER,
  geometryRank, metricRank, geometryAtLeast, metricAtLeast,
  worstGeometry, worstMetric,
  projectStatus, canRenderMontage, canExportOrder,
  MIN_GEOMETRY_FOR_RENDER, MIN_GEOMETRY_FOR_ORDER, MIN_METRIC_FOR_ORDER,
  geometryLabel, metricLabel, geometryHint, metricHint, geometryColor, metricColor,
  type GeometricAssurance, type MetricAssurance,
} from '../../src/lib/assertion';
import type { MeasurementStatus } from '../../src/lib/measurement-status';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// ── 1. Urejanje ozi ─────────────────────────────────────────
{
  console.log('urejanje ozi:');
  check('GEOMETRY_ORDER ima 5 ravni', GEOMETRY_ORDER.length === 5, String(GEOMETRY_ORDER.length));
  check('METRIC_ORDER ima 5 ravni', METRIC_ORDER.length === 5, String(METRIC_ORDER.length));
  check('geometrija: UNDEFINED < SUGGESTED < ORIENTED < FITTED < CONSISTENT',
    geometryRank('UNDEFINED') < geometryRank('SUGGESTED')
    && geometryRank('SUGGESTED') < geometryRank('ORIENTED')
    && geometryRank('ORIENTED') < geometryRank('FITTED')
    && geometryRank('FITTED') < geometryRank('CONSISTENT'));
  check('merilo: NONE < ASSUMED < REFERENCED < MEASURED < CROSS_CHECKED',
    metricRank('NONE') < metricRank('ASSUMED')
    && metricRank('ASSUMED') < metricRank('REFERENCED')
    && metricRank('REFERENCED') < metricRank('MEASURED')
    && metricRank('MEASURED') < metricRank('CROSS_CHECKED'));
  check('rang geometrije obsega 0–4', geometryRank('UNDEFINED') === 0 && geometryRank('CONSISTENT') === 4);
  check('rang merila obsega 0–4', metricRank('NONE') === 0 && metricRank('CROSS_CHECKED') === 4);
  check('neznana geometrija → rang −1', geometryRank('CALIBRATED' as unknown as GeometricAssurance) === -1);
  check('neznano merilo → rang −1', metricRank('MANUAL' as unknown as MetricAssurance) === -1);
  check('geometryAtLeast: FITTED doseže FITTED', geometryAtLeast('FITTED', 'FITTED'));
  check('geometryAtLeast: ORIENTED NE doseže FITTED', !geometryAtLeast('ORIENTED', 'FITTED'));
  check('geometryAtLeast: CONSISTENT doseže FITTED', geometryAtLeast('CONSISTENT', 'FITTED'));
  check('metricAtLeast: ASSUMED NE doseže REFERENCED', !metricAtLeast('ASSUMED', 'REFERENCED'));
  check('metricAtLeast: MEASURED doseže REFERENCED', metricAtLeast('MEASURED', 'REFERENCED'));
  // Osi sta disjunktni množici — to ve že tip, zato primerjava poteka prek
  // stringov: neposredna `g !== m` bi TS javil "no overlap", kar je ravno to,
  // kar test trdi.
  check('osi nista urejeni ena glede na drugo (ravni sta ločeni množici)',
    GEOMETRY_ORDER.every((g) => METRIC_ORDER.every((m) => (g as string) !== (m as string))));
}

// ── 2. TOTALNA tabela projekcije — 25/25 parov ──────────────
const EXPECTED: Record<GeometricAssurance, Record<MetricAssurance, MeasurementStatus | null>> = {
  UNDEFINED: { NONE: null, ASSUMED: null, REFERENCED: null, MEASURED: 'MANUAL', CROSS_CHECKED: 'VERIFIED' },
  SUGGESTED: { NONE: null, ASSUMED: null, REFERENCED: null, MEASURED: 'MANUAL', CROSS_CHECKED: 'VERIFIED' },
  ORIENTED: { NONE: null, ASSUMED: 'AUTO_SUGGESTED', REFERENCED: 'CALIBRATED', MEASURED: 'MANUAL', CROSS_CHECKED: 'VERIFIED' },
  FITTED: { NONE: null, ASSUMED: 'AUTO_SUGGESTED', REFERENCED: 'CALIBRATED', MEASURED: 'MANUAL', CROSS_CHECKED: 'VERIFIED' },
  CONSISTENT: { NONE: null, ASSUMED: 'AUTO_SUGGESTED', REFERENCED: 'CALIBRATED', MEASURED: 'MANUAL', CROSS_CHECKED: 'VERIFIED' },
};

{
  console.log('projekcija — totalna pokritost 5×5:');
  for (const g of GEOMETRY_ORDER) {
    for (const m of METRIC_ORDER) {
      const got = projectStatus(g, m);
      check(`projectStatus(${g}, ${m}) = ${String(EXPECTED[g][m])}`, got === EXPECTED[g][m], `dobljeno ${String(got)}`);
    }
  }
  check('tabela je res totalna (25 preverjenih parov)', GEOMETRY_ORDER.length * METRIC_ORDER.length === 25);
  // Porazdelitev izhodov: 9× null, 3× AUTO_SUGGESTED, 3× CALIBRATED, 5× MANUAL, 5× VERIFIED.
  const all = GEOMETRY_ORDER.flatMap((g) => METRIC_ORDER.map((m) => projectStatus(g, m)));
  const count = (s: MeasurementStatus | null) => all.filter((x) => x === s).length;
  check('null jih je 9 (slika brez smeri ALI brez cm)', count(null) === 9, String(count(null)));
  check('AUTO_SUGGESTED jih je 3 (enako CALIBRATED — izguba informacije)', count('AUTO_SUGGESTED') === 3 && count('CALIBRATED') === 3);
  check('MANUAL jih je 5 (vsaka geometrija, ker mera ni iz fotke)', count('MANUAL') === 5, String(count('MANUAL')));
  check('VERIFIED jih je 5 (enako)', count('VERIFIED') === 5);
  check('CONFIRMED iz projekcije NIKOLI ne nastopi', count('CONFIRMED') === 0);
  check('ESTIMATED iz projekcije NIKOLI ne nastopi („kalibracije ni" nosi null)', count('ESTIMATED') === 0);
}

// ── 3. Poštenostne invariante ───────────────────────────────
{
  console.log('poštenostne invariante:');
  check('VERIFIED samo iz CROSS_CHECKED',
    GEOMETRY_ORDER.every((g) => METRIC_ORDER.every((m) => projectStatus(g, m) !== 'VERIFIED' || m === 'CROSS_CHECKED')));
  check('MANUAL samo iz MEASURED',
    GEOMETRY_ORDER.every((g) => METRIC_ORDER.every((m) => projectStatus(g, m) !== 'MANUAL' || m === 'MEASURED')));
  check('CALIBRATED nikoli iz ASSUMED',
    GEOMETRY_ORDER.every((g) => projectStatus(g, 'ASSUMED') !== 'CALIBRATED'));
  check('iz ASSUMED je največ AUTO_SUGGESTED',
    GEOMETRY_ORDER.every((g) => {
      const s = projectStatus(g, 'ASSUMED');
      return s === null || s === 'AUTO_SUGGESTED';
    }));
  check('BREZ geometrije ni nikoli CALIBRATED/VERIFIED (razen mer, ki niso iz fotke)',
    [projectStatus('UNDEFINED', 'REFERENCED'), projectStatus('SUGGESTED', 'REFERENCED')].every((s) => s === null));
  check('mera, ki ni iz fotke, JE NEODVISNA od geometrije (veja 1 ima prednost)',
    GEOMETRY_ORDER.every((g) => projectStatus(g, 'MEASURED') === 'MANUAL' && projectStatus(g, 'CROSS_CHECKED') === 'VERIFIED'));
  check('domena veljavnosti: ORIENTED in FITTED DASTA ISTI izhod (to je izguba, ki jo razcep odpravi)',
    METRIC_ORDER.every((m) => projectStatus('ORIENTED', m) === projectStatus('FITTED', m)));
  check('monotonost: boljša geometrija nikoli ne zniža statusa',
    METRIC_ORDER.every((m) => {
      let prev = -2;
      for (const g of GEOMETRY_ORDER) {
        const r = all_rank(projectStatus(g, m));
        if (r < prev) return false;
        prev = r;
      }
      return true;
    }));
  // Drugo smerjo stari STATUS_ORDER zlomi SAMO na enem koraku in to je njegova
  // napaka, ne napaka projekcije: ročna izmera (MANUAL, rang 2) je strogo
  // boljši VIR od merila iz fotke (CALIBRATED, rang 3), a je na lestvici
  // nižje. Zato morata biti osi ločeni — ena lestvica ne more hkrati
  // razvrščati po domeni veljavnosti in po izvoru vrednosti.
  const drops: string[] = [];
  for (const g of GEOMETRY_ORDER) {
    for (let i = 1; i < METRIC_ORDER.length; i++) {
      const a = all_rank(projectStatus(g, METRIC_ORDER[i - 1]));
      const b = all_rank(projectStatus(g, METRIC_ORDER[i]));
      if (b < a) drops.push(`${g}:${METRIC_ORDER[i - 1]}→${METRIC_ORDER[i]}`);
    }
  }
  check('edini nezakonski korak po merilu je REFERENCED→MEASURED (CALIBRATED→MANUAL)',
    drops.every((d) => d.endsWith('REFERENCED→MEASURED')), drops.join(', '));
  check('ta korak se pojavi natanko tam, kjer je izhod CALIBRATED (3 ravni geometrije)',
    drops.length === 3, String(drops.length));
  check('izjema je NAJDBA, ne napaka: boljši vir (laser) sme projectionsko padsti',
    projectStatus('ORIENTED', 'MEASURED') === 'MANUAL' && all_rank('MANUAL') < all_rank('CALIBRATED'));
}

/** Rang poljubnega izhoda projekcije (null = najnižji, pod vsemi statusi). */
function all_rank(s: MeasurementStatus | null): number {
  if (s === null) return -1;
  const ORDER: MeasurementStatus[] = ['ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED'];
  return ORDER.indexOf(s);
}

// ── 4. Preglednica §3.2.1 — vsaka vrstica ──────────────────
{
  console.log('preglednica §3.2.1 (vhodi validateScale → par → današnji izhod):');
  const rows: [string, GeometricAssurance, MetricAssurance, MeasurementStatus | null][] = [
    ['{} (brez vsega)', 'UNDEFINED', 'NONE', null],
    ['pxPerCm + assumed-reference', 'ORIENTED', 'ASSUMED', 'AUTO_SUGGESTED'],
    ['pxPerCm + known-length brez ravnine', 'ORIENTED', 'REFERENCED', 'CALIBRATED'],
    ['pxPerCm + known-length + ravnina', 'FITTED', 'REFERENCED', 'CALIBRATED'],
    ['pxPerCm + manual-measure', 'ORIENTED', 'MEASURED', 'MANUAL'],
    ['laser brez pxPerCm', 'UNDEFINED', 'MEASURED', 'MANUAL'],
    ['plane-homography + ravnina', 'FITTED', 'REFERENCED', 'CALIBRATED'],
    ['plane-homography brez ravnine', 'UNDEFINED', 'NONE', null],
    ['pxPerCm + known-length, merilo izven pasu', 'ORIENTED', 'REFERENCED', 'CALIBRATED'],
    ['assumed-reference + ravnina — TESTA NI', 'FITTED', 'ASSUMED', 'AUTO_SUGGESTED'],
  ];
  for (const [name, g, m, expected] of rows) {
    check(`${name} → ${String(expected)}`, projectStatus(g, m) === expected, `dobljeno ${String(projectStatus(g, m))}`);
  }
  // Edina NAMERNA razlika proti današnji kodi: ta kombinacija je danes CALIBRATED.
  check('namerna razlika: FITTED + ASSUMED NI CALIBRATED (danes koda vrne CALIBRATED)',
    projectStatus('FITTED', 'ASSUMED') !== 'CALIBRATED' && projectStatus('FITTED', 'ASSUMED') === 'AUTO_SUGGESTED');
  check('razmerje med smermi velja tudi za CONSISTENT + ASSUMED',
    projectStatus('CONSISTENT', 'ASSUMED') === 'AUTO_SUGGESTED');
  check('DEGENERATE_REFERENCE živi na osi merila, ne geometrije (par je isti, koda ne)',
    projectStatus('ORIENTED', 'REFERENCED') === 'CALIBRATED');
}

// ── 5. Oznake, razlage, barve ───────────────────────────────
{
  console.log('besedišče za UI:');
  check('vsa geometrija ima oznako, razlago in barvo', GEOMETRY_ORDER.every((g) => {
    return geometryLabel(g).length > 0 && geometryHint(g).length > 10
      && geometryColor(g).badge.length > 0 && geometryColor(g).dot.length > 0;
  }));
  check('vsako merilo ima oznako, razlago in barvo', METRIC_ORDER.every((m) => {
    return metricLabel(m).length > 0 && metricHint(m).length > 10
      && metricColor(m).badge.length > 0 && metricColor(m).dot.length > 0;
  }));
  check('oznake so razločne (5 različnih geometrijskih)', new Set(GEOMETRY_ORDER.map(geometryLabel)).size === 5);
  check('oznake so razločne (5 različnih metričnih)', new Set(METRIC_ORDER.map(metricLabel)).size === 5);
  check('razlage so razločne na obeh oseh', new Set(GEOMETRY_ORDER.map(geometryHint)).size === 5
    && new Set(METRIC_ORDER.map(metricHint)).size === 5);
  check('ORIENTED razlaga imenuje domeno (samo smer reference)', geometryHint('ORIENTED').includes('smeri reference'));
  check('ORIENTED razlaga NE trdi napačne številke, ampak kaj manjka', geometryHint('ORIENTED').includes('štirih ogliščih'));
  check('ASSUMED razlaga imenuje domnevo in jo označi za nepotvrjeno', metricHint('ASSUMED').includes('nikoli potrjena'));
  check('ASSUMED razlaga pokriva OBOJE domnevi (referenca in fokus)', metricHint('ASSUMED').includes('fokus'));
  check('NONE razlaga pravi, da so samo razmerja', metricHint('NONE').includes('razmerja'));
  check('MEASURED razlaga pravi, da geometrija ne vpliva', metricHint('MEASURED').includes('ne vpliva'));
  check('barve: nesigurane ravni so amber', geometryColor('SUGGESTED').dot.includes('amber')
    && geometryColor('ORIENTED').dot.includes('amber') && metricColor('ASSUMED').badge.includes('amber'));
  check('barve: odsotnost merila je rdeča (eksplicitna napaka, ne tišina)', metricColor('NONE').dot.includes('red'));
  check('barve: brez geometrije je nevtralno kamnito (odsotnost, ne napaka)', geometryColor('UNDEFINED').badge.includes('stone'));
  check('barve: umerjena ravnina je zelena', geometryColor('FITTED').dot.includes('green'));
  check('barve obeh osi uporabljata isto paleto (brez modre/indigo)',
    [...GEOMETRY_ORDER.map(geometryColor), ...METRIC_ORDER.map(metricColor)].every((c) => !/blue|indigo|sky/.test(c.badge + c.dot)));
}

// ── 6. Agregata ─────────────────────────────────────────────
{
  console.log('agregata (odprava D3):');
  check('worstGeometry: prazen → null', worstGeometry([]) === null);
  check('worstGeometry: preskoči undefined', worstGeometry([undefined, 'FITTED', undefined]) === 'FITTED');
  check('worstGeometry: vrne najslabšo', worstGeometry(['CONSISTENT', 'ORIENTED', 'FITTED']) === 'ORIENTED');
  check('worstMetric: prazen → null', worstMetric([]) === null);
  check('worstMetric: preskoči undefined', worstMetric([undefined, 'REFERENCED']) === 'REFERENCED');
  check('worstMetric: vrne najslabše', worstMetric(['CROSS_CHECKED', 'ASSUMED', 'MEASURED']) === 'ASSUMED');
  // To je jed D3: dva ZAPISA z istim statusom, a z različnim manjkajočim.
  const para: [GeometricAssurance, MetricAssurance][] = [['ORIENTED', 'REFERENCED'], ['FITTED', 'REFERENCED']];
  check('oba para projicirata ISTI status (CALIBRATED ne ve, katero od dveh manjka)',
    projectStatus(...para[0]) === 'CALIBRATED' && projectStatus(...para[1]) === 'CALIBRATED');
  check('a agregat pove, katera os manjka (razcep odpravi D3)',
    worstGeometry(para.map(([g]) => g)) === 'ORIENTED' && worstMetric(para.map(([, m]) => m)) === 'REFERENCED');
  check('manjkajoča stvar ima razločno ime na svoji osi (UI lahko reče, kaj dodati)',
    geometryLabel('ORIENTED') !== geometryLabel('FITTED')
    && geometryHint('ORIENTED') !== geometryHint('FITTED'));
}

// ── 7. Vratni pogoji ────────────────────────────────────────
{
  console.log('vratni pogoji:');
  check('prag izrisa = FITTED', MIN_GEOMETRY_FOR_RENDER === 'FITTED');
  check('prag naročilnice po geometriji = ORIENTED (ne FITTED — sicer bi tiho skrčil kroge)', MIN_GEOMETRY_FOR_ORDER === 'ORIENTED');
  check('prag naročilnice po merilu = REFERENCED', MIN_METRIC_FOR_ORDER === 'REFERENCED');

  check('canRenderMontage: UNDEFINED ne', !canRenderMontage('UNDEFINED'));
  check('canRenderMontage: SUGGESTED ne (monter še ni potrdil)', !canRenderMontage('SUGGESTED'));
  check('canRenderMontage: ORIENTED ne (perspektiva ni korigirana)', !canRenderMontage('ORIENTED'));
  check('canRenderMontage: FITTED da', canRenderMontage('FITTED'));
  check('canRenderMontage: CONSISTENT da', canRenderMontage('CONSISTENT'));

  // D5: vrata za izris NE sprašujejo po merilu — testirano s tremi ničlami.
  check('canRenderMontage JE neodvisen od merila (25/25 parov)',
    GEOMETRY_ORDER.every((g) => {
      const first = canRenderMontage(g);
      return METRIC_ORDER.every((m) => canRenderMontage(g) === first && m !== undefined);
    }));
  check('izris brez enega samega cm je Dovoljen (met NONE, geo FITTED)',
    canRenderMontage('FITTED') && projectStatus('FITTED', 'NONE') === null);

  let orderTrue = 0;
  for (const g of GEOMETRY_ORDER) for (const m of METRIC_ORDER) if (canExportOrder(g, m)) orderTrue++;
  check('canExportOrder: 13 od 25 parov da (3×REFERENCED + 5×MEASURED + 5×CROSS_CHECKED)', orderTrue === 13, String(orderTrue));
  check('canExportOrder: geo UNDEFINED/SUGGESTED + merilo iz fotke ne da',
    ['UNDEFINED', 'SUGGESTED'].every((g) => ['NONE', 'ASSUMED', 'REFERENCED'].every((m) => !canExportOrder(g as GeometricAssurance, m as MetricAssurance))));
  check('canExportOrder: met NONE/ASSUMED nikoli ne da',
    GEOMETRY_ORDER.every((g) => !canExportOrder(g, 'NONE') && !canExportOrder(g, 'ASSUMED')));
  check('canExportOrder: ORIENTED + REFERENCED da (današnja politika se ne skrči)', canExportOrder('ORIENTED', 'REFERENCED'));
  check('canExportOrder: mera ni iz fotke → vrata odprta ne glede na geometrijo',
    GEOMETRY_ORDER.every((g) => canExportOrder(g, 'MEASURED') && canExportOrder(g, 'CROSS_CHECKED')));
  check('GEOMETRIJA ne more blokirati laserske mere (naravna meritev je veljavna brez fotke)',
    !canExportOrder('UNDEFINED', 'REFERENCED') && canExportOrder('UNDEFINED', 'MEASURED'));

  // KLJUČNA POŠTENOSTNA POSLEDICA (FAZA-8 §3.4): dvotapna montaža je po
  // konstrukciji poštena — slika DA, naročilnica NE, brez dodatnega zaslona.
  const GEO_AFTER_QUAD: GeometricAssurance = 'FITTED';
  const MET_FROM_CATALOGUE: MetricAssurance = 'ASSUMED';
  check('dvotapna montaža: štirikotnik + katalogska višina → slika sme na videz',
    canRenderMontage(GEO_AFTER_QUAD));
  check('dvotapna montaža: iz istega para NAROČILNICA NI mogoča',
    !canExportOrder(GEO_AFTER_QUAD, MET_FROM_CATALOGUE));
  check('dvotapna montaža: projekcija je AUTO_SUGGESTED (ne CALIBRATED)',
    projectStatus(GEO_AFTER_QUAD, MET_FROM_CATALOGUE) === 'AUTO_SUGGESTED');

  // Monotonost vrat: izboljšanje osi nikoli ne zapre vrat.
  check('canRenderMontage monotono po geometriji', GEOMETRY_ORDER.every((g, i) =>
    !canRenderMontage(g) || GEOMETRY_ORDER.slice(i).every((h) => canRenderMontage(h))));
  check('canExportOrder monotono po obeh oseh',
    GEOMETRY_ORDER.every((g, gi) => METRIC_ORDER.every((m, mi) => {
      if (!canExportOrder(g, m)) return true;
      return GEOMETRY_ORDER.slice(gi).every((h) => METRIC_ORDER.slice(mi).every((n) => canExportOrder(h, n)));
    })));
  check('pragoma se RAZHAJATA po oseh: izris rabi več geometrije, naročilnica merilo',
    geometryRank(MIN_GEOMETRY_FOR_RENDER) > geometryRank(MIN_GEOMETRY_FOR_ORDER)
    && metricRank(MIN_METRIC_FOR_ORDER) > metricRank('NONE'));
  check('par FITTED + NONE: izris DA, naročilnica NE (to je odprava D5)',
    canRenderMontage('FITTED') && !canExportOrder('FITTED', 'NONE'));
  check('par FITTED + REFERENCED: oba vratna pogoja izpolnjena',
    canRenderMontage('FITTED') && canExportOrder('FITTED', 'REFERENCED'));
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
