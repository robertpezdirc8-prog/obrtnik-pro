// ─── REFERENČNE FOTOGRAFIJE OGRAJ PO BARVI (P3) ─────────────────────────────
// Uporabnik je vprašal, »ali imate reference barv«. Na roksal.com so objavljene
// fotografije VGRAJENIH ograj v posameznih barvah (galerija + media knjižnica
// WordPress API-ja). Te so zdaj v repozitoriju, da ob izbiri barve pokažemo
// PRAVO vgrajeno ograjo v tej barvi — to je najmočnejši argument pri stranki
// (konkurentna orodja ponujajo generične slike).
//
// Vrstni red je vrstni red uradne barvne lestvice (BARVE KLASIK: Amazon wood,
// Ash wood, Golden teak, Burma teak, Oak wood; BARVE RUSTIK: White, Rustic oak,
// Rustic walnut) — to je isti vrstni red kot dekor 1–8 v registru.

export interface ColourReference {
  /** dekor 1–8 (kot v uradni lestvici) */
  dekor: number;
  /** uradno ime odtenka */
  colour: string;
  /** skupina površine */
  surface: 'KLASIK' | 'RUSTIK';
  /** pot do fotografije v repozitoriju */
  src: string;
  /** vir (roksal.com) */
  source: string;
}

export const COLOUR_REFERENCES: ColourReference[] = [
  { dekor: 1, colour: 'Amazon wood', surface: 'KLASIK', src: '/roksal/ograje/polna-100/ref-amazon-wood.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 2, colour: 'Ash wood', surface: 'KLASIK', src: '/roksal/ograje/polna-100/ref-ash-wood.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 3, colour: 'Golden teak', surface: 'KLASIK', src: '/roksal/ograje/polna-100/ref-golden-teak.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 4, colour: 'Burma teak', surface: 'KLASIK', src: '/roksal/ograje/polna-100/ref-burma-teak.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 5, colour: 'Oak wood', surface: 'KLASIK', src: '/roksal/ograje/polna-100/ref-oak-wood.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 6, colour: 'White', surface: 'RUSTIK', src: '/roksal/ograje/polna-100/ref-white.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 7, colour: 'Rustic oak', surface: 'RUSTIK', src: '/roksal/ograje/polna-100/ref-rustic-oak.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
  { dekor: 8, colour: 'Rustic walnut', surface: 'RUSTIK', src: '/roksal/ograje/polna-100/ref-rustic-walnut.jpg', source: 'roksal.com → galerija (fotografija vgrajene ograje)' },
];

/**
 * Referenca za profil (npr. 'polna-100-dekor-3' → Golden teak).
 * Profili drugih družin (ROMB, KUBO, terase) nimajo svojih referenc —
 * vrne null, UI pa to pove.
 */
export function colourReferenceFor(profileId: string): ColourReference | null {
  const m = /^polna-100(?:-dekor-(\d+))?$/.exec(profileId);
  if (!m) return null;
  const dekor = m[1] ? Number(m[1]) : 1;
  return COLOUR_REFERENCES.find((r) => r.dekor === dekor) ?? null;
}
