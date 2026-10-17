import type { CalcResult, CraftInputs, CraftId } from './types';
import { resolveTerasaInputs, terasaProblemShort } from './terasa-inputs';
import { craftProblemShort, resolveCraftInputs, type InputProblem } from './craft-inputs';
import { formatNum } from './format';
import { BOARD_GRADE_KEY, CENIK_BY_KEY, TILE_GRADE_KEY, cenikLine } from './cenik';

// ─── Izračunski pogon ───────────────────────────────────────
// Čiste funkcije za odmerek po posameznih dejavnostih.
// Vsaka vrne vrstice (materijal/delo) za ponudbo + povzetek.
//
// TA POGON NE POZNA CENE. Doslej je poznal 35 njih: 145 €/m za aluminijasto
// ograjo, 520 €/kos za okno, 28 €/m² za montažo terase, 45 €/m² za nadstrešek,
// 32 €/m² za fasado, 65 in 85 €/kos za okna oziroma vrata, `laborRate * 0,85`
// za polaganje ploščic. Nobene od njih ni napisal obrtnik — napisal jo je
// program, ki bo po njej izstavil račun. Od Task 88 naprej kalkulator vrne
// KOLIČINO in ključ v Cenik (`priceKey`), denar pa se pripne šele tam, kjer ga
// vpiše človek. Brez vpisane cene vrstica ostane brez zneska.
//
// Iz istega razloga `laborRate` ni več parameter tega modula: urna postavka
// iz nastavitev je bila doslej vir treh denarnih vrstic (montaža ograje po
// normi 1,0 h/m, montaža stopnic po 0,4 h/kos, polaganje ploščic po 0,85-krat
// urne postavke). Norma ostaja — a samo kot OCENA TRAJANJA v povzetku in
// načrtu montaže, nikoli kot znesek.

const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil = Math.ceil;
/** Monter bere decimalno VEJICO. V stolpcih cen in povzetku je ena sama oblika. */
const nf = (n: number) => formatNum(n, 2);

/** Zavrnjen vnos: ponudba NE zaračuna ničesar, povzetek pa našteje VPISANE
 *  vrednosti. Skupna oblika za vseh sedem dejavnosti, da se besedilo ne more
 *  raziti med kalkulatorji. */
const refusal = (problems: InputProblem[]): CalcResult => ({
  lines: [],
  summary: [{ label: 'Izračun ni opravljen', value: problems.map(craftProblemShort).join(' · ') }],
});

/** Ograje – balkonske in vrtne ograje ter pragovi.
 *  Stebri na vsakih ~1,5 m + vogali; material na meter; steklo po m².
 *  Vpisana višina se NE sme več usekati: `Math.max(0.9, višina)` je iz 0,5 m
 *  naredilo 0,9 m obračuna, monter pa je na zaslonu videl svojo mero. Zunaj
 *  okna vnosa (`craft-inputs.ts`) izračun vrne razlog in ne zaračuna ničesar. */
export function calculateOgraje(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('ograje', input);
  if (!inp.ok) return refusal(inp.problems);
  const length = inp.v.length;
  const height = inp.v.height;
  const gates = inp.v.gates;
  const material = input.material ?? 'alu';

  if (length <= 0) {
    return { lines: [], summary: [{ label: 'Dolžina', value: '0 m' }] };
  }

  const materialKey = material === 'steklo' ? 'ograje.steklo' : material === 'inox' ? 'ograje.inox' : 'ograje.alu';
  const postKey = material === 'inox' ? 'ograje.steber-inox' : 'ograje.steber';

  // Stebri: na vsakih 1,5 m + začetni + končni
  const posts = ceil(length / 1.5) + 1;
  const lines = [
    cenikLine(materialKey, r2(length), `Višina ${nf(height)} m, dolžina ${nf(length)} m`),
    cenikLine(postKey, posts, 'Razmak cca. 1,5 m (predpostavka izračuna, ne ROKSALova meja — ta je odvisna od profila), s pritrdilnim kompletom'),
    cenikLine('ograje.vijaki', r2(length), 'Nerez vijaki, tipli, kemijska sidra'),
    cenikLine('montaza.ograje', r2(length), 'Dva monterja, vključno z izravnavo'),
  ];

  if (material === 'steklo') {
    lines.splice(1, 0, cenikLine(
      'ograje.steklo-plosca',
      r2(length * height),
      `Kaljeno steklo 10 mm, ${nf(length)} m × ${nf(height)} m`,
    ));
  }

  for (let i = 0; i < gates; i++) {
    lines.push(cenikLine(
      'ograje.vrata',
      1,
      'Širina 0,9 m, s tečaji in zapiralom',
    ));
  }

  return {
    lines,
    summary: [
      { label: 'Dolžina ograje', value: `${nf(length)} m` },
      { label: 'Višina', value: `${nf(height)} m` },
      { label: 'Št. stebrov', value: `${posts} + ${gates} prehodov` },
      { label: 'Montaža (ocena trajanja)', value: `${nf(length * 0.5)} h — ni cena` },
    ],
  };
}

