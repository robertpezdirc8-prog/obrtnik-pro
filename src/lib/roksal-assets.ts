// ─── ROKSAL registry gradiv — ISKREN katalog assetov ─────────
// Pravilo iz zahteve "FOTOZAMENJAVA BREZ AI" (in issue #6): nikoli
// ne predstavi generičnega nadomestka kot originala, nikoli ne
// izmisli SKU-ja, teksture ali fotografije. Zato vsak asset nosi:
//  - origin:      'roksal-original' | 'real-photo' | 'user-upload'
//  - verification: 'verified' | 'unverified' | 'missing'
// Realne fotografije materialov (public/textures, commit e4c679d —
// viri Commons/Unsplash/Pexels) so HONESTNO označene kot
// 'real-photo' + 'unverified': to so prave fotografije, ampak NI
// original ROKSAL posnetki. Originali, ki jih mora prinesi
// ROKSAL knjižnica (#6), so vpisani kot 'missing' (src = null) —
// izvoz z oznako "original" je dokler gradivo manjka blokiran.

export type AssetOrigin = 'roksal-original' | 'real-photo' | 'user-upload';
export type AssetVerification = 'verified' | 'unverified' | 'missing';

export interface RoksalAsset {
  id: string;                 // npr. 'tex-wpc-tikovina'
  kind: 'texture' | 'product-photo';
  label: string;              // slovensko
  src: string | null;         // null = gradivo MANJKA
  realCm: number;             // realna stranica teksturnega tile-a (0 = ni tekstura / manjka)
  origin: AssetOrigin;
  verification: AssetVerification;
  license: string;            // npr. 'Unsplash License', 'Pexels License', 'CC0'
  sourceUrl: string;          // izvor (za real-photo); '' za user-upload/missing
  grain: 'vertical' | 'horizontal' | 'none';
  note?: string;              // npr. 'Generična realna fotografija materiala — NI original ROKSAL posnetek.'
}

// ─── Vgrajeni asseti (determinističen vrstni red) ────────────
// Smer žire je IZMERJENA deterministično (energija gradientov
// |dx| vs |dy| na 128×128 sivinskem prerezu tile-a): wpc-tikovina,
// wpc-siva, hrast in keramika-les imajo izrazito navpično žiro,
// keramika-kamen in fasada-omet pa brez izrazite smeri.
// Točni izvorni URL-i niso zabeleženi v repozitoriju — kjer je ID
// znan (wpc-tikovina = Pexels 326311), je vpisan; sicer velja
// dokumentiran vir "glej commit e4c679d".

const GENERIC_NOTE = 'Generična realna fotografija materiala — NI original ROKSAL posnetek. vir: glej commit e4c679d.';
const CRAFT_NOTE = 'Generična realna fotografija obrti — NI original ROKSAL posnetek. vir: glej commit e4c679d.';
const MISSING_LICENSE = 'ni na voljo (gradivo manjka)';
const COMMONS_LICENSE = 'Wikimedia Commons (točna licenca ni zabeležena)';

