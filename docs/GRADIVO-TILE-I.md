# Od kod pridejo tile-i (in zakaj je ta vir najboljši)

Fotomontaža je dobra toliko, kolikor je dober MATERIAL. Vir materiala sem
preveril na treh mestih — in izmeril, kateri je uporaben.

## 1) Uradna barvna lestvica (roksal.com/barvni-odtenki) — **UPORABLJENO**
`BARVNA_LESTVICA_*.png`, 2560 × 600 px. Vsebuje **8 krogov po 256 px** — to je
ostra slika odtenka z resnično zrnatostjo in pravilno barvo. Izrezi so
deterministični (`tests/make-ograje-tiles.ts`).

## 2) Uradne fotografije vgrajenih ograj (galerija + referenčni objekti) — **IZMERJENO, ZAVRNJENO**
`tests/make-galerija-tiles.ts` sam poišče desko (temna šprinja → korak) in
izmeri, kako velika je v resnici:

| Odtenek | Širina deske v fotografiji | Odstopanje barve od lestvice |
|---|---|---|
| Amazon wood | 9 px | Δ 13 |
| Ash wood | 12 px | Δ 32 |
| Golden teak | 11 px | Δ 72 |
| Burma teak | 18 px | Δ 16 |
| Oak wood | 17 px | Δ 77 |
| Rustic oak | 12 px | Δ 9 |
| White | 10 px | **Δ 212** (izrez je v senci) |

To so **arhitekturne fotografije** (celotna hiša, ograja v poti) — deska je
v njih široka le 9–18 px, zato je vsak tile zamegljen (povečava 14–28×), barva
pa odstopa od uradne lestvice. **Zato teh tile-ov ne uporabljam v aplikaciji**;
izhod raziskave je v `tests/fixtures/galerija-raziskava/` kot dokaz.

## 3) Fotografije od monterjev (npr. skupina »Ograje Lozar«) — **POTREBUJEM**
Bližnji posnetki (telefon, ena deska zapolni sliko) dajo ostre tile-e z
izmerjenim merilom. Pripravljeno je:
- `tests/fixtures/monter/MANIFEST.md` — navodila,
- `tests/make-monter-tiles.ts` — skript, ki sam poišče desko, odreže eno desko in
  jo shrani kot tile 256 × 256 z **pravim merilom** (`realCm` = realna širina
  deske: POLNA-100 = 10 cm).

Ko so fotografije v mapi, je delo: spusti slike → `bun tests/make-monter-tiles.ts`
→ tile-i v `public/roksal/ograje/<profil>/mont-<odtenek>.png` → registracija v
`roksal-assets.ts` → E2E → deploy.

## Merilo (objektivno, ne okus)
Barva tile-a se primerja z barvo odtenka na uradni lestvici (ΔRGB) in
upošteva se **širina deske v izvorni fotografiji** (večja = ostrejše). Tile z
ΔRGB > 30 in širino < 20 px se v aplikacijo ne vključi.
