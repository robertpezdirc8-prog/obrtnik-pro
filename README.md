# Obrtnik Pro

Delovna aplikacija za obrtnike: ponudbe in računi, evidence dela, gradbiščni dnevnik,
katalog ter **pametna kamera** z merjenjem po fotki, 3D predogledom, AR in
**fotomontažo ograj/fasad z originalnimi ROKSAL profili**.

Celotna aplikacija deluje **deterministično — brez generativne AI in brez plačljivih
zunanjih slikovnih storitev**. Vse meritve, analize in fotomontaže temeljijo na
klasičnih CV/postopkih (homografija, detekcija robov, SfM, teksturno tlakovanje).

> **Stanje:** aktiven notranji razvoj. Pristop je *dokazno načelo* — vsaka funkcija
> ima verifikacijske teste in E2E posnetke; ničesar ni treba »verjeti na besedo«
> (glej [Načela](#načela) in [Testi in dokazi](#testi-in-dokazi)).
> Zadnja polna preverba: **regresija 49/49 skript zeleno** (pet, ki je bilo doslej rdečih, je
> padalo samo zaradi poti, vezanih na razvojni stroj — `/tmp/*.png` in ena absolutna
> kontejnerska pot; odpravljeno 2026-10-16, Task 71, z novim varovalnim skriptom
> `portable-paths`), **photo-replace 391/391, assertion 119/119**
> (FAZA-8, oktober 2026). **PONOVLJENO PO FAZA-8 (2026-10-16, `node_modules` nameščeni):**
> `tsc --noEmit` — **0 napak v celotnem repozitoriju** (Task 79: `tests/e2e-compare-fixture.ts`
> je prešel z `Bun.write` na `node:fs.promises.writeFile`, `examples/websocket/` pa je iz
> `tsconfig` izključen, ker rabita `socket.io`/`socket.io-client`, ki ju zavestno NE nameščamo —
> primera nista del aplikacije in njuna tipizacija ne more pokriti napake v `src/`).
> `eslint .` izhod 0. E2E v brskalniku: mobilni 390×844 in
> namizni 1280, **0 konzolnih napak**, brez vodoravnega drsenja, dokazana FAZA-8 veja (širina
> pusta ⇒ značka »Širina ravnine NI izmerjena«, izris odprt, naročilnica zaprta z razlogom,
> merjenje onemogočeno). E2E je našel in odpravil DVA resnična UI problema, ki ju 391 statičnih
> preverjanj ne vidi: napačen vrstni red vej značke (je pisala »Kalibrirano · znane mere« kljub
> prazni širini) in prelivanje besedila čez 390 px. Dokaz: `tests/e2e-faza8-mobile-390.png`.
> **OKOLJE ODPRAVLJENO (Task 71, 2026-10-16):** pet skriptov, ki je doslej padalo zaradi
> poti, je prevedenih na `os.tmpdir()` oziroma relacijo do `import.meta.url`; skupaj z njimi
> je pregledanih še 10 E2E/orodnih skriptov z istim vzorcem. Nov skript `portable-paths`
> (28/28, mutacijsko dokazan) prepreči, da bi se taka pot vrnila.
> **DVOTAPNI PREDLOG RAVNINE (FAZA-9, 2026-10-16):** tok je preizkušen V BRKALNIKU na pravi
> fotki (najde: podpora 89 %/95 %, deterministično ponovljivo; zavrne: brez štirikotnika) in
> zdaj tudi AVTOMATIZIRANO — `tests/e2e-band-ui.ts` (**50/50**, sintetična fotka z znano resnico
> tirnic 50 %/75 %), `tests/verify/band-ui-contract.ts` (**58/58**, vir-gledni zaklep treh stvari,
> do katerih brskalnik ne more: ponastavitev ob menjavi slike, vrstni red vrat, edin izvor
> nepotrjene ravnine). Obe imata mutacijski dokaz.
> **CELA FOTOMONTAŽA (Task 77, 2026-10-16):** vseh sedem korakov je zdaj avtomatiziranih v
> `tests/e2e-fotomontaza-full.ts` (**55/55**) — od nalaganja fotke do IZVOŽENEGA PNG-ja na
> disku. Izris ni dokazan z »gumb obstaja« ampak s piksli (`meanDiff 40,81/255` znotraj
> kvadrata), izvoz z datoteko (`800×664`, veljavna PNG glava, žig z oznako je v sliki).
> `src/` nespremenjen — noben novega `data-testid` ni bilo treba dodati.
> **PRAVA FOTKA, MERJENA PROTI TERENU (Task 78, 2026-10-16):** `tests/e2e-fotomontaza-real.ts`
> (**53/53**) odpre 04.jpg in 16.jpg monterja (fotke SO zunaj repozitorija, pot iz argumenta,
> brez fotk izhodna koda 2), tapne dvakrat in izmeri tirnici PROTI ročno prebranemu GT.
> Rezultat: **mediana 2,3 %, max 10,1 %** — enako kot zamrznjena jedrna sonda — in tirnici se
> z jedrom ujamata na **0,00 %** na istih bajtih. Pri tem je UI-plast našla napako, je jedro
> ne more: potrjen predlog brez mere je krivil oglišča namesto manjkajoče mere (popravljeno v
> `foto-replace.tsx`, zaklenjeno v `band-ui-contract.ts` in v E2E).
> **OBJAVLJENE MERE namesto ugibanja (Task 80, 2026-10-16):** številka razmika med stebrički
> v razporedu stebrov doslej ni bila podatek — bil je privzetek kode (`150`). Zdaj je to
> modul `src/lib/roksal-span-rules.ts` (**74/74**), ki hrani 16 ROKSALovih pravil **iz besede v
> besedo** (navedeno + URL `roksal.com`), vsako razvrščeno kot `DIRECT` (gre za ta element) ali
> `ADJACENT` (sistemski namig iz DRUGEGA elementa — NIKOLI ne postane meja, samo opombo),
> pas (npr. 133–140 cm) pa je vedno rešen z SPODNJIM robom. Monterjev vmesnik zdaj pokaže
> »Največ 150 cm po ROKSALovih navodilih (roksal.com/…montaza-wpc-deske/) — „…»« in OPOZORI,
> če je izbrana meja nad objavljeno; proizvajalčeva lastna RAZHAJANJA (150 proti 180 cm pri
> nizki ograji) javi in vzame NIŽJO, ne tiho reši. Dokaz v brskalniku: `tests/e2e-span-rule-ui.ts`
> (**20/20**) z `span-rule-ui.png` na disku, panel je zdaj viden tudi BREZ fotke (nov vnos v
> zavihku Pripomočki). Računski razpored (`planPostLayout`) se ni spremenil — pravila svetujejo,
> ne vsiljujejo, zato uporabnikova izbira ostane veljavna in je jasno označena kot nad mejo.

---

## Vsebina

- [Pregled](#pregled)
- [Funkcije](#funkcije)
- [Fotomontaža (fotomenjava ograje)](#fotomontaža-fotomenjava-ograge)
- [Načela](#načela)
- [Tehnološki sklad](#tehnološki-sklad)
- [Lokalni zagon](#lokalni-zagon)
- [Testi in dokazi](#testi-in-dokazi)
- [Struktura projekta](#struktura-projekta)
- [Dokumentacija](#dokumentacija)
- [Znane omejitve (iskreno)](#znane-omejitve-iskreno)

---

## Pregled

Obrtnik Pro pokriva celoten tok dela obrtnika — od prve fotke na terenu do ponudbe,
računa in evidence izvedbe:

```
zajem (kamera/upload) → kontrola kakovosti → analiza po obrti
→ kalibracija (referenca / ravnina-homografija) → meritve
→ prefill kalkulatorja → kosovnica/ponudba → račun → plačila
→ fotomontaža (ista ravnina uporabljena za perspektivo)
→ časovnica + dnevnik (evidence izvedbe)
```

Podatki so lokalni (SQLite prek Prisme); UI je v slovenščini in namenjen tudi
delu na telefonu (poljski način).

## Funkcije

Aplikacija ima 8 zavihkov (`src/components/app-shell.tsx`):

### 🏠 Domov
Preglednadna plošča s stanjem ponudb, terjatvami in hitrim dostopom do orodij.

### 📷 Pametna kamera
Najobsežnejši sklop (`src/components/camera/`):

- **Zajem** — živa kontrola svetlobe/kakovosti med fotkanjem, vodič po zajemu
  (`photo-capture.tsx`, `capture-guide`), upravljanje posnetkov (`shot-picker`).
- **Analiza po obrti** — avtomatska analiza fotk: ograje/piketna (`bar-counter`,
  `post-layout-panel`), terasne deke (`deck-panel`), fasade (`fasada-panel`),
  stopnice (`stair-panel`), kozinci (`canopy-panel`), odprtine (`opening-panel`),
  ploščice (`tile-panel`), skice prostorov (`room-sketch`).
- **Merjenje** — kalibracija po referenčnem predmetu ali ravnini (homografija),
  večfotna veriga (`multiview.tsx`), SfM/COLMAP 3D model (`colmap-3d.tsx`),
  laser-protokoli (`laser-panel`), test natančnosti (`accuracy-test.tsx`).
- **3D in AR** — predogled 3D (`preview-3d.tsx`), živi AR (`live-ar.tsx`),
  AR merjenje prek WebXR z ARCore Depth (`webxr-ar.tsx`).
- **Vizualizacija in fotomontaža** — vizualizer ograj/dek (`viz-panel.tsx`) in
  fotomenjava na lastni fotki stranke (`foto-replace.tsx`) — podrobno spodaj.
- **Glasovni vnos** — diktiranje mer (`voice-input.tsx`).

### 📋 Nova ponudba
Kalkulatorji po obrtih (`src/components/calculators/`): material, deleži obrti (GBB),
izračun cene; meritve iz kamere samodejno prefill-ajo kalkulator.

### 📑 Ponudbe
Upravljanje ponudb in računov: statusi (osnutek → poslana → odločena z časovnimi
žigi za iskren win-rate), Wiedervorlage opomniki za follow-up, DDV (privzeto 22 %),
PDF izvoz, sledenje plačil in terjatev.

### ⏱ Časovnica
Evidence delovnega časa (vnosi, po projektih/obrtih).

### 📓 Dnevnik
Gradbiščni dnevnik z fotkami (AB-vnosi, izvoz).

### 🗂 Katalog
Kategorije in izdelki z enotami/cenami — izvor postavk za ponudbe.

### ⚙️ Nastavitve
DDV, eSLOG nastavitve in druge preference.

## Fotomontaža (fotomenjava ograje)

Glavna funkcija za stranke: **ista fotka** — uporabnik označi obstoječo ograjo,
izbere ROKSAL profil in barvo, aplikacija pa na istem mestu z isto perspektivo
upodobi novo ograjo.

Tok (`foto-replace.tsx` + `src/lib/photo-replace-*`):

1. **Naloži fotko** → demo kvadrant + vodič za fotkanje.
2. **Kalibracija ravnine** — znane mere ali referenca → homografija
   (ista ravnina, ki jo uporablja merjenje).
3. **Maska stare ograje** — ročno označevanje + samodejni predlog; klasični
   inpainting (brez AI) odstrani staro ograjo; neuspešna obnova **ni prikazana
   kot uspeh** (iskren status), ročni popravek je vedno na voljo.
4. **Izbira profila in barve** — katalog ROKSAL profilov z **originalnimi
   gradivi** (glej spodaj) + iskrene oznake pripravljenosti. Poleg tega
   **izmeri obstoječo desko na fotki** (2 klika na kalibrirani ravnini,
   perspektivno popravljeno prek homografije) → predlog najbližjih uradnih
   profilov z izpisano razliko v cm in % (natančno/blizu/različno; barvne
   različice istega profila kot EN predlog). Predlog je najbližji po ŠIRINI —
   enakost mere ne dokazuje istovetnosti (iskrena opomba v UI); klik predloga
   ga izbere (isti mehanizem kot mreža).
5. **Upodobitev** — deske z originalno teksturo, pravilna mera/razmak/perspektiva
   (45 cm tile, zrcalno tlakovanje na nivoju rendererja), plasti/okluzije,
   svetlobno ujemanje.
6. **Primerjava profilov** — mreža upodobitev vseh profilov na isti fotki
   (skupno deterministično jedro `renderForProfile`).
7. **Pred/po drsnik, različice z metapodatki, izvoz PNG z žigom** ter
   **kosovnica v ponudbo** — iz shranjenih metapodatkov en klik „Material v
   ponudbo“: št. desk (ISTA formula kot v upodobitvi — `tests/verify/photo-bom.ts`
   dokazuje invarianto z `computePlankLayouts`), rez, skupni metri in rezalni
   načrt (samo z uradnimi nabavnimi dolžinami ROKSAL). Cene ostanejo 0 z opombo
   (ROKSAL cen ne prevajamo); stebri/pritrdilni material se ne izmišljajo.
   Poleg tega **izvoz pred/po v ENI datoteki** („Izvozi pred/po“): levo
   nespremenjeni original, desno upodobitev, žig + kontekst v sliki — isti
   izvozni prehod iskrenosti (`canExportResult`) in enoten žig (`EXPORT_LABEL`);
   enaki vhodi → bajt-identična datoteka (dokazano: namizje ≡ mobilni 390,
   100.907 bajtov).

### Katalog ROKSAL profilov (originalna gradiva roksal.com)

Uradi so prenešeni z uradnih strani ROKSAL (barvne lestvice, preseki, vgradnje)
in deterministično obdelani (`tests/make-*-fetch.ts` prek CDP,
`tests/make-*-tiles.ts` s sharp — brez AI):

| Družina | Uradna mera | Dekorjev |
|---|---|---|
| KUBO 80/42 | 80 × 42 mm | 4 |
| TERASNA 150×25 | 150 × 25 mm | 7 |
| POLNA DESKA-57/32 | 57 × 32 mm | 4 |
| POLNA DESKA-100 | 100 × 12 mm | 8 |
| POLNA DESKA-128 | 128 × 16 mm | 6 |
| ROMB DESKA-67 | 67 × 26 mm (z alu cevjo) | 7 |

**36 uradnih profilov** + 6 generičnih vizualizer privzetkov. Gradiva so v
`public/roksal/` (lestvice, preseki, vgradnje, dekor tile-i 256×256).

### Objavljena montažna pravila (`src/lib/roksal-span-rules.ts`)

Dokler je bila meja razmika med stebrički samo privzetek kode (`150`), je aplikacija
monterju prodajala številko, ki je ni znala utemeljiti. Zdaj je 16 ROKSALovih pravil za
razmike shranjenih **iz besede v besedo**, vsako s svojim virom:

| Polje | Pomeni |
|---|---|
| `quote` / `source` | dobesedni citat z roksal.com in URL strani, od kod je vzet |
| `basis` | `DIRECT` (citat govori O TEM elementu) / `ADJACENT` (sistemski namig IZ DRUGEGA elementa) |
| `kind` | `limit` (merjena meja) / `consequence` («pri ≥ 180 cm dodaj še en stebriček» — NI meja) |
| `bandCm` | objavljen pas (133–140, 133–145, 70–80) → vedno velja **SPODNJI** rob |

Pravila, ki jih iz tega izpelje `maxAllowedSpan`: meja je **najnižja** med uporabnimi
`DIRECT` pravili; `ADJACENT` pravili (100 cm nosilci, 120 cm KUBO lemnice) NIKOLI ne
vežeta — dasta samo opombo, ker citat ne govori o stebričkih; kjer se proizvajalec SAM
protislovi (150 cm »ne glede na višino« proti 180 cm pri nizki ograji), se razhajanje
**izpiše** in vzame NIŽJA meja, ne tiho izbere. Kjer podatka ni (npr. profil ni znan), je
odgovor iskreno `UNKNOWN` z mejo `0`, ne ugibanje.

V monterjevem vmesniku (`post-layout-panel`) to pomeni: pri razporedu je vedno izpisana
objavljena meja z citatom in virom — »Največ 150 cm: „Maksimalni razmak med stebrički je
150 cm ne glede na višino ograje." « (roksal.com/woodcore-wpc-deske/montaza-wpc-deske/).
Če monter izbere višjo mejo, se pojavi OPOZORILO, razpored pa še vedno računa z izbrano
mero — pravila svetujejo, ne prevzemajo odločitve namesto človeka.
Pokrito z `tests/verify/roksal-span-rules.ts` (**74/74**) in
`tests/e2e-span-rule-ui.ts` (**20/20**).

### Iskrenost fotomontaže (pomembno)

- Gradiva z viri roksal.com so označena `roksal-original` + **`unverified`**
  (barvna zvestoba zaslonu ni osebno overjena) → **izvoz z oznako »original«
  ostaja blokiran**; izvoz vedno vsebuje žig
  **„VIZUALIZACIJA ZA PREDSTAVITEV“**.
- Imena dekorjev ROKSAL uradno **ne objavlja** → oznake so po **položaju**
  (dekor-1 … dekor-N), brez izmišljenih trgovskih imen.
- Tipena privzetka (razmak `gapCm`, širina stebra `postCm`, `realCm` merila
  lestvice) so **izrecno označena kot privzetki** v opombah registra
  (`src/lib/roksal-assets.ts`).
- Manjkajoča gradiva so **dokumentirana in ostajajo manjkajoča** (ne
  nadomeščena z izmišljenimi) — glej [Znane omejitve](#znane-omejitve-iskreno).

## Načela

1. **0 generativne AI, 0 plačljivih storitev.** Vsi vizualni/celotni tokovi so
   deterministični klasični algoritmi. Rezultat je ponovljiv.
2. **Iskrenost.** Manjkajoče gradivo se jasno označi in ne nadomesti z izmišljenim;
   neuspešen korak se ne prikaže kot uspeh; izvoz je vedno vidno žigosan kot
   „VIZUALIZACIJA ZA PREDSTAVITEV“.
3. **Dokazno načelo.** Vsaka trditev o delovanju ima test ali E2E posnetek
   (`tests/e2e-*.png`). Build uspeh ≠ funkcija deluje.
4. **Brez počakovanja:** ročni popravek je vedno na voljo tam, kjer je
   avtomatika nepopolna (maska, obnova, meritve).

## Tehnološki sklad

| Plast | Tehnologija |
|---|---|
| Ogrodje | **Next.js 16** (App Router) + React + TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui (New York), Lucide ikone, framer-motion |
| Stanje | Zustand (odjemalec), API routes (strežnik) |
| Baza | **Prisma 6 + SQLite** (`db/custom.db`) |
| Slike | sharp (deterministična obdelava), Canvas API v brskalniku |
| Validacija | zod |
| Izvajanje | Bun (razvoj + skripte) |
| CV / merjenje | lastne knjižnice: `homography`, `edge-detect`, `measure-geometry`, `multiview-sfm`, `colmap-model`, `ar-depth`, `cv-engine`, … |

## Lokalni zagon

Zahteve: [Bun](https://bun.sh) ≥ 1.x

```bash
bun install

# baza (SQLite; DATABASE_URL v .env)
bun run db:push

# razvoj na http://localhost:3000 (log: dev.log)
bun run dev

# kontrola kakovosti
bun run lint
```

Produkcijski build (standalone):

```bash
bun run build
bun run start   # .next/standalone/server.js
```

## Testi in dokazi

### Verifikacijske skripte (49)

Stoje v `tests/verify/` in se poganjajo posamezno z Bunom (sintetične slike,
brez brskalnika):

```bash
bun tests/verify/photo-replace.ts     # fotomontaža — 391 preveritev
bun tests/verify/photo-bom.ts         # kosovnica iz fotomontaže — invarianta z upodobitvijo
bun tests/verify/photo-compare.ts     # izvoz pred/po — postavitev, oznake, iskrenost
bun tests/verify/photo-profile-suggest.ts  # predlog profila iz izmerjene deske — pragovi, dedup, determinizem
bun tests/verify/roksal-tiles.ts      # kakovost VSEH 32 dekor tlakov — 199 preveritev
bun tests/verify/multiview-chain.ts   # veriga fotk / od AB
bun tests/verify/colmap-model.ts      # SfM/COLMAP
bun tests/verify/deck-analysis.ts     # analiza dek
bun tests/verify/assertion.ts         # FAZA-8: dve osi trditev, totalna 25/25 projekcija
bun tests/verify/plank-layout-width.ts # FAZA-8: neznana širina ravnine (kanon. mera, pravilo 13)
bun tests/verify/render-promise.ts   # F3: kaj UI SME obložiti o izrisu (30-kombinacijska tabela)
bun tests/verify/portable-paths.ts  # Task 71: nobena pot ne sme biti vezana na konkretn stroj
bun tests/verify/band-suggest.ts    # FAZA-9: dvotapni pas — pragovi, plateau, zavrnitev naklona
bun tests/verify/suggest-gate.ts    # FAZA-9: vrata predloga (SUGGESTED ne odpre izrisa/naročilnice)
bun tests/verify/band-ui-contract.ts # FAZA-9: vir-gledni zaklep UI vrat (kar brskalnik ne more)
bun tests/verify/gt-evidence.ts     # Task 75: dokazna gradiva sonde so še na mestu in se ujemajo z dokumenti
bun tests/verify/roksal-span-rules.ts # Task 80: 16 objavlenih ROKSAL pravil — citat, vir, pas, razhajanje
# … (celoten seznam: tests/verify/)
```

Izhod vsake skripte: `REZULTAT: N OK, 0 NAPAK` + izhodna koda `1` ob napaki.
Zadnja preverba (2026-10-16, FAZA-8 + F3 + Task 71 + FAZA-9 + Task 75 + Task 80): **49 skript, 49 z izhodno kodo 0**.
Pet skriptov, ki je doslej padalo (`canopy-analysis`, `deck-analysis`, `fasada-analysis`,
`stair-profile`, `tile-grid`), je prevedenih na `os.tmpdir()` oziroma relacijo do
`import.meta.url`, njihovi števci pa so zdaj izmerjeni NA TEJ STROJI: 52 + 53 + 33 + 15 + 41
= **194**. Nov varovalni skript `portable-paths` (**28/28**, z mutacijskim dokazom) prepove
absolutne strojno vezane poti v `src/` in `tests/`. Izmerjeno posamezno: **photo-replace 391/391**,
**assertion 119/119**, **measurement-status 90/90** (besedilo testa nespremenjeno),
**multiview 104**, **multiview-chain 66**, **multiview-sfm 122**, **multiview-split 50**,
**scale-split 56**, **plank-layout-width 26**, **roksal-tiles 199/199**,
**photo-bom 25/25**, **photo-compare 45/45**, **photo-profile-suggest 59/59**, **render-promise
25/25**, **gt-evidence 102/102**, **roksal-span-rules 74/74**. Assertivnih preverjanj skupaj,
zdaj IZMERJENO Z ENO STEVLJO in
ne sešteto iz spomina: **2811 OK / 0 NAPAK** v **42** od **49** `tests/verify/*.ts` skriptov;
sedem (`features-photos`, `real-photos`, `structure-photos`, `debug-energies`, `scores-debug`,
`quality-calibrate`, `scene-classify`) je raziskovalnih izpisov brez brojača preverb. Ponovi z
`bun tests/verify-counts.ts` — če nov skript ne izpiše povzetka, agregator vrne izhodno kodo 1,
zato številka ne more pasti neopaženo. Prejšnja ročno sestavljena številka **2757** je bila za
**20 previsoka**: `eslog.ts` v izpisu vrve DVE zaporedni števili (72 in 101) in seštevek jima je
obema prisluhnil, agregator pa zna poizvedeti samo zadnjo vrsto (101) — dokaz, da mora biti
seštevek izmerjen, ne zapisan. Zadnja delta je izmerjena enako: 2737 → **2811** = +74
(`roksal-span-rules`), nič se ni izgubilo.
E2E preverjanj (tečajo v brskalniku, NISO v zgornjem seštevku): `e2e-band-ui.ts` **50/50** (vključno s tremi posnetki, katerih velikost je preverjena),
`e2e-fotomontaza-full.ts` **55/55** (vseh sedem korakov, vključno s pravim downloadom PNG na disk),
`e2e-fotomontaza-real.ts` **53/53** (pravi fotki 04.jpg + 16.jpg, napaka merjena proti GT —
zažene se SAMO z argu­mentom fotokorpusa, ker fotk ni v repozitoriju),
`e2e-span-rule-ui.ts` **20/20** (Task 80: citirana meja, vir, opozorilo nad mejo in razhajanje
150/180 v živem vmesniku; posnetek `span-rule-ui.png` preverjen po velikosti NA DISKU, zapisnik
pa gre skozi `guardOutSideRepo`, ki ZAVRŽE zapis v repozitorij),
`e2e-colmap-cdp.ts` 36/36.

### E2E dokazi

Posnetki agent-browser sej so shranjeni v `tests/` (konvencija
`tests/e2e-<tema>-*.png`), npr. `e2e-ograje-01-polna100-rezultat.png`,
`e2e-kubo6-03-detajl-desk.png`, `e2e-deka-04-primerjava.png`, celoten tok
`e2e-final-01-rezultat … -03-mobilni390.png` (Task 59: upodobitev KUBO
dekor-2 z kalibrirano perspektivo 0,257 cm/px, metapodatki različice z žigom,
mobilni 390), kosovnica `e2e-bom-01-kosovnica-v-ponudbi … -04-mobilni-
kosovnica.png` (Task 64: material iz različice v osnutek ponudbe — 16 kosov,
rezalni načrt, namizje + mobilni 390) ter pred/po izvoz `e2e-compare-01-
primerjava.png … -05-brez-originala.png` (Task 65: PRAVA izvožena datoteka
ujetá pri palačinki `URL.createObjectURL` in preverjena pikselsko
(`tests/e2e-compare-check.ts`: levo = original, desno = upodobitev, žig temen,
ločilo), bajt-identična na namizju in mobilnem 390, blokirana brez gradiva,
iskrena napaka brez originala v sejanu) ter predlog profila `e2e-suggest-01-
predlogi-panel … -04-mobilni-predlogi.png` (Task 66: izmerjena deska 9,9 cm
na kalibrirani ravnini 500×180 — ENAKA vrednost kot homografska napoved iz
fixture, predlogi z razlikami v cm/%, klik predloga izbere profil,
prikazano do upodobitve z izbranim profilom; namizje + mobilni 390 brez
vodoravnega prelivanja). Pokrivajo namizni in mobilni prikaz
(390 px), izvoz z žigom, primerjave profilov in celoten tok fotomontaže.

**Avtomatizirani E2E skripti** (CDP prek WebSocket, brez Playwright — poganjajo se z `bun`
ob zažganem `next dev` na 3000): `tests/e2e-band-ui.ts` (**50/50**, FAZA-9: dvotapni predlog
na sintetični fotki z ANALITIČNO resnico tirnic 50 %/75 %, tolerance 1,5 %; iskrena zavrnitev,
črtkan štirikotnik, vrstni red blokerjev, amber `SUGGESTED` plošča, zaprt izris, potrditev,
mobilni 390, nič konzolnih napak; mutacijsko dokazan),
`tests/e2e-fotomontaza-full.ts` (**55/55**, Task 77: VSEH SEDM korakov fotomontaže v vrsti —
nalaganje fotke prek pravega `input[type=file]`, dvotapni predlog + potrditev, samodejna maska
(100 % kvadrata / 14 % fotke), obnova 66.236 pikslov, profil, izris in IZVOZ. Izris je dokazan
s PIKSLI, ne s prisotnostjo gumba: notranjost kvadrata se razlikuje od originala za
`meanDiff 40,81/255`, ni enobarvna (`spread 11,73`) in ima 124 odtenkov. Izvoz je dokazan z
DATOTEKO: pravi brskalnikov download na disk, veljavna PNG glava, `800×664` — višina je
64 px večja od platna, ker je žig z oznako za predstavitev pristitan v sliki. Nič v `src/`
ni bilo spremenjenega: vsi `data-testid`-i so že obstajali. Manjkajoča aplikacija je glasna
napaka z izhodno kodo 2, ne tiha ničla.) in `tests/e2e-colmap-cdp.ts` (36/36 —
temu je bil letos popravljen `--user-data-dir`, ki je kazal na kontejnerski `/tmp` in je
skript na tej stroji naredil nezagonljivega).

### Orodja za gradiva (`tests/make-*`)

- `make-kubo-fetch.ts`, `make-deka-fetch.ts`, `make-ograje-fetch.ts` —
  prenos uradnih gradiv roksal.com prek CDP (chrome-headless-shell;
  idempotentna skripte).
- `make-kubo-tiles.ts`, `make-deka-tiles.ts`, `make-ograje-tiles.ts` —
  deterministična obdelava v dekor tile-e (detekcija krogov na lestvici,
  enojni ne-zrcaljen izrez, zasuk, preverbe: brez skoraj-črnih pikslov,
  navpična žira, brez notranje metulj-simetrije).

Vseh **32 dekor tlakov** na disku je 256×256 — ločljivost je **zadoščajoča**:
delovna kopija fotke je omejena na 1280 px, 45 cm tile je na njej ≈ 186 px
(1,4× prevzorčenje), zato višja ločljivost ne bi dala vidnega dobička
(izmerjeno Task 60). Kakovost vseh 32 tlakov (vseh 5 družin) je od Task 62
**trajno preverjena** (`tests/verify/roksal-tiles.ts`, 199 preveritev):
registry ↔ disk 1:1 (brez orphan datotek), 256×256 enojni izrez, 0 skoraj-črnih
pikslov, navpična žira z merjeno maržo, vidna žira (meanDx) in brez notranje
zrcalne (metulj) simetrije — pragi umerjeni na izmerjenih vrednostih vseh 32
tlakov.

## Struktura projekta

```
src/
  app/            # strani + API routes (offers, invoices, photos, settings, …)
  components/     # UI: app-shell (zavihki), camera/, calculators/, ui/
  lib/            # jedro: meritve, analize, fotomontaža, poslovanje
prisma/           # shema (Category, Product, Offer, Invoice, Photo, TimeEntry, DiaryEntry, …)
public/roksal/    # uradna gradiva roksal.com + dekor tile-i
tests/            # verify/ (49 skript), gt/ (sonde + zamrznjeni izpisi), e2e-*.png, e2e-*.ts (CDP), make-* orodja
docs/             # MEASUREMENT-BASELINE.md, FAZA-8-RAZCEP-TRDITEV.md, gitlab-issues/
worklog.md        # delovni dnevnik razvoja (po Task ID)
```

## Dokumentacija

- [`docs/MEASUREMENT-BASELINE.md`](docs/MEASUREMENT-BASELINE.md) — dokazno
  stanje merilnega sistema (datoteka · funkcija · test za vsak korak verige).
- [`worklog.md`](worklog.md) — dnevnik dela po nalogah (Task ID, dokazi,
  odločitve, iskrene omejitve).
- `docs/gitlab-issues/` — lokalne kopije issues (fotomontaža sledi **issue #14**,
  ki ostaja odprt dokler fotomontaža ni dokazano dokončana z originalnimi
  gradivi za vse obljubljene profile).

## Znane omejitve (iskreno)

- **Manjkajoča originalna gradiva (3):** presek alu palice (ni v programu
  ROKSAL), vzorec RAL 7016 (ROKSAL ne objavlja RAL lestvic — uporabljena je
  standardna barvna referenca z iskreno oznako), presek POLNA-100 (ni
  objavljen; poglobljena raziskava 2026-10-15: roksal.com nima katalogov za
  prenos, trgovski viri — WPS katalog in KAVA Co-ex — zavrnjeni po iskrenem
  standardu, ker niso ROKSAL WoodCore). Vsi dokumentirani v registru z
  opombami »RAZISKAVA 2026«.
- **Renderer ne riše** kosooglatega preseka ROMB desk in alu cevi (reže kažejo
  ozadje) — dokumentirano v opombi profila.
- **Izvoz z oznako „original“ je blokiran** dokler gradiva niso osebno overjena
  (fizični vzorci); vsi izvozi nosijo žig „VIZUALIZACIJA ZA PREDSTAVITEV“.
- Tipena privzetka razmaka (0,2–3 cm uradni obseg) in stebra so izrecno
  označena; merilo uradnih lestvic ni objavljeno (`realCm` je privzetek).
- COLMAP-WASM raziskava je odprta (lokalna SfM v brskalniku).

---

*Notranji projekt. Vsi logotipi in blagovne znamke pripadajo lastnikom;
ROKSAL gradiva so uporabljena z navedbo vira (roksal.com) in so neoverjena
zaslonska reprodukcija.*
