# Faza 8 — Razcep statusne pogodbe na dve trditvi

**Stanje:** izvedeno lokalno, čaka na Robertov pregled (koraki 1–8; §9 zapisuje, kaj je
izvedba spremenila na tem dokumentu)
**Datum:** 2026-10-15 → predaja 2026-10-16 zjutraj
**Pogon:** zahteva po monterjevem toku „dvakrat tapne, pred stranko" (pogovor z Robertom,
2026-10-15 — ROKSAL Kranj, monterji na Androidu/Chrome).

---

## 0. Predaja (jutro 2026-10-16) — kaj je narejeno in kaj čaka

Narejeno, z merjenim dokazom (vsako številko je izpisal bun, ne spomin):

- `src/lib/assertion.ts` (nov) + `tests/verify/assertion.ts` **119/119** — dve osi, totalna
  25/25 projekcija, najdbi F1 in F2.
- Razcep veljav (`validateGeometry`/`validateMetric`, ločena downgradja) — `measurement-status`
  **90/90** s **praznim** diffom lastnega testa.
- Razcep večpogleda in SfM-ja — vseh **292** obstoječih trditev zelenih brez spremembe
  besedila; diferencialni dokaz `multiview-split` **50/50** (312 vrstic mreže).
- Neznana širina ravnine peljana skozi celotno pot (jedro, metapodatki, kosovnica, napis
  pred/po, UI) — `plank-layout-width` **26/26** na geometriji `fb-hi/04.jpg`, izmerjena meja
  neodvisnosti 2,274e-13 px; `photo-replace` **391/391**.
- Sweep: **42 skriptov, 37 z izhodno kodo 0**; istih 5 rdečih kot pred posegom in vseh 5
  (po tem pasu je bil dodan 43. skript `render-promise` 25/25 → 43/38, Task 70).
  zaradi manjkajočih datotek v tem okolju (`/tmp/*.png`, ena tuja absolutna pot).
- Dokumentacija: BASELINE §2.6/§3/§4/§5/§6 (pravila 10–14), ta spec §8–§9, README, worklog
  Task 67.

Samostojne odločitve (utemeljitve v §8 in §9.2/§9.6): fokus na os `met` namesto na `geo`;
katalogske višine NISO bile vgrajene; pravilo 11 kot politika; F1 popravek vrat naročilnice;
kanoničnih 100 cm samo znotraj homografije.

Čaka samo na Roberta in ni bilo simulirano:

1. **OPRAVLJENO 2026-10-16** (Robertov »odlično, nadaljuj« je dovolil `bun install` in
   naslednje korake): `tsc --noEmit` — `src/` 0 napak, 5 napak izven aplikacije
   (`examples/websocket` ×2, `tests/e2e-compare-fixture.ts` ×3 zaradi `@types/bun`);
   `eslint .` izhod 0; E2E mobilni 390×844 + namizni 1280, `overflow false` na obeh, 0
   konzolnih napak, FAZA-8 veja dokazana od uploada do izrisa. **E2E je bil nujen, ne
   formalnost:** našel je nepošteno značko (vrstni red vej je naredil iskreno vejo nedosegljivo) in
   prelivanje čez 390 px; oboje je popravljeno in ponovno izmerjeno. Posnetek:
   `tests/e2e-faza8-mobile-390.png`.
2. **Ročne meritve na fotkah `05..08`** in ≥ 5 parov resnica/izmerjeno v »Test natančnosti« —
   edino, kar napako premakne iz cilja v meritev.
3. **Potrditev pravila 11** (katalogska višina → `ASSUMED` → brez naročilnice) ali njegova
   sprememba.
4. **Manjkajoča gradiva ROKSAL** (višine, mm preseki, teksture) — pravilo 4 velja naprej.

Nič ni pushano in nič ni bilo pobrisano. Edina namestitev je `bun install` (385,41 s, 826
paketov), ki je bil izrecno dovoljen; `.env` ni bil dotaknjen — lokalna `DATABASE_URL` je bila
podana samo v okolju dev strežnika, `db/e2e-local.db` je nova lokalna datoteka. HEAD je
`4db835d` (FAZA-8, lokalni commit), rezultati te verifikacije so v drugem lokalnem commitu.
Odločitev o pushu pripada Robertu.

---

## 1. Težava, natančno

Statusna pogodba v `src/lib/measurement-status.ts` ima **eno lestvico** (`MeasurementStatus`,
ESTIMATED → AUTO_SUGGESTED → MANUAL → CALIBRATED → VERIFIED → CONFIRMED, `:20-27`), ta lestvica
pa v sebi nosi **dve neodvisni reči**:

1. **Geometrijsko trditev** — ali vemo, kje na sliki leži ravnina in kakšna je njena perspektiva.
   Odgovor: 4 oglišča, homografija, inlierji, residuala, reprojekcijski RMS.
2. **Metrično trditev** — ali vemo, koliko centimetrov je ena enota v tej ravnini.
   Odgovor: znana referenčna dolžina, trak, laser.

Ti dve nista na isti osi. Fotka je lahko geometrijsko brezhibna in brez merila — takrat se na
njej da pokazati material in barvo v pravi perspektivi, ne pa določiti razmuka elementov. Ali pa
obratno: merilo brez potrjene perspektive. Današnja ena lestvica te razlike ne zna izreči.

### Dokazi v kodi

| # | Kraj | Kaj je narobe |
|---|---|---|
| D1 | `measurement-status.ts:246-247` | `ScaleValidation.code` v istem nabraanju meša `PLANE_REQUIRED` (geometrija) z `NO_CALIBRATION` / `DEGENERATE_REFERENCE` (merilo) in `MULTIVIEW_DEGENERATE` / `RESIDUAL_HIGH` / `SFM_REPROJECTION_HIGH` (spet geometrija). En sam `status` za tri vrste napak. |
| D2 | `measurement-status.ts:386-439` | `validateMultiView` preveri zaporedoma (a) inlierje in residualo → geometrija, (b) `referenceKnown` → merilo, (c) `focalMode` → notranja geometrija kamere. Te tri različne trditve se zlijejo v en `status`, zato iz `AUTO_SUGGESTED` ni razbrati, katera od treh manjka. |
| D3 | `measurement-status.ts:84-92` | `worstStatus` agregira po eni sami lestvici. „Geometrija vrhunska, merila ni" in „geometrija je smeti" dobita **isti rang**, zato agregat „stanje celotne izmere" ne pove, kaj manjka. |
| D4 | `measurement-status.ts:527-534` | `downgradeOnReferenceChange` ob spremembi reference zniža CALIBRATED → AUTO_SUGGESTED. A menjava dolžine reference **nikoli ne razveljavi umerjene ravnine** — geometrija ostane popolnoma veljavna, pade samo merilo. Trenutna pogodba tega ne zna izraziti, zato uniči več, kot mora. |
| D5 | `photo-replace-core.ts:517-519` + `:808-810` | **Pravi bloker.** `computePlankLayouts` vrže napako brez `planeCm.wCm` **in** `planeCm.hCm`, `buildReplaceMetadata` pa ju zahteva še enkrat. Fotomontaža — ki je *slika* — je danes nezmožna brez vnosa dveh centimetrov z tipkovnice. To je točno „monterju pisanje ne gre". |

