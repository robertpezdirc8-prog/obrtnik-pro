import type { CraftId, CraftInputs } from './types';
import { maxAllowedSpan, profileLabel } from './roksal-span-rules';
import { resolveTerasaInputs, terasaProblemText } from './terasa-inputs';
import { craftProblemText, resolveCraftInputs, type InputProblem } from './craft-inputs';

// ─── Material & montaža — čiste deterministične skripte ─────
// Brez AI: geometrija, enakomerni razmaki, 1D rezalni načrt
// (First-Fit-Decreasing) in kontrole predpisov/standardov.
// Vsi izhodi so izračunani iz vnesenih mer.

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'info';

export interface PlanCheck {
  label: string;
  detail: string;
  status: CheckStatus;
}

export interface PlanBuy {
  label: string;
  detail: string;
}

export interface PlanCut {
  /** Kaj rezemo (npr. "Ročajni profil 6 m"). */
  title: string;
  /** Povzetek: "3 bati · 2 reza · odpadek 8 %". */
  summary: string;
  /** Podroben razpored po batih. */
  bars: string[];
  /** Zahtevani kosi (m) — za sklad ostankov. */
  pieces: number[];
  /** Uporabni ostanki (m) — za sklad ostankov. */
  leftovers: number[];
}

export interface InstallPlan {
  buys: PlanBuy[];
  cuts: PlanCut[];
  checks: PlanCheck[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const nf = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 });
const fmtM = (n: number) => `${nf.format(n)} m`;

/** Slovensko sklanjanje: plural(2, ['bat','bata','bati','batov']) → "bata". */
export function plural(n: number, forms: [string, string, string, string]): string {
  const m = n % 100;
  if (n === 1) return forms[0];
  if (n === 2 || m === 2) return forms[1];
  if (n === 3 || n === 4 || m === 3 || m === 4) return forms[2];
  return forms[3];
}
const BAT: [string, string, string, string] = ['bat', 'bata', 'bati', 'batov'];
const REZ: [string, string, string, string] = ['rez', 'reza', 'rezi', 'rezov'];
const KOS: [string, string, string, string] = ['kos', 'kosa', 'kosi', 'kosov'];
const SKATLA: [string, string, string, string] = ['škatla', 'škatli', 'škatle', 'škatel'];
const VRECKA: [string, string, string, string] = ['vrečka', 'vrečki', 'vrečke', 'vrečk'];

// ─── Enakomerni razmaki ─────────────────────────────────────

/** Razporeditev stebrov na dolžino L z NAJVEČ maxGapM razmaka.
 *  Št. razmakov = L / maxGap (zaokroženo navzgor) → razmak se
 *  enakomerno skrajša, da je porazdelitev simetrična. */
export function evenPosts(lengthM: number, maxGapM: number): { posts: number; gapM: number } {
  if (lengthM <= 0) return { posts: 0, gapM: 0 };
  const gaps = Math.max(1, Math.ceil(lengthM / maxGapM));
  return { posts: gaps + 1, gapM: r2(lengthM / gaps) };
}

/** Zapolnitev ograje s palicami/balustri z ENAKIMI režami.
 *  Izračuna največje št. palic, da je reža še ≤ maxGapM.
 *  Klasična formula: n = floor((L + g) / (b + g)), reža = (L − n·b)/(n + 1). */
export function balusterFill(
  railM: number,
  balusterM: number,
  maxGapM = 0.11,
): { count: number; gapM: number; ok: boolean } {
  if (railM <= 0 || balusterM <= 0) return { count: 0, gapM: 0, ok: false };
  const count = Math.max(0, Math.floor((railM + maxGapM) / (balusterM + maxGapM)));
  const gapM = count > 0 ? r2((railM - count * balusterM) / (count + 1)) : 0;
  return { count, gapM, ok: count > 0 && gapM <= maxGapM + 0.0005 };
}

// ─── 1D rezalni načrt (FFD) ─────────────────────────────────

export interface CutPlan1D {
  /** Št. nabavnih batov. */
  bars: number;
  /** Št. rezov (celi bati brez reza ne štejejo). */
  cuts: number;
  wasteM: number;
  wastePct: number;
  /** "Bat 1: 2,50 m + 1,20 m → ostanek 0,28 m". */
  barsDetail: string[];
  /** Zahtevani kosi (padajoče) — za povezovanje s skladiščem ostankov. */
  pieces: number[];
  /** Uporabni ostanki po batih (≥ 0,4 m) — za sklad ostankov. */
  leftovers: number[];
}

