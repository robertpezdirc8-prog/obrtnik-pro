// ─── POST /api/analyze-photo — pametna kamera (skriptna analiza) ──
// Prejme base64 fotografijo, jo dekodira z sharp in požene čisto
// deterministični računalniški vid (src/lib/cv-engine.ts): robovi,
// Houghove daljice, barvne maske, povezane komponente, pravila.
// Brez zunanjih AI storitev — deluje vedno, takoj in brez kvot.

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { db } from '@/lib/db';
import type { PhotoAnalysis } from '@/lib/camera-types';
import { analyzePhotoImage, type RgbaImage } from '@/lib/cv-engine';
import type { PriceKey } from '@/lib/cenik';
import { createRateLimiter, clientKeyFromHeaders, ANALYZE_RATE_RULE } from '@/lib/rate-limit';
import { requireSession } from '@/lib/auth-guard';

export const maxDuration = 60;

const MAX_BASE64 = 7_500_000; // ≈ 5,5 MB slike

// Omejevalnik zahtev: CV analiza je strojno draga, zanka jo lahko utruja.
// 30 analiz / minuto / klienta lovi zanke, ne poštenega dela. Omejevalnik
// je v pomnilniku procesa (iskreno zapisano v src/lib/rate-limit.ts).
const ANALYZE_LIMITER = createRateLimiter(ANALYZE_RATE_RULE);

async function suggestProducts(craft: PhotoAnalysis['craft']) {
  if (craft === 'drugo') return [];
  const cat = await db.category.findUnique({
    where: { slug: craft },
    // Po IMENU, ne po ceni: katalog cen nima več (Task 88). `take: 5` je
    // omejitev zaslona, ne poslovno pravilo.
    include: { products: { where: { active: true }, orderBy: { name: 'asc' }, take: 5 } },
  });
  return (cat?.products ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit, sku: p.sku as PriceKey | null }));
}

/** Dekodira dataURL v surove RGBA piksle (upošteva EXIF orientacijo). */
async function decodeToPixels(dataUrl: string): Promise<RgbaImage> {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const buf = Buffer.from(b64, 'base64');
  const { data, info } = await sharp(buf)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}

export async function POST(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    // Omejitev pogostosti PREJ, kot stroj sploh seže po pikslih.
    const clientKey = clientKeyFromHeaders(req.headers);
    const decision = ANALYZE_LIMITER.hit(clientKey, Date.now());
    if (!decision.ok) {
      return NextResponse.json(
        { error: `Preveč analiz v kratkem času — poskusi znova čez ${decision.retryAfterSec} s.` },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSec) } },
      );
    }

    const body = (await req.json()) as { image?: unknown };
    const image = typeof body.image === 'string' ? body.image : '';

    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Manjka veljavna fotografija (dataURL).' }, { status: 400 });
    }
    if (image.length > MAX_BASE64) {
      return NextResponse.json({ error: 'Fotografija je prevelika. Posnemi jo znova (manjša ločljivost).' }, { status: 413 });
    }

    const pixels = await decodeToPixels(image);
    const analysis = analyzePhotoImage(pixels);
    const suggestedProducts = await suggestProducts(analysis.craft);

    return NextResponse.json({ analysis, suggestedProducts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Neznana napaka pri analizi.';
    const message = raw.includes('premalo podatkov') || raw.includes('VipsJpeg') || raw.includes('unsupported')
      ? 'Fotografije ni bilo mogoče prebrati. Posnemi jo znova.'
      : raw;
    console.error('[analyze-photo]', raw);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
