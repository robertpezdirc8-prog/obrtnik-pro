import { numberProblemSentence, parseNumberInput } from './settings-inputs';
import type { CraftId } from './types';

// ─── Cenik: register cenovnih ključev ───────────────────────
//
// V TEJ DATOTEKI NI NIČ CENE. To je namenoma — doslej je bila vsaka cena
// napisana dvakrat: enkrat v `seed.ts` (katalog) in enkrat v `pricing.ts`
// (vrstica izračuna), nobena pa je ni vnesel obrtnik. 145 €/m za aluminijasto
// ograjo, 520 €/kos za okno, 28 €/m² za montažo terase, 45 €/m² za nadstrešek,
// 32 €/m² za fasado, 65 in 85 €/kos za okna oziroma vrata, `laborRate * 0,85`
// za polaganje ploščic — vse to so številke, ki jih je izračunal program, ne
// človek, ki bo po njih izstavil račun.
//
// Pravilo obrtnika (Task 88): aplikacija sme izračunati **količino** ( metre,
// m², kose, kilograme, ure), nikoli pa cene. Zato ta register našteje samo,
// KAJ je mogoče oceniti — ključ, naziv in mersko enoto. Vsaka vrstica
// kalkulatorja nosi `priceKey`, denar pa se pripne šele iz Cenika, kjer ga
// vpiše obrtnik. Če cene ni, vrstica ostane brez zneska in ponudbe ni mogoče
// shraniti ali natisniti.
//
// Naziv vrstice živi SAMO tukaj. Kalkulator ga ne sme ponoviti, sicer bi se
// kataloška in izračunska imena spet razila — kar je bil prav ta bug.

export type PriceKey =
  // ── Ograje ──
  | 'ograje.alu'
  | 'ograje.steklo'
  | 'ograje.inox'
  | 'ograje.steklo-plosca'
  | 'ograje.steber'
  | 'ograje.steber-inox'
  | 'ograje.vijaki'
  | 'ograje.vrata'
  | 'montaza.ograje'
  // ── Stopnice ──
  | 'stopnice.wpc'
  | 'stopnice.hrast'
  | 'stopnice.konstrukcija'
  | 'stopnice.antidrsece'
  | 'stopnice.ograda'
  | 'stopnice.steber'
  | 'montaza.stopnice'
  // ── Keramika ──
  | 'keramika.ploscice-std'
  | 'keramika.ploscice-format'
  | 'keramika.ploscice-premium'
  | 'keramika.grunt'
  | 'keramika.lepilo'
  | 'keramika.fuga'
  | 'keramika.prizice'
  | 'keramika.silikon'
  | 'keramika.hidroizolacija'
  | 'montaza.keramika'
  // ── WPC terasa ──
  | 'terasa.deska-klasicna'
  | 'terasa.deska-relief'
  | 'terasa.deska-jedro'
  | 'terasa.nosilci'
  | 'terasa.kljukice'
  | 'terasa.profil'
  | 'terasa.vijaki'
  | 'montaza.terasa'
  // ── Okna in vrata ──
  | 'okna.pvc'
  | 'okna.alu'
  | 'vrata.zunanja'
  | 'okna.demontaza'
  | 'okna.zatesnitev'
  | 'montaza.okna'
  | 'montaza.vrata'
  // ── Nadstrešek ──
  | 'nadstresek.konstrukcija'
  | 'nadstresek.kritina-ploc'
  | 'nadstresek.kritina-polikar'
  | 'nadstresek.kritina-steklo'
  | 'nadstresek.steber'
  | 'nadstresek.odvod'
  | 'montaza.nadstresek'
  // ── Fasada ──
  | 'fasada.obloga-wpc'
  | 'fasada.obloga-les'
  | 'fasada.obloga-ploc'
  | 'fasada.letve'
  | 'fasada.profili'
  | 'montaza.fasada';

export interface PriceDef {
  readonly key: PriceKey;
  /** EDINI naziv te vrstice — kalkulator, Cenik in PDF ga berejo od tu. */
  readonly name: string;
  readonly unit: string;
  readonly craft: CraftId;
}

