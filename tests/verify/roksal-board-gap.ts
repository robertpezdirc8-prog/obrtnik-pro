// ─── Preverb: REŽA med deskami sme biti samo objavljena ────────────────────
// KAJ JE BILO NAROBNO (Task 82): katalog je za vse profile trdil „uradni FAQ
// obseg 0,2–3 cm“ in za ROMB „110 cm za nosilce“. Nobena stran ROKSALa tega ne
// objavlja. „0,2–3“ je seštevek DVEH LOČENIH objav (2 mm kot običajna vrednost
// za POLNA DESKA-100 na fasadi in 3 cm kot zgornji rob priporočenega pasu za
// 100/128 na ograji). Izmišljena številka je nevarnejša od manjkajoče — monter
// jo prebere kot dovoljenje.
//
// KAJ PRIKAŽE (zakaj ta vrsta napake ne more več zaiti):
//  1. `boardGap()` za profil vrne SAMO to, kar je pod njegovim naslovom
//     objavljeno (pas, običajna vrednost, „poljuben“, posledica) ali UNKNOWN;
//  2. objava, ki ima dva profila v naslovu, velja za OBA (OR množica);
//  3. številka enega profila se NE SME prenesti na drugega;
//  4. ADJACENT citat (številka v samem vprašanju) nikoli ne postane mera;
//  5. produktna kartica (foto-replace) ima ŽIG reže — objava ali privzetek;
//  6. v katalogu (`roksal-assets.ts`) izmišljenih navedek nihče več ne ponavlja.
//
// Zagon: bun tests/verify/roksal-board-gap.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SPAN_RULES, boardGap, boardGapStamp, maxAllowedSpan, profileKindForCatalog,
  ROKSAL_FAMILIES,
  type BoardGapVerdict,
} from '../../src/lib/roksal-span-rules';
import { ROKSAL_PROFILES } from '../../src/lib/roksal-assets';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const gapRules = SPAN_RULES.filter((r) => r.context === 'board-gap');

/** Ali pravilo sploh imenuje profil (`profiles` ALI `appliesTo: profile=…`). */
const namesProfile = (r: (typeof SPAN_RULES)[number]): boolean =>
  (r.profiles?.length ?? 0) > 0 ||
  (Array.isArray(r.appliesTo) ? r.appliesTo : [r.appliesTo ?? '']).some((c) => c.startsWith('profile='));

/** Besedilo katalogovega profila (opomba je edini uporabniku prikazan podatek). */
const noteOf = (id: string): string => ROKSAL_PROFILES.find((p) => p.id === id)?.note ?? '';

/**
 * Številka SME stati v katalogu samo, če je njena omemba izrecno označena kot
 * napaka (»to ni objava«) — sicer je trditev. Besedilo se razbije na drobne
 * odseke, da negacija ne more kriti sosednje stavčne vrstice.
 */
const NEGATION = /trdi[la]|napa[čc]en|NI ROMBOVA|ni ROMBOVA|NE objavi|ne objavi|ni v nobeni|PRIVZETEK/;
const uncorrectedMentions = (text: string, needle: string): string[] =>
  text.split(/[.;\n]/g)
    .map((c) => c.trim())
    .filter((c) => c.includes(needle) && !NEGATION.test(c));

console.log('1. pravila reže so lahko samo objavljena (brez meja):');
{
  check('reža ima pravila (sicer spodnji testi nimajo vsebine)', gapRules.length >= 5,
    `(${gapRules.length})`);
  check('nobeno pravilo reže ni TIP „limit“ — reža ne more vezati kot meja',
    gapRules.every((r) => r.kind !== 'limit'),
    gapRules.filter((r) => r.kind === 'limit').map((r) => r.id).join(','));
  check('vsako pravilo reže ima citat daljši od 30 znakov',
    gapRules.every((r) => r.quote.length > 30));
  // ADJACENT opomba sme ostati brez profila (nikoli ne postane mera); DIRECT
  // brez profila pa bi bila splošna trditev čez vse profile — napaka Task 81.
  const directGap = gapRules.filter((r) => r.basis === 'DIRECT');
  check('vsako NEPOSREDNO pravilo reže imenuje profil (brez njega številka ne sme biti pokazana)',
    directGap.every(namesProfile),
    directGap.filter((r) => !namesProfile(r)).map((r) => r.id).join(','));
}