D5 ni ločen bug. Je **isti zamašek** kot D1–D4, samo v uporabniškem vmesniku. Zato razcep
ni epistemska higiena, ampak pogoj za dvotapni tok.

---

## 2. Ključna ugotovitev: montaža potrebuje eno samo število, in tista je izbira

Izpeljava neposredno iz `computePlankLayouts` (`:530-593`):

- Vodoravni elementi: `len = planeCm.hCm`, `n = floor((len + gapCm) / pitch)` (`:565-566`).
  Število desk je odvisno **samo od `hCm`**.
- Vsak element je `rectQuad(0, a, planeCm.wCm, b)` (`:575`) — teče po **celotni širini**.
- Homografija je `solveHomography([(0,0),(wCm,0),(wCm,hCm),(0,hCm)], quadPx)` (`:539-545`).
  Dokaz neodvisnosti od `wCm` pri polnih širinah: naj bo `H` rešitev za pravokotnik
  `plane(w,h)` in `H'` za `plane(w',h)`. Afina preslikava `A(u,v) = (u·w/w', v)` slici
  oglišča `plane(w',h)` na oglišča `plane(w,h)`, torej `H∘A` zapiče ista štiri oglišča na
  iste štiri piksle kot `H'`. Štiri točke v splošni legi določijo homografijo enolično,
  zato **`H' = H∘A`**. Element, ki gre od `u=0` do `u=w'`, gre prek `A` vedno od `0` do `w`
  — njegova slika v pikslih je torej **identična**, ne glede na `wCm`.
  (`calibratePlane` na `:535` je tu samo varovalo pred degeneracijo; dejansko mapo uporablja
  `solveHomography` neposredno.)
- `wCm` vpliva samo na **stebre** (`:589-592`, `x0 = k · postEveryCm`) in na **izpis cm/px**
  (`:557-558`). Razmik stebrov sicer ni mera — je katalogsko pravilo (**max 133–140 cm
  vodoravno, 145 cm Romb, 150 cm navpično**, roksal.com, stran o montaži) — a pravilna
  *legaga* stebra v ravnini kljub potrebuje pravi `wCm`. Posledica v §3.4: brez `wCm` stebrov
  ne izrišemo, deske pa da.

**Zaključek:** za pravilen izris nove ograje na pravi fotki monter potrebuje

1. **štirikotnik** — štiri tapke po zaslonu (nič tipkanja), in
2. **višino ograje** — eno samo število.

To je dvotapni tok. Trenutna zahteva po `wCm` je odveč in je edina, ki monterja prisili v
tipkovnico.

Pomembno za §3: tisto eno število, ki ga monter **izbere iz kataloga**, ni izmera. Je domnevna
vrednost, prevzeta iz pravila, in mora živeti na osi `met` kot `ASSUMED` — sicer bi izbira
med tremi gumbi rodila `CALIBRATED` in s tem naročilnico iz slike, ki nikoli ni bila izmerjena.

> ⚠️ **Nepreverjena predpostavka, ki drži celoten dvotapni izračun.** Ker `n` je odvisen od
> `hCm` linearno (`n = floor((hCm + gap) / pitch)`), je **število desk na sliki odvisno od
> višine**. Da je drugi tap res izbor iz treh gumbov in ne tipkanje, morata biti res (a)
> balkonske ograje ROKSAL v praksi v treh standardnih višinah in (b) monterju znana, katero
> uporablja. **Nisem je preveril.** `roksal.com` objavlja profile in razmike stebrov, nikjer pa
> ne navaja višin ograje — in test §4.1 se tej pomanjkljivosti samo **prilagodi**, je ne reši.
> Preden se karkoli od tega zgradi, mora Robert odgovoriti: *katere višine balkonskih ograj
> dejansko monta ROKSAL, in ali jih monter ve brez merjenja?* Če odgovor ni tri ali štiri
> vrednosti, se drugi tap vrne v tipkanje — in takrat je ugotovitev §2 še vedno pravilna
> (montaža potrebuje eno število, ne dveh), odpade pa trditev „brez tipkovnice".

### Kje `wCm` vendarle stopi v igro

Da trditev ni preveč poenostavljena — `wCm` ima dva resnična učinka, in oba sta metrična, ne
izrisna:

- **`scaleCmPerPxAtQuad`** (`:557-558`) je cm/px in zato linearno odvisen od `wCm`. To je
  *številka na izpisu*, ne piksli na sliki.
- **stebri** (`:589-592`) ležijo na `x = k · postEveryCm`, ti koordinati pa se pri spremembi
  `wCm` s tem linearnim x-stiskom premakneta. Ker `postEveryCm` ne tipka monter ampak ga da
  katalogsko pravilo, tudi to ni vnos — je pa razlog, zakaj test §4.2 primerja **samo deske in
  reže** (`layoutHash` pokriva `planks`, `gaps`, `posts`; pri navzočih stebrih se test izvede z
  `postEveryCm = null`).

---

## 3. Načrt: dve osi, ena projekcija

### 3.1 Nov modul `src/lib/assertion.ts` (aditivno — `measurement-status.ts` ostane javni vmesnik)

```
GeometricAssurance = 'UNDEFINED'    // o geometriji slike ničesar ne trdimo
                   | 'SUGGESTED'    // štirikotnik samodejno najden, monter ga ni potrdil
                   | 'ORIENTED'     // ena smer znanega merila (global px/cm iz ene daljine)
                   | 'FITTED'       // monterjevi 4 oglišči + homografija → vse smeri v ravnini
                   | 'CONSISTENT'   // FITTED + neodvisna preverba (2. pogled / pravokotno razmerje)

MetricAssurance    = 'NONE'          // cm ni, samo razmerja
                   | 'ASSUMED'       // domnevna referenca (vrata ≈ 200 cm)
                   | 'REFERENCED'    // vnesena dejanska znana dolžina
                   | 'MEASURED'      // trak / laser — neodvisno od fotke
                   | 'CROSS_CHECKED' // dva neodvisna vira se ujemata
```

Vsaka os ima svoj `rank`, `label`, `hint`, `color`. Osici nista urejeni ena glede na drugo —
par `(geo, met)` je produkt dveh množic, ne podmnožica ene lestvice.

