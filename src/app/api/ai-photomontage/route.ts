import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth-guard';
import {
  AI_RESULT_LABEL,
  buildAiPrompt,
  buildGeminiRequest,
  parseDataUrl,
  parseGeminiResponse,
  parseOpenAiResponse,
  providerErrorMessage,
  readAiConfig,
  type AiProvider,
} from '@/lib/ai-photomontage';

/**
 * AI-fotomontaža: generativna zamenjava stare ograje z ROKSALovo.
 *
 * VARNOSTI IN Pravila:
 *  - ključ je samo na strežniku (AI_IMAGE_API_KEY) in se nikoli ne vrne;
 *  - brez nastavljenega ponudnika/ključa je odgovor 501 z JASNIM razlogom
 *    (ne tiho preskoči — uporabnik mora vedeti, zakaj ni slike);
 *  - fotka stranke odpotuje zunaj (ponudniku modela) — to je opozorilo v UI;
 *  - odgovor VEDNO vsebuje oznako AI_RESULT_LABEL: generirana slika ni
 *    potrjen načrt, meritve pa so iz determinističnega jedra.
 */
export async function POST(req: NextRequest) {
  const zavrnjen = await requireAccess(req, 'photos', 'POST');
  if (zavrnjen) return zavrnjen;

  const cfg = readAiConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          'AI fotomontaža ni nastavljena. V strežnikovem okolju nastavi AI_IMAGE_PROVIDER ' +
          '(gemini ali openai) in AI_IMAGE_API_KEY.',
      },
      { status: 501 },
    );
  }

  let body: {
    imageDataUrl?: unknown;
    maskDataUrl?: unknown;
    referenceDataUrl?: unknown;
    profileLabel?: unknown;
    colourLabel?: unknown;
    instruction?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Neveljavno telo zahteve.' }, { status: 400 });
  }

  const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
  if (!parseDataUrl(imageDataUrl)) {
    return NextResponse.json({ error: 'Manjka veljavna fotografija (data URL).' }, { status: 400 });
  }
  const profileLabel = typeof body.profileLabel === 'string' && body.profileLabel.trim()
    ? body.profileLabel.trim()
    : 'ROKSAL WPC ograja';
  const colourLabel = typeof body.colourLabel === 'string' ? body.colourLabel : null;
  const instruction = typeof body.instruction === 'string' ? body.instruction : null;
  const referenceDataUrl = typeof body.referenceDataUrl === 'string' ? body.referenceDataUrl : null;
  const maskDataUrl = typeof body.maskDataUrl === 'string' ? body.maskDataUrl : null;

  const prompt = buildAiPrompt({ imageDataUrl, profileLabel, colourLabel, instruction, referenceDataUrl });

  try {
    if (cfg.provider === 'gemini') {
      const r = buildGeminiRequest({
        apiKey: cfg.apiKey,
        model: cfg.model,
        imageDataUrl,
        prompt,
        referenceDataUrl,
      });
      const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = providerErrorMessage(json) ?? `HTTP ${res.status}`;
        return NextResponse.json({ error: `Gemini je zavrnil zahtevo: ${msg}` }, { status: 502 });
      }
      const dataUrl = parseGeminiResponse(json);
      if (!dataUrl) {
        return NextResponse.json(
          { error: 'Gemini ni vrnil slike (odgovor brez inlineData). Poskusi z drugim modelom ali manjšo sliko.' },
          { status: 502 },
        );
      }
      return NextResponse.json({
        dataUrl,
        provider: cfg.provider,
        model: cfg.model,
        label: AI_RESULT_LABEL,
        note: 'Fotografija je odposlana ponudniku modela; ključ oziroma slika se ne shranjujeta.',
      });
    }

    // OpenAI: images/edits (multipart) — maska pomeni, kaj se sme zamenjati.
    const form = new FormData();
    form.append('model', cfg.model);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    const img = parseDataUrl(imageDataUrl)!;
    form.append('image', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mimeType }), 'photo.jpg');
    if (maskDataUrl) {
      const m = parseDataUrl(maskDataUrl);
      if (m) form.append('mask', new Blob([Buffer.from(m.base64, 'base64')], { type: m.mimeType }), 'mask.png');
    }
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = providerErrorMessage(json) ?? `HTTP ${res.status}`;
      return NextResponse.json({ error: `OpenAI je zavrnil zahtevo: ${msg}` }, { status: 502 });
    }
    const dataUrl = parseOpenAiResponse(json);
    if (!dataUrl) {
      return NextResponse.json({ error: 'OpenAI ni vrnil slike.' }, { status: 502 });
    }
    return NextResponse.json({
      dataUrl,
      provider: cfg.provider as AiProvider,
      model: cfg.model,
      label: AI_RESULT_LABEL,
      note: 'Fotografija je odposlana ponudniku modela; ključ oziroma slika se ne shranjujeta.',
    });
  } catch (e) {
    // KLJUČA NE LOGIRAMO — samo razlog brez njega.
    console.error('ai-photomontage error', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'AI fotomontaža ni uspela.' }, { status: 500 });
  }
}
