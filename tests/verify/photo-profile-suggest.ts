// Verifikacija predloga najbližjega profila iz izmerjene deske (Task 66 —
// kandidat #3 iz raziskave docs/task63-podobni-programi.md):
//   1) Uradne mere: za VSAKOb uradno širino programa ROKSAL (5,7 / 6,7 / 8 / 10 /
//      12,8 / 15 cm) je top predlog pravi profil z diff 0 in "natančno".
//   2) Dedup: barvne različice istega profila (isti plankCm+gapCm+smer+pattern)
//      so EN predlog + variants seznam; alu-palice-18 in piketna-18 NISTA
//      združena (različen pattern).
//   3) Pragovi: exact ≤ 0,3 cm; close ≤ 10 % izmere; sicer far — vsa tri stanja
//      testirana tudi na meji.
//   4) Iskrenost: generični profil (wpc-deka-140) je predlagan, kadar je
//      res najbližji po meri (14 cm) — ne skrivanja; opozorili za < 0,3 cm
//      in > 25 cm; razlika VEDNO izračunana in v opisu.
//   5) POVIAV s homografijo (povezava dveh obstoječih sklopov): izmerjena
//      deska pride iz planeDistanceCm (perspektivno popravljeno), ne
//      pikselske ocene — test z calibratePlane na realnem kvadratu.
//   6) Determinizem: enaki vhodi → identičen JSON; urejanje po diff → id.
// Zagon: bun tests/verify/photo-profile-suggest.ts
import { ROKSAL_PROFILES } from '../../src/lib/roksal-assets';
import {
  suggestProfiles,
  matchQuality,
  suggestionText,
  fmtNum,
  EXACT_MAX_CM,
  CLOSE_MAX_PCT,
  DEFAULT_TOP_N,
} from '../../src/lib/photo-profile-suggest';
import { calibratePlane, planeDistanceCm } from '../../src/lib/homography';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};
const throwsMsg = (fn: () => unknown): string => {
  try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

console.log('Predlog najbližjega profila (photo-profile-suggest) — deterministično, iskreno\n');

// ── 1) Uradne mere ───────────────────────────────────────────────
console.log('Uradne mere programa (top predlog = pravi profil, diff 0, natančno):');
const official: Array<[string, string, number]> = [
  ['polna-57-32', '5,7', 5.7],
  ['romb-67', '6,7', 6.7],
  ['kubo-80-42', '8', 8],
  ['polna-100', '10', 10],
  ['polna-128', '12,8', 12.8],
  ['roksal-deka-150', '15', 15],
];
for (const [id, label, cm] of official) {
  const inCatalog = ROKSAL_PROFILES.some((p) => p.id === id && p.plankCm === cm);
  check(`katalog ima ${id} s širino ${label} cm`, inCatalog);
  const r = suggestProfiles(cm);
  const hit = r.suggestions.find((s) => s.profile.id === id);
  check(`${label} cm → ${id} je predlagan z diff 0 in natančno`, !!hit && hit.diffCm === 0 && hit.quality === 'exact');
}
// 8 cm imata DVA profila (fasadna-obloga-8 + kubo-80-42) — urejanje po diff →
// id daje fasadno prvo (determinizem preverjen v bloku 6), kubo pa MORA biti prisoten.
check('8 cm → kubo-80-42 prisoten med predlogi z diff 0', suggestProfiles(8).suggestions.some((s) => s.profile.id === 'kubo-80-42' && s.diffCm === 0));

// ── 2) Dedup + variants ─────────────────────────────────────────
console.log('\nDedup po postavitveni meri (barvne različice = en predlog):');
const r15 = suggestProfiles(15);
const dekaVariants = r15.variants['roksal-deka-150'] ?? [];
check('15 cm → roksal-deka-150 je top (rep dekor 1/7)', r15.suggestions[0]?.profile.id === 'roksal-deka-150');
check('15 cm → 7 barvnih različic v variants', dekaVariants.length === 7, `dejavansko: ${dekaVariants.length}`);
check('15 cm → variants vsebuje dekor-2…dekor-7', ['roksal-deka-150-dekor-2', 'roksal-deka-150-dekor-7'].every((id) => dekaVariants.includes(id)));
const repIds = r15.suggestions.map((s) => s.profile.id);
check('15 cm → brez duplikatov id-jev v predlogih', new Set(repIds).size === repIds.length);
check('15 cm → brez dekor-sledilcev kot ločenih predlogov (samo rep)', !repIds.some((id) => id.startsWith('roksal-deka-150-dekor')));

const r18 = suggestProfiles(1.8);
const ids18 = r18.suggestions.map((s) => s.profile.id);
check('1,8 cm → alu-palice-18 in piketna-18 sta LOČENA predloga (različen pattern)', ids18.includes('alu-palice-18') && ids18.includes('piketna-18'));
const alu = r18.suggestions.find((s) => s.profile.id === 'alu-palice-18');
const pik = r18.suggestions.find((s) => s.profile.id === 'piketna-18');
check('1,8 cm → oba diff 0 natančno, urejena po id (alu < piketna)', !!alu && !!pik && alu.diffCm === 0 && pik.diffCm === 0
  && r18.suggestions.indexOf(alu!) < r18.suggestions.indexOf(pik!));
check('1,8 cm → mreza-3d-125 (0,5 cm) NI izgubljena kot različica', !(r18.variants['alu-palice-18'] ?? []).includes('mreza-3d-125'));

// ── 3) Pragovi ──────────────────────────────────────────────────
console.log('\nPragovi kakovosti (exact ≤ 0,3 cm, close ≤ 10 %):');
check('prag EXACT_MAX_CM = 0,3', EXACT_MAX_CM === 0.3);
check('prag CLOSE_MAX_PCT = 10', CLOSE_MAX_PCT === 10);
check('matchQuality(0,3) → exact (meja vključena)', matchQuality(0.3, 10) === 'exact');
check('matchQuality(0,31) pri 10 cm → close', matchQuality(0.31, 10) === 'close');
check('matchQuality(1,0) pri 10 cm → close (10 %)', matchQuality(1.0, 10) === 'close');
check('matchQuality(1,01) pri 10 cm → far (nad 10 %)', matchQuality(1.01, 10) === 'far');
check('matchQuality pri majhni meri je relativno (0,4 pri 1,8 cm → far, ne close)', matchQuality(0.4, 1.8) === 'far');
const r105 = suggestProfiles(10.5);
check('10,5 cm → top polna-100 "blizu" (diff 0,5 ≤ 10 %)', r105.suggestions[0]?.profile.id === 'polna-100' && r105.suggestions[0]?.quality === 'close', `dejavansko: ${JSON.stringify(r105.suggestions[0])}`);
const r128 = suggestProfiles(13);
check('13 cm → polna-128 "natančno" (diff 0,2 ≤ 0,3)', r128.suggestions[0]?.profile.id === 'polna-128' && r128.suggestions[0]?.quality === 'exact');
const r20 = suggestProfiles(20);
check('20 cm → vse "različno" (noben profil ≥ 15 cm ni blizu 10 %)', r20.suggestions.every((s) => s.quality === 'far'));
check('20 cm → top je največji profil (roksal-deka-150)', r20.suggestions[0]?.profile.id === 'roksal-deka-150');
check('20 cm → BREZ opozorila (20 < 25)', r20.warnings.length === 0, `opozorila: ${JSON.stringify(r20.warnings)}`);

// ── 4) Iskrenost ────────────────────────────────────────────────
console.log('\nIskrenost (generični najbližji NI skrit; opozorila; razlika v opisu):');
const r14 = suggestProfiles(14);
check('14 cm → top je generični wpc-deka-140 (res najbližji po meri)', r14.suggestions[0]?.profile.id === 'wpc-deka-140' && r14.suggestions[0]?.diffCm === 0);
check('14 cm → wpc-deka-140 ima antracit kot različico (2)', (r14.variants['wpc-deka-140'] ?? []).length === 2);
check('14 cm → polna-128 je prisoten kot uradna alternativna (blizu, diff 1,2)', r14.suggestions.some((s) => s.profile.id === 'polna-128' && s.diffCm === 1.2));
const r30 = suggestProfiles(30);
check('30 cm → opozorilo: izmeril si mero celotnega polja', r30.warnings.some((w) => w.includes('ENE deske')), JSON.stringify(r30.warnings));
const r02 = suggestProfiles(0.2);
check('0,2 cm → opozorilo: pod najmanjšim elementom', r02.warnings.some((w) => w.includes('0,3 cm')), JSON.stringify(r02.warnings));
const t = suggestionText({ profile: ROKSAL_PROFILES[0], diffCm: 0, diffPct: 0, quality: 'exact' });
check('suggestionText natančno vsebuje razliko v cm in %', t === 'natančno ujemanje: razlika 0,0 cm (0,0 %)', t);
check('fmtNum je determinističen (vejica, NI toLocaleString)', fmtNum(5.7, 1) === '5,7' && fmtNum(12.8, 1) === '12,8' && fmtNum(0.15, 1) === '0,1' && fmtNum(0.25, 1) === '0,3');
const allExact = suggestProfiles(10);
check('razlika je VEDNO izračunana (tudi pri natančno: 0,0)', allExact.suggestions.every((s) => Number.isFinite(s.diffCm) && Number.isFinite(s.diffPct)));
check('privzeto topN = 6', DEFAULT_TOP_N === 6 && suggestProfiles(10).suggestions.length <= 6);

// ── 5) Povezava s homografijo (pravi vir izmere) ────────────────
console.log('\nPovezava dveh sklopov: izmera prek planeDistanceCm (perspektivno popravljeno):');
const QUAD = [[12, 48], [88, 48], [88, 92], [12, 92]] as [number, number][];
const IMG = { w: 1280, h: 890 };
const plane = calibratePlane(QUAD.map(([x, y]) => ({ x, y })), 500, 180, IMG);
check('kalibracija ravnine 500×180 uspešna', !!plane);
if (plane) {
  // ravnina pokriva 76 % širine fotke (12–88 %): 2 % RAVNINE = 1,52 % fotke
  const d10 = planeDistanceCm(plane, { x: 19, y: 55 }, { x: 20.52, y: 55 }, IMG); // 2 % od 500 cm = 10 cm
  check('2 % širine ravnine izmeri 10,0 cm (ne pikselska ocena)', d10 === 10, `dejavansko: ${d10}`);
  if (d10 !== null) {
    const sug = suggestProfiles(d10);
    check('izmerjeno 10 cm → polna-100 natančno (celoten krog: fotka → meritev → profil)', sug.suggestions[0]?.profile.id === 'polna-100' && sug.suggestions[0]?.quality === 'exact');
  }
  const d25 = planeDistanceCm(plane, { x: 25, y: 55 }, { x: 28.8, y: 55 }, IMG); // 5 % ravnine = 25 cm
  check('5 % širine ravnine izmeri 25,0 cm', d25 === 25, `dejavansko: ${d25}`);
}

// ── 6) Determinizem + robni primeri ─────────────────────────────
console.log('\nDeterminizem + robni primeri:');
const a = JSON.stringify(suggestProfiles(12.8));
const b = JSON.stringify(suggestProfiles(12.8));
check('enaki vhodi → identičen JSON', a === b);
const r8 = suggestProfiles(8);
check('8 cm brez filtra: fasadna-obloga-8 in kubo-80-42 oba natančno, urejena po id', r8.suggestions[0]?.profile.id === 'fasadna-obloga-8' && r8.suggestions[1]?.profile.id === 'kubo-80-42', JSON.stringify(r8.suggestions.slice(0, 2).map((s) => s.profile.id)));
const rv = suggestProfiles(15, { orientation: 'vertical' });
check('smer vertical: roksal-deka-150 izključen, top je polna-128', !rv.suggestions.some((s) => s.profile.id.startsWith('roksal-deka-150')) && rv.suggestions[0]?.profile.id === 'polna-128');
const rh = suggestProfiles(15, { orientation: 'horizontal' });
check('smer horizontal: roksal-deka-150 je top', rh.suggestions[0]?.profile.id === 'roksal-deka-150');
const rTop2 = suggestProfiles(15, { topN: 2 });
check('topN 2 → dolžina 2', rTop2.suggestions.length === 2);
check('topN zanemari skupine (variants ključi ≤ topN)', Object.keys(rTop2.variants).length <= 2);
check('NaN → jasna napaka', throwsMsg(() => suggestProfiles(NaN)).includes('NEZADOSTNI PODATKI'));
check('0 → jasna napaka', throwsMsg(() => suggestProfiles(0)).includes('NEZADOSTNI PODATKI'));
check('negativno → jasna napaka', throwsMsg(() => suggestProfiles(-3)).includes('NEZADOSTNI PODATKI'));
check('topN 0 → jasna napaka', throwsMsg(() => suggestProfiles(10, { topN: 0 })).includes('NEZADOSTNI PODATKI'));
check('topN 43 → jasna napaka', throwsMsg(() => suggestProfiles(10, { topN: 43 })).includes('NEZADOSTNI PODATKI'));
check('topN ne-celo → jasna napaka', throwsMsg(() => suggestProfiles(10, { topN: 2.5 })).includes('NEZADOSTNI PODATKI'));
check('neznana smer → jasna napaka', throwsMsg(() => suggestProfiles(10, { orientation: 'diagonal' as 'horizontal' })).includes('NEZADOSTNI PODATKI'));

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
