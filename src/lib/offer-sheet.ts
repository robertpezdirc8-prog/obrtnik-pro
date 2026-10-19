// ─── Montažni list, POVEZAN s ponudbo ─────────────────────────────────────
// Fotomontaža zna izračunati montažni list, a ta je bil vezan na ekran.
// Ko se iz fotomontaže sestavi ponudba, se metapodatki (ravnina, profil,
// ploščina) shranijo NA PONUDBO — in lista se lahko po potrebi natisne
// pozneje, na primer pri montaži, ko je ponudba že oddana.
//
// ISKRENO: shranimo le tisto, kar lista dejansko rabi. Vse drugo
// (razmak stebrov) je vnos monterja, ki ga potrdi; če ga ni, list pove, da
// razmak ni izmerjen — ne izmišlja ga. Ponudba brez fotomontaže nima lista
// (null), ne praznega lista.

import type { ReplaceMetadata } from './photo-replace-core';
import {
  buildInstallerSheet,
  buildInstallerSheetHtml,
  type BaySource,
  type InstallerSheet,
} from './photo-install-sheet';

/** Metapodatki fotomontaže, ki jih ponudba nosi s seboj. */
export interface StoredMontage {
  meta: ReplaceMetadata;
}

export interface OfferSheetInfo {
  number: string;
  customerName: string;
  objectAddress?: string | null;
}

export interface OfferSheetResult {
  sheet: InstallerSheet;
  html: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Ali je vrednost vidna kot ReplaceMetadata? Samo oblika — NE vsebina. */
function looksLikeMeta(v: unknown): v is ReplaceMetadata {
  if (!v || typeof v !== 'object') return false;
  const m = v as Partial<ReplaceMetadata>;
  if (typeof m.profileId !== 'string' || !m.profileId) return false;
  if (typeof m.profileLabel !== 'string') return false;
  if (!m.planeCm || typeof m.planeCm !== 'object') return false;
  if (!isNum(m.planeCm.hCm) || m.planeCm.hCm <= 0) return false;
  if (m.planeCm.wCm !== null && !isNum(m.planeCm.wCm)) return false;
  return true;
}

/**
 * Prebere shranjene metapodatke (JSON niz ali že objekt) v `StoredMontage`.
 * Vrne null za vse, kar ni veljavna metapodatkovna struktura — naročilo
 * brez fotomontaže je NORMALNO, ne napaka.
 */
export function parseMontageJson(raw: unknown): StoredMontage | null {
  if (raw === null || raw === undefined) return null;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      data = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as { meta?: unknown };
  if (!looksLikeMeta(o.meta)) return null;
  return { meta: o.meta };
}

/** Serializacija za shranjevanje v bazo (null, če podatka ni). */
export function serializeMontage(m: StoredMontage | null): string | null {
  if (!m) return null;
  return JSON.stringify({ meta: m.meta });
}

/**
 * Zgradi montažni list za ponudbo. Če ponudba nima shranjene fotomontaže,
 * vrne null (lista ni) — ne praznega in ne izmišljenega.
 */
export function buildOfferSheet(
  offer: OfferSheetInfo,
  stored: StoredMontage | null,
  opts: { obrtnik?: string; datum?: string; bayCm?: number; baySource?: BaySource } = {},
): OfferSheetResult | null {
  if (!stored) return null;
  // Razmak stebrov je VNOS MONTERJA ob tisku (meri ali predlog) — v ponudbi
  // ga ne izmišljamo. Brez njega je list blokiran, ne napačen.
  const sheet = buildInstallerSheet({
    meta: stored.meta,
    bayCm: opts.bayCm ?? 0,
    baySource: opts.baySource ?? 'assumed',
  });
  const html = buildInstallerSheetHtml(sheet, {
    datum: opts.datum ?? '',
    obrtnik: opts.obrtnik ?? offer.number,
    objekt: [offer.customerName, offer.objectAddress ?? ''].filter(Boolean).join(' — '),
  });
  return { sheet, html };
}
