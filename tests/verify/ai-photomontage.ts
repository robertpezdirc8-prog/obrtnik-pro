// Verifikacija AI-FOTOMONTAŽE (ai-photomontage.ts) — čisti del, brez omrežja:
//   1) NAVODILO modelu pove, kaj se zamenja in česa NE sme spremeniti
//      (hiša, osebe, arhitektura) — model ne sme »izmišljati« objekta;
//   2) KLJUČ je samo v HTTP glavi, nikoli v telesu zahteve;
//   3) odgovor ponudnika se razčleni v data URL; brez slike je null;
//   4) konfiguracija brez ponudnika/ključa je null (ne tiho);
//   5) VSAKA AI slika ima oznako (AI PREDSTAVITEV) — brez oznake ni uporabna.
// Zagon: bun tests/verify/ai-photomontage.ts
import {
  AI_RESULT_LABEL,
  buildAiPrompt,
  buildGeminiRequest,
  parseDataUrl,
  parseGeminiResponse,
  parseOpenAiResponse,
  providerErrorMessage,
  readAiConfig,
} from '../../src/lib/ai-photomontage';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

console.log('AI fotomontaža (ai-photomontage) — navodilo, ključ, odgovor, oznaka\n');

// ── 1) Navodilo modelu ───────────────────────────────────────────
{
  const prompt = buildAiPrompt({
    imageDataUrl: PNG,
    profileLabel: 'ROKSAL polna deska 100 (pokončno)',
    colourLabel: 'amazon — temno sivi',
    instruction: 'z alu stebri',
    regionHint: 'x 57–87 %, y 45–57 %',
    referenceDataUrl: PNG,
  });
  check('navodilo omeni profil', prompt.includes('ROKSAL polna deska 100'), prompt.slice(0, 80));
  check('navodilo omeni barvo', prompt.includes('amazon'), prompt.slice(0, 80));
  check('navodilo pove, kaj je zamenjano (ograja)', prompt.includes('obstoječo ograjo'), prompt.slice(0, 80));
  check('navodilo omeni območje', prompt.includes('x 57–87 %'), prompt.slice(0, 200));
  check('navodilo omeni referenco', prompt.includes('referenca'), prompt.slice(0, 200));
  check('navodilo PREPOVEDuje dodajanje oseb', prompt.includes('Ne dodaj oseb'), prompt.slice(0, 200));
  check('navodilo PREPOVEDuje spremembo arhitekture', prompt.includes('ne spremeni arhitekture'), prompt.slice(0, 200));
  check('navodilo vsebuje dodatna navodila', prompt.includes('z alu stebri'), prompt.slice(0, 200));
}

// ── 2) Zahteva: ključ samo v glavi ───────────────────────────────
{
  const r = buildGeminiRequest({
    apiKey: 'SKRIVNI-KLJUC',
    model: 'gemini-2.5-flash-image',
    imageDataUrl: PNG,
    prompt: 'zamenjaj ograjo',
  });
  check('URL vsebuje model', r.url.includes('gemini-2.5-flash-image') && r.url.includes(':generateContent'), r.url);
  check('ključ je v glavi', r.headers['x-goog-api-key'] === 'SKRIVNI-KLJUC', Object.keys(r.headers));
  check('ključ NI v telesu', !r.body.includes('SKRIVNI-KLJUC'), 'ključ v telesu!');
  const body = JSON.parse(r.body) as { contents: { parts: { inline_data?: { mime_type?: string }; text?: string }[] }[] };
  check('telo vsebuje sliko (inline_data)', body.contents[0].parts.some((p) => p.inline_data?.mime_type === 'image/png'), body.contents[0].parts.length);
  check('telo vsebuje navodilo', body.contents[0].parts.some((p) => (p.text ?? '').includes('zamenjaj ograjo')));
  check('telo zahteva slikovni odgovor', r.body.includes('IMAGE'), 'ni responseModalities');
}

// ── 3) Razčlenjevanje odgovorov ──────────────────────────────────
{
  const g = parseGeminiResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] });
  check('Gemini: data URL', g === 'data:image/png;base64,AAAA', g);
  check('Gemini: brez slike → null', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) === null);
  check('Gemini: prazn odgovor → null', parseGeminiResponse({}) === null);
  const o = parseOpenAiResponse({ data: [{ b64_json: 'BBBB' }] });
  check('OpenAI: data URL', o === 'data:image/png;base64,BBBB', o);
  check('OpenAI: brez slike → null', parseOpenAiResponse({ data: [] }) === null);
  check('napaka ponudnika se prebere', providerErrorMessage({ error: { message: 'quota' } }) === 'quota');
  check('napaka ponudnika: ni napake → null', providerErrorMessage({}) === null);
}

// ── 4) Konfiguracija ────────────────────────────────────────────
{
  check('brez ponudnika → null', readAiConfig({} as NodeJS.ProcessEnv) === null);
  check('ponudnik brez ključa → null', readAiConfig({ AI_IMAGE_PROVIDER: 'gemini' } as unknown as NodeJS.ProcessEnv) === null);
  check('ključ brez ponudnika → null', readAiConfig({ AI_IMAGE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv) === null);
  const c = readAiConfig({ AI_IMAGE_PROVIDER: 'gemini', AI_IMAGE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv);
  check('obe → konfiguracija', c?.provider === 'gemini' && c?.model === 'gemini-2.5-flash-image', c);
  const c2 = readAiConfig({ AI_IMAGE_PROVIDER: 'openai', AI_IMAGE_API_KEY: 'k', AI_IMAGE_MODEL: 'gpt-image-1' } as unknown as NodeJS.ProcessEnv);
  check('openai → gpt-image-1', c2?.provider === 'openai' && c2?.model === 'gpt-image-1', c2);
}

// ── 5) Oznaka ────────────────────────────────────────────────────
{
  check('oznaka govori o AI PREDSTAVITVI', AI_RESULT_LABEL.includes('AI PREDSTAVITEV'), AI_RESULT_LABEL);
  check('oznaka pove, da to ni načrt', AI_RESULT_LABEL.includes('ne potrjen proizvodni načrt'), AI_RESULT_LABEL);
  check('oznaka pove, da mere so iz drugega izračuna', AI_RESULT_LABEL.includes('determinističnega izračuna'), AI_RESULT_LABEL);
}

// ── 6) data URL ──────────────────────────────────────────────────
{
  check('data URL se razčleni', parseDataUrl(PNG)?.mimeType === 'image/png', parseDataUrl(PNG));
  check('smetje ni data URL', parseDataUrl('hello') === null);
  check('data URL brez base64 ni veljaven', parseDataUrl('data:image/png,abc') === null);
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);
