// ─── Kosovnica (BOM) iz shranjene različice fotomontaže — deterministično, 0 AI ──
// Problem (raziskava Task 63, zunanja potrditev: Simpson Strong-Tie BOM je ključna
// funkcija #2 na trgu): iz upodobljene ograje na fotki obrtnik ročno prepisuje
// število desk in dolžine rezov v ponudbo → dvojni vnos in napake.
//
// REŠITEV: iz metapodatkov različice (ReplaceMetadata, ki jih shrani korak 7)
// deterministično izračuna material. Štetje desk je TOČNO ISTA formula kot v
// jedru fotomontaže (computePlankLayouts, photo-replace-core.ts):
//     n = floor((prečni razpon + reža) / (element + reža))
// zato kosovnica ustreza tistemu, kar je uporabnik VIDEL v upodobitvi — ne oceni.
//
// ISKRENOST (načela):
//  - cena: ROKSAL cen ne prevajamo (niso del uradnega gradiva) → unitPrice = 0,
//    opis jasno pove, da jo obrtnik vpiše;
//  - stebri in pritrdilni material NISO modelirani v upodobitvi (postEveryCm je
//    null — iskreno v opombah registra) → se NE dodajajo kot postavke, samo
//    opozorilo, da ju obrtnik dopolni iz kataloga;
//  - nabavne dolžine so vključene SAMO za profile z uradno objavljeno dolžino
//    (roksal.com, „WPC deske za pokončno ograjo": 5800 mm za 57/32, 100 in 67;
//    2200 mm pokončno za 128 — raziskava Task 56, zapisana v worklogu);
//    za profile brez uradne dolžine (KUBO, generični) rezalni načrt NE nastane.

import type { ReplaceMetadata } from './photo-replace-core';
import { ROKSAL_PROFILES } from './roksal-assets';

/** Uradne nabavne dolžine (cm) po DRUŽINAH profilov — samo uradno objavljeno. */
const FAMILY_STOCK_CM: Array<{ prefix: string; stockCm: number; vir: string }> = [
  { prefix: 'polna-57-32', stockCm: 580, vir: 'uradna stran: 57 × 32 × 5800 mm' },
  { prefix: 'polna-100', stockCm: 580, vir: 'uradna stran: 100 × 12 × 5800 mm' },
  { prefix: 'polna-128', stockCm: 220, vir: 'uradna stran: 128 × 16 × 2200 mm (pokončno)' },
  { prefix: 'romb-67', stockCm: 580, vir: 'uradna stran: 67 × 26 × 5800 mm' },
];

export interface BomDraftItem {
  key: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  /** Vedno 0 — cene ROKSAL niso del uradnega gradiva; obrtnik jo vpiše v ponudbi. */
  unitPrice: number;
}

// slovnične oblike (1 kos, 2–4 kosa, 5+ kosov)
const kosLabel = (n: number): string => (n === 1 ? '1 kos' : n <= 4 ? `${n} kosa` : `${n} kosov`);
const nabavniLabel = (n: number): string =>
  n === 1 ? '1 nabavni profil' : n <= 4 ? `${n} nabavna profila` : `${n} nabavnih profilov`;

export interface BomResult {
  items: BomDraftItem[];
  warnings: string[];
  /** Št. elementov (desk) — enako kot layout.planks.length v upodobitvi. */
  boards: number;
  /** Dolžina reza enega elementa v cm. */
  cutLenCm: number;
  /** Skupni tekoči metri elementov (boards × cutLenCm / 100). */
  totalMeters: number;
  /** Nabavni profili za rezalni načrt (samo z uradno dolžino) ali null. */
  stocks: { count: number; stockCm: number; perStock: number; wasteCm: number } | null;
}

/**
 * Zgradi kosovnico iz metapodatkov shranjene različice fotomontaže.
 * Za profil išče registrat (ROKSAL_PROFILES) po meta.profileId; če profil
 * ni več v katalogu, uporabi shranjene params (elementCm/spacingCm) in
 * dodata se iskreno opozorilo. Enaki vhodi → identična kosovnica (determinizem).
 */
