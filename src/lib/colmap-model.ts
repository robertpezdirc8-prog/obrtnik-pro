// ─── COLMAP model (SfM rekonstrukcija) — parser + iskreno merjenje ───
// Uradni besedilni format (colmap.github.io/format.html): sparse model iz
// treh datotek — cameras.txt (intrinzika), images.txt (poze, 2 vrstici na
// fotko), points3D.txt (oblak točk z barvami). Obseg uporabe pri nas:
// monter rekonstruira objekt (ograja/vogal/stopnice/teren) kjer koli
// (namizni COLMAP, brskalniški port, …), pri nas ga uvozi, KALIBRIRA
// merilo z ZNANO dolžino in meri razdalje med točkami.
// ISKRENOST: brez kalibracije so razdalje v poljubnih enotah modela
// (nastavek je poljuben) — takrat merjenja NE shranjujemo v meritve.
// Po kalibraciji je kakovost CALIBRATED (znana referenca), ne CONFIRMED.

export interface ColmapCamera {
  id: number;
  model: string;
  width: number;
  height: number;
  params: number[];
}

export interface ColmapPoint {
  id: number;
  xyz: [number, number, number];
  rgb: [number, number, number];
  error: number;
  trackCount: number;
}

export interface ColmapImage {
  id: number;
  name: string;
  cameraId: number;
  /** Center kamere = −Rᵗ·T (uradna spec; R iz kvaterniona, Hamilton). */
  center: [number, number, number];
  /** POINT3D_ID vrednosti opazanih točk (−1 se izpusti). */
  observedPointIds: number[];
}

export interface ColmapModel {
  cameras: ColmapCamera[];
  images: ColmapImage[];
  points: ColmapPoint[];
}

// ─── Notranja orodja ──────────────────────────────────────────────

/** Vrstice brez komentarjev (#) in praznih — z zapomnjenim izvornim številom. */
function dataLines(text: string): { parts: string[]; lineNo: number }[] {
  const out: { parts: string[]; lineNo: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    out.push({ parts: trimmed.split(/\s+/), lineNo: i + 1 });
  }
  return out;
}

function num(parts: string[], i: number, lineNo: number, file: string): number {
  const raw = parts[i];
  if (raw === undefined) {
    throw new Error(`${file}: vrstica ${lineNo} — manjka številski vnos na mestu ${i + 1}`);
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    throw new Error(`${file}: vrstica ${lineNo} — »${raw}« ni veljavna številka`);
  }
  return v;
}

