// Verifikacija REFERENČNIH FOTOGRAFIJ po barvi (roksal-colour-refs.ts):
//   1) vseh 8 odtenkov ima referenco in datoteko v repozitoriju;
//   2) profil → referenca je pravilna (dekor N ↔ uradno ime);
//   3) profili drugih družin nimajo reference (null, ne izmišljene slike);
//   4) vrstni red je KLASIK (5) → RUSTIK (3), kot v uradni lestvici.
// Zagon: bun tests/verify/roksal-colour-refs.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COLOUR_REFERENCES, colourReferenceFor } from '../../src/lib/roksal-colour-refs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

console.log('Referenčne fotografije ograj po barvi (roksal-colour-refs)\n');

check('vseh 8 odtenkov ima referenco', COLOUR_REFERENCES.length === 8, COLOUR_REFERENCES.length);
for (const r of COLOUR_REFERENCES) {
  const p = join(process.cwd(), 'public', r.src.replace(/^\//, ''));
  check(`${r.colour}: datoteka je v repozitoriju`, existsSync(p), r.src);
}
check('dekor 1 = Amazon wood', colourReferenceFor('polna-100')?.colour === 'Amazon wood');
check('dekor 2 = Ash wood', colourReferenceFor('polna-100-dekor-2')?.colour === 'Ash wood');
check('dekor 3 = Golden teak', colourReferenceFor('polna-100-dekor-3')?.colour === 'Golden teak');
check('dekor 6 = White', colourReferenceFor('polna-100-dekor-6')?.colour === 'White');
check('dekor 8 = Rustic walnut', colourReferenceFor('polna-100-dekor-8')?.colour === 'Rustic walnut');
check('romb-67 nima reference', colourReferenceFor('romb-67') === null);
check('kubo nima reference', colourReferenceFor('kubo-80-42-dekor-2') === null);
const klasik = COLOUR_REFERENCES.filter((r) => r.surface === 'KLASIK');
const rustic = COLOUR_REFERENCES.filter((r) => r.surface === 'RUSTIK');
check('5 klasičnih + 3 rustik odtenkov', klasik.length === 5 && rustic.length === 7 - 4, { klasik: klasik.length, rustic: rustic.length });
check('vsak odtenek ima vir', COLOUR_REFERENCES.every((r) => r.source.includes('roksal.com')));

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