/** Stopnice – material stopnic + ograja + montaža.
 *  Privzeta globina stopnice 0,28 m za dolžino ograje.
 *  Vpisana širina se NE sme več usekati: `Math.max(0.6, širina)` je pri 0,4 m
 *  zaračunala 0,6 m, načrt montaže pa je istemu vnosu napisal 0,4 m. */
export function calculateStopnice(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('stopnice', input);
  if (!inp.ok) return refusal(inp.problems);
  let steps = inp.v.steps;
  const width = inp.v.stepWidth;
  const material = input.stepMaterial ?? 'wpc';
  const railingNeeded = input.railingNeeded ?? true;
  const totalRiseCm = inp.v.totalRiseCm;

  // Samodejno št. stopnic iz višinske razlike (ciljna višina stopnice ~17,5 cm)
  let autoSteps = false;
  if (totalRiseCm > 0 && steps === 0) {
    steps = Math.ceil(totalRiseCm / 17.5);
    autoSteps = true;
  }

  // Kontrola koraka — pravilo 2R + G = 60–66 cm. kalkulator pozna R (iz
  // vpisane višinske razlike in števila stopnic), G pa NE: globine stopnice
  // noben vnos ne traži. Zato se izpiše samo razpon G, ki ga pravilo zahteva,
  // in NE lažni odgovor, ali je stopnica udobna.
  const riserCm = totalRiseCm > 0 && steps > 0 ? r2(totalRiseCm / steps) : null;
  const idealGoingCm: [number, number] | null =
    riserCm === null ? null : [r2(60 - 2 * riserCm), r2(66 - 2 * riserCm)];
  const riserOk = riserCm !== null && riserCm >= 15 && riserCm <= 19;

  const railingLength = input.railingLength && input.railingLength > 0
    ? input.railingLength
    : r2(steps * 0.3);

  if (steps <= 0) {
    return { lines: [], summary: [{ label: 'Št. stopnic', value: '0' }] };
  }

  const lines = [
    cenikLine(material === 'hrast' ? 'stopnice.hrast' : 'stopnice.wpc', steps, `Širina ${nf(width)} m`),
    cenikLine('stopnice.konstrukcija', ceil(steps / 3), 'Jekleni nosilci, vključno s pritrditvijo'),
    cenikLine('stopnice.antidrsece', r2(steps * width)),
    cenikLine('montaza.stopnice', r2(steps * 0.4), 'Ocena 0,4 h na stopnico — delovna ura, ne cena'),
  ];

  if (railingNeeded && railingLength > 0) {
    lines.push(
      cenikLine('stopnice.ograda', railingLength, `Dolžina cca. ${nf(railingLength)} m`),
      cenikLine('stopnice.steber', ceil(railingLength / 1.5) + 1, 'Razmak do 1,5 m po naklonu'),
    );
  }

  const summary: CalcResult['summary'] = [
    { label: autoSteps ? 'Št. stopnic (samodejno)' : 'Št. stopnic', value: autoSteps ? `${steps} (iz ${nf(totalRiseCm)} cm razlike)` : `${steps}` },
    { label: 'Širina stopnic', value: `${nf(width)} m` },
    { label: 'Dolžina ograje', value: railingNeeded ? `${nf(railingLength)} m` : '–' },
  ];
  if (riserCm !== null && idealGoingCm !== null) {
    summary.push(
      { label: 'Višina stopnice (R)', value: `${nf(riserCm)} cm${riserOk ? ' ✓' : ' ⚠ priporočilo 15–19 cm'}` },
      { label: 'Pravilo 2R + G', value: `G mora biti ${nf(idealGoingCm[0])}–${nf(idealGoingCm[1])} cm (globine stopnice kalkulator ne pozna)` },
    );
  }

  return {
    lines,
    summary,
  };
}

