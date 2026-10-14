# MEASUREMENT-BASELINE — dokazno stanje merilnega sistema

> Faza 0 issue-ja »ROKSAL Measurement Reliability & Classical 3D«.
> Namen: dokazljivo zabeležiti, kaj je DEJANSKO implementirano (datoteka · funkcija · test),
> kaj je približek z jasno oznako, kateri testi pokrivajo kaj ter kateri podatki/strojna oprema manjkajo.
> Datum osnove: 2026-10-13 · HEAD pred to nalogo: `8f240f7` · veja: `main`

## 1. Tok meritve (celotna veriga)

```
zajem (kamera/upload) → kontrola kakovosti → klasifikacija → meritvena skripta po obrti
→ kalibracija (referenca / ravnina-homografija) → status mere (measurement-status)
→ prefill kalkulatorja → kosovnica/ponudba → fotomontaža (isto ravnino uporablja za perspektivo)
```

Vsak korak spodaj s podatkom: DATOTEKA · funkcija · DOKAZ (test/E2E).

## 2. Kaj je dokazano implementirano (z dokazi)

### 2.1 Zajem in kakovost
| Korak | Implementacija | Dokaz |
|---|---|---|
| Stiskanje/EXIF | `src/lib/image-quality.ts` — `compressElement` (createImageBitmap, max 1280 px, JPEG 0,82) | E2E vsi tokovi; dev.log brez napak |
| Kontrola kakovosti | `src/lib/image-quality.ts` — `qualityMetrics`, `qualityScore`, `qualityVerdict`, `checkQuality` (240×240, BT.601) | `tests/verify/quality-calibrate.ts` 19/19 |
| Živa kontrola svetlobe | `src/components/camera/photo-capture.tsx` — `liveLight` (64×48 @600 ms) | E2E `e2e-t11-*` |

