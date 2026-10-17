import { db } from '@/lib/db';
import { CENIK, type PriceKey } from '@/lib/cenik';
import type { CraftId } from '@/lib/types';

// ─── Idempotentni seed kataloga in nastavitev ───────────────
// Pokliče se ob prvem requestu na /api/catalog, /api/settings ali /api/cenik.
//
// Task 88: KATALOG NIMA CEN. Doslej je imela vsaka od teh ~50 vrstic v kodi
// zapisano številko (145 €/m za aluminijasto ograjo, 520 €/kos za okno,
// 0,80 €/kos za kljukico), nihče pa je ni vnesel. Enak seznam je bil napisan
// še drugič v `pricing.ts` — z nekoliko drugim imenom in še nekoliko drugo
// ceno. Ponudba je zato tekla po številkah, ki jih je izbral programer.
//
// Zdaj je seznam EN sam: izpeljan iz registra `CENIK` (`lib/cenik.ts`), ki
// ve, KAJ je mogoče oceniti. `sku` je cenovni ključ, zato se katalog,
// kalkulator in Cenik ne morejo več raziti. Denar živi izključno v tabeli
// `CenikPrice` in ga vpiše obrtnik.
//
// Izjema so trije izdelki, ki jih noben kalkulator ne zmore (notranja vrata,
// drseča vrata, klinker). Ti ostanejo v katalogu brez `sku`; ko jih obrtnik
// doda v ponudbo, se zanje ceno vpíše v sami ponudbi.

type SeedProduct = {
  sku: PriceKey | null;
  name: string;
  description?: string;
  unit: string;
};

type SeedCategory = {
  slug: CraftId;
  name: string;
  description: string;
  icon: string;
  /** Izdelki, ki jih register `CENIK` ne pokriva. */
  extras?: SeedProduct[];
};

const CATEGORIES: Omit<SeedCategory, 'extras'>[] = [
  { slug: 'ograje', name: 'Balkonske ograje', description: 'Aluminijaste, steklene, inox in WPC ograje ter pragovi', icon: 'Fence' },
  { slug: 'stopnice', name: 'Stopnice', description: 'Zunanje in notranje stopnice, WPC, les, kovina', icon: 'Footprints' },
  { slug: 'keramika', name: 'Keramika', description: 'Ploščice, klinker, naravni kamen, lepila in fuge', icon: 'Grid3X3' },
  { slug: 'wpc-terasa', name: 'WPC terasa', description: 'Terasne deske WPC, nosilci, spojniki', icon: 'LayoutPanelTop' },
  { slug: 'okna-vrata', name: 'Okna in vrata', description: 'PVC, aluminij in les; notranje in zunanje vrata', icon: 'DoorOpen' },
  { slug: 'nadstreški', name: 'Nadstreški', description: 'Nadstreški za vhode in avtomobile, terase', icon: 'Umbrella' },
  { slug: 'fasada', name: 'Fasade', description: 'Fasadne obloge WPC, les, trapez, letske fasade', icon: 'Building2' },
];