console.log('2. pas 0,5–3 cm velja OHEMA profiloma iz naslova (OR množica):');
{
  const p100 = boardGap({ family: 'ograja', profile: 'polna-100' });
  const p128 = boardGap({ family: 'ograja', profile: 'polna-128' });
  check('POLNA-100: SOURCED s pasom 0,5–3 cm',
    p100.state === 'SOURCED' && p100.bandCm?.[0] === 0.5 && p100.bandCm[1] === 3,
    JSON.stringify(p100));
  check('POLNA-128: ISTI pas — naslov imenuje oba, zato `profiles`, ne `appliesTo`',
    p128.state === 'SOURCED' && p128.bandCm?.[0] === 0.5 && p128.bandCm[1] === 3,
    JSON.stringify(p128));
  check('oba profila citirata isto objavo (isti vir in isti citat)',
    p100.sources.join() === p128.sources.join() && p100.quotes.join() === p128.quotes.join(),
    `${p100.sources.join()} | ${p128.sources.join()}`);
  check('opomba pravi, da gre za priporočilo in ne za mejo',
    p100.notes.some((n) => /priporoča razmik 0,5–3 cm/.test(n)), p100.notes.join(' | '));
  check('številke so v besedilu z vejico (slovenski zapis)',
    !/[0-9]\.[0-9]/.test(p100.notes.join(' ')), p100.notes.join(' | '));
}

console.log('3. številka enega profila se NE prenese na drugega:');
{
  const p57 = boardGap({ family: 'ograja', profile: 'polna-57-32' });
  const romb = boardGap({ family: 'ograja', profile: 'romb-67' });
  check('POLNA-57/32: UNKNOWN — zanj reže ni objavljene',
    p57.state === 'UNKNOWN' && p57.bandCm === null && p57.typicalCm === null,
    JSON.stringify(p57));
  check('POLNA-57/32: UI je povedano, DA in ZAKAJ številka velja samo za 100/128',
    p57.notes.some((n) => /velja samo za/.test(n) && /ne sme se prenesti/.test(n)),
    p57.notes.join(' | '));
  check('ROMB-67: UNKNOWN (objava o klipih je na fasadi, ne na ograji)',
    romb.state === 'UNKNOWN' && romb.bandCm === null, JSON.stringify(romb));
  for (const prof of ['polna-57-32', 'romb-67', 'kubo-80-42', 'terasna-150'] as const) {
    const v = boardGap({ family: 'ograja', profile: prof });
    check(`${prof}: brez objave za ta profil ni pasu in ni običajne vrednosti`,
      v.state === 'UNKNOWN' ? v.bandCm === null && v.typicalCm === null : true,
      JSON.stringify(v));
  }
}

console.log('4. ADJACENT (številka STOI V VPRAŠANJU) ne sme postati mera:');
{
  const terasa = boardGap({ family: 'terasa', profile: 'terasna-150' });
  check('terasa: 5–6 mm iz vprašanja NE postane pas',
    terasa.bandCm === null && terasa.typicalCm === null, JSON.stringify(terasa));
  check('terasa: opomba pove, da je številka samo v vprašanju',
    terasa.notes.some((n) => /pojavlja samo v VPRAŠANJU/.test(n)), terasa.notes.join(' | '));
  check('ADJACENT pravilo reže je res označeno ADJACENT',
    gapRules.filter((r) => r.family === 'terasa').every((r) => r.basis === 'ADJACENT'),
    gapRules.filter((r) => r.family === 'terasa').map((r) => `${r.id}:${r.basis}`).join(','));
}

