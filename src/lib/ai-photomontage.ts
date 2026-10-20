// ─── AI-FOTOMONTAŽA (generativna zamenjava ograje) ───────────────────────
// Uporabnik je izrecno prosil za to, kar znajo Gemini/GPT slike: da se na
// PRAVI FOTKI ograja zamenja z ROKSALovo, kot bi jo naredil fotograf objave.
//
// ZATO TA MODUL LOČI DVE STVARI, ki ju je treba ločiti tudi poslovno:
//
//  1. PREDSTAVITEV (slika): generativna slika, ki jo naredi model. Je
//     NAJBOLJŠE videti, ampak je IZMIŠLJENA — model lahko doda vrata, okna,
//     osebe, spremeni širino ograje. Zato je vsaka taka slika jasno OZNAČENA
//     (AI_RESULT_LABEL) in se NE uporablja za meritve.
//  2. MERITVE (izračun): ostanejo v determinističnem jedru
//     (photo-install-sheet.ts) — iz umerjene ravnine in vnosa razmaka
//     stebrov. AI slika ne vpliva na številke.
//
// VARNOST: ključ je samo na strežniku (AI_IMAGE_API_KEY) in nikoli v
// odgovoru, v dnevniku ali v brskalniku. Fotografija stranke odpotuje
// ponudniku modela — to je obvezno sporočiti stranki.
//
// Podprti ponudniki: Google Gemini (generateContent, image out) in
// OpenAI gpt-image-1 (images/edits, maska). Oba sta odvisna od ključa
// ponudnika; brez ključa modul zavrne z jasnim razlogom.

export type AiProvider = 'gemini' | 'openai';

export const AI_PROVIDERS: AiProvider[] = ['gemini', 'openai'];

/** Oznaka, ki spremlja VSAKO AI sliko. Brez nje slika ni uporabna. */
export const AI_RESULT_LABEL =
  'AI PREDSTAVITEV — generirana slika, ne potrjen proizvodni načrt in ne dokaz barvne identičnosti. ' +
  'Mere in količine so iz determinističnega izračuna, ne iz te slike.';

/** Privzeti modeli (izbereta se lahko z env). */
export const DEFAULT_AI_MODEL: Record<AiProvider, string> = {
  gemini: 'gemini-2.5-flash-image',
  openai: 'gpt-image-1',
};

export interface AiPhotomontageInput {
  /** delovna kopija fotke (data URL) — na njej je stara ograja */
  imageDataUrl: string;
  /** maska stare ograje (data URL, PNG) — kaj se sme zamenjati (OpenAI) */
  maskDataUrl?: string | null;
  /** referenčna fotografija ROKSAL ograje (data URL) — »naredi tako kot ta« */
  referenceDataUrl?: string | null;
  /** oznaka profila, npr. »ROKSAL polna deska 100 (pokončno)« */
  profileLabel: string;
  /** oznaka barve/dekora, npr. »amazon — temno sivi« */
  colourLabel?: string | null;
  /** dodatna navodila obrtnika */
  instruction?: string | null;
  /** opis območja v sliki, ki je ograja (npr. »x 57–87 %, y 45–57 %«) */
  regionHint?: string | null;
}

/** Navodilo modelu — jasno, kaj se spremeni in česa NE sme spremeniti. */
export function buildAiPrompt(input: AiPhotomontageInput): string {
  const parts: string[] = [];
  parts.push(
    `Zamenjaj na tej fotografiji IZKLJUČNO obstoječo ograjo z novo ROKSAL WPC ograjo ` +
      `(${input.profileLabel}${input.colourLabel ? `, barva: ${input.colourLabel}` : ''}).`,
  );
  parts.push(
    'Nova ograja mora biti videti kot prava ROKSAL WPC ograja: pokončne deske z realno zrnatostjo, ' +
      'kovinski stebri in podložna letva, v realni perspektivi hiše, z enakim osvetlitvenim in ' +
      'senčnim svetlobnim razmerjem kot preostanek fotografije.',
  );
  if (input.regionHint) {
    parts.push(`Ograja zaseda območje slike ${input.regionHint} — zamenjaj samo tam.`);
  }
  if (input.referenceDataUrl) {
    parts.push('Druga priložena fotografija je referenca ROKSAL ograje — vzami njen material, barvo in detajle.');
  }
  parts.push(
    'Ohrani HIŠO, okolje, tlo, drevesa, nebes, svetlobo, fotografski kompozicijo in velikost fotografije. ' +
      'Ne dodaj oseb, ne spremeni arhitekture, ne dodaj oken ali vrat, ne dodaj novega stavbnega dela.',
  );
  if (input.instruction && input.instruction.trim()) {
    parts.push(`Dodatna navodila obrtnika: ${input.instruction.trim()}`);
  }
  return parts.join('\n');
}

/** Razčleni `data:image/jpeg;base64,....` → { mimeType, base64 } ali null. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) return null;
  return { mimeType: m[1] as string, base64: m[2] as string };
}

export interface GeminiRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Sestavi REST zahtevo za Gemini (generateContent) — ključ je v glavi. */
export function buildGeminiRequest(args: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  prompt: string;
  referenceDataUrl?: string | null;
}): GeminiRequest {
  const img = parseDataUrl(args.imageDataUrl);
  if (!img) throw new Error('AI_FOTOMONTAZA: fotografija ni veljaven data URL.');
  const parts: unknown[] = [];
  if (args.referenceDataUrl) {
    const ref = parseDataUrl(args.referenceDataUrl);
    if (ref) parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.base64 } });
  }
  parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  parts.push({ text: args.prompt });
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  };
}

/** Odgovor Gemini → data URL slike (ali null, če slike ni). */
export function parseGeminiResponse(json: unknown): string | null {
  const parts = (json as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const d = p?.inlineData?.data;
    if (typeof d === 'string' && d.length > 0) {
      return `data:${p.inlineData?.mimeType ?? 'image/png'};base64,${d}`;
    }
  }
  return null;
}

/** Odgovor OpenAI (images/edits) → data URL slike (ali null). */
export function parseOpenAiResponse(json: unknown): string | null {
  const d = (json as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
  return typeof d === 'string' && d.length > 0 ? `data:image/png;base64,${d}` : null;
}

/** Vrne sporočilo napake ponudnika, če ga API vrne. */
export function providerErrorMessage(json: unknown): string | null {
  const e = json as { error?: { message?: string } };
  return typeof e?.error?.message === 'string' ? e.error.message : null;
}

/** Odgovor aplikacije: slika + poštena oznaka. Nikoli brez oznake. */
export interface AiPhotomontageResult {
  dataUrl: string;
  provider: AiProvider;
  model: string;
  label: string;
  /** opomba, ki jo vidi uporabnik (npr. strošek, omejitev) */
  note: string;
}

/** Odgovor aplikacije: slika + poštena oznaka. Nikoli brez oznake. */
export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

/** Prebere konfiguracijo iz okolja; brez ključa vrne null (ne tiho). */
export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const p = (env.AI_IMAGE_PROVIDER ?? '').trim().toLowerCase();
  if (p !== 'gemini' && p !== 'openai') return null;
  const apiKey = (env.AI_IMAGE_API_KEY ?? '').trim();
  if (!apiKey) return null;
  const model = (env.AI_IMAGE_MODEL ?? '').trim() || DEFAULT_AI_MODEL[p];
  return { provider: p, apiKey, model };
}