**Kaj `geo` rang NIE in kaj je.** Ni natančnost. Je **domena veljavnosti**: koliko slike lahko
z nečim obdelamo. `ORIENTED < FITTED` ne pomeni „manj natančno", ampak „velja samo v smeri
reference, ne za vse smeri" — to je razlika, ki jo `MEASUREMENT-BASELINE.md` §3 točke 1–2 že
danes besedno opisuje, a brez imena. Dajanje imeni tema dvema stopnema **je** celoten smisel
razcepa; zato agregat `worstGeometry` pove, katera domena manjka, ne „kaka ocena".

### 3.2 Projekcija na staro lestvico — ne združljivostni plaster, ampak resnična preslikava

`MeasurementStatus` **je** izgubljena projekcija tega para. To razmerje je vredno zabeležiti
kot funkcijo, ne kot zgodovinsko naključje:

```
projectStatus(geo, met): MeasurementStatus | null

  # 1) Ročna izmera NE izhaja iz fotke — geometrija jo ne pogojenava.
  #    (To je že danes veljavno pravilo: validateScale korak 2, :291-303.)
  met MEASURED        → MANUAL
  met CROSS_CHECKED   → VERIFIED

  # 2) Vse ostalo je izpeljano iz slike, zato geometrija pogojenava.
  geo < ORIENTED      → null     (slika ne trdi niti ene smeri — iz nje ni črpati ničesar)
  met NONE            → null     (samo razmerja, brez cm — BASELINE §6 pravilo 6)
  met ASSUMED         → AUTO_SUGGESTED
  met REFERENCED      → CALIBRATED
```

Prag v veji 2) je **`ORIENTED`, ne `FITTED`**. To ni okras: obstoječi test
`tests/verify/measurement-status.ts:94-95` od `validateScale({ pxPerCm: 2, method:
'known-length' })` — **brez ravnine** — pričakuje `CALIBRATED`. Globalno merilo iz ene znane
daljine je metrična trditev, ki drži brez umerjene ravnine (drži samo v eni smeri, kar je
domenska omejitev, ne negotovost). Prag `FITTED` bi ta test utišal v `null` in s tem **podrl
prav tisto trditev, ki jo hočemo ohraniti** — zato je `ORIENTED` v tej lestvici nujen in ne
izgovor.

Tabela je **totalna**: `geo` 5 vrednosti × `met` 5 = 25 parov, veje 1) imajo prednost, zato par
`UNDEFINED + CROSS_CHECKED` ne pade na `null`. Dve ravni `geo` (ORIENTED in FITTED) v projekciji
**dajeta isti izhod** — prav to je izguba informacije, ki jo razcep odpravi: `CALIBRATED` danes
ne ve, ali mera velja za eno smer ali za celotno ravnino. `SUGGESTED` (nepotrjen samodejni
štirikotnik) pade pod prag in daje `null`, kar je današnje vedenje za samodejni predlog brez
monterjeve potrditve.

**Kje projekcija ni samoumevna — fokus kamere.** `validateMultiView` in `validateSfm` danes
vračata `AUTO_SUGGESTED`, kadar je fokus `preset`/`selfcal` (`:423-431`, `:501-509`). Fokus ni
referenčna dolžina — je **notranja geometrija kamere**, zato po logiki tega razcepa spada na
os `geo`, ne `met`. Priporočena odločitev: `focalMode ≠ known` ⇒ `geo` je lahko največ
`FITTED`, nikoli `CONSISTENT`; `met` ostane `REFERENCED`. Projekcija nato da `CALIBRATED` namesto
današnjega `AUTO_SUGGESTED` — **to je zavestna sprememba obnašanja in edina v tej fazi.** Njen
doseg so trije multi-view testi (`multiview` 104, `multiview-chain` 66, `multiview-sfm` 122): ti
morajo biti v tem koraku **pregledani in po potrebi prepisani**, ne samo obdržani.
`tests/verify/measurement-status.ts` (90) spremembe ne dotakne — preverjeno: funkciji
`validateMultiView` in `validateSfm` v tej datoteki ne nastopita, noben od 90 testov ne hodi
skoznju. Če te spremembe nočemo, je alternativna rešitev tretja os (`CameraAssurance`), ki jo
predlagam šele, ko se pokaže potreba po njej — zaenkrat je par dosti.

`CONFIRMED` ostane zunaj para — je proizvodni postopek, ne lastnost posnetka.

S tem vseh 90 testov `tests/verify/measurement-status.ts` ostane zelenih **brez spremembe
trditev**: testirajo projekcijo, ki je sedaj eksplicitna. Edina razlika v obnašanju je
kombinacija `assumed-reference` + `planeCalibrated` (zadnja vrstica preglednice §3.2.1), ki je
danes **nepokrita** — zato zelen izid tu ne pomeni enakih trditev in mora biti potrjen izrecno,
ne tiho.
Izhodi `projectStatus` so `MANUAL`,
`VERIFIED`, `AUTO_SUGGESTED`, `CALIBRATED` in `null`. Dve vrednosti stari lestvici iz projekcije
**ne nastopita** in to je treba izrecno zapisati, ne pustiti kot tiho luknjo:
- `CONFIRMED`: zunaj para (gore).
- `ESTIMATED`: nikoli **izhod** projekcije, ker je bil doslej edini nosilec „kalibracije ni" —
  to zdaj eksplicitno nosi `null`. Ostane pa **vhod**: pojavlja se v shranjenih zapisih in ga
  bere `measurementNeedsConfirmation` (`:538`), zato tip in `STATUS_ORDER` ostaneta. Preverjeno z
  `grep`: tri pojavitve v modulu (`:21` tip, `:67` `STATUS_ORDER`, `:538` bralna pot) in sedem
  testnih vrstic — nobena od njih ne zahteva, da bi `ESTIMATED` projekcija *proizvedla*.

### 3.2.1 Preveritev, da je projekcija res reprodukcija (ne nova domneva)

Vsak od doslej potrjenih izhodov `validateScale` mora priti iz para `(geo, met)`. Stolpci
„današnji izhod" so dejansko stanje v kodi, ne želja:

