// ─── Kandidat #3 iz raziskave Task 63 (docs/task63-podobni-programi.md) ──
// IZMERJENA OBSTOJEČA DESKA → PREDLOG NAJBLIŽJEGA URADNEGA PROFILA.
// Povezuje dva obstoječa sklopa: merjenje po kalibrirani ravnini
// (homography.ts planeDistanceCm) + katalog ROKSAL profilov
// (roksal-assets.ts ROKSAL_PROFILES). Čiste funkcije — brez brskalnika,
// brez AI, deterministično (enaki vhodi → identičen izhod).
//
// ISKRENOST (trdno pravilo): predlog je najbližji profil po ŠIRINI —
// enakost mere NE dokazuje istovetnosti profila (obstoječa ograja je
// lahko drugega proizvajalca). Razlika se VEDNO izpiše; kakovost
// ujemanja (natančno/blizu/različno) ni nikoli skrita; manjkajoči
// podatki so napaka (ne ugibanje).

import { ROKSAL_PROFILES, type RoksalProfile } from './roksal-assets';

/** Meja za "natančno" ujemanje v cm (robovi desk na fotki + napaka merila). */
export const EXACT_MAX_CM = 0.3;
/** Meja za "blizu" kot relativni delež izmerjene širine (10 %). */
export const CLOSE_MAX_PCT = 10;
/** Privzeto št. predlogov. */
export const DEFAULT_TOP_N = 6;

export type SuggestQuality = 'exact' | 'close' | 'far';

export interface ProfileSuggestion {
  profile: RoksalProfile;
  /** |izmerjena − plankCm| v cm (okroženo na 0,1 cm). */
  diffCm: number;
  /** diffCm / izmerjena · 100 (okroženo na 0,1 %). */
  diffPct: number;
  quality: SuggestQuality;
}

export interface ProfileSuggestResult {
  measuredCm: number;
  /** Razvrščeno po diffCm naraščajoče, pri izenačenju po id (deterministično). */
  suggestions: ProfileSuggestion[];
  /** Reprezentant (id) → barvne/oblikovne različice (id-ji) z ISTO postavitveno mero. */
  variants: Record<string, string[]>;
  warnings: string[];
}

export interface SuggestOptions {
  /** Če podano, so predvideni SAMO profili te smeri (privzeto: vse). */
  orientation?: 'horizontal' | 'vertical';
  /** Št. predlogov (privzeto DEFAULT_TOP_N). */
  topN?: number;
}

/** Determinističen izpis števila s slovensko vejico (NI toLocaleString — okoljsko odvisno). */
export function fmtNum(v: number, decimals: number): string {
  return v.toFixed(decimals).replace('.', ',');
}

/** Prag: kakovost ujemanja iz abs. razlike in izmerjene mere. */
export function matchQuality(diffCm: number, measuredCm: number): SuggestQuality {
  if (diffCm <= EXACT_MAX_CM) return 'exact';
  if (diffCm <= (CLOSE_MAX_PCT / 100) * measuredCm) return 'close';
  return 'far';
}

/** Iskren opis predloga (uporablja UI in testi — enoten vir besedila). */
export function suggestionText(s: ProfileSuggestion): string {
  const q =
    s.quality === 'exact'
      ? 'natančno ujemanje'
      : s.quality === 'close'
        ? 'blizu'
        : 'različno';
  return `${q}: razlika ${fmtNum(s.diffCm, 1)} cm (${fmtNum(s.diffPct, 1)} %)`;
}

/**
 * Najbližji profili po širini elementa (plankCm) za izmerjeno desko.
 * - dedup: profili z ISTO postavitveno mero (plankCm + gapCm + smer +
 *   pattern) so EN predlog — reprezentant je prvi po registrskem vrstnem
 *   redu, barvne različice pa so izrecno izpisane v `variants` (iskrenost:
 *   "dekor 2/7 …" ni ločen izdelek, je barvna različica istega profila).
 * - razvrščanje: diffCm naraščajoče, pri izenačenju po id.
 */
export function suggestProfiles(measuredCm: number, opts?: SuggestOptions): ProfileSuggestResult {
  if (!Number.isFinite(measuredCm)) {
    throw new Error('NEZADOSTNI PODATKI: izmerjena širina mora biti končno število.');
  }
  if (measuredCm <= 0) {
    throw new Error('NEZADOSTNI PODATKI: izmerjena širina mora biti pozitivna.');
  }
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  if (!Number.isInteger(topN) || topN < 1 || topN > 42) {
    throw new Error('NEZADOSTNI PODATKI: topN mora biti celo število v [1, 42].');
  }
  const orientation = opts?.orientation ?? null;
  if (orientation !== null && orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error('NEZADOSTNI PODATKI: smer mora biti "horizontal" ali "vertical".');
  }

  const warnings: string[] = [];
  if (measuredCm < 0.3) {
    warnings.push('Izmerjena širina je manjša od najmanjšega elementa (0,3 cm) — preveri merjenje ali kalibracijo.');
  }
  if (measuredCm > 25) {
    warnings.push(
      'Izmerjena širina presega vse elemente programa ROKSAL (največ 15 cm) — preveri, ali si izmeril širino ENE deske in ne celotne polja/ravnine.',
    );
  }

  const pool = orientation
    ? ROKSAL_PROFILES.filter((p) => p.orientation === orientation)
    : ROKSAL_PROFILES;
  if (pool.length === 0) {
    throw new Error(`NEZADOSTNI PODATKI: katalog ne vsebuje profilov smeri "${orientation}".`);
  }

  // razdalje + dedup po postavitveni meri
  const keyOf = (p: RoksalProfile): string => `${p.plankCm}|${p.gapCm}|${p.orientation}|${p.pattern}`;
  const byKey = new Map<string, { rep: RoksalProfile; all: RoksalProfile[] }>();
  for (const p of pool) {
    const k = keyOf(p);
    const cur = byKey.get(k);
    if (cur) cur.all.push(p);
    else byKey.set(k, { rep: p, all: [p] });
  }

  const groups = [...byKey.values()].map(({ rep, all }) => {
    const diff = Math.abs(measuredCm - rep.plankCm);
    const s: ProfileSuggestion = {
      profile: rep,
      diffCm: Math.round(diff * 10) / 10,
      diffPct: Math.round((diff / measuredCm) * 1000) / 10,
      quality: matchQuality(diff, measuredCm),
    };
    return { s, all };
  });

  // deterministično: diff naraščajoče → id
  groups.sort((a, b) => (a.s.diffCm === b.s.diffCm ? a.s.profile.id.localeCompare(b.s.profile.id) : a.s.diffCm - b.s.diffCm));

  const suggestions = groups.slice(0, topN).map((g) => g.s);
  const variants: Record<string, string[]> = {};
  for (const g of groups.slice(0, topN)) {
    variants[g.s.profile.id] = g.all.map((p) => p.id);
  }

  return { measuredCm, suggestions, variants, warnings };
}
