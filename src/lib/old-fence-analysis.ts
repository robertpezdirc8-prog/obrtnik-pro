// ─── PREPOZNAJ STARO OGRAJO (kaj kamera gleda) ───────────────────────────
// Vprašanje obrtnika: »kaj je to, les ali železo, kje so vijaki, kje je romb,
// kje so navpične deske«. Odgovor mora biti IZMERJEN in iskren — ne ugiban.
//
// Vir podatkov je isti deterministični analizator kot v kameri
// (cv-engine: zasičenost, lesenost, kovinskost, Houghove premice) plus lasten
// detektor vijakov. Odločitve so izpeljane iz URADNIH podatkov ROKSAL:
//   - POLNA-100 in POLNA-128: »vijaki so vidni z lica«
//   - POLNA-57/32 in ROMB: vijaki so SKRITI (RF vijaki skozi cev zadaj)
//   - ROMB: aluminijasta cev v sredini profila
//
// ISKRENO: analizator pove, kaj VIDI, in predlaga družino profila — NE izbere
// barve (to je odločitev monterja) in ne trdi, da je stara ograja ROKSALova
// (lahko je katera koli). Zanesljivost je vedno navedena.

import { extractFeatures, type RgbaImage } from './cv-engine';

export type OldFenceMaterial = 'les' | 'kovina' | 'mešano' | 'ni jasno';
export type OldFenceOrientation = 'pokončno' | 'vodoravno' | 'ni jasno';
export type OldFenceFamily = 'polna' | 'romb' | null;

export interface OldFenceScrew {
  /** položaj v % ravnine (0–100) */
  xPct: number;
  yPct: number;
}

export interface OldFenceFinding {
  material: OldFenceMaterial;
  materialEvidence: string;
  orientation: OldFenceOrientation;
  orientationEvidence: string;
  screws: OldFenceScrew[];
  screwEvidence: string;
  /** predlog družine profila (ne barve!) */
  family: OldFenceFamily;
  familyReason: string;
  confidence: 'visoka' | 'srednja' | 'nizka';
  /** opombe za monterja (npr. da gre za zamenjavo materiala) */
  notes: string[];
}

export interface OldFenceInput {
  /** delovna kopija fotke (RGBA) */
  rgba: Uint8Array;
  W: number;
  H: number;
  /** štirikotnik ravnine v % slike (tl, tr, br, bl) */
  quadPct: [number, number][];
}

/** Izreže štirikotnik ravnine v pravokotno sliko. */
function cropQuad(
  input: OldFenceInput,
): { data: Uint8Array; W: number; H: number } | null {
  const { rgba, W, H, quadPct } = input;
  if (quadPct.length !== 4) return null;
  const xs = quadPct.map(([x]) => x);
  const ys = quadPct.map(([, y]) => y);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) / 100) * W));
  const x1 = Math.min(W, Math.ceil((Math.max(...xs) / 100) * W));
  const y0 = Math.max(0, Math.floor((Math.min(...ys) / 100) * H));
  const y1 = Math.min(H, Math.ceil((Math.max(...ys) / 100) * H));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 8 || ch < 8) return null;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = ((y0 + y) * W + (x0 + x)) * 4;
      const d = (y * cw + x) * 4;
      out[d] = rgba[s] ?? 0;
      out[d + 1] = rgba[s + 1] ?? 0;
      out[d + 2] = rgba[s + 2] ?? 0;
      out[d + 3] = 255;
    }
  }
  return { data: out, W: cw, H: ch };
}

