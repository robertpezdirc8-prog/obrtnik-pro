import type { CalcResult, CraftInputs, CraftId } from './types';

// ─── Izračunski pogon ───────────────────────────────────────
// Čiste funkcije za odmerek po posameznih dejavnostih.
// Vsaka vrne vrstice (materijal/delo) za ponudbo + povzetek.

const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil = Math.ceil;

/** Ograje – balkonske in vrtne ograje ter pragovi.
 *  Stebri na vsakih ~1,5 m + vogali; material na meter; steklo po m². */
export function calculateOgraje(input: CraftInputs, laborRate: number): CalcResult {
  const length = Math.max(0, input.length ?? 0);
  const height = Math.max(0.9, input.height ?? 1.0);
  const material = input.material ?? 'alu';
  const gates = Math.max(0, input.gates ?? 0);

  if (length <= 0) {
    return { lines: [], summary: [{ label: 'Dolžina', value: '0 m' }] };
  }

  // Stebri: na vsakih 1,5 m + začetni + končni
  const posts = ceil(length / 1.5) + 1;
  const lines = [
    {
      name: material === 'steklo' ? 'Steklena ograja (kaljeno 10 mm)' : material === 'inox' ? 'Inox ograja (cev 42,4 mm)' : 'Aluminijasta ograja',
      description: `Višina ${r2(height)} m, dolžina ${r2(length)} m`,
      quantity: r2(length),
      unit: 'm',
      unitPrice: material === 'steklo' ? 240 : material === 'inox' ? 165 : 145,
    },
    {
      name: 'Stebri',
      description: 'Razmak cca. 1,5 m, s pritrdilnim kompletom',
      quantity: posts,
      unit: 'kos',
      unitPrice: material === 'inox' ? 52 : 38,
    },
    {
      name: 'Vijačevje in pritrdilni material',
      description: 'Nerez vijaki, tipli, kemijska sidra',
      quantity: r2(length),
      unit: 'kompl/m',
      unitPrice: 12,
    },
    {
      name: 'Montaža ograje',
      description: 'Dva monterja, vključno z izravnavo',
      quantity: r2(length),
      unit: 'm',
      unitPrice: 35,
    },
  ];

  if (material === 'steklo') {
    lines.splice(1, 0, {
      name: 'Steklene plošče',
      description: `Kaljeno steklo 10 mm, ${r2(length)} m × ${r2(height)} m`,
      quantity: r2(length * height),
      unit: 'm²',
      unitPrice: 130,
    });
  }

  for (let i = 0; i < gates; i++) {
    lines.push({
      name: 'Oključljivi prehod (vrata)',
      description: 'Širina 0,9 m, s tečaji in zapiralom',
      quantity: 1,
      unit: 'kos',
      unitPrice: 220,
    });
  }

  return {
    lines,
    summary: [
      { label: 'Dolžina ograje', value: `${r2(length)} m` },
      { label: 'Višina', value: `${r2(height)} m` },
      { label: 'Št. stebrov', value: `${posts} + ${gates} prehodov` },
      { label: 'Montaža (ocena)', value: `${r2(length * 0.5)} h` },
    ],
  };
}

/** Stopnice – material stopnic + ograja + montaža.
 *  Privzeta globina stopnice 0,28 m za dolžino ograje. */
export function calculateStopnice(input: CraftInputs, laborRate: number): CalcResult {
  const steps = Math.max(0, input.steps ?? 0);
  const width = Math.max(0.6, input.stepWidth ?? 1.0);
  const material = input.stepMaterial ?? 'wpc';
  const railingNeeded = input.railingNeeded ?? true;
  const railingLength = input.railingLength && input.railingLength > 0
    ? input.railingLength
    : r2(steps * 0.3);

  if (steps <= 0) {
    return { lines: [], summary: [{ label: 'Št. stopnic', value: '0' }] };
  }

  const lines = [
    {
      name: material === 'hrast' ? 'Stopnica hrast masiv 40 mm' : 'Stopnica WPC 25×160 mm',
      description: `Širina ${r2(width)} m`,
      quantity: steps,
      unit: 'kos',
      unitPrice: material === 'hrast' ? 95 : 48,
    },
    {
      name: 'Nosilna konstrukcija stopnic',
      description: 'Jekleni nosilci, vključno s pritrditvijo',
      quantity: ceil(steps / 3),
      unit: 'kos',
      unitPrice: 120,
    },
    {
      name: 'Antidrseči profili',
      quantity: r2(steps * width),
      unit: 'm',
      unitPrice: 6,
    },
    {
      name: 'Montaža stopnic',
      quantity: r2(steps * 0.4),
      unit: 'ura',
      unitPrice: laborRate,
    },
  ];

  if (railingNeeded && railingLength > 0) {
    lines.push(
      {
        name: 'Ograja na stopnicah (aluminij)',
        description: `Dolžina cca. ${r2(railingLength)} m`,
        quantity: railingLength,
        unit: 'm',
        unitPrice: 145,
      },
      {
        name: 'Stebri za stopniščno ograjo',
        description: 'Razmak do 1,5 m po naklonu',
        quantity: ceil(railingLength / 1.5) + 1,
        unit: 'kos',
        unitPrice: 38,
      },
    );
  }

  return {
    lines,
    summary: [
      { label: 'Št. stopnic', value: `${steps}` },
      { label: 'Širina stopnic', value: `${r2(width)} m` },
      { label: 'Dolžina ograje', value: railingNeeded ? `${r2(railingLength)} m` : '–' },
    ],
  };
}

