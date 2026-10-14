'use client';

// ─── 3D model objekta (COLMAP SfM uvoz) — oblak točk + merjenje ───
// Monter rekonstruira objekt kjer koli (namizni COLMAP, brskalniški port),
// pri nas uvozi cameras.txt / images.txt / points3D.txt, KALIBRIRA merilo
// z znano dolžino med dvema točkama in meri razdalje po modelu.
// Iskrenost: brez kalibracije so enote modela poljubne — merjenja se ne
// shranjujejo; po kalibraciji je kakovost CALIBRATED (znana referenca).
// `three` se uvaža DINAMIČNO šele ob prvem modelu (SSR-varno).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as ThreeNs from 'three';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Boxes,
  Check,
  Crosshair,
  FileText,
  Info,
  Ruler,
  Trash2,
  X,
} from 'lucide-react';
import {
  calibrateScale,
  modelBBox,
  modelDistanceUnits,
  modelPointById,
  parseColmapModel,
  scaledDistanceCm,
  type ColmapModel,
} from '@/lib/colmap-model';
import { formatCm } from '@/lib/measure-geometry';

export interface Colmap3dProps {
  /** Pokliče se ob zaključku za vsako shranjeno razdaljo (cm). */
  onAddMeasure: (label: string, cm: number) => void;
  disabled?: boolean;
}

/** Največ točk v izrisu (nadebra se vzorči s korakom — merjenje ostane polno). */
const MAX_RENDER_POINTS = 200_000;

type ModelFiles = {
  cameras: string | null;
  images: string | null;
  points3D: string | null;
};

interface Pair {
  idA: number;
  idB: number;
  units: number;
}

interface SavedMeasure {
  units: number;
}

/** Preberi datoteko kot besedilo (FileReader — vedno kliče iz odjemalca). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Datoteke ${file.name} ni bilo mogoče prebrati.`));
    reader.readAsText(file);
  });
}

/** Minimalni tip OrbitControls (brez polnih tipov examples). */
interface ControlsLike {
  dispose(): void;
  update(): void;
  target: { set(x: number, y: number, z: number): void };
  enableDamping: boolean;
  dampingFactor: number;
}