/** Detektor vijakov: majhne temne pike znotraj svetlejših desk. */
function findScrews(rgba: Uint8Array, W: number, H: number): OldFenceScrew[] {
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
  }
  // integralna slika (hitro lokalno povprečje)
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      integral[(y + 1) * (W + 1) + (x + 1)] =
        integral[y * (W + 1) + (x + 1)] + integral[(y + 1) * (W + 1) + x] - integral[y * (W + 1) + x] + gray[y * W + x];
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number): number =>
    integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];
  const R = Math.max(1, Math.round(Math.min(W, H) / 90)); // polmer iskanega vijaka
  const found: OldFenceScrew[] = [];
  const minContrast = 26;
  const step = Math.max(1, Math.round(R / 2));
  for (let y = R; y < H - R; y += step) {
    for (let x = R; x < W - R; x += step) {
      const local = sum(x - R, y - R, x + R, y + R) / (4 * R * R);
      const c = gray[y * W + x];
      if (local - c < minContrast) continue;
      // okrog mora biti enakomeren (pika, ne rob deske)
      const ring =
        (sum(x - R, y - R, x + R, y + R) - sum(x - 1, y - 1, x + 1, y + 1)) / (4 * R * R - 4);
      if (Math.abs(ring - local) > 18) continue;
      const xp = (x / W) * 100;
      const yp = (y / H) * 100;
      if (found.some((f) => Math.abs(f.xPct - xp) < 2.5 && Math.abs(f.yPct - yp) < 2.5)) continue;
      found.push({ xPct: xp, yPct: yp });
    }
  }
  return found;
}


/**
 * Delež materiala proti ozadju, z Otsujevim pragom.
 *
 * Otsu izbere prag, ki najbolj loči svetlo (material) od temnega (reža/ozadje)
 * — to je klasična, deterministična metoda brez ugibanja. Za deske WPC
 * (velike ploskve + ozke reže) je svetlih ~80 %, za železno ograjo (tanke
 * palice, med njimi pa vidna hiša) pa ~15 %. Meja 72 % / 42 % je izmerjena na
 * sintetičnih primerih (tests/verify/old-fence-analysis.ts).
 */
function materialShares(rgba: Uint8Array, W: number, H: number): { bright: number; dark: number; separation: number } {
  const n = W * H;
  const hist = new Float64Array(256);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    lum[i] = v;
    hist[Math.max(0, Math.min(255, Math.round(v)))] += 1;
  }
  // Otsu: prag z največjo medrazredno varianco
  let total = 0;
  let sum = 0;
  for (let t = 0; t < 256; t++) { total += hist[t]; sum += hist[t] * t; }
  let wB = 0; let sumB = 0; let best = 0; let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += hist[t] * t;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  // Sredini razredov iz HISTOGRAMA (ne iz piksljev) in meja med njima:
  // s tem piksel, ki je tik nad pragom, ne skoči v svetli razred.
  let sB = 0; let cB = 0; let sD = 0; let cD = 0;
  for (let t = 0; t < 256; t++) {
    if (t > best) { sB += hist[t] * t; cB += hist[t]; }
    else { sD += hist[t] * t; cD += hist[t]; }
  }
  const mB = cB ? sB / cB : 0;
  const mD = cD ? sD / cD : 0;
  const mid = (mB + mD) / 2;
  let bright = 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] > mid) bright++;
    else dark++;
  }
  return { bright: bright / n, dark: dark / n, separation: Math.abs(mB - mD) };
}

