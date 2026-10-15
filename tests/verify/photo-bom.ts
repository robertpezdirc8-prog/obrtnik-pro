// Verifikacija kosovnice (BOM) iz fotomontaže (Task 64 — kandidat #1 iz
// raziskave docs/task63-podobni-programi.md):
//   1) INVARIANTA: štetje desk iz buildBomFromMeta je TOČNO enako
//      layout.planks.length iz computePlankLayouts za iste vhode
//      (kosovnica pove, kar je uporabnik VIDEL v upodobitvi — ne ocene).
//   2) Rezalni načrt: samo z uradno nabavno dolžino (polna-100 580, polna-128 220,
//      romb-67 580, polna-57-32 580); KUBO/generični brez uradne dolžine → null + opozorilo.
//   3) Iskrenost: unitPrice vedno 0 z opisom „Cena NI znana", stebri/pritrdilni
//      material NIKOLI kot postavke (samo opozorilo), manjkajoči profil → shranjene
//      mere + opozorilo.
//   4) Determinizem: enaki vhodi → identičen JSON kosovnice (ključi iz createdAt).
// Zagon: bun tests/verify/photo-bom.ts
import {
  buildReplaceMetadata,
  computePlankLayouts,
  createMask,
  type ReplaceMetadata,
} from '../../src/lib/photo-replace-core';
import { buildBomFromMeta } from '../../src/lib/photo-bom';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const throwsMsg = (fn: () => unknown): string => {
  try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

// standardni frontalni pas (isti kot v tests/verify/photo-replace.ts)
const QUAD: [[number, number], [number, number], [number, number], [number, number]] = [[10, 20], [90, 20], [90, 80], [10, 80]];
const IMG = { w: 1280, h: 890 };

const makeMeta = (o: {
  profileId: string;
  profileLabel: string;
  planeCm: { wCm: number; hCm: number };
  plankCm: number;
  gapCm: number;
  orientation: 'horizontal' | 'vertical';
  params?: Record<string, number | string | boolean>;
}): ReplaceMetadata =>
  buildReplaceMetadata({
    profileId: o.profileId,
    profileLabel: o.profileLabel,
    catalogSku: null,
    texture: null,
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
    createdAt: '2026-10-15T10:00:00.000Z',
  });

console.log('Kosovnica iz fotomontaže (photo-bom) — deterministična, iskrena\n');

// ── 1) INVARIANTA: BOM ≡ upodobljena postavitev ──────────────────
console.log('Invarianta (BOM štetje ≡ layout.planks.length):');
const invariantCases = [
  { name: 'KUBO 80/42 (pokončno, 8 + 0,5 cm, ravnina 200×95)', plankCm: 8, gapCm: 0.5, orientation: 'vertical' as const, planeCm: { wCm: 200, hCm: 95 }, profileId: 'kubo-80-42-dekor-2', profileLabel: 'KUBO 80/42 (dekor 2)' },
  { name: 'POLNA-100 (pokončno, 10 + 2 cm, ravnina 200×95)', plankCm: 10, gapCm: 2, orientation: 'vertical' as const, planeCm: { wCm: 200, hCm: 95 }, profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)' },
  { name: 'WPC deka 140 (vodoravno, 14 + 0,4 cm, ravnina 250×180)', plankCm: 14, gapCm: 0.4, orientation: 'horizontal' as const, planeCm: { wCm: 250, hCm: 180 }, profileId: 'wpc-deka-140', profileLabel: 'WPC deka 140 mm (vodoravno)' },
];
for (const c of invariantCases) {
  const meta = makeMeta(c);
  const layout = computePlankLayouts({
    quadPct: QUAD, imgSize: IMG, planeCm: c.planeCm,
    plankCm: c.plankCm, gapCm: c.gapCm, orientation: c.orientation,
    postCm: 6, postEveryCm: null,
  });
  const bom = buildBomFromMeta(meta);
  check(`${c.name}: ${bom.boards} kosov = layout.planks.length ${layout.planks.length}`,
    bom.boards === layout.planks.length, `BOM ${bom.boards} vs layout ${layout.planks.length}`);
  check(`${c.name}: rez = ${c.orientation === 'horizontal' ? 'wCm' : 'hCm'} (${c.orientation === 'horizontal' ? c.planeCm.wCm : c.planeCm.hCm} cm)`,
    Math.abs(bom.cutLenCm - (c.orientation === 'horizontal' ? c.planeCm.wCm : c.planeCm.hCm)) < 1e-9, String(bom.cutLenCm));
  check(`${c.name}: skupni metri = kosov × rez / 100 (${bom.totalMeters.toFixed(2)} m)`,
    Math.abs(bom.totalMeters - Math.round(((bom.boards * bom.cutLenCm) / 100) * 100) / 100) < 1e-9);
}

// ── 2) Rezalni načrt (samo uradne nabavne dolžine) ───────────────
console.log('\nRezalni načrt (uradne nabavne dolžine):');
{
  // polna-100: nabavna 580, rez 95 → 6 kosov na profil → ceil(16/6) = 3, odpadek 10 cm
  const b100 = buildBomFromMeta(makeMeta({ profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  check('polna-100: 3 nabavna profila po 580 cm (6 kosov na profil, odpadek 10 cm)',
    b100.stocks !== null && b100.stocks.count === 3 && b100.stocks.stockCm === 580 && b100.stocks.perStock === 6 && b100.stocks.wasteCm === 10,
    JSON.stringify(b100.stocks));
  check('polna-100: postavka „nabavni profili" obstaja z 3 kosi',
    b100.items.length === 2 && b100.items[1].quantity === 3 && b100.items[1].name.includes('nabavni profili'), `items=${b100.items.length}`);
  // polna-128: nabavna 220, rez 95 → 2 kosa na profil; ravnina 200 → floor((200+2)/14,8) = 13 kosov → ceil(13/2) = 7, odpadek 30 cm
  const b128 = buildBomFromMeta(makeMeta({ profileId: 'polna-128-dekor-1', profileLabel: 'POLNA DESKA-128 (dekor 1)', plankCm: 12.8, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  check('polna-128: 7 nabavnih profilov po 220 cm (2 kosa na profil, odpadek 30 cm; 13 desk po (200+2)/14,8)',
    b128.stocks !== null && b128.stocks.count === 7 && b128.stocks.stockCm === 220 && b128.stocks.perStock === 2 && b128.stocks.wasteCm === 30,
    JSON.stringify(b128.stocks));
  // KUBO: brez uradne nabavne dolžine → brez rezalnega načrta + opozorilo
  const bK = buildBomFromMeta(makeMeta({ profileId: 'kubo-80-42-dekor-2', profileLabel: 'KUBO 80/42 (dekor 2)', plankCm: 8, gapCm: 0.5, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  check('KUBO: brez rezalnega načrta (uradna dolžina ni objavljena) + opozorilo',
    bK.stocks === null && bK.items.length === 1 && bK.warnings.some((w) => w.includes('ni objavljena')));
  // polna-128 z rezom 300 cm > 220 cm nabavna → opozorilo, brez načrta
  const b128tall = buildBomFromMeta(makeMeta({ profileId: 'polna-128-dekor-1', profileLabel: 'POLNA DESKA-128 (dekor 1)', plankCm: 12.8, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 300 } }));
  check('polna-128 (rez 300 > 220): opozorilo o presegu, brez rezalnega načrta',
    b128tall.stocks === null && b128tall.warnings.some((w) => w.includes('presega uradno nabavno dolžino')));
}

// ── 3) Iskrenost ─────────────────────────────────────────────────
console.log('\nIskrenost:');
{
  const bom = buildBomFromMeta(makeMeta({ profileId: 'romb-67-dekor-1', profileLabel: 'ROMB DESKA-67 (dekor 1)', plankCm: 6.7, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  check('vse postavke: unitPrice = 0 (ROKSAL cen ne prevajamo)', bom.items.every((i) => i.unitPrice === 0));
  check('opis vsebuje „Cena NI znana" (obrtnik jo vpiše)', bom.items.every((i) => i.description.includes('Cena NI znana')));
  check('stebri/pritrdilni material NIKOLI kot postavke — samo opozorilo',
    !bom.items.some((i) => /stebri|pritrdilni/i.test(i.name)) && bom.warnings.some((w) => w.includes('Stebri in pritrdilni material NISO modelirani')));
  check('vir v opisu prve postavke (deske): fotomontaža z ISO datumom različice (deterministično)', bom.items[0].description.includes('Iz fotomontaže (2026-10-15)'));
  // manjkajoči profil: shranjene mere + opozorilo (ne napaka, ne izmišljeni profil)
  const bMiss = buildBomFromMeta(makeMeta({
    profileId: 'profiler-ki-ne-obstaja', profileLabel: 'Nepoznan profil',
    plankCm: 9, gapCm: 1.5, orientation: 'vertical', planeCm: { wCm: 100, hCm: 80 },
    params: { pattern: 'vertikalne', elementCm: 9, spacingCm: 1.5, quadWidthCm: 100, postEveryCm: 'null', materialHonesty: 'nepoznan' },
  }));
  check('manjkajoč profil: uporabi shranjene mere (9 + 1,5, ravnina 100) → 10 kosov + opozorilo',
    bMiss.boards === Math.floor((100 + 1.5) / 10.5) && bMiss.warnings.some((w) => w.includes('ni več v katalogu')));
}

// ── 4) Determinizem ──────────────────────────────────────────────
console.log('\nDeterminizem:');
{
  const a = buildBomFromMeta(makeMeta({ profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  const b = buildBomFromMeta(makeMeta({ profileId: 'polna-100-dekor-1', profileLabel: 'POLNA DESKA-100 (dekor 1)', plankCm: 10, gapCm: 2, orientation: 'vertical', planeCm: { wCm: 200, hCm: 95 } }));
  check('enaki vhodi → identičen JSON (ključi iz createdAt)', JSON.stringify(a) === JSON.stringify(b));
  check('ključi vsebujejo createdAt + profileId', a.items.every((i) => i.key.startsWith('bom-2026-10-15T10:00:00.000Z-polna-100-dekor-1')));
}

// ── 5) Robni primeri ─────────────────────────────────────────────
console.log('\nRobni primeri:');
{
  const tiny = buildBomFromMeta(makeMeta({ profileId: 'wpc-deka-140', profileLabel: 'WPC deka 140', plankCm: 14, gapCm: 0.4, orientation: 'horizontal', planeCm: { wCm: 60, hCm: 10 } }));
  check('preozka ravnina: 0 kosov → brez postavk + opozorilo „Ni elementov"', tiny.boards === 0 && tiny.items.length === 0 && tiny.warnings.some((w) => w.includes('Ni elementov')));
  const throws1 = throwsMsg(() => buildBomFromMeta({ ...makeMeta({ profileId: 'wpc-deka-140', profileLabel: 'x', plankCm: 14, gapCm: 0.4, orientation: 'horizontal', planeCm: { wCm: 250, hCm: 180 } }), planeCm: { wCm: 0, hCm: 180 } } as unknown as ReplaceMetadata));
  check('planeCm.wCm = 0 → zavrnjeno z jasno napako', throws1.includes('NEZADOSTNI PODATKI'), throws1);
  const throws2 = throwsMsg(() => buildBomFromMeta(null as unknown as ReplaceMetadata));
  check('null meta → zavrnjeno', throws2.includes('NEZADOSTNI PODATKI'), throws2);
  const throws3 = throwsMsg(() => buildBomFromMeta(makeMeta({
    profileId: 'brez-mer', profileLabel: 'brez mer', plankCm: 14, gapCm: 0.4, orientation: 'horizontal', planeCm: { wCm: 250, hCm: 180 },
    params: { pattern: 'terasa', postEveryCm: 'null', materialHonesty: 'x' },
  })));
  check('manjkajoč profil + params brez mer → zavrnjeno (ne ugiba)', throws3.includes('mere elementa/reže niso na voljo'), throws3);
}

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