export const CENIK: readonly PriceDef[] = [
  // ── Ograje ──
  { key: 'ograje.alu', name: 'Aluminijasta ograja', unit: 'm', craft: 'ograje' },
  { key: 'ograje.steklo', name: 'Steklena ograja (kaljeno 10 mm)', unit: 'm', craft: 'ograje' },
  { key: 'ograje.inox', name: 'Inox ograja (cev 42,4 mm)', unit: 'm', craft: 'ograje' },
  { key: 'ograje.steklo-plosca', name: 'Steklene plošče', unit: 'm²', craft: 'ograje' },
  { key: 'ograje.steber', name: 'Stebri (aluminij 40×40)', unit: 'kos', craft: 'ograje' },
  { key: 'ograje.steber-inox', name: 'Stebri (inox 42,4 mm)', unit: 'kos', craft: 'ograje' },
  { key: 'ograje.vijaki', name: 'Vijačevje in pritrdilni material', unit: 'kompl/m', craft: 'ograje' },
  { key: 'ograje.vrata', name: 'Oključljivi prehod (vrata)', unit: 'kos', craft: 'ograje' },
  { key: 'montaza.ograje', name: 'Montaža ograje', unit: 'm', craft: 'ograje' },

  // ── Stopnice ──
  { key: 'stopnice.wpc', name: 'Stopnica WPC 25×160 mm', unit: 'kos', craft: 'stopnice' },
  { key: 'stopnice.hrast', name: 'Stopnica hrast masiv 40 mm', unit: 'kos', craft: 'stopnice' },
  { key: 'stopnice.konstrukcija', name: 'Nosilna konstrukcija stopnic', unit: 'kos', craft: 'stopnice' },
  { key: 'stopnice.antidrsece', name: 'Antidrseči profili', unit: 'm', craft: 'stopnice' },
  { key: 'stopnice.ograda', name: 'Ograja na stopnicah (aluminij)', unit: 'm', craft: 'stopnice' },
  { key: 'stopnice.steber', name: 'Stebri za stopniščno ograjo', unit: 'kos', craft: 'stopnice' },
  { key: 'montaza.stopnice', name: 'Montaža stopnic', unit: 'ura', craft: 'stopnice' },

  // ── Keramika ──
  { key: 'keramika.ploscice-std', name: 'Keramične ploščice — standardni format', unit: 'm²', craft: 'keramika' },
  { key: 'keramika.ploscice-format', name: 'Keramične ploščice — veliki format 60×60', unit: 'm²', craft: 'keramika' },
  { key: 'keramika.ploscice-premium', name: 'Keramične ploščice — rektificirani premium', unit: 'm²', craft: 'keramika' },
  { key: 'keramika.grunt', name: 'Premaz / grunt za podlogo', unit: 'kos', craft: 'keramika' },
  { key: 'keramika.lepilo', name: 'Lepilo (flex C2TE S1, 25 kg)', unit: 'vrečka', craft: 'keramika' },
  { key: 'keramika.fuga', name: 'Fuga', unit: 'kg', craft: 'keramika' },
  { key: 'keramika.prizice', name: 'Križci / prižice', unit: 'paket', craft: 'keramika' },
  { key: 'keramika.silikon', name: 'Silikon za dilatacije', unit: 'kos', craft: 'keramika' },
  { key: 'keramika.hidroizolacija', name: 'Hidroizolacija', unit: 'm²', craft: 'keramika' },
  { key: 'montaza.keramika', name: 'Polaganje ploščic', unit: 'm²', craft: 'keramika' },

  // ── WPC terasa ──
  { key: 'terasa.deska-klasicna', name: 'Terasna deska WPC — klasična (polna 25×140)', unit: 'm', craft: 'wpc-terasa' },
  { key: 'terasa.deska-relief', name: 'Terasna deska WPC — 3D relief', unit: 'm', craft: 'wpc-terasa' },
  { key: 'terasa.deska-jedro', name: 'Terasna deska WPC — polno jedro', unit: 'm', craft: 'wpc-terasa' },
  { key: 'terasa.nosilci', name: 'Nosilci WPC/ALU', unit: 'm', craft: 'wpc-terasa' },
  { key: 'terasa.kljukice', name: 'Skrite spojne kljukice', unit: 'kos', craft: 'wpc-terasa' },
  { key: 'terasa.profil', name: 'Zaključni profil (obod)', unit: 'm', craft: 'wpc-terasa' },
  { key: 'terasa.vijaki', name: 'Vijačevje za podlago', unit: 'kos', craft: 'wpc-terasa' },
  { key: 'montaza.terasa', name: 'Montaža terase', unit: 'm²', craft: 'wpc-terasa' },

  // ── Okna in vrata ──
  { key: 'okna.pvc', name: 'Okno PVC (na mero)', unit: 'kos', craft: 'okna-vrata' },
  { key: 'okna.alu', name: 'Okno aluminij (na mero)', unit: 'kos', craft: 'okna-vrata' },
  { key: 'vrata.zunanja', name: 'Zunanja vrata PVC', unit: 'kos', craft: 'okna-vrata' },
  { key: 'okna.demontaza', name: 'Odstranitev in odvoz starih odprtij', unit: 'kos', craft: 'okna-vrata' },
  { key: 'okna.zatesnitev', name: 'Zatesnitev in obdelava odprtij', unit: 'kos', craft: 'okna-vrata' },
  { key: 'montaza.okna', name: 'Montaža oken', unit: 'kos', craft: 'okna-vrata' },
  { key: 'montaza.vrata', name: 'Montaža vrat', unit: 'kos', craft: 'okna-vrata' },

  // ── Nadstrešek ──
  { key: 'nadstresek.konstrukcija', name: 'Nosilna konstrukcija nadstreška', unit: 'm²', craft: 'nadstreški' },
  { key: 'nadstresek.kritina-ploc', name: 'Kritina: trapezna pločevina', unit: 'm²', craft: 'nadstreški' },
  { key: 'nadstresek.kritina-polikar', name: 'Kritina: polikarbonat 10 mm', unit: 'm²', craft: 'nadstreški' },
  { key: 'nadstresek.kritina-steklo', name: 'Kritina: varnostno steklo 8 mm', unit: 'm²', craft: 'nadstreški' },
  { key: 'nadstresek.steber', name: 'Stebri (jeklo 80×80)', unit: 'kos', craft: 'nadstreški' },
  { key: 'nadstresek.odvod', name: 'Odvod padavinske vode', unit: 'm', craft: 'nadstreški' },
  { key: 'montaza.nadstresek', name: 'Montaža nadstreška', unit: 'm²', craft: 'nadstreški' },

  // ── Fasada ──
  { key: 'fasada.obloga-wpc', name: 'Fasadna obloga WPC', unit: 'm²', craft: 'fasada' },
  { key: 'fasada.obloga-les', name: 'Fasadna obloga les (termo smreka)', unit: 'm²', craft: 'fasada' },
  { key: 'fasada.obloga-ploc', name: 'Trapezna fasadna pločevina', unit: 'm²', craft: 'fasada' },
  { key: 'fasada.letve', name: 'Podkonstrukcija (letve)', unit: 'm', craft: 'fasada' },
  { key: 'fasada.profili', name: 'Zaključni profili (začetni, končni, vogalni)', unit: 'kos', craft: 'fasada' },
  { key: 'montaza.fasada', name: 'Montaža ventilirane fasade', unit: 'm²', craft: 'fasada' },
];

