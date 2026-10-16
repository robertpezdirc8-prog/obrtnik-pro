import type { CraftId, CraftInputs } from './types';
import { maxAllowedSpan, profileLabel } from './roksal-span-rules';

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

function ograjePlan(i: CraftInputs): InstallPlan {
  const L = Math.max(0, i.length ?? 0);
  const H = i.height ?? 1;
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
      H >= 1.0
        ? { label: 'Višina ograje', detail: `${nf.format(H)} m — skladno s priporočilom (≥ 1,0 m, kjer nivoja razlikujeta > 45 cm)`, status: 'ok' }
        : H >= 0.9
          ? { label: 'Višina ograje', detail: `${nf.format(H)} m — pod priporočilom 1,0 m; preveri lokalne predpise`, status: 'warn' }
          : { label: 'Višina ograje', detail: `${nf.format(H)} m — prenizko; predpis zahteva ≥ 1,0 m`, status: 'bad' },
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
      ...(i.gates ?? 0) > 0
        ? [{ label: 'Vgrajeni prehodi', detail: `${i.gates} × prehod 0,9 m — pusti montažni tlak 1–2 cm na stran`, status: 'info' as const }]
        : [],
    ],
  };
}

function stopnicePlan(i: CraftInputs): InstallPlan {
  const steps = Math.max(0, i.steps ?? 0);
  const width = Math.max(0, i.stepWidth ?? 1);
  const riseCm = Math.max(0, i.totalRiseCm ?? 0);
  if (steps <= 0) return { buys: [], cuts: [], checks: [] };

  const desks = cutPlan1D(Array.from({ length: steps }, () => width), BOARD_STOCK_M);

  const checks: PlanCheck[] = [];
  if (riseCm > 0) {
    const R = riseCm / steps;
    const G = Math.min(32, Math.max(25, 63 - 2 * R));
    const comfort = 2 * R + G;
    checks.push(
      R >= 15 && R <= 19
        ? { label: 'Višina stopnice (R)', detail: `${nf.format(r2(R))} cm — v idealnem območju 15–19 cm`, status: 'ok' }
        : R >= 14 && R <= 20
          ? { label: 'Višina stopnice (R)', detail: `${nf.format(r2(R))} cm — obrobnica; idealno 15–19 cm`, status: 'warn' }
          : { label: 'Višina stopnice (R)', detail: `${nf.format(r2(R))} cm — izven priporočila 15–19 cm; prilagodi št. stopnic`, status: 'bad' },
      comfort >= 60 && comfort <= 66
        ? { label: 'Udobje (pravilo 2R + G)', detail: `${nf.format(r2(comfort))} cm — v idealnem območju 60–66 cm (G = ${nf.format(r2(G))} cm)`, status: 'ok' }
        : { label: 'Udobje (pravilo 2R + G)', detail: `${nf.format(r2(comfort))} cm — idealno 60–66 cm; prilagodi R ali G`, status: 'warn' },
    );
  } else {
    checks.push({ label: 'Udobje (pravilo 2R + G)', detail: 'vnesi višinsko razliko za kontrolo udobja in višine stopnic', status: 'info' });
  }
  checks.push({ label: 'Širina stopnic', detail: `${nf.format(width)} m — priporočilo ≥ 0,9 m za glavne stopnice`, status: width >= 0.9 ? 'ok' : 'warn' });

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
  const L = Math.max(0, i.floorLength ?? 0);
  const W = Math.max(0, i.floorWidth ?? 0);
  const wallH = Math.max(0, i.wallHeight ?? 0);
  const pattern = i.tilePattern ?? 'ravno';
  const rec = pattern === 'diagonalno' ? 15 : pattern === 'ribja-kost' ? 18 : 10;
  const reserve = i.reservePercent ?? rec;
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
  const L = Math.max(0, i.deckLength ?? 0);
  const W = Math.max(0, i.deckWidth ?? 0);
  const spacing = Math.min(0.6, Math.max(0.3, i.joistSpacing ?? 0.4));
  const sideGap = i.sideGapMm ?? 5;
  const endGap = i.endGapMm ?? 4;
  if (L <= 0 || W <= 0) return { buys: [], cuts: [], checks: [] };

  const joistCount = Math.ceil(L / spacing) + 1;
  const joists = cutPlan1D(Array.from({ length: joistCount }, () => W), JOIST_STOCK_M);
  // ROKSAL objavlja za TERASO razmik podložnih letev 33–35 cm (center). Do sedaj
  // je ta plan trdil »maks. 60 cm« — številka brez vira, hkrati pa je bil test
  // `spacing <= 0.6` vedno resničen, ker vhod že omeji na 0,6 m: vejstvo je bilo
  // mrtvo in montera nikoli ni opozorilo. Zdaj primerja proti citiranemu pasu.
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
        ? { label: 'Stranska dilatacija', detail: `${sideGap} mm — v priporočenem območju 3–6 mm`, status: 'ok' }
        : { label: 'Stranska dilatacija', detail: `${sideGap} mm — preozko; minimum 3 mm, sicer deske dvigne poleti`, status: 'bad' },
      endGap >= 3
        ? { label: 'Čelna dilatacija', detail: `${endGap} mm — v priporočenem območju 3–5 mm`, status: 'ok' }
        : { label: 'Čelna dilatacija', detail: `${endGap} mm — preozko; minimum 3 mm na spojih`, status: 'bad' },
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
      { label: 'Naklon terase', detail: '1–2 % s padcem od hiše za odtek vode (≈ 1–2 cm na meter)', status: 'info' },
      { label: 'Reža ob steni', detail: '15–20 mm pri hiši — nikoli tesno k steni', status: 'info' },
    ],
  };
}

