'use client';

// ─── Pravi 3D AR merjenje: WebXR hit-test (ARCore / Chrome na Androidu) ───
// Izmeri realne dolžine v prostoru BREZ umerjanja: hit-test najde ravne
// površine, svetovne enote so pravi metri (referenčni prostor "local"),
// reticle = jantarni krog na zaznani površini, tap = točka daljice.
// `three` se uvaži DINAMIČNO šele ob zagonu seje (SSR-varno), vse
// detekcije navigator.xr šele po mount-u (brez hydration mismatch).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
// Tip-only uvoz (izbrisan ob prevodu — brez runtime uvoza three na strežniku)
import type * as ThreeNs from 'three';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Box, Check, Info, Trash2, Undo2 } from 'lucide-react';
import { formatCm } from '@/lib/measure-geometry';

export interface WebXrArProps {
  /** Pokliče se ob zaključku seje za vsako izmerjeno daljico (cm). */
  onAddMeasure: (label: string, cm: number) => void;
  disabled?: boolean;
}

// ── Minimalni tipi ─────────────────────────────────────────────
type NavigatorWithXr = Navigator & { xr?: XRSystem };
type Disposable = { dispose(): void };

/** Slovenska množina: 1 daljica, 2 daljici, 3–4 daljice, 5+ daljic. */
function daljicaBeseda(n: number): string {
  if (n === 1) return '1 daljica';
  if (n === 2) return '2 daljici';
  if (n === 3 || n === 4) return `${n} daljice`;
  return `${n} daljic`;
}