/** Kvaternion (Hamilton, w x y z) → 3×3 rotacijska matrika. */
export function quatToRotationMatrix(
  qw: number,
  qx: number,
  qy: number,
  qz: number,
): number[][] {
  // Normalizacija — robusnost na zaokrožene vrednosti v datotekah
  const n = Math.hypot(qw, qx, qy, qz) || 1;
  const w = qw / n;
  const x = qx / n;
  const y = qy / n;
  const z = qz / n;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/** Center kamere = −Rᵗ·T (uradna specifikacija images.txt). */
export function cameraCenterFromPose(
  qw: number,
  qx: number,
  qy: number,
  qz: number,
  tx: number,
  ty: number,
  tz: number,
): [number, number, number] {
  const R = quatToRotationMatrix(qw, qx, qy, qz);
  // Rᵗ·T (R je ortogonalna, transponirana = inverse)
  const rtx = R[0][0] * tx + R[1][0] * ty + R[2][0] * tz;
  const rty = R[0][1] * tx + R[1][1] * ty + R[2][1] * tz;
  const rtz = R[0][2] * tx + R[1][2] * ty + R[2][2] * tz;
  return [-rtx, -rty, -rtz];
}

// ─── Parserji posameznih datotek ─────────────────────────────────

export function parseCamerasTxt(text: string): ColmapCamera[] {
  const rows = dataLines(text);
  if (rows.length === 0) {
    throw new Error('cameras.txt: ni podatkovnih vrstic — model brez kamer ni veljaven');
  }
  const seen = new Set<number>();
  const out: ColmapCamera[] = [];
  for (const { parts, lineNo } of rows) {
    const id = num(parts, 0, lineNo, 'cameras.txt');
    if (seen.has(id)) {
      throw new Error(`cameras.txt: vrstica ${lineNo} — podvojen CAMERA_ID ${id}`);
    }
    seen.add(id);
    const model = parts[1];
    if (!model) throw new Error(`cameras.txt: vrstica ${lineNo} — manjka MODEL`);
    const width = num(parts, 2, lineNo, 'cameras.txt');
    const height = num(parts, 3, lineNo, 'cameras.txt');
    if (width <= 0 || height <= 0) {
      throw new Error(`cameras.txt: vrstica ${lineNo} — mere slike morajo biti > 0`);
    }
    const params: number[] = [];
    for (let i = 4; i < parts.length; i++) params.push(num(parts, i, lineNo, 'cameras.txt'));
    out.push({ id, model, width, height, params });
  }
  return out;
}

export function parseImagesTxt(text: string): ColmapImage[] {
  const rows = dataLines(text);
  if (rows.length === 0) {
    throw new Error('images.txt: ni podatkovnih vrstic — model brez fotk ni veljaven');
  }
  if (rows.length % 2 !== 0) {
    throw new Error(
      `images.txt: liho število vrstic (${rows.length}) — vsaka fotka ima POZE + TOČKE (2 vrstici)`,
    );
  }
  const seen = new Set<number>();
  const out: ColmapImage[] = [];
  for (let r = 0; r < rows.length; r += 2) {
    const pose = rows[r];
    const pts = rows[r + 1];
    const lineNo = pose.lineNo;
    const id = num(pose.parts, 0, lineNo, 'images.txt');
    if (seen.has(id)) {
      throw new Error(`images.txt: vrstica ${lineNo} — podvojen IMAGE_ID ${id}`);
    }
    seen.add(id);
    const qw = num(pose.parts, 1, lineNo, 'images.txt');
    const qx = num(pose.parts, 2, lineNo, 'images.txt');
    const qy = num(pose.parts, 3, lineNo, 'images.txt');
    const qz = num(pose.parts, 4, lineNo, 'images.txt');
    const tx = num(pose.parts, 5, lineNo, 'images.txt');
    const ty = num(pose.parts, 6, lineNo, 'images.txt');
    const tz = num(pose.parts, 7, lineNo, 'images.txt');
    const cameraId = num(pose.parts, 8, lineNo, 'images.txt');
    const name = pose.parts.slice(9).join(' ') || `slika-${id}`;
    const center = cameraCenterFromPose(qw, qx, qy, qz, tx, ty, tz);
    // 2. vrstica: X Y POINT3D_ID trojke; −1 = neopazovana → izpusti
    const observedPointIds: number[] = [];
    for (let i = 0; i + 2 < pts.parts.length; i += 3) {
      num(pts.parts, i, pts.lineNo, 'images.txt'); // X — veljavnost
      num(pts.parts, i + 1, pts.lineNo, 'images.txt'); // Y — veljavnost
      const pid = num(pts.parts, i + 2, pts.lineNo, 'images.txt');
      if (pid !== -1) observedPointIds.push(pid);
    }
    out.push({ id, name, cameraId, center, observedPointIds });
  }
  return out;
}

export function parsePoints3DTxt(text: string): ColmapPoint[] {
  const rows = dataLines(text);
  if (rows.length === 0) {
    throw new Error('points3D.txt: ni podatkovnih vrstic — prazen oblak ne podpira merjenja');
  }
  const seen = new Set<number>();
  const out: ColmapPoint[] = [];
  for (const { parts, lineNo } of rows) {
    if (parts.length < 8) {
      throw new Error(
        `points3D.txt: vrstica ${lineNo} — pričakovano vsaj 8 polj (ID, X, Y, Z, R, G, B, ERROR)`,
      );
    }
    const id = num(parts, 0, lineNo, 'points3D.txt');
    if (seen.has(id)) {
      throw new Error(`points3D.txt: vrstica ${lineNo} — podvojen POINT3D_ID ${id}`);
    }
    seen.add(id);
    const x = num(parts, 1, lineNo, 'points3D.txt');
    const y = num(parts, 2, lineNo, 'points3D.txt');
    const z = num(parts, 3, lineNo, 'points3D.txt');
    const r = num(parts, 4, lineNo, 'points3D.txt');
    const g = num(parts, 5, lineNo, 'points3D.txt');
    const b = num(parts, 6, lineNo, 'points3D.txt');
    const error = num(parts, 7, lineNo, 'points3D.txt');
    const trackCount = Math.floor((parts.length - 8) / 2);
    out.push({
      id,
      xyz: [x, y, z],
      rgb: [
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b))),
      ],
      error,
      trackCount,
    });
  }
  return out;
}