function oknaVrataPlan(i: CraftInputs): InstallPlan {
  const count = Math.max(0, (i.windowCount ?? 0) + (i.doorCount ?? 0));
  if (count <= 0) return { buys: [], cuts: [], checks: [] };
  return {
    buys: [{ label: 'Montažna pena', detail: `≈ ${count} kosov (1 × 750 ml na odprtino) + distančni klinčki` }],
    cuts: [],
    checks: [
      { label: 'Vgradna reža', detail: '5–10 mm na stran (10–15 mm na tlorisnih straneh večjih odprtin) — meri odprtino, ne starega okna', status: 'info' },
      { label: 'Merjenje odprtine', detail: 'izmeri širino in višino na 3 mestih (zgoraj/sredina/spodaj); za merilo velja najmanjša vrednost', status: 'info' },
      { label: 'Kvadratnost odprtine', detail: 'razlika diagonal pri 90 × 120 cm naj bo ≤ 2 mm; preseganje izravni z vgradnimi klinčki', status: 'info' },
    ],
  };
}

function nadstresekPlan(i: CraftInputs): InstallPlan {
  const W = Math.max(0, i.canopyWidth ?? 0);
  const D = Math.max(0, i.canopyDepth ?? 0);
  const posts = Math.max(2, i.canopyPosts ?? 2);
  const cover = i.canopyCover ?? 'ploc';
  if (W <= 0 || D <= 0) return { buys: [], cuts: [], checks: [] };

  const postGap = posts > 1 ? r2(W / (posts - 1)) : 0;
  const minSlope = cover === 'polikar' ? 5 : cover === 'steklo' ? 10 : 7;

  return {
    buys: [],
    cuts: [],
    checks: [
      postGap > 0 && postGap <= 3
        ? { label: 'Razmak stebrov', detail: `${nf.format(postGap)} m — OK (maks. 3 m za običajno kritino)`, status: 'ok' }
        : { label: 'Razmak stebrov', detail: `${nf.format(postGap)} m — preširoko; dodaj steber ali masivnejši nosilec`, status: 'warn' },
      { label: 'Minimalni naklon kritine', detail: `${minSlope}° za ${cover === 'ploc' ? 'trapezno pločevino' : cover === 'polikar' ? 'polikarbonat' : 'steklo'} — pri manjšem naklonu uhaja voda na spojih`, status: 'info' },
      { label: 'Preklop kritine', detail: '10 % za preklope in odpad ob rezanju', status: 'info' },
      { label: 'Odvod vode', detail: (i.waterDrain ?? true) ? 'zaboj + cev po sprednji strani — vzdržuj padec ≥ 0,5 %' : 'brez odvoda — voda kaplja na sprednji rob; priporočamo zaboj', status: (i.waterDrain ?? true) ? 'ok' : 'warn' },
    ],
  };
}

function fasadaPlan(i: CraftInputs): InstallPlan {
  const perimeter = Math.max(0, i.facadePerimeter ?? 0);
  const height = Math.max(0, i.facadeHeight ?? 0);
  const openings = Math.max(0, i.openingsM2 ?? 0);
  const gross = perimeter * height;
  if (gross <= 0) return { buys: [], cuts: [], checks: [] };

  const openingShare = openings / gross;
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
        ? { label: 'Delež odprtin', detail: `${Math.round(openingShare * 100)} % bruto površine — velik delež; preveri izmero odprtin`, status: 'warn' }
        : { label: 'Delež odprtin', detail: `${Math.round(openingShare * 100)} % bruto površine — v normalnem območju`, status: 'ok' },
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
