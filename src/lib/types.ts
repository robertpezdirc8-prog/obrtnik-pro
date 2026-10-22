// ─── Skupni tipi za Obrtnik Pro ─────────────────────────────

import type { BoardGrade, PriceKey, TileGrade } from './cenik';

export type CraftId =
  | 'ograje'
  | 'stopnice'
  | 'keramika'
  | 'wpc-terasa'
  | 'okna-vrata'
  | 'nadstreški'
  | 'fasada';

export interface CategoryDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  products: ProductDTO[];
}

export interface ProductDTO {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  unit: string;
  /**
   * Cenovni ključ iz registra `lib/cenik.ts` ali null (izdelek, ki ga noben
   * kalkulator ne pozna). KATALOG NIMA CENE: cena se bere iz Cenika po `sku`,
   * vrstica brez cene pa gre v ponudbo prazna in jo mora obrtnik vpisati.
   */
  sku: PriceKey | null;
}

export interface DraftItem {
  key: string;
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  /** `null` = obrtnik cene še ni vpisal. Takšne vrstice ni mogoče shraniti. */
  unitPrice: number | null;
  productId?: string;
  priceKey?: PriceKey;
}

export interface OfferDTO {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  objectAddress: string | null;
  note: string | null;
  status: OfferStatus;
  /** Kdaj označena za poslano (časovni žig za iskren win-rate). */
  sentAt: string | null;
  /** Kdaj je stranka odločila (sprejeto/zavrnjeno). */
  decidedAt: string | null;
  /** Wiedervorlage — datum ročnega opomnika za follow-up. */
  followUpAt: string | null;
  /** Ali je ponudba nastala iz fotomontaže (ponujen je montažni list). */
  hasMontage?: boolean;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  createdAt: string;
  items: OfferItemDTO[];
}

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

export interface InvoiceDTO {
  id: string;
  number: string;
  offerId: string;
  offerNumber?: string;
  customerName: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  /** Rok plačila (ISO) — null = privzeti 30 dni od izdaje. */
  dueAt: string | null;
  /** Kdaj plačano (ISO) — null = neplačan. */
  paidAt: string | null;
  createdAt: string;
  /** Št. postavk v snapshotu (Task 49) — 0 = starejši račun brez snapshotov. */
  itemCount?: number;
}

export interface OfferItemDTO {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

export interface SettingsDTO {
  companyName: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  taxNumber: string;
  iban: string;
  vatRate: number;
  laborRate: number;
  /** Koliko dni je ponudba veljavna (izpiše se na PDF). */
  quoteValidDays: number;
  /** Akontacija v % skupne vrednosti (izpiše se na PDF in v SMS povzetku). */
  depositPercent: number;
  /** Rok plačila računa v dneh (izpiše se na računu). */
  paymentDays: number;
  logoUrl: string | null;
}

// ─── Izračunski rezultat ────────────────────────────────────

export interface CalcLine {
  name: string;
  /** Ključ v Ceniku. Kalkulator sme izračunati samo KOLIČINO; cena je vedno
   *  obrtnikov vnos. Prosto napisana vrstica v ponudbi ključa nima. */
  priceKey?: PriceKey;
  description?: string;
  quantity: number;
  unit: string;
  /** `null` = cena ni vpisana. Vrsta ostane na dokumentu brez zneska in
   *  ponudbe ni mogoče shraniti, dokler obrtnik ne dopolni. */
  unitPrice: number | null;
  productId?: string;
}

export interface CalcResult {
  lines: CalcLine[];
  summary: { label: string; value: string }[];
}

/** Uporabniški vnos kalkulatorja – vsi podatki, ki jih bere engine. */
export interface CraftInputs {
  // Ograje
  length?: number;            // m
  height?: number;            // m
  material?: 'alu' | 'steklo' | 'inox';
  gates?: number;             // št. prehodov
  // Stopnice
  steps?: number;
  stepWidth?: number;         // m
  stepMaterial?: 'wpc' | 'hrast';
  railingLength?: number;     // m (0 = izračun)
  railingNeeded?: boolean;
  totalRiseCm?: number;       // skupna višinska razlika (cm) — samodejno št. stopnic + kontrola udobja 2R+G
  // Keramika
  floorLength?: number;       // m
  floorWidth?: number;        // m
  wallHeight?: number;        // m (0 = samo tla)
  tileGrade?: TileGrade;
  reservePercent?: number;
  tilePattern?: 'ravno' | 'diagonalno' | 'ribja-kost'; // vzorec polaganja → priporočen odpadek
  // WPC terasa
  deckLength?: number;        // m
  deckWidth?: number;         // m
  joistSpacing?: number;      // m (privzeto 0,33 = spodnji rob ROKSALovega objavljenega pasu 33–35 cm)
  boardGrade?: BoardGrade;
  boardLengthM?: number;      // nabavna dolžina deske (m, privzeto 4) — rezalni načrt
  sideGapMm?: number;         // stranska dilatacija (mm, privzeto 5)
  endGapMm?: number;          // čelna dilatacija (mm, privzeto 4)
  // Okna/vrata
  windowCount?: number;
  windowSize?: number;        // m²
  windowMaterial?: 'pvc' | 'alu';
  doorCount?: number;
  removeOld?: boolean;
  // Nadstrešek
  canopyWidth?: number;       // m
  canopyDepth?: number;       // m
  canopyCover?: 'ploc' | 'polikar' | 'steklo';
  canopyPosts?: number;
  waterDrain?: boolean;
  // Fasada
  facadePerimeter?: number;   // m (ali skupna dolžina stene)
  facadeHeight?: number;      // m
  openingsM2?: number;        // m² odprtin
  cladding?: 'wpc' | 'les' | 'ploc';
}
