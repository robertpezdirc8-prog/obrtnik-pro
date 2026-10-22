# A/B: globinski model (Hugging Face) proti hevristiki robov — rezultat

**Vprašanje:** ali brezplačni odprti model globine (Depth Anything V2 Small)
izboljša samodejno predlaganje ravnine v fotomontaži, ki ga danes dela
hevristika robov (`src/lib/band-suggest.ts`)?

**Meritev:** `bun tools/depth-ab.ts` (model 27 MB, ONNX, CPU, brez mreže
ob delovanju). Oba detektorja tečeta na isti sliki in isti tapki; za
referenco je ročno označena vrednost (GT, ±1 % ročne napake).

## Meritev (19. 10. 2026)

| Primer (hiša z balkonom, Wikimedia Commons) | GT zgornji/spodnji | Hevristika robov | Globina (HF) |
|---|---|---|---|
| bela horizontalna ograja levo spodaj | 86,5 % / 92,0 % | **null („ne vem“)** | 67,6 % / 99,6 % → napaka **18,9 / 7,6 %** |
| balkonska ograja (poševna) | 45,5 % / 57,0 % | **null („ne vem“)** | 26,8 % / 72,6 % → napaka **18,7 / 15,6 %** |

Strošek modela na tej napravi: **≈ 740 ms** na sliko (2 jedri), **≈ 350 MB**
RAM-a, 27 MB modela, brez API-ja in brez mreže ob delovanju.

## Sklep (pošteno, z omejitvami)

**Model NI vključen v aplikacijo.** Naivno pravilo za pas iz globine na
tem primeru **ne premaga** hevristike: kadar hevristika ne najde pasu, vrne
`null` — to je »ne vem, označi ročno« — medtem ko globina vrne **napačen**
pas (napaka 8–19 % višine slike). Napačen predlog je za monterja slabši od
odsotnega predloga, zato je odločitev »ne vključujem« pravilna tudi po
načelu repozitorija (izmišljati ni, kar ni izmerjeno).

**Kaj ta meritev NE dokazuje:** (1) vzorec je ena slika in dve tapki;
(2) GT je ročno označen; (3) pravilo za pas iz globine je prva, groba
različica. Zato rezultat ne pravi »globina ne more pomagati«, temveč
»naivna integracija globine tu ne prinese izboljšanja«.

**Kdaj je vredno ponoviti:** z modelom, ki zna ravnino (ne pasu) — npr.
SAM 2 ali Grounding DINO za »segmentacija ograje« — in na vsaj treh realnih
fotkah z ročno označenim GT. Takrat je primerjava poštena, ker obe strani
iščeta ISTO stvar.

## Drugi A/B: segmentacijski model (SlimSAM 77 uniform, ONNX)

Isti štirikotnik, ista metrika (pokritost štirikotnika) — `tools/sam-ab.ts`:

| Metoda | Pokritost štirikotnika | Čas (CPU) | RAM |
|---|---|---|---|
| hevristika robov (v aplikaciji) | **71 %** | ~1 ms | ~0 MB |
| SlimSAM, prompt = 4 oglišča | 0,6 % | 20,3 s | ~2,0 GB |
| SlimSAM, prompt = 1 točka na ograji | 3,0 % | 22,4 s | ~2,0 GB |

**Sklep:** segmentacijski model s promptom na železni ograji objekt **ne
ujame** (0,6–3 % namesto 71 %) in je pri 20+ sekundah latence neuporaben za
interaktivno označevanje v terenu. Skupaj z globinskim modelom je odgovor
enak: **v aplikaciji ostane deterministična hevristika**, oba modela pa sta
dokumentirana kot izmerjena možnost za prihodnje delo (npr. kot pomožnik za
predlog, ne kot odločitev).
