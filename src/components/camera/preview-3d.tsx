'use client';

// ─── Lahkotni 3D predogled izmerjenih površin ───────────────
// Poligoni ('area' meritve v % slike) se izrišejo kot prizmi
// (stene po obodu + pokrov) z lastno perspektivno projekcijo
// na Canvas 2D — BREZ three.js, brez novih odvisnosti.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { MoveVertical, Orbit, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { PhotoMeasure } from '@/lib/camera-types';
import { formatCm, formatM2 } from '@/lib/measure-geometry';

// ─── Tipi ───────────────────────────────────────────────────

export interface Measure3dPreviewProps {
  measures: PhotoMeasure[];
  /** Privzeta višina prizmov v metrih (npr. iz samodejne analize). */
  defaultHeightM?: number;
}

/** Točka v 3D (metri; y = višina, tloris = x/z). */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Prizem: poligon v metrih (dno pri y = 0) + oznaka. */
interface PrismData {
  label: string;
  value: number | null;
  poly: Vec3[];
}

/** Daljica na tlorisu (dolžinska meritev). */
interface LineData {
  a: Vec3;
  b: Vec3;
  value: number | null;
}

interface SceneData {
  prisms: PrismData[];
  lines: LineData[];
}

/** Projicirana točka pred prileganjem na platno (y že obrnjena navzdol). */
interface ProjectedPt {
  x: number;
  y: number;
  depth: number;
}

/** Lice za painter's algoritem (ekranske koordinate). */
interface FaceDraw {
  pts: Array<{ x: number; y: number }>;
  depth: number;
  fill: string;
}

// ─── Konstante ──────────────────────────────────────────────

/** Privzeto merilo, če meritev nima izmerjenih strani (cm na % enoto). */
const DEFAULT_CM_PER_PCT = 10;

/** Pitch v radianih: −5° … 80°. */
const MIN_PITCH = (-5 * Math.PI) / 180;
const MAX_PITCH = (80 * Math.PI) / 180;

const INITIAL_YAW = 0.65;
const INITIAL_PITCH = 0.9;
const AUTO_ROTATE_SPEED = 0.004; // rad na kader

/** Kamera: d = 2,5 × največja velikost prizma. */
const CAMERA_DISTANCE_FACTOR = 2.5;

// Topla jantarna/stone paleta (brez modre/indigo).
const EDGE_COLOR = '#78350f';
const ROOF_FILL = 'rgba(217, 119, 6, 0.55)'; // #d97706 @ 0.55
const BOTTOM_FILL = 'rgba(120, 113, 108, 0.35)'; // sivo (stone-500)
const SIDE_LIGHT: RGB = { r: 180, g: 83, b: 9 }; // #b45309
const SIDE_DARK: RGB = { r: 146, g: 64, b: 14 }; // #92400e
const LINE_COLOR = '#4ade80'; // svetlo zelena
const LINE_TEXT = '#bbf7d0';
const LINE_HALO = 'rgba(12, 10, 9, 0.85)';
const LABEL_DARK = '#431407';
const LABEL_HALO = 'rgba(255, 243, 224, 0.9)';

/** Smer svetlobe v poglednem prostoru (normalizirana; −z = proti kameri). */
const LIGHT: Vec3 = normalize3({ x: -0.4, y: 0.75, z: -0.52 });

// ─── Pomožne funkcije ───────────────────────────────────────

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function clampPitch(p: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p));
}

/**
 * Merilo meritve v cm na % enoto: najdaljša izmerjena stran (cm)
 * / najdaljša stranica poligona v % enotah. Sicer privzeto 10 cm/%.
 */