/** Keramika – tla (+ stene): ploščice z rezervo po VZORCU, grunt, lepilo, fuga, prižice, montaža.
 *  Lepilo: cca. 4 kg/m²; fuga: cca. 0,4 kg/m².
 *  Odpadek po vzorcu (izkušnje izvajalcev): ravno 10 %, diagonalno 15 %, ribja kost 18 %.
 *  Vpisanega cena in rezerva se NE smeta več usekati (`Math.max(1, cena)` in
 *  `Math.min(30, rezerva)`): ponudba je zaračunavala drugačno rezervo kot
 *  načrt montaže, ki je isto število bral dobesedno. */
export function calculateKeramika(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('keramika', input);
  if (!inp.ok) return refusal(inp.problems);
  const floorLength = inp.v.floorLength;
  const floorWidth = inp.v.floorWidth;
  const wallHeight = inp.v.wallHeight;
  const tileGrade = input.tileGrade ?? 'std';
  const pattern = input.tilePattern ?? 'ravno';
  const patternLabel = pattern === 'diagonalno' ? 'diagonalno' : pattern === 'ribja-kost' ? 'ribja kost' : 'ravno';
  const patternReserve = pattern === 'diagonalno' ? 15 : pattern === 'ribja-kost' ? 18 : 10;
  const reservePercent = inp.v.reservePercent;
  const reserve = reservePercent / 100;

  const floorArea = r2(floorLength * floorWidth);
  // stene: obseg prostora × višina (samo če uporabnik vpiše višino > 0)
  const perimeter = 2 * (floorLength + floorWidth);
  const wallArea = r2(perimeter * wallHeight);
  const totalArea = r2(floorArea + wallArea);

  if (totalArea <= 0) {
    return { lines: [], summary: [{ label: 'Površina', value: '0 m²' }] };
  }

  const tilesWithReserve = r2(totalArea * (1 + reserve));
  const glueBags = ceil((totalArea * 4) / 25);
  const groutKg = r2(totalArea * 0.4);
  const spacers = ceil(totalArea / 20);

  const lines = [
    cenikLine(
      TILE_GRADE_KEY[tileGrade],
      tilesWithReserve,
      `Tla ${nf(floorArea)} m²${wallArea > 0 ? ` + stene ${nf(wallArea)} m²` : ''}, ${patternLabel}, rezerva ${nf(reservePercent)} %`,
    ),
    cenikLine('keramika.grunt', Math.ceil(totalArea / 30), '1 kos (5 l) ≈ 30 m² — najpogosteje preskočen korak, brez njega ploščice odpadejo'),
    cenikLine('keramika.lepilo', glueBags, 'Ocena 4 kg/m²'),
    cenikLine('keramika.fuga', groutKg, 'Ocena 0,4 kg/m²'),
    cenikLine('keramika.prizice', spacers),
    cenikLine('keramika.silikon', ceil(perimeter / 10), 'Robovi in prehodi'),
    cenikLine('keramika.hidroizolacija', totalArea, 'Dvakratni nanos z trakovi (mokri prostori)'),
    cenikLine('montaza.keramika', totalArea),
  ];

  return {
    lines,
    summary: [
      { label: 'Tla', value: `${nf(floorArea)} m²` },
      { label: 'Stene', value: wallArea > 0 ? `${nf(wallArea)} m²` : '–' },
      {
        label: `Vzorec (${patternLabel})`,
        value: reservePercent >= patternReserve
          ? `odpadek ${nf(reservePercent)} %`
          : `odpadek ${nf(reservePercent)} % — za ta vzorec je priporočljivo ≥ ${patternReserve} %`,
      },
      { label: 'Skupaj z rezervo', value: `${nf(tilesWithReserve)} m²` },
      { label: 'Lepilo', value: `${glueBags} vrečk` },
    ],
  };
}