/** Glavna analiza stare ograje znotraj označene ravnine. */
export function analyseOldFence(input: OldFenceInput): OldFenceFinding {
  const crop = cropQuad(input);
  const notes: string[] = [];
  if (!crop) {
    return {
      material: 'ni jasno',
      materialEvidence: 'Označena ravnina je premajhna za analizo.',
      orientation: 'ni jasno',
      orientationEvidence: '—',
      screws: [],
      screwEvidence: '—',
      family: null,
      familyReason: 'Ni podatka.',
      confidence: 'nizka',
      notes: ['Najprej označi ravnino (štirikotnik) in potrdi umerjanje.'],
    };
  }
  const img: RgbaImage = { data: new Uint8ClampedArray(crop.data), width: crop.W, height: crop.H };
  const f = extractFeatures(img);

  // ── material: koliko je MATERIALA proti OZADJU med elementi ─────────────
  // Merilo je razumljivo in preverljivo: deske z ozkimi režami (WPC) zapolnijo
  // velik delež ravnine, železna ograja pa ima med palicami vidno ozadje
  // (hiša, drevo, nebo). Zato gledamo delež SVEŽIH pikslov (material) proti
  // TEMNIM (reža/ozadje) — srednjega odtenka ne uporabljamo.
  let material: OldFenceMaterial = 'ni jasno';
  const shares = materialShares(crop.data, crop.W, crop.H);
  let materialEvidence =
    `material ${(shares.bright * 100).toFixed(0)} % : ozadje/reže ${(shares.dark * 100).toFixed(0)} %`;
  if (shares.bright + shares.dark < 0.35 || shares.separation < 16) {
    material = 'ni jasno';
    materialEvidence += ` — premalo kontrasta (razlika svetlo/temno ${shares.separation.toFixed(0)}) za sklepanje o materialu`;
  } else if (shares.bright / (shares.bright + shares.dark) > 0.72) {
    material = 'les';
    materialEvidence += ' — prevladujejo široke ploskve (deske z ozkimi režami)';
  } else if (shares.bright / (shares.bright + shares.dark) < 0.42) {
    material = 'kovina';
    materialEvidence += ' — med elementi je vidno ozadje (mreža/železo)';
    notes.push('Stara ograja je kovinska: gre za ZAMENJAVO MATERIALA, ne le obloge.');
  } else {
    material = 'mešano';
    materialEvidence += ' — material in ozadje sta v približnem deležu';
  }

  // ── orientacija ──
  const v = f.verticals.length;
  const h = f.horizontals.length;
  let orientation: OldFenceOrientation = 'ni jasno';
  let orientationEvidence = `navpičnih premic ${v}, vodoravnih ${h}`;
  if (v >= 6 && v >= h * 1.6) {
    orientation = 'pokončno';
    orientationEvidence += ' — prevladujejo navpične deske';
  } else if (h >= 6 && h >= v * 1.6) {
    orientation = 'vodoravno';
    orientationEvidence += ' — prevladujejo vodoravne deske';
  }

  // ── vijaki ──
  const screws = findScrews(crop.data, crop.W, crop.H);
  const screwEvidence =
    screws.length === 0
      ? 'Vijakov ni mogoče najti — ali so skriti (pri 57/32 in ROMB so skriti).'
      : `Najdenih ${screws.length} temnih pike (vijakov) v ravnini.`;

  // ── predlog družine ──
  let family: OldFenceFamily = null;
  let familyReason = 'Ni zadostnih znakov — izberi profil sam.';
  if (orientation === 'pokončno' && screws.length >= 3) {
    family = 'polna';
    familyReason =
      'Pokončne deske z VIDNIMI vijaki → po ROKSALovih podatkih je to družina POLNA (pri 57/32 in ROMB so vijaki skriti).';
  } else if (orientation === 'vodoravno') {
    family = 'romb';
    familyReason = 'Vodoravne deske → ROMB (profil z alu cevjo v sredini, skrito vijačenje).';
  } else if (orientation === 'pokončno' && material === 'les') {
    family = 'polna';
    familyReason = 'Pokončne lesene/WPC deske brez vidnih vijakov → družina POLNA (morda 57/32, kjer so vijaki skriti).';
  }

  const confidence: OldFenceFinding['confidence'] =
    material === 'ni jasno' || orientation === 'ni jasno' ? 'nizka' : screws.length >= 3 ? 'visoka' : 'srednja';

  return {
    material,
    materialEvidence,
    orientation,
    orientationEvidence,
    screws: screws
      .slice(0, 24)
      .map((s) => ({ xPct: Math.round(s.xPct * 10) / 10, yPct: Math.round(s.yPct * 10) / 10 })),
    screwEvidence,
    family,
    familyReason,
    confidence,
    notes,
  };
}

