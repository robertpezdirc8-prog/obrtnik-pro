import { db } from '@/lib/db';

// ─── Idempotentni seed kataloga in nastavitev ───────────────
// Pokliče se ob prvem requestu na /api/catalog ali /api/settings.

type SeedProduct = {
  name: string;
  description?: string;
  unit: string;
  unitPrice: number;
  sku?: string;
};

type SeedCategory = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  products: SeedProduct[];
};

const CATALOG: SeedCategory[] = [
  {
    slug: 'ograje',
    name: 'Balkonske ograje',
    description: 'Aluminijaste, steklene, inox in WPC ograje ter pragovi',
    icon: 'Fence',
    products: [
      { name: 'Aluminijasta ograja (prtljažnik + stebri)', description: 'Eloksirana, barva po izbiri, komplet na meter', unit: 'm', unitPrice: 145 },
      { name: 'Steklena ograja (kaljeno steklo 10 mm)', description: 'Kaljeno/lakirano steklo z nerez držali', unit: 'm', unitPrice: 240 },
      { name: 'Inox ograja (cev 42,4 mm)', description: 'Nerjaveče jeklo AISI 304, saten', unit: 'm', unitPrice: 165 },
      { name: 'Steber aluminij 40×40', description: 'Z pritrdilnim kompletom', unit: 'kos', unitPrice: 38 },
      { name: 'Steber inox 42,4 mm', description: 'Z bazo in pokrovčkom', unit: 'kos', unitPrice: 52 },
      { name: 'Steklena plošča za ograjo 10 mm', description: 'Na mero, robovi obdelani', unit: 'm²', unitPrice: 130 },
      { name: 'Vrvični prestreznik (nerez)', unit: 'kos', unitPrice: 4.5 },
      { name: 'Montaža ograje', description: 'Na beton/objekt, vključno z vijačevjem', unit: 'm', unitPrice: 35 },
    ],
  },
  {
    slug: 'stopnice',
    name: 'Stopnice',
    description: 'Zunanje in notranje stopnice, WPC, les, kovina',
    icon: 'Footprints',
    products: [
      { name: 'Stopnica WPC (profil 25×160 mm)', description: 'Z vgrajenim nosilcem', unit: 'kos', unitPrice: 48 },
      { name: 'Stopnica hrast masiv 40 mm', description: 'Na mero, oljirana', unit: 'kos', unitPrice: 95 },
      { name: 'Kovinska nosilna konstrukcija stopnic', description: 'Jekleni nosilci, cevovodi', unit: 'kos', unitPrice: 120 },
      { name: 'Ograja na stopnice (aluminij)', unit: 'm', unitPrice: 145 },
      { name: 'Antidrseči trak/profil', unit: 'm', unitPrice: 6 },
      { name: 'Montaža stopnic', description: 'Na uro, vključno z izravnavo', unit: 'ura', unitPrice: 40 },
    ],
  },
  {
    slug: 'keramika',
    name: 'Keramika',
    description: 'Ploščice, klinker, naravni kamen, lepila in fuge',
    icon: 'Grid3X3',
    products: [
      { name: 'Keramične ploščice 60×60', description: '1. izbor, posnetek', unit: 'm²', unitPrice: 24 },
      { name: 'Velikformatne ploščice 120×60', unit: 'm²', unitPrice: 45 },
      { name: 'Klinker ploščice (zunanja uporaba)', unit: 'm²', unitPrice: 38 },
      { name: 'Lepilo za ploščice (flex, 25 kg)', description: 'Deformacijsko lepilo razred C2TE S1', unit: 'vrečka', unitPrice: 14 },
      { name: 'Fuga (5 kg)', description: 'Širina fuge 2–20 mm', unit: 'kos', unitPrice: 11 },
      { name: 'Silikon za dilatacije', unit: 'kos', unitPrice: 9 },
      { name: 'Križci/prižice za fuge', unit: 'paket', unitPrice: 4 },
      { name: 'Polaganje ploščic', description: 'Na m², standardni prostor', unit: 'm²', unitPrice: 30 },
      { name: 'Hidroizolacija (kopalnica)', description: 'Dvakratni nanos z trakovi', unit: 'm²', unitPrice: 12 },
    ],
  },
  {
    slug: 'wpc-terasa',
    name: 'WPC terasa',
    description: 'Terasne deske WPC, nosilci, spojniki',
    icon: 'LayoutPanelTop',
    products: [
      { name: 'Terasna deska WPC (polna, 25×140 mm)', description: 'Barva po izbiri, 4 m dolžina', unit: 'm', unitPrice: 12.5 },
      { name: 'Terasna deska WPC 3D reljef', unit: 'm', unitPrice: 15 },
      { name: 'Nosilec aluminij 40×40', unit: 'm', unitPrice: 7 },
      { name: 'Nosilec WPC 40×60', unit: 'm', unitPrice: 4.5 },
      { name: 'Skrita spojna kljukica', unit: 'kos', unitPrice: 0.8 },
      { name: 'Začetni/končni profil', unit: 'kos', unitPrice: 6 },
      { name: 'Vijačevje za beton (nerez)', unit: 'kos', unitPrice: 1.2 },
      { name: 'Montaža terase', unit: 'm²', unitPrice: 28 },
    ],
  },
  {
    slug: 'okna-vrata',
    name: 'Okna in vrata',
    description: 'PVC, aluminij in les; notranje in zunanje vrata',
    icon: 'DoorOpen',
    products: [
      { name: 'Okno PVC 2-krilno (na mero)', description: '3-slojno steklo, Uw ≤ 1,1', unit: 'kos', unitPrice: 320 },
      { name: 'Okno PVC 1-krilno (na mero)', unit: 'kos', unitPrice: 210 },
      { name: 'Okno aluminij (na mero)', description: 'Toplotna prekinitev', unit: 'kos', unitPrice: 520 },
      { name: 'Zunanja vrata PVC', unit: 'kos', unitPrice: 580 },
      { name: 'Notranja vrata (okvir + krilo)', unit: 'kos', unitPrice: 195 },
      { name: 'Dvižno-drseča vrata (HST)', unit: 'kos', unitPrice: 1450 },
      { name: 'Montaža okna/vrat', unit: 'kos', unitPrice: 65 },
      { name: 'Odstranitev starega okna', unit: 'kos', unitPrice: 25 },
    ],
  },
  {
    slug: 'nadstreški',
    name: 'Nadstreški',
    description: 'Nadstreški za vhode in avtomobile, terase',
    icon: 'Umbrella',
    products: [
      { name: 'Konstrukcija nadstreška (jeklo, pocinkano)', unit: 'm²', unitPrice: 95 },
      { name: 'Kritina trapezna pločevina', unit: 'm²', unitPrice: 14 },
      { name: 'Kritina polikarbonat 10 mm', unit: 'm²', unitPrice: 22 },
      { name: 'Kritina steklo varnostno 8 mm', unit: 'm²', unitPrice: 68 },
      { name: 'Steber za nadstrešek (jeklo 80×80)', unit: 'kos', unitPrice: 85 },
      { name: 'Odvod vode (zaboj + cev)', unit: 'm', unitPrice: 18 },
      { name: 'Montaža nadstreška', unit: 'm²', unitPrice: 45 },
    ],
  },
  {
    slug: 'fasada',
    name: 'Fasade',
    description: 'Fasadne obloge WPC, les, trapez, letske fasade',
    icon: 'Building2',
    products: [
      { name: 'Fasadna obloga WPC', unit: 'm²', unitPrice: 52 },
      { name: 'Fasadna obloga les (smreka, termo)', unit: 'm²', unitPrice: 44 },
      { name: 'Trapezna fasadna pločevina 0,5 mm', unit: 'm²', unitPrice: 26 },
      { name: 'Podkonstrukcija (letve alu/WPC)', unit: 'm', unitPrice: 8 },
      { name: 'Začetni, končni in vogalni profil', unit: 'kos', unitPrice: 9 },
      { name: 'Ventilirana fasada – montaža', unit: 'm²', unitPrice: 32 },
      { name: 'Odstranitev stare obloge', unit: 'm²', unitPrice: 8 },
    ],
  },
];

export async function ensureSeeded(): Promise<void> {
  const existing = await db.category.count();
  if (existing > 0) {
    const settings = await db.settings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      await db.settings.create({ data: { id: 'default' } });
    }
    return;
  }

  for (let i = 0; i < CATALOG.length; i++) {
    const cat = CATALOG[i];
    const category = await db.category.create({
      data: {
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
      },
    });
    for (const p of cat.products) {
      await db.product.create({
        data: {
          categoryId: category.id,
          name: p.name,
          description: p.description ?? null,
          unit: p.unit,
          unitPrice: p.unitPrice,
          sku: p.sku ?? null,
        },
      });
    }
  }

  const settings = await db.settings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    await db.settings.create({ data: { id: 'default' } });
  }
}