/** Keramika – tla (+ stene): ploščice z rezervo, lepilo, fuga, prižice, montaža.
 *  Lepilo: cca. 4 kg/m²; fuga: cca. 0,4 kg/m². */
export function calculateKeramika(input: CraftInputs, laborRate: number): CalcResult {
  const floorLength = Math.max(0, input.floorLength ?? 0);
  const floorWidth = Math.max(0, input.floorWidth ?? 0);
  const wallHeight = Math.max(0, input.wallHeight ?? 0);
  const tilePrice = Math.max(1, input.tilePricePerM2 ?? 24);
  const reserve = Math.min(30, Math.max(0, input.reservePercent ?? 10)) / 100;

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
    {
      name: 'Keramične ploščice',
      description: `Tla ${r2(floorArea)} m²${wallArea > 0 ? ` + stene ${r2(wallArea)} m²` : ''}, rezerva ${Math.round(reserve * 100)} %`,
      quantity: tilesWithReserve,
      unit: 'm²',
      unitPrice: tilePrice,
    },
    {
      name: 'Lepilo (flex C2TE S1, 25 kg)',
      description: 'Ocena 4 kg/m²',
      quantity: glueBags,
      unit: 'vrečka',
      unitPrice: 14,
    },
    {
      name: 'Fuga',
      description: 'Ocena 0,4 kg/m²',
      quantity: groutKg,
      unit: 'kg',
      unitPrice: 2.2,
    },
    {
      name: 'Križci / prižice',
      quantity: spacers,
      unit: 'paket',
      unitPrice: 4,
    },
    {
      name: 'Silikon za dilatacije',
      description: 'Robovi in prehodi',
      quantity: ceil(perimeter / 10),
      unit: 'kos',
      unitPrice: 9,
    },
    {
      name: 'Hidroizolacija',
      description: 'Dvakratni nanos z trakovi (mokri prostori)',
      quantity: totalArea,
      unit: 'm²',
      unitPrice: 12,
    },
    {
      name: 'Polaganje ploščic',
      quantity: totalArea,
      unit: 'm²',
      unitPrice: laborRate * 0.85,
    },
  ];

  return {
    lines,
    summary: [
      { label: 'Tla', value: `${r2(floorArea)} m²` },
      { label: 'Stene', value: wallArea > 0 ? `${r2(wallArea)} m²` : '–' },
      { label: 'Skupaj z rezervo', value: `${tilesWithReserve} m²` },
      { label: 'Lepilo', value: `${glueBags} vrečk` },
    ],
  };
}