/** Najmanjša dolžina ostanka, ki ga vredno shrani (krajši gre v odpad). */
const LEFTOVER_MIN_M = 0.4;

/** First-Fit-Decreasing 1D rezalni načrt — determinističen.
 *  Kosi uredi padajoče, vsak spravi v prvi bat, kamor se še prilega.
 *  Kerf (piła) se odšteje pri vsakem rezu v obstoječem batu. */
export function cutPlan1D(piecesM: number[], stockM: number, kerfM = 0.004): CutPlan1D {
  const pieces = piecesM.filter((p) => p > 0.001 && p <= stockM + 0.0005).sort((a, b) => b - a);
  const bars: { used: number; parts: number[] }[] = [];

  for (const p of pieces) {
    let placed = false;
    for (const bar of bars) {
      const kerf = bar.parts.length > 0 ? kerfM : 0;
      if (bar.used + kerf + p <= stockM + 0.0005) {
        bar.used += kerf + p;
        bar.parts.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) bars.push({ used: p, parts: [p] });
  }

  const purchased = bars.length * stockM;
  const usedTotal = bars.reduce((s, b) => s + b.used, 0);
  const wasteM = r2(Math.max(0, purchased - usedTotal));

  // Združi enake bate: "18 × Bat: 3 m → ostanek 1 m"
  const grouped = new Map<string, number>();
  for (const b of bars) {
    const list = b.parts.map((c) => fmtM(c)).join(' + ');
    const rem = r2(stockM - b.used);
    const line = `${list}${rem > 0.0005 ? ` → ostanek ${fmtM(rem)}` : ' (cel bat)'}`;
    grouped.set(line, (grouped.get(line) ?? 0) + 1);
  }
  const barsDetail: string[] = [];
  let idx = 0;
  for (const [line, count] of grouped) {
    idx += count;
    barsDetail.push(count > 1 ? `Bat 1–${idx} (${count}×): ${line}` : `Bat ${idx}: ${line}`);
  }

  return {
    bars: bars.length,
    cuts: pieces.filter((p) => p < stockM - 0.0005).length,
    wasteM,
    wastePct: purchased > 0 ? Math.round((wasteM / purchased) * 100) : 0,
    barsDetail,
    pieces: [...pieces].sort((a, b) => b - a),
    leftovers: bars
      .map((b) => r2(stockM - b.used))
      .filter((rem) => rem >= LEFTOVER_MIN_M - 0.0005),
  };
}

/** Nakup celih škatel z zaokrožitvijo navzgor. */
export function boxesUp(areaM2: number, boxM2: number): { boxes: number; coverageM2: number } {
  if (areaM2 <= 0 || boxM2 <= 0) return { boxes: 0, coverageM2: 0 };
  const boxes = Math.max(1, Math.ceil(areaM2 / boxM2));
  return { boxes, coverageM2: r2(boxes * boxM2) };
}

/** Razdeli dolžino L na n enakih kosov ≤ maxPiece. */
function evenSplit(lengthM: number, maxPieceM: number): number[] {
  if (lengthM <= maxPieceM) return [r2(lengthM)];
  const n = Math.ceil(lengthM / maxPieceM);
  const piece = lengthM / n;
  return Array.from({ length: n }, () => r2(piece));
}

// ─── Plan po dejavnostih ────────────────────────────────────

const RAIL_STOCK_M = 6;    // nabavna dolžina ročajnih profilov
const BOARD_STOCK_M = 6;   // nabavna dolžina stopničnih desk
const JOIST_STOCK_M = 4;   // nabavna dolžina nosilcev WPC
const TILE_BOX_M2 = 1.44;  // m² na škatlo ploščic

/** Zavrnjen vnos: načrt nima materiala in namesto kontrol našteje VPISANE
 *  vrednosti z razlogom. Isti obrazec velja za vseh sedem dejavnosti. */
function refusalPlan(problems: InputProblem[]): InstallPlan {
  return {
    buys: [],
    cuts: [],
    checks: problems.map((p) => ({ label: 'Izračun ni opravljen', detail: craftProblemText(p), status: 'bad' as const })),
  };
}

function ograjePlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('ograje', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  const L = inp.v.length;
  const H = inp.v.height;
  const gates = inp.v.gates;
  if (L <= 0) return { buys: [], cuts: [], checks: [] };

  const posts = evenPosts(L, 1.5);
  const rails = cutPlan1D(evenSplit(L, RAIL_STOCK_M - 0.1), RAIL_STOCK_M);
  // 1,5 m je PREDPOSTAVKA ponudbe, ne ROKSALova meja. ROKSAL objavlja mejo
  // razmika stebrov PO PROFILU (110–150 cm), zato brez izbranega profila ene
  // same številke ni — pokaže se tabela in najstrožja meja.
  const roksalPosts = maxAllowedSpan({ family: 'ograja', context: 'posts', panelHeightCm: Math.round(H * 100) });
  const postsFloorCm = roksalPosts.profileFloorCm ?? 0;
  const postsOverFloor = postsFloorCm > 0 && posts.gapM * 100 > postsFloorCm + 0.5;

  return {
    buys: [
      { label: `Ročajni profil — ${rails.bars} ${plural(rails.bars, BAT)} po ${RAIL_STOCK_M} m`, detail: `${nf.format(L)} m ograje razdeljeno enakomerno po batih` },
      { label: `Stebri — ${posts.posts} ${plural(posts.posts, KOS)}`, detail: `enakomerni razmak ${nf.format(posts.gapM)} m (predpostavka 1,5 m, ne ROKSALova meja)` },
    ],
    cuts: [
      {
        title: `Ročajni profil (${RAIL_STOCK_M} m)`,
        summary: `${rails.bars} ${plural(rails.bars, BAT)} · ${rails.cuts} ${plural(rails.cuts, REZ)} · odpadek ${rails.wastePct} %`,
        bars: rails.barsDetail,
        pieces: rails.pieces,
        leftovers: rails.leftovers,
      },
    ],
    checks: [
      // 1,0 m in 0,9 m STA PRIPOROČILI iz prakse, ne citiran predpis — aplikacija
      // vira nima in lokalne zahteve preveriti ne more. Besedilo to pove eksplicitno,
      // sicer bi monter bral pravno trditev, je pa aplikacija ne more dokazati.
      H >= 1.0
        ? { label: 'Višina ograje', detail: `${nf.format(H)} m — nad priporočilom 1,0 m (priporočilo iz prakse, ne citiran predpis)`, status: 'ok' }
        : H >= 0.9
          ? { label: 'Višina ograje', detail: `${nf.format(H)} m — pod priporočilom 1,0 m; lokalne zahteve po predpisu aplikacija ne more preveriti`, status: 'warn' }
          : { label: 'Višina ograje', detail: `${nf.format(H)} m — pod 0,9 m; zahtevo po predpisu preveri sam (vira ni v aplikaciji)`, status: 'bad' },
      { label: 'Razmak palic (vertikalno polnilo)', detail: 'največ 11 cm — kontrola pri montaži z merilnim vložkom 11 cm (varnostna praksa, ROKSAL tega ne objavlja)', status: 'info' },
      postsOverFloor
        ? {
            label: 'Razmak stebrov',
            detail: `${nf.format(posts.gapM)} m — enakomerno, a NAD najstrožjo ROKSALovo mejo ${postsFloorCm} cm ` +
              `(${roksalPosts.byProfile.map((r) => `${profileLabel(r.profile)} ${r.limitCm} cm`).join(', ')}). ` +
              `Če montiraš ta profil, dodaj steber.`,
            status: 'warn',
          }
        : {
            label: 'Razmak stebrov',
            detail: `${nf.format(posts.gapM)} m — enakomerno, brez nestandarnih praznin${
              postsFloorCm > 0 ? `; ROKSALova meja po profilih: ${roksalPosts.byProfile.map((r) => `${r.profile} ${r.limitCm} cm`).join(', ')}` : ''
            }`,
            status: 'ok',
          },
      ...(gates > 0)
        ? [{ label: 'Vgrajeni prehodi', detail: `${gates} × prehod 0,9 m — pusti montažni tlak 1–2 cm na stran`, status: 'info' as const }]
        : [],
    ],
  };
}

function stopnicePlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('stopnice', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  let steps = inp.v.steps;
  const width = inp.v.stepWidth;
  const riseCm = inp.v.totalRiseCm;

  // Isti samodejni predlog kot pri ceni (ciljna višina stopnice ~17,5 cm),
  // sicer bi načrt pri 0 stopnicah natisnil prazen seznam, ponudba pa 12 kosov.
  if (riseCm > 0 && steps === 0) steps = Math.ceil(riseCm / 17.5);
  if (steps <= 0) return { buys: [], cuts: [], checks: [] };

  const desks = cutPlan1D(Array.from({ length: steps }, () => width), BOARD_STOCK_M);

  const checks: PlanCheck[] = [];
  if (riseCm > 0) {
    const R = r2(riseCm / steps);
    // Globine stopnice (G) noben vnos ne traži, zato je NE izmislimo. Stara
    // koda je računala `G = min(32, max(25, 63 − 2R))` in nato izpisala
    // »✓ udobje 63 cm« — krog je bil vedno sklenjen, ker je G prislala ista
    // številka, ki ga je preverjala. Namesto tega načrt pove R in RAZPON G,
    // ki ga pravilo 2R + G = 60–66 cm zahteva, montažo pa izmeri sama.
    const goingBand: [number, number] = [r2(60 - 2 * R), r2(66 - 2 * R)];
    const buildable = goingBand[0] > 0;
    checks.push(
      R >= 15 && R <= 19
        ? { label: 'Višina stopnice (R)', detail: `${nf.format(R)} cm — v idealnem območju 15–19 cm`, status: 'ok' }
        : R >= 14 && R <= 20
          ? { label: 'Višina stopnice (R)', detail: `${nf.format(R)} cm — obrobnica; idealno 15–19 cm`, status: 'warn' }
          : { label: 'Višina stopnice (R)', detail: `${nf.format(R)} cm — izven priporočila 15–19 cm; prilagodi št. stopnic`, status: 'bad' },
      !buildable
        ? {
            label: 'Pravilo 2R + G',
            detail: `R = ${nf.format(R)} cm → pravilo bi zahtevalo G = ${nf.format(goingBand[0])}–${nf.format(goingBand[1])} cm, kar ni izvedljivo; povečaj število stopnic`,
            status: 'bad',
          }
        : {
            label: 'Pravilo 2R + G',
            detail: `R = ${nf.format(R)} cm → G mora biti ${nf.format(goingBand[0])}–${nf.format(goingBand[1])} cm (pravilo 60–66 cm). Globine stopnice vnos ne vsebuje, zato je ne moremo preveriti`,
            status: 'info',
          },
    );
  } else {
    checks.push({ label: 'Pravilo 2R + G', detail: 'vnesi višinsko razliko za kontrolo višine stopnic in zahtevane globine', status: 'info' });
  }
  // 0,9 m je PRAKSA, ne objavljen podatek ROKSAL — zato je tako tudi zapisano.
  // Načrt meri oceni, vpisane širine ne popravlja (za to je okno vnosa).
  checks.push({
    label: 'Širina stopnic',
    detail: `${nf.format(width)} m — za glavne stopnice se priporoča ≥ 0,9 m (splošna praksa, ne objavljen podatek ROKSAL)`,
    status: width >= 0.9 ? 'ok' : 'warn',
  });

  return {
    buys: [
      { label: `Stopnične deske — ${desks.bars} ${plural(desks.bars, BAT)} po ${BOARD_STOCK_M} m`, detail: `${steps} × ${nf.format(width)} m = ${nf.format(r2(steps * width))} lm` },
    ],
    cuts: [
      {
        title: `Stopnične deske (${BOARD_STOCK_M} m)`,
        summary: `${desks.bars} ${plural(desks.bars, BAT)} · ${desks.cuts} ${plural(desks.cuts, REZ)} · odpadek ${desks.wastePct} %`,
        bars: desks.barsDetail,
        pieces: desks.pieces,
        leftovers: desks.leftovers,
      },
    ],
    checks,
  };
}

function keramikaPlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('keramika', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  const L = inp.v.floorLength;
  const W = inp.v.floorWidth;
  const wallH = inp.v.wallHeight;
  const reserve = inp.v.reservePercent;
  const pattern = i.tilePattern ?? 'ravno';
  const rec = pattern === 'diagonalno' ? 15 : pattern === 'ribja-kost' ? 18 : 10;
  const floor = L * W;
  const total = floor + 2 * (L + W) * wallH;
  if (total <= 0) return { buys: [], cuts: [], checks: [] };

  const withReserve = total * (1 + reserve / 100);
  const boxes = boxesUp(withReserve, TILE_BOX_M2);
  const glueBags = Math.ceil((total * 4) / 25);

  return {
    buys: [
      { label: `Ploščice — ${boxes.boxes} ${plural(boxes.boxes, SKATLA)}`, detail: `${nf.format(r2(withReserve))} m² z rezervo ${reserve} % → ${boxes.boxes} ${plural(boxes.boxes, SKATLA)} pokrije ${nf.format(boxes.coverageM2)} m²` },
      { label: `Lepilo — ${glueBags} ${plural(glueBags, VRECKA)} (25 kg)`, detail: `ocena 4 kg/m² × ${nf.format(r2(total))} m²` },
    ],
    cuts: [],
    checks: [
      reserve >= rec
        ? { label: 'Rezerva za rezanje', detail: `${reserve} % — zadosti za vzorec "${pattern === 'ravno' ? 'ravno' : pattern === 'diagonalno' ? 'diagonalno' : 'ribja kost'}" (priporočeno ≥ ${rec} %)`, status: 'ok' }
        : { label: 'Rezerva za rezanje', detail: `${reserve} % — premalo za vzorec; priporočeno ≥ ${rec} % (tvegaš, da škatel ne bo dovolj)`, status: 'warn' },
      { label: 'Dilatacija ob steni', detail: 'reža 5 mm po obodu + silikon; na velikih površinah dilatacijski spoj vsak 25–35 m²', status: 'info' },
      wallH > 0
        ? { label: 'Hidroizolacija', detail: `stene ${nf.format(r2(2 * (L + W) * wallH))} m² — dvakratni nanos + trakovi v mokrih prostorih`, status: 'info' }
        : { label: 'Hidroizolacija', detail: 'samo tla — v mokrih prostorih obvezno tudi stene do 2 m', status: 'info' },
    ],
  };
}

function wpcTerasaPlan(i: CraftInputs): InstallPlan {
  if ((i.deckLength ?? 0) <= 0 || (i.deckWidth ?? 0) <= 0) return { buys: [], cuts: [], checks: [] };

  const inp = resolveTerasaInputs(i);
  if (!inp.ok) {
    return {
      buys: [],
      cuts: [],
      checks: inp.problems.map((p) => ({ label: 'Izračun ni opravljen', detail: terasaProblemText(p), status: 'bad' as const })),
    };
  }

  const L = inp.v.deckLength;
  const W = inp.v.deckWidth;
  const spacing = inp.v.joistSpacing;
  const sideGap = inp.v.sideGapMm;
  const endGap = inp.v.endGapMm;

  const joistCount = Math.ceil(L / spacing) + 1;
  const joists = cutPlan1D(Array.from({ length: joistCount }, () => W), JOIST_STOCK_M);
  // ROKSAL objavlja za TERASO razmik podložnih letev 33–35 cm (center). Plan je
  // prej trdil »maks. 60 cm« — številka brez vira — in preizkus `spacing <= 0.6`
  // je bil vedno resničen, ker ga vhodni usek (`Math.min(0.6, …)`) nikoli ni
  // spustil nad 0,6 m: opozorilo montera nikoli ni zadelo. Usek je zdaj
  // odstranjen, primerjava pa gre proti citiranemu pasu (vedno velja spodnji rob
  // = meja; znotraj pasu je `warn`, čez pas `bad`).
  const batten = maxAllowedSpan({ family: 'terasa', context: 'battens' });
  const spacingCm = Math.round(spacing * 100);
  const bandHiCm = batten.binding?.bandCm?.[1] ?? batten.maxSpanCm;
  const battenStatus: PlanCheck['status'] =
    spacingCm <= batten.maxSpanCm ? 'ok' : spacingCm <= bandHiCm ? 'warn' : 'bad';

  return {
    buys: [
      { label: `Nosilci — ${joists.bars} ${plural(joists.bars, BAT)} po ${JOIST_STOCK_M} m`, detail: `${joistCount} ${plural(joistCount, KOS)} × ${nf.format(W)} m = ${nf.format(r2(joistCount * W))} lm` },
    ],
    cuts: [
      {
        title: `Nosilci (${JOIST_STOCK_M} m)`,
        summary: `${joists.bars} ${plural(joists.bars, BAT)} · ${joists.cuts} ${plural(joists.cuts, REZ)} · odpadek ${joists.wastePct} %`,
        bars: joists.barsDetail,
        pieces: joists.pieces,
        leftovers: joists.leftovers,
      },
    ],
    checks: [
      sideGap >= 3
        ? { label: 'Stranska dilatacija', detail: `${sideGap} mm — v priporočenem območju 3–6 mm (tržna praksa WPC desk, ROKSAL za teraso reže ne objavlja)`, status: 'ok' }
        : { label: 'Stranska dilatacija', detail: `${sideGap} mm — preozko; priporočilo 3–6 mm (tržna praksa, ne ROKSALova meja), sicer deske dvigne poleti`, status: 'bad' },
      endGap >= 3
        ? { label: 'Čelna dilatacija', detail: `${endGap} mm — v priporočenem območju 3–5 mm (tržna praksa WPC desk, ROKSAL za teraso reže ne objavlja)`, status: 'ok' }
        : { label: 'Čelna dilatacija', detail: `${endGap} mm — preozko; priporočilo 3–5 mm na spojih (tržna praksa, ne ROKSALova meja)`, status: 'bad' },
      {
        label: 'Razmak nosilcev',
        detail: `${nf.format(spacingCm)} cm — ROKSAL za teraso objavlja pas ${batten.binding?.bandCm?.[0]}–${bandHiCm} cm ` +
          `(${batten.binding?.source}): „${batten.binding?.quote}“` +
          (battenStatus === 'ok'
            ? ' — znotraj objavljenega pasu'
            : battenStatus === 'warn'
              ? ' — znotraj pasu, a nad varno spodnjo mejo; deske se lahko zvijajo'
              : ' — PREŠIROKO: nad objavljenim pasom, deske se lahko zvijajo'),
        status: battenStatus,
      },
      { label: 'Naklon terase', detail: '1–2 % s padcem od hiše za odtek vode (≈ 1–2 cm na meter) — tržna praksa, ROKSAL ne objavlja', status: 'info' },
      { label: 'Reža ob steni', detail: '15–20 mm pri hiši — nikoli tesno k steni (tržna praksa, ROKSAL ne objavlja)', status: 'info' },
    ],
  };
}

function oknaVrataPlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('okna-vrata', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  const count = inp.v.windowCount + inp.v.doorCount;
  if (count <= 0) return { buys: [], cuts: [], checks: [] };
  return {
    buys: [{ label: 'Montažna pena', detail: `≈ ${count} ${plural(count, KOS)} (1 × 750 ml na odprtino) + distančni klinčki` }],
    cuts: [],
    checks: [
      { label: 'Vgradna reža', detail: '5–10 mm na stran (10–15 mm na tlorisnih straneh večjih odprtin) — meri odprtino, ne starega okna', status: 'info' },
      { label: 'Merjenje odprtine', detail: 'izmeri širino in višino na 3 mestih (zgoraj/sredina/spodaj); za merilo velja najmanjša vrednost', status: 'info' },
      { label: 'Kvadratnost odprtine', detail: 'razlika diagonal pri 90 × 120 cm naj bo ≤ 2 mm; preseganje izravni z vgradnimi klinčki', status: 'info' },
    ],
  };
}

function nadstresekPlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('nadstreški', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  const W = inp.v.canopyWidth;
  const D = inp.v.canopyDepth;
  // `Math.max(2, št. stebrov)` je monterju tiho dodal dva stebra, ki ju je
  // izpustil namenoma (nadstrešek je sidran na zid). 0 je veljaven izum.
  const posts = inp.v.canopyPosts;
  const cover = i.canopyCover ?? 'ploc';
  if (W <= 0 || D <= 0) return { buys: [], cuts: [], checks: [] };

  const postGap = posts > 1 ? r2(W / (posts - 1)) : 0;
  const minSlope = cover === 'polikar' ? 5 : cover === 'steklo' ? 10 : 7;

  const postCheck: PlanCheck =
    posts === 0
      ? { label: 'Razmak stebrov', detail: 'brez stebrov — konstrukcija je sidrana na zid; nosilnost sidranja preveri s statikom', status: 'info' }
      : posts === 1
        ? { label: 'Razmak stebrov', detail: '1 steber na prosti fronti — preveri, ali nosilec zdrži eno samo oporno točko', status: 'warn' }
        : postGap <= 3
          ? { label: 'Razmak stebrov', detail: `${nf.format(postGap)} m — OK (maks. 3 m za običajno kritino)`, status: 'ok' }
          : { label: 'Razmak stebrov', detail: `${nf.format(postGap)} m — preširoko; dodaj steber ali masivnejši nosilec`, status: 'warn' };

  return {
    buys: [],
    cuts: [],
    checks: [
      postCheck,
      { label: 'Minimalni naklon kritine', detail: `${minSlope}° za ${cover === 'ploc' ? 'trapezno pločevino' : cover === 'polikar' ? 'polikarbonat' : 'steklo'} — pri manjšem naklonu uhaja voda na spojih`, status: 'info' },
      { label: 'Preklop kritine', detail: '10 % za preklope in odpad ob rezanju', status: 'info' },
      { label: 'Odvod vode', detail: (i.waterDrain ?? true) ? 'odvodni žleb + cev po sprednji strani — vzdržuj padec ≥ 0,5 %' : 'brez odvoda — voda kaplja na sprednji rob; priporočamo odvodni žleb', status: (i.waterDrain ?? true) ? 'ok' : 'warn' },
    ],
  };
}

function fasadaPlan(i: CraftInputs): InstallPlan {
  const inp = resolveCraftInputs('fasada', i);
  if (!inp.ok) return refusalPlan(inp.problems);
  const perimeter = inp.v.facadePerimeter;
  const height = inp.v.facadeHeight;
  const openings = inp.v.openingsM2;
  const gross = perimeter * height;
  if (gross <= 0) return { buys: [], cuts: [], checks: [] };

  const openingShare = openings / gross;
  // Kamera lahko v odprtine natančno zbere bruto površino; razlika je potem
  // −0,00000000000004 m² in bi monterju izpisala »neto −0 m²«. Nič je nič.
  const netM2 = r2(gross - openings) || 0;
  // ROKSAL za FASADO objavlja razmik podložne letve 70–80 cm — druga številka
  // kot na terasi (33–35 cm), kljub isti besedi »letev«. Splošna praksa 40 cm
  // je strožja, zato ni v navzkrižju; monter pa mora vedeti, kateri izdelek
  // katero številko ima, da ju ne združi.
  const roksalFacade = maxAllowedSpan({ family: 'fasada', context: 'battens' });
  const spaceAbove40 = roksalFacade.maxSpanCm - 40;

  return {
    buys: [],
    cuts: [],
    checks: [
      { label: 'Razmak letv podkonstrukcije', detail: '40 cm (centrično); pri težji oblogi 30 cm — kontrola z vodilom', status: 'info' },
      {
        label: 'Razmak letv (ROKSAL WPC fasada)',
        detail: `ROKSAL za WPC fasado objavlja ${roksalFacade.binding?.bandCm?.[0]}–${roksalFacade.binding?.bandCm?.[1] ?? roksalFacade.maxSpanCm} cm ` +
          `(${roksalFacade.binding?.source}): „${roksalFacade.binding?.quote}“. ` +
          (spaceAbove40 > 0
            ? `Zgoraj navajan 40 cm je ${spaceAbove40} cm STROŽJI in zato skladen; za ROKSAL WPC oblogo je objavljen širši pas.`
            : 'Zgoraj navajan 40 cm je širši od objavljenega — uporabiti je treba objavljenega.'),
        status: 'info',
      },
      { label: 'Rezerva obloge', detail: '5 % za rez in odpad; pri diagonalni smeri 10 %', status: 'info' },
      openingShare > 0.35
        ? { label: 'Delež odprtin', detail: `${Math.round(openingShare * 100)} % bruto površine (neto ${nf.format(netM2)} m²) — velik delež; preveri izmero odprtin`, status: 'warn' }
        : { label: 'Delež odprtin', detail: `${Math.round(openingShare * 100)} % bruto površine (neto ${nf.format(netM2)} m²) — v normalnem območju`, status: 'ok' },
      { label: 'Dilatacija obloge', detail: 'vertikalni spoj vsakih 5–6 m + reža pod vrhnjim robom za odzračevanje', status: 'info' },
    ],
  };
}

/** Samodejni "Material & montaža" plan za dejavnost iz vnesenih mer. */
export function craftInstallPlan(craft: CraftId, inputs: CraftInputs): InstallPlan {
  switch (craft) {
    case 'ograje': return ograjePlan(inputs);
    case 'stopnice': return stopnicePlan(inputs);
    case 'keramika': return keramikaPlan(inputs);
    case 'wpc-terasa': return wpcTerasaPlan(inputs);
    case 'okna-vrata': return oknaVrataPlan(inputs);
    case 'nadstreški': return nadstresekPlan(inputs);
    case 'fasada': return fasadaPlan(inputs);
  }
}