console.log('5. fasada: tri LOČENE objave, nobena ni „uradni obseg“:');
{
  const f100 = boardGap({ family: 'fasada', profile: 'polna-100' });
  const kubo = boardGap({ family: 'fasada', profile: 'kubo-80-42' });
  const romb = boardGap({ family: 'fasada', profile: 'romb-67' });
  check('fasada POLNA-100: običajna vrednost 0,2 cm, pasu ni',
    f100.state === 'SOURCED' && f100.typicalCm === 0.2 && f100.bandCm === null,
    JSON.stringify(f100));
  check('fasada POLNA-100: običaj NI meja in aplikacija iz njega meje ne dela',
    f100.notes.some((n) => /samo običaj/.test(n) && /meje ne dela/.test(n)), f100.notes.join(' | '));
  check('fasada KUBO: izrecno objavljeno, da je razmik POLJUBEN',
    kubo.state === 'PUBLISHED_FREE' && kubo.bandCm === null && kubo.typicalCm === null,
    JSON.stringify(kubo));
  check('fasada ROMB: številke ni, je pa posledica (vidni fasadni klipi)',
    romb.state === 'UNKNOWN' && romb.notes.some((n) => /viden pritrdilni material/.test(n)),
    romb.notes.join(' | '));
  check('iz obeh faq-izjav NI nastala številka 0,2–3 cm',
    !SPAN_RULES.some((r) => r.quote.includes('0,2') && r.quote.includes('3cm')),
    SPAN_RULES.filter((r) => r.quote.includes('0,2') && r.quote.includes('3cm')).map((r) => r.id).join(','));
}

console.log('6. NOSILCI: kjer ROKSAL namerno ne objavi številke:');
{
  const p57 = maxAllowedSpan({ family: 'ograja', context: 'bearers', profile: 'polna-57-32' });
  const p100 = maxAllowedSpan({ family: 'ograja', context: 'bearers', profile: 'polna-100' });
  const p128 = maxAllowedSpan({ family: 'ograja', context: 'bearers', profile: 'polna-128' });
  check('POLNA-57/32: 100 cm je NEPOSREDNO objavljena meja',
    p57.assurance === 'SOURCED' && p57.maxSpanCm === 100, JSON.stringify({ a: p57.assurance, m: p57.maxSpanCm }));
  check('POLNA-100: meje ni — stran napoti na navodila stroke',
    p100.assurance === 'UNKNOWN' && p100.maxSpanCm === 0 &&
      p100.notes.some((n) => /navodila stroke/.test(n)),
    p100.notes.join(' | '));
  check('POLNA-128: enaka napotitev (naslov imenuje oba profila)',
    p128.assurance === 'UNKNOWN' && p128.notes.some((n) => /navodila stroke/.test(n)),
    p128.notes.join(' | '));
  // BISTVO: sporočilo o napotitvi NE SME vsebovati številke — sicer bi UI iz
  // besedila o tuji pristojnosti naredil mejo, ki je ROKSAL ni objavil.
  const deferNote = p100.notes.find((n) => /navodila stroke/.test(n)) ?? '';
  check('opomba o napotitvi je BREZ številke (iz nje ne more nastati meja)',
    !/\d+(?:[.,]\d+)?\s*(?:cm|mm)/.test(deferNote), deferNote);
  const n100 = noteOf('polna-100');
  check('katalog POLNA-100 NE trdi meje nosilcev — pravi, da je ROKSAL ne objavi',
    /NE objavi/.test(n100) && uncorrectedMentions(n100, '80 cm').length === 0, n100);
}

