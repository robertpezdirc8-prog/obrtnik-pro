import { db } from './db';
import { ensureSeeded } from './seed';
import { CENIK_BY_KEY, readCenik, priceLabel, type CenikValues, type PriceKey } from './cenik';
import { cenikScope } from './tenancy';

// ─── Cenik: branje in pisanje denarja ───────────────────────
//
// To je EDINA pot, po kateri številka pride v ponudbo. Prejšnja pot je bila
// koda: `pricing.ts` in `seed.ts` sta imela vsak svojo kopijo cen, obrtnik pa
// jih ni videl na zaslonu, kjer bi jih lahko popravil (Task 88).
//
// Strežnik je rob sistema, zato tu velja isto pravilo kot pri Nastavitvah:
// vpisane se NE popravlja. Neznana ključa in cene izven okna se ZAVRNEJO z
// razlogom, ki imenuje vpisano vrednost — nikoli se ne usekajo, nikoli se ne
// nadomestijo s prejšnjo ali ugodnejšo številko.

/** Neznan ključ ni tipkarski šum, ampak napaka odjemalca: povemo ga. */
const isPriceKey = (k: string): k is PriceKey => Object.hasOwn(CENIK_BY_KEY, k);

export type CenikSaveResult =
  | { ok: true; values: CenikValues }
  | { ok: false; refused: { key: string; reason: string }[] };

/** Vsi ključi, ki jih pozna register; manjkajoča vrstica v bazi pomeni, da
 *  cena ŠE NI vpisana — ne pa, da je nič. `ownerId` je obseg (Task 94):
 *  prijavljen vidi svoj cenik, brez seje legacy vrstice (ownerId = null). */
export async function loadCenik(ownerId: string | null = null): Promise<CenikValues> {
  await ensureSeeded();
  const rows = await db.cenikPrice.findMany({ where: cenikScope(ownerId) });
  const values: Record<string, number> = {};
  for (const r of rows) {
    if (r.unitPrice !== null && isPriceKey(r.key)) values[r.key] = r.unitPrice;
  }
  return values;
}

/**
 * Delno posodobitev: pride lahko samo del cenika (npr. ena vrstica iz
 * kalkulatorja). `null` pomeni, da hoče obrtnik ceno IZBRISATI — to je
 * veljavna odločitev in jo zapišemo, ponudba, ki jo potrebuje, pa bo
 * zavrnjena z razlogom.
 */
export async function saveCenik(
  body: Record<string, unknown>,
  ownerId: string | null = null,
): Promise<CenikSaveResult> {
  await ensureSeeded();

  const refused: { key: string; reason: string }[] = [];
  const incoming: Partial<Record<PriceKey, number>> = {};

  for (const [key, raw] of Object.entries(body ?? {})) {
    if (!isPriceKey(key)) {
      refused.push({ key, reason: `${key}: takega izdelka Cenik ne pozna` });
      continue;
    }
    if (raw === null) continue; // izbris je veljaven, ni potrebe po presoji okna
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      refused.push({ key, reason: `${priceLabel(key)}: „${String(raw)}“ številka ni` });
      continue;
    }
    incoming[key] = value;
  }

  // Okno (≥ 0 €) presoji ISTI bralec kot dokumente, da strežnik ne more
  // sprejeti cene, jo pa zaslon ponudbe kasneje zavrniti — ali obratno.
  const readings = readCenik(incoming);
  for (const key of Object.keys(incoming) as PriceKey[]) {
    const problem = readings[key]?.problem ?? null;
    if (problem) refused.push({ key, reason: `${priceLabel(key)} — ${problem}` });
  }
  if (refused.length > 0) return { ok: false, refused };

  // Zapis po obsegu (Task 94): findFirst + update/create namesto upsert,
  // ker je kompozitna unikatnost (key, ownerId) z null vrednostjo v
  // where ne uporabna za upsert (null ni enak null v indeksu).
  for (const [key, raw] of Object.entries(body ?? {})) {
    if (!isPriceKey(key)) continue;
    const value = raw === null ? null : Number(raw);
    const row = await db.cenikPrice.findFirst({ where: { key, ...cenikScope(ownerId) } });
    if (row) {
      await db.cenikPrice.update({ where: { id: row.id }, data: { unitPrice: value } });
    } else {
      await db.cenikPrice.create({ data: { key, ownerId, unitPrice: value } });
    }
  }

  return { ok: true, values: await loadCenik(ownerId) };
}