/** WPC terasa – deske glede na smer polaganja, nosilci na vpisani razmak, skrite kljukice.
 *  Dilatacijske reže (stranska in čelna) in deterministični rezalni načrt — koliko
 *  nabavnih desk je treba naročiti (z odpadkom), koliko rezov in koliko se
 *  odpadek lahko izkoristi s premaknjenimi spoji.
 *  Vpisan razmak se NE sme več usekati (glej `terasa-inputs.ts`): zunaj okna
 *  vnosa izračun vrne razlog in ne zaračuna ničesar, znotraj okna pa računa
 *  točno tako, kot je vpisano. */
export function calculateWpcTerasa(input: CraftInputs): CalcResult {
  if ((input.deckLength ?? 0) <= 0 || (input.deckWidth ?? 0) <= 0) {
    return { lines: [], summary: [{ label: 'Površina', value: '0 m²' }] };
  }

  const inp = resolveTerasaInputs(input);
  if (!inp.ok) {
    return {
      lines: [],
      summary: [{ label: 'Izračun ni opravljen', value: inp.problems.map(terasaProblemShort).join(' · ') }],
    };
  }

  const L = inp.v.deckLength;
  const W = inp.v.deckWidth;
  const spacing = inp.v.joistSpacing;
  const boardGrade = input.boardGrade ?? 'klasicna';
  const sideGapMm = inp.v.sideGapMm;
  const endGapMm = inp.v.endGapMm;
  const boardStock = inp.v.boardLengthM;
  const sideGapM = sideGapMm / 1000;
  const endGapM = endGapMm / 1000;

  const area = r2(L * W);
  // deske tečejo vzdolž dolžine L: vrste = W / (0,14 deska + stranska reža)
  const boardRows = Math.max(1, ceil(W / (0.14 + sideGapM)));
  const boardUsedLM = r2(boardRows * L);
  // nosilci pravokotno na deske: po dolžini L na vsak `spacing` m
  const joistCount = ceil(L / spacing) + 1;
  const joistLM = r2(joistCount * W);
  const clips = ceil(boardRows * joistCount * 2);
  const perimeter = r2(2 * (L + W));

  // ── Rezalni načrt (determinističen, KONZERVATIVEN) ─────────
  // Vsaka vrsta pokrije L; nabavna deska je boardStock; med segmenti čelna reža.
  // Rezultat je zgornja meja nabave (varno — nikoli ne podnaročiš). Ostanki
  // ≥ 0,4 m se lahko s premaknjenimi spoji izkoristijo — prikazani kot prihranek.
  const minUsable = 0.4;
  let fullBoards = 0;      // nabavne deske
  let cuts = 0;            // skupno št. rezov
  let offcutsUsable = 0;   // m ostankov ≥ 0,4 m (kandidati za premaknjene spoje)

  for (let row = 0; row < boardRows; row++) {
    let remaining = L;
    while (remaining > 0.001) {
      if (remaining <= boardStock + endGapM) {
        // zadnji del vrste — en rez iz nabavne deske
        const offcut = r2(boardStock - remaining);
        cuts += offcut > 0.001 ? 1 : 0;
        fullBoards += 1;
        if (offcut >= minUsable) offcutsUsable = r2(offcutsUsable + offcut);
        remaining = 0;
      } else {
        // polna deska v celoti — brez reza; nadaljujemo z ostankom vrste
        fullBoards += 1;
        remaining = r2(remaining - (boardStock + endGapM));
      }
    }
  }
  const purchasedLM = r2(fullBoards * boardStock);
  const wastePct = purchasedLM > 0 ? Math.round(((purchasedLM - boardUsedLM) / purchasedLM) * 100) : 0;
  const cutsLabel = `${fullBoards} deska · ${cuts} rezov · odpadek ${wastePct} %`;

  const lines = [
    cenikLine(
      BOARD_GRADE_KEY[boardGrade],
      purchasedLM,
      `${boardRows} vrst, izkoriščeno ${boardUsedLM} lm · nabava ${purchasedLM} lm (${fullBoards} deska po ${boardStock} m)`,
    ),
    cenikLine('terasa.nosilci', joistLM, `Razmak ${nf(spacing * 100)} cm`),
    cenikLine('terasa.kljukice', clips, 'Enakomerni razmak — slabo privite sponke so najpogostejša napaka'),
    cenikLine('terasa.profil', perimeter, `Obod ${perimeter} m · od stene puščamo 15–20 mm režo`),
    cenikLine('terasa.vijaki', ceil(joistLM * 1.5)),
    cenikLine('montaza.terasa', area),
  ];

  return {
    lines,
    summary: [
      { label: 'Površina terase', value: `${nf(area)} m²` },
      { label: 'Dilatacija', value: `str. ${sideGapMm} mm · čelna ${endGapMm} mm` },
      { label: 'Deske', value: `${boardUsedLM} lm (${boardRows} vrst)` },
      { label: 'Rezalni načrt', value: cutsLabel },
      { label: 'Nosilci', value: `${joistLM} lm (${joistCount} kosov)` },
      { label: 'Kljukice', value: `${clips} kosov` },
      ...(offcutsUsable > 0
        ? [{ label: 'Prihranek z ostanki', value: `do ${offcutsUsable} lm (premaknjeni spoji)` }]
        : []),
    ],
  };
}

