// ─── Faza 4: Večpogled → merilni list (glavni merilni tok) ────
// Determinističen prevod verige 3D razdalj (multiview-core.measureFromPair)
// v PhotoMeasure zapise, ki gredo v MERILNI LIST + kalkulator prek
// obstoječega allMeasures toka (camera-view) — BREZ vzporednega jedra.
//
// Pogodba iskrenosti (docs/MEASUREMENT-BASELINE.md, pravilo 6):
//  - status mere se PRENESE tako, kot ga je vrnil validateMultiView
//    (CALIBRATED samo pri znanem fokusu + referenci, sicer AUTO_SUGGESTED);
//  - metoda je vedno 'multi-view' (sledljivost izvora);
//  - točke so PRAZNE (points: []) — meritve so 3D iz para fotk in NE ležijo
//    na fotki merilnega lista; anotacija bi bila izmišljena;
//  - vsi neuspehi so eksplicitni (nevaliden status → Error), nič tihega.
//
// 0 AI / 0 omrežij / 0 odvisnosti — čiste funkcije.

import type { PhotoMeasure } from '@/lib/camera-types';
import type { MeasurementStatus } from '@/lib/measurement-status';

/** Verzija skripte prevoda (sprememba logike = nova verzija v metapodatkih). */
export const MULTIVIEW_SHEET_VERSION = '1.0.0';

/** Trajni žig, ki spremlja uvoz večpoglednih meritev v merilni list. */
export const MULTIVIEW_SHEET_NOTE =
  'Pomožna meritev iz Večpogleda (triangulacija iz dveh fotk) — za proizvodnjo preveri s trakom ali laserjem.';

/** Statusi, ki jih validateMultiView dejansko vrne za uspešno geometrijo. */
const ALLOWED_STATUSES: readonly MeasurementStatus[] = ['CALIBRATED', 'AUTO_SUGGESTED'];

export interface MultiViewChainToMeasuresInput {
  /** Veriga 3D razdalj iz PairMeasureResult.distancesCm (i, j = indeksi točk 0-based). */
  distancesCm: { i: number; j: number; cm: number }[];
  /** Status pogodbe iz validateMultiView — preneame NESPREMENJEN. */
  status: MeasurementStatus | null;
  /** Predpona id-jev (determinizem v testih) — privzeto 'mv'. */
  idPrefix?: string;
}

/**
 * Veriga 3D razdalj iz Večpogleda → PhotoMeasure zapisi za merilni list.
 * Vsak odsek = ločena 'length' meritev (kalkulator jih samodejno uporabi
 * prek buildPrefillFromMeasures); pri ≥ 2 odsekih še vrstica »skupaj«
 * (dolžina verige po poti — enako kot v JSON poročilu).
 * Prazen vnos → prazna tabela; nevaliden status → EKSPPLICITEN Error.
 */
export function multiViewChainToMeasures(
  input: MultiViewChainToMeasuresInput,
): PhotoMeasure[] {
  const prefix = input.idPrefix ?? 'mv';
  if (input.status === null || !ALLOWED_STATUSES.includes(input.status)) {
    throw new Error(
      `NEZADOSTNI PODATKI: večpogledne meritve imajo status ${String(input.status)} — ` +
        'v merilni list gredo samo CALIBRATED (znan fokus + referenca) ali AUTO_SUGGESTED (validateMultiView).',
    );
  }
  const chain = input.distancesCm ?? [];
  const out: PhotoMeasure[] = chain.map((d, k) => ({
    id: `${prefix}-${k + 1}`,
    label: `Večpogled M${k + 1}–M${k + 2}`,
    kind: 'length',
    points: [], // 3D meritev NE leži na fotki merilnega lista — anotacija bi bila izmišljena
    value: Math.round(d.cm * 10) / 10,
    status: input.status as MeasurementStatus,
    method: 'multi-view',
  }));
  if (chain.length >= 2) {
    const sum = Math.round(chain.reduce((s, d) => s + d.cm, 0) * 10) / 10;
    out.push({
      id: `${prefix}-sum`,
      label: 'Večpogled veriga (skupaj)',
      kind: 'length',
      points: [],
      value: sum,
      status: input.status as MeasurementStatus,
      method: 'multi-view',
    });
  }
  return out;
}