/** Združi tri datoteke v model z izrecnimi napakami o manjkajočih ID-jih. */
export function parseColmapModel(files: {
  cameras: string;
  images: string;
  points3D: string;
}): ColmapModel {
  const cameras = parseCamerasTxt(files.cameras);
  const images = parseImagesTxt(files.images);
  const points = parsePoints3DTxt(files.points3D);
  const cameraIds = new Set(cameras.map((c) => c.id));
  for (const img of images) {
    if (!cameraIds.has(img.cameraId)) {
      throw new Error(
        `images.txt: fotka ${img.id} (${img.name}) skliče CAMERA_ID ${img.cameraId}, ki ga v cameras.txt ni`,
      );
    }
  }
  const pointIds = new Set(points.map((p) => p.id));
  for (const img of images) {
    for (const pid of img.observedPointIds) {
      if (!pointIds.has(pid)) {
        throw new Error(
          `images.txt: fotka ${img.id} opazuje točko ${pid}, ki je v points3D.txt ni (preveri, da so datoteke iz ISTEGA izvoza)`,
        );
      }
    }
  }
  return { cameras, images, points };
}

// ─── Geometrija / merjenje ───────────────────────────────────────

export function modelPointById(model: ColmapModel, id: number): ColmapPoint | null {
  return model.points.find((p) => p.id === id) ?? null;
}

/** Evklidska razdalja med dvema točkama v ENOTAH MODELA (merilo je poljubno!). */
export function modelDistanceUnits(model: ColmapModel, idA: number, idB: number): number | null {
  const a = modelPointById(model, idA);
  const b = modelPointById(model, idB);
  if (!a || !b) return null;
  return Math.hypot(a.xyz[0] - b.xyz[0], a.xyz[1] - b.xyz[1], a.xyz[2] - b.xyz[2]);
}

/**
 * Merilo: koliko cm realnega sveta je 1 enota modela. Vrne null za
 * neuporabne vhode (≤ 0 ali ne-finite) — brez tihega popavljanja.
 */
export function calibrateScale(modelUnits: number | null | undefined, realCm: number | null | undefined): number | null {
  if (
    typeof modelUnits !== 'number' || !Number.isFinite(modelUnits) || modelUnits <= 0 ||
    typeof realCm !== 'number' || !Number.isFinite(realCm) || realCm <= 0
  ) {
    return null;
  }
  return realCm / modelUnits;
}

/** Razdalja v cm: enote × merilo. Merilo mora biti že kalibrirano (> 0). */
export function scaledDistanceCm(units: number, scale: number): number | null {
  if (!Number.isFinite(units) || units < 0 || !Number.isFinite(scale) || scale <= 0) return null;
  return units * scale;
}

export interface ModelBBox {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  /** Diagonala ovojnice v enotah modela (za threshold izbire točk). */
  diag: number;
}

/** Ovojnica oblaka — null za prazen seznam. */
export function modelBBox(points: ColmapPoint[]): ModelBBox | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const [x, y, z] = p.xyz;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, diag };
}