| `validateScale` vhod | `geo` | `met` | projekcija | današnji izhod | skladno |
|---|---|---|---|---|---|
| `{}` (test `:73-77`) | UNDEFINED | NONE | null | NO_CALIBRATION / null | ✓ |
| `{ pxPerCm: 2, method: 'assumed-reference' }` (`:86`) | ORIENTED | ASSUMED | AUTO_SUGGESTED | AUTO_SUGGESTED | ✓ |
| `{ pxPerCm: 2, method: 'known-length' }` (`:94`) | ORIENTED | REFERENCED | CALIBRATED | CALIBRATED | ✓ |
| `{ pxPerCm: 2, method: 'known-length', planeCalibrated: true }` (`:97`) | FITTED | REFERENCED | CALIBRATED | CALIBRATED | ✓ |
| `{ pxPerCm: 2, method: 'manual-measure' }` (`:101`) | ORIENTED | MEASURED | MANUAL | MANUAL | ✓ |
| `{ method: 'laser', pxPerCm: null }` (`:103`) | UNDEFINED | MEASURED | MANUAL | MANUAL | ✓ |
| `{ method: 'plane-homography', planeCalibrated: true }` (`:107`, `:114`) | FITTED | REFERENCED | CALIBRATED | CALIBRATED | ✓ |
| `{ method: 'plane-homography', planeCalibrated: false }` (`:109`) | UNDEFINED | — | null | PLANE_REQUIRED / null | ✓ (koda `PLANE_REQUIRED` živi na `geo`) |
| `{ pxPerCm: 0.01, method: 'known-length' }` (`:118`) | ORIENTED | REFERENCED, a vrednost izven zanesljivega pasu | null | DEGENERATE_REFERENCE / null | ✓ (koda živi na `met`) |
| `{ pxPerCm: 2, method: 'assumed-reference', planeCalibrated: true }` — **testa ni** | FITTED | ASSUMED | **AUTO_SUGGESTED** | **CALIBRATED** | ✗ — **edina namerna razlika** |

Zadnja vrstica ni napaka v razcepu, je razcep **odkriva**: danes korak 3 (`plane`, `:305-313`)
teče pred korakom 6 in vrne `CALIBRATED`, ne glede na to, da je merilo prišlo iz **domnevne**
reference. Sistem torej lahko izda `CALIBRATED`, ki ga `makeProvenance` hkrati **zavrne**
(`:187-190`: `assumed-reference` + `CALIBRATED` → Error). Te kombinacije ne pokriva noben test,
zato je napaka tiha. Po razcepu geometrijsko znan okvir ravnine (`FITTED`) metrično domnevnega
merila **ne dvigne** — `met` ostane `ASSUMED`, status `AUTO_SUGGESTED`. To je BASELINE §6
pravilo 2 („samodejni predlog nikoli ni potrjena mera"), ki ga sedanja izvedba krši. Ker kršitve
test ne pokriva, je te spremembe **ni mogoče zaznati z zeleno skriptijo** — zato je treba njeno
potrditev eksplicitno zapisati in zato pri njej trditev §3.2 „brez spremembe trditev" ne drži.

### 3.3 Razcep obstoječih funkcij

| Zdaj | Postane |
|---|---|
| `validateScale` (en izhod, 8 kod) | `validateGeometry({quad, planeCalibrated, degeneracy})` → `GeometricAssurance` in `validateMetric({pxPerCm, method, reference})` → `MetricAssurance`. `PLANE_REQUIRED` živi samo v prvem, `DEGENERATE_REFERENCE` samo v drugem. |
| `validateMultiView` | residuala/inlierji → geometrija; `referenceKnown` → merilo; `focalMode` → geometrija (odločitev §3.2, edina sprememba obnašanja). Pragovi (12 inlierjev, 3 px) ostanejo identični. |
| `validateSfm` | enako razcepljen; `registeredCount`/`minPerImageInliers`/`reprojRmsPx` → geometrija, `hasScale` → merilo, `focalSource` → geometrija. Pragovi ostanejo. |
| `worstStatus(list)` | `worstGeometry(list)` + `worstMetric(list)`. **To odpravi D3** — agregat pove, katera od dveh stvari manjka. |
| `downgradeOnReferenceChange` (D4) | `downgradeMetricOnReferenceChange` (samo metrika) + nov `downgradeGeometryOnQuadChange` (samo geometrija). Sprememba reference pusti umerjeno ravnino pri miru. |

Obstoječa imena ostanejo kot tanki ovoji, ki kličejo oba in vrneta projekcijo — dokler jih
odstrani faza 2. Ni jih smiselno preimenovati v istem commitu, ker bi to skrilo dejanske
spremembe v diffu.

### 3.4 Dve vrat namesto enih

```
canRenderMontage(geo)    = geo ≥ FITTED        // rabi ravnino za perspektivo — NE sprašuje po merilu (D5)
canExportOrder(geo, met) = geo ≥ ORIENTED && met ≥ REFERENCED
```

Posledica, ki je vredna izrecnega zapisa: **dvotapna montaža je po konstrukciji poštena.**
Štirikotnik (4 tapke) da `geo = FITTED`; katalogsko izbrana višina da `met = ASSUMED`;
projekcija je `AUTO_SUGGESTED`; `canExportOrder` reče **ne**. Slika pred stranko je torej
izrisljiva, naročilnice iz nje pa ni — in to brez dodatnega zaslona ter brez posebnega
varnostnega opozorila: poštenost je vgrajena v vrata, ne v napis. To je edini način, da se
„dvakrat tapne" in „nikoli izmišljena številka" ne izključujeta.

`canExportOrder` stoji na pragu `ORIENTED`, ne `FITTED`, ker ustreza današnjemu pogoju za
`CALIBRATED` (§3.2: pri merilu iz ene znane dolžine brez ravnine je bila naročilnica doslej
dovoljena, samo z opombo o smeri veljavnosti). Dvig tega praga na `FITTED` bi **tiho skrčil**
krog obstoječih naročilnic — to ni razcep, ampak sprememba politike, in je zato izrecno
zunaj dosega te faze (glej §5).

`canExportResult` (`photo-replace-core.ts:859`) ostane kot tretja vrata — tista za **gradivo**
(manjkajoča ROKSAL tekstura). Tri vrata za tri različne trditve, namesto enih za vse.

`computePlankLayouts` dobi `planeCm.hCm` obvezno, `planeCm.wCm` pa **izpustljiv**. Kadar `wCm`
ni znan, velijo tri posledične omejitve — vsaka je neposredna slika §2:

1. **Deske in reže se izrišejo pravilno.** Homografija se znotraj modula postavi na
   **kanonično izvorno širino** (poljubna pozitivna konstanta); po dokazu `H' = H∘A` je izris
   polnih širin na njo neodvisen, torej identičen kot pri pravem `wCm`.
2. **Stebri se NE izrišejo.** `x = k · postEveryCm` (`:589-592`) je koordinata v ravnini in
   brez pravega `wCm` ne obstaja — izpisati stebra na domnevni širini bi bila izmišljena
   geometrija. Kadar `wCm === null`, je `LayoutResult.posts` prazen, razlog pa se zabeleži med
   opozorila različice (širok seznam `warnings` v `ReplaceMetadata` že obstaja).
3. **`scaleCmPerPxAtQuad` (`:557-558`) se NE izpiše.** Je cm/px in torej linearno odvisen od
   `wCm`; brez njega številka nima pomena. Izpis je lahko samo razmerje.

`buildReplaceMetadata` spremeni `planeCm` v `{ hCm: number; wCm: number | null }` in v
metapodatke zapiše, **katera od dveh trditev je bila zastavljena** — da je različica sama po
sebi čitljiva: „geometrija iz štirikotnika, merilo samo iz `hCm`, širina neznana" ne sme biti
mogoče zamenjati z „kalibrirano v obeh smereh".

---

## 4. Testni material — resnične fotke

Vir: galerija Ograje Lozar (bivša stranka, Robertove monterjeve fotke), 24 slik, brez podpisov
(nobena razen ene nima alt-besedila — metapodatkov ni, kar je samo po sebi pomembno za §1).
Lokalno `fb-hi/01..24.jpg`. Pet skupin je za to fazo nepogrešljivih:

| Slika | Zakaj |
|---|---|
| `fb-hi/03.jpg` | **Makro preseka:** šupljina deske z rebrčki, črn distančni klip, alu podkonstrukcija. Edini dokaz geometrije profila, ki ga na roksal.com ni. |
| `fb-hi/04.jpg` | **Pravi pred/po v enem kadru:** zgornji balkon že obložen (antracit, vodoravno), spodnji še goli kovinski s stebrički, lestev in deske na tleh. Geometrijska trditev je preverljiva na sliki, ki ima odgovor že v sebi. |
| `fb-hi/05..08.jpg` | **Ista fasada iz štirih pogledov** — gotov multi-view niz za preizkus `CONSISTENT`. |
| `fb-hi/15.jpg + 16.jpg` | **Delavni maketi** sekcije Romb na stojalu, dva kota — skoraj kontroliran vzorec enega SKU-ja. |
| `fb-hi/19.jpg` | **Končana ograja z napisom LOZAR** na fasadi — skalirno sidro za test natančnosti §4.4 (vidne razsežnosti, ki se jih da izmeriti z razmerji v kadru). |

### Kako se testira

1. **Zlata pot brez tipkanja `wCm`.** Na `04.jpg` štirikotnik spodnjega balkona (4 tapke) +
   ena samo višina → montaža se izriše. To je neposredna regresijska trditev za D5: danes ta
   korak vrže napako, ker zahteva **obe** meritve. Kako se višina vnese, je odvisno od ⚠️
   predpostavke v §2 — kadar je potrjena, je to izbor iz gumbov in test trdi »tipkovnica se nikoli
   ne odpre«; kadar ni, je to en vnos z tipkovnice in test trdi šibkejšo, a še vedno uporabno
   različico »druga mera ni več vnos«. Obrazec testa se izbere po Robertovem odgovoru, ne naknadno.
2. **Neodvisnost od `wCm`.** Ista fotka, isti štirikotnik, `wCm` = 200 / 400 / 1000 →
   **bajt-identičen izris desk in rež** (FNV-1a hash layouta). To preveri trditev iz §2 in je
   preprost deterministični test brez tolerance.
3. **Ločena downgrade.** Na `05..08` umeri ravnino, nato **zamenjaj referenčno dolžino**.
   Danes: CALIBRATED → AUTO_SUGGESTED, geometrija izgubljena. Po razcepu: `geo` ostane
   `CONSISTENT`, `met` pade na `ASSUMED`. Montaža ostane dovoljena, naročilnica ne.
4. **Resnična natančnost.** Na `04.jpg` in `19.jpg` (izmerljive dimenzije z razmerji v kadru)
   pogon obstoječega protokola „Test natančnosti" (`accuracy-test.ts`, pogodba < 5 meritev =
   brez trditev). To ni nova koda — to je prvič, ko se obstoječe orodje usede na resnične
   fotke, kar je že dolgo odprto v `MEASUREMENT-BASELINE.md:89` (Faza 7).