/** Tehnična specifikacija ob nakupu. Opisi, ne cene — številke tu ni. */
const SPECS: Partial<Record<PriceKey, string>> = {
  'ograje.alu': 'Eloksirana, barva po izbiri, komplet na meter',
  'ograje.steklo': 'Kaljeno/lakirano steklo z nerez držali',
  'ograje.inox': 'Nerjaveče jeklo AISI 304, saten',
  'ograje.steklo-plosca': 'Na mero, robovi obdelani',
  'ograje.steber': 'Z pritrdilnim kompletom',
  'ograje.steber-inox': 'Z bazo in pokrovčkom',
  'ograje.vrata': 'Oključljiva prehodna vrata 0,9 m',
  'montaza.ograje': 'Na beton/objekt, vključno z vijačevjem',
  'stopnice.wpc': 'Z vgrajenim nosilcem',
  'stopnice.hrast': 'Na mero, oljirana',
  'stopnice.konstrukcija': 'Jekleni nosilci, cevovodi',
  'montaza.stopnice': 'Na uro, vključno z izravnavo',
  'keramika.ploscice-std': '1. izbor, posnetek',
  'keramika.ploscice-format': 'Veliki format, manj fug',
  'keramika.ploscice-premium': 'Rektificirano, minimalna fuga 1,5 mm',
  'keramika.grunt': '1 kos (5 l) ≈ 30 m²',
  'keramika.lepilo': 'Deformacijsko lepilo razred C2TE S1',
  'keramika.hidroizolacija': 'Dvakratni nanos z trakovi',
  'montaza.keramika': 'Na m², standardni prostor',
  'terasa.deska-klasicna': 'Barva po izbiri, 4 m dolžina',
  'terasa.deska-relief': 'Izrazita lesna struktura',
  'terasa.deska-jedro': 'Polno jedro, mehkejši zvok',
  'terasa.nosilci': 'Alu 40×40 ali WPC 40×60',
  'terasa.profil': 'Začetni / končni / robni',
  'terasa.vijaki': 'Nerez, za beton',
  'okna.pvc': '3-slojno steklo, Uw ≤ 1,1',
  'okna.alu': 'Toplotna prekinitev',
  'okna.demontaza': 'Demontaža + odvoz',
  'okna.zatesnitev': 'PS pena, parna zapora, okrasne letve',
  'fasada.obloga-les': 'Smreka, termo',
  'fasada.obloga-ploc': '0,5 mm',
  'fasada.letve': 'Alu ali WPC',
  'fasada.profili': 'Začetni, končni in vogalni',
  'montaza.fasada': 'Ventilirana fasada',
};

/** Izdelki brez cenovnega ključa — noben kalkulator jih ne izračuna. */
const EXTRAS: Record<CraftId, SeedProduct[]> = {
  'ograje': [],
  'stopnice': [],
  'keramika': [{ sku: null, name: 'Klinker ploščice (zunanja uporaba)', unit: 'm²' }],
  'wpc-terasa': [],
  'okna-vrata': [
    { sku: null, name: 'Okno PVC 2-krilno (na mero)', description: '3-slojno steklo, Uw ≤ 1,1', unit: 'kos' },
    { sku: null, name: 'Notranja vrata (okvir + krilo)', unit: 'kos' },
    { sku: null, name: 'Dvižno-drseča vrata (HST)', unit: 'kos' },
  ],
  'nadstreški': [],
  'fasada': [{ sku: null, name: 'Odstranitev stare obloge', unit: 'm²' }],
};

/** Katalog = register + dodatki. En sam seznam, zato se imena in mere ne morejo
 *  raziti med katalogom, Cenikom in kalkulatorji. */
function productsFor(slug: CraftId): SeedProduct[] {
  const fromRegistry = CENIK.filter((d) => d.craft === slug).map((d) => ({
    sku: d.key,
    name: d.name,
    description: SPECS[d.key],
    unit: d.unit,
  }));
  return [...fromRegistry, ...(EXTRAS[slug] ?? [])];
}

export async function ensureSeeded(): Promise<void> {
  const existing = await db.category.count();
  if (existing > 0) {
    await ensureSettingsRow();
    return;
  }

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    const category = await db.category.create({
      data: {
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
      },
    });
    for (const p of productsFor(cat.slug)) {
      await db.product.create({
        data: {
          categoryId: category.id,
          name: p.name,
          description: p.description ?? null,
          unit: p.unit,
          sku: p.sku,
        },
      });
    }
  }

  await ensureSettingsRow();
}

/** Nastavitev se NE seed s številkami: `@default` je bil prav tako izmišljena
 *  cena (35 €/h, 22 % DDV, 30 % kapara). Prazna vrstica pomeni, da obrtnik še
 *  ni ničesar vpisal, `readSettings` pa to javi z razlogom. */
async function ensureSettingsRow(): Promise<void> {
  const settings = await db.settings.findUnique({ where: { id: 'default' } });
  if (!settings) await db.settings.create({ data: { id: 'default' } });
}