/** WPC terasa – deske glede na smer polaganja, nosilci na 0,4 m, skrite kljukice. */
export function calculateWpcTerasa(input: CraftInputs, laborRate: number): CalcResult {
  const L = Math.max(0, input.deckLength ?? 0);
  const W = Math.max(0, input.deckWidth ?? 0);
  const spacing = Math.min(0.6, Math.max(0.3, input.joistSpacing ?? 0.4));
  const boardPrice = Math.max(1, input.boardPricePerM ?? 12.5);

  if (L <= 0 || W <= 0) {
    return { lines: [], summary: [{ label: 'Površina', value: '0 m²' }] };
  }

  const area = r2(L * W);
  // deske tečejo vzdolž krajše strani (po širini W): vrste = W / (0,14 deska + 0,005 razmak)
  const boardRows = ceil(W / 0.145);
  const boardLM = r2(boardRows * L);
  // nosilci pravokotno na deske: po dolžini L na vsak `spacing` m
  const joistCount = ceil(L / spacing) + 1;
  const joistLM = r2(joistCount * W);
  const clips = ceil(boardRows * joistCount * 2);
  const perimeter = r2(2 * (L + W));

  const lines = [
    {
      name: 'Terasna deska WPC (polna 25×140)',
      description: `${boardRows} vrst po ${r2(L)} m, razmak 5 mm`,
      quantity: boardLM,
      unit: 'm',
      unitPrice: boardPrice,
    },
    {
      name: 'Nosilci WPC/ALU',
      description: `Razmak ${r2(spacing * 100)} cm`,
      quantity: joistLM,
      unit: 'm',
      unitPrice: 5.5,
    },
    {
      name: 'Skrite spojne kljukice',
      quantity: clips,
      unit: 'kos',
      unitPrice: 0.8,
    },
    {
      name: 'Zaključni profil (obod)',
      quantity: perimeter,
      unit: 'm',
      unitPrice: 6,
    },
    {
      name: 'Vijačevje za podlago',
      quantity: ceil(joistLM * 1.5),
      unit: 'kos',
      unitPrice: 1.2,
    },
    {
      name: 'Montaža terase',
      quantity: area,
      unit: 'm²',
      unitPrice: 28,
    },
  ];

  return {
    lines,
    summary: [
      { label: 'Površina terase', value: `${area} m²` },
      { label: 'Deske', value: `${boardLM} lm (${boardRows} vrst)` },
      { label: 'Nosilci', value: `${joistLM} lm (${joistCount} kosov)` },
      { label: 'Kljukice', value: `${clips} kosov` },
    ],
  };
}

/** Okna in vrata – števec kosov z montażo in odstranitvijo. */
export function calculateOknaVrata(input: CraftInputs, laborRate: number): CalcResult {
  const windows = Math.max(0, input.windowCount ?? 0);
  const windowSize = Math.max(0.5, input.windowSize ?? 2);
  const material = input.windowMaterial ?? 'pvc';
  const doors = Math.max(0, input.doorCount ?? 0);
  const removeOld = input.removeOld ?? true;

  if (windows === 0 && doors === 0) {
    return { lines: [], summary: [{ label: 'Količina', value: '0 kosov' }] };
  }

  const windowPrice = material === 'alu' ? 520 : windows > 0 ? 210 : 0;
  const lines: CalcResult['lines'] = [];

  if (windows > 0) {
    lines.push({
      name: material === 'alu' ? 'Okno aluminij (na mero)' : 'Okno PVC (na mero)',
      description: `3-slojno steklo, povprečna velikost ${r2(windowSize)} m²`,
      quantity: windows,
      unit: 'kos',
      unitPrice: material === 'alu' ? 520 : 210,
    });
    lines.push({
      name: 'Montaža oken',
      quantity: windows,
      unit: 'kos',
      unitPrice: 65,
    });
  }
  if (doors > 0) {
    lines.push(
      {
        name: 'Zunanja vrata PVC',
        quantity: doors,
        unit: 'kos',
        unitPrice: 580,
      },
      {
        name: 'Montaža vrat',
        quantity: doors,
        unit: 'kos',
        unitPrice: 85,
      },
    );
  }
  if (removeOld && windows + doors > 0) {
    lines.push({
      name: 'Odstranitev in odvoz starih odprtij',
      quantity: windows + doors,
      unit: 'kos',
      unitPrice: 25,
    });
  }
  lines.push({
    name: 'Zatesnitev in obdelava odprtij',
    description: 'PS penne, parna zapora, okrasni letvi',
    quantity: windows + doors,
    unit: 'kos',
    unitPrice: 18,
  });

  return {
    lines,
    summary: [
      { label: 'Okna', value: `${windows} kosov (${r2(windows * windowSize)} m²)` },
      { label: 'Vrata', value: `${doors} kosov` },
      { label: 'Material', value: material === 'alu' ? 'Aluminij' : 'PVC' },
    ],
  };
}