---

## 5. Obseg — kaj ta faza NE naredi

- **Ne naredi dvotapnega UI-ja.** Ta faza odpre **vrata** (`canRenderMontage` ne pozna `met`);
  dvotapni zaslon je faza 2 in je po tem razcepu majhna sprememba. Posledično se test §4.1
  v tej fazi izvede **na nivoju jedra** (klic `computePlankLayouts` z `wCm = null` na `04.jpg`),
  ne kot klikanje po zaslonu; klik-pot postane E2E šele v fazi 2.
- **Ne spremeni nobene tolerance, praga ali algoritma** (12 inlierjev, 3 px, 0,05 px/cm,
  5000 px/cm ostanejo). Edina zavestna sprememba **obnašanja** je projekcija fokusa (§3.2); ta
  ne spremeni pragov, samo to, kateri od dveh osi pogojenja končni status.
- Ne dotakne se `roksal-assets.ts`, `viz.ts`, `homography.ts`, `multiview-*.ts` — **njihne kode**
  ne; spremeni se samo to, kar jim `measurement-status` vrača. Posledično se trije multi-view
  testi (104 + 66 + 122) **pregledajo**, ne ostanejo nujno beseda-beseda (glej §3.2).
- Ne uvaja AI, ne mreže, ne plačljivih API-jev. Determinizem ostaja.
- Ne rešuje manjkajočih ROKSAL tekstur in manjkajočih mm preseka — to sta zunanji **podatkovni**
  pomanjkljivosti (`MEASUREMENT-BASELINE.md:85`), ne koda.
- **Ne spreminja politike kaj je dovoljeno naročiti.** Pragi `canExportOrder` ostanejo na
  današnji moči (`ORIENTED + REFERENCED`, §3.4). Dvigniti jih (npr. zahtevati ravnino za vsako
  naročilnico) je samostojna odločitev, ne posledica razcepa.
- Spremeni obnašanje na dveh točkah in obe sta zavestni: projekcija fokusa (§3.2, trije multi-view
  testi) in `assumed-reference + planeCalibrated` (§3.2.1, danes nepokrito). Vse ostalo je
  preimenovanje in razvrščanje istih trditev na dve osi.
- **Ne naredi proporcionalnega izrisa.** `met = NONE` odpira vrata, ne pa tudi izrisa (§6
  pravilo 11): števec desk brez ene dolžine ni določen.

## 6. Pogodbena pravila, ki jih ta faza zaklene

Povečajo §6 dokumenta `MEASUREMENT-BASELINE.md` za štiri točke:

10. **Geometrijska in metrična trditev se nikoli ne seštejeta v en status.** Vsak izpis, ki
    pove „zanesljivo", mora povedati, katera od obeh mišljena.
