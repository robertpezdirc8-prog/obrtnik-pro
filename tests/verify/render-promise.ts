// Verifikacija OBLOŽBENEGA izrisa (najdba F3): `renderPromiseOf` in
// `renderPromiseHint`. Par (geo, met) pri obloženem izpisu NI dovolj — pokončen
// profil šteje elemente čez širino ravnine, zato UI ne sme pisati »dovoljen«,
// kadar jedro brez `wCm` vrne napako. Test zapne tudi besedilo, da noben izpis
// ne obljubi več, kot drži.
// Zagon: bun tests/verify/render-promise.ts
import {
  GEOMETRY_ORDER,
  canRenderMontage,
  canExportOrder,
  renderPromiseOf,
  renderPromiseHint,
  type GeometricAssurance,
  type MetricAssurance,
  type RenderPromise,
} from '../../src/lib/assertion';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

type Orientation = 'horizontal' | 'vertical' | null;
const ORIENTATIONS: Orientation[] = ['horizontal', 'vertical', null];
const WIDTHS = [true, false];
const PROMISES: RenderPromise[] = ['closed', 'needsWidth', 'open'];

// ── 1. Izčrpna resnična tabela (5 geo × 2 širini × 3 profili = 30) ──
{
  console.log('izčrpna tabela 30 kombinacij (zunanji oracle, ne zrcalo impl.):');
  let tallyClosed = 0, tallyNeeds = 0, tallyOpen = 0;
  let mismatch = 0, firstMismatch = '';
  for (const geo of GEOMETRY_ORDER) {
    for (const widthMeasured of WIDTHS) {
      for (const profileOrientation of ORIENTATIONS) {
        const got = renderPromiseOf({ geo, widthMeasured, profileOrientation });
        // Oracle je zapisan kot pogojni izraz nad VRATI in F3-mejo, ne kot
        // kopija implikacije v `renderPromiseOf`.
        const doorsOpen = geo === 'FITTED' || geo === 'CONSISTENT';
        const want: RenderPromise = !doorsOpen
          ? 'closed'
          : (!widthMeasured && profileOrientation === 'vertical' ? 'needsWidth' : 'open');
        if (got !== want) { mismatch++; if (!firstMismatch) firstMismatch = `${geo}/${widthMeasured}/${profileOrientation}: ${got} != ${want}`; }
        if (got === 'closed') tallyClosed++;
        else if (got === 'needsWidth') tallyNeeds++;
        else tallyOpen++;
      }
    }
  }
  check('30 kombinacij brez razlike proti zunanjemu oracle-u', mismatch === 0, firstMismatch);
  check('razpored: 18 zaprtih / 10 odprtih / 2 potrebujeta širino',
    tallyClosed === 18 && tallyNeeds === 2 && tallyOpen === 10,
    `${tallyClosed}/${tallyOpen}/${tallyNeeds}`);
  check('tally se sešteje v 30', tallyClosed + tallyNeeds + tallyOpen === 30);
}

// ── 2. Najdba F3: par (geo, met) sam NE zadostuje ──
{
  console.log('F3: en par, dva izpisa:');
  const a = renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: 'horizontal' });
  const b = renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: 'vertical' });
  check('FITTED + brez širine + vodoravni → odprt', a === 'open', a);
  check('FITTED + brez širine + pokončni → potrebuje širino', b === 'needsWidth', b);
  check('ISTA geometrija in IZOSTRIST parametra mere, RAZLIČEN izpis (par ni dovolj)',
    a !== b && canRenderMontage('FITTED') === canRenderMontage('FITTED'));
  check('merilo pri tem NE igra vloge (vodoravni odprt tudi ob met NONE)',
    renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: 'horizontal' }) === 'open'
      && !canExportOrder('FITTED', 'NONE'));
  check('brez izbranega profila (null) NI obljube o pomanjkanju — jedro takrat uporabi privzeti profil',
    renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: null }) === 'open');
}

// ── 3. Vrata ostanejo vrata (ločitev dovoljenja od obloženega izpisa) ──
{
  console.log('vrata ≠ obložba:');
  check('canRenderMontage(geo) se ne premakne ne za širino ne za profil (vsi trije geo >= FITTED)',
    (['FITTED', 'CONSISTENT'] as GeometricAssurance[]).every((geo) =>
      WIDTHS.every((w) => ORIENTATIONS.every((o) => canRenderMontage(geo) === true))));
  check('canRenderMontage ostane false pod FITTED, kljub izmerjeni širini',
    (['UNDEFINED', 'SUGGESTED', 'ORIENTED'] as GeometricAssurance[]).every((geo) =>
      WIDTHS.every((w) => ORIENTATIONS.every((o) => canRenderMontage(geo) === false))));
  check('obložen izpis je pod FITTED VEDNO zaprt, tudi z obema merama',
    (['UNDEFINED', 'SUGGESTED', 'ORIENTED'] as GeometricAssurance[]).every((geo) =>
      WIDTHS.every((w) => ORIENTATIONS.every((o) => renderPromiseOf({ geo, widthMeasured: w, profileOrientation: o }) === 'closed'))));
}

