// ─── ROKSAL registry gradiv — ISKREN katalog assetov ─────────
// Pravilo iz zahteve "FOTOZAMENJAVA BREZ AI" (in issue #6): nikoli
// ne predstavi generičnega nadomestka kot originala, nikoli ne
// izmisli SKU-ja, teksture ali fotografije. Zato vsak asset nosi:
//  - origin:      'roksal-original' | 'real-photo' | 'user-upload' | 'standard-reference'
//  - verification: 'verified' | 'unverified' | 'missing'
// Realne fotografije materialov (public/textures, commit e4c679d —
// viri Commons/Unsplash/Pexels) so HONESTNO označene kot
// 'real-photo' + 'unverified': to so prave fotografije, ampak NI
// original ROKSAL posnetki. Originali, ki jih mora prinesi
// ROKSAL knjižnica (#6), so vpisani kot 'missing' (src = null) —
// izvoz z oznako "original" je dokler gradivo manjka blokiran.

// 'standard-reference' = JAVNI standard (npr. barvna vrednost RAL Classic) —
// ni fotografija in ni ROKSAL original; izrecna tretja kategorija, da
// standardne reference ne bi nikoli prirejali 'real-photo' ali 'original'.
export type AssetOrigin = 'roksal-original' | 'real-photo' | 'user-upload' | 'standard-reference';
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
    note: 'Izrez ENE čiste deske iz fotke Pexels 326311 (avtorja originala ni mogoče zanesljivo prebrati s strani — vir je Pexels) + zrcalno tlakovanje 6× (izmenično flop) → tile 512×512 brez SPOJEV med deskami (stebrična svetilnost: 0 temnih kanalov; spoji v izvirniku so pri zasuku 90° postali neresnične vodoravne črte sredi deke — priprava tests/make-tikovina-tile.ts, deterministično). Žira ostaja navpična (energija gradientov |dx|>|dy|). ' + GENERIC_NOTE,
  },
  {
    id: 'tex-wpc-siva', kind: 'texture', label: 'WPC siva (tekstura)',
    src: '/textures/wpc-siva.jpg', realCm: 45, origin: 'real-photo', verification: 'unverified',
    license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Weathered_wood_texture.jpg',
    grain: 'vertical',
    note: 'Vremensko obstal sivi les, čelni posnetek (izrez + zasuk 90° → navpična žira; energija gradientov |dx|>|dy| potrjuje smer). Avtor: Kelsey Todd. ' + GENERIC_NOTE,
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
    id: 'pho-roksal-alu-palica-profil', kind: 'product-photo', label: 'Alu palica — original ROKSAL posnetek profila',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'Čaka original ROKSAL knjižnico (#6). RAZISKAVA 2026 (page_reader, roksal.com): uradni program ROKSAL = WPC deske (TERASNA 150×25, POLNA-57/32, POLNA-100, POLNA-128, ROMB-67, KUBO 80/42) + ročaji + čepi — alu palice 18 mm NI v programu, zato originalnega posnetka NI mogoče pridobiti iz roksal.com; profil alu-palice-18 ostane generičen vizualizer privzetek. Najbližji uradni pokončni profili so zdaj registrirani z originalnimi gradivi (polna-57-32, polna-100, romb-67).',
  },
  {
    id: 'tex-roksal-ral-7016', kind: 'texture', label: 'RAL 7016 antracit — original ROKSAL vzorec',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'Čaka original ROKSAL vzorec barve (#6). RAZISKAVA 2026 (page_reader, roksal.com): vseh 5 uradnih barvnih lestvic so WPC dekorji (terasa4, rombi4, kubo4, 2_polna, 4-polna-128-4) — RAL barv ROKSAL ne objavlja; konstrukcija je opisana le kot "aluminij prašno barvan" brez uradnega RAL koda. Varnostna mreža 3D tudi NI v programu ROKSAL → ta original NI mogoče pridobiti iz roksal.com. RAL je sicer gladka barvana kovina — upodobitev z flat barvo (tex-ral-7016-standard) je realna, brez teksture.',
  },
  // ── Originalni ROKSAL gradivi — TERASNA deka 150 × 25 mm (roksal.com, 2026) ──
  // Preneseno z uradnih strani roksal.com ("Barvni odtenki" — razdelek
  // TERASNI profil + "WPC deske za teraso"). DOBEREDA originalna
  // ROKSAL gradiva — barvna zvestoba zaslonu NI osebno overjena
  // (verification ostaja 'unverified'; izvoz z oznako "original" je
  // dokler traja to blokiran — iskrenost).
  // Uradno (roksal.com): TERASNI profil — "sedmimi barvnimi odtenki in
  // tremi površinami"; KLASIK — "150 x 25 x 4000 ali 2200 mm, v petih
  // barvnih odtenkih"; RUSTIC — "izgled STARAN LES, na eni strani
  // gladka, na drugi rebričena". Lestvica (2560×680) prikazuje 7
  // dekorjev BREZ imen → oznake po POLOŽAJU 1–7; da sta dekorja 6 in 7
  // RUSTIC (finija tekstura brez reber), je SKLEPANJE iz opisa površin,
  // NE uradna trditev. Merilo dekorja na lestvici NI objavljeno →
  // realCm 45 je IZRECNO označen privzetek.
  {
    id: 'tex-roksal-deka-dekor-1', kind: 'texture', label: 'DEKA dekor 1/7 — temno sivi, rebra (uradna lestvica)',
    src: '/roksal/deka/dekor-1.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Izrez VPISANEGA kvadrata kroga dekorja 1 (od 7, z leve) iz URADNE ROKSAL barvne lestvice terasnih desk (BARVNA_LESTVICA_1-terasa4.png, 2560×680) + zasuk 90° (žira/rebra na lestvici vodoravna; konvencija tlakov v viz.ts je NAVPIČNA žira — vodoravne deke renderer zasuka sam) → ENOJNI NEPREKINJEN IZREZ 256×256 (tests/make-deka-tiles.ts, deterministično; 0 skoraj-črnih pikslov; brez notranjega zrcaljenja; rebra preverjena kot periodična — avtentična površina KLASIK deske). Imena dekorjev niso objavljena → oznaka po POLOŽAJU (1/7); "temno sivi, rebra" je opisno, NE trgovsko ime. Povprečje RGB(97,100,104). Merilo NI objavljeno → realCm 45 privzetek.',
  },
  {
    id: 'tex-roksal-deka-dekor-2', kind: 'texture', label: 'DEKA dekor 2/7 — svetlo sivi, rebra (uradna lestvica)',
    src: '/roksal/deka/dekor-2.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (enojni ne-zrcaljen izrez 256×256, zasuk 90°, tests/make-deka-tiles.ts). Povprečje RGB(161,163,163).',
  },
  {
    id: 'tex-roksal-deka-dekor-3', kind: 'texture', label: 'DEKA dekor 3/7 — bakreno-peščeni, rebra (uradna lestvica)',
    src: '/roksal/deka/dekor-3.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1. Povprečje RGB(201,153,128).',
  },
  {
    id: 'tex-roksal-deka-dekor-4', kind: 'texture', label: 'DEKA dekor 4/7 — rožnato-bež, rebra (uradna lestvica)',
    src: '/roksal/deka/dekor-4.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1. Povprečje RGB(177,146,130).',
  },
  {
    id: 'tex-roksal-deka-dekor-5', kind: 'texture', label: 'DEKA dekor 5/7 — svetlo zlati, rebra (uradna lestvica)',
    src: '/roksal/deka/dekor-5.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1. Povprečje RGB(212,172,131).',
  },
  {
    id: 'tex-roksal-deka-dekor-6', kind: 'texture', label: 'DEKA dekor 6/7 — srednje rjavi, fina tekstura (uradna lestvica)',
    src: '/roksal/deka/dekor-6.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1. POVRAŠINA BREZ GROBIH REBER (0 polnih temnih črt) — skladno z uradnim opisom RUSTIC ("izgled STARAN LES, na eni strani gladka"), a povezava dekor 6–7 ↔ RUSTIC je SKLEPANJE iz opisa površin, NE uradna trditev. Povprečje RGB(156,129,98).',
  },
  {
    id: 'tex-roksal-deka-dekor-7', kind: 'texture', label: 'DEKA dekor 7/7 — temno sivo-rjavi, fina tekstura (uradna lestvica)',
    src: '/roksal/deka/dekor-7.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki", TERASNI profil)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1. POVRAŠINA BREZ GROBIH REBER (0 polnih temnih črt) — skladno z opisom RUSTIC (sklepanje, glej dekor 6). Povprečje RGB(110,99,89).',
  },
  {
    id: 'pho-roksal-deka-lestvica', kind: 'product-photo', label: 'TERASNA deka — original ROKSAL barvna lestvica (7 dekorjev)',
    src: '/roksal/deka/barvna-lestvica-deka.png', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'none',
    note: 'Uradna paleta odtenkov terasnih desk (BARVNA_LESTVICA_1-terasa4.png, 2560×680; alt: "Barvna paleta odtenkov WPC desk za desko 150") — TOČNO 7 dekorjev, brez besedilnih oznak. Vir izposojenih dekorjev (tex-roksal-deka-dekor-1…7).',
  },
  {
    id: 'pho-roksal-wpc-deka-profil', kind: 'product-photo', label: 'WPC deka — original ROKSAL posnetek profila (presek)',
    src: '/roksal/deka/profil-deske.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — WPC deske za teraso)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/',
    grain: 'none',
    note: 'Uradni posnetek profila terasne deske (presek: komorne deske, deska-za-terase.jpg). Prej MANJKAJOČE gradivo (#6) je zdaj izpolnjeno ZA DEKO — LOČLJIVOST je majhna (200×139, toliko objavlja stran — ni večje variante). Uradne mere deske: 150 × 25 × 4000/2200 mm.',
  },
  {
    id: 'pho-roksal-deka-vgradnja', kind: 'product-photo', label: 'TERASNA deka — original ROKSAL posnetek vgradnje (strešna terasa)',
    src: '/roksal/deka/vgradnja-strešna-terasa.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — WPC deske za teraso)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/',
    grain: 'none',
    note: 'Uradni posnetek vgradnje: strešna terasa s temno dekorjo (deske-za-terase_215.jpg, 793×529) — najbližji dekor po povprečju je dekor 1 (temno sivi).',
  },
  // ── Originalni ROKSAL gradivi — KUBO profil 80/42 (roksal.com, 2026) ──
  // Preneseno z uradne strani roksal.com (stran "Barvni odtenki" +
  // stran predelnih sten). To so DOBEREDA originalna ROKSAL gradiva —
  // prvič v registru — a barvna zvestoba zaslonu NI osebno overjena
  // (verification ostaja 'unverified'; izvoz z oznako "original" je
  // dokler traja to blokiran — iskrenost!).
  // Merilo dekorja na barvni lestvici NI objavljeno → realCm 45 pri
  // dekorjih je IZRECNO označen privzetek (isti kot ostali WPC tile-i
  // kataloga), samo za približek tlakovanja — NI izmerjeno.
  {
    id: 'tex-roksal-kubo-dekor-1', kind: 'texture', label: 'KUBO dekor 1/4 — temno sivi (uradna lestvica)',
    src: '/roksal/kubo/dekor-1.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Izrez VPISANEGA kvadrata kroga dekorja 1 (od 4, z leve) iz URADNE ROKSAL barvne lestvice profila KUBO (BARVNA_LESTVICA_5-kubo4.png, 2217×675) + zasuk 90° (žira na lestvici vodoravna |dy|>|dx|, KUBO se vgrajuje pokončno) → ENOJNI NEPREKINJEN IZREZ 256×256 (priprava tests/make-kubo-tiles.ts, deterministično; 0 skoraj-črnih pikslov = brez ozadja lestvice; brez notranjega zrcaljenja — zrcalno tlakovanje na nivoju vzorca zagotavlja renderer drawMirroredTexture; prejšnja 2×2 zrcalna različica je metuljasto simetrijo vidno podvajala). Imena dekorjev na lestvici NISO objavljena → dekor je označen po POLOŽAJU (1/4); barvni opis "temno sivi" je opisni, NE trgovsko ime. Povprečje RGB(95,94,97). Merilo dekorja NI objavljeno → realCm 45 je privzetek (glej komentar sekcije).',
  },
  {
    id: 'tex-roksal-kubo-dekor-2', kind: 'texture', label: 'KUBO dekor 2/4 — svetli zlati (uradna lestvica)',
    src: '/roksal/kubo/dekor-2.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (izrez + zasuk 90°, enojni ne-zrcaljen izrez 256×256, tests/make-kubo-tiles.ts). Povprečje RGB(177,148,125) — svetel zlato-rjavi odtenek, najbolj podoben dekorju na uradni fotki profila KUBO (profil-deske.jpg) → PRIVZETI dekor profila kubo-80-42.',
  },
  {
    id: 'tex-roksal-kubo-dekor-3', kind: 'texture', label: 'KUBO dekor 3/4 — zlati teak (uradna lestvica)',
    src: '/roksal/kubo/dekor-3.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (izrez + zasuk 90°, enojni ne-zrcaljen izrez 256×256, tests/make-kubo-tiles.ts). Povprečje RGB(154,127,97).',
  },
  {
    id: 'tex-roksal-kubo-dekor-4', kind: 'texture', label: 'KUBO dekor 4/4 — temno rjavo-sivi (uradna lestvica)',
    src: '/roksal/kubo/dekor-4.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (izrez + zasuk 90°, enojni ne-zrcaljen izrez 256×256, tests/make-kubo-tiles.ts). Povprečje RGB(110,99,89).',
  },
  {
    id: 'pho-roksal-kubo-lestvica', kind: 'product-photo', label: 'KUBO — original ROKSAL barvna lestvica (4 dekorja)',
    src: '/roksal/kubo/barvna-lestvica-kubo.png', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "Barvni odtenki")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/',
    grain: 'none',
    note: 'Uradna paleta dekorjev profila KUBO (BARVNA_LESTVICA_5-kubo4.png, 2217×675) — TOČNO 4 dekorji, brez besedilnih oznak. Vir izposojenih dekorjev (tex-roksal-kubo-dekor-1…4).',
  },
  {
    id: 'pho-roksal-kubo-profil', kind: 'product-photo', label: 'KUBO — original ROKSAL posnetek profila (aluminijasta cev)',
    src: '/roksal/kubo/profil-deske.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — predelne stene, pokončne deske)',
    sourceUrl: 'https://roksal.com/en/woodcore-wpc-boards/partition-walls/vertical-boards',
    grain: 'none',
    note: 'Uradni posnetek profila KUBO 80/42: WPC ovoj z VSTAVLJENO aluminijasto cevjo (deske-kubo-razlicne-cevi.jpg, 2307×1668). To izpolnjuje prej MANJKAJOČE originalno gradivo vrste "posnetek profila" — ampak ZA KUBO (wpc-deka in alu palica ostajata brez originalov, #6).',
  },
  {
    id: 'pho-roksal-kubo-vgradnja', kind: 'product-photo', label: 'KUBO — original ROKSAL posnetek vgradnje (pregradna stena)',
    src: '/roksal/kubo/vgradnja-pregradna-stena.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — predelne stene, pokončne deske)',
    sourceUrl: 'https://roksal.com/en/woodcore-wpc-boards/partition-walls/vertical-boards',
    grain: 'none',
    note: 'Uradni posnetek vgradnje: pokončna pregradna stena iz KUBO desk, temno sivi dekor (pregradna-stena-k_h.jpg, 736×552).',
  },
  // ── Originalni ROKSAL gradivi — OGRAJE: POLNA DESKA + ROMB (roksal.com, 2026) ──
  // Preneseno z uradnih strani roksal.com ("WPC deske za pokončno
  // ograjo – 8 barv", "WPC prečna ograja", "Barvni odtenki") prek CDP
  // (tests/make-ograje-fetch.ts). Uradni podatki:
  //  - POLNA DESKA-57/32: 57 × 32 × 5800 mm ("naleganje je lahko na 57
  //    ali 32"), "štiri barve" — uradna stran ZA TA PROFIL uporablja
  //    KUBO lestvico (BARVNA_LESTVICA_5-kubo4) → barvne različice
  //    naslavljajo obstoječe tex-roksal-kubo-dekor-1…4 (ločena
  //    tlakovanja niso potrebna — parjenje je uradno, na strani).
  //  - POLNA DESKA-100: 100 × 12 × 5800 mm, "samo za POKONČNO ograjo",
  //    "osmimi barvami" → BARVNA_LESTVICA_2_polna (TOČNO 8 krogov).
  //  - POLNA DESKA-128: 128 × 16 × 2200 mm (pokončno) oziroma
  //    128 × 16,5 × 2200 mm (prečno), "šestimi barvami" →
  //    BARVNA_LESTVICA_4-polna-128-4 (TOČNO 6 krogov).
  //  - ROMB DESKA-67: 67 × 26 × 5800 mm Z ALU CEVJO v sredini (obvezna,
  //    vključena v ceno), "sedmimi barvami" → BARVNA_LESTVICA_3-rombi4
  //    (TOČNO 7 krogov).
  //  - REŽA med deskami je objavljena SAMO za profila 100 in 128 in samo kot
  //    priporočen pas 0,5–3 cm ("Priporočen razmak med deskami je od 0,5cm do
  //    3cm.", naslov "Montaža pokončne ograje - profil POLNA DESKA-100 in
  //    POLNA DESKA-128"). ZA 57/32 IN ROMB-67 stran reže NE objavlja — prejšnja
  //    različica tega komentarja je zato trdila napačen „uradni obseg 0,2–3 cm“,
  //    seštete iz dveh LOČENIH objav: pasu 0,5–3 cm (ograja) in odgovora „2mm“
  //    (FAQ, vprašanje o FASADI). `boardGap()` v roksal-span-rules.ts je edini
  //    kraj, kjer je ta razlika zapisana enkrat.
  //  - NOSILCI: 100 cm je objavljeno SAMO za profil 57/32. Za 100/128 stran
  //    številke NE objavi („Pri izdelavi konstrukcije upoštevajte navodila
  //    stroke za nosilnost konstrukcije.“). Prejšnja različica je zapisala
  //    „POLNA-100 80 cm“ — te meje ni v nobeni objavi.
  //  - STEBRIČKI (pokončno): 150 cm (57/32); 180 cm do 150 cm višine oziroma
  //    150 cm nad njo (100/128); ROMB-67 145 cm samo z L-kotnikoma na obeh
  //    straneh stebra, 180 cm ali več pa zahteva dodaten stebriček. Pri 128
  //    PREČNO (DESKA-128) je meja 110 cm — številka torej ni ROMBOVA.
  //  - Uradni preseki: POLNA-57/32 ✓, POLNA-128 ✓ (polna-deska-nova2021
  //    — po vrstnem redu slike na strani 'Elementi'), ROMB-67 ✓;
  //    POLNA-100 preseka stran NE objavlja (razdelek 'Elementi' brez
  //    slike) → vpisan kot manjkajoče gradivo (#6).
  // Lestvice prikazujejo dekorje (krogi na črnem ozadju) BREZ imen →
  // oznake po POLOŽAJU (z leve); barvni opisi so OPISNI, ne trgovska
  // imena. Merilo dekorja na lestvicah NI objavljeno → realCm 45 je
  // IZRECNO privzetek. Tlakovanja: tests/make-ograje-tiles.ts
  // (deterministično — enojni neprekinjen izrez 256×256, zasuk 90°,
  // brez notranjega zrcaljenja; 0 skoraj-črnih pikslov).
  {
    id: 'tex-roksal-romb67-dekor-1', kind: 'texture', label: 'ROMB-67 dekor 1/7 — temno sivi (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-1.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Izrez VPISANEGA kvadrata kroga dekorja 1 (od 7, z leve) iz URADNE ROKSAL barvne lestvice romb deske (BARVNA_LESTVICA_3-rombi4.png, 2560×669) + zasuk 90° (žira na lestvici vodoravna; konvencija tlakov v viz.ts je NAVPIČNA) → ENOJNI NEPREKINJEN IZREZ 256×256 (tests/make-ograje-tiles.ts, deterministično; 0 skoraj-črnih pikslov; brez notranjega zrcaljenja). Imena dekorjev niso objavljena → oznaka po POLOŽAJU (1/7); "temno sivi" je opisno, NE trgovsko ime. Povprečje RGB(95,94,97). Merilo NI objavljeno → realCm 45 privzetek. ROMB DESKA-67 je uradno 67 × 26 mm Z ALU CEVJO (obvezna, vključena v ceno) — renderer riše pravokotne deske, kosooglatega preseka in alu cevi med deskami NE riše (reže iskreno kažejo ozadje).',
  },
  {
    id: 'tex-roksal-romb67-dekor-2', kind: 'texture', label: 'ROMB-67 dekor 2/7 — svetlo sivi (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-2.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(147,145,146).',
  },
  {
    id: 'tex-roksal-romb67-dekor-3', kind: 'texture', label: 'ROMB-67 dekor 3/7 — rožnato-rjavi (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-3.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(162,125,116).',
  },
  {
    id: 'tex-roksal-romb67-dekor-4', kind: 'texture', label: 'ROMB-67 dekor 4/7 — rjavo-bež (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-4.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(143,119,110).',
  },
  {
    id: 'tex-roksal-romb67-dekor-5', kind: 'texture', label: 'ROMB-67 dekor 5/7 — svetli zlati (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-5.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(177,147,125).',
  },
  {
    id: 'tex-roksal-romb67-dekor-6', kind: 'texture', label: 'ROMB-67 dekor 6/7 — zlati teak (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-6.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(156,128,98).',
  },
  {
    id: 'tex-roksal-romb67-dekor-7', kind: 'texture', label: 'ROMB-67 dekor 7/7 — temno rjavo-sivi (uradna lestvica)',
    src: '/roksal/ograje/romb-67/dekor-7.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", ROMB DESKA-67)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(110,99,89).',
  },
  {
    id: 'tex-roksal-polna100-dekor-1', kind: 'texture', label: 'POLNA-100 dekor 1/8 — temno sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-1.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Izrez VPISANEGA kvadrata kroga dekorja 1 (od 8, z leve) iz URADNE ROKSAL barvne lestvice polne deske 100 (BARVNA_LESTVICA_2_polna.png, 2560×600; uradni opis: "osmimi barvami") + zasuk 90° → ENOJNI NEPREKINJEN IZREZ 256×256 (tests/make-ograje-tiles.ts, deterministično; 0 skoraj-črnih pikslov; brez notranjega zrcaljenja). Oznaka po POLOŽAJU (1/8); "temno sivi" je opisno. Povprečje RGB(95,94,97). Merilo NI objavljeno → realCm 45 privzetek.',
  },
  {
    id: 'tex-roksal-polna100-dekor-2', kind: 'texture', label: 'POLNA-100 dekor 2/8 — svetlo sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-2.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(147,146,146).',
  },
  {
    id: 'tex-roksal-polna100-dekor-3', kind: 'texture', label: 'POLNA-100 dekor 3/8 — rožnato-rjavi (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-3.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(162,125,116).',
  },
  {
    id: 'tex-roksal-polna100-dekor-4', kind: 'texture', label: 'POLNA-100 dekor 4/8 — rjavo-bež (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-4.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(143,119,110).',
  },
  {
    id: 'tex-roksal-polna100-dekor-5', kind: 'texture', label: 'POLNA-100 dekor 5/8 — svetli zlati (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-5.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(177,148,125).',
  },
  {
    id: 'tex-roksal-polna100-dekor-6', kind: 'texture', label: 'POLNA-100 dekor 6/8 — beli (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-6.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(199,198,197) — najsvetlejši dekor vseh lestvic; "beli" je opisno, NE uradno ime (uradna stran ročaja omenja WHITE odtenek, povezava z dekorjem 6 je SKLEPANJE).',
  },
  {
    id: 'tex-roksal-polna100-dekor-7', kind: 'texture', label: 'POLNA-100 dekor 7/8 — zlati teak (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-7.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(154,127,98).',
  },
  {
    id: 'tex-roksal-polna100-dekor-8', kind: 'texture', label: 'POLNA-100 dekor 8/8 — temno rjavo-sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-100/dekor-8.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-100)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(110,99,89).',
  },
  {
    id: 'tex-roksal-polna128-dekor-1', kind: 'texture', label: 'POLNA-128 dekor 1/6 — temno sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-1.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Izrez VPISANEGA kvadrata kroga dekorja 1 (od 6, z leve) iz URADNE ROKSAL barvne lestvice polne deske 128 (BARVNA_LESTVICA_4-polna-128-4.png, 2560×683; uradni opis: "šestimi barvami") + zasuk 90° → ENOJNI NEPREKINJEN IZREZ 256×256 (tests/make-ograje-tiles.ts, deterministično; 0 skoraj-črnih pikslov; brez notranjega zrcaljenja). Oznaka po POLOŽAJU (1/6); "temno sivi" je opisno. Povprečje RGB(95,94,97). Merilo NI objavljeno → realCm 45 privzetek.',
  },
  {
    id: 'tex-roksal-polna128-dekor-2', kind: 'texture', label: 'POLNA-128 dekor 2/6 — svetlo sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-2.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(147,145,146).',
  },
  {
    id: 'tex-roksal-polna128-dekor-3', kind: 'texture', label: 'POLNA-128 dekor 3/6 — rjavo-bež (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-3.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(143,119,110).',
  },
  {
    id: 'tex-roksal-polna128-dekor-4', kind: 'texture', label: 'POLNA-128 dekor 4/6 — svetli zlati (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-4.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(177,148,125).',
  },
  {
    id: 'tex-roksal-polna128-dekor-5', kind: 'texture', label: 'POLNA-128 dekor 5/6 — zlati teak (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-5.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(156,129,98).',
  },
  {
    id: 'tex-roksal-polna128-dekor-6', kind: 'texture', label: 'POLNA-128 dekor 6/6 — temno rjavo-sivi (uradna lestvica)',
    src: '/roksal/ograje/polna-128/dekor-6.png', realCm: 45, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", POLNA DESKA-128)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'vertical',
    note: 'Enak postopek kot dekor 1 (tests/make-ograje-tiles.ts). Povprečje RGB(110,99,89).',
  },
  {
    id: 'pho-roksal-romb67-lestvica', kind: 'product-photo', label: 'ROMB-67 — original ROKSAL barvna lestvica (7 dekorjev)',
    src: '/roksal/ograje/romb-67/barvna-lestvica-romb.png', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradna paleta odtenkov romb deske (BARVNA_LESTVICA_3-rombi4.png, 2560×669) — TOČNO 7 dekorjev (uradni opis: "sedmimi barvami"), brez besedilnih oznak. Vir izposojenih dekorjev (tex-roksal-romb67-dekor-1…7).',
  },
  {
    id: 'pho-roksal-polna100-lestvica', kind: 'product-photo', label: 'POLNA-100 — original ROKSAL barvna lestvica (8 dekorjev)',
    src: '/roksal/ograje/polna-100/barvna-lestvica-polna.png', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradna paleta odtenkov polne deske 100 (BARVNA_LESTVICA_2_polna.png, 2560×600) — TOČNO 8 dekorjev (uradni opis: "osmimi barvami"), brez besedilnih oznak. Vir izposojenih dekorjev (tex-roksal-polna100-dekor-1…8).',
  },
  {
    id: 'pho-roksal-polna128-lestvica', kind: 'product-photo', label: 'POLNA-128 — original ROKSAL barvna lestvica (6 dekorjev)',
    src: '/roksal/ograje/polna-128/barvna-lestvica-polna-128.png', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradna paleta odtenkov polne deske 128 (BARVNA_LESTVICA_4-polna-128-4.png, 2560×683) — TOČNO 6 dekorjev (uradni opis: "šestimi barvami"), brez besedilnih oznak. Vir izposojenih dekorjev (tex-roksal-polna128-dekor-1…6).',
  },
  {
    id: 'pho-roksal-romb67-profil', kind: 'product-photo', label: 'ROMB-67 — original ROKSAL posnetek profila (presek z alu cevjo)',
    src: '/roksal/ograje/romb-67/profil-romb-deska-67.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", Elementi)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek profila ROMB DESKA-67 (romb-woodcore-wpc.jpg, 488×372): kosooglati presek Z VIDNO ALUMINIJASTO CEVJO v sredini + dve komori — potrjuje uradni opis "Z ALU CEVJO v sredini romba" (obvezna, vključena v ceno).',
  },
  {
    id: 'pho-roksal-polna57-32-profil', kind: 'product-photo', label: 'POLNA-57/32 — original ROKSAL posnetek profila (presek)',
    src: '/roksal/ograje/polna-57-32/profil-polna-deska-57-32.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", Elementi)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek profila POLNA DESKA-57/32 (polna-deska-57-32.jpg, 502×423): polna pravokotna deska; uradno "naleganje je lahko na 57 ali 32" (57 × 32 × 5800 mm).',
  },
  {
    id: 'pho-roksal-polna128-profil', kind: 'product-photo', label: 'POLNA-128 — original ROKSAL posnetek profila (presek)',
    src: '/roksal/ograje/polna-128/profil-polna-deska-128.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo", Elementi)',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek profila POLNA DESKA-128 (polna-deska-nova2021.jpg, 490×537): ploska deska z fino žiro. PARJENJE s profilom 128 po VRSTNEM REDU slike na uradni strani (slika sledi naslovu "profil POLNA DESKA-128" v razdelku Elementi) — besedilno povezava ni izrecna, ampak postavitev na strani je enoumna.',
  },
  {
    id: 'pho-roksal-polna100-profil', kind: 'product-photo', label: 'POLNA-100 — original ROKSAL posnetek profila (presek)',
    src: null, realCm: 0, origin: 'roksal-original', verification: 'missing',
    license: MISSING_LICENSE, sourceUrl: '', grain: 'none',
    note: 'RAZISKAVA 2026 (poglobljena, 2026-10-15): uradna stran roksal.com v razdelku "Elementi" za POLNA DESKA-100 NE objavlja posnetka profila (naslov brez slike — za ostale profile so slike). Poglobljeno iskanje: roksal.com NIMA razdelka za prenose katalogov ("Več informacij" vsebuje le piškotke/kontakt, nič PDF); spletni trgovci objavljajo ali katalog DRUGE blagovne znamke (KAVA Co-ex, wpc-talne-obloge.si) ali neuradni trgovski katalog (WPS, montaze-mlakar.si, 2020 — imagescan, ne ROKSAL WoodCore) → po iskrenem standardu NIČ od tega ni original ROKSAL gradivo in se NE registrira. Čaka ROKSAL katalog (#6) ali objavo na strani; ne vpliva na upodabljanje (readiness veže samo textureId).',
  },
  {
    id: 'pho-roksal-polna100-vgradnja-amazon', kind: 'product-photo', label: 'POLNA-100 — original ROKSAL posnetek vgradnje (pokončna ograja)',
    src: '/roksal/ograje/polna-100/vgradnja-polna-amazon.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek vgradnje pokončne ograje iz polne deske (wpc-woodcore-pokoncna-ograja-amazon-polna-deska-loz1.jpg, 1440×1080). Povezava z dekorjem po imenu "amazon" NI uradno potrjena (imena dekorjev niso objavljena) → ne trdimo, kateri dekor je na fotki.',
  },
  {
    id: 'pho-roksal-polna100-vgradnja-burma', kind: 'product-photo', label: 'POLNA-100 — original ROKSAL posnetek vgradnje (pokončna ograja, temni dekor)',
    src: '/roksal/ograje/polna-100/vgradnja-polna-burma.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek vgradnje pokončne ograje iz polne deske (wpc-woodcore-pokoncna-ograja-burma-polna-deska-1.jpg, 1440×1080) — temni dekor, najbolj podoben dekorju 1 (povprečje RGB(95,94,97)); povezava je SKLEPANJE iz podobnosti, NE uradna trditev.',
  },
  {
    id: 'pho-roksal-romb67-vgradnja', kind: 'product-photo', label: 'ROMB-67 — original ROKSAL posnetek vgradnje (pokončna ograja)',
    src: '/roksal/ograje/romb-67/vgradnja-romb-pokoncna.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni posnetek vgradnje POKONČNE ograje iz romb desk (Romb-pokoncna-m.jpg) — vidni razmaki med deskami, kjer je pri pokončni postavitvi uradno viden aluminijasta cev v sredini profila (FAQ roksal.com).',
  },
  {
    id: 'pho-roksal-pokoncna-ograja-vgradnja', kind: 'product-photo', label: 'Pokončna ograja — original ROKSAL posnetek vgradnje (kategorijska fotka)',
    src: '/roksal/ograje/vgradnja-pokoncna-ograja.jpg', realCm: 0, origin: 'roksal-original', verification: 'unverified',
    license: 'Gradivo ROKSAL (roksal.com — stran "WPC deske za pokončno ograjo")',
    sourceUrl: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/',
    grain: 'none',
    note: 'Uradni kategorijski posnetek pokončne ograje (ograja-pokoncna.jpg, 200×143 — NIZKA LOČLJIVOST, toliko objavlja stran; ni večje variante). Splošni pokazatelj vgradnje — ni povezan z določenim dekorjem.',
  },
  // ── Standardne reference (javni standardi, NE ROKSAL originali) ─
  {
    id: 'tex-ral-7016-standard', kind: 'texture', label: 'RAL 7016 antracit — standardni barvni vzorec (flat)',
    src: '/textures/ral-7016.png', realCm: 0, origin: 'standard-reference', verification: 'unverified',
    license: 'Lastna generacija (tests/make-ral-swatch.ts) po javnem standardu RAL Classic',
    sourceUrl: 'https://en.wikipedia.org/wiki/List_of_RAL_colours',
    grain: 'none',
    note: 'Raven barvni vzorec RGB(56,62,66) = #383E42 — vrednost, ki jo DEJANSKO riše vizualizator (viz.ts ral-7016) in Wikipedijina pretvorba (RAL 7016 Anthracite grey). RAL NE objavlja uradne sRGB pretvorbe — objavljene vrednosti variirajo (ralcolorchart.com #3B4044, Wikipedijin stolpec hex #373F43); zaton barve na zaslonu NI dokaz identičnosti. Upodobitev gladke barvane kovine z RAVNO barvo je realna (brez teksture) — profil alu-palice-18. NI original ROKSAL vzorec površine (tex-roksal-ral-7016 še vedno manjka, #6).',
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
    note: 'Mere iz privzetkov vizualizerja (deka 140 mm + fuga 4 mm). postCm je tipen privzetek — čaka ROKSAL katalog (#6). Uradna ROKSAL terasna deska je 150 × 25 mm — glej profil roksal-deka-150 (uradni gradivi).',
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
    textureId: 'tex-ral-7016-standard',
    postCm: 4,
    pattern: 'vertikalne',
    note: 'RAL je gladka barvana kovina — upodobitev z RAVNO standardno barvo je realna (tex-ral-7016-standard); original ROKSAL vzorec površine še vedno manjka (#6).',
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
    textureId: 'tex-ral-7016-standard',
    postCm: 6,
    pattern: 'mreza',
    note: 'Mere iz privzetkov vizualizerja (žica 5 mm, očesce 125 mm). RAZISKAVA 2026 (roksal.com): varnostna mreža 3D NI v programu ROKSAL (program = WPC deske POLNA/ROMB/TERASNA/KUBO + ročaji/čepi) → original ROKSAL vzorec (tex-roksal-ral-7016) NI mogoče pridobiti. Upodablja se z RAVNO standardno RAL 7016 barvo (tex-ral-7016-standard — gladka barvana kovina, realno) z ISKRENO oznako "Standardna barvna referenca (RAL) — ni original ROKSAL vzorec površine". Generičen vizualizer privzetek.',
  },
  // ── KUBO profil 80/42 (WPC deska z alu cevjo, pokončna vgradnja) ──
  // Urani vir: roksal.com (predelne stene — pokončne deske + barvni
  // odtenki). Uradno: "KUBO profil — 80/42. Namestitev je možna pri
  // širini 80 mm ali 42 mm. Deska ima skrito vijačenje." Barvne
  // različice = TOČNO 4 dekorji uradne barvne lestvice (brez imen —
  // označeni po položaju 1–4). gapCm/postCm sta TIPENA gradbena
  // privzetka (ocenjena z uradne fotke vgradnje) — čakata ROKSAL
  // katalog (#6); catalogSku je null (SKU se ne izmišljuje).
  {
    id: 'kubo-80-42',
    label: 'KUBO profil 80/42 (pokončno) — dekor 2/4 uradne lestvice',
    catalogSku: null,
    plankCm: 8, gapCm: 0.5,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-2',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Uradne mere profila: vidna širina 80 mm (ali 42 mm — druga vgradnja), WPC z alu cevjo, skrito vijačenje (roksal.com). PRIVZETI dekor = 2/4 (svetli zlati — najbolj podoben dekorju na uradni fotki profila). gapCm 0,5 je privzetek izračuna: ROKSAL za KUBO izrecno objavi, da je „razmak med deskami poljuben“ (pogosta vprašanja, FASADE) — številke torej ni treba iskati, aplikacija pa je ne more prikazati kot ROKSALov predpis. postCm 6 je privzetek izračuna, ocenjen z uradne fotke vgradnje — čaka ROKSAL katalog (#6).',
  },
  {
    id: 'kubo-80-42-dekor-1',
    label: 'KUBO profil 80/42 (pokončno) — dekor 1/4 uradne lestvice (temno sivi)',
    catalogSku: null,
    plankCm: 8, gapCm: 0.5,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-1',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila kubo-80-42: dekor 1/4 uradne lestvice (temno sivi — kot na uradni fotki vgradnje pregradne stene).',
  },
  {
    id: 'kubo-80-42-dekor-3',
    label: 'KUBO profil 80/42 (pokončno) — dekor 3/4 uradne lestvice (zlati teak)',
    catalogSku: null,
    plankCm: 8, gapCm: 0.5,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-3',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila kubo-80-42: dekor 3/4 uradne lestvice.',
  },
  {
    id: 'kubo-80-42-dekor-4',
    label: 'KUBO profil 80/42 (pokončno) — dekor 4/4 uradne lestvice (temno rjavo-sivi)',
    catalogSku: null,
    plankCm: 8, gapCm: 0.5,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-4',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila kubo-80-42: dekor 4/4 uradne lestvice.',
  },
  // ── ROKSAL TERASNA deka 150 × 25 (uradni gradivi, roksal.com) ──
  // Uradne mere: 150 × 25 × 4000 ali 2200 mm (roksal.com — WPC deske
  // za teraso). TERASNI profil ima uradno "sedem barvnih odtenkov in
  // tri površine" — barvne različice = TOČNO 7 dekorjev uradne
  // barvne lestvice (oznake po POLOŽAJU 1–7, imena niso objavljena).
  // PRIVZETI dekor = 1/7 (temno sivi — najbolj podoben dekorju na
  // uradni fotki profila/preseka in uradni fotki vgradnje, obe temno
  // sivi). Fuga NI objavljena v ODGOVORU: v FAQ se 5-6 mm pojavi samo v
  // BESEDU VPRAŠANJA („Med deskami je razmak 5-6mm kako potem čistite…“) —
  // to ni predpis, zato je ADJACENT in ne more postati privzeta mera.
  // gapCm 0,4 je PRIVZETEK IZRAČUNA (isti kot obstoječi wpc-deka-140),
  // pod omenjenimi 5–6 mm; postCm 6 tipen; catalogSku
  // null (SKU se ne izmišljuje).
  {
    id: 'roksal-deka-150',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 1/7 uradne lestvice',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-1',
    postCm: 6,
    pattern: 'terasa',
    note: 'Uradne mere: 150 × 25 × 4000/2200 mm (roksal.com). PRIVZETI dekor = 1/7 (temno sivi — kot na uradni fotki profila in vgradnje). gapCm 0,4 in postCm 6 sta privzetka izračuna — reže ROKSAL v ODGOVORU ne objavi (v FAQ se 5-6 mm pojavi samo v besedilu vprašanja in zato ne more biti predpis); čakata ROKSAL katalog (#6).',
  },
  {
    id: 'roksal-deka-150-dekor-2',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 2/7 (svetlo sivi)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-2',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 2/7 uradne lestvice.',
  },
  {
    id: 'roksal-deka-150-dekor-3',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 3/7 (bakreno-peščeni)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-3',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 3/7 uradne lestvice.',
  },
  {
    id: 'roksal-deka-150-dekor-4',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 4/7 (rožnato-bež)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-4',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 4/7 uradne lestvice.',
  },
  {
    id: 'roksal-deka-150-dekor-5',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 5/7 (svetlo zlati)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-5',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 5/7 uradne lestvice.',
  },
  {
    id: 'roksal-deka-150-dekor-6',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 6/7 (fina tekstura, brez reber)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-6',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 6/7 uradne lestvice (površina brez grobih reber — skladno z opisom RUSTIC; povezava je sklepanje).',
  },
  {
    id: 'roksal-deka-150-dekor-7',
    label: 'ROKSAL terasna deka 150×25 (vodoravno) — dekor 7/7 (fina tekstura, brez reber)',
    catalogSku: null,
    plankCm: 15, gapCm: 0.4,
    orientation: 'horizontal',
    textureId: 'tex-roksal-deka-dekor-7',
    postCm: 6,
    pattern: 'terasa',
    note: 'Barvna različica profila roksal-deka-150: dekor 7/7 uradne lestvice (površina brez grobih reber — skladno z opisom RUSTIC; povezava je sklepanje).',
  },
  // ── ROKSAL OGRAJE — POLNA DESKA + ROMB (uradni gradivi, roksal.com) ──
  // Uradni viri: stran "WPC deske za pokončno ograjo" + "Barvni
  // odtenki". Uradne mere + barvne lestvice (glej komentar sekcije
  // assetov zgoraj). gapCm 2 je PRIVZETEK IZRAČUNA: ROKSAL reže objavi samo za
  // profila 100 in 128 (pas 0,5–3 cm), za 57/32 in ROMB-67 je NE objavi —
  // vrednosti zato ne smejo biti predstavljeni kot objavljeni (boardGap()).
  // postCm 6 tipen (ROKSAL širine stebričkov ne objavlja); catalogSku null.
  // PRIVZETI dekor = 1 (temno sivi — prvi na vseh uradnih lestvicah,
  // kot pri KUBO/deka; parjenje z vgradnjo bi bilo sklepanje).
  {
    id: 'polna-57-32',
    label: 'ROKSAL polna deska 57/32 (pokončno) — dekor 1/4 uradne lestvice (kot KUBO)',
    catalogSku: null,
    plankCm: 5.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-1',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Uradne mere: 57 × 32 × 5800 mm, "naleganje je lahko na 57 ali 32" (tu na širini 57 mm = plankCm 5,7); max razmak nosilcev 100 cm (edini objavljen razmak nosilcev vseh profilov). Barvne različice = "štiri barve" — uradna stran ZA TA PROFIL uporablja KUBO lestvico (BARVNA_LESTVICA_5-kubo4) → teksture = obstoječi KUBO dekorji 1–4 (parjenje uradno, na strani). gapCm 2 je PRIVZETEK IZRAČUNA — ROKSAL reže za 57/32 NE objavlja (pas 0,5–3 cm velja samo profiloma 100 in 128); postCm 6 tipen.',
  },
  {
    id: 'polna-57-32-dekor-2',
    label: 'ROKSAL polna deska 57/32 (pokončno) — dekor 2/4 uradne lestvice (kot KUBO)',
    catalogSku: null,
    plankCm: 5.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-2',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-57-32: dekor 2/4 (isti dekor kot KUBO dekor 2 — uradno parjenje lestvice).',
  },
  {
    id: 'polna-57-32-dekor-3',
    label: 'ROKSAL polna deska 57/32 (pokončno) — dekor 3/4 uradne lestvice (kot KUBO)',
    catalogSku: null,
    plankCm: 5.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-3',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-57-32: dekor 3/4 (isti dekor kot KUBO dekor 3 — uradno parjenje lestvice).',
  },
  {
    id: 'polna-57-32-dekor-4',
    label: 'ROKSAL polna deska 57/32 (pokončno) — dekor 4/4 uradne lestvice (kot KUBO)',
    catalogSku: null,
    plankCm: 5.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-kubo-dekor-4',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-57-32: dekor 4/4 (isti dekor kot KUBO dekor 4 — uradno parjenje lestvice).',
  },
  {
    id: 'polna-100',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 1/8 uradne lestvice',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-1',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Uradne mere: 100 × 12 × 5800 mm, "samo za POKONČNO ograjo" (roksal.com); razmika nosilcev ROKSAL za ta profil NE objavi (stran napoti na navodila stroke — prej je ta note trdil „80 cm“, kar ni v nobeni objavi); barvne različice = "osmimi barvami" (uradna lestvica TOČNO 8 krogov). gapCm 2 znotraj OBJAVLJENEGA pasu 0,5–3 cm; postCm 6 tipen. Uradni presek profila roksal.com NE objavlja (#6, vpisano kot manjkajoče gradivo).',
  },
  {
    id: 'polna-100-dekor-2',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 2/8 uradne lestvice (svetlo sivi)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-2',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 2/8 uradne lestvice.',
  },
  {
    id: 'polna-100-dekor-3',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 3/8 uradne lestvice (rožnato-rjavi)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-3',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 3/8 uradne lestvice.',
  },
  {
    id: 'polna-100-dekor-4',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 4/8 uradne lestvice (rjavo-bež)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-4',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 4/8 uradne lestvice.',
  },
  {
    id: 'polna-100-dekor-5',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 5/8 uradne lestvice (svetli zlati)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-5',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 5/8 uradne lestvice.',
  },
  {
    id: 'polna-100-dekor-6',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 6/8 uradne lestvice (beli)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-6',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 6/8 uradne lestvice (RGB(199,198,197) — najsvetlejši dekor vseh lestvic).',
  },
  {
    id: 'polna-100-dekor-7',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 7/8 uradne lestvice (zlati teak)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-7',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 7/8 uradne lestvice.',
  },
  {
    id: 'polna-100-dekor-8',
    label: 'ROKSAL polna deska 100 (pokončno) — dekor 8/8 uradne lestvice (temno rjavo-sivi)',
    catalogSku: null,
    plankCm: 10, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna100-dekor-8',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-100: dekor 8/8 uradne lestvice.',
  },
  {
    id: 'polna-128',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 1/6 uradne lestvice',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-1',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Uradne mere: 128 × 16 × 2200 mm (pokončno); roksal.com uradno omogoča TUDI prečno vgradnjo (128 × 16,5 × 2200) — prečna različica NI registrirana kot ločen profil (obstoječi vodoravni vzorci: roksal-deka-150, fasadna-obloga-8); objavljeni meji STEBRIČKOV: 180 cm do 150 cm višine / 150 cm nad njo (pokončno) in 110 cm za vodoravno postavitev (prečno); razmika nosilcev stran ne objavi; barvne različice = "šestimi barvami" (uradna lestvica TOČNO 6 krogov). gapCm 2 znotraj OBJAVLJENEGA pasu 0,5–3 cm; postCm 6 tipen.',
  },
  {
    id: 'polna-128-dekor-2',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 2/6 uradne lestvice (svetlo sivi)',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-2',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-128: dekor 2/6 uradne lestvice.',
  },
  {
    id: 'polna-128-dekor-3',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 3/6 uradne lestvice (rjavo-bež)',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-3',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-128: dekor 3/6 uradne lestvice.',
  },
  {
    id: 'polna-128-dekor-4',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 4/6 uradne lestvice (svetli zlati)',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-4',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-128: dekor 4/6 uradne lestvice.',
  },
  {
    id: 'polna-128-dekor-5',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 5/6 uradne lestvice (zlati teak)',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-5',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-128: dekor 5/6 uradne lestvice.',
  },
  {
    id: 'polna-128-dekor-6',
    label: 'ROKSAL polna deska 128 (pokončno) — dekor 6/6 uradne lestvice (temno rjavo-sivi)',
    catalogSku: null,
    plankCm: 12.8, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-polna128-dekor-6',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila polna-128: dekor 6/6 uradne lestvice.',
  },
  {
    id: 'romb-67',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 1/7 uradne lestvice',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-1',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Uradne mere: 67 × 26 × 5800 mm Z ALU CEVJO v sredini romba (obvezna, vključena v ceno — nakup brez alu cevi ni mogoč); objavljena meja STEBRIČKOV je samo 145 cm in samo z L-kotnikom na levi IN desni strani stebra (prečna postavitev); 110 cm pa NI ROMBOVA meja — to je DESKA-128. Barvne različice = "sedmimi barvami" (uradna lestvica TOČNO 7 krogov). RENDER: vizualizer riše pravokotne deske — kosooglati presek in alu cev med deskami NE sta rišana (pri pokončni postavitvi je cev uradno vidna med deskami; tu reže iskreno kažejo ozadje fotke). gapCm 2 je PRIVZETEK IZRAČUNA (reže ROKSAL za ROMB ne objavi, pri fasadi le opomoni „večji razmak ⇒ viden fasadni klip“); postCm 6 tipen.',
  },
  {
    id: 'romb-67-dekor-2',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 2/7 uradne lestvice (svetlo sivi)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-2',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 2/7 uradne lestvice.',
  },
  {
    id: 'romb-67-dekor-3',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 3/7 uradne lestvice (rožnato-rjavi)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-3',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 3/7 uradne lestvice.',
  },
  {
    id: 'romb-67-dekor-4',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 4/7 uradne lestvice (rjavo-bež)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-4',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 4/7 uradne lestvice.',
  },
  {
    id: 'romb-67-dekor-5',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 5/7 uradne lestvice (svetli zlati)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-5',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 5/7 uradne lestvice.',
  },
  {
    id: 'romb-67-dekor-6',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 6/7 uradne lestvice (zlati teak)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-6',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 6/7 uradne lestvice.',
  },
  {
    id: 'romb-67-dekor-7',
    label: 'ROKSAL romb deska 67 (pokončno) — dekor 7/7 uradne lestvice (temno rjavo-sivi)',
    catalogSku: null,
    plankCm: 6.7, gapCm: 2,
    orientation: 'vertical',
    textureId: 'tex-roksal-romb67-dekor-7',
    postCm: 6,
    pattern: 'vertikalne',
    note: 'Barvna različica profila romb-67: dekor 7/7 uradne lestvice.',
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
  const allStandard = linked.length > 0 && linked.every((a) => a.origin === 'standard-reference');
  // roksal-original + unverified: prineseno z uradne strani roksal.com,
  // ampak barvna zvestoba NI osebno overjena — lastna iskrena kategorija
  // (ne sme dobiti oznake "realna fotografija" in NE sme trditvi "original").
  const allRoksalUnverified = linked.length > 0 && linked.every((a) => a.origin === 'roksal-original' && a.verification === 'unverified');
  const honestyLabel = missing.length > 0
    ? `Gradivo manjka: ${missing.map((a) => a.label).join(', ')}`
    : isOriginal
      ? 'Original ROKSAL gradivo'
      : allRoksalUnverified
        ? 'Originalno ROKSAL gradivo (roksal.com) — ni osebno overjeno (barvna zvestoba zaslonu nepotrjena)'
        : allStandard
          ? 'Standardna barvna referenca (RAL) — ni original ROKSAL vzorec površine'
          : 'Realna fotografija materiala (ni original ROKSAL posnetek)';
  return { canRender, isOriginal, missingAssets: missing, honestyLabel };
}
