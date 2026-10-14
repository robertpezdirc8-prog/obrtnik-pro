// ─── Skica prostora: tloris iz meritev sten (Bowditch traverse) ──
// Raziskava (magicplan PrecisionLink, Cutlist/Cutter aplikacije,
// r/Contractor): najmočnejša konkurenčna funkcija je »laser → tloris
// → površina → ponudba«. Pri nas je laser že vgrajen (Web Bluetooth),
// manjkalo je zaprtje poligona. To je klasična geodezija: vrstni
// tahometrični zaprti krog z Bowditchovo (kompasno) porazdelitvijo
// napake. 0 AI, deterministično, vse enote cm.

export interface WallInput {
  /** Dolžina stene v cm (izmerjena — laser/ročno). */
  lengthCm: number;
  /** NOTRANJI kot ob KONCU te stene (med to steno in naslednjo), v °.
   *  Pravokotna soba = 90; vdolbeni (L) kot = 270. Privzeto 90. */
  angleDeg: number;
  /** Opcijska oznaka (»Sever«, »z laserja 2« …). */
  label?: string;
}

export interface XY {
  x: number;
  y: number;
}

export type SketchLevel = 'closed' | 'adjusted' | 'open';

export interface RoomSketchResult {
  /** Št. veljavnih sten. */
  n: number;
  /** Surove točke (tahometrija brez poravnav) — poligon je odprt. */
  rawVertices: XY[];
  /** Poravnane točke (Bowditch); pri 'open' = surove. */
  vertices: XY[];
  /** Poravnane dolžine stranic (cm); pri 'open' = surove. */
  adjustedSidesCm: number[];
  /** Kotna zapiralna napaka = (n−2)·180 − vsota kotov (°). */
  angularMisclosureDeg: number;
  /** Linearna zapiralna napaka (cm) in odstotek obsega. */
  closureErrorCm: number;
  closureErrorPct: number;
  perimeterCm: number;
  /** Površina tlorisa (m²); null pri 'open' — pošteno NE tiho ocenimo. */
  areaM2: number | null;
  level: SketchLevel;
  warnings: string[];
  /** Ovojnica poravnanih točk (m) — kalkulatorji (L×W) jo rabijo. */
  bboxM: { lengthM: number; widthM: number };
  /** Predpolnitve kalkulatorjev; prazno pri 'open'. */
  prefill: {
    keramika?: { floorLength: number; floorWidth: number };
    'wpc-terasa'?: { deckLength: number; deckWidth: number };
    fasada?: { facadePerimeter: number };
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Shoelace ploščina poligona v cm² (absolutna vrednost). */
export function polygonAreaCm2(pts: XY[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/** Pravokotnik iz 2 mer širine in 2 mer dolžine (nasprotna para se
 *  povprečita) — najhitrejši vnos za navadno sobo. Koti 90. */
export function rectWalls(m: {
  widthA: number;
  widthB: number;
  lengthA: number;
  lengthB: number;
}): WallInput[] {
  const w = (m.widthA + m.widthB) / 2;
  const l = (m.lengthA + m.lengthB) / 2;
  return [
    { lengthCm: w, angleDeg: 90, label: 'širina' },
    { lengthCm: l, angleDeg: 90, label: 'dolžina' },
    { lengthCm: w, angleDeg: 90, label: 'širina' },
    { lengthCm: l, angleDeg: 90, label: 'dolžina' },
  ];
}

/** Zapri poligon sobe iz meritev sten.
 *
 *  Postopek (klasični zaprti tahometrični krog):
 *  1. Validacija sten (dolžina > 0, kot 20–340°). Manj kot 3 → null.
 *  2. Kotno zaprtje: vsota notranjih kotov mora biti (n−2)·180°.
 *     Odstopanje se porazdeli enakomerno (standard v geodeziji);
 *     če je |odstopanje/kot| > 15°, so koti očitno zmotni → 'open'.
 *  3. Tahometrija: 1. stranica po +X, obrat na koncu stranice =
 *     180° − notranji kot (CCW). Nastane odprt surovi poligon.
 *  4. Linearno zaprtje: vektor C = P0 − Pn porazdeli Bowditch
 *     (kompasno pravilo) sorazmerno z dolžino stranic.
 *  5. Rang: napaka ≤ 0,2 % obsega → 'closed'; ≤ 5 % → 'adjusted';
 *     > 5 % ali velika kotna napaka → 'open' (površina = null).
 */
export function closeRoomPolygon(walls: WallInput[]): RoomSketchResult | null {
  const warnings: string[] = [];
  const valid = walls.filter(
    (w) => Number.isFinite(w.lengthCm) && w.lengthCm > 0 && Number.isFinite(w.angleDeg),
  );
  if (valid.length !== walls.length) {
    warnings.push('Neveljavne meritve (dolžina ≤ 0 ali manjkajoč kot) so izpuščene.');
  }
  const n = valid.length;
  if (n < 3) return null;

  //angle check: vsi koti morajo biti geometrijsko smiselni (20–340°)
  for (const w of valid) {
    if (w.angleDeg < 20 || w.angleDeg > 340) {
      warnings.push(`Kot ${r1(w.angleDeg)}° je izven razpona (20–340°) — preveri vnos.`);
      return null;
    }
  }

  // 2) kotno zaprtje
  const angleSum = valid.reduce((s, w) => s + w.angleDeg, 0);
  const angleTarget = (n - 2) * 180;
  const angularMisclosureDeg = angleTarget - angleSum;
  const perVertexDeg = Math.abs(angularMisclosureDeg) / n;
  if (perVertexDeg > 15) {
    warnings.push(
      `Koti se ne seštejejo (odstopanje ${r1(angularMisclosureDeg)}°) — tloris NE zanesljiv. Preveri kote.`,
    );
  }
  const anglesAdj = valid.map((w) => w.angleDeg + angularMisclosureDeg / n);
  if (Math.abs(angularMisclosureDeg) > 0.5 && perVertexDeg <= 15) {
    warnings.push(
      `Kotno zaprtje ${r1(angularMisclosureDeg)}° porazdeljeno enakomerno na ${n} kotov.`,
    );
  }

  // 3) tahometrija (CCW): 1. stranica po +X
  const rawVertices: XY[] = [{ x: 0, y: 0 }];
  let bearingDeg = 0;
  for (let i = 0; i < n; i++) {
    const L = valid[i].lengthCm;
    const rad = (bearingDeg * Math.PI) / 180;
    const prev = rawVertices[rawVertices.length - 1];
    rawVertices.push({ x: prev.x + L * Math.cos(rad), y: prev.y + L * Math.sin(rad) });
    // obrat ob koncu stranice i (kot med stranico i in i+1)
    const turn = 180 - anglesAdj[i];
    bearingDeg = bearingDeg + turn;
  }
  // zadnji vnosni kot (ob koncu zadnje stranice, nazaj k prvi) ni rabljen za azimute

  const start = rawVertices[0];
  const end = rawVertices[n];
  const closure: XY = { x: start.x - end.x, y: start.y - end.y };
  const closureErrorCm = Math.hypot(closure.x, closure.y);
  const perimeterRaw = valid.reduce((s, w) => s + w.lengthCm, 0);
  const closureErrorPct = perimeterRaw > 0 ? (closureErrorCm / perimeterRaw) * 100 : Infinity;

  // 5) rang — kotna napaka > 15°/kot ali linearna > 5 % → odprt
  const angularBad = perVertexDeg > 15;
  const linearBad = closureErrorPct > 5;
  let level: SketchLevel =
    closureErrorPct <= 0.2 && !angularBad ? 'closed' : 'adjusted';
  if (angularBad || linearBad) level = 'open';

  // 4) Bowditch (kompasno pravilo) — samo če poligon lahko poravnamo
  // vertices ima vedno n+1 točk: pri 'closed'/'adjusted' je zadnja ≈ izhodišče,
  // pri 'open' je surovi konec hoje (risba doda prekinitveno rob do izhodišča).
  let vertices = rawVertices;
  let adjustedSidesCm = valid.map((w) => w.lengthCm);
  if (level !== 'open' && closureErrorCm > 0) {
    const sidesRaw: XY[] = [];
    for (let i = 0; i < n; i++) {
      sidesRaw.push({
        x: rawVertices[i + 1].x - rawVertices[i].x,
        y: rawVertices[i + 1].y - rawVertices[i].y,
      });
    }
    const corr = sidesRaw.map((s) => ({
      x: (closure.x * Math.hypot(s.x, s.y)) / perimeterRaw,
      y: (closure.y * Math.hypot(s.x, s.y)) / perimeterRaw,
    }));
    vertices = [rawVertices[0]];
    for (let i = 0; i < n; i++) {
      const prev = vertices[vertices.length - 1];
      vertices.push({
        x: prev.x + sidesRaw[i].x + corr[i].x,
        y: prev.y + sidesRaw[i].y + corr[i].y,
      });
    }
    adjustedSidesCm = sidesRaw.map((s, i) => Math.hypot(s.x + corr[i].x, s.y + corr[i].y));
    if (level === 'adjusted') {
      warnings.push(
        `Zaprtje poravnano po Bowditchu — napaka ${r1(closureErrorCm)} cm (${r2(closureErrorPct)} % obsega). Dolžine so rahlo popravljene.`,
      );
    }
  } else if (level === 'open' && !angularBad) {
    warnings.push(
      `Poligon se ne zapre — napaka ${r1(closureErrorCm)} cm (${r1(closureErrorPct)} % obsega). Manjka stena ali je meritev zmotna.`,
    );
  }

  const perimeterCm = adjustedSidesCm.reduce((s, l) => s + l, 0);

  // ovojnica + površina
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const bboxM = {
    lengthM: r2((Math.max(...xs) - Math.min(...xs)) / 100),
    widthM: r2((Math.max(...ys) - Math.min(...ys)) / 100),
  };

  let areaM2: number | null = null;
  const prefill: RoomSketchResult['prefill'] = {};
  if (level !== 'open') {
    areaM2 = r2(polygonAreaCm2(vertices) / 10000);
    prefill.keramika = { floorLength: bboxM.lengthM, floorWidth: bboxM.widthM };
    prefill['wpc-terasa'] = { deckLength: bboxM.lengthM, deckWidth: bboxM.widthM };
    prefill.fasada = { facadePerimeter: r2(perimeterCm / 100) };
  }

  return {
    n,
    rawVertices: rawVertices.slice(0, n),
    vertices,
    adjustedSidesCm: adjustedSidesCm.map(r1),
    angularMisclosureDeg: r1(angularMisclosureDeg),
    closureErrorCm: r1(closureErrorCm),
    closureErrorPct: r2(closureErrorPct),
    perimeterCm: r1(perimeterCm),
    areaM2,
    level,
    warnings,
    bboxM,
    prefill,
  };
}
