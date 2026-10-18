# Obrtnik Pro

[![CI](https://github.com/robertpezdirc8-prog/obrtnik-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/robertpezdirc8-prog/obrtnik-pro/actions/workflows/ci.yml)

Delovna aplikacija za obrtnike: ponudbe in računi, evidence dela, gradbiščni dnevnik,
katalog ter **pametna kamera** z merjenjem po fotki, 3D predogledom, AR in
**fotomontažo ograj/fasad z originalnimi ROKSAL profili**.

Celotna aplikacija deluje **deterministično — brez generativne AI in brez plačljivih
zunanjih slikovnih storitev**. Vse meritve, analize in fotomontaže temeljijo na
klasičnih CV/postopkih (homografija, detekcija robov, SfM, teksturno tlakovanje).

> **Stanje:** aktiven notranji razvoj. Pristop je *dokazno načelo* — vsaka funkcija
> ima verifikacijske teste in E2E posnetke; ničesar ni treba »verjeti na besedo«
> (glej [Načela](#načela) in [Testi in dokazi](#testi-in-dokazi)).
> Zadnja polna preverba: **regresija 51/51 skript zeleno** (pet, ki je bilo doslej rdečih, je
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
> v razporedu stebrov doslej ni bila podatek — bil je privzetek kode (`150`). Prva verzija
> modula je številko vezala samo na ELEMENT (stebriček, nosilec, letev) in je zato trdila dve
> napačni stvari: da je 150 cm splošna meja za stebričke (v resnici velja samo za profil POLNA
> DESKA-57-32) in da si ROKSAL nasprotuje s 150/180 cm.
> **Druga verzija (Task 81, 2026-10-16):** vsako od pravil v `src/lib/roksal-span-rules.ts`
> nosi tudi **izdelek** (`family`: ograja / terasa / fasada / pregrada / ročaj /
> korito) in **naslov odseka**, pod katerim je citat stal. Isti izraz pomeni različne stvari:
> podložna letev je na fasadi 70–80 cm, na terasi 33–35 cm; KUBO je na fasadi 100 cm, kot
> pregradna stena 120 cm oziroma 260 cm z alu vstavkom. Brez izrečene družine modul vrne
> `UNKNOWN` in UI NE SME pokazati ene same številke — namesto njej ponudi **tabelo mej po
> profilih** in najstrožjo od njih. Pravila so razvrščena `DIRECT` (gre za ta element) /
> `ADJACENT` (namig iz DRUGEGA elementa — nikoli meja, samo opomba) ter po vrsti:
> `limit` (meja), `range` (priporočen pas reže — nikoli ne veže) in `consequence` (»dodaj še
> en stebriček« — nikoli ne zniža meje). Pas (npr. 133–145 cm) je vedno rešen s SPODNJIM robom;
> med enako splošnimi citati vzame modul NIŽJega in razhajanje JAVI, pravih razhajanj
> (150 pri 57-32 proti 180 pri ograji do 150 cm višine) pa ne izmišlja. Kadar meja čaka na
> odgovor (manjka višina polnila, orientacija ali profil), UI reče »manjka: …« in ne »ROKSAL
> tega ne objavlja«. Monterjev vmesnik pokaže »Največ 110 cm po ROKSALovih navodilih
> (roksal.com/…montaza-wpc-deske/) — „…»« in OPOZORI, če je izbrana meja nad objavljeno.
> Dokaz v brskalniku: `tests/e2e-span-rule-ui.ts` (**50/50**) s `span-rule-ui.png` na disku;
> panel je viden tudi BREZ fotke (zavihek Pripomočki). Računski razpored (`planPostLayout`)
> in nakupovna načrta se nista spremenila — pravila svetujejo, ne vsiljujejo: monterjeva izbira
> ostane v aritmetiki in je jasno označena kot nad mejo. Enako je razmak 1,5 m v ponudbi zdaj
> oznčen kot *predpostavka izračuna*, ne kot ROKSALova meja.
> **REŽA med deskami (Task 82, 2026-10-16):** katalog je za VSE profile trdil „uradni FAQ
> obseg 0,2–3 cm“ in za ROMB „110 cm za nosilce“. Nobena stran ROKSALa tega ne objavlja.
> „0,2–3“ je seštevek DVEH LOČENIH objav: 2 mm kot običajna vrednost za POLNA DESKA-100 na
> FASADI in 3 cm kot zgornji rob priporočenega pasu za 100/128 na OGRADI. Izmišljena številka
> je nevarnejša od manjkajoče — monter jo prebere kot dovoljenje. Pravila reže so zato zdaj
> ločena po profilu: pas **0,5–3 cm** velja samo za POLNA DESKA 100 in 128 na ograji (istovesten
> naslov imenuje oba, zato ju sme pokrivati), **0,2 cm** je objavljen kot OBIČAJ (ne pas) za
> POLNA DESKA-100 na fasadi, KUBO ima objavljeno „razmak med deskami poljuben“, ROMB pa samo
> KAKOVOSTNO opombo (viden pritrdilni material). Terasna deka 150 nima objavljenega PASU —
> 5–6 mm se v FAQ pojavi samo v besedilu samega vprašanja (`ADJACENT`), zato nikoli ne more
> postati mera. Novi izvozni tipi so `typical` (običaj), `free` (poljuben) in `deferred`
> (ROKSAL številko zadrži drugam); `boardGap()` brez izrečenega profila NE SME vrniti
> nobene številke, čeprav jo pozna. Katalog (`roksal-assets.ts`) vsako režo zdaj označi sama:
> kartica profila v foto-replace pokaže žig „ROKSAL objavlja 0,5–3 cm na ograji“ ALI
> „privzetek izračuna — ROKSAL je ne objavlja“ (`fr-gap-stamp-<id>`), panel razporeda pa
> štirimi stanjami (pas / običaj / poljubna / **ne objavlja**). Zaklenjeno:
> `tests/verify/roksal-board-gap.ts` (**58/58**), `tests/verify/roksal-span-rules.ts`
> (**133/133**), E2E preizkusi 43–48 (vključno z „brez profila ni pokazane NOBE številke reže“).
> **VNOS SE NE POPRAVLJA VEČ (Task 83, 2026-10-16):** WPC kalkulator je vnose zdravil s tihim
> usekom (`Math.min`) — monter je vpisal razmak nosilcev 1,2 m, na zaslonu je stal 1,2 m,
> računal pa je 0,6 m. Pri terasi 4 × 3 m je to pomenilo 24 lm namesto 15 lm nosilcev (+60 % materiala na
> ponudbi), ki je bila videti kot izračunana po monterjevih podatkih. Pravilo je zdaj razločeno:
> **okno vnosa ni inženirski predpis**. `src/lib/terasa-inputs.ts` pozna sedem meja, ki samo
> povedo, kaj aplikacija še ZNA izračunati; zunaj njih se izračun ZAVRNE z razlogom, ki imenuje
> VPISANO vrednost (»Razmak nosilcev 8 m je preveč za izračun (8 > 3) … Izračun ni opravljen —
> nobena postavka ni obračunana.«), postavke in gumb »Dodaj v ponudbo« pa izginejo. Znotraj okna
> se vpisana vrednost uporabi TOČNO, ROKSALov objavljen pas (33–35 cm) pa jo samo OCENI
> (znotraj pasu / znotraj pasu a nad varno mejo / PREŠIROKO). Cena in načrt montaže se ravnavata
> po ISTEM resolverju, zato se ne moreta raziti. Posledično je bil aplikacijski privzetek
> premaknjen z 0,4 m na **0,33 m** (spodnji rob objavljenega pasu — stari privzetek je sam sebi
> sprožil opozorilo »preširoko«), predlog iz fotografije pa se več ne tipka, ampak se izpelje iz
> pravila (`JOIST_SUGGEST_M`). Zaklenjeno: `tests/verify/terasa-input-guard.ts` (**84/84**,
> vključno z mutacijskim dokazom in pariteto cena ⇄ načrt čez 11 vhodov) in
> `tests/e2e-terasa-input-ui.ts` (**36/36** v živem brskalniku).
> **Isti pogon je zdaj tudi pri ograjah (Task 84, 2026-10-16).** Tam je bil usek še hujši: cena
> je računala `Math.max(0.9, višina)`, načrt montaže pa je bral vpisano višino neposredno — dva
> bralca istega polja sta si lahko nasprotovala. Monter je vpisal 0,5 m, na zaslonu videl 0,5 m,
> ponudba pa je tekla pri 0,9 m. Mehanizem je iz terase prenesen v `src/lib/craft-inputs.ts`
> (register meja + resolver + besedilo zavrnitve), `terasa-inputs.ts` ga zdaj samo še uporablja,
> zato se formulaciji ne moreta raziti. `src/lib/pricing.ts` in `src/lib/install-plan.ts` oba
> hodita čez `resolveCraftInputs('ograje', …)`. Tretji bralec istega vnosa — norma za trajanje
> montaže (`src/lib/labor.ts`) — se ustavi SKUPAJ s ponudbo: sicer bi termine načrtoval po
> meritvi, ki jo je ponudba že zavrnila. Poleg tega je bila zaslonska meja `min={0.9}` (ki je
> obljubljala poseg v vnos) zamenjana z namigom, vzetim IZ REGISTRA, trditev »predpis
> zahteva ≥ 1,0 m«, ki ni imela vira, pa je zdaj označena kot priporočilo iz prakse. Številke v
> opisih in man-ure se izpisujejo z vejico (`formatNum`), kot jih bere monter. Zaklenjeno:
> `tests/verify/ograje-input-guard.ts` (**75/75**, vključno s srednjim pasom 0,9–1,0 m, ki ga
> prej ni pokrilo nobeno preverjanje) in `tests/e2e-ograje-input-ui.ts`
> (**42/42** v živem brskalniku, z dvema posnetkoma na disku).
> **Isti pogon je zdaj vseh sedem dejavnosti (Task 85, 2026-10-17).** Bolezen ni bila samo pri
> ograjah: stopnice so računale `Math.max(0.6, širina)`, keramika je rezervo usekala na 30 %,
> okna so velikost odprtine usekala na 0,5 m, nadstrešek je vedno dobil vsaj 2 stebra, fasada pa
> `Math.max(0, bruto − odprtine)` — iz napačne izmere je nastala ničla brez razloga. Vseh pet
> je zdaj prek `resolveCraftInputs('<dejavnost>', …)` povezanih v isti register (`src/lib/craft-inputs.ts`),
> cena, načrt montaže IN norma za trajanje montaže vsi trije ali uporabijo vpisano število
> dobesedno, ali pa ga zavrnejo z istim stavkom. Fasada ima prvič še **povezalno** mejo: zgornji
> rob odprtin ni konstanta, ampak izračunana bruto površina stene, zato 120 m² odprtin na 100,8 m²
> stene dobi razlog, ne tihe ničle. Pri stopnicah je hkrati odstranjena **izmišljena številka**:
> stari načrt je računal `G = min(32, max(25, 63 − 2R))` in nato vedno izpisal »✓ udobje«, ker je
> globino stopnice priskrbel isti izraz, ki naj bi jo preveril; zdaj našteje razpon G, ki ga
> pravilo 2R + G = 60–66 cm zahteva, in pošteno reče, da globine vnos ne pozna. DOM meje
> (`min={0.6}`, `min={0}`) so iz polj odstranjene, namigi pod njimi pa črpajo ISTE številke iz
> registra. Zaklenjeno: `tests/verify/craft-inputs-all.ts` (**481/481**, generično čez vse
> registrirane robove vseh petih dejavnosti + pariteta treh bralcev) in
> `tests/e2e-craft-inputs-ui.ts` (**79/79** v živem brskalniku na treh dejavnostih, s tremi
> posnetki na disku).
>
> **Isti pogon velja zdaj tudi za nastavitve, dokumente in ročno vpisano ceno (Tasks 86–87,
> 2026-10-17).** Številka, ki jo monter vpíše v Nastavitvah, je imela štiri bralce in štiri
> različne posege: PDF ponudbe in PDF računa sta akontacijo usekali (`Math.floor(depositPercent ??
> 0)` — 33,7 % je na dokumentu postalo 33 %), SMS-skript je imel SVOJ privzetek (`?? 30`) in je
> prav tako usekal na celota, urejevalnik ponudbe pa je računal tretjič. Veljavnost ponudbe je ob
> praznem ali ničelnem vnosu postala +15 dni (`|| 15`), rok plačila na računu pa +15 dni IN hkrati
> hardcodiranih 30 dni: `POST /api/invoices` je rok dodelil po `DEFAULT_DUE_DAYS`, PDF pa je pisal
> `paymentDays` — isti račun je imel DVA datuma zapadlosti, evidenca terjatev pa je izmislila še
> tretjega, ker je `effectiveDueAt` ob praznem roku vrnil 30 dni. `POST /api/offers` je
> ob manjkajoči stopnji v bazo poslal izmišljenih 22 %. Zdaj vsi bralci — Nastavitve, urejevalnik,
> PDF ponudbe, PDF računa, SMS in vsi trije API-ji — hodijo čez `readSettings` iz
> `src/lib/settings-inputs.ts`: vpisana številka gre na dokument DOBESEDNO (33,7 % ostane 33,7 %),
> sicer dokument vrsto izpusti in v razlogu navede VPISANO vrednost. Račun brez veljavnega roka
> nima datuma zapadlosti in ga evidenca označi kot »Brez roka«; konstanta `DEFAULT_DUE_DAYS` je
> izbrisana.
> Strežnik je rob sistema: `PUT /api/settings` zdaj 150 % akontacije ali »abc« ZAVRNE s 400 in
> imenuje vpisano vrednost, namesto da bi `Number()` v bazo shranil NaN.
>
> Task 87 je isto bolezen zdravil na strani vnosa. Vsa številčna polja so `type="text"` z
> `inputMode="decimal"`, ker je `type="number"` slovensko vejico vrnil kot PRAZEN string,
> `Number('')` pa je 0: monter je tipkal 12,5 in vrstica je tekla pri 0 €. Neveljaven vnos
> gre naprej kot NaN — izračun se USTAVI z razlogom, ki imenuje vpisano vrednost, postavka pokaže
> »—« namesto 0,00 €, gumboma »Dodaj v ponudbo« in »Shrani ponudbo« pa sta zaprta, da v bazo ne
> more iti znesek, ki ga noben zaslon ni izračunal. NumField hkrati OHRANI TIPKANO besedilo (če je
> nekdo vpisal 6.5, polje kaže 6.5); vejica je oblika shranjenih in izpeljanih izpisov, ne
> lastnost vnosa. Iz klica kamere in iz pogona cen je odstranjena IZMIŠLJENA ura 35 €: kamera
> bere postavko iz Nastavitev in brez veljavne ure ne zbere projekta v ponudbo.
>
> **Napako v produktivni logiki, ki jo je ujel šele brskalnik:** `settings-view.save()`
> je na strežnik poslal `{ ...settings }` (STARO stanje) namesto `{ ...draft }`. Monter, ki je
> vpisal 33,7 in pritisnil Shrani, je dobil potrditev »Nastavitve shranjene ✓« — v bazi pa je
> ostalo 30. Tiho neshranjenje, ki ga enotski test ne more videti, ker ne pozna gumba.
>
> Zaklenjeno: novi `tests/verify/settings-input-guard.ts` (**175/175**: register petih polj,
> pariteta PDF ponudbe ⇄ PDF računa ⇄ SMS ⇄ urejevalnik ⇄ strežnik, veljavnost brez 15 dni, rok
> brez 30 dni), `payment-tracking` je zrastel 77 → **83** (stanje »Brez roka«),
> `ograje-input-guard` 75 → **80** (montaža ograje sledi nastavljeni uri). V živem brskalniku: novi `tests/e2e-typed-number-ui.ts`
> **92/92** po treh površinah (Nastavitve → kalkulator → urejevalnik), s šestimi posnetki,
> preverjenimi po velikosti NA DISKU, in `e2e-eslog-cdp.ts` **43/43**. Šest E2E skriptov doslej
> na tem računalniku NI MOGOLO teči (trdo vpisan `http://localhost:3000` in samo Linux poti do
> chromiuma); vseh enajst navigacijskih skriptov zdaj sprejme `APP_URL` in `CDP_PORT`, seznam poti
> do brskalnika pa pokriva Windows, macOS in Linux.

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
Pregledna plošča s stanjem ponudb, terjatvami in hitrim dostopom do orodij.

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
monterju prodajala številko, ki je ni znala utemeljiti. Zdaj je **27** ROKSALovih pravil za
razmike shranjenih **iz besede v besedo**, vsako s svojim virom in — kar je bistvo druge
verzije — s svojim **izdelkom**:

| Polje | Pomeni |
|---|---|
| `quote` / `source` | dobesedni citat z roksal.com in URL strani, od kod je vzet |
| `family` | izdelek, pod katerim je bil citat objavljen (ograja / terasa / fasada / pregrada / ročaj / korito) |
| `heading` | dobeseden naslov odseka na strani — številka velja SAMO pod njim |
| `basis` | `DIRECT` (citat govori O TEM elementu) / `ADJACENT` (stevek iz Vprašanj; sme biti samo opomba) |
| `kind` | `limit` (meja) / `range` (priporočen pas reže — NIKOLI ne veže) / `typical` (objavljen **običaj**, ne pas) / `free` (ROKSAL objavi, da je razmik **poljuben**) / `deferred` (ROKSAL številko zadrži drugam) / `qualitative` (opomba brez mere) / `consequence` («pri ≥ 180 cm dodaj še en stebriček» — NI meja) |
| `bandCm` | objavljen pas (133–140, 133–145, 70–80, 33–35) → kot meja vedno velja **SPODNJI** rob |

Zakaj `family`: ROKSAL isto besedo uporablja za različne izdelke, številke pa se prav po
tem razhajajo. »Podložna letev« je na fasadi 70–80 cm, na terasi 33–35 cm. KUBO profil je
na fasadi omejen na 100 cm, kot pregradna stena pa na 120 cm — oziroma 260 cm, če je v
letvico vstavljena alu cev 20 × 60 × 2 mm. Pravilo brez izdelka torej ne more biti
pravilno, zato ga klicatelj **mora** izreči; sicer modul vrne `UNKNOWN`.

Logika `maxAllowedSpan`: meja je **najnižja** med uporabnimi `DIRECT` pravili; `range` in
`consequence` pravili nikoli ne znižata meje, sta samo izpisani opozorili; pas sme vplivati
samo s spodnjim robom; razhajanje se JAVI samo, kadar si dva enako splošna citata
resno nasprotita — in takrat je izbrana NIŽJA meja, ne tiho. Kadar meja čaka na odgovor (manjka
profil, višina polnila ali orientacija desk), je odgovor `UNKNOWN` z mejo `0` in opombo
»manjka: …« — nikoli trditev, da ROKSAL ne objavlja. Kjer je meja odvisna samo od profila,
UI pokaže **tabelo** (`byProfile`) in najstrožjo vrednost iz nje, ne ene same izbrane številke.

V monterjevem vmesniku (`post-layout-panel`) to pomeni: razpored ima vprašanja po **profilu**
in po **postavitvi desk**, izpisana pa je lahko samo tista številka, ki jo oba odgovora
utemeljita — »Največ 110 cm: „Stebrički za vodoravno postavitev desk morajo biti na maksimalni
razdalji 110 cm." « (roksal.com/woodcore-wpc-deske/montaza-wpc-deske/). Brez izbranega profila
panel NE trdi ene meje, ampak našteje tabelo (110 / 150 / 180 cm s svojimi viri) in opozori
na najstrožjo. Če monter izbere nad mejo, se pojavi OPOZORILO, razpored pa še vedno računa z
izbrano mero — pravila svetujejo, ne prevzemajo odločitve namesto človeka.
Pokrito z `tests/verify/roksal-span-rules.ts` (**133/133**),
`tests/verify/roksal-board-gap.ts` (**58/58**) in
`tests/e2e-span-rule-ui.ts` (**50/50**).

#### Reža med deskami: objavljeno, običaj, poljubno — ALI nič (Task 82)

Katalog je za VSE profile trdil „uradni FAQ obseg 0,2–3 cm“. Te objave ni. „0,2–3“ je
seštevek dveh LOČENIH objav, ki govorita o različnih izdelkih: **2 mm** je običajna vrednost
za POLNA DESKA-100 na **fasadi**, **3 cm** je zgornji rob priporočenega pasu za
POLNA DESKA 100/128 na **ograji**. Izmišljena številka je nevarnejša od manjkajoče, ker jo
monter prebere kot dovoljenje.

Zato `boardGap()` pozna ŠTIRI izhode in nobenega od njih ne zamenja s številko:

| Stanje | Kaj ROKSAL objavi | Kaj pokaže vmesnik |
|---|---|---|
| pas (`range`) | 0,5–3 cm pod naslovom, ki imenuje DESKA 100 IN 128 | „Reža po ROKSALu: 0,5–3 cm — priporočen pas, **ne meja**“ |
| običaj (`typical`) | 0,2 cm, objavljena je samo vrednost, ne obseg | „Reža po ROKSALu: običajno 0,2 cm — objavljen je samo običaj“ |
| poljubno (`free`) | KUBO na fasadi: „razmak med deskami poljuben“ | „Reža po ROKSALu: poljubna — številke ni treba iskati“ |
| nič (`UNKNOWN`) | za ta izdelek reža ni objavljena | „**Reže ROKSAL za ta izdelek ne objavlja**“ |

Tri pravila, ki jih ta razcep zavrne: številka enega profila se NE SME prenesti na drugega
(57-32, ROMB, KUBO, terasna deka so za ograjo `UNKNOWN`); objava z dvema profiloma v naslovu
velja za **oba** (množica `profiles`, ne AND pogoj); `ADJACENT` citat — 5–6 mm se na terasi
pojavi samo v besedilu samega vprašanja — nikoli ne postane mera.

Ista beseda velja za katalog: vsaka kartica profila v fotomontaži dobi žig
(`fr-gap-stamp-<id>`), ki razloči **objavo** od **privzetka izračuna** — zelen
„ROKSAL objavlja 0,5–3 cm na ograji“ ali jantarov „privzetek izračuna — ROKSAL je ne
objavlja“. Tretje pravilo, ki ga je ujel šele brskalnik in ne enotskih zaklepov:
**brez izrečenega profila modul ne sme vrniti nobene številke**, sicer kartica trdi
splošnost, ki je ROKSAL ni napisal.

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

### Prijava (Task 93 — issue #2)

Aplikacija ima temelj prijave: prvi zagon z uklopljeno zaščito odpre
registracijo **lastnika** (edinega), po tem je registracija zaprta in
ostane prijava. Gesla so v bazi kot scrypt (`scrypt$salt$hash`, N=2¹⁴),
seja pa HttpOnly piškotek s HMAC-podpisanim žetonom (7 dni) — brez
dodatnih odvisnosti, jedro je preverjeno v `tests/verify/auth.ts`
(50 preverb z injektirano uro).

Zaščita se uklopi z dvema vrsticama v `.env` (vzorec glej `.env.example`):

```bash
AUTH_SECRET="<izpis zgornjega ukaza>"   # skrivnost za podpis sej
AUTH_ENFORCED=1                          # '1' = API zahteva prijavo
```

Brez teh vrstic (privzeto) je aplikacija odprta — lokalni razvoj, E2E
preverbe in tablica tečejo kot prej. Iskreno zapisane omejitve temelja:
odjava ne prekliče žetona (brezstanjska seja velja do poteka), piškotek
nima `Secure` (aplikacija teče tudi čez http na LAN/adb reverse), podatki
pa še niso obsegani po uporabniku (več-uporabniško obseganje ostaja
odprto — issue #2).

Produkcijski build (standalone):

```bash
bun run build
bun run start   # .next/standalone/server.js
```

## Testi in dokazi

### Verifikacijske skripte (59)

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
bun tests/verify/roksal-span-rules.ts # Task 80/81/82: 27 objavljenih ROKSAL pravil — citat, vir, izdelek, pas, razhajanje
bun tests/verify/roksal-board-gap.ts  # Task 82: reža sme biti samo objavljena (brez prenosa med profili)
# … (celoten seznam: tests/verify/)
```

Izhod vsake skripte: `REZULTAT: N OK, 0 NAPAK` + izhodna koda `1` ob napaki.
Zadnja preverba (2026-10-17, do Tasks 86–87): **54 skriptov, 54 z izhodno kodo 0** (47 jih nosi brojač preverb, sedem je raziskovalnih izpisov brez njega).
Pet skriptov, ki je doslej padalo (`canopy-analysis`, `deck-analysis`, `fasada-analysis`,
`stair-profile`, `tile-grid`), je prevedenih na `os.tmpdir()` oziroma relacijo do
`import.meta.url`, njihovi števci pa so zdaj izmerjeni NA TEJ STROJI: 52 + 53 + 33 + 15 + 41
= **194**. Nov varovalni skript `portable-paths` (**28/28**, z mutacijskim dokazom) prepove
absolutne strojno vezane poti v `src/` in `tests/`. Izmerjeno posamezno: **photo-replace 391/391**,
**assertion 119/119**, **measurement-status 90/90** (besedilo testa nespremenjeno),
**multiview 104**, **multiview-chain 66**, **multiview-sfm 122**, **multiview-split 50**,
**scale-split 56**, **plank-layout-width 26**, **roksal-tiles 199/199**,
**photo-bom 25/25**, **photo-compare 45/45**, **photo-profile-suggest 59/59**, **render-promise
25/25**, **gt-evidence 102/102**, **roksal-span-rules 133/133**, **roksal-board-gap 58/58**,
**terasa-input-guard 84/84** (Task 83: noben vnos terase se tiho ne useka; cena in montažni načrt
se ravnavata po ISTEM resolverju),
**ograje-input-guard 80/80** (Task 84: isti pogon pri ograjah — cena, načrt IN norma za trajanje
berejo vpisano višino dobesedno ali pa jo vsi trije zavrnejo; 75 → 80 ob Tasku 87, ker mora vrstica
»Montaža ograje« slediti NASTAVLJENI uri in ne izmišljenih 35 €/m),
**craft-inputs-all 481/481** (Task 85: ista trditev čez vseh pet preostalih dejavnosti — vsak
registriran rob posebej, oba izpista vnosa in plavajoči rob pri fasadi),
**settings-input-guard 175/175** (Tasks 86–87, NOV: register petih nastavitvenih polj in pariteta
vseh šestih bralcev — Nastavitve, urejevalnik, PDF ponudbe, PDF računa, SMS, oba API-ja; veljavnost
brez izmišljenih 15 dni, rok plačila brez izmišljenih 30 dni, DDV brez izmišljenih 22 %,
nobeno številčno polje ni več `type="number"` in nobeno nima DOM meje),
**payment-tracking 83/83** (Task 86: 77 → 83, ker je računu brez roka dodano stanje »Brez roka«
in je `DEFAULT_DUE_DAYS` izbrisan — preizkus to preverja neposredno v modulu).
Assertivnih preverjanj skupaj,
zdaj IZMERJENO Z ENO STEVLJO in
ne sešteto iz spomina: **3754 OK / 0 NAPAK** v **47** od **54** `tests/verify/*.ts` skriptov;
sedem (`features-photos`, `real-photos`, `structure-photos`, `debug-energies`, `scores-debug`,
`quality-calibrate`, `scene-classify`) je raziskovalnih izpisov brez brojača preverb. Ponovi z
`bun tests/verify-counts.ts` — če nov skript ne izpiše povzetka, agregator vrne izhodno kodo 1,
zato številka ne more pasti neopaženo. Prejšnja ročno sestavljena številka **2757** je bila za
**20 previsoka**: `eslog.ts` v izpisu vrve DVE zaporedni števili (72 in 101) in seštevek jima je
obema prisluhnil, agregator pa zna poizvedeti samo zadnjo vrsto (101) — dokaz, da mora biti
seštevek izmerjen, ne zapisan. Zadnja delta je izmerjena enako in SEŠTEJE SE TOČNO: 3568 →
**3754** = +186 = +175 (nov `settings-input-guard`) +5 (`ograje-input-guard` 75 → 80, ura iz
Nastavitev) +6 (`payment-tracking` 77 → 83); nobeno preverjanje ni izginilo. Prvi izmerjen seštevek
te runde je bil **3759**, ne 3754 — pet preverjanj je bilo dvakrat zapisanih v `ograje-input-guard`,
pri čemer je drugi izvod primerjal `Aluminijasta ograje` (imena take vrstice ni) z enakim imenom na
obeh straneh, torej `undefined === undefined`: preizkus, ki ne more spodleteti. Odtis je izbrisan,
številka je bila merjena znova, in dokumentirana je IZMERJENA, ne prva.
E2E preverjanj (tečajo v brskalniku, NISO v zgornjem seštevku): `e2e-band-ui.ts` **50/50** (vključno s tremi posnetki, katerih velikost je preverjena),
`e2e-fotomontaza-full.ts` **55/55** (vseh sedem korakov, vključno s pravim downloadom PNG na disk),
`e2e-fotomontaza-real.ts` **53/53** (pravi fotki 04.jpg + 16.jpg, napaka merjena proti GT —
zažene se SAMO z argumentom fotokorpusa, ker fotk ni v repozitoriju),
`e2e-span-rule-ui.ts` **50/50** (Task 80/81/82: tabela mej brez profila, citirana meja po profilu,
133 cm pri prečni postavitvi, opozorilo nad mejo, OHRANJENA monterjeva aritmetika in dokaz, da
izmišljenega razhajanja 150/180 ni več v živem vmesniku; od preizkusa 43 naprej še reža —
pas 0,5–3 cm z vejico in virom, ista objava pod profiloma 100 in 128, javljen ODSOTEN podatek
pri 57-32 in NIKAKŠNA številka reže, ko profil ni izbran; posnetek `span-rule-ui.png` preverjen
po velikosti NA DISKU, zapisnik pa gre skozi `guardOutSideRepo`, ki ZAVRŽE zapis v repozitorij;
zaganja se z `APP_URL=…`, če :3000 drži tuji proces),
`e2e-terasa-input-ui.ts` **36/36** (Task 83: v živem brskalniku dokazuje, da vnosa nihče več ne
popravlja — privzeto 0,33 m, citiran ROKSALov pas 33–35 cm, `max` odstranjen, vseh sedem vnosov z
`aria-label`; 1,2 m se izračuna TOČNO (15 lm / 5 kosov, stari usek na 0,6 m bi dal 24 lm), a je
označen PREŠIROKO in je še vedno ponudben; 8 m se ZAVRNE z »Izračun ni opravljen«, imenuje vpisanih
8 m, izprazni postavke in gumb »Dodaj v ponudbo«, vnosa ne popravi in isto zaustavitev javi tudi v
načrtu montaže; vrnitev na 0,33 m da POVEČ ISTO vsoto; 12 mm reže ostane 12 mm; 0 €/m ostane 0,00 €;
−3 €/m je zavrnjen po imenu; posnetek `terasa-input-ui.png` preverjen po velikosti na disku),
`e2e-ograje-input-ui.ts` **42/42** (Task 84: ograje v živem brskalniku — DOM meja `min={0.9}` je
izginila, namig pod poljem vzame ISTE robove kot resolver; 0,5 m se izračuna in v OPISU POSTAVKE
piše 0,5 m, ne 0,9 m, kontrola pa je pošteno označena in pravi, da predpisa aplikacija ne more
preveriti; 5 m in 300 prehodov se ZAVRNETA, postavke, gumb in tudi norma za trajanje montaže
izginejo, vpisana številka pa ostane na zaslonu; vrnitev na 1,1 m da POVEČ ISTO vsoto; 7,2 man-ur
je zapisana z vejico; oba posnetka — sprejeta 0,5 m in zavrnjen 5 m — preverjena po velikosti NA
DISKU),
`e2e-craft-inputs-ui.ts` **79/79** (Task 85: tri dejavnosti v živem brskalniku. Stopnice — DOM
meje `min={0.6}` in `max` sta iz polja izginila, namig pod poljem nosi ISTE robove kot resolver;
0,45 m se izračuna dobesedno (postavka pravi »Širina 0,45 m«, kartica povzetka prav tako, vsota
pa se SPREMENI — mera torej res soči račun, ne samo zaslona; v `craft-inputs-all` je zaklenjeno,
da antidrseči profili vedno znašajo št. stopnic × VPISANA širina, pri 0,45 / 0,6 / 1,35 m);
0,3 m je ZAVRNETO z
»Širina stopnic 0,3 m je premalo za izračun (0,3 < 0,4); sprejemamo 0,4–3 m«, postavke, gumb in
norma za trajanje izginejo, vpisana številka pa ostane na zaslonu, načrt montaže javi ISTO
zaustavitev; samodejni predlog 15 stopnic iz 260 cm je pri ceni in normi ISTI, karta pravila 2R +
G pa našteje zahtevani razpon globine in ne laže o udobju. Fasade — 120 m² odprtin na 100,8 m²
stene je zavrnjeno z IZRAČUNANO mejo (120 > 100,8); pri plavajočem robu 17 × 2,35 = 39,9499… in
39,95 m² izračun NE javi napake in ničlo izpiše kot »0 m²«, ne »−0 m²«, 39,96 m² pa že zavrne.
Keramika — vpisanih 50 % rezerve ostane 50 % (»Skupaj z rezervo 18 m²«; stari usek na 30 % bi
zaračunal 15,6 m²), 101 % je zavrnjen po imenu polja. Vsak krog nazaj na privzeto vrednost da
POVEČ ISTO vsoto; trije posnetki (sprejeta 0,45 m, zavrnitev, fasada) preverjeni po velikosti NA
DISKU),
`e2e-colmap-cdp.ts` 36/36,
`e2e-typed-number-ui.ts` **92/92** (Tasks 86–87: VSAJA številčna polja so besedilo z
`inputMode="decimal"` in nobeno nima DOM meje — potrjeno s skenom DOM-a na nastavitvah, v
kalkulatorju in v urejevalniku. Nastavitve: vpisani 33,7 % akontacije PREŽIVI pot do strežnika in
povratno nalaganje zaslona (to je tisti popravek, ki ga je ujel brskalnik: `{ ...settings }` je
namesto osnutka pošiljal STARO vrednost, a odgovor je bil »shranjeno ✓«); 150 in »abc« sta
ZAVRNJENA s stavkom, ki imenuje VPISANO vrednost, ostala polja se vseeno shranijo (`Delno
shranjeno`), izpraznjeno polje pa reče »številka ni vpisana« in NE reče »0 %«. Kalkulator:
izpraznjena višina ustavi račun (`Izračun ni opravljen`) in odstrani postavke, gumb in normo
trajanja; 12,5 m se izračuna (vsota raste v razmerju 12,5/6 z toleranco 2 %); tipkana `6.5`
OSTANE `6.5` v polju, izpis postavlke pa je `6,5 m`. Urejevalnik: ročna cena `0,75` zniža vsoto,
»abc« jo zavrne in zapre dodajanje v ponudbo; izpraznjena količina pokaže »—« in zapre shranjevanje
ponudbe, število ponudb v bazi se NE spremeni; `2 × 13,50 €` je `27,00 €`. Konzola brez napak,
šest posnetkov preverjenih po velikosti NA DISKU),
`e2e-eslog-cdp.ts` **43/43** (Task 86: e-račun v živem brskalniku — DDV 407,88 € in skupaj 2.261,88 €
iz ZIP XML-ja, zajetega prek pravega prenosa, račun brez davčne stopnje pa je pošteno zavrnjen s
409; ta skript je na tem računalniku doslej NIKOLI tekel).

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
ujeta pri palačinki `URL.createObjectURL` in preverjena pikselsko
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
tests/            # verify/ (51 skript), gt/ (sonde + zamrznjeni izpisi), e2e-*.png, e2e-*.ts (CDP), make-* orodja
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
- **Številke, ki jih ROKSAL ne objavlja, a vplivajo na rezultat (odprto po Task 84):**
  enotne cene materiala so pogodba z dobaviteljem in so zato samo preverjene proti
  negativnosti; spodnje/zgornje meje drsnikov v vizualizaciji; računski razpored stebrov
  dopušča 60–300 cm; „maks. 3 m za običajno kritino«; pragovi 5/7/10°; odstotki kapare.
  **Od Task 84 naprej v istem kupu:** tihi useki, ki so jih prenesle še preostalih pet
  dejavnosti (`Math.max(0.6, širina stopnic)`, `Math.max(1, cena ploščic)` in
  `Math.min(30, rezerva)`, `Math.max(0.5, velikost okna)`, `Math.max(2, št. stebrov nadstreška)`,
  neto površina fasade) — mehanizem je zdaj skupen, zato je za vsak naslednji kalkulator treba
  napisati samo register meja; ter decimalne PIKE v opisih cen ostalih dejavnosti (ograje in
  norma zdaj pišeta z vejico, ostale dejavnosti še ne). Nobena od teh številk še nima
  preverljive podlage in je še vedno v kodi kot samoumevna — to je naslednji kup del, ne ta.
  **Iz te liste je izpadla** trditev o zakonski najmanjši višini ograje ≥ 1,0 m: Task 84 jo je
  preimenoval v »priporočilo iz prakse, ne citiran predpis« in načrt zdaj eksplicitno pravi, da
  lokalne zahteve preveriti ne more (`src/lib/install-plan.ts`).
- Trditve o ROKSALovih mejah in režah so zdaj vezane na objavljene citate
  (`src/lib/roksal-span-rules.ts`); kjer objave ni, UI reče »ROKSAL tega ne objavlja« in
  pokaže samo vrednost, jasno označeno kot računski privzetek (`realCm` je tak privzetek).
- COLMAP-WASM raziskava je odprta (lokalna SfM v brskalniku).

---

*Notranji projekt. Vsi logotipi in blagovne znamke pripadajo lastnikom;
ROKSAL gradiva so uporabljena z navedbo vira (roksal.com) in so neoverjena
zaslonska reprodukcija.*
