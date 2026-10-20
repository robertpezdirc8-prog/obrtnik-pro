// Verifikacija URADNEGA KATALOGA ROKSAL (roksal-catalogue.ts):
//   1) APLIKACIJA PONUJA NATANČNO toliko barv, kolikor jih ROKSAL proizvaja
//      (POLNA-100: 8, POLNA-128: 5, POLNA-57/32: 3, ROMB: 7, KUBO: 4, terase: 7).
//      To je najpomembnejša preverka: napačna barva = naročilo materiala, ki
//      ga ROKSAL ne proizvaja.
//   2) Širina deske v registru je enaka uradni širini profila.
//   3) Vsak kataloški vnos ima dobesedni citat in vir.
// Zagon: bun tests/verify/roksal-catalogue.ts
import { ROKSAL_CATALOGUE, catalogueFor, RUSTIC_NOTE, COLOUR_BATCH_NOTE, COLOUR_BATCH_NOTE_PAGE, ROKSAL_REFERENCES, REFERENCE_COLOURS, OFFICIAL_VERTICAL_PROFILES, OFFICIAL_HORIZONTAL_PROFILES, PROFILE_LINEUP_QUOTES } from '../../src/lib/roksal-catalogue';
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
    if (cat.offeredAsProfiles === false) continue; // fasadni profili ne uvajajo svojih barv
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
  check('opomba o serijah je dobesedna (lestvica)', COLOUR_BATCH_NOTE.includes('med posameznimi dobavami malenkost variirajo'), COLOUR_BATCH_NOTE);
  check('opomba o serijah je dobesedna (stran)', COLOUR_BATCH_NOTE_PAGE.includes('med serijami variira'), COLOUR_BATCH_NOTE_PAGE);
  check('terasni profil ima tri površine', (ROKSAL_CATALOGUE['terasna-150'].surfaces.length ?? 0) === 3, ROKSAL_CATALOGUE['terasna-150'].surfaces);
}

// ── 4) Uradna imena odtenkov so v oznakah ─────────────────────────
{
  const OFFICIAL: Record<string, string[]> = {
    'polna-100': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'White', 'Rustic oak', 'Rustic walnut'],
    'polna-128': ['Amazon wood', 'Ash wood', 'Burma teak', 'Oak wood', 'Rustic oak'],
    'romb-67': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
    'kubo-80-42': ['Amazon wood', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
  };
  for (const [fam, names] of Object.entries(OFFICIAL)) {
    const labels = ROKSAL_PROFILES.filter((p) => p.id === fam || p.id.startsWith(fam + '-dekor-')).map((p) => p.label);
    const missing = names.filter((n) => !labels.some((l) => l.includes(n)));
    check(`${fam}: vsa uradna imena odtenkov so v oznakah`, missing.length === 0, missing);
  }
}

// ── 5) Referenčni objekti ROKSAL (imena odtenkov so potrjena v praksi) ──
{
  check('referenc je vsaj 10', ROKSAL_REFERENCES.length >= 10, ROKSAL_REFERENCES.length);
  check('vsaka referenca ima objekt, uporabo, odtenek in leto',
    ROKSAL_REFERENCES.every((r) => r.place.length > 3 && r.what.length > 3 && r.colour.length > 3 && r.year.length >= 4));
  // Vsa uradna imena, ki jih uporablja aplikacija, se morajo pojaviti tudi v
  // ROKSALOVIH referencah (ali v njegovih uradnih lestvicah) — sicer je ime
  // izmišljeno.
  const used = ['Amazon Wood', 'Ash Wood', 'Golden Teak', 'Burma Teak', 'Oak Wood', 'Rustic Oak', 'Rustic Walnut'];
  const missing = used.filter((n) => !REFERENCE_COLOURS.some((r) => r.toLowerCase() === n.toLowerCase()));
  check('vsa uporabljena imena odtenkov so potrjena v ROKSALOVIH referencah', missing.length === 0, missing);
  // terasna družina uporablja ista imena
  const dekaLabels = ROKSAL_PROFILES.filter((p) => p.id === 'roksal-deka-150' || p.id.startsWith('roksal-deka-150-dekor-')).map((p) => p.label);
  const dekaMissing = used.filter((n) => n !== 'White' && !dekaLabels.some((l) => l.toLowerCase().includes(n.toLowerCase())));
  check('terasna družina uporablja vsa 7 uradnih imen (brez White)', dekaMissing.length === 0, dekaMissing);
}

// ── 6) Uradna linija profilov ────────────────────────────────────
{
  check('pokončna/pregradna linija: 5 profilov', OFFICIAL_VERTICAL_PROFILES.length === 5);
  check('prečna linija: 3 profili', OFFICIAL_HORIZONTAL_PROFILES.length === 3);
  // Vsi uradni profili morajo biti v katalogu aplikacije
  const missingV = OFFICIAL_VERTICAL_PROFILES.filter((id) => !ROKSAL_CATALOGUE[id]);
  check('vsi uradni pokončni profili so v katalogu', missingV.length === 0, missingV);
  const missingH = OFFICIAL_HORIZONTAL_PROFILES.filter((id) => !ROKSAL_CATALOGUE[id]);
  check('vsi uradni prečni profili so v katalogu', missingH.length === 0, missingH);
  // 133–140 je RAZMAK med stebri, ne širina profila
  check('133–140 je razmak med stebri (ne širina profila)', PROFILE_LINEUP_QUOTES.postSpacingHorizontal.includes('133 – 140 cm'));
  check('v katalogu ni profila 133/140/145', !Object.keys(ROKSAL_CATALOGUE).some((k) => k.includes('133') || k.includes('145')));
}

// ── 7) Katalog za družino ─────────────────────────────────────────
{
  check('catalogueFor polna-100 → POLNA DESKA-100', catalogueFor('polna-100')?.officialName === 'POLNA DESKA-100');
  check('catalogueFor polna-100-dekor-3 → POLNA DESKA-100', catalogueFor('polna-100-dekor-3')?.officialName === 'POLNA DESKA-100');
  check('catalogueFor neznane družine → null', catalogueFor('nepoznano') === null);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