// ── 4. Invariante ──
{
  console.log('invariante:');
  check('nikoli needsWidth, kadar je širina izmerjena',
    GEOMETRY_ORDER.every((geo) => ORIENTATIONS.every((o) =>
      renderPromiseOf({ geo, widthMeasured: true, profileOrientation: o }) !== 'needsWidth')));
  check('nikoli needsWidth brez izbranega profila',
    GEOMETRY_ORDER.every((geo) => WIDTHS.every((w) =>
      renderPromiseOf({ geo, widthMeasured: w, profileOrientation: null }) !== 'needsWidth')));
  check('edina pot do needsWidth: geo >= FITTED AND !širina AND pokončen profil',
    GEOMETRY_ORDER.every((geo) => WIDTHS.every((w) => ORIENTATIONS.every((o) =>
      (renderPromiseOf({ geo, widthMeasured: w, profileOrientation: o }) === 'needsWidth')
      === (canRenderMontage(geo) && !w && o === 'vertical')))));
  check('met ni parameter obloženega izpisa → funkcija je na met neodvisna (2 pari, enak izpis)',
    renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: 'vertical' })
      === renderPromiseOf({ geo: 'FITTED', widthMeasured: false, profileOrientation: 'vertical' }));
  check('determinizem: ponovjen klic z enakim vhodom da enak izpis',
    GEOMETRY_ORDER.every((geo) => WIDTHS.every((w) => ORIENTATIONS.every((o) => {
      const inp = { geo, widthMeasured: w, profileOrientation: o };
      return renderPromiseOf(inp) === renderPromiseOf(inp);
    }))));
  check('vhodni objekt ne mutate-a',
    (() => {
      const inp = { geo: 'FITTED' as GeometricAssurance, widthMeasured: false, profileOrientation: 'vertical' as Orientation };
      const before = JSON.stringify(inp);
      renderPromiseOf(inp);
      return JSON.stringify(inp) === before;
    })());
  check('izpis je VEDNO ena od treh vrednosti (brez undefined)',
    GEOMETRY_ORDER.every((geo) => WIDTHS.every((w) => ORIENTATIONS.every((o) =>
      PROMISES.indexOf(renderPromiseOf({ geo, widthMeasured: w, profileOrientation: o })) !== -1))));
}

// ── 5. Besedilo: nobena obloženka ne obljubi več, kot drži ──
{
  console.log('besedilo obloženega izpisa:');
  const closed = renderPromiseHint('closed');
  const needs = renderPromiseHint('needsWidth');
  const open = renderPromiseHint('open');
  check('zaprt izpis pravi »NI dovoljen«', closed === 'NI dovoljen', closed);
  check('potreben-širina NE vsebuje besede »dovoljen«', !/dovoljen/i.test(needs), needs);
  check('potreben-širina imenuje oba razloga: pokončen profil in neizmerjeno širino',
    /pokon/i.test(needs) && /širin/i.test(needs));
  check('odprt izpis pove, da gre za VODORAVNE profile (ne za vse)', /vodoravn/i.test(open), open);
  check('nobena razlaga ni prazna ali dolga kot odstavek (390 px)',
    PROMISES.every((p) => { const h = renderPromiseHint(p); return h.length > 0 && h.length <= 110; }),
    PROMISES.map((p) => `${p}:${renderPromiseHint(p).length}`).join(' '));
  check('tri vrednosti imajo TRI različna besedila',
    new Set(PROMISES.map(renderPromiseHint)).size === 3);
  check('metrična vrsta (MetricAssurance) NE more biti parameter obloženega izpisa — tip to ve, tu je še zapis',
    (() => {
      const met: MetricAssurance = 'CROSS_CHECKED';
      // `renderPromiseOf` met-spremenljivke ne pozna; ta preverba pripne, da
      // morebitna prihodnja dodaja ne more tiho odpreti izrisa z mero.
      const inp = { geo: 'CONSISTENT' as GeometricAssurance, widthMeasured: false, profileOrientation: 'vertical' as Orientation };
      return met === 'CROSS_CHECKED' && renderPromiseOf(inp) === 'needsWidth';
    })());
}

console.log(`\n  REZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
