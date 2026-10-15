// Verifikacija izvoza pred/po primerjave iz fotomontaže (Task 65 — kandidat #2
// iz raziskave docs/task63-podobni-programi.md; izvirna zahteva issue #14:
// „primerjava pred/po … shranjevanje končnega prikaza"):
//   1) Postavitev je ČISTA MATEMATIKA: skupna višina = min obeh, razmerja strani
//      ohranjena (± 1 px zaokrožanja), brez prekrivanj, robovi se seštejejo.
//   2) Oznake iz metapodatkov: deterministične (ISO datum — NI toLocaleDateString,
//      poučena napaka Task 64), žig = EXPORT_LABEL iz photo-replace-core
//      (enoten vir resnice, ne kopija), manjkajoče mere se IZPUSTIJO (ne ugibajo).
//   3) Ime datoteke deterministično.
//   4) Iskrenost: izvozni prehod = canExportResult (isti kot enojni izvoz) —
//      „original" brez gradiva ne sme nositi žiga niti v primerjavi.
//   5) Varovala: neveljavne mere → jasne napake.
// Brskalni izris (drawCompareExport) je dokazan v E2E s PRAVO izvoženo datoteko
// (tests/e2e-compare-01-primerjava.png — ujet pri palačinki URL.createObjectURL).
// Zagon: bun tests/verify/photo-compare.ts
import {
  buildReplaceMetadata,
  computePlankLayouts,
  createMask,
  canExportResult,
  EXPORT_LABEL,
  type ReplaceMetadata,
} from '../../src/lib/photo-replace-core';
import {
  buildCompareLabels,
  compareExportFilename,
  computeCompareLayout,
} from '../../src/lib/photo-compare';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const throwsMsg = (fn: () => unknown): string => {
  try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

// standardni frontalni pas (isti kot v tests/verify/photo-bom.ts)
const QUAD: [[number, number], [number, number], [number, number], [number, number]] = [[10, 20], [90, 20], [90, 80], [10, 80]];
const IMG = { w: 1280, h: 890 };

const makeMeta = (o: {
  profileId: string;
  profileLabel: string;
  planeCm: { wCm: number; hCm: number };
  plankCm: number;
  gapCm: number;
  orientation: 'horizontal' | 'vertical';
  texture?: ReplaceMetadata['texture'];
  createdAt?: string;
  params?: Record<string, number | string | boolean>;
}): ReplaceMetadata =>
  buildReplaceMetadata({
    profileId: o.profileId,
    profileLabel: o.profileLabel,
    catalogSku: null,
    texture: o.texture ?? null,
    planeCm: o.planeCm,
    params: o.params ?? {
      pattern: o.orientation === 'horizontal' ? 'terasa' : 'vertikalne',
      elementCm: o.plankCm,
      spacingCm: o.gapCm,
      quadWidthCm: Math.round(o.planeCm.wCm),
      postEveryCm: 'null',
      materialHonesty: 'ROKSAL original (neoverjena zaslonska reprodukcija)',
    },
    mask: createMask(IMG.w, IMG.h),
    layout: computePlankLayouts({
      quadPct: QUAD, imgSize: IMG, planeCm: o.planeCm,
      plankCm: o.plankCm, gapCm: o.gapCm, orientation: o.orientation,
      postCm: 6, postEveryCm: null,
    }),
    imgSize: IMG,
    inpaint: 'ok',
    warnings: [],
    createdAt: o.createdAt ?? '2026-10-15T10:00:00.000Z',
  });

console.log('Izvoz pred/po primerjave (photo-compare) — determinističen, iskren\n');

// ── 1) Postavitev: tipični primer (enaki mere — kompozit nad delovno kopijo) ──
console.log('Postavitev (tipični primer 1280×890 + 1280×890):');
const L = computeCompareLayout(1280, 890, 1280, 890, { zigLineCount: 2 });
check('skupna širina = PRED + ločilo + PO (1280+2+1280 = 2562)', L.canvasW === 2562, String(L.canvasW));
check('zgornji trak = pad + lineH + pad = 41', L.topStrip.h === 41 && L.before.y === 41, `${L.topStrip.h}/${L.before.y}`);
check('spodnji trak = 2×pad + (2 žiga + 1 podatek)×lineH + 6 = 81', L.bottomStrip.h === 81, String(L.bottomStrip.h));
check('skupna višina = 41 + 890 + 81 = 1012', L.canvasH === 1012, String(L.canvasH));
check('PRED levo (x=0, 1280×890)', L.before.x === 0 && L.before.w === 1280 && L.before.h === 890);
check('PO desno (x=1282, 1280×890)', L.after.x === 1282 && L.after.w === 1280 && L.after.h === 890);
check('ločilo med slikama (x=1280, širina 2, polna višina)', L.divider.x === 1280 && L.divider.w === 2 && L.divider.h === L.canvasH);
check('brez prekrivanj: robovi se seštejejo levo→desno',
  L.before.x + L.before.w === L.divider.x && L.divider.x + L.divider.w === L.after.x && L.after.x + L.after.w === L.canvasW);
check('brez prekrivanj: robovi se seštejejo zgoraj→spodaj',
  L.topStrip.y + L.topStrip.h === L.before.y && L.before.y + L.before.h === L.bottomStrip.y && L.bottomStrip.y + L.bottomStrip.h === L.canvasH);

// ── 2) Postavitev: različne mere (odporna postavitev) ─────────────────────
console.log('\nPostavitev (različne mere 1200×800 + 1280×960):');
const L2 = computeCompareLayout(1200, 800, 1280, 960);
check('skupna višina = min(800, 960) = 800', L2.before.h === 800 && L2.after.h === 800);
check('PRED ohranja razmerje (1200×800 nespremenjeno)', L2.before.w === 1200);
check('PO skalirano na višino 800: round(1280×800/960) = 1067', L2.after.w === 1067, String(L2.after.w));
check('razmerje strani PO ohranjeno (±1 px zaokrožanja)',
  Math.abs(L2.after.w / L2.after.h - 1280 / 960) < 0.002, `${(L2.after.w / L2.after.h).toFixed(4)} vs ${(1280 / 960).toFixed(4)}`);
check('skupna širina = 1200 + 2 + 1067 = 2269', L2.canvasW === 2269, String(L2.canvasW));

// ── 3) zigLineCount vpliva SAMO na spodnji trak ──────────────────────────
console.log('\nVrstice žiga (samo višina spodnjega traku):');
const L0 = computeCompareLayout(1280, 890, 1280, 890, { zigLineCount: 0 });
const L4 = computeCompareLayout(1280, 890, 1280, 890, { zigLineCount: 4 });
check('širina neodvisna od št. vrstic (2562 pri 0, 2 in 4)', L0.canvasW === L.canvasW && L4.canvasW === L.canvasW);
check('višina raste natančno za lineH na vrstico (81 → 47 … 115)',
  L0.canvasH === L.canvasH - 2 * 17 && L4.canvasH === L.canvasH + 2 * 17,
  `${L0.canvasH}/${L.canvasH}/${L4.canvasH}`);

// ── 4) Determinizem ──────────────────────────────────────────────────────
console.log('\nDeterminizem:');
const Ld1 = computeCompareLayout(1280, 890, 1280, 890, { zigLineCount: 2 });
check('enaki vhodi → identična postavitev (JSON)', JSON.stringify(Ld1) === JSON.stringify(L));
check('privzete opcije = eksplicitne privzete vrednosti',
  JSON.stringify(computeCompareLayout(1280, 890, 1280, 890)) === JSON.stringify(computeCompareLayout(1280, 890, 1280, 890, { pad: 12, dividerPx: 2, lineH: 17, fontSize: 13, zigLineCount: 2 })));

// ── 5) Oznake iz metapodatkov ────────────────────────────────────────────
console.log('\nOznake (iz metapodatkov različice):');
const meta = makeMeta({ profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } });
const lb = buildCompareLabels(meta);
check('PRED oznaka pove, da je to delovna kopija originala', lb.pred === 'PRED — originalna fotografija (delovna kopija)', lb.pred);
check('PO oznaka vsebuje profil', lb.po === 'PO — fotomontaža: POLNA DESKA-100 (dekor 1)', lb.po);
check('vrstica podatkov: ravnina 200 × 95 cm', lb.metaLine.includes('Ravnina 200 × 95 cm'), lb.metaLine);
check('vrstica podatkov: element 10 cm + reža 2 cm', lb.metaLine.includes('element 10 cm + reža 2 cm'));
check('vrstica podatkov: ISO datum iz createdAt (slice 0,10 — NI toLocaleDateString)', lb.metaLine.includes('2026-10-15'), lb.metaLine);
check('vrstica podatkov: različica skripte v' + meta.scriptVersion, lb.metaLine.includes(`skripta v${meta.scriptVersion}`));
check('žig = EXPORT_LABEL iz photo-replace-core (enoten vir resnice, ne kopija)', lb.zig === EXPORT_LABEL);
check('determinizem: dva klica → identične oznake (JSON)', JSON.stringify(buildCompareLabels(meta)) === JSON.stringify(lb));

