// ─── Teksture materialov za vizualizer (statični asseti) ──────
// Katalog realnih materialnih tekstur (tile 512×512), ki jih skripta
// preslika v izbrani štirikotnik (research/task14: profesionalni
// vizualizerji — Trex, Deckorators — uporabljajo realne teksture
// iz kataloga, ne zgolj proceduralno risanje).
// Upodobitev je čisto skriptna: tile se zrcali (mirror tiling →
// brez vidnih šivov), kombinira z izbrano barvo in senčenjem fotke.

export interface VizTexture {
  id: string;
  label: string;
  /** Pot do statičnega tile-a (public/). */
  src: string;
  /**
   * Realna stranica tile-a v cm (koliko površine materiala tile
   * predstavlja) — tekstura se tlakuje v realnem merilu, da je žirni
   * detajl enako velik kot na pravem materialu, neodvisno od zooma.
   */
  realCm: number;
}

export const VIZ_TEXTURES: VizTexture[] = [
  { id: 'wpc-tikovina', label: 'WPC tikovina', src: '/textures/wpc-tikovina.jpg', realCm: 45 },
  { id: 'wpc-siva', label: 'WPC siva', src: '/textures/wpc-siva.jpg', realCm: 45 },
  { id: 'hrast', label: 'Hrast (les)', src: '/textures/hrast.jpg', realCm: 45 },
  { id: 'keramika-les', label: 'Keramika les-dekor', src: '/textures/keramika-les.jpg', realCm: 60 },
  { id: 'keramika-kamen', label: 'Keramika kamen', src: '/textures/keramika-kamen.jpg', realCm: 60 },
  { id: 'fasada-omet', label: 'Fasada omet', src: '/textures/fasada-omet.jpg', realCm: 50 },
  // KUBO 80/42 — ORIGINALNA ROKSAL gradiva (barvna lestvica roksal.com,
  // izrez dekorjev prek tests/make-kubo-tiles.ts). realCm 45 = privzetek
  // (merilo dekorja na lestvici NI objavljeno — glej register roksal-assets).
  { id: 'roksal-kubo-dekor-1', label: 'KUBO dekor 1/4 (temno sivi)', src: '/roksal/kubo/dekor-1.png', realCm: 45 },
  { id: 'roksal-kubo-dekor-2', label: 'KUBO dekor 2/4 (svetli zlati)', src: '/roksal/kubo/dekor-2.png', realCm: 45 },
  { id: 'roksal-kubo-dekor-3', label: 'KUBO dekor 3/4 (zlati teak)', src: '/roksal/kubo/dekor-3.png', realCm: 45 },
  { id: 'roksal-kubo-dekor-4', label: 'KUBO dekor 4/4 (temno rjavo-sivi)', src: '/roksal/kubo/dekor-4.png', realCm: 45 },
  // TERASNA deka 150×25 — ORIGINALNA ROKSAL gradiva (barvna lestvica
  // roksal.com, izrez dekorjev prek tests/make-deka-tiles.ts).
  // realCm 45 = privzetek (merilo dekorja na lestvici NI objavljeno).
  { id: 'roksal-deka-dekor-1', label: 'DEKA dekor 1/7 (temno sivi, rebra)', src: '/roksal/deka/dekor-1.png', realCm: 45 },
  { id: 'roksal-deka-dekor-2', label: 'DEKA dekor 2/7 (svetlo sivi, rebra)', src: '/roksal/deka/dekor-2.png', realCm: 45 },
  { id: 'roksal-deka-dekor-3', label: 'DEKA dekor 3/7 (bakreno-peščeni, rebra)', src: '/roksal/deka/dekor-3.png', realCm: 45 },
  { id: 'roksal-deka-dekor-4', label: 'DEKA dekor 4/7 (rožnato-bež, rebra)', src: '/roksal/deka/dekor-4.png', realCm: 45 },
  { id: 'roksal-deka-dekor-5', label: 'DEKA dekor 5/7 (svetlo zlati, rebra)', src: '/roksal/deka/dekor-5.png', realCm: 45 },
  { id: 'roksal-deka-dekor-6', label: 'DEKA dekor 6/7 (fina tekstura)', src: '/roksal/deka/dekor-6.png', realCm: 45 },
  { id: 'roksal-deka-dekor-7', label: 'DEKA dekor 7/7 (fina tekstura)', src: '/roksal/deka/dekor-7.png', realCm: 45 },
  // OGRAJE (POLNA DESKA + ROMB) — ORIGINALNA ROKSAL gradiva (barvne
  // lestvice roksal.com, izrez dekorjev prek tests/make-ograje-tiles.ts).
  // realCm 45 = privzetek (merilo dekorja na lestvicah NI objavljeno).
  { id: 'roksal-romb67-dekor-1', label: 'ROMB-67 dekor 1/7 (temno sivi)', src: '/roksal/ograje/romb-67/dekor-1.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-2', label: 'ROMB-67 dekor 2/7 (svetlo sivi)', src: '/roksal/ograje/romb-67/dekor-2.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-3', label: 'ROMB-67 dekor 3/7 (rožnato-rjavi)', src: '/roksal/ograje/romb-67/dekor-3.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-4', label: 'ROMB-67 dekor 4/7 (rjavo-bež)', src: '/roksal/ograje/romb-67/dekor-4.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-5', label: 'ROMB-67 dekor 5/7 (svetli zlati)', src: '/roksal/ograje/romb-67/dekor-5.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-6', label: 'ROMB-67 dekor 6/7 (zlati teak)', src: '/roksal/ograje/romb-67/dekor-6.png', realCm: 45 },
  { id: 'roksal-romb67-dekor-7', label: 'ROMB-67 dekor 7/7 (temno rjavo-sivi)', src: '/roksal/ograje/romb-67/dekor-7.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-1', label: 'POLNA-100 dekor 1/8 (temno sivi)', src: '/roksal/ograje/polna-100/dekor-1.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-2', label: 'POLNA-100 dekor 2/8 (svetlo sivi)', src: '/roksal/ograje/polna-100/dekor-2.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-3', label: 'POLNA-100 dekor 3/8 (rožnato-rjavi)', src: '/roksal/ograje/polna-100/dekor-3.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-4', label: 'POLNA-100 dekor 4/8 (rjavo-bež)', src: '/roksal/ograje/polna-100/dekor-4.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-5', label: 'POLNA-100 dekor 5/8 (svetli zlati)', src: '/roksal/ograje/polna-100/dekor-5.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-6', label: 'POLNA-100 dekor 6/8 (beli)', src: '/roksal/ograje/polna-100/dekor-6.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-7', label: 'POLNA-100 dekor 7/8 (zlati teak)', src: '/roksal/ograje/polna-100/dekor-7.png', realCm: 45 },
  { id: 'roksal-polna100-dekor-8', label: 'POLNA-100 dekor 8/8 (temno rjavo-sivi)', src: '/roksal/ograje/polna-100/dekor-8.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-1', label: 'POLNA-128 dekor 1/6 (temno sivi)', src: '/roksal/ograje/polna-128/dekor-1.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-2', label: 'POLNA-128 dekor 2/6 (svetlo sivi)', src: '/roksal/ograje/polna-128/dekor-2.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-3', label: 'POLNA-128 dekor 3/6 (rjavo-bež)', src: '/roksal/ograje/polna-128/dekor-3.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-4', label: 'POLNA-128 dekor 4/6 (svetli zlati)', src: '/roksal/ograje/polna-128/dekor-4.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-5', label: 'POLNA-128 dekor 5/6 (zlati teak)', src: '/roksal/ograje/polna-128/dekor-5.png', realCm: 45 },
  { id: 'roksal-polna128-dekor-6', label: 'POLNA-128 dekor 6/6 (temno rjavo-sivi)', src: '/roksal/ograje/polna-128/dekor-6.png', realCm: 45 },
];