export const ROKSAL_ASSETS: RoksalAsset[] = [
  // ── Teksture materialov (public/textures — realne fotografije, commit e4c679d)
  {
    id: 'tex-wpc-tikovina', kind: 'texture', label: 'WPC tikovina (tekstura)',
    src: '/textures/wpc-tikovina.jpg', realCm: 45, origin: 'real-photo', verification: 'unverified',
    license: 'Pexels License', sourceUrl: 'https://www.pexels.com/photo/326311/', grain: 'vertical',
    note: GENERIC_NOTE,
  },
  {
    id: 'tex-wpc-siva', kind: 'texture', label: 'WPC siva (tekstura)',
    src: '/textures/wpc-siva.jpg', realCm: 45, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'vertical',
    note: 'Izrez tal s fotke verande (ročni obrezan). ' + GENERIC_NOTE,
  },
  {
    id: 'tex-hrast', kind: 'texture', label: 'Hrast (les) — tekstura',
    src: '/textures/hrast.jpg', realCm: 45, origin: 'real-photo', verification: 'unverified',
    license: 'Unsplash License', sourceUrl: 'https://unsplash.com', grain: 'vertical',
    note: 'Točen URL ni zabeležen. ' + GENERIC_NOTE,
  },
  {
    id: 'tex-keramika-les', kind: 'texture', label: 'Keramika les-dekor — tekstura',
    src: '/textures/keramika-les.jpg', realCm: 60, origin: 'real-photo', verification: 'unverified',
    license: 'Pexels License', sourceUrl: 'https://pexels.com', grain: 'vertical',
    note: 'Točen URL ni zabeležen. ' + GENERIC_NOTE,
  },
  {
    id: 'tex-keramika-kamen', kind: 'texture', label: 'Keramika kamen — tekstura',
    src: '/textures/keramika-kamen.jpg', realCm: 60, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'none',
    note: 'Sive granitne ploščice (Poly Haven scan prek Commons). ' + GENERIC_NOTE,
  },
  {
    id: 'tex-fasada-omet', kind: 'texture', label: 'Fasada omet — tekstura',
    src: '/textures/fasada-omet.jpg', realCm: 50, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'none',
    note: 'Točen URL ni zabeležen. ' + GENERIC_NOTE,
  },
  // ── Kartice obrti (public/crafts — realne fotografije, commit e4c679d)
  {
    id: 'pho-craft-ograje', kind: 'product-photo', label: 'Ograje — primer realne vgradnje',
    src: '/crafts/ograje.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: 'Unsplash License', sourceUrl: 'https://unsplash.com', grain: 'none',
    note: 'Točen URL ni zabeležen. ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-stopnice', kind: 'product-photo', label: 'Stopnice — primer realne vgradnje',
    src: '/crafts/stopnice.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: 'Unsplash License', sourceUrl: 'https://unsplash.com', grain: 'none',
    note: 'Točen URL ni zabeležen. ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-keramika', kind: 'product-photo', label: 'Keramika — primer realne vgradnje',
    src: '/crafts/keramika.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: 'Unsplash License', sourceUrl: 'https://unsplash.com', grain: 'none',
    note: 'Točen URL ni zabeležen. ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-wpc-terasa', kind: 'product-photo', label: 'WPC terasa — primer realne vgradnje',
    src: '/crafts/wpc-terasa.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'none',
    note: 'Veranda hiše (Commons). ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-okna-vrata', kind: 'product-photo', label: 'Okna in vrata — primer realne vgradnje',
    src: '/crafts/okna-vrata.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: 'Unsplash License', sourceUrl: 'https://unsplash.com', grain: 'none',
    note: 'Točen URL ni zabeležen. ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-nadstreski', kind: 'product-photo', label: 'Nadstreški — primer realne vgradnje',
    src: '/crafts/nadstreski.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'none',
    note: 'Steklen porte-cochère (Category:Verandas). ' + CRAFT_NOTE,
  },
  {
    id: 'pho-craft-fasada', kind: 'product-photo', label: 'Fasada — primer realne vgradnje',
    src: '/crafts/fasada.jpg', realCm: 0, origin: 'real-photo', verification: 'unverified',
    license: COMMONS_LICENSE, sourceUrl: 'https://commons.wikimedia.org', grain: 'none',
    note: 'Lesena latnja obloga (Baumwipfelpfad). ' + CRAFT_NOTE,
  },
  // ── Manjkajoči ORIGINALI ROKSAL (čaka knjižnica iz issue #6) — src = null
  {
    id: 'pho-roksal-wpc-deka-profil', kind: 'product-photo', label: 'WPC deka — original ROKSAL posnetek profila',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'Čaka original ROKSAL knjižnico (#6). Do takrat nadomestna tekstura NI original.',
  },
  {
    id: 'pho-roksal-alu-palica-profil', kind: 'product-photo', label: 'Alu palica — original ROKSAL posnetek profila',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'Čaka original ROKSAL knjižnico (#6). Do takrat nadomestna tekstura NI original.',
  },
  {
    id: 'tex-roksal-ral-7016', kind: 'texture', label: 'RAL 7016 antracit — original ROKSAL vzorec',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'Čaka original ROKSAL vzorec barve (#6). RAL je sicer gladka barvana kovina — upodobitev z flat barvo je realna, brez teksture.',
  },
];

// ─── Uporabniški povzpetiki (original support) ───────────────
// Modulsko stanje: vgrajeni asseti VEDNO prvi, uporabniški ZADNJI
// (determinističen vrstni red). Uporabniški posnetek je po definiciji
// 'unverified' — overitve originala iz brskalnika ni (iskrenost!).
const userAssets: RoksalAsset[] = [];

const GRAINS: RoksalAsset['grain'][] = ['vertical', 'horizontal', 'none'];

