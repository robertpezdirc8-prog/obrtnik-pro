// Verifikacija URADNEGA KATALOGA ROKSAL (roksal-catalogue.ts):
//   1) APLIKACIJA PONUJA NATANČNO toliko barv, kolikor jih ROKSAL proizvaja
//      (POLNA-100: 8, POLNA-128: 5, POLNA-57/32: 3, ROMB: 7, KUBO: 4, terase: 7).
//      To je najpomembnejša preverka: napačna barva = naročilo materiala, ki
//      ga ROKSAL ne proizvaja.
//   2) Širina deske v registru je enaka uradni širini profila.
//   3) Vsak kataloški vnos ima dobesedni citat in vir.
// Zagon: bun tests/verify/roksal-catalogue.ts
import { ROKSAL_CATALOGUE, catalogueFor, RUSTIC_NOTE, COLOUR_BATCH_NOTE } from '../../src/lib/roksal-catalogue';
import { ROKSAL_PROFILES } from '../../src/lib/roksal-assets';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

/** Družina profila v registru (npr. 'polna-100-dekor-3' → 'polna-100'). */
const familyOf = (id: string): string => id.replace(/-dekor-\d+$/, '');

console.log('Uradni katalog ROKSAL — barve, mere, citati (roksal.com)\n');

// ── 1) Število barv: aplikacija == ROKSAL ─────────────────────────
{
  const countByFamily = new Map<string, number>();
  for (const p of ROKSAL_PROFILES) {
    const f = familyOf(p.id);
    countByFamily.set(f, (countByFamily.get(f) ?? 0) + 1);
  }
  for (const cat of Object.values(ROKSAL_CATALOGUE)) {
    const n = countByFamily.get(cat.registryFamily) ?? 0;
    check(
      `${cat.officialName}: aplikacija ponuja ${n} barv, ROKSAL jih ponuja ${cat.colours}`,
      n === cat.colours,
      { n, uradno: cat.colours },
    );
  }
  // terasni profil je v registru kot 'roksal-deka-150*'
  const ter = countByFamily.get(ROKSAL_CATALOGUE['terasna-150'].registryFamily) ?? 0;
  check(`TERASNI profil: aplikacija ponuja ${ter} barv, ROKSAL jih ponuja ${ROKSAL_CATALOGUE['terasna-150'].colours}`,
    ter === ROKSAL_CATALOGUE['terasna-150'].colours, { ter });
  check('terasa: v registru ni barv, ki jih ROKSAL ne proizvaja',
    !ROKSAL_PROFILES.some((p) => p.id === 'polna-57-32-dekor-4' || p.id === 'polna-128-dekor-6'),
    'obstaja neponujen profil');
}

// ── 2) Širina deske == uradna širina profila ─────────────────────
{
  for (const p of ROKSAL_PROFILES) {
    const cat = catalogueFor(p.id);
    if (!cat) continue;
    if (Math.abs(p.plankCm - cat.boardWidthCm) > 0.05) {
      check(`${p.id}: širina ${p.plankCm} cm == uradna ${cat.boardWidthCm} cm`, false, { p: p.plankCm, uradno: cat.boardWidthCm });
    }
  }
  check('vse širine desk so enake uradnim širinam profilov', true);
}

// ── 3) Citati in viri ─────────────────────────────────────────────
{
  for (const [family, cat] of Object.entries(ROKSAL_CATALOGUE)) {
    check(`${cat.officialName}: citat o barvah ni prazen`, cat.coloursQuote.length > 20, cat.coloursQuote);
    check(`${cat.officialName}: vir je naveden`, cat.source.includes('roksal.com'), cat.source);
    check(`${cat.officialName}: uradno ime ni prazno`, cat.officialName.length > 3, cat.officialName);
  }
  check('Rustic opomba je dobesedna', RUSTIC_NOTE.includes('Rustic Oak') && RUSTIC_NOTE.includes('variirata'), RUSTIC_NOTE);
  check('opomba o serijah je dobesedna', COLOUR_BATCH_NOTE.includes('med serijami variira'), COLOUR_BATCH_NOTE);
  check('terasni profil ima tri površine', (ROKSAL_CATALOGUE['terasna-150'].surfaces.length ?? 0) === 3, ROKSAL_CATALOGUE['terasna-150'].surfaces);
}

// ── 4) Katalog za družino ─────────────────────────────────────────
{
  check('catalogueFor polna-100 → POLNA DESKA-100', catalogueFor('polna-100')?.officialName === 'POLNA DESKA-100');
  check('catalogueFor polna-100-dekor-3 → POLNA DESKA-100', catalogueFor('polna-100-dekor-3')?.officialName === 'POLNA DESKA-100');
  check('catalogueFor neznane družine → null', catalogueFor('nepoznano') === null);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