/** Predloga tekstur po vzorcu (UI ureja izbiro). */
export function texturesForPattern(
  pattern: string,
): VizTexture[] {
  switch (pattern) {
    case 'terasa':
      return VIZ_TEXTURES.filter((t) => t.id.startsWith('wpc') || t.id === 'hrast' || t.id.startsWith('roksal-deka-dekor-'));
    case 'ploscice':
      return VIZ_TEXTURES.filter((t) => t.id.startsWith('keramika'));
    case 'panel':
      return VIZ_TEXTURES.filter((t) => ['hrast', 'wpc-tikovina', 'wpc-siva', 'fasada-omet'].includes(t.id));
    case 'horizontalne':
    case 'lamele45':
    case 'vozlik':
    case 'vertikalne':
    case 'piketna':
      return VIZ_TEXTURES.filter((t) => ['hrast', 'wpc-tikovina', 'wpc-siva'].includes(t.id) || t.id.startsWith('roksal-kubo-dekor-') || t.id.startsWith('roksal-romb67-dekor-') || t.id.startsWith('roksal-polna100-dekor-') || t.id.startsWith('roksal-polna128-dekor-'));
    default:
      return []; // 'barva' in 'steklo' brez tekstur
  }
}

export function getTextureById(id: string | undefined): VizTexture | null {
  if (!id) return null;
  return VIZ_TEXTURES.find((t) => t.id === id) ?? null;
}

// ── Prednalaganje slik (cache) — browser-only ───────────────

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** Naloži teksturne slike v cache (idempotentno). Vrne št. uspešnih. */
export function preloadVizTextures(ids: string[]): Promise<number> {
  const unique = [...new Set(ids)].filter((id) => !cache.has(id));
  let ok = 0;
  return Promise.all(
    unique.map((id) => {
      const tex = VIZ_TEXTURES.find((t) => t.id === id);
      if (!tex) return Promise.resolve(null);
      if (!pending.has(id)) {
        pending.set(
          id,
          new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => {
              cache.set(id, img);
              ok++;
              resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = tex.src;
          }),
        );
      }
      return pending.get(id)!;
    }),
  ).then(() => ok);
}

/** Sinhroni dostop do že naložene teksture (null = še ni v cache). */
export function getTextureImage(id: string | undefined): HTMLImageElement | null {
  if (!id) return null;
  return cache.get(id) ?? null;
}
