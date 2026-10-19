// Verifikacija MONTAŽNEGA LISTA, POVEZANEGA S PONUDBO (offer-sheet.ts):
//   1) `parseMontageJson` sprejme SAMO veljavne metapodatke fotomontaže —
//      vse drugo (ponudba brez fotomontaže) je normalno in da null, ne napako;
//   2) shranjevanje in branje sta zamenljiva (krog → isti rezultat);
//   3) `buildOfferSheet` s ponudbo brez fotomontaže NE naredi lažnega lista
//      (null), s fotomontažo pa naredi list iz DEJANSKIH mer;
//   4) razmak stebrov brez vnosa je BLOKADA, ne izmišljena številka.
// Zagon: bun tests/verify/offer-sheet.ts
import {
  buildOfferSheet,
  parseMontageJson,
  serializeMontage,
  type StoredMontage,
} from '../../src/lib/offer-sheet';
import type { ReplaceMetadata } from '../../src/lib/photo-replace-core';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

const META = {
  scriptVersion: 'photo-replace-v1',
  profileId: 'polna-100',
  profileLabel: 'ROKSAL polna deska 100',
  catalogSku: null,
  texture: null,
  planeCm: { wCm: 600, hCm: 190 },
  params: { pattern: 'vertikalne', elementCm: 10, spacingCm: 2 },
  maskHash: 'a',
  layoutHash: 'b',
  imgSize: { w: 1280, h: 890 },
  inpaint: 'ok',
  warnings: [],
  exportLabel: 'ROKSAL original (neoverjena zaslonska reprodukcija)',
  createdAt: '2026-10-19T10:00:00.000Z',
} as unknown as ReplaceMetadata;

console.log('Montažni list, povezan s ponudbo (offer-sheet) — čisto in iskreno\n');

// ── 1) Sprejemljivost vhodov ──
{
  check('null → null (ponudba brez fotomontaže)', parseMontageJson(null) === null);
  check('prazni niz → null', parseMontageJson('') === null);
  check('okvarjen JSON → null (ne vrže)', parseMontageJson('{to ni json') === null);
  check('številka → null', parseMontageJson(42) === null);
  check('objekt brez meta → null', parseMontageJson({ bayCm: 150 }) === null);
  check('meta brez profileId → null', parseMontageJson({ meta: { ...META, profileId: '' } }) === null);
  check('meta brez planeCm → null', parseMontageJson({ meta: { ...META, planeCm: undefined } }) === null);
  check('meta z negativno višino → null', parseMontageJson({ meta: { ...META, planeCm: { wCm: 600, hCm: -5 } } }) === null);
  check('veljavni meta → objekt', parseMontageJson({ meta: META }) !== null);
  check('veljavni JSON niz → objekt', parseMontageJson(JSON.stringify({ meta: META })) !== null);
}

// ── 2) Krog shranjevanja ──
{
  const stored: StoredMontage = { meta: META };
  const json = serializeMontage(stored);
  check('serialize vrne niz', typeof json === 'string', typeof json);
  const back = parseMontageJson(json);
  check('krog → isti profil', back?.meta.profileId === META.profileId, back?.meta.profileId);
  check('krog → ista širina ravnine', back?.meta.planeCm.wCm === 600, back?.meta.planeCm.wCm);
  check('serialize(null) → null', serializeMontage(null) === null);
}

// ── 3) List iz ponudbe ──
{
  const offer = { number: '2026-007', customerName: 'Stranka', objectAddress: 'Kranj' };
  check('ponudba brez fotomontaže → NI lista', buildOfferSheet(offer, null, { bayCm: 150 }) === null);

  const built = buildOfferSheet(offer, parseMontageJson({ meta: META }), { bayCm: 150, baySource: 'measured' });
  check('s fotomontažo → list nastane', built !== null);
  check('list vsebuje število ponudbe', (built?.html ?? '').includes('2026-007'));
  check('list vsebuje ime stranke', (built?.html ?? '').includes('Stranka'));
  check('list vsebuje razmak stebrov', (built?.html ?? '').includes('150,0 cm'));
  check('list vsebuje stebri', (built?.html ?? '').includes('Lega stebrov'));
  check('izmerjen razmak je označen kot izmerjen', (built?.html ?? '').includes('izmerjen'), 'oznaka');

  // brez razmaka → BLOKADA (ne izmišljena številka)
  const noBay = buildOfferSheet(offer, parseMontageJson({ meta: META }), { bayCm: 0 });
  check('brez razmaka → blokada v listu', (noBay?.html ?? '').includes('LIST NI NATISLJIV'));
  check('brez razmaka → ni izračunanih stebrov', (noBay?.sheet.postCount ?? 0) === 0, noBay?.sheet.postCount);

  // predlog razmaka je OZNAČEN
  const assumed = buildOfferSheet(offer, parseMontageJson({ meta: META }), { bayCm: 150, baySource: 'assumed' });
  check('predlog razmaka je označen kot PREDLOG', (assumed?.html ?? '').includes('PREDLOG'), 'oznaka');
  check('predlog razmaka ima opozorilo', (assumed?.sheet.warnings ?? []).some((w) => w.includes('PREDLOG')), assumed?.sheet.warnings);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
