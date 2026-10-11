// ─── POST /api/analyze-photo — pametna kamera (AI analiza) ──
// Prejme base64 fotografijo, pošlje jo vizualnemu modelu in vrne
// strukturirano analizo: kaj je na fotografiji, dimenzije, referenčni
// objekt za umerjanje, potrebne meritve in predpolnitve kalkulatorja.

import { NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { AI_CRAFTS, type AICraft, type PhotoAnalysis } from '@/lib/camera-types';
import type { CraftInputs } from '@/lib/types';

export const maxDuration = 120;

const MAX_BASE64 = 7_500_000; // ≈ 5,5 MB slike

const SYSTEM_PROMPT = `You are the AI vision engine of a Slovenian craftsman app (fences, stairs, tiles, decking, windows/doors, canopies, facades). A craftsman photographs a construction object to prepare a quotation.

Analyze the photo and respond with ONLY a valid JSON object — no markdown fences, no commentary, no extra text.

JSON structure (all free-text values IN SLOVENIAN):
{
  "craft": one of ["ograje","stopnice","keramika","wpc-terasa","okna-vrata","nadstreški","fasada","drugo"],
  "craftConfidence": 0-100,
  "sceneDescription": "1-2 povedi: kaj vidiš na fotografiji",
  "objects": [
    {
      "label": "ime objekta v slovenščini",
      "count": 1,
      "box": [x, y, sirina, visina] v procentih slike (0-100, izhodišče levo zgoraj) ali null če ni gotovo,
      "estWidthCm": številka ali null,
      "estHeightCm": številka ali null,
      "note": "kratka opomba v slovenščini"
    }
  ],
  "reference": { "label": "ime referenčnega objekta", "assumedCm": 200, "explanation": "zakaj je to zanesljivo merilo" } ali null,
  "estimatedAreaM2": številka ali null,
  "measurementsNeeded": ["seznam meritev, ki jih mora obrtnik vzeti na terenu, v slovenščini"],
  "condition": { "score": 0-100 koliko je fotografija uporabna za oceno, "notes": "opomba v slovenščini" },
  "recommendations": "1-3 povedi priporočil za izvedbo/material v slovenščini",
  "prefill": { ... glej pravila spodaj }
}

Kategorije in kaj vanje spada:
- "ograje": balkonske in terasne ograje, steklene/alu/inox ograje, ograje stopnic, polnilna polja, stebri
- "stopnice": notranje/zunanje stopnice, stopnice, podesti
- "keramika": položene ploščice na tleh/stenah, kopalnica, kuhinja, skladiščene ploščice
- "wpc-terasa": WPC/lesene terase, deck, talne deske na nosilcih
- "okna-vrata": okna, vhodna/notranja vrata, balkonska vrata
- "nadstreški": nadstreški, carporti, pergole, strehe nad teraso, senčila
- "fasada": fasadne obloge, omet, ETICS, tračna fasada, trajna fasada
- "drugo": če se nič ne ujema

Pravila za "prefill" (SAMO polja prepoznane kategorije; neznane vrednosti = null; številke v metrih/kosih):
- ograje: {"lengthM", "heightM", "materialHint": "alu"|"steklo"|"inox"|null}
- stopnice: {"stepsCount", "stepWidthM", "materialHint": "wpc"|"hrast"|null}
- keramika: {"floorLengthM", "floorWidthM", "wallHeightM"}
- wpc-terasa: {"deckLengthM", "deckWidthM"}
- okna-vrata: {"windowCount", "doorCount"}
- nadstreški: {"canopyWidthM", "canopyDepthM"}
- fasada: {"perimeterM", "heightM", "openingsM2"}
- drugo: {}

Navodila za oceno dimenzij:
- Uporabi znane referenčne velikosti: vrata 200×90 cm, okno 120×120 cm, ploščica 30×60 ali 60×60 cm, višina ograje 110 cm, etaža 280 cm, človek 170-180 cm.
- "reference" postavi na objekt, katerega velikost je najbolj zanesljiva (najraje vrata, okno ali ploščica).
- Bodi previden: če dimenzij ne moreš oceniti, daj null (ne ugibaj).
- Za "box" poskusi dati okvirje glavnih objektov (prikazujejo se kot AR oznake); če si negotov, daj null.`;

// ─── Pomožne funkcije ───────────────────────────────────────

function extractJson(raw: string): Record<string, unknown> {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Odgovora ni bilo mogoče prebrati kot JSON.');
  let slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    slice = slice.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(slice) as Record<string, unknown>;
  }
}

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 100) / 100;
};

