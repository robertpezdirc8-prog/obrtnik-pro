# AI-fotomontaža: generativna zamenjava ograje (Gemini / OpenAI)

**Kaj je:** obrtnik označi ograjo na pravi fotki, aplikacija pošlje fotko + območje ograje + referenčno fotografijo ROKSAL ograje modelu, ki vrne **zamenjano sliko** — to je to, kar znajo Gemini/GPT slike.

**Kaj pa NI:** meritev. AI slika je izmišljena (model lahko doda vrata, okna, osebe, spremeni širino ograje). Zato:

- vsaka AI slika nosi oznako **»AI PREDSTAVITEV — generirana slika, ne potrjen proizvodni načrt…«** (`AI_RESULT_LABEL` v `src/lib/ai-photomontage.ts`);
- **meritve, kosovnica, montažni list in sporočilo monterju ostanejo** v determinističnem jedru (`photo-install-sheet.ts`) — iz umerjene ravnine in vnosa razmaka stebrov. AI slika na številke ne vpliva;
- deterministična pot (render z resničnim materialom, stebri, letvami) ostane privzeta; AI je **dodatna, opt-in možnost**.

## Vklop

Strežniško okolje (Vercel → Settings → Environment Variables, **Secret**):

| Spremenljivka | Vrednost | Brez nje |
|---|---|---|
| `AI_IMAGE_PROVIDER` | `gemini` ali `openai` | AI fotomontaža ni vklopljena (UI pove, da manjka) |
| `AI_IMAGE_API_KEY` | ključ ponudnika | enako |
| `AI_IMAGE_MODEL` | npr. `gemini-2.5-flash-image` ali `gpt-image-1` | privzeti model ponudnika |

Ključ **nikoli** ne zapusti strežnika: ni v odgovoru, ni v dnevniku, ni v brskalniku. Fotografija stranke odpotuje ponudniku modela — to je obvezno sporočiti stranki pred uporabo.

Brez ključa vrne API **501** z jasnim razlogom (ne tiho preskoči).

## Brezplačna pot: lokalno na tvojem računalniku

Če ne želiš pošiljati strankinih fotografij v oblak, je enaka slika naredljiva **lokalno brezplačno** (SDXL + ControlNet globina + IP-Adapter referenca) — `tools/local-ai-photomontage.py`. Zahteva GPU (≥ 8 GB VRAM); modeli so odprti in brezplačni (Hugging Face).

```bash
pip install torch diffusers transformers accelerate safetensors
python tools/local-ai-photomontage.py foto.jpg referenca-roksal.jpg out.png --depth
```

## Znana tveganja (pošteno)

1. **Model izmišlja.** Lahko spremeni arhitekturo, doda osebo ali okno, spremeni širino ograje. Zato oznaka in to, da meritve ne izhajajo iz te slike.
2. **Strošek in čas.** Slikovni modeli so dražji od besedilnih in trajajo nekaj sekund do minute. Brez ključa se ne kliče nič.
3. **Zasebnost.** Fotka stranke odpotuje tretji osebi (Google/OpenAI).
4. **Merilna vrednost ostane pri nas.** Za ponudbo in montažni list je avtoritativno število iz umerjene ravnine, ne iz generirane slike.

## Preverbe

`bun tests/verify/ai-photomontage.ts` → **32/32** (navodilo, ključ samo v glavi, razčlenjevanje odgovorov, konfiguracija, oznaka).
