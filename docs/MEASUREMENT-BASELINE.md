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
| Fotogrametrija iz več fotografij (Faza 3) | SfM/COLMAP veriga NI implementirana — večpogledni 3D NI na voljo | ločen prototip (BSD-3 licenca, offline worker); v osnovnem toku ostane ročna izmera |
| Neodvisni test natančnosti na realnem objektu (Faza 7) | številke o napaki (median/95. pct) NISO merjene — cilji iz #3 ostanejo cilji, ne obljube | referenčni nabor: fotke + fizične mere + toleranca; preizkus na objektu |
| LiDAR/dubina senzorji | aplikacija jih NE prikazuje (pravilno) — fallback je fotka + referenca + ročne mere | samo, če naprava to dejansko podpira |
| E2E klik oglisča prek agent-browser | zahteva scroll-into-view pred klikom (nuja avtomatizacije, ne UI napaka) | — |

## 5. Znan regresijski status (ob zapisu te osnove)

- `measurement-status` 90/90 · `photo-replace` 83/83 · `viz-default-textures` 131/131 · `tile-grid` 41/41 · `fasada-analysis` 33/33 · `deck-analysis` 53/53 · `canopy-analysis` 52/52 · `opening-schedule` 50/50 · `post-layout` 33/33 · `stair-profile` 15/15 · `pattern-detect` 8/8 · `quality-calibrate` 19/19 · `scale-suggestions` ✓ · `scene-classify` ✓
- `tsc --noEmit`: src čist (prej obstoječe napake samo v `examples/` + `skills/`, niso del aplikacije)
- `eslint .`: čisto · dev.log: brez napak · E2E zlata pot fotomontaže: namizje 1280 + mobilni 390×844 (brez vodoravnega drsenja), konzola čista

## 6. Pravila, ki jih ta osnova zaklepa

1. Neveljavna/manjkajoča kalibracija je EKSPlicitna napaka (`NO_CALIBRATION`/`PLANE_REQUIRED`), ne tihega merila 1 cm/px.
2. Samodejni predlog (`AUTO_SUGGESTED`) nikoli ne postane potrjena mera brez postopka (`makeProvenance` to vsili z napako).
3. Sprememba reference/točk/perspektive pade CALIBRATED/VERIFIED/CONFIRMED na AUTO_SUGGESTED (`downgradeOnReferenceChange`).
4. Manjkajoče gradivo prepreči upodobitev in izvoz z oznako original (`canRender=false` → `canExportResult` razlog).
5. Originalna fotografija stranke je NIKOLI spremenjena — vse izdaje so nove različice z metapodatki.