export function WebXrAr({ onAddMeasure, disabled = false }: WebXrArProps): JSX.Element {
  // ── Stanje (SSR-varno: prvi ris enak strežniškemu) ─────────────
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null); // null = preverjam
  const [starting, setStarting] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linesM, setLinesM] = useState<number[]>([]); // izmerjene daljice v metrih
  const [pendingSecond, setPendingSecond] = useState(false); // čaka se 2. točka
  const [surfaceVisible, setSurfaceVisible] = useState(false); // reticle viden?
  const [helpOpen, setHelpOpen] = useState(false);

  // ── Refi (XR notranjosti + zaščita pred setState po unmount) ───
  const aliveRef = useRef(false);
  const startingRef = useRef(false);
  const savedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null); // DOM overlay root
  const canvasHostRef = useRef<HTMLDivElement | null>(null); // gostitelj canvasa
  const sessionRef = useRef<XRSession | null>(null);
  const rendererRef = useRef<ThreeNs.WebGLRenderer | null>(null);
  const sceneRef = useRef<ThreeNs.Scene | null>(null);
  const reticleRef = useRef<ThreeNs.Mesh | null>(null);
  const refSpaceRef = useRef<XRReferenceSpace | null>(null);
  const hitTestSourceRef = useRef<XRHitTestSource | null>(null);
  const surfaceVisibleRef = useRef(false);
  const pendingRef = useRef<ThreeNs.Vector3 | null>(null); // začetna točka daljice
  const pendingDotRef = useRef<ThreeNs.Mesh | null>(null);
  const lineGroupsRef = useRef<ThreeNs.Object3D[][]>([]); // [točka A, daljica, točka B]
  const disposablesRef = useRef<Disposable[]>([]);

  // ── Čiščenje three virov (idempotentno, varno za klice večkrat) ──
  const handleSessionEnd = useCallback((): void => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.setAnimationLoop(null);
    }
    const source = hitTestSourceRef.current;
    if (source) {
      try {
        source.cancel();
      } catch {
        // vir je že bil preklican
      }
    }
    hitTestSourceRef.current = null;
    refSpaceRef.current = null;
    disposablesRef.current.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // vir je že bil sproščen
      }
    });
    disposablesRef.current = [];
    if (renderer) {
      try {
        renderer.dispose();
        renderer.forceContextLoss();
      } catch {
        // kontekst je že sproščen
      }
      renderer.domElement.remove();
    }
    rendererRef.current = null;
    sceneRef.current = null;
    reticleRef.current = null;
    pendingRef.current = null;
    pendingDotRef.current = null;
    lineGroupsRef.current = [];
    sessionRef.current = null;
    if (aliveRef.current) {
      setSessionActive(false);
      setPendingSecond(false);
      setLinesM([]);
      setSurfaceVisible(false);
      surfaceVisibleRef.current = false;
    }
  }, []);

  // ── Mount + unmount (končaj sejo, počisti vire) ────────────────
  useEffect(() => {
    aliveRef.current = true;
    setMounted(true);
    return () => {
      aliveRef.current = false;
      const session = sessionRef.current;
      if (session) {
        try {
          void session.end();
        } catch {
          // seja je že končana
        }
      }
      handleSessionEnd();
    };
  }, [handleSessionEnd]);

  // ── Feature-detect: immersive-ar (šele po mount-u) ─────────────
  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      if (typeof navigator === 'undefined') return;
      const xr = (navigator as NavigatorWithXr).xr;
      if (!xr) {
        if (!cancelled) setSupported(false);
        return;
      }
      try {
        const ok = await xr.isSessionSupported('immersive-ar');
        if (!cancelled) setSupported(ok);
      } catch {
        if (!cancelled) setSupported(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Razveljavi zadnjo točko / daljico (stabilna identiteta) ────
  const undoLast = useCallback((): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    const pendingDot = pendingDotRef.current;
    if (pendingDot) {
      // razveljavi še nedokončano začetno točko
      scene.remove(pendingDot);
      pendingDotRef.current = null;
      pendingRef.current = null;
      setPendingSecond(false);
      return;
    }
    const group = lineGroupsRef.current.pop();
    if (group) {
      group.forEach((o) => scene.remove(o));
      setLinesM((prev) => prev.slice(0, -1));
    }
  }, []);

  // ── Počisti vse 3D daljice v sceni ─────────────────────────────
  const clearLines = useCallback((): void => {
    const scene = sceneRef.current;
    if (scene) {
      lineGroupsRef.current.flat().forEach((o) => scene.remove(o));
      const pendingDot = pendingDotRef.current;
      if (pendingDot) scene.remove(pendingDot);
    }
    lineGroupsRef.current = [];
    pendingDotRef.current = null;
    pendingRef.current = null;
    setLinesM([]);
    setPendingSecond(false);
  }, []);

  // ── Zaključi in shrani: vsaka daljica → onAddMeasure(cm) ──────
  const finishAndSave = useCallback((): void => {
    if (savedRef.current) return; // zaščita pred dvoklikom
    savedRef.current = true;
    linesM.forEach((meters, i) => {
      const cm = Math.round(meters * 1000) / 10; // m → cm (na 0,1 cm)
      onAddMeasure(`AR 3D ${i + 1}`, cm);
    });
    clearLines();
    const session = sessionRef.current;
    if (session) {
      try {
        void session.end();
      } catch {
        // seja je že končana
      }
    }
  }, [linesM, onAddMeasure, clearLines]);

  // ── Zagon 3D AR seje ───────────────────────────────────────────
  const startSession = async (): Promise<void> => {
    if (!aliveRef.current || startingRef.current || sessionRef.current) return;
    setError(null);
    const xr = (navigator as NavigatorWithXr).xr;
    const overlayRoot = overlayRef.current;
    if (!xr || !overlayRoot) {
      setError('WebXR ni dosegljiv v tem brskalniku — uporabi 2D AR merjenje zgoraj.');
      return;
    }
    startingRef.current = true;
    savedRef.current = false;
    setStarting(true);
    let session: XRSession | null = null;
    try {
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor', 'anchors'],
        domOverlay: { root: overlayRoot },
      });
      sessionRef.current = session;
      session.addEventListener('end', handleSessionEnd);
      setSessionActive(true); // prikaži canvas + DOM overlay

      // Dinamičen uvoz three — ŠELE zdaj, v odjemalcu
      const THREE = await import('three');

      // Renderer + canvas (fixed overlay, prosojen za AR passthrough)
      const canvasHost = canvasHostRef.current;
      if (!canvasHost) throw new Error('canvas gostitelj ni na voljo');
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      canvasHost.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Scena + kamera + reticle (jantarni krog na zaznani površini)
      const scene = new THREE.Scene();
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / Math.max(1, window.innerHeight),
        0.01,
        40,
      );

      const disposables: Disposable[] = [];
      disposablesRef.current = disposables;

      const reticleGeo = new THREE.RingGeometry(0.06, 0.075, 32).rotateX(-Math.PI / 2);
      const reticleMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      disposables.push(reticleGeo, reticleMat);
      const reticle = new THREE.Mesh(reticleGeo, reticleMat);
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      reticleRef.current = reticle;

      // Skupni viri: točke (kroglice) in daljice (zelena črta)
      const dotGeo = new THREE.SphereGeometry(0.012, 12, 8);
      const dotMatAmber = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const dotMatGreen = new THREE.MeshBasicMaterial({ color: 0x16a34a });
      const lineMat = new THREE.LineBasicMaterial({ color: 0x16a34a });
      disposables.push(dotGeo, dotMatAmber, dotMatGreen, lineMat);

      // Referenčni prostori + hit-test vir
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const refSpace = await session.requestReferenceSpace('local');
      refSpaceRef.current = refSpace;
      const hitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });
      if (!hitTestSource) throw new Error('hit-test ni na voljo na tej napravi');
      hitTestSourceRef.current = hitTestSource;

      // Pripni sejo rendererju (nastavi XRWebGLLayer)
      await renderer.xr.setSession(session);

      // Tap = točka daljice (le ko je reticle viden na zaznani površini)
      const onSelect = (): void => {
        const currentReticle = reticleRef.current;
        const currentScene = sceneRef.current;
        if (!currentReticle?.visible || !currentScene) return;
        const p = new THREE.Vector3().setFromMatrixPosition(currentReticle.matrix);
        if (!pendingRef.current) {
          // začetna točka (jantarna)
          pendingRef.current = p.clone();
          const dot = new THREE.Mesh(dotGeo, dotMatAmber);
          dot.position.copy(p);
          currentScene.add(dot);
          pendingDotRef.current = dot;
          setPendingSecond(true);
        } else {
          // končna točka → daljica + realna razdalja v metrih
          const a = pendingRef.current;
          const meters = a.distanceTo(p);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([a, p]);
          disposables.push(lineGeo);
          const line = new THREE.Line(lineGeo, lineMat);
          const dotB = new THREE.Mesh(dotGeo, dotMatGreen);
          dotB.position.copy(p);
          currentScene.add(line, dotB);
          const group: ThreeNs.Object3D[] = [line, dotB];
          const startedDot = pendingDotRef.current;
          if (startedDot) {
            startedDot.material = dotMatGreen; // začetna točka dobi zeleno
            group.unshift(startedDot);
          }
          pendingDotRef.current = null;
          pendingRef.current = null;
          lineGroupsRef.current.push(group);
          setLinesM((prev) => [...prev, meters]);
          setPendingSecond(false);
        }
      };
      session.addEventListener('select', onSelect);

      // Zanka izrisovanja: hit-test → reticle + izris
      renderer.setAnimationLoop((_time, frame) => {
        const currentReticle = reticleRef.current;
        const source = hitTestSourceRef.current;
        const rSpace = refSpaceRef.current;
        if (frame && currentReticle && source && rSpace) {
          const hits = frame.getHitTestResults(source);
          let hitPose: XRPose | undefined;
          if (hits.length > 0) hitPose = hits[0].getPose(rSpace);
          const visible = hitPose !== undefined;
          if (hitPose) {
            currentReticle.matrix.fromArray(hitPose.transform.matrix);
          }
          if (currentReticle.visible !== visible) {
            currentReticle.visible = visible;
            surfaceVisibleRef.current = visible;
            setSurfaceVisible(visible);
          }
        }
        renderer.render(scene, camera);
      });
    } catch (err) {
      handleSessionEnd();
      if (session) {
        try {
          void session.end();
        } catch {
          // seja je že končana
        }
      }
      if (aliveRef.current) {
        const reason = err instanceof Error ? err.message : 'neznan razlog';
        setError(
          err instanceof DOMException &&
            (err.name === 'NotAllowedError' || err.name === 'SecurityError')
            ? 'Dostop do 3D AR je bil zavrnjen — dovoli kamero in poskusi znova.'
            : `3D AR merjenje se ni zagnalo (${reason}). Prepričaj se, da je nameščen Google Play Services za AR (ARCore), in poskusi znova.`,
        );
      }
    } finally {
      startingRef.current = false;
      if (aliveRef.current) setStarting(false);
    }
  };

  // ── Pomožni izračuni za overlay ────────────────────────────────
  const lastMeters = linesM.length > 0 ? linesM[linesM.length - 1] : null;
  const lastLabel = lastMeters !== null ? formatCm(lastMeters * 100) : '—';
  const hint = !surfaceVisible
    ? 'Premikaj telefon počasi, da zaznaš površino.'
    : pendingSecond
      ? 'Tapni končno točko daljice.'
      : 'Tapni začetno točko daljice.';
  const canUndoOrClear = pendingSecond || linesM.length > 0;

  return (
    <>
      {/* ── Panel v strani (vedno viden, tudi kadar WebXR ni podprt) ── */}
      <div className="space-y-3 rounded-xl border p-4">
        {/* Glava */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Pravi 3D AR merjenje</h3>
          </div>
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-600">
            Beta
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          Izmeri realne dolžine v prostoru brez umerjanja — hit-test najde površine,
          razdalje so v pravih metrih.
        </p>

        {/* Preverjanje podpore */}
        {mounted && supported === null && (
          <p
            className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground"
            role="status"
          >
            Preverjam podporo za 3D AR …
          </p>
        )}

        {/* WebXR / immersive-ar ni podprt — mirna razlaga, brez napake */}
        {mounted && supported === false && (
          <p
            className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
            role="status"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Pravi 3D AR ni podprt v tem brskalniku — deluje v Chromeu na Androidu
              (ARCore). Uporabi 2D AR merjenje zgoraj.
            </span>
          </p>
        )}

        {/* Zagon seje */}
        {mounted && supported === true && (
          <Button
            type="button"
            onClick={() => void startSession()}
            disabled={disabled || starting || sessionActive}
            className="min-h-11 w-full sm:w-auto"
            aria-label="Zaženi 3D AR merjenje v prostoru"
          >
            <Box className="h-4 w-4" aria-hidden="true" />
            {starting ? 'Zaganjam 3D AR …' : 'Zaženi 3D AR merjenje'}
          </Button>
        )}

        {/* Prijazna napaka zagona (nikoli crash) */}
        {error && (
          <p
            className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
            role="alert"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {/* Kratka pomoč (sklopljiva) */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
            aria-label="Pokaži pomoč za 3D AR merjenje"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            {helpOpen ? 'Skrij pomoč' : 'Kako deluje 3D AR merjenje?'}
          </button>
          {helpOpen && (
            <p className="rounded-xl bg-secondary/50 p-3 text-sm text-muted-foreground">
              Premikaj telefon počasi po prostoru, dokler jantarni krog ne zazna
              površine. Tapni začetno in končno točko daljice — razdalja v pravih
              metrih se izračuna samodejno. Ob zaključku se meritve dodajo v seznam
              meritev kamere, od koder jih lahko pošlješ v kalkulator.
            </p>
          )}
        </div>
      </div>

      {/* ── Gostitelj WebGL canvasa ( samo med sejo ) ── */}
      <div
        ref={canvasHostRef}
        aria-hidden="true"
        className={`fixed inset-0 z-40 ${sessionActive ? '' : 'hidden'}`}
      />

      {/* ── DOM overlay root ( ločen od canvasa; gumbi so tap-friendly ) ── */}
      <div
        ref={overlayRef}
        role="group"
        aria-label="3D AR merjenje — nadzorna plošča"
        className={`pointer-events-none fixed inset-0 z-50 flex flex-col justify-between px-4 ${
          sessionActive ? '' : 'hidden'
        }`}
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Zgornja vrstica: živa dolžina zadnje daljice + števec */}
        <div className="flex justify-center">
          <div
            className="rounded-2xl bg-stone-900/75 px-4 py-2.5 text-white shadow-lg backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold leading-none text-amber-300">
                {lastLabel}
              </span>
              <span className="text-sm text-stone-200">
                {daljicaBeseda(linesM.length)} skupaj
              </span>
            </div>
            <p className="mt-1 text-xs text-stone-300">{hint}</p>
          </div>
        </div>

        {/* Spodnji gumbi: veliki tap targeti (min-h-11) */}
        <div className="pointer-events-auto flex flex-wrap items-end justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={undoLast}
            disabled={!canUndoOrClear}
            className="min-h-11 border-white/30 bg-stone-900/75 text-white backdrop-blur hover:bg-stone-900/90 hover:text-white"
            aria-label="Razveljavi zadnjo točko ali daljico"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Razveljavi točko
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={clearLines}
            disabled={!canUndoOrClear}
            className="min-h-11 border-white/30 bg-stone-900/75 text-red-300 backdrop-blur hover:bg-stone-900/90 hover:text-red-200"
            aria-label="Počisti vse izmerjene 3D daljice"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Počisti
          </Button>
          <Button
            type="button"
            onClick={finishAndSave}
            className="min-h-11 bg-green-600 text-white hover:bg-green-700"
            aria-label="Zaključi 3D AR merjenje in shrani meritve"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Zaključi in shrani
          </Button>
        </div>
      </div>
    </>
  );
}