console.log('7. ŽIG na produktni kartici (boardGapStamp):');
{
  const stamp = (id: string) => boardGapStamp(id);
  check('POLNA-100 → žig pravi, da je pas objavljen (0,5–3 cm na ograji)',
    stamp('polna-100').published && /objavlja 0,5–3 cm na ograji/.test(stamp('polna-100').stamp),
    JSON.stringify(stamp('polna-100')));
  check('POLNA-128 → isti objavljeni pas',
    stamp('polna-128').published && stamp('polna-128').stamp === stamp('polna-100').stamp,
    stamp('polna-128').stamp);
  check('KUBO → žig pravi „poljuben“, ne številke',
    stamp('kubo-80-42').published && /poljuben/.test(stamp('kubo-80-42').stamp),
    JSON.stringify(stamp('kubo-80-42')));
  check('POLNA-57/32 → žig JAVI, da gre za privzetek izračuna',
    !stamp('polna-57-32').published && /privzetek izračuna/.test(stamp('polna-57-32').stamp),
    JSON.stringify(stamp('polna-57-32')));
  check('ROMB-67 → žig JAVI, da ROKSAL reže ne objavi',
    !stamp('romb-67').published && /ROKSAL je ne objavlja/.test(stamp('romb-67').stamp),
    JSON.stringify(stamp('romb-67')));
  check('TERASNA-150 → privzetek (5–6 mm je samo v vprašanju)',
    !stamp('roksal-deka-150').published, JSON.stringify(stamp('roksal-deka-150')));
  check('profil brez ROKSALovega para (wpc-deka-140) → privzetek, ne lažna objava',
    !stamp('wpc-deka-140').published && stamp('wpc-deka-140').stamp === 'privzetek izračuna',
    JSON.stringify(stamp('wpc-deka-140')));
  // Različice dekorja morajo dedovati žig osnovnega profila — sicer bi ista
  // deska na dveh karticah trdila različno.
  const dekorFails = ROKSAL_PROFILES
    .filter((p) => /-dekor-\d+$/.test(p.id))
    .filter((p) => {
      const base = p.id.replace(/-dekor-\d+$/, '');
      return boardGapStamp(p.id).stamp !== boardGapStamp(base).stamp;
    });
  check('vsak -dekor-N ima IST žig kot osnovni profil', dekorFails.length === 0,
    dekorFails.map((p) => p.id).join(','));
  const kindFails = ROKSAL_PROFILES.filter((p) => profileKindForCatalog(p.id) === null)
    .map((p) => p.id);
  check('id-ji brez ROKSALovega para so točno tisti, ki ga nimajo (6 baz + njihovih dekorjev)',
    kindFails.every((id) => !['polna-57-32', 'polna-100', 'polna-128', 'romb-67', 'kubo-80-42', 'roksal-deka-150']
      .some((b) => id === b || id.startsWith(`${b}-dekor-`))),
    kindFails.join(','));
}