function scaleCmPerPct(m: PhotoMeasure): number {
  const sides = m.sides;
  if (sides && sides.length > 0) {
    let maxSideCm = 0;
    for (const s of sides) maxSideCm = Math.max(maxSideCm, s);
    let maxSidePct = 0;
    const n = m.points.length;
    for (let i = 0; i < n; i++) {
      const a = m.points[i];
      const b = m.points[(i + 1) % n];
      maxSidePct = Math.max(maxSidePct, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    if (maxSideCm > 0 && maxSidePct > 1e-6) return maxSideCm / maxSidePct;
  }
  return DEFAULT_CM_PER_PCT;
}

/** % točka → svetovne koordinate v metrih (glede na skupni centroid). */
function pctToWorld(p: [number, number], scale: number, cx: number, cy: number): Vec3 {
  return {
    x: ((p[0] - cx) * scale) / 100,
    y: 0,
    z: ((p[1] - cy) * scale) / 100,
  };
}

/** Zgradi 3D sceno: prizmi iz 'area' meritev + daljice iz 'length'. */
function buildScene(measures: PhotoMeasure[]): SceneData {
  const areas = measures.filter((m) => m.kind === 'area' && m.points.length >= 3);
  if (areas.length === 0) return { prisms: [], lines: [] };

  // Skupni centroid vseh površinskih točk (izhodišče scene).
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const m of areas) {
    for (const p of m.points) {
      cx += p[0];
      cy += p[1];
      count++;
    }
  }
  if (count > 0) {
    cx /= count;
    cy /= count;
  }

  const prisms: PrismData[] = areas.map((m) => ({
    label: m.label,
    value: m.value,
    poly: m.points.map((p) => pctToWorld(p, scaleCmPerPct(m), cx, cy)),
  }));

  // Merilo za daljice: povprečje kalibriranih meril, sicer privzeto.
  const calibrated = areas
    .filter((m) => m.sides !== undefined && m.sides.length > 0)
    .map((m) => scaleCmPerPct(m));
  const lineScale =
    calibrated.length > 0
      ? calibrated.reduce((s, v) => s + v, 0) / calibrated.length
      : DEFAULT_CM_PER_PCT;

  const lines: LineData[] = measures
    .filter((m) => m.kind === 'length' && m.points.length === 2)
    .map((m) => ({
      a: pctToWorld(m.points[0], lineScale, cx, cy),
      b: pctToWorld(m.points[1], lineScale, cx, cy),
      value: m.value,
    }));

  return { prisms, lines };
}

/** Obarvaj stranico glede na osvetljenost (0–1): odtenka #92400e → #b45309. */
function sideFill(brightness: number): string {
  const r = Math.round(SIDE_DARK.r + (SIDE_LIGHT.r - SIDE_DARK.r) * brightness);
  const g = Math.round(SIDE_DARK.g + (SIDE_LIGHT.g - SIDE_DARK.g) * brightness);
  const b = Math.round(SIDE_DARK.b + (SIDE_LIGHT.b - SIDE_DARK.b) * brightness);
  const a = 0.35 + 0.15 * brightness; // alpha 0.35–0.5
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/** Besedilna oznaka na platnu (bold, z bledo obrobo za berljivost). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
  sizePx: number,
): void {
  ctx.font = `bold ${sizePx}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = halo;
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Izriše sceno: perspektivna projekcija (yaw okoli navpične + pitch),
 * painter's algoritem po povprečni globini, vsa lica prizmov,
 * daljice na tlorisu in oznake.
 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: SceneData,
  heightM: number,
  yaw: number,
  pitch: number,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const prisms = scene.prisms;
  if (prisms.length === 0) return;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  // Rotacija: yaw okoli Y (navpične), nato pitch okoli X.
  // Pozitiven pitch nagne model tako, da kamera gleda od zgoraj
  // (pokrov obrnjen proti kameri, daljni rob tlorisa višje na ekranu).
  const rotate = (p: Vec3): Vec3 => {
    const x1 = p.x * cosY + p.z * sinY;
    const z1 = -p.x * sinY + p.z * cosY;
    return { x: x1, y: p.y * cosP + z1 * sinP, z: -p.y * sinP + z1 * cosP };
  };

  // Dno (y = 0) in pokrovi (y = višina) v rotiranem prostoru.
  const rotB = prisms.map((pr) => pr.poly.map((v) => rotate({ x: v.x, y: 0, z: v.z })));
  const rotT = prisms.map((pr) => pr.poly.map((v) => rotate({ x: v.x, y: heightM, z: v.z })));
  const rotLines = scene.lines.map((ln) => ({
    a: rotate(ln.a),
    b: rotate(ln.b),
    value: ln.value,
  }));

  // Največja velikost prizmov → razdalja kamere.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const poly of rotB) {
    for (const v of poly) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
    }
  }
  const maxSize = Math.max(maxX - minX, maxZ - minZ, heightM, 0.5);
  const d = CAMERA_DISTANCE_FACTOR * maxSize;

  // Perspektivna projekcija: f = d / (d + z'); y obrnemo navzdol.
  const project = (v: Vec3): ProjectedPt => {
    const f = d / (d + v.z);
    return { x: v.x * f, y: -v.y * f, depth: v.z };
  };

  const rawB = rotB.map((poly) => poly.map(project));
  const rawT = rotT.map((poly) => poly.map(project));
  const rawLines = rotLines.map((ln) => ({
    a: project(ln.a),
    b: project(ln.b),
    value: ln.value,
  }));

  // Prileganje na platno (obroba ~7 % na stran).
  let pMinX = Infinity;
  let pMaxX = -Infinity;
  let pMinY = Infinity;
  let pMaxY = -Infinity;
  const include = (p: ProjectedPt): void => {
    pMinX = Math.min(pMinX, p.x);
    pMaxX = Math.max(pMaxX, p.x);
    pMinY = Math.min(pMinY, p.y);
    pMaxY = Math.max(pMaxY, p.y);
  };
  for (const poly of rawB) for (const p of poly) include(p);
  for (const poly of rawT) for (const p of poly) include(p);
  for (const ln of rawLines) {
    include(ln.a);
    include(ln.b);
  }
  const bw = pMaxX - pMinX;
  const bh = pMaxY - pMinY;
  const fit =
    bw > 1e-6 && bh > 1e-6
      ? Math.min((w * 0.86) / bw, (h * 0.86) / bh)
      : Math.min(w, h) / (2.8 * maxSize);
  const ox = w / 2 - ((pMinX + pMaxX) / 2) * fit;
  const oy = h / 2 - ((pMinY + pMaxY) / 2) * fit;
  const sx = (p: ProjectedPt): number => ox + p.x * fit;
  const sy = (p: ProjectedPt): number => oy + p.y * fit;

  // Vsa lica prizmov (dno, pokrov, stranske štirikotnike).
  const faces: FaceDraw[] = [];
  const pushFace = (pts: ProjectedPt[], fill: string): void => {
    let depthSum = 0;
    const screen: Array<{ x: number; y: number }> = pts.map((p) => {
      depthSum += p.depth;
      return { x: sx(p), y: sy(p) };
    });
    faces.push({ pts: screen, depth: depthSum / pts.length, fill });
  };

  for (let i = 0; i < prisms.length; i++) {
    const bRot = rotB[i];
    const tRot = rotT[i];
    pushFace(rawT[i], ROOF_FILL);
    pushFace(rawB[i], BOTTOM_FILL);

    const n = bRot.length;
    // Center prizma v rotiranem prostoru (za orientacijo normal).
    let cX = 0;
    let cY = 0;
    let cZ = 0;
    for (const v of bRot) {
      cX += v.x;
      cY += v.y;
      cZ += v.z;
    }
    cX /= n;
    cY /= n;
    cZ /= n;

    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const bi = bRot[k];
      const bj = bRot[k2];
      const ti = tRot[k];
      const tj = tRot[k2];
      // Normala kvadra v rotiranem prostoru (vedno navzven).
      const e1 = { x: bj.x - bi.x, y: bj.y - bi.y, z: bj.z - bi.z };
      const e2 = { x: ti.x - bi.x, y: ti.y - bi.y, z: ti.z - bi.z };
      let nx = e1.y * e2.z - e1.z * e2.y;
      let ny = e1.z * e2.x - e1.x * e2.z;
      let nz = e1.x * e2.y - e1.y * e2.x;
      const fcx = (bi.x + bj.x + ti.x + tj.x) / 4 - cX;
      const fcy = (bi.y + bj.y + ti.y + tj.y) / 4 - cY;
      const fcz = (bi.z + bj.z + ti.z + tj.z) / 4 - cZ;
      if (nx * fcx + ny * fcy + nz * fcz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const brightness = Math.max(
        0,
        Math.min(1, (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / nl),
      );
      pushFace([rawB[i][k], rawB[i][k2], rawT[i][k2], rawT[i][k]], sideFill(brightness));
    }
  }

  // Painter's algoritem: najprej najbolj oddaljena lica.
  faces.sort((a, b) => b.depth - a.depth);
  ctx.lineJoin = 'round';
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0].x, face.pts[0].y);
    for (let k = 1; k < face.pts.length; k++) ctx.lineTo(face.pts[k].x, face.pts[k].y);
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    ctx.strokeStyle = EDGE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Daljice na tlorisu (z = 0) — svetlo zelena, debela.
  ctx.lineCap = 'round';
  for (const ln of rawLines) {
    const ax = sx(ln.a);
    const ay = sy(ln.a);
    const bx = sx(ln.b);
    const by = sy(ln.b);
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(ax, ay, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (ln.value !== null) {
      drawLabel(ctx, formatCm(ln.value), (ax + bx) / 2, (ay + by) / 2 - 12, LINE_TEXT, LINE_HALO, 11);
    }
  }

  // Oznake površin na pokrovih (težišče pokrova, projicirano).
  for (let i = 0; i < prisms.length; i++) {
    const tRot = rotT[i];
    const n = tRot.length || 1;
    let cX = 0;
    let cY = 0;
    let cZ = 0;
    for (const v of tRot) {
      cX += v.x;
      cY += v.y;
      cZ += v.z;
    }
    const c = project({ x: cX / n, y: cY / n, z: cZ / n });
    const text = prisms[i].value !== null ? formatM2(prisms[i].value as number) : prisms[i].label;
    drawLabel(ctx, text, sx(c), sy(c), LABEL_DARK, LABEL_HALO, 12);
  }
}

// ─── Komponenta ─────────────────────────────────────────────

export function Measure3dPreview({
  measures,
  defaultHeightM,
}: Measure3dPreviewProps): JSX.Element {
  const [heightM, setHeightM] = useState(defaultHeightM ?? 2.5);
  const [autoRotate, setAutoRotate] = useState(true);

  // Refi: 3D stanje se mutira v rAF zanki / handlerjih brez re-renderjev.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ yaw: INITIAL_YAW, pitch: INITIAL_PITCH });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef({ w: 300, h: 300 });
  const heightMRef = useRef(heightM);
  const autoRotateRef = useRef(autoRotate);

  const scene = useMemo(() => buildScene(measures), [measures]);
  const sceneRef = useRef<SceneData>(scene);
  const hasPrisms = scene.prisms.length > 0;

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  useEffect(() => {
    heightMRef.current = heightM;
  }, [heightM]);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Canvas + rAF zanka — samo odjemalec, samo ko obstajajo prizmi.
  useEffect(() => {
    if (!hasPrisms) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // devicePixelRatio-aware prilagoditev velikosti.
    const resize = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const frame = (): void => {
      // Samodejna rotacija, ko uporabnik ne vleče.
      if (autoRotateRef.current && !dragRef.current) {
        viewRef.current.yaw += AUTO_ROTATE_SPEED;
        if (Math.abs(viewRef.current.yaw) > Math.PI * 4) {
          viewRef.current.yaw %= Math.PI * 4; // 4π = 2 obrata — koti enaki
        }
      }
      const { w, h } = sizeRef.current;
      drawScene(
        ctx,
        sceneRef.current,
        heightMRef.current,
        viewRef.current.yaw,
        viewRef.current.pitch,
        w,
        h,
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [hasPrisms]);

  const resetView = (): void => {
    viewRef.current.yaw = INITIAL_YAW;
    viewRef.current.pitch = INITIAL_PITCH;
  };

  if (!hasPrisms) {
    return (
      <div
        role="status"
        className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-500"
      >
        Dodaj vsaj eno površino (način Površine) in 3D predogled se prikaže tu.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="3D predogled izmerjenih površin"
        className="h-[300px] w-full cursor-grab touch-none select-none rounded-xl border bg-stone-900 active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          drag.x = e.clientX;
          drag.y = e.clientY;
          viewRef.current.yaw += dx * 0.01;
          viewRef.current.pitch = clampPitch(viewRef.current.pitch + dy * 0.01);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
      <p className="text-xs text-stone-500">
        Povleci po predogledu za obračanje · pokrovi so izmerjene površine v realnem merilu
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={autoRotate ? 'default' : 'outline'}
          className="min-h-11"
          aria-pressed={autoRotate}
          aria-label="Počasi vrti"
          onClick={() => setAutoRotate((v) => !v)}
        >
          <Orbit className="size-4" aria-hidden />
          Počasi vrti
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-label="Ponastavi pogled"
          onClick={resetView}
        >
          <RotateCcw className="size-4" aria-hidden />
          Ponastavi pogled
        </Button>
      </div>

      <div className="flex items-center gap-3 rounded-xl border bg-secondary/50 p-3">
        <MoveVertical className="size-4 shrink-0 text-stone-500" aria-hidden />
        <Slider
          value={[heightM]}
          min={0.5}
          max={6}
          step={0.1}
          aria-label="Višina prizmov v metrih"
          className="min-h-11 flex-1"
          onValueChange={(v) => {
            const next = v[0];
            if (typeof next === 'number') setHeightM(next);
          }}
        />
        <span className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
          Višina: {heightM.toFixed(2).replace('.', ',')} m
        </span>
      </div>
    </div>
  );
}