console.log('\nOznake (manjkajoči podatki — iskrenost):');
const metaBrezMere = makeMeta({
  profileId: 'kubo-80-42-dekor-2', profileLabel: 'KUBO 80/42 (dekor 2)', plankCm: 8, gapCm: 0.5, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 },
  params: { pattern: 'vertikalne', quadWidthCm: 200, postEveryCm: 'null', materialHonesty: 'ROKSAL original (neoverjena zaslonska reprodukcija)' }, // brez elementCm/spacingCm
});
const lb2 = buildCompareLabels(metaBrezMere);
check('manjkajoče mere elementa/reže se IZPUSTIJO (brez „element")', !lb2.metaLine.includes('element'), lb2.metaLine);
check('ravnina ostane (200 × 95 cm)', lb2.metaLine.includes('Ravnina 200 × 95 cm'));
check('datum brez ISO oblike → iskreno „neznan datum" (ne crash)',
  buildCompareLabels({ ...meta, createdAt: 'napačno' }).metaLine.includes('neznan datum'));
check('neveljavna ravnina (wCm 0) → jasna napaka',
  throwsMsg(() => buildCompareLabels({ ...meta, planeCm: { wCm: 0, hCm: 95 } })).startsWith('NEZADOSTNI PODATKI'));
check('manjkajoči metapodatki (null) → jasna napaka',
  throwsMsg(() => buildCompareLabels(null as unknown as ReplaceMetadata)).startsWith('NEZADOSTNI PODATKI'));