/** Okna in vrata – števec kosov z montažo in odstranitvijo.
 *  Vpisana velikost okna se NE sme več usekati na 0,5 m². */
export function calculateOknaVrata(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('okna-vrata', input);
  if (!inp.ok) return refusal(inp.problems);
  const windows = inp.v.windowCount;
  const windowSize = inp.v.windowSize;
  const material = input.windowMaterial ?? 'pvc';
  const doors = inp.v.doorCount;
  const removeOld = input.removeOld ?? true;

  if (windows === 0 && doors === 0) {
    return { lines: [], summary: [{ label: 'Količina', value: '0 kosov' }] };
  }

  const lines: CalcResult['lines'] = [];

  if (windows > 0) {
    lines.push(
      cenikLine(
        material === 'alu' ? 'okna.alu' : 'okna.pvc',
        windows,
        `3-slojno steklo, povprečna velikost ${nf(windowSize)} m²`,
      ),
      cenikLine('montaza.okna', windows),
    );
  }
  if (doors > 0) {
    lines.push(
      cenikLine('vrata.zunanja', doors),
      cenikLine('montaza.vrata', doors),
    );
  }
  if (removeOld && windows + doors > 0) {
    lines.push(cenikLine('okna.demontaza', windows + doors));
  }
  lines.push(cenikLine('okna.zatesnitev', windows + doors, 'PS pena, parna zapora, okrasne letve'));

  return {
    lines,
    summary: [
      { label: 'Okna', value: `${windows} kosov (${nf(windows * windowSize)} m²)` },
      { label: 'Vrata', value: `${doors} kosov` },
      { label: 'Material', value: material === 'alu' ? 'Aluminij' : 'PVC' },
    ],
  };
}

/** Nadstrešek – kritina z 10 % preklopom, konstrukcija, stebri, odvod.
 *  Vpisanega števila stebrov se NE sme več usekati na 2: 0 stebrov je
 *  veljavna izvedba (konstrukcija sidrana na zid). */
export function calculateNadstresek(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('nadstreški', input);
  if (!inp.ok) return refusal(inp.problems);
  const W = inp.v.canopyWidth;
  const D = inp.v.canopyDepth;
  const cover = input.canopyCover ?? 'ploc';
  const posts = inp.v.canopyPosts;
  const drain = input.waterDrain ?? true;

  if (W <= 0 || D <= 0) {
    return { lines: [], summary: [{ label: 'Površina', value: '0 m²' }] };
  }

  const area = r2(W * D);
  const coverKey = cover === 'steklo' ? 'nadstresek.kritina-steklo'
    : cover === 'polikar' ? 'nadstresek.kritina-polikar'
      : 'nadstresek.kritina-ploc';
  const coverName = CENIK_BY_KEY[coverKey].name.replace(/^Kritina: /, '');

  const lines = [
    cenikLine('nadstresek.konstrukcija', area, 'Pocinkano jeklo, razpon ' + nf(W) + ' m'),
    cenikLine(coverKey, r2(area * 1.1), '10 % za preklope in odpad'),
    cenikLine('nadstresek.steber', posts, 'Z bazo za betoniranje'),
  ];

  if (drain) {
    lines.push(cenikLine('nadstresek.odvod', r2(W), 'Odvodni žleb + cev po sprednji strani'));
  }
  lines.push(cenikLine('montaza.nadstresek', area, 'Vključno z betoniranjem stebrov'));

  return {
    lines,
    summary: [
      { label: 'Površina', value: `${nf(area)} m² (${nf(W)} × ${nf(D)} m)` },
      { label: 'Kritina', value: coverName },
      { label: 'Stebri', value: `${posts} kosov` },
    ],
  };
}