console.log('8. pogodba vrnjene vrednosti (UI ne sme ugibati):');
{
  const all: BoardGapVerdict[] = [];
  for (const family of ROKSAL_FAMILIES) {
    for (const profile of ['polna-57-32', 'polna-100', 'polna-128', 'romb-67', 'kubo-80-42', 'terasna-150'] as const) {
      all.push(boardGap({ family, profile }));
    }
  }
  all.push(boardGap({ family: 'ograja' }));
  check('vsak odgovor ima state iz treh dovoljenih',
    all.every((v) => v.state === 'SOURCED' || v.state === 'PUBLISHED_FREE' || v.state === 'UNKNOWN'),
    [...new Set(all.map((v) => v.state))].join(','));
  const noProfile = ROKSAL_FAMILIES.map((family) => boardGap({ family }));
  check('brez profila NI številke in je profilMissing javljen',
    noProfile.every((v) => v.profileMissing) && noProfile.every((v) => v.bandCm === null && v.typicalCm === null),
    JSON.stringify(noProfile.map((v) => [v.family, v.bandCm, v.typicalCm])));
  check('brez profila panel reče, da je treba izbrati profil',
    noProfile.every((v) => v.notes.some((n) => /Profil ni izbran/.test(n))),
    noProfile.map((v) => v.notes.join(' | ')).join(' || '));
  check('UNKNOWN nikoli nima bandCm ali typicalCm (mera ne more uiti tiho)',
    all.filter((v) => v.state === 'UNKNOWN').every((v) => v.bandCm === null && v.typicalCm === null));
  check('SOURCED ima vedno vsaj en citat in vir',
    all.filter((v) => v.state === 'SOURCED').every((v) => v.quotes.length > 0 && v.sources.length > 0));
  check('vir je vedno ena od objavljenih strani (brez domišljijskih URL-jev)',
    all.every((v) => v.sources.every((s) => /^roksal\.com\//.test(s))),
    [...new Set(all.flatMap((v) => v.sources))].join(' | '));
}

console.log('9. vezava v UI (koda, ne spomin):');
{
  const frx = readFileSync(join(ROOT, 'src/components/camera/foto-replace.tsx'), 'utf-8');
  check('foto-replace uvozi boardGapStamp iz modula Pravil',
    /import \{ boardGapStamp \} from '@\/lib\/roksal-span-rules'/.test(frx));
  check('kartica vsakega profila ima žig reže (fr-gap-stamp-<id>)',
    /data-testid=\{`fr-gap-stamp-\$\{p\.id\}`\}/.test(frx) && /reža: \{gapStamp\.stamp\}/.test(frx));
  const panel = readFileSync(join(ROOT, 'src/components/camera/post-layout-panel.tsx'), 'utf-8');
  check('panel razporeda uvozi boardGap in ga kliče po profilu',
    /boardGap/.test(panel) && /boardGap\(\{ family: 'ograja', profile \}\)/.test(panel));
  check('panel ima testid-ja za dokaz v E2E',
    /data-testid="post-layout-board-gap"/.test(panel) && /data-testid="post-layout-board-gap-headline"/.test(panel));
  check('panel NE kaže številke reže, kadar je ni (samo „ne objavlja“)',
    /Reže ROKSAL za ta izdelek ne objavlja/.test(panel));
}

console.log('10. izvirovna higiena kataloga (izmišljenih navedek ni več):');
{
  const assets = readFileSync(join(ROOT, 'src/lib/roksal-assets.ts'), 'utf-8');
  // Izmišljene številke SMEJO ostati v datoteki samo kot POPREKANA omemba
  // (zgodovina napake se piše v komentar). Nepritegnjena omemba je trditev.
  const banned: [string, string, string][] = [
    ['0,2–3', assets, 'seštevek dveh ločenih objav (celoten katalog)'],
    ['uradni obseg', assets, 'obseg, ki ga nobena stran ne objavlja (celoten katalog)'],
    ['uradni FAQ obseg', assets, 'ista izmišljotina v starejšem zapisu'],
    ['110 cm', noteOf('romb-67'), '110 cm je meja DESKA-128, ne ROMB-67'],
    ['50–70', assets, 'korita imajo svojo mejo, reža je pa nima'],
  ];
  for (const [needle, where, why] of banned) {
    const bad = uncorrectedMentions(where, needle);
    check(`»${needle}« sme stati samo označena napaka (${why})`, bad.length === 0, bad.join(' || '));
  }
  check('polna-128 PA res sme imeti 110 cm (prečna meja DESKA-128 je objavljena)',
    noteOf('polna-128').includes('110 cm'));
  check('katalog pravi PRIVZETEK IZRAČUNA tam, kjer številke ni',
    (assets.match(/PRIVZETEK IZRAČUNA/g) ?? []).length >= 3);
  check('katalog za POLNA-100/128 prepozna OBJAVLJENI pas (ne svojega)',
    /OBJAVLJENEGA pasu 0,5–3 cm/.test(assets));
  check('katalog za KUBO javi, da je razmik poljuben',
    /razmak med deskami poljuben/.test(assets));
}

console.log(`\n${pass}/${pass + fail} preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
process.exit(fail > 0 ? 1 : 0);