### 2.2 Kalibracija in geometrija
| Korak | Implementacija | Dokaz |
|---|---|---|
| Globalno merilo pxPerCm | `src/lib/measure-geometry.ts` — `lengthCm`, `polygonAreaM2`, `polygonSidesCm`, `chainStats`; VSE vračajo `null` pri `!pxPerCm ‖ pxPerCm ≤ 0` (TIHEGA PRIVZETKA 1 cm/px NI — grep po src potrdil) | `tests/verify/measurement-status.ts` 90/90 + uporaba v vseh panelih |
| Planarna homografija | `src/lib/homography.ts` — `solveHomography` (Gaussova eliminacija, delna pivotizacija), `calibratePlane` (4 oglišča + realna W×H cm, degenerirane zavrnjene), `planeDistanceCm`, `planePolygonAreaM2`, `planeChainStats` | E2E `e2e-plane-*.png`; numerična pokritost prek `photo-replace` testov (isti reševalnik) |
| Samodejni predlog reference | `src/lib/cv-engine.ts` — `buildScaleSuggestions` (blob/rob hevristika) | `tests/verify/scale-suggestions.ts` ✓ |
| Skica prostora (tloris iz meritev sten) | `src/lib/room-sketch.ts` — `closeRoomPolygon` (tahometrija + kotno zaprtje + Bowditch/kompasna porazdelitev; ≤ 0,2 % = closed, ≤ 5 % = adjusted z opozorilom, > 5 % ali kotna napaka > 15°/kot = OPEN — površina null, ne tiha poravnava), `rectWalls`, `polygonAreaCm2`; UI `src/components/camera/room-sketch.tsx` (SVG risba, hitri vnos iz laserja/glasu, prefill keramika/WPC/fasada) | `tests/verify/room-sketch.ts` 48/48 (ročno izračunan Bowditch 500/300/505/300 → 5 cm, stranice 501,56/503,43, ploščina 15,07 m²); E2E namizje+mobilni |
| Protokol testa natančnosti (Faza 7 orodje) | `src/lib/accuracy-test.ts` — `entryError` (abs cm + relativni %), `aggregateStats` (mediana, povprečje, P95 z linearno interpolacijo, max, delež v toleranci; POGODBA: < 5 meritev = NEZADOSTNO — brez trditev), sodbe nezadostno/potrebna-izboljšava/osnovno/zanesljivo, `statsToCsv` (BOM, ;, vejica); UI `src/components/camera/accuracy-test.tsx` (localStorage do 100, hitri vnos iz laserja, AlertDialog čiščenja, izvoz CSV) | `tests/verify/accuracy-test.ts` 35/35 (P95 interpolacija ročno: [0,5..2,5] → 2,4 %; 20 meritev → 1,805 %); E2E: 6 zapiskov → »Mediana v toleranci, izstopajoči primeri« (1,07/2,18/2,4 %), obstojnost po reload-u |
| Merilno poročilo (tisk/PDF) | `src/lib/measure-report.ts` — `buildSketchSvg` (vektorski tloris: Y-zrcaljenje, oznake stranic sl-SI z vejico, ≈ pri adjusted, črtkano rdeče pri open, žig površine), `buildMeasureReportHTML` (naslovni blok z znamko obrta + skica + statistika + tabela vseh meritev + iskrena noga; iztiskanje vseh uporabniških nizov; deterministično pri podanem `now`), `printMeasureReport` (skriti iframe — deluje tudi na mobilnem Safariju, kjer je window.open+print blokiran); UI: gumb v Skici prostora + gumb v Merilnem listu (en handler, dva vstopa) | `tests/verify/measure-report.ts` 48/48 (Y-zrcaljenje rekonstruirano ročno: (0,0)→SVG y 360, (0,400)→40; Bowditch oznake ≈ 501,6/503,4 cm; iztiskanje `<script>`; open → ploščina NI v poročilu); E2E obe vstopni poti: iframe vsebuje naslov/15,07 m²/obseg 16,05 m/sodbo/opozorilo/tabelo laser 4,12 m/znamko+iskreno nogo; namizje+mobilni brez h-drsenja |
| Protokoli laserjev za znane modele | `src/lib/laser-protocols.ts` — `parseBoschGlm120Indication` (C0- okvirji, float LE v metrih na bajtih 7–10; vir: lz1asl/CaveSurvey #150), `parseBoschC0Response` ([status][len][u32 LE × 0,05 mm]; vir: eevblog GLM 20 + philipptrenz/BOSCH-GLM-rangefinder; statusi 01/03/04/05/08/10/0D → iskrena opozorila, BREZ vrednosti), `parseGenericText` (izrecna enota v besedilu: mm/m upoštevana, golo število = cm — dosedanje vedenje), `parseGenericBytes` (u16/u32 LE v mm), `parseLaserValue(dv, model)` (auto: protokolni okvirji pred besedilom), `detectLaserModel` (GLM 120 → glm120; GLM/PLR+številka → c0), sprožitvena zaporedja kot KONSTANTE iz virov (GLM120_INIT/TRIGGER/MODE_DISTANCE, BOSCH_C0_MEASURE), `protocolSelfTest` (8 fiksatur); UI `laser-panel.tsx`: izbira modela (Select), samopreizkus čip, GLM 120 C best-effort pisanje zaporedja z iskrenim sporočilom, modelRef za obstoječega poslušalca | `tests/verify/laser-protocols.ts` 72/72 z ROČNO izračunano resnico (6f 81 04 3f = 0x3F04816F = 0,517615 m → 51,76 cm; 0x00000E13 = 3603 × 0,05 mm = 18,015 cm; u32 0x0001D4C0 = 600 cm; meje razpona, statusi, odmevi, zaokroževanje, determinizem); E2E: čip 8/8 v brskalniku, izbira modela + namig (GLM 120 C / DISTO besedilo), ročni vnos 350 → »Laser 1: 3,50 m«, namizje 1280 + mobilni 390×844 (scrollWidth 390), konzola čista |
| Statusna pogodba meritev | `src/lib/measurement-status.ts` — `validateScale` (5 kod: NO_CALIBRATION, ASSUMED_SCALE, DEGENERATE_REFERENCE, PLANE_REQUIRED, OK), `MeasurementStatus` (ESTIMATED→CONFIRMED), `MeasurementProvenance`, `downgradeOnReferenceChange`, `makeProvenance` (POGODBA: assumed-reference NIKOLI CALIBRATED+) | `tests/verify/measurement-status.ts` 90/90 |
| Označevanje statusov v UI | `src/components/camera/photo-canvas.tsx` — `measureProvenance()` (ravnina → CALIBRATED/plane-homography; znana dolžina → CALIBRATED/known-length; domnevna referenca/QUICK_REFS čipi → AUTO_SUGGESTED/assumed-reference); `camera-view.tsx` — `addAuxMeasure` (laser/glas → MANUAL) | E2E fotomontaže: značka »Kalibrirano · znane mere« |

### 2.3 Meritvene skripte po obrteh (0 AI, klasična CV)
| Obrt | Implementacija | Dokaz |
|---|---|---|
| Ograje — trasa/stebri/razrez | `src/lib/bar-count.ts` (Radon + ACF), `src/lib/post-layout.ts` | `tests/verify/bar-count` v E2E; `tests/verify/post-layout.ts` 33/33 |
| Stopnice — profil/Blondel | `src/lib/stair-profile.ts` | `tests/verify/stair-profile.ts` 15/15 |
| Keramika — vzorec/formati | `src/lib/tile-grid.ts` (36-kotna projekcija + Pearson ACF) | `tests/verify/tile-grid.ts` 41/41 |
| WPC terasa — deske/nosilci | `src/lib/deck-analysis.ts` | `tests/verify/deck-analysis.ts` 53/53 |
| Okna/vrata — popis odprtin | `src/lib/opening-schedule.ts` | `tests/verify/opening-schedule.ts` 50/50 |
| Nadstreški — 2 fotki (fronta+stran) | `src/lib/canopy-analysis.ts` | `tests/verify/canopy-analysis.ts` 52/52 |
| Fasada — obloga + stena − odprtine | `src/lib/fasada-analysis.ts` (Radon, Sutherland–Hodgman rez) | `tests/verify/fasada-analysis.ts` 33/33 |
| Klasifikacija scene | `src/lib/cv-engine.ts` — `sceneClassify` | `tests/verify/scene-classify.ts` ✓ |

### 2.4 Fotomontaža (issue #14) — klasična obdelava slik, 0 AI
| Korak | Implementacija | Dokaz |
|---|---|---|
| Maske (stara ograja / ovire) | `src/lib/photo-replace-core.ts` — `createMask/paintMaskRect/paintMaskCircle/maskCoverage/maskToPctPolys` | `tests/verify/photo-replace.ts` 83/83 |
| Samodejni predlog maske | `autoSuggestFenceMask` (nasičenost+svetlost+vodoravni tek+2× večinski filter) — opomba VEDNO zahteva ročni pregled | isti test; E2E: »Pokrito 60 % … preveri in popravi s čopičem« |
| Klasična obnova (brez AI) | `inpaintMask` — linearna interpolacija mejnih pikslov + kloniranje run-ov > 24 px; > 18 % pokritosti → `manual-required` (slika NESPREMENJENA), run ob robu → `partial` | isti test (natančnost ≤ 12/kanal, determinizem po bajtih) |
| Ročni popravek ozadja | Kloniraj izvor→žig (`fr-clone-source`, `fr-clone-stamp`) — kopira ORIGINALNE piksle, deterministično | E2E UI prikaz + navodilo |
| Perspektiva elementov | `computePlankLayouts` — meje LINEARNO v cm-ravnini + inverzna homografija (reuses `homography.ts`); degeneriran quad → Error »NEZADOSTNI PODATKI« | isti test (frontal točnost ±2 px, trapez top<narave-bottom) |
| Okluzije (plasti) | `orderLayers` background→fence→shadow→front; `frontPixelsFrom` — ovire ostanejo originalne | isti test |
| Svetlobno ujemanje | `ambientLightFactor` (BT.601 obroč, clamp 0,72–1,4), `shadowEdgesFor` (0,18/0,10) | isti test + E2E faktor 0,86 |
| Izris nove ograje | PONOVNO uporabljen obstoječi renderer `src/lib/viz.ts` — `drawLayersOnQuad` (teksture realnega merila iz Tasks 33–35) | `tests/verify/viz-default-textures.ts` 131/131 |
| Iskrenost gradiva | `src/lib/roksal-assets.ts` — `profileReadiness` (canRender/isOriginal/honestyLabel/missingAssets); izvoz blokiran, kadar gradivo manjka (`canExportResult`) | `tests/verify/photo-replace.ts`; E2E: alu palice/mreža onemogočeni z »Gradivo manjka: RAL 7016 — original ROKSAL vzorec« |
| Metapodatki različice | `buildReplaceMetadata` (scriptVersion, SKU=null če ni v katalogu, hash maske/layouta, inpaint status, EXPORT_LABEL) — deterministični JSON | isti test; E2E prikazan JSON |
| Različice | `src/components/camera/foto-replace.tsx` — shranjevanje (localStorage, omejitev 10, pri polni kvoti iskren toast »ostane samo do osvežitve«), obstojnost potrjena po reload-u | E2E: 1 različica preživi reload |

### 2.5 Pred/po in izvoz
- Pred/po drsnik + 2× povečevalno steklo: `foto-replace.tsx` (`fr-compare`, `fr-zoom`) — E2E potrjeno.
- Izvoz PNG z VPORIZENIM napisom `EXPORT_LABEL` = »VIZUALIZACIJA ZA PREDSTAVITEV — ni potrjen proizvodni načrt in ni dokaz barvne identičnosti na zaslonu.« — E2E: izvoz brez blokade za profile z gradivom.

## 3. Kaj je približek (jasno označeno, nikoli »potrjeno«)

1. **Domnevna referenca** (»Vrata 200« čipi, scale-suggestions, BarCounter): status `AUTO_SUGGESTED` — ob poševnem posnetku eno merilo NE velja za vse smeri; UI to pove (`statusHint`).
2. **Globalno merilo iz ENA znane dolžine**: velja samo za smer reference — `validateScale` pri 'known-length' brez ravnine vrača opozorilo; za vse smeri je treba ravninsko kalibracijo (4 oglišča).
3. **Ne-ravninska geometrija** (globina, višinske razlike čez objekt): IZven ravnine NI podprta brez dodatne reference — planeChainStats velja samo na kalibrirani ravnini; skrite 3D scene iz ene fotke ne rekonstruiramo (nikoli).
4. **Samodejna maska stare ograje**: hevristika (~nasičenost/svetlost/tek) — NIKOLI popolna, opomba vedno zahteva ročni pregled; pokritost je vidna (60 % v E2E).
5. **Obnova ozadja**: linearna interpolacija + kloniranje — pri > 18 % pokritosti ali run-u ob robu NE trdi uspeha (`partial`/`manual-required` + slovenski namig).
6. **Ambientna svetloba**: nizkoprepustna svetlobna karta (Tasks 34–35) — ohrani velika merila scene, ne replicira ostre sence; faktor je determinističen in prikazan v UI.
7. **Katalog SKU**: `catalogSku: null` dokler original ROKSAL katalog (#6) ni povezan — ni izmišljenih SKU-jev.

## 4. Kaj MANJKA (pošteno odprto)

| Manjka | Vpliv | Potreben korak |
|---|---|---|
| Original ROKSAL fotografije/teksture (#6) | alu-palice-18 in mreza-3d-125 profili NE upodobljeni; izvoz z oznako original blokiran | pripeljati preverjene posnetke iz ROKSAL kataloga → `roksal-assets.ts` z `origin: 'roksal-original'` |
| Fotogrametrija iz več fotografij (Faza 3) | **PROTOTIP IMPLEMENTIRAN (determinističen, 2 fotki)**: `src/lib/multiview-core.ts` (Shi-Tomasi + NCC + Lowe ratio, 8-točkovni + RANSAC + Gauss–Newton, Hartley/Kruppa samokalibracija fokusa, DLT triangulacija, merilo po znani referenčni dolžini) + UI zavihek „Večpogled“; 91/91 testov z znano resnico (exact ±1,5 %, šum ±0,7 px ±6 %); E2E na resničnem paru (197/198 inlierjev, residuala 0,3 px, reprojekcija 0,11 px) | SfM/COLMAP z več kot 2 fotkami NI implementirana; samokalibracija fokusa pri majhni bazi iskreno zavrnjena (uporabi EXIF/preset → AUTO_SUGGESTED); v osnovnem toku ostane ročna izmera |
| Neodvisni test natančnosti na realnem objektu (Faza 7) | številke o napaki (median/95. pct) NISO ŠE merjene na realnem objektu — cilji iz #3 ostanejo cilji; ORODJE ZDAJ OBSTAJA: protokol »Test natančnosti« (kamera → Pripomočki) zapiše pare resnica/izmerjeno in računa iskreno statistiko z pogodbo < 5 meritev = brez trditev | z monterjem na objektu: ≥ 5 parov na metodo (trak = resnica), izvoz CSV → zabeleži median/P95 v ta dokument |
| LiDAR/dubina senzorji | aplikacija jih NE prikazuje (pravilno) — fallback je fotka + referenca + ročne mere | samo, če naprava to dejansko podpira |
| E2E klik oglisča prek agent-browser | zahteva scroll-into-view pred klikom (nuja avtomatizacije, ne UI napaka) | — |

## 5. Znan regresijski status (ob zapisu te osnove)

- `measurement-status` 90/90 · `multiview` 91/91 · `photo-replace` 83/83 · `viz-default-textures` 131/131 · `tile-grid` 41/41 · `fasada-analysis` 33/33 · `deck-analysis` 53/53 · `canopy-analysis` 52/52 · `opening-schedule` 50/50 · `post-layout` 33/33 · `stair-profile` 15/15 · `pattern-detect` 8/8 · `quality-calibrate` 19/19 · `room-sketch` 48/48 · `accuracy-test` 35/35 · `measure-report` 48/48 · `laser-protocols` 72/72 · `scale-suggestions` ✓ · `scene-classify` ✓
- `tsc --noEmit`: src čist (prej obstoječe napake samo v `examples/` + `skills/`, niso del aplikacije)
- `eslint .`: čisto · dev.log: brez napak · E2E zlata pot fotomontaže: namizje 1280 + mobilni 390×844 (brez vodoravnega drsenja), konzola čista

## 6. Pravila, ki jih ta osnova zaklepa

1. Neveljavna/manjkajoča kalibracija je EKSPlicitna napaka (`NO_CALIBRATION`/`PLANE_REQUIRED`), ne tihega merila 1 cm/px.
2. Samodejni predlog (`AUTO_SUGGESTED`) nikoli ne postane potrjena mera brez postopka (`makeProvenance` to vsili z napako).
3. Sprememba reference/točk/perspektive pade CALIBRATED/VERIFIED/CONFIRMED na AUTO_SUGGESTED (`downgradeOnReferenceChange`).
4. Manjkajoče gradivo prepreči upodobitev in izvoz z oznako original (`canRender=false` → `canExportResult` razlog).
5. Originalna fotografija stranke je NIKOLI spremenjena — vse izdaje so nove različice z metapodatki.
6. Večpogledna (2-fotčna) mera je vedno „pomožna meritev“: brez znane referenčne dolžine NI cm (samo razmerja), preset/selfcal fokus → največ AUTO_SUGGESTED, skoraj ravninska scena → opozorilo o nezanesljivi globini; izvoz nosi oznako „za proizvodnjo preveri s trakom/laserjem“.