const str = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.slice(0, max) : '';

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Preslika VLM "prefill" (npr. lengthM) na CraftInputs (npr. length). */
function mapPrefill(craft: AICraft, raw: unknown): Partial<CraftInputs> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<CraftInputs> = {};
  const set = (k: keyof CraftInputs, v: unknown) => {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k as string] = v;
  };

  switch (craft) {
    case 'ograje':
      set('length', num(p.lengthM, 0.3, 200));
      set('height', num(p.heightM, 0.9, 3));
      if (p.materialHint === 'alu' || p.materialHint === 'steklo' || p.materialHint === 'inox') set('material', p.materialHint);
      break;
    case 'stopnice':
      set('steps', num(p.stepsCount, 1, 60));
      set('stepWidth', num(p.stepWidthM, 0.6, 6));
      if (p.materialHint === 'wpc' || p.materialHint === 'hrast') set('stepMaterial', p.materialHint);
      break;
    case 'keramika':
      set('floorLength', num(p.floorLengthM, 0.3, 100));
      set('floorWidth', num(p.floorWidthM, 0.3, 100));
      set('wallHeight', num(p.wallHeightM, 0, 6));
      break;
    case 'wpc-terasa':
      set('deckLength', num(p.deckLengthM, 0.3, 100));
      set('deckWidth', num(p.deckWidthM, 0.3, 100));
      break;
    case 'okna-vrata':
      set('windowCount', num(p.windowCount, 0, 100));
      set('doorCount', num(p.doorCount, 0, 50));
      break;
    case 'nadstreški':
      set('canopyWidth', num(p.canopyWidthM, 0.5, 60));
      set('canopyDepth', num(p.canopyDepthM, 0.5, 30));
      break;
    case 'fasada':
      set('facadePerimeter', num(p.perimeterM, 1, 500));
      set('facadeHeight', num(p.heightM, 1, 60));
      set('openingsM2', num(p.openingsM2, 0, 500));
      break;
    default:
      break;
  }
  return out;
}

function normalize(data: Record<string, unknown>): PhotoAnalysis {
  const craftRaw = str(data.craft, 40) as AICraft;
  const craft: AICraft = (AI_CRAFTS as readonly string[]).includes(craftRaw) ? craftRaw : 'drugo';

  const objects = asArray(data.objects)
    .slice(0, 8)
    .map((o) => {
      const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
      const boxRaw = asArray(obj.box);
      const box =
        boxRaw.length === 4 && boxRaw.every((n) => Number.isFinite(Number(n)))
          ? ([0, 1, 2, 3].map((i) => Math.max(0, Math.min(100, Number(boxRaw[i])))) as [number, number, number, number])
          : null;
      return {
        label: str(obj.label, 120) || 'Objekt',
        count: num(obj.count, 1, 999) ?? 1,
        box,
        estWidthCm: num(obj.estWidthCm, 1, 5000),
        estHeightCm: num(obj.estHeightCm, 1, 5000),
        note: str(obj.note, 200) || undefined,
      };
    });

  const refRaw = (data.reference && typeof data.reference === 'object' ? data.reference : null) as Record<string, unknown> | null;
  const reference =
    refRaw && str(refRaw.label, 120) && num(refRaw.assumedCm, 1, 2000)
      ? { label: str(refRaw.label, 120), assumedCm: num(refRaw.assumedCm, 1, 2000)!, explanation: str(refRaw.explanation, 300) }
      : null;

  const condRaw = (data.condition && typeof data.condition === 'object' ? data.condition : {}) as Record<string, unknown>;

  return {
    craft,
    craftConfidence: num(data.craftConfidence, 0, 100) ?? 50,
    sceneDescription: str(data.sceneDescription, 600) || 'Fotografija je bila analizirana.',
    objects,
    reference,
    estimatedAreaM2: num(data.estimatedAreaM2, 0.1, 10000),
    measurementsNeeded: asArray(data.measurementsNeeded).slice(0, 8).map((m) => str(m, 160)).filter(Boolean),
    condition: {
      score: num(condRaw.score, 0, 100) ?? 60,
      notes: str(condRaw.notes, 400),
    },
    recommendations: str(data.recommendations, 800),
    prefill: mapPrefill(craft, data.prefill),
  };
}

async function suggestProducts(craft: AICraft) {
  if (craft === 'drugo') return [];
  const cat = await db.category.findUnique({
    where: { slug: craft },
    include: { products: { where: { active: true }, orderBy: { unitPrice: 'asc' }, take: 5 } },
  });
  return (cat?.products ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit, unitPrice: p.unitPrice }));
}

// ─── Handler ────────────────────────────────────────────────

/** Klic na vizualni model s ponovnimi poskusi ob 429/5xx. */
async function callVision(image: string) {
  const delays = [0, 3000, 8000]; // poskusi: takoj, čez 3 s, čez 8 s
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const zai = await ZAI.create();
      return await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SYSTEM_PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503');
      if (!retryable) throw err;
      console.warn(`[analyze-photo] poskus ${attempt + 1} ni uspel (${msg.slice(0, 80)})`);
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { image?: unknown };
    const image = typeof body.image === 'string' ? body.image : '';

    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Manjka veljavna fotografija (dataURL).' }, { status: 400 });
    }
    if (image.length > MAX_BASE64) {
      return NextResponse.json({ error: 'Fotografija je prevelika. Posnemi jo znova (manjša ločljivost).' }, { status: 413 });
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Analiza je trajala predolgo. Poskusi znova.')), 110_000),
    );

    const visionPromise = callVision(image) as Promise<{
      choices?: { message?: { content?: string } }[];
    }>;

    const response = await Promise.race([visionPromise, timeout]);

    const content = response.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('Model ni vrnil odgovora.');

    const analysis = normalize(extractJson(content));
    const suggestedProducts = await suggestProducts(analysis.craft);

    return NextResponse.json({ analysis, suggestedProducts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Neznana napaka pri analizi.';
    const message = raw.includes('429')
      ? 'AI storitev je trenutno preobremenjena. Počakaj minuto in poskusi znova.'
      : raw;
    console.error('[analyze-photo]', raw);
    return NextResponse.json({ error: message }, { status: raw.includes('429') ? 503 : 500 });
  }
}
