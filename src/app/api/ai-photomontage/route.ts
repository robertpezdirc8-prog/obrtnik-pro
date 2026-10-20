import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth-guard';
import sharp from 'sharp';
import {
  AI_RESULT_LABEL,
  computeOutsideDrift,
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

/** Preveri, koliko je model spremenil zunaj območja ograje (objektivno). */
async function outsideDrift(
  originalDataUrl: string,
  aiDataUrl: string,
  maskData: Buffer | null,
): Promise<{ drift: number; changedPct: number } | null> {
  if (!maskData) return null;
  try {
    const orig = await sharp(Buffer.from(parseDataUrl(originalDataUrl)!.base64, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const aiImg = await sharp(Buffer.from(parseDataUrl(aiDataUrl)!.base64, 'base64'))
      .resize(orig.info.width, orig.info.height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = await sharp(maskData).resize(orig.info.width, orig.info.height, { fit: 'fill' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return computeOutsideDrift({
      original: new Uint8ClampedArray(orig.data),
      ai: new Uint8ClampedArray(aiImg.data),
      mask: new Uint8ClampedArray(mask.data),
      width: orig.info.width,
      height: orig.info.height,
    });
  } catch {
    return null;
  }
}

/** Ali je AI pot vklopljena (ponudnik + ključ)? Uporabnik sprašuje samo to. */
export async function GET() {
  const cfg = readAiConfig();
  return NextResponse.json({
    enabled: cfg !== null,
    provider: cfg?.provider ?? null,
    model: cfg?.model ?? null,
  });
}

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
    regionHint?: unknown;
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

  const prompt = buildAiPrompt({
    imageDataUrl, profileLabel, colourLabel, instruction, referenceDataUrl,
    regionHint: typeof body.regionHint === 'string' ? body.regionHint : null,
  });

  // Maska (območje ograje) — 255 = tam sme model spremeniti. Uporablja se
  // za OpenAI kot maska, za oba ponudnika pa kot osnova za OBJEKTIVNO preverbo,
  // koliko je model spremenil zunaj ograje.
  let maskData: Buffer | null = null;
  if (maskDataUrl) {
    const m = parseDataUrl(maskDataUrl);
    if (m) maskData = Buffer.from(m.base64, 'base64');
  }

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
      const drift = await outsideDrift(imageDataUrl, dataUrl, maskData);
      return NextResponse.json({
        dataUrl,
        provider: cfg.provider,
        model: cfg.model,
        label: AI_RESULT_LABEL,
        driftOutside: drift?.drift ?? null,
        changedOutsidePct: drift?.changedPct ?? null,
        note:
          'Fotografija je odposlana ponudniku modela; ključ oziroma slika se ne shranjujeta.' +
          (drift && drift.changedPct > 10
            ? ` Opozorilo: model je spremenil tudi okolico (${drift.changedPct} % pikslov zunaj ograje) — slika ni zanesljiva predstavitev.`
            : ''),
      });
    }

    // OpenAI: images/edits (multipart) — maska pomeni, kaj se sme zamenjati.
    const form = new FormData();
    form.append('model', cfg.model);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    const img = parseDataUrl(imageDataUrl)!;
    form.append('image', new Blob([new Uint8Array(Buffer.from(img.base64, 'base64'))], { type: img.mimeType }), 'photo.jpg');
    if (maskData) {
      // OpenAI maska: PROZORNO tam, kjer sme model spremeniti (bela = ograja).
      const src = await sharp(maskData).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = Buffer.alloc(src.info.width * src.info.height * 4);
      for (let i = 0; i < src.info.width * src.info.height; i++) {
        const white = src.data[i * 4] > 127; // R kanal: 255 = ograja
        out[i * 4] = 0;
        out[i * 4 + 1] = 0;
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = white ? 0 : 255; // prozorno = tu sme model zamenjati
      }
      const maskPng = await sharp(out, { raw: { width: src.info.width, height: src.info.height, channels: 4 } })
        .png()
        .toBuffer();
      form.append('mask', new Blob([new Uint8Array(maskPng)], { type: 'image/png' }), 'mask.png');
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
    const drift = await outsideDrift(imageDataUrl, dataUrl, maskData);
    return NextResponse.json({
      dataUrl,
      provider: cfg.provider as AiProvider,
      model: cfg.model,
      label: AI_RESULT_LABEL,
      driftOutside: drift?.drift ?? null,
      changedOutsidePct: drift?.changedPct ?? null,
      note:
        'Fotografija je odposlana ponudniku modela; ključ oziroma slika se ne shranjujeta.' +
        (drift && drift.changedPct > 10
          ? ` Opozorilo: model je spremenil tudi okolico (${drift.changedPct} % pikslov zunaj ograje) — slika ni zanesljiva predstavitev.`
          : ''),
    });
  } catch (e) {
    // KLJUČA NE LOGIRAMO — samo razlog brez njega.
    console.error('ai-photomontage error', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'AI fotomontaža ni uspela.' }, { status: 500 });
  }
}