11. **Vrata fotomontaže ne sprašujejo po merilu; izris pa potrebuje eno samo dolžino.**
    `canRenderMontage` pozna samo `geo` — izris je *dovoljen*, kadar je geometrija potrjena, in
    iz takšne slike ne sme biti naročilnice. Števec desk
    (`n = floor((hCm + gap)/pitch)`) namreč eno dolžino v cm potrebuje, sicer izris ni
    določen — razlika med „smemo" in „zmoremo" je zato izpisana, ne zglajena: `met = NONE` brez
    `hCm` pomeni odprta vrata in **brez izrisa** (proporcionalni izris je samostojno delo, ne ta
    faza). Kadar monter dolžino vzame iz kataloga (izbira višine), je ta številka na osi `met`
    **`ASSUMED`, ne `REFERENCED`**: prevzeta domneva, ne izmera. Iz tega pravilno sledi
    `projectStatus = AUTO_SUGGESTED` in `canExportOrder = false`. Realni skok za monterja je
    **dva tipkana vnosa → nič tipkanja za `wCm`**, ne nič vnosa.
12. **Sprememba merila ne razveljavi geometrije in obratno.** (`downgradeMetricOn…` /
    `downgradeGeometryOn…`, D4.)
13. **Neznana širina ravnine je izpisana, ne tiho nadomeščena.** Kadar `planeCm.wCm === null`,
    izris vsebuje deske in reže, **ne pa** stebrov in ne številke cm/px; kanonična notranja
    širina homografije je implementirski detajl in nikoli ne sme zaplesati kot mera.

## 7. Koraki izvedbe (za naslednje pisanje plana)

1. Nov modul `src/lib/assertion.ts`: dve osi, `projectStatus`, oboje `label/hint/color/rank`.
2. Test `tests/verify/assertion.ts` — projekcijska tabela je totalna (25/25 parov) in sklada z
   vsako vrstico preglednice §3.2.1. Dodati **nov** test za nepokrito kombinacijo
   `assumed-reference + planeCalibrated` (zastavi pričakovani izhod, ne obstoječega).
3. Razcep `validateScale` → `validateGeometry` + `validateMetric`; stari izvod ostane kot
   ovojnica. `measurement-status` 90/90 **nespremenjen** (verify: `git diff --stat` nad
   `tests/verify/measurement-status.ts` mora biti prazen).
4. Razcep `worstStatus` in `downgradeOnReferenceChange`.
5. Razcep `validateMultiView` + `validateSfm` (fokus → `geo`, §3.2) in **pregled treh
   multi-view testov** (104 / 66 / 122): katerikoli obarvani izid se pripravi, preden se
   sprejme — noben test se ne spremeni tiho.
6. `canRenderMontage` / `canExportOrder`; `planeCm.wCm → nullable` v
   `computePlankLayouts` in `buildReplaceMetadata`.
7. Regresija §4.2 (neodvisnost od `wCm`) in §4.1 (zlata pot na jedru) na `fb-hi/04.jpg`;
   §4.3 na `05..08`; §4.4 (Test natančnosti) je terenski in pade na Robertovo uro, ne na kodo.
8. Posodobitev `MEASUREMENT-BASELINE.md` §4, §6 (+ pravila 10–12).

Vsi koraki so lokalni, merljivi z obstoječo 34/34 skriptijo. Nič se ne objavi, dokler Robert
ne pregleda.

---

## 8. Štiri odločitve, ki jih spec ne more sprejeti namesto Roberta

Brez njih je ta dokument nedokončan — ne zato, ker bi manjkalo domišljije, ampak ker so
podatki zunaj kode:

1. **Katere višine balkonskih ograj ROKSAL dejansko monta, in ali jih monter ve brez
   merjenja?** (`roksal.com` višin ne objavlja; ⚠️ §2. Odgovor določi, ali je drugi tap izbor
   iz gumbov ali tipkanje — in s tem, ali trditev „brez tipkovnice" sploh velja.)
2. **Ali je zavestno sprejeti, da mera iz katalogsko izbrane višine rodí `AUTO_SUGGESTED` in
   torej NE more roditi naročilnice?** (posledica pravila 11; po meni je to pravilno, ampak je
   to poslovna omejitev, ne tehnična.)
3. **Fokus kamere: na os `geo` (ena zavestna sprememba obnašanja, §3.2) ali tretja os
   `CameraAssurance` (nič se ne spremeni, a tri osi namesto dveh)?**
4. **Kdaj in s kom se naredi prvi pravi „Test natančnosti" na fotki `04.jpg`** — to je edini
   korak, ki lahko številke o napaki (`MEASUREMENT-BASELINE.md:89`, Faza 7) premakne iz ciljev
   v meritve, in ga iz kode ne more izvesti nihče.

Pogojena, a ne odprta: ena sama makro fotka preseka profila ob merilnem traku (57 / 100 / 128),
ki izmeri mm širino, debelino in razmik — brez nje `roksal-assets.ts` ostane brez originalnih
tekstur in pravilo o manjkajočem gradivu (BASELINE §4, ta spec §5) velja naprej.

**Samostojne odločitve čez noč (2026-10-15 → 16).** Robert je ukazal delati naprej, zato so bile
štiri odločitve sprejete brez njega — vsaka je zapisana tako, da se ji da ugovarjati:

1. **Katalogske višine NISO vgrajene.** `roksal.com` višin ne objavlja in izmišljene številke
   kršijo pravilo iskrenosti; UI zato še vedno prosi za ročno višino. Posledica je samo to, da
   "nič tipkanja" za zdaj velja za **širino** (njen vnos je izpuščen), ne za višino.
2. **Katalogsko izbrana višina bo `ASSUMED`, ne `REFERENCED`** (pravilo 11): takšna mera rodi
   `AUTO_SUGGESTED` in **ne more** roditi naročilnice. To je zavezana politika, ne tehnična
   omejitev — Robert jo lahko zavrne samo tako, da spremeni pravilo 11.
3. **Fokus gre na os `met` (`ASSUMED`), ne na `geo`** — obratno, kot je priporočal §3.2.
   Utemeljitev in cena te odločitve (ničelna sprememba obnašanja, 292 trditev ostane zelenih): §9.2.
   Tretja os `CameraAssurance` ni bila narejena.
4. **Test natančnosti NI narejen.** Potrebuje človeka z merilnim trakom; §4.3 (`05..08`) in
   §4.4 sta zato zapisana kot **blokirana na Robertu**, ne kot opravljena (BASELINE §4).

---

## 9. Amandma po pridobivanju baseline in po korakih 1–2 (samostojna izvedba, 2026-10-15)

Robert je šel spat z ukazom „delaj naprej". Spodaj so štiri stvari, ki jih je izvedba
**spremenila** na dokumentu — zapisane, da se da ugovarjati, ne zglajene.

### 9.1 Baseline je bil napačen (popravljeno, merjeno)

Merjeno z `bun 1.4.3`, brez `node_modules` (bun sam razreši `sharp` iz svojega cache-a).
Celoten izid: `../baseline/BASELINE-2026-10-15.md` + `run-01.txt`.

- Skriptov je **38**, ne 34; trditev §7 „obstoječa 34/34 skriptija" je bila zastarela.
- Zelenih je **33/38**. Pet rdečih ŽE PRED posegom in vsi peti zaradi okolja, ne logike:
  štirje pišejo na `/tmp/*.png` (na Windows `/tmp` ni), `fasada-analysis` bere trdo kodirano
  `/home/z/my-project/tests/task32-fasada.jpg`. Noben od petih ne hodi skozi
  merilno pogodbo; v tej fazi se NE popravlja (preurediti tuje teste z drugim namenom ni
  posledica razcepa).
- `photo-replace` ima **391** preverjanj, ne 152. Vseh 391 mora ostati zelenih.
- Skupaj zelenih trditev: **2024** v 27 counting skriptih + 6 diagnostičnih brez števca
  (izmerjeno in zabeleženo v `../baseline/BASELINE-2026-10-15.md` §"Z preštevilnimi
  preverjanji", ne iz spomina).
  Posledično: „38/38" v nobenem poročilu te faze ne sme nastopiti kot trditev.

### 9.2 Odločitev §8.3 je sprejeta v smeri ničelne spremembe obnašanja ( fokus → `met`, ne `geo`)

Spec je v §3.2 priporočal `focalMode ≠ known ⇒ geo ≤ FITTED`, kar bi `AUTO_SUGGESTED`
prestavilo v `CALIBRATED` in zahtevalo prepis **292** multi-view trditev (104 + 66 + 122).
Samostojno je sprejeta **obratna** odločitev: domneven fokus spada na os `met`, v vrednost
`ASSUMED`, ki je zato definirana kot „merilo počiva na domnevi — domnevna referenčna dolžina
ALI domnevni fokus". `MetricAssurance.ASSUMED` ima zdaj dva nosilca, ne enega.

Zakaj je to resnicno, ne le prijetno: pri dvopogledni triangulaciji goriščna razdalja ne
vpliva samo na perspektivo — neposredno določa, kako se razmerje pretvori v centimetre.
Številka v cm zato počiva na domnevi enako, kot počiva na domnevnih vratih 200 cm. Os `geo`
ostane čista domena veljavnosti (kaj sme obdelati), kar je bil namen razcepa.

Posledica: **292 multi-view trditev ostane zelenih brez spremembe besedila** in edina
namerna razlika v obnašanju je `assumed-reference + planeCalibrated` (§3.2.1, zadnja
vrstica). §5 zato odpove: od dveh napovedanih sprememb obnašanja
**ostane samo §3.2.1** (projekcija fokusa je odpravljena). Tretja os `CameraAssurance` ni potrebna in ni narejena.

### 9.3 NAJDBA F1 — `canExportOrder` kot zapisan v §3.4 je bil napačen

`geo ≥ ORIENTED && met ≥ REFERENCED` bi zaprl vrata naročilnici, temelječi na **merjenem**
odseku (trak/laser), kadar foto-geometrija ni umerjena. To je ista zamešljivost, ki jo razcep
odpravlja: geometrija posnetka ne more biti pogoj za številko, ki iz fotke ne izhaja.

Popravljeno v `src/lib/assertion.ts` z isto prednostjo veje kot `projectStatus`:

```
canExportOrder(geo, met) = met ≥ REFERENCED && (met ≥ MEASURED || geo ≥ ORIENTED)
```

Odprtih parov je **13/25**, ne 9/25. Prag `REFERENCED` za merilo iz fotke ostaja nespremenjen,
zato se politika naročilnic iz slike ne skrči in ne razširi — razširi se samo tja, kjer je
bila doslej napačno zaprta. Test: `canExportOrder: mera ni iz fotke → vrata odprta ne glede na
geometrijo` in `GEOMETRIJA ne more blokirati laserske mere`.

### 9.4 NAJDBA F2 — stari `STATUS_ORDER` ni mrežasta urejenost

`projectStatus` je monotona po geometriji (5×5 preverjeno), po merilni osi pa ima natanko
**tri** padce: `REFERENCED → MEASURED` tj. `CALIBRATED (3) → MANUAL (2)` pri vsaki od treh
geometrij, ki kaj dopuščajo. Ročna izmera je torej strogo boljši *vir*, na lestvici pa *nižji*
od merila iz fotke. To ni napaka projekcije, je napaka predpostavke, da ena lestvica zmore
razvrščati hkrati po domeni veljavnosti in po izvoru vrednosti — kar je celotni smisel razcepa.

Za zdaj **latentno**: `grep` po `src` pokaže, da `statusRank`/`statusAtLeast` zunaj modula
nihče ne kliče, zato nobena obstoječa klicna pot ne zavrne laserske mere. Kdor koli v fazi 2
bo vrata sklepal po `statusAtLeast(status, 'CALIBRATED')`, bo to napako aktiviral — zato
pravilo 14 spodaj.

### 9.5 Pravilo 14 (dodatek §6) in posodobljen seznam korakov

14. **Vrata se sklepajo po paru `(geo, met)`, nikoli po projiciranem statusu.**
    `MeasurementStatus` je za izpis in sledljivost; je izgubljena projekcija in za odločanje
    ni več dovolj natančna (F2).

Koraki 1 in 2 (§7) sta izvedena: `src/lib/assertion.ts` (nov, list, edini uvoz je
`import type`) in `tests/verify/assertion.ts` — **119 preverjanj, 0 napak**, vključno s
totalno 25/25 tabela, vsako vrstico §3.2.1 in obema najdbama.

### 9.6 Koraki 3–7 so izvedeni (samostojna izvedba, 2026-10-15, merjeno)

Izvedbe, ki jih spec ni mogel predvideti do konca:

1. **Korak 3–4**: `validateGeometry` + `validateMetric` sta nova izvoza; `validateScale`,
   `validateMultiView` in `validateSfm` ostanejo kot ovojnice, ki sestavijo `projectStatus`.
   `tests/verify/measurement-status.ts` je bil pregledan z `git diff --stat` — **prazen**,
   90/90. `downgradeMetricOnReferenceChange` / `downgradeGeometryOnQuadChange` sta ločena
   (pravilo 12); stari `downgradeOnReferenceChange` ostane nespremenjen.
2. **Korak 5** (razcep večpogleda): nobena od **292** obstoječih trditev (104 + 66 + 122) ni
   bila spreminjena — dokaz je diferenčni, ne trditev: `tests/verify/multiview-split.ts`
   (**50/50**) pregleda mrežo `MV_V1` (150) + `SFM_V1` (162) = **312 vrstic** in zahteva, da je
   `(ok, code, status)` IDENTIČEN kot v HEAD posnetku; doda lokalnost kod (`ASSUMED_SCALE`,
   `MULTIVIEW_DEGENERATE`, `NO_CALIBRATION`, `OK`, `RESIDUAL_HIGH` so metrične, geometrijske
   jih nikoli ne vrnejo in obratno), enakost `wrapper.status === projectStatus(geo, met)` po celi
   mreži, pragova 12 inlierjev / 3 px in rob (11/12, 3,0 vs 3,0001 px).
3. **Korak 6** (`wCm → nullable`) je največja odstopanja od pisanega načrta:
   - homografija POTREBUJE širino, zato je bila uvedena **kanonična notranja mera**
     `CANONICAL_PLANE_WIDTH_CM = 100` (`photo-replace-core.ts:493`). Pravilo 13 jo sme
     uporabiti SAMO znotraj reševalnika; izpisati jo kot mero je napaka.
   - Trditev §4.2 o popolni neodvisnosti je bila **izmerjena, ne predpostavljena**:
     pri dosegljivih širinah (≤ 400 cm) so deske in reže **byte-enake** za vsako širino in za
     `null`; za skrajne vrednosti (10 / 37,5 / 1000 / 5000 cm, kjer `calibratePlane` še dovoli
     reševati — spodnja meja je 10 cm, `homography.ts:107`) je enako število elementov in
     **najslabši izmerjeni odmik 2,274e-13 px** — conditioning v plavajoči točki
     `solveHomography`, ne domnevna mera. Test to pove z izpisano številko (`< 1e-9 px`), ne z
     glajenjem.
   - `met = NONE` **brez `hCm`** pomeni odprta vrata in brez izrisa (pravilo 11) — pri
     vodoravnih deskah je edina potrebna dolžina višina (`n = floor((hCm + gap)/pitch)`), pri
     pokončnih pa širina. Zato `wCm = null` + `orientation = 'vertical'` vrne eksplicitno
     napako, ne tihega izrisa.
   - Iskrenost je zaklenjena na treh izhodih: `LayoutResult.widthKnown`,
     `buildReplaceMetadata` (preizkus `NESKLADJJE`, kadar metapodatki trdijo mero, ki je geometrija
     ni uporabila, ali obratno), `buildBomFromMeta` (`KOSOVNICA NI DOLOČENA` + pravila 11 kot
     razlog), `buildCompareLabels` (»širina NI izmerjena« namesto `100 × …`).
   - UI: `wCm` je lahko PRAZEN; `canRenderMontage` odpre izris, `canExportOrder` zapre
     naročilnico in gumb zanjo da iskren razlog. Obstoječa CALIBRATED značka na dokazani poti
     ni bila prebarvana (aditivna veja).
4. **Korak 7** (regresija na resnični fotki): `tests/verify/plank-layout-width.ts` (**26/26**)
   hodi po geometriji `fb-hi/04.jpg` (1536×746, meritveno s `sharp`; štirikotnik
   7/24 → 93/17 → 93/71 → 7/78, torej dejanski pred/po okvir z leve strani). §4.3 (`05..08`) in
   §4.4 (Test natančnosti) **nista izvedena** — potrebna je ročna vbrona oglišč in trak na
   objektu; ne simulirata se.
5. **Celoten sweep po FAZA-8**: **42** skriptov v `tests/verify`, **37 exit 0**, petih rdečih je
   istih pet kot pred posegom in vsi zaradi okolja (zajeti nizi: `/tmp/t30-front.png`,
   `/tmp/t29-flat.png`, `/tmp/t26-front.png`, `/tmp/t27-stack.png` → "unable to open for
   write"; `Input file is missing: /home/z/my-project/tests/task32-fasada.jpg`), ne logike.
   Assertivnih preverjanj je **2024 → 2275**: 2024 = izmerjeni baseline 27 counting
   skriptov (BASELINE-2026-10-15.md), +251 = izmerjeni števci štirih NOVIH skriptov ta
   teden (assertion 119 + scale-split 56 + multiview-split 50 + plank-layout-width 26).
   Agregata ni bilo mogoče ponovno izračunati samodejno (nekateri skripti v izpisu
   tiskajo decimalke z vejico, kar regex-a prenabije), zato je zapisana vsota dveh
   MERJENJI, ne ena samodejna številka.
6. **Korak 8**: `MEASUREMENT-BASELINE.md` posodobljen — nova §2.6 (dve osi, z dokazi), §3
   približka 8–9, §4 tri iskrene vrstice (realne meritve manjkajo, `tsc`/`eslint` nista bila
   pognana, katalogske višine ne obstajajo), §5 popravljene številke in §6 pravila 10–14.
   **Amandma 2026-10-16 (verifikacija):** srednja vrstica §4 (= `tsc`/`eslint` nista bila
   pognana) je bila napačna po tem, ko je Robert dovolil install — nadomeščena je izmerjenimi
   rezultati, §2.6 in §5 pa vsebujeta E2E na 390 px in 1280 px namesto opombe »še ni pognan«.
   §6 pravilu 11 je dodana meja (najdba F3: pokončni profil brez širine zavrne izris).
   Odstopanje od §7.8: pravil je **pet**, ne tri — 13 (neznana širina je izpisana) in 14 (vrata
   se sklenejo po paru) sta rodila izvedba, ne načrt.

### 9.7 Uskladitev s Task 66 (izmerjena deska → predlog profila)

Task 66 meri na RAVNINI (`calibratePlane` + `planeDistanceCm`), homografija pa širine brez
`wCm` ne more sestaviti. FAZA-8 zato pomeni: kadar je širina izpuščena, orodje za merjenje
**ni na voljo** — in to je pravilno, ne okvara. V UI je to zdaj povedano z lastno vejo
(gumb + toast pravita »merjenje potrebuje TUDI izmerjeno širino ravnine … brez cm razdalja v
pikslih ni mera«), ne več z generičnim »kalibriraj ravnino«. `src/lib/photo-profile-suggest.ts`
se ni spremenil — njegovih **59/59** trditev FAZA-8 ne dotakne; spremeni se samo vhod (brez
kalibrirane ravnine do orodja sploh ne pride).

Zapisano eksplicitno, da ne nastane napačna predpostavka: izmera deske **ne more**
nadomestiti manjkajoče širine — merjenje samo potrebuje umerjeno ravnino, torej
`met = REFERENCED` že pred njim. Edini vnos, ki v fotomontaži preklaplja `NONE → REFERENCED`,
ostane **vpisana izmerna dolžina ravnine** (`hCm` je obvezen, `wCm` je postal izbiren šele s
FAZA-8). Kdor želi „nič tipkanja" vse do naročilnice, mora zato pripeljati zunanjo mero
(laser/trak → `MANUAL`/`CROSS_CHECKED`) ali katalogsko višino, ki pa po pravilu 11 rodi samo
`ASSUMED`.