/**
 * Registriraj uporabniški povzpetek (npr. prava fotka ROKSAL vgradnje,
 * ki jo je posnal mojster). Varnostna pravila iskrenosti:
 *  - origin MORA biti 'user-upload' (nikoli ne pretvarjaj, da je
 *    uporabniška fotka 'roksal-original'),
 *  - verification MORA biti 'unverified' (sistem ne more overiti originala),
 *  - src mora biti podan (registracija MANJKAJOČEga gradiva nima smisla),
 *  - podvojen id vrže napako.
 */
export function registerUserAsset(a: RoksalAsset): void {
  if (!a || typeof a !== 'object') throw new Error('Asset mora biti objekt.');
  if (typeof a.id !== 'string' || a.id.trim().length === 0) throw new Error('Asset potrebuje neprazen id.');
  if (a.kind !== 'texture' && a.kind !== 'product-photo') throw new Error('Neznana vrsta asseta (kind) — dovoljena sta "texture" in "product-photo".');
  if (typeof a.label !== 'string' || a.label.trim().length === 0) throw new Error('Asset potrebuje neprazno oznako (label).');
  if (a.origin !== 'user-upload') throw new Error('Uporabniški asset mora imeti origin "user-upload" — prirejanje originov je prepovedano (iskrenost registra).');
  if (a.verification !== 'unverified') throw new Error('Uporabniški posnetek je vedno "unverified" — overitev originala ni mogoča v brskalniku.');
  if (typeof a.src !== 'string' || a.src.length === 0) throw new Error('Uporabniški asset potrebuje vir (src) — manjkajoče gradivo se ne registrira.');
  if (!Number.isFinite(a.realCm) || a.realCm < 0 || a.realCm > 10_000) throw new Error('realCm mora biti končno število v [0, 10000].');
  if (!GRAINS.includes(a.grain)) throw new Error('Neznana smer žire (grain).');
  if (ROKSAL_ASSETS.some((x) => x.id === a.id) || userAssets.some((x) => x.id === a.id)) {
    throw new Error(`Asset z id "${a.id}" že obstaja — podvojeni id nista dovoljena.`);
  }
  userAssets.push({ ...a });
}

/** Počisti uporabniške assete (npr. ob zamenjavi projekta). */
export function resetUserAssets(): void {
  userAssets.length = 0;
}

/** Vsi asseti: vgrajeni prvi, uporabniški zadnji (deterministično). */
export function allAssets(): RoksalAsset[] {
  return [...ROKSAL_ASSETS, ...userAssets];
}

/** Poišči asset po id (null, če ne obstaja). Vgrajeni imajo prednost. */
export function assetById(id: string): RoksalAsset | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  return ROKSAL_ASSETS.find((a) => a.id === id) ?? userAssets.find((a) => a.id === id) ?? null;
}

// ─── Profili ograj / oblog (realne mere) ─────────────────────
// Mere elementov so povzete po obstoječih realnih privzetkih
// vizualizerja (viz.ts defaultParamsForPattern, Task 34):
// WPC deka 140 mm + fuga 4 mm, alu palice 18 mm / razmak 11 cm,
// obloga 8 cm / reža 2 cm, mreža 3D žica 5 mm / očesce 12,5 cm.
// catalogSku je NAMERNO null — SKU se NIKOLI ne izmišljuje; čaka
// ROKSAL katalog (#6). postCm je tipen gradbeni privzetek in NI
// katalogni podatek (opozorilo v note).

export interface RoksalProfile {
  id: string;                 // opisni id, NIKOLI izmišljen SKU: npr. 'wpc-deka-140'
  label: string;              // 'WPC deka 140 mm (vodoravno)'
  catalogSku: string | null;  // null = 'SKU ni določen — čaka original ROKSAL katalog (#6)'
  plankCm: number;            // debelina/višina elementa v cm (realni privzetki viz.ts)
  gapCm: number;              // reža v cm
  orientation: 'horizontal' | 'vertical';
  textureId: string;          // id v ROKSAL_ASSETS (obstojec ali missing)
  postCm: number;             // širina stebra v cm (tipen privzetek — glej note)
  pattern: string;            // ustrezni VizPattern id ('terasa', 'vertikalne', …)
  note?: string;
}