export function buildBomFromMeta(meta: ReplaceMetadata): BomResult {
  if (!meta || typeof meta !== 'object') throw new Error('NEZADOSTNI PODATKI: metapodatki manjkajo.');
  const wCmBom = meta.planeCm?.wCm ?? null;
  if (wCmBom === null) {
    throw new Error('KOSOVNICA NI DOLOČENA: širina ravnine ni izmerjena. Iz same geometrije (4 oglišča) se da izrisati deske, ne pa izračunati dolgov rezov in metrov — pravilo 11 (FAZA-8). Izmeri eno samo dolžino in potrdi umerjanje ravnine.');
  }
  if (!Number.isFinite(wCmBom) || wCmBom <= 0 || !Number.isFinite(meta.planeCm?.hCm) || meta.planeCm.hCm <= 0) {
    throw new Error('NEZADOSTNI PODATKI: realni meri ravnine morajo biti pozitivni števili.');
  }

  const warnings: string[] = [];
  const profile = ROKSAL_PROFILES.find((p) => p.id === meta.profileId) ?? null;
  if (!profile) warnings.push(`Profil ${meta.profileId} ni več v katalogu — uporabljene shranjene mere različice.`);

  const numParam = (k: string): number | null => {
    const v = meta.params?.[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const plankCm = profile ? profile.plankCm : numParam('elementCm');
  const gapCm = profile ? profile.gapCm : numParam('spacingCm');
  if (plankCm === null || gapCm === null) {
    throw new Error('NEZADOSTNI PODATKI: mere elementa/reže niso na voljo (profil manjka in params ju ne shranjujeta).');
  }
  // smer: ROKSAL ograjni profili so pokončni, deke vodoravne — pattern 'terasa' je edini vodoravni
  const orientation = profile ? profile.orientation : (meta.params.pattern === 'terasa' ? 'horizontal' : 'vertical');

  // TOČNO ista logika kot computePlankLayouts (photo-replace-core.ts)
  const cross = orientation === 'horizontal' ? meta.planeCm.hCm : wCmBom;
  const cutLenCm = orientation === 'horizontal' ? wCmBom : meta.planeCm.hCm;
  const pitch = plankCm + gapCm;
  const boards = Math.floor((cross + gapCm) / pitch);
  const totalMeters = Math.round(((boards * cutLenCm) / 100) * 100) / 100;

  if (boards === 0) warnings.push('Ni elementov — preveri mere elementa in reže ter velikost ravnine.');
  if (boards > 300) warnings.push(`Zelo veliko elementov (${boards}) — preveri mere ali ravnino.`);

  // rezalni načrt: samo z uradno nabavno dolžino družine
  let stocks: BomResult['stocks'] = null;
  if (boards > 0) {
    const fam = FAMILY_STOCK_CM.find((f) => meta.profileId.startsWith(f.prefix)) ?? null;
    if (fam) {
      if (cutLenCm <= fam.stockCm) {
        const perStock = Math.floor(fam.stockCm / cutLenCm);
        const count = Math.ceil(boards / perStock);
        const wasteCm = Math.round((fam.stockCm - perStock * cutLenCm) * 10) / 10;
        stocks = { count, stockCm: fam.stockCm, perStock, wasteCm };
      } else {
        warnings.push(`Rez ${Math.round(cutLenCm * 10) / 10} cm presega uradno nabavno dolžino (${fam.stockCm} cm, ${fam.vir}) — rezalni načrt ni nastavljen.`);
      }
    } else {
      warnings.push('Uradna nabavna dolžina za ta profil ni objavljena — rezalni načrt ni nastavljen (vpiši št. paketov ročno).');
    }
  }

  const items: BomDraftItem[] = [];
  if (boards > 0) {
    items.push({
      key: `bom-${meta.createdAt}-${meta.profileId}-deske`,
      name: meta.profileLabel,
      description:
        `Iz fotomontaže (${meta.createdAt.slice(0, 10)}): ravnina ` +
        `${Math.round(wCmBom)} × ${Math.round(meta.planeCm.hCm)} cm, ` +
        `${kosLabel(boards)} × rez ${Math.round(cutLenCm * 10) / 10} cm (skupaj ${totalMeters.toFixed(2)} m), ` +
        `element ${plankCm} cm + reža ${gapCm} cm, smer ${orientation === 'horizontal' ? 'vodoravno' : 'pokončno'}. ` +
        `Cena NI znana (ROKSAL cen ne prevajamo) — vpiši nabavno ceno.`,
      quantity: boards,
      unit: 'kos',
      unitPrice: 0,
    });
    if (stocks) {
      items.push({
        key: `bom-${meta.createdAt}-${meta.profileId}-nabavni`,
        name: `${meta.profileLabel} — nabavni profili (rezalni načrt)`,
        description:
          `${nabavniLabel(stocks.count)} po ${stocks.stockCm} cm → ${kosLabel(stocks.perStock)} na profil ` +
          `(odpadek ${stocks.wasteCm} cm na profil). Vir dolžine: uradna stran ROKSAL. ` +
          `Cena NI znana — vpiši nabavno ceno.`,
        quantity: stocks.count,
        unit: 'kos',
        unitPrice: 0,
      });
    }
  }

  // stalna iskrena opozorila (tudi ko je item-ov 0)
  warnings.push('Stebri in pritrdilni material NISO modelirani v upodobitvi — dopolni iz kataloga.');

  return { items, warnings, boards, cutLenCm, totalMeters, stocks };
}