export const CENIK_BY_KEY: Readonly<Record<PriceKey, PriceDef>> = Object.fromEntries(
  CENIK.map((d) => [d.key, d]),
) as Record<PriceKey, PriceDef>;

export const CENIK_KEYS: readonly PriceKey[] = CENIK.map((d) => d.key);

/** Cenik po dejavnostih — zaslon Cenik ga prikaže v istem vrstnem redu kot
 *  kalkulatorji, da obrtnik išče cene tam, kjer jih je potreboval. */
export const CENIK_GROUPS: ReadonlyArray<{ craft: CraftId; defs: readonly PriceDef[] }> =
  CENIK.reduce<{ craft: CraftId; defs: PriceDef[] }[]>((groups, d) => {
    const last = groups[groups.length - 1];
    if (last && last.craft === d.craft) last.defs.push(d);
    else groups.push({ craft: d.craft, defs: [d] });
    return groups;
  }, []);

/** Cena na enoto. Spodnja meja izhaja iz enote (negativne cene ponudba ne
 *  more izstaviti); zgornje meje NE postavljamo — koliko znaša meter ograje,
 *  odloči obrtnik, ne aplikacija. */
export const PRICE_MIN = 0;

export const priceWindowHint = (): string =>
  'sprejemamo najmanj 0 €; brez cene vrstica na dokumentu ni obračunana';

/** Vpis v cenovno polje → število, kakor ga je monter napisal. Prazno polje
 *  je NaN in NE 0 — izprazniti ceno ne sme pomeniti »deljeno z nič«. */
export const parsePriceInput = parseNumberInput;

export const priceProblemSentence = numberProblemSentence;

export function priceLabel(key: PriceKey): string {
  const d = CENIK_BY_KEY[key];
  return `${d.name} (€/${d.unit})`;
}

// ─── Pripet cene količinam ──────────────────────────────────

/** Kalkulatorjeva vrstica, ki še nima cene — `unitPrice` je vedno `null`,
 *  dokler je `applyCenik` ne pripne iz Cenika. */
export interface UnpricedLine {
  priceKey?: PriceKey;
  unitPrice: number | null;
}

