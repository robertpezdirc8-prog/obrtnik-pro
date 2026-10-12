// ─── Snemalni vodič: kurirani seznami posnetkov po dejavnosti ──
// Deterministična vsebina (0 AI). Iz raziskave: Hover vodi uporabnika
// okoli objekta posnetek po posnetek; kakovostne fotke (cel objekt,
// podrobnosti, referenca, mere) so osnova za točno analizo in odmerek.

import type { CraftCategory } from './camera-types';

export interface CaptureShot {
  id: string;
  label: string;
  hint: string;
}

export const CAPTURE_GUIDES: Record<CraftCategory, CaptureShot[]> = {
  ograje: [
    { id: 'pregled', label: 'Cela ograja od spredaj', hint: 'Stoj sredi vrta — cel objekt v okviru + referenca (vrata, okno).' },
    { id: 'kot', label: 'Stranski kot', hint: 'Vidi se višina in konce odsekov — za pravilen odmerek dolžin.' },
    { id: 'vrata', label: 'Vrata / vstop posebej', hint: 'Širina krila, tečaji, zaklep — vrata se odmerjajo ločeno.' },
    { id: 'stebri', label: 'Podrobnost stebra in pritrditve', hint: 'Blizu, da so vijaki in prijem jasno vidni.' },
    { id: 'mere', label: 'Fotografija merilnega traku', hint: 'Trak na kritični dolžini (razpon, višina) — zanesljiv zapis.' },
  ],
  stopnice: [
    { id: 'spodaj', label: 'Celo stopnišče od spodaj', hint: 'Vidna višinska razlika in smer vzpona.' },
    { id: 'zgoraj', label: 'Pogled od zgoraj (ustje)', hint: 'Kako stopnice ustjajo na nadstropje — odmik od stene.' },
    { id: 'stopnica', label: 'Podrobnost stopnice z trakom', hint: 'Višina ene stopnice in globina tekalnice.' },
    { id: 'rocag', label: 'Ročaj / ograja stopnic', hint: 'Prijem, višina ročaja, pritrditve.' },
    { id: 'razlika', label: 'Višinska razlika s trakom', hint: 'Od tal do ustja — najpomembnejša mera za odmerek.' },
  ],
  keramika: [
    { id: 'soba', label: 'Celotna soba iz vogala', hint: 'Vse stene + tla v enem kadiru — obseg del.' },
    { id: 'tla', label: 'Tla od zgoraj', hint: 'Razpored, smer polaganja, obstoječe fuge.' },
    { id: 'stene', label: 'Stene / tuš kabina', hint: 'Obloge, nakloni, sifoni — za m² sten.' },
    { id: 'fuge', label: 'Podrobnost fuge in obloge', hint: 'Širina fuge, tip keramike — izbira materiala.' },
    { id: 'nivo', label: 'Prag / nivo tal', hint: 'Prehodi, višinske razlike, kritična mesta.' },
  ],
  'wpc-terasa': [
    { id: 'cela', label: 'Celotna terasa', hint: 'Rogi in robovi vidni — za m² in št. desk.' },
    { id: 'prag', label: 'Priključek na hišo / prag', hint: 'Višina praga, smer deske, dilatacija od stene.' },
    { id: 'konstrukcija', label: 'Podkonstrukcija (če vidna)', hint: 'Razmak nosilcev, pritrditev — montažni načrt.' },
    { id: 'deska', label: 'Podrobnost deske s sponkami', hint: 'Širina deske, skriti pritrdilni sistem.' },
    { id: 'robovi', label: 'Robovi in zaključki', hint: 'Zaščitni profili, stopnice, pragi.' },
  ],
  'okna-vrata': [
    { id: 'zunaj', label: 'Objekt od zunaj', hint: 'Celotno okno/vrata v okviru + referenca.' },
    { id: 'znotraj', label: 'Objekt od znotraj', hint: 'Odmik, prag, obod vgradnje.' },
    { id: 'odpiranje', label: 'Odprto krilo', hint: 'Tip odpiranja (levo/desno, nagib) — za izdelavo.' },
    { id: 'okvir', label: 'Podrobnost okvirja / ročaja', hint: 'Profil, barva, kovanje.' },
    { id: 'prag', label: 'Prag in podlaga', hint: 'Stanje podlage — pogosto skriti dodaten del.' },
  ],
  nadstreški: [
    { id: 'procelje', label: 'Celoten pročelje z nadstreškom', hint: 'Širina in višina pokritega prostora.' },
    { id: 'spodaj', label: 'Pogled od spodaj', hint: 'Kritina, nosilci, razsvetljava.' },
    { id: 'pritrditve', label: 'Pritrditve na steno', hint: 'Konzole, sidra — nosilnost.' },
    { id: 'profil', label: 'Stranski profil (naklon)', hint: 'Naklon kritine — za odvod vode.' },
    { id: 'mere', label: 'Širina × izrastek s trakom', hint: 'Ključni meri za statiko in ponudbo.' },
  ],
  fasada: [
    { id: 'celo', label: 'Celo pročelje (2–3 m nazaj)', hint: 'Celoten obseg + referenca (okno, vrata).' },
    { id: 'poskodbe', label: 'Poškodbe / madeži podrobno', hint: 'Pogoj obstoječe prevleke — podlaga za pripravo.' },
    { id: 'vogal', label: 'Vogal in struktura obloge', hint: 'Tip fasade (_demit_, les, plošče).' },
    { id: 'odprtja', label: 'Okna/vrata — obod', hint: 'Odmiki, okenske police, zaboji.' },
    { id: 'etaza', label: 'Višina etaže s trakom', hint: 'Referenca za m² pročelja.' },
  ],
  drugo: [
    { id: 'pregled', label: 'Pregled objekta', hint: 'Širši kader z referenco za merilo.' },
    { id: 'podrobnost', label: 'Podrobnost problema', hint: 'Kar želiš popraviti/zamenjati — blizu.' },
    { id: 'referenca', label: 'Referenčni objekt', hint: 'Vrata, okno, ploščica — za umerjanje mer.' },
    { id: 'dostop', label: 'Dostop in okolica', hint: 'Stopnice, dvigalo, omejitve — za logistiko montaže.' },
  ],
};

export const GUIDE_CRAFTS: CraftCategory[] = [
  'ograje', 'stopnice', 'keramika', 'wpc-terasa', 'okna-vrata', 'nadstreški', 'fasada', 'drugo',
];

const LS_KEY = 'obrtnik-vodnik';

type GuideState = Record<string, Record<string, boolean>>;

function readState(): GuideState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as GuideState) : {};
  } catch {
    return {};
  }
}

function writeState(state: GuideState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* privatni način — ni kritično */
  }
}

export function loadGuideDone(craft: CraftCategory): Record<string, boolean> {
  return readState()[craft] ?? {};
}

export function toggleGuideShot(craft: CraftCategory, shotId: string): Record<string, boolean> {
  const state = readState();
  const cur = state[craft] ?? {};
  const next = { ...cur, [shotId]: !cur[shotId] };
  state[craft] = next;
  writeState(state);
  return next;
}

export function resetGuideShots(craft: CraftCategory): Record<string, boolean> {
  const state = readState();
  state[craft] = {};
  writeState(state);
  return {};
}
