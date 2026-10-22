// Verifikacija SPOROČILA ZA MONTERJA (install-sheet-message.ts):
//   1) sporočilo vsebuje ISTE številke kot lista (nič ni izmišljeno);
//   2) predlog razmaka je v sporočilu OZNAČEN kot predlog, ne kot izmerjen;
//   3) blokiran list → sporočilo pove, kaj manjka, in NE izriše številk;
//   4) stebri in pritrdila so jasno ločena od kosovnice (iskrenost).
// Zagon: bun tests/verify/install-sheet-message.ts
import { buildInstallerSheetMessage } from '../../src/lib/install-sheet-message';
import { buildInstallerSheet } from '../../src/lib/photo-install-sheet';
import type { ReplaceMetadata } from '../../src/lib/photo-replace-core';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

const META = {
  scriptVersion: 'photo-replace-v1', profileId: 'polna-100', profileLabel: 'ROKSAL polna deska 100',
  catalogSku: null, texture: null, planeCm: { wCm: 600, hCm: 190 },
  params: { pattern: 'vertikalne', elementCm: 10, spacingCm: 2 },
  maskHash: 'a', layoutHash: 'b', imgSize: { w: 1280, h: 890 }, inpaint: 'ok', warnings: [],
  exportLabel: 'ROKSAL original', createdAt: '2026-10-19T10:00:00.000Z',
} as unknown as ReplaceMetadata;

console.log('Sporočilo za monterja (install-sheet-message) — iz števil, ne iz misli\n');

const sheet = buildInstallerSheet({ meta: META, bayCm: 150, baySource: 'measured', panelHeightCm: 190 });
const msg = buildInstallerSheetMessage({ sheet, obrtnik: 'ROKSAL Kranj', objekt: 'Balkon — Cesta 12', ponudba: '2026-001' });

// ── 1) iste številke kot v listu ──
check('vsebuje številko ponudbe', msg.includes('2026-001'), msg);
check('vsebuje obrt', msg.includes('ROKSAL Kranj'));
check('vsebuje objekt', msg.includes('Cesta 12'));
check('vsebuje dolžino trase', msg.includes('600 cm'), msg);
check('vsebuje število stebrov', msg.includes('Stebri: 5'), msg);
check('vsebuje število desk', msg.includes('Deske: 48 kosov'), msg);
check('vsebuje metre', msg.includes('91,2 m'), msg);
check('vsebuje rez deske', msg.includes('190 cm'), msg);
check('vsebuje nabavne kose', msg.includes('Nabavni profili: 16'), msg);
check('vsebuje odpad', msg.includes('odpad 160 cm'), msg);
check('ni HTML oznak', !msg.includes('<') && !msg.includes('&nbsp;'), msg);

// ── 2) predlog razmaka je označen ──
const predlog = buildInstallerSheetMessage({
  sheet: buildInstallerSheet({ meta: META, bayCm: 150, baySource: 'assumed', panelHeightCm: 190 }),
});
check('predlog razmaka je OZNAČEN', predlog.includes('PREDLOG'), predlog);
check('izmerjen razmak ni označen kot predlog', !msg.includes('PREDLOG'), msg);
check('izmerjen razmak je označen kot izmerjen', msg.includes('izmerjen'), msg);

// ── 3) blokiran list → brez številk ──
const blocked = buildInstallerSheetMessage({
  sheet: buildInstallerSheet({ meta: META, bayCm: 0, baySource: 'assumed', panelHeightCm: 190 }),
});
check('blokiran list → pove, da manjka', blocked.includes('MANTAŽNI LIST NI IZVEDEN') === false && blocked.includes('MONTAŽNI LIST NI IZVEDEN'), blocked);
check('blokiran list → navede razlog', blocked.includes('RAZMAK STEBROV NI VNESEN'), blocked);
check('blokiran list → NE izriše številk desk', !/Deske: \d/.test(blocked), blocked);

// ── 4) iskrenost glede stebrov in pritrdil ──
check('opozori, da stebri/pritrdila niso v kosovnici', msg.includes('Stebri in pritrdila nista v kosovnici'), msg);

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