export const ROKSAL_PROFILES: RoksalProfile[] = [
  {
    id: 'wpc-deka-140',
    label: 'WPC deka 140 mm (vodoravno)',
    catalogSku: null,
    plankCm: 14, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-wpc-tikovina',
    postCm: 6,
    pattern: 'terasa',
    note: 'Mere iz privzetkov vizualizerja (deka 140 mm + fuga 4 mm). postCm je tipen privzetek — čaka ROKSAL katalog (#6).',
  },
  {
    id: 'wpc-deka-140-antracit',
    label: 'WPC deka 140 mm antracit (vodoravno)',
    catalogSku: null,
    plankCm: 14, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-wpc-siva',
    postCm: 6,
    pattern: 'terasa',
    note: 'Mere iz privzetkov vizualizerja (deka 140 mm + fuga 4 mm). postCm je tipen privzetek — čaka ROKSAL katalog (#6).',
  },
  {
    id: 'alu-palice-18',
    label: 'Vertikalne alu palice 18 mm (razmak 11 cm)',
    catalogSku: null,
    plankCm: 1.8, gapCm: 11,
    orientation: 'vertical',
    textureId: 'tex-roksal-ral-7016',
    postCm: 4,
    pattern: 'vertikalne',
    note: 'RAL je gladka barvana kovina — upodobitev z flat barvo je realna; original ROKSAL vzorec manjka (#6).',
  },
  {
    id: 'fasadna-obloga-8',
    label: 'Horizontalna fasadna obloga 8 cm (reža 2 cm)',
    catalogSku: null,
    plankCm: 8, gapCm: 2,
    orientation: 'horizontal',
    textureId: 'tex-hrast',
    postCm: 6,
    pattern: 'horizontalne',
    note: 'Mere iz privzetkov vizualizerja (obloga: letve 8 cm, reža 2 cm).',
  },
  {
    id: 'piketna-18',
    label: 'Piketna ograja 18 mm (razmak 11 cm)',
    catalogSku: null,
    plankCm: 1.8, gapCm: 11,
    orientation: 'vertical',
    textureId: 'tex-hrast',
    postCm: 4.5,
    pattern: 'piketna',
    note: 'Mere iz privzetkov vizualizerja (alu palice 18 mm / 11 cm).',
  },
  {
    id: 'mreza-3d-125',
    label: 'Varnostna mreža 3D (očesce 12,5 cm)',
    catalogSku: null,
    plankCm: 0.5, gapCm: 12.5,
    orientation: 'vertical',
    textureId: 'tex-roksal-ral-7016',
    postCm: 6,
    pattern: 'mreza',
    note: 'Mere iz privzetkov vizualizerja (žica 5 mm, očesce 125 mm). Original ROKSAL vzorec manjka (#6).',
  },
];

/**
 * Iskrenost profila: ali ga sploh lahko upodobimo (tekstura obstaja
 * z virom), ali je to ORIGINAL ROKSAL gradivo (vsi povezani asseti
 * 'roksal-original' + 'verified') in slovenska oznaka za UI.
 * canRender: teksturni asset obstaja in ima src.
 * isOriginal: vsa povezana sredstva so overjena originalna — dokler
 * ROKSAL knjižnice (#6) ni, je to za vse profile false.
 */
export function profileReadiness(p: RoksalProfile): {
  canRender: boolean;
  isOriginal: boolean;
  missingAssets: RoksalAsset[];
  honestyLabel: string;
} {
  if (!p || typeof p !== 'object' || typeof p.textureId !== 'string') {
    throw new Error('Profil potrebuje textureId.');
  }
  const found = assetById(p.textureId);
  const linked: RoksalAsset[] = found
    ? [found]
    : [{
        id: p.textureId, kind: 'texture', label: p.textureId, src: null, realCm: 0,
        origin: 'roksal-original', verification: 'missing', license: MISSING_LICENSE,
        sourceUrl: '', grain: 'none',
        note: 'Id ne obstaja v registru — obravnavaj kot manjkajoče gradivo.',
      }];
  const missing = linked.filter((a) => a.src === null || a.verification === 'missing');
  const canRender = linked.every((a) => a.src !== null);
  const isOriginal = linked.every((a) => a.origin === 'roksal-original' && a.verification === 'verified');
  const honestyLabel = missing.length > 0
    ? `Gradivo manjka: ${missing.map((a) => a.label).join(', ')}`
    : isOriginal
      ? 'Original ROKSAL gradivo'
      : 'Realna fotografija materiala (ni original ROKSAL posnetek)';
  return { canRender, isOriginal, missingAssets: missing, honestyLabel };
}