export function Colmap3d({ onAddMeasure, disabled = false }: Colmap3dProps): JSX.Element {
  const [model, setModel] = useState<ColmapModel | null>(null);
  const [files, setFiles] = useState<ModelFiles>({ cameras: null, images: null, points3D: null });
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** null = še neve, false = WebGL ni na voljo (3D izris preskočen). */
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  // Par + kalibracija
  const [pair, setPair] = useState<Pair | null>(null);
  const [scale, setScale] = useState<number | null>(null); // cm na enoto modela
  const [refCm, setRefCm] = useState('');
  const [saved, setSaved] = useState<SavedMeasure[]>([]);
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');

  // three notranjost
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ThreeNs.WebGLRenderer | null>(null);
  const controlsRef = useRef<ControlsLike | null>(null);
  const pointsRef = useRef<ThreeNs.Points | null>(null);
  const cameraRef = useRef<ThreeNs.PerspectiveCamera | null>(null);
  const raycasterRef = useRef<ThreeNs.Raycaster | null>(null);
  const markersRef = useRef<ThreeNs.Object3D[]>([]);
  const disposablesRef = useRef<{ dispose(): void }[]>([]);
  const canvasCleanupRef = useRef<(() => void) | null>(null);
  const modelRef = useRef<ColmapModel | null>(null);
  /** Postavitev izbirnega markerja (three scena, izven React stanja). */
  const setMarkerRef = useRef<((xyz: [number, number, number]) => void) | null>(null);
  /** Render-on-demand — brez zanke 60 fps (SwiftShader/baterija). */
  const renderOnceRef = useRef<(() => void) | null>(null);
  /** Zadnji handler izbora — canvas poslušalci ga berejo prek refa (brez stale). */
  const handlePickRef = useRef<(id: number, xyz: [number, number, number]) => void>(() => {});

  // ── Počisti three vire (idempotentno) ──
  const disposeThree = useCallback((): void => {
    canvasCleanupRef.current?.();
    canvasCleanupRef.current = null;
    controlsRef.current?.dispose();
    controlsRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      try {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer.forceContextLoss();
      } catch {
        // kontekst je že sproščen
      }
      renderer.domElement.remove();
    }
    rendererRef.current = null;
    pointsRef.current = null;
    cameraRef.current = null;
    raycasterRef.current = null;
    markersRef.current = [];
    disposablesRef.current.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // vir je že sproščen
      }
    });
    disposablesRef.current = [];
  }, []);

  // ── Izbor točke (iz klika ali ID vnosa) ──
  const handlePick = useCallback((id: number, xyz: [number, number, number]): void => {
    const m = modelRef.current;
    if (!m) return;
    setError(null);
    setPair((prevPair) => {
      if (!prevPair) return { idA: id, idB: 0, units: 0 };
      if (id === prevPair.idA || prevPair.idB !== 0) return null; // začni nov par
      const units = modelDistanceUnits(m, prevPair.idA, id);
      if (units === null) {
        setError(`Točke ${prevPair.idA} in ${id} nista v modelu.`);
        return null;
      }
      return { idA: prevPair.idA, idB: id, units };
    });
    setMarkerRef.current?.(xyz);
  }, []);

  useEffect(() => {
    handlePickRef.current = handlePick;
  }, [handlePick]);

  // ── Izris modela (dinamičen uvoz three) ──
  const renderModel = useCallback(
    async (m: ColmapModel): Promise<void> => {
      const host = hostRef.current;
      if (!host) return;
      disposeThree();
      const THREE = (await import('three')) as typeof ThreeNs;
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const disposables: { dispose(): void }[] = [];
      disposablesRef.current = disposables;

      const bbox = modelBBox(m.points);
      if (!bbox || bbox.diag <= 0) {
        setError('Model nima veljavne ovojnice (vse točke so ista točka ali razpade).');
        return;
      }

      // WebGL sonda — če brskalnik ne zna izrisati (starejše naprave, blokiran
      // WebGL), merjenje po ID ostane popolnoma delujoče, samo 3D pogled ni.
      const probe = document.createElement('canvas');
      const glOk = !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
      if (!glOk) {
        setWebglOk(false);
        return;
      }
      setWebglOk(true);

      const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(Math.max(1, host.clientWidth), Math.max(260, host.clientHeight));
      host.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf5f5f4); // stone-100 (topla tema)

      const camera = new THREE.PerspectiveCamera(
        55,
        Math.max(1, host.clientWidth) / Math.max(1, Math.max(260, host.clientHeight)),
        bbox.diag / 1000,
        bbox.diag * 20,
      );
      camera.position.set(
        bbox.center[0] + bbox.diag * 0.65,
        bbox.center[1] + bbox.diag * 0.5,
        bbox.center[2] + bbox.diag * 0.8,
      );
      cameraRef.current = camera;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(bbox.center[0], bbox.center[1], bbox.center[2]);
      // Brez dampinga — izris samo ob spremembi (render-on-demand, brez zanke)
      controls.enableDamping = false;
      controlsRef.current = controls as unknown as ControlsLike;

      // Mreža za orientacijo (diskretna, topla)
      const grid = new THREE.GridHelper(bbox.diag * 1.4, 12, 0xd6d3d1, 0xe7e5e4);
      grid.position.set(bbox.center[0], bbox.min[1], bbox.center[2]);
      scene.add(grid);
      disposables.push(grid.geometry, grid.material as { dispose(): void });

      // Oblak točk (vzorčenje, če je ogromno)
      const stride = Math.max(1, Math.ceil(m.points.length / MAX_RENDER_POINTS));
      const shown = Math.floor(m.points.length / stride);
      const positions = new Float32Array(shown * 3);
      const colors = new Float32Array(shown * 3);
      for (let i = 0; i < shown; i++) {
        const p = m.points[i * stride];
        positions[i * 3] = p.xyz[0];
        positions[i * 3 + 1] = p.xyz[1];
        positions[i * 3 + 2] = p.xyz[2];
        colors[i * 3] = p.rgb[0] / 255;
        colors[i * 3 + 1] = p.rgb[1] / 255;
        colors[i * 3 + 2] = p.rgb[2] / 255;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: bbox.diag * 0.008,
        vertexColors: true,
        sizeAttenuation: true,
      });
      disposables.push(geo, mat);
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      pointsRef.current = points;

      // Pozicije fotk (bordo oktaedri)
      const camGeo = new THREE.OctahedronGeometry(bbox.diag * 0.014);
      const camMat = new THREE.MeshBasicMaterial({ color: 0x9f1239 });
      disposables.push(camGeo, camMat);
      for (const img of m.images) {
        const marker = new THREE.Mesh(camGeo, camMat);
        marker.position.set(img.center[0], img.center[1], img.center[2]);
        scene.add(marker);
        markersRef.current.push(marker);
      }

      const raycaster = new THREE.Raycaster();
      raycaster.params.Points = { threshold: bbox.diag * 0.014 };
      raycasterRef.current = raycaster;

      // Izbirni markerji — izmenično A (jantarno) → B (zeleno)
      const dotGeoA = new THREE.SphereGeometry(bbox.diag * 0.012, 12, 8);
      const dotGeoB = new THREE.SphereGeometry(bbox.diag * 0.012, 12, 8);
      const matA = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const matB = new THREE.MeshBasicMaterial({ color: 0x16a34a });
      disposables.push(dotGeoA, dotGeoB, matA, matB);
      let pickStage: 'A' | 'B' = 'A';
      const renderOnce = (): void => {
        renderer.render(scene, camera);
      };
      renderOnceRef.current = renderOnce;
      controls.addEventListener('change', renderOnce);
      renderOnce(); // začetni izris
      setMarkerRef.current = (xyz) => {
        const which = pickStage;
        // odstrani prejšnji marker iste stopnje
        markersRef.current = markersRef.current.filter((o) => {
          if (o.userData.pick === which) {
            scene.remove(o);
            return false;
          }
          return true;
        });
        const dot = new THREE.Mesh(which === 'A' ? dotGeoA : dotGeoB, which === 'A' ? matA : matB);
        dot.position.set(xyz[0], xyz[1], xyz[2]);
        dot.userData.pick = which;
        scene.add(dot);
        markersRef.current.push(dot);
        pickStage = which === 'A' ? 'B' : 'A';
        renderOnce(); // izris ob novi točki
      };

      // Klik = izbor točke (raycast na oblak); vlečenje (vrtenje) ni klik
      const canvas = renderer.domElement;
      canvas.style.touchAction = 'none';
      let downPos: { x: number; y: number } | null = null;
      const onPointerDown = (ev: PointerEvent): void => {
        downPos = { x: ev.clientX, y: ev.clientY };
      };
      const onPointerUp = (ev: PointerEvent): void => {
        if (!downPos) return;
        const dx = ev.clientX - downPos.x;
        const dy = ev.clientY - downPos.y;
        downPos = null;
        if (Math.hypot(dx, dy) > 6) return; // to je bilo vrtenje, ne klik
        const pts = pointsRef.current;
        const cam = cameraRef.current;
        const ray = raycasterRef.current;
        if (!pts || !cam || !ray) return;
        const rect = canvas.getBoundingClientRect();
        const nx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ny = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
        ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
        const hits = ray.intersectObject(pts);
        const hit = hits[0];
        if (!hit || hit.index === undefined) return;
        const modelPoint = m.points[hit.index * stride];
        if (!modelPoint) return;
        handlePickRef.current(modelPoint.id, modelPoint.xyz);
      };
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerup', onPointerUp);
      canvasCleanupRef.current = () => {
        controls.removeEventListener('change', renderOnce);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
      };
    },
    [disposeThree],
  );

  // ── Par po ID (dostopna + E2E pot) ──
  const pickByIds = useCallback((): void => {
    const m = modelRef.current;
    if (!m) return;
    const a = Number(idA);
    const b = Number(idB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
      setError('Vnesi dva različna ID točk iz modela.');
      return;
    }
    const pa = modelPointById(m, a);
    const pb = modelPointById(m, b);
    if (!pa || !pb) {
      setError(`Ena od točk (${a}, ${b}) v modelu ni.`);
      return;
    }
    const units = modelDistanceUnits(m, a, b);
    if (units === null) return;
    setMarkerRef.current?.(pa.xyz);
    setMarkerRef.current?.(pb.xyz);
    setPair({ idA: a, idB: b, units });
    setRefCm('');
    setError(null);
  }, [idA, idB]);

  // ── Kalibracija merila iz trenutnega para ──
  const calibrate = useCallback((): void => {
    if (!pair) return;
    const realCm = Number(refCm.replace(',', '.'));
    const s = calibrateScale(pair.units, realCm);
    if (s === null) {
      setError('Znano dolžino vnesi kot pozitivno številko (cm).');
      return;
    }
    setScale(s);
    setError(null);
  }, [pair, refCm]);

  // ── Dodaj trenutni par v seznam (samo kalibrirano!) ──
  const addPair = useCallback((): void => {
    if (!pair || scale === null || pair.idB === 0) return;
    setSaved((prev) => [...prev, { units: pair.units }]);
    setPair(null);
    setRefCm('');
  }, [pair, scale]);

  // ── Zaključi in shrani: vsaka razdalja → onAddMeasure('3D n', cm) ──
  const finishAndSave = useCallback((): void => {
    if (scale === null || saved.length === 0) return;
    saved.forEach((m, i) => {
      const cm = scaledDistanceCm(m.units, scale);
      if (cm !== null && cm > 0) onAddMeasure(`3D ${i + 1}`, Math.round(cm * 10) / 10);
    });
    setSaved([]);
  }, [saved, scale, onAddMeasure]);

  // ── Uvoz datotek ──
  const onFileChange = useCallback(
    async (which: keyof ModelFiles, file: File | null): Promise<void> => {
      if (!file) return;
      try {
        const text = await readFileText(file);
        const next: ModelFiles = { ...files, [which]: text };
        setFiles(next);
        setError(null);
        if (next.cameras && next.images && next.points3D) {
          try {
            const m = parseColmapModel({
              cameras: next.cameras,
              images: next.images,
              points3D: next.points3D,
            });
            modelRef.current = m;
            setModel(m);
            setPair(null);
            setSaved([]);
            setScale(null);
            await renderModel(m);
          } catch (e) {
            setModel(null);
            modelRef.current = null;
            setError(e instanceof Error ? e.message : 'Uvoz modela ni uspel.');
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Branje datoteke ni uspelo.');
      }
    },
    [files, renderModel],
  );

  // ── Cleanup ob unmount ──
  useEffect(() => {
    return () => {
      disposeThree();
    };
  }, [disposeThree]);

  // ── Izračuni za prikaz ──
  const pairCm = pair && pair.idB !== 0 && scale !== null ? scaledDistanceCm(pair.units, scale) : null;
  const savedCm = saved.map((m) => (scale !== null ? scaledDistanceCm(m.units, scale) : null));

  return (
    <div className="space-y-3 rounded-xl border p-4">
      {/* Glava */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">3D model objekta (COLMAP)</h3>
        </div>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-600">
          Napredno
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Rekonstruiraj objekt iz več fotk z COLMAP-om (namizno ali v brskalniku), uvozi model,
        kalibriraj merilo z znano dolžino in meri razdalje med točkami po celem objektu.
      </p>

      {/* Uvoz datotek */}
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ['cameras', 'cameras.txt'],
            ['images', 'images.txt'],
            ['points3D', 'points3D.txt'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {label}
            </span>
            <input
              type="file"
              accept=".txt,text/plain"
              disabled={disabled}
              onChange={(e) => void onFileChange(key, e.target.files?.[0] ?? null)}
              aria-label={`Uvozi ${label}`}
              className="block w-full rounded-xl border bg-background p-2 text-xs file:mr-2 file:min-h-9 file:rounded-lg file:border-0 file:bg-secondary file:px-2 file:text-xs"
            />
          </label>
        ))}
      </div>

      {/* Povzetek modela */}
      {model && (
        <div className="rounded-xl bg-secondary/50 p-3 text-sm" role="status">
          <p className="font-medium">
            Model naložen: {model.images.length} fotk, {model.cameras.length} kamer,{' '}
            {model.points.length.toLocaleString('sl-SI')} točk
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {scale === null
              ? 'Merilo NI kalibrirano — razdalje so v poljubnih enotah modela. Izberi par točk z ZNANO dolžino in kalibriraj.'
              : `Merilo: 1 enota = ${scale.toLocaleString('sl-SI', { maximumFractionDigits: 2 })} cm — razdalje so v cm (kakovost CALIBRATED).`}
          </p>
        </div>
      )}

      {/* Canvas + izbor po ID */}
      {model && (
        <div className="space-y-2">
          {webglOk === false ? (
            <p
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
              role="status"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                3D izris ni dosegljiv (WebGL ni podprt v tem brskalniku). Merjenje po ID točk
                spodaj ostane popolnoma delujoče.
              </span>
            </p>
          ) : (
            <div
              ref={hostRef}
              className="h-[320px] w-full overflow-hidden rounded-xl border sm:h-[380px]"
              aria-label="3D prikaz modela — povleci za vrtenje, klik za izbor točke"
              role="img"
            />
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">
              ID točke A
              <Input
                type="number"
                inputMode="numeric"
                value={idA}
                onChange={(e) => setIdA(e.target.value)}
                className="mt-1 h-9 w-24"
                aria-label="ID točke A"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              ID točke B
              <Input
                type="number"
                inputMode="numeric"
                value={idB}
                onChange={(e) => setIdB(e.target.value)}
                className="mt-1 h-9 w-24"
                aria-label="ID točke B"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={pickByIds}
              className="min-h-11"
              aria-label="Postavi par točk po ID"
            >
              <Crosshair className="h-4 w-4" aria-hidden="true" />
              Postavi par po ID
            </Button>
          </div>
        </div>
      )}

      {/* Aktivni par */}
      {pair && pair.idB === 0 && (
        <p className="rounded-xl bg-secondary/50 p-3 text-sm" role="status">
          Prva točka {pair.idA} izbrana — klikni (ali vpiši ID) drugo točko.
        </p>
      )}
      {pair && pair.idB !== 0 && (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-sm font-medium" role="status">
            Par {pair.idA} → {pair.idB}:{' '}
            {pairCm !== null ? (
              <span className="text-green-600">{formatCm(pairCm)}</span>
            ) : (
              <span>{pair.units.toLocaleString('sl-SI', { maximumFractionDigits: 3 })} enot</span>
            )}
          </p>
          {scale === null && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                Znana dolžina med točkama (cm)
                <Input
                  type="number"
                  inputMode="decimal"
                  value={refCm}
                  onChange={(e) => setRefCm(e.target.value)}
                  className="mt-1 h-9 w-40"
                  placeholder="npr. 100"
                  aria-label="Znana dolžina med točkama v centimetrih"
                />
              </label>
              <Button
                type="button"
                onClick={calibrate}
                className="min-h-11"
                aria-label="Kalibriraj merilo modela"
              >
                <Ruler className="h-4 w-4" aria-hidden="true" />
                Kalibriraj merilo
              </Button>
            </div>
          )}
          {pairCm !== null && (
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={addPair}
                className="min-h-11"
                aria-label="Dodaj razdaljo v seznam"
              >
                Dodaj meritev
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPair(null)}
                className="min-h-11"
                aria-label="Zavrzi trenutni par"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Zavrzi par
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Seznam shranjenih + zaključek */}
      {saved.length > 0 && (
        <div className="space-y-2">
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-secondary/50 p-2 text-sm">
            {saved.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-1">
                <span>
                  3D {i + 1}:{' '}
                  <strong className="text-green-700">
                    {savedCm[i] !== null
                      ? formatCm(savedCm[i] as number)
                      : `${m.units.toLocaleString('sl-SI')} enot`}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => setSaved((prev) => prev.filter((_, j) => j !== i))}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                  aria-label={`Odstrani meritev 3D ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={finishAndSave}
              disabled={scale === null}
              className="min-h-11 bg-green-600 text-white hover:bg-green-700"
              aria-label="Zaključi in shrani razdalje v meritve kamere"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Zaključi in shrani ({saved.length})
            </Button>
            {scale !== null && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setScale(null);
                  setSaved([]);
                  setPair(null);
                }}
                className="min-h-11"
                aria-label="Ponastavi merilo in počisti shranjene razdalje"
              >
                Ponastavi merilo
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Napaka */}
      {error && (
        <p
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
          role="alert"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {/* Pomoč */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setHelpOpen((o) => !o)}
          aria-expanded={helpOpen}
          aria-label="Pokaži pomoč za 3D model objekta"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
          {helpOpen ? 'Skrij pomoč' : 'Kako naredim model in merim?'}
        </button>
        {helpOpen && (
          <div className="space-y-1 rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
            <p>
              1. Posnemi 20–60 prekrivajočih fotk objekta (isti zoom, 60 %+ prekrivanja). 2.
              Rekonstruiraj z COLMAP-om (namizni program ali brskalniški port) in izvozi model kot
              TEXT (File → Export model as text). 3. Uvozi tri .txt datoteke zgoraj. 4. Izberi dve
              točki z znano dolžino (npr. vrata, ploščica) in vnesi realno dolžino — model se
              kalibrira. 5. Meri dalje: vsak par točk zdaj pokaže cm. Razdalje so kakovosti
              CALIBRATED — za proizvodno mero jih preveri s trakom/laserjem.
            </p>
            <p>Brez kalibracije so enote modela poljubne — take razdalje aplikacija ne shrani.</p>
          </div>
        )}
      </div>
    </div>
  );
}