// ── 6) Ime datoteke ──────────────────────────────────────────────────────
console.log('\nIme datoteke:');
check('deterministično ime s profileId', compareExportFilename(meta) === 'fotomontaza-primerjava-polna-100-dekor-1.png', compareExportFilename(meta));
check('enaki metapodatki → enako ime (dva klica)', compareExportFilename(meta) === compareExportFilename(makeMeta({ profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } })));
check('končnica .png (slika, ne PDF — 0 odvisnosti)', compareExportFilename(meta).endsWith('.png'));

// ── 7) Iskrenost: isti izvozni prehod kot enojni izvoz ───────────────────
console.log('\nIskrenost (canExportResult — isti prehod kot enojni izvoz):');
const metaNeoverjeno = makeMeta({
  profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 },
  texture: { id: 'polna-100-dekor-1', src: null, origin: 'roksal-original', verification: 'unverified', realCm: 45 },
});
check('tekstura brez gradiva (src=null) → izvoz BLOKIRAN',
  canExportResult(metaNeoverjeno, { canRender: true }).allowed === false);
check('razlog izrecno omenja original ROKSAL gradivo',
  (canExportResult(metaNeoverjeno, { canRender: true }).reason ?? '').includes('original ROKSAL gradivo'));
const metaOverjeno = makeMeta({
  profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 },
  texture: { id: 'polna-100-dekor-1', src: '/roksal/polna-100/dekor-1.png', origin: 'roksal-original', verification: 'verified', realCm: 45 },
});
check('overjena tekstura + canRender → izvoz DOVOLJEN',
  canExportResult(metaOverjeno, { canRender: true }).allowed === true);
check('canRender=false → izvoz blokiran (tudi z overjeno teksturo)',
  canExportResult(metaOverjeno, { canRender: false }).allowed === false);

// ── 8) Varovala (neveljavne mere → jasne napake) ─────────────────────────
console.log('\nVarovala:');
check('širina 0 → jasna napaka', throwsMsg(() => computeCompareLayout(0, 890, 1280, 890)).startsWith('NEZADOSTNI PODATKI'));
check('negativna višina → jasna napaka', throwsMsg(() => computeCompareLayout(1280, -5, 1280, 890)).startsWith('NEZADOSTNI PODATKI'));
check('ne-celo število → jasna napaka', throwsMsg(() => computeCompareLayout(1280.5, 890, 1280, 890)).startsWith('NEZADOSTNI PODATKI'));
check('NaN → jasna napaka', throwsMsg(() => computeCompareLayout(NaN, 890, 1280, 890)).startsWith('NEZADOSTNI PODATKI'));
check('nad varovalom pomnilnika (100 Mpx, površina vhoda) → jasna napaka',
  throwsMsg(() => computeCompareLayout(10001, 10001, 1280, 890)).startsWith('NEZADOSTNI PODATKI'));
check('nad varovalom pomnilnika (površina izvožene slike = dve veliki strani ob strani) → jasna napaka',
  throwsMsg(() => computeCompareLayout(10000, 9999, 10000, 9999)).startsWith('NEZADOSTNI PODATKI'));
check('neveljavna opcija (pad −1) → jasna napaka',
  throwsMsg(() => computeCompareLayout(1280, 890, 1280, 890, { pad: -1 })).startsWith('NEZADOSTNI PODATKI'));

console.log(`\nRezultat: ${pass} OK, ${fail} NAPAK`);
if (fail > 0) process.exit(1);
