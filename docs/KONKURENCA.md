# Kaj imajo drugi boljše — raziskava in predlog prioritet

Preveril sem konkurenco v treh skupinah: (1) vizualizerji ograj in teras,
(2) orodja za merjenje na terenu, (3) generativna »fotomontaža«. Vir: javne
strani orodij (stanje preverjeno 19. 10. 2026).

## 1. Vizualizerji ograj in teras

### MAKOver / FencePro.ai — »Fence Visualizer« (brez prijave, zastonj v brskalniku)
Tok: **naloži fotko → označi RAVNO ČRTO (kjer bo spodnji rob ograje) →
nastavi »5 ft Scale« → izberi material → Photoreal → prenesi PNG**.
- **Prednosti pred nami:** 2 koraka namesto 6 (njihova »linija + dolžina« proti
  našim 4 ogliščem + širina + višina); takojna slika; brez prijave; zastonj.
- **Naše prednosti:** oni ne merijo ničesar (njihova »Scale« je ročno v
  čevljih, brez izračuna dolžin, brez kosovnice, brez montažnega lista, brez
  uradnih ROKSAL podatkov). Njihov render je generativen in zato izmišlja
  detaje.

### PaperPlan »Deck Visualizer« (19 USD za 3 koncepte)
- Iz iste fotografije naredi **AI-koncept**, primerja materiale in smeri, priloži
  **before/after** primerjavo, projekt ostane zaseben.
- Njihova lastna opomba je zlata: *»AI-generated illustration, not a customer
  project or measured plan«* in *»a builder still needs verified measurements
  before estimating quantities«* — **točno naša pozicija**: mi merimo, oni
  vizualizirajo.
- Njihova opozorila so tudi lekcija: *»use physical manufacturer samples at
  your home before choosing a product to order«* in *»AI can change scene
  details«*.

### Ostali (za kontekst)
- **Roomagen, DeckView, Vivid AI, Collov** — generativni vizualizerji; prodajajo
  »videz«, ne meritve.
- **Magicplan / Polycam / HoloBuilder / Fieldwire / PlanGrid** — merilne in
  projektne platforme: LiDAR-skening prostora, oblaki, ekipe, termini, poročila.
  Močnejši so v **projektni administraciji**, slabši v materialni resnici.

## 2. Kaj imamo boljše (to naj ostane)
| Naša prednost | Zakaj je težko posnemati |
|---|---|
| Meritve so **izračunane iz geometrije**, ne generirane | konkurentna orodja meritev sploh ne delajo |
| **Uradni ROKSAL podatki**: imena barv, reference, meje stebrov, linija profilov | konkurent uporablja generične produkte in stock slike |
| **Montažni list + ponudba + sporočilo monterju** iz istega izračuna | vizualizerji se ustavijo na sliki |
| **Brez računa, brez oblaka, deterministično** | SaaS orodja zahtevajo račun in pošiljajo sliko v oblak |

## 3. Predlogi — po vrednosti in naporu

### P1 — »Ena poteza«: hitra kalibracija (napor: srednji, vrednost: zelo velika)
Danes: 4 oglišča + širina + višina (6 vnosov). Konkurent: 2 točki + dolžina.
**Predlog:** način »en črt«: označi dve točki spodnjega roba ograje + vpiši
njuno dolžino v cm + višino; aplikacija sestavi štirikotnik in izračuna
ostalo. **Pogoji:** hitri način mora jasno pokazati večjo negotovost (±), ker
predpostavlja navpično ravnino, in ponuditi »natanko meri« za preklop.
Uporabnik: monter na lestvi, ena roka.

### P2 — Dvotočkovna kalibracija (napor: srednji, vrednost: velika)
Meri **levo in desno celoto** → popravek perspektive (trapezoid) → manjša
negotovost kot pri eni širini. To je najboljše izboljšanje natančnosti, ker
naš model negotovosti (±5 px klikništva) pravi, kdaj je vnos premalo
zanesljiv. Predlog: polje »dve meri« v koraku 2, širina se izračuna iz obeh.

### P3 — »Referenca ROKSAL«: galerija vgrajenih ograj po barvi (napor: majhen, vrednost: velika)
Ob izbiri barve pokaže **referenčno fotografijo iste barve v vgrajeni ograji**
(uradni posnetki, ki jih že imamo v `public/roksal/`). Konkurent uporablja
generične slike; ROKSAL ima prave. Zadošča 2–3 posnetki na barvo.

### P4 — Povezave za stranko: deljena stran za ponudbo (napor: srednji, vrednost: srednja)
PaperPlan prodaja *»share with a partner, homeowner or builder«*. Imamo PDF in
PNG, ni pa **povezave** (npr. `/ponudba/<id>` z javnim, časovno omejenim
pogledom) — stranka bi odprla predlog na telefonu.

### P5 — Rezalni načrt, pripravljen za žago (napor: majhen, vrednost: velika)
Danes: kosovnica (število + dolžine). Manjka **označitev vsake deske**
(»deska 7: 128 cm, 2. celota«) in skupaj po dolžinah za razrez — neposreden
prihranek časa v delavnici, brez AI.

### P6 — AI-fotomontaža kot DRUGI pogled (napor: obstaja, vrednost: srednja)
AI pot je že narejen in je brez ključa izklopljen. Predlog: **dva izpisa
sočasno** — deterministični (»izmerjeno«) in AI (»videz«), z oznakama.
Konkurent prodaja AI-videz, mi prodajamo resnico; oboje skupaj je močnejše.

## 4. Priporočilo (vrstni red)
1. **P5** (rezalni načrt z označbami) — najmanjši napor, neposredna vrednost.
2. **P2** (dve meri → manjša negotovost) — največji dvig natančnosti, kar je
   bistvo tvojega vprašanja o meritvah.
3. **P3** (referenca barve) — prodajni argument, majhen napor.
4. **P1** (ena poteza) — največje olajšanje za monterja, a spreminja
   kalibracijski tok; zato po mojem mnenju šele po P2.

P6 odločim, ko poveš, ali naj bo AI v izdelku sploh — sam ga držim
izklopljenega, ker brezplačni model ni dober, plačljiv pa ni tvoj.