/** Nadstrešek – kritina z 10 % preklopom, konstrukcija, stebri, odvod. */
export function calculateNadstresek(input: CraftInputs, laborRate: number): CalcResult {
  const W = Math.max(0, input.canopyWidth ?? 0);
  const D = Math.max(0, input.canopyDepth ?? 0);
  const cover = input.canopyCover ?? 'ploc';
  const posts = Math.max(2, input.canopyPosts ?? 2);
  const drain = input.waterDrain ?? true;

  if (W <= 0 || D <= 0) {
    return { lines: [], summary: [{ label: 'Površina', value: '0 m²' }] };
  }

  const area = r2(W * D);
  const coverPrice = cover === 'steklo' ? 68 : cover === 'polikar' ? 22 : 14;
  const coverName = cover === 'steklo' ? 'Varnostno steklo 8 mm' : cover === 'polikar' ? 'Polikarbonat 10 mm' : 'Trapezna pločevina';

  const lines = [
    {
      name: 'Nosilna konstrukcija nadstreška',
      description: 'Pocinkano jeklo, razpon ' + r2(W) + ' m',
      quantity: area,
      unit: 'm²',
      unitPrice: 95,
    },
    {
      name: `Kritina: ${coverName}`,
      description: '10 % za preklope in odpad',
      quantity: r2(area * 1.1),
      unit: 'm²',
      unitPrice: coverPrice,
    },
    {
      name: 'Stebri (jeklo 80×80)',
      description: 'Z bazo za betoniranje',
      quantity: posts,
      unit: 'kos',
      unitPrice: 85,
    },
  ];

  if (drain) {
    lines.push({
      name: 'Odvod padavinske vode',
      description: 'Zaboj + cev po sprednji strani',
      quantity: r2(W),
      unit: 'm',
      unitPrice: 18,
    });
  }
  lines.push({
    name: 'Montaža nadstreška',
    description: 'Vključno z betoniranjem stebrov',
    quantity: area,
    unit: 'm²',
    unitPrice: 45,
  });

  return {
    lines,
    summary: [
      { label: 'Površina', value: `${area} m² (${r2(W)} × ${r2(D)} m)` },
      { label: 'Kritina', value: coverName },
      { label: 'Stebri', value: `${posts} kosov` },
    ],
  };
}

/** Fasada – neto površina minus odprtine; letve ~2,5 lm/m² (razmak 40 cm). */
export function calculateFasada(input: CraftInputs, laborRate: number): CalcResult {
  const perimeter = Math.max(0, input.facadePerimeter ?? 0);
  const height = Math.max(0, input.facadeHeight ?? 0);
  const openings = Math.max(0, input.openingsM2 ?? 0);
  const cladding = input.cladding ?? 'wpc';

  const gross = perimeter * height;
  const net = Math.max(0, gross - openings);

  if (net <= 0) {
    return { lines: [], summary: [{ label: 'Površina fasade', value: '0 m²' }] };
  }

  const claddingPrice = cladding === 'les' ? 44 : cladding === 'ploc' ? 26 : 52;
  const claddingName = cladding === 'les' ? 'Fasadna obloga les (termo smreka)' : cladding === 'ploc' ? 'Trapezna fasadna pločevina' : 'Fasadna obloga WPC';
  const battensLM = r2(net * 2.5);

  const lines = [
    {
      name: claddingName,
      description: `Neto površina ${r2(net)} m² (odprtine −${r2(openings)} m²), 5 % odpad`,
      quantity: r2(net * 1.05),
      unit: 'm²',
      unitPrice: claddingPrice,
    },
    {
      name: 'Podkonstrukcija (letve)',
      description: 'Razmak 40 cm, vključno z vijačevjem',
      quantity: battensLM,
      unit: 'm',
      unitPrice: 8,
    },
    {
      name: 'Zaključni profili (začetni, končni, vogalni)',
      quantity: ceil(perimeter / 2),
      unit: 'kos',
      unitPrice: 9,
    },
    {
      name: 'Montaža ventilirane fasade',
      quantity: net,
      unit: 'm²',
      unitPrice: 32,
    },
  ];

  return {
    lines,
    summary: [
      { label: 'Bruto površina', value: `${r2(gross)} m²` },
      { label: 'Odprtine', value: `−${r2(openings)} m²` },
      { label: 'Neto površina', value: `${r2(net)} m²` },
      { label: 'Letve', value: `${battensLM} lm` },
    ],
  };
}

const CALCULATORS: Record<CraftId, (i: CraftInputs, labor: number) => CalcResult> = {
  'ograje': calculateOgraje,
  'stopnice': calculateStopnice,
  'keramika': calculateKeramika,
  'wpc-terasa': calculateWpcTerasa,
  'okna-vrata': calculateOknaVrata,
  'nadstreški': calculateNadstresek,
  'fasada': calculateFasada,
};

export function runCalculator(craft: CraftId, input: CraftInputs, laborRate: number): CalcResult {
  return CALCULATORS[craft](input, laborRate);
}

export function calcTotals(items: { quantity: number; unitPrice: number }[], vatRate: number) {
  const subtotal = r2(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const vatAmount = r2(subtotal * (vatRate / 100));
  const total = r2(subtotal + vatAmount);
  return { subtotal, vatAmount, total };
}