/** Fasada – neto površina minus odprtine; letve ~2,5 lm/m² (razmak 40 cm).
 *  Stari `Math.max(0, bruto − odprtine)` je iz napačne izmere naredil nič neto
 *  površine in PRAZNO ponudbo brez razloga; zdaj resolver pove, da odprtine
 *  presegajo celeno steno, in ničesar ne zaračuna. */
export function calculateFasada(input: CraftInputs): CalcResult {
  const inp = resolveCraftInputs('fasada', input);
  if (!inp.ok) return refusal(inp.problems);
  const perimeter = inp.v.facadePerimeter;
  const height = inp.v.facadeHeight;
  const openings = inp.v.openingsM2;
  const cladding = input.cladding ?? 'wpc';

  const gross = perimeter * height;
  const net = r2(gross - openings);

  if (net <= 0) {
    return { lines: [], summary: [{ label: 'Površina fasade', value: '0 m²' }] };
  }

  const claddingKey = cladding === 'les' ? 'fasada.obloga-les'
    : cladding === 'ploc' ? 'fasada.obloga-ploc'
      : 'fasada.obloga-wpc';
  const battensLM = r2(net * 2.5);

  const lines = [
    cenikLine(claddingKey, r2(net * 1.05), `Neto površina ${nf(net)} m² (odprtine −${nf(openings)} m²), 5 % odpad`),
    cenikLine('fasada.letve', battensLM, 'Razmak 40 cm, vključno z vijačevjem'),
    cenikLine('fasada.profili', ceil(perimeter / 2)),
    cenikLine('montaza.fasada', net),
  ];

  return {
    lines,
    summary: [
      { label: 'Bruto površina', value: `${nf(gross)} m²` },
      { label: 'Odprtine', value: `−${nf(openings)} m²` },
      { label: 'Neto površina', value: `${nf(net)} m²` },
      { label: 'Letve', value: `${nf(battensLM)} lm` },
    ],
  };
}

const CALCULATORS: Record<CraftId, (i: CraftInputs) => CalcResult> = {
  'ograje': calculateOgraje,
  'stopnice': calculateStopnice,
  'keramika': calculateKeramika,
  'wpc-terasa': calculateWpcTerasa,
  'okna-vrata': calculateOknaVrata,
  'nadstreški': calculateNadstresek,
  'fasada': calculateFasada,
};

/** Kalkulator vrne SAMO količine. Denar se pripne z `applyCenik`. */
export function runCalculator(craft: CraftId, input: CraftInputs): CalcResult {
  return CALCULATORS[craft](input);
}

/** Vsota po VPISANIH cenah. Vrstica brez cene v vsoto ne sme priti kot 0 —
 *  to je bil doslej `unitPrice ?? 0`. Namesto tega vrne število vrstic brez
 *  cene, da zaslon in dokument lahko rečeta, kaj manjka. */
export function calcTotals(
  items: readonly { quantity: number; unitPrice: number | null }[],
  vatRate: number,
): { subtotal: number; vatAmount: number; total: number; unpriced: number } {
  const priced = items.filter((i) => i.unitPrice !== null && Number.isFinite(i.unitPrice));
  const subtotal = r2(priced.reduce((s, i) => s + i.quantity * (i.unitPrice as number), 0));
  const vatAmount = r2(subtotal * (vatRate / 100));
  const total = r2(subtotal + vatAmount);
  return { subtotal, vatAmount, total, unpriced: items.length - priced.length };
}