/**
 * Pripne obrtnikove cene na izračunane količine. Vrstica, katere cene ni mogoče
 * prebrati (ni je v Ceniku ali je izven okna), OHRANI `null` — nikoli ne dobi
 * ničle in nikoli ne dobi prejšnje vrednosti. To je edini prehod, po katerem
 * sme denar priti v ponudbo.
 */
export function applyCenik<L extends UnpricedLine>(
  lines: readonly L[],
  cenik: Readonly<Partial<Record<PriceKey, CenikReading>>>,
): L[] {
  return lines.map((l) => {
    if (!l.priceKey) return { ...l, unitPrice: null };
    const reading = cenik[l.priceKey];
    if (!reading || reading.problem !== null) return { ...l, unitPrice: null };
    return { ...l, unitPrice: reading.value };
  });
}

/** Vrstice brez cene — zaslon in dokument ju morata IMENOVATI, ne spregledati. */
export function unpricedLines<L extends { name: string; unitPrice: number | null }>(
  lines: readonly L[],
): L[] {
  return lines.filter((l) => l.unitPrice === null || !Number.isFinite(l.unitPrice));
}

// ─── Kakovostni razredi ─────────────────────────────────────
//
// Bili so trije bralci cen, ki jih je napisal kalkulator: GBB panel je za
// keramiko podal `tilePricePerM2: 22 / 38 / 60`, za teraso `boardPricePerM:
// 12.5 / 19 / 26`. Odtenek materiala je izbira, ne cena — zato razred izbere
// SAMO ključ, ceno pa vedno nosi Cenik.

export type TileGrade = 'std' | 'format' | 'premium';
export type BoardGrade = 'klasicna' | 'relief' | 'jedro';

export const TILE_GRADE_KEY: Record<TileGrade, PriceKey> = {
  std: 'keramika.ploscice-std',
  format: 'keramika.ploscice-format',
  premium: 'keramika.ploscice-premium',
};

export const BOARD_GRADE_KEY: Record<BoardGrade, PriceKey> = {
  klasicna: 'terasa.deska-klasicna',
  relief: 'terasa.deska-relief',
  jedro: 'terasa.deska-jedro',
};

export const TILE_GRADES: readonly { value: TileGrade; label: string }[] = [
  { value: 'std', label: 'Standardni format' },
  { value: 'format', label: 'Veliki format 60×60' },
  { value: 'premium', label: 'Rektificirani premium' },
];

export const BOARD_GRADES: readonly { value: BoardGrade; label: string }[] = [
  { value: 'klasicna', label: 'Klasična WPC deska' },
  { value: 'relief', label: '3D relief' },
  { value: 'jedro', label: 'Polno jedro' },
];

// ─── Gradnik vrstice ────────────────────────────────────────

/** Kalkulatorjeva vrstice: KOLIČINA in ključ. Naziv in merska enota sta vzeta
 *  iz registra, cena je `null`, dokler je obrtnik ne vpiše v Cenik. Kalkulator
 *  cene NE more dobiti — nima je od kod. */
export function cenikLine(
  key: PriceKey,
  quantity: number,
  description?: string,
): { name: string; priceKey: PriceKey; unit: string; quantity: number; unitPrice: null; description?: string } {
  const d = CENIK_BY_KEY[key];
  return {
    name: d.name,
    priceKey: key,
    unit: d.unit,
    quantity,
    unitPrice: null,
    ...(description === undefined ? {} : { description }),
  };
}

/** Vrednosti cenika: manjkajoč ključ pomeni, da cena NI vpisana. */
export type CenikValues = Readonly<Partial<Record<PriceKey, number>>>;

export interface CenikReading {
  value: number;
  /** Null pomeni: cena je veljavna in jo dokument sme uporabiti dobesedno. */
  problem: string | null;
}

/**
 * Prebere vpisane cene PO KLJUČIH. Manjkajoča ali neveljavna cena ne ugasne
 * celotnega cenika — kot pri `readSettings` se razreže po vrstah, da obrtnik
 * vidi, kaj točno mora še dopolniti.
 */
export function readCenik(values: CenikValues): Partial<Record<PriceKey, CenikReading>> {
  const out: Partial<Record<PriceKey, CenikReading>> = {};
  for (const key of CENIK_KEYS) {
    const raw = values[key];
    const value = raw === undefined || raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) {
      out[key] = { value, problem: 'cena ni vpisana' };
    } else if (value < PRICE_MIN) {
      out[key] = {
        value,
        problem: `cena ${value} € je pod ničlo — ponudba ne more izstaviti negativnega zneska`,
      };
    } else {
      out[key] = { value, problem: null };
    }
  }
  return out;
}
