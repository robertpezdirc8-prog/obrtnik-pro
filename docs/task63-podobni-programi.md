# Task 63 — Raziskava podobnih programov (stanka direktiva: „raziskuj po spletu forume podobne programe kaj se izboljsamo dodamo")

Datum: 2026-10-15 · Metoda: z-ai web_search (6 poizvedb: EN/DE/SI) + page_reader (2 poglobljena vira).
Kontekst: Obrtnik Pro = deterministična (0 AI) aplikacija za obrtnike s kamero, meritvami in fotomontažo ROKSAL.

## 1. Kdo je konkurenca na področju fotomontaže ograj/teras

| Orodje | Pristop | Cena | Vir |
|---|---|---|---|
| OutdoorBrite | AI generiranje iz fotke + opis | od 29 $/mesec, brez brezplačnega paketa | outdoorbrite.com/blog/best-free-fence-design-apps |
| Betafence Fence Simulator | **NE-AI**: riše realne Betafence izdelke na uporabnikovo fotko | brezplačno | betafence.com/en/fence-configurator-tool |
| Simpson Strong-Tie Fence Planner | 2D/3D načrt ograje **z bremenskim seznamom (BOM)** | brezplačno (samo namizni brskalnik) | isti pregled |
| iScape | ročno odlaganje ograje/rastlinstva na fotko + AR | brezplačen paket; Pro 29,99 $/mesec | isti pregled |
| SketchUp Free / Planner5D | natančno modeliranje / merjen tloris | brezplačna raven | isti pregled |
| DreamzAR | AR predogled v realnem merilu (iPhone) | brezplačna orodja + plačljiv AR | isti pregled |
| PaperPlan Deck Visualizer | AI koncept deke iz fotke | **19 $ ENKRATNO** za 3 koncepte + 2 popravka, brez naročnine | paperplan.app/deck-visualizer |
| genroom.io / dehome.ai / deroomai / archybase / westcoastfencepros | vsi AI generativni | različne naročnine | web_search |

**Ugotovitev:** trg je preplavljen AI generativnimi orodji (naročnine); le Betafence deli našo deterministično filozofijo (blagovna znamka ↔ realni izdelki na fotki). **Naša diferenciacija je nedotaknjena:** pravi profili s pravimi merami iz kalibracije, 0 AI, iskrene oznake, brez naročnin.

## 2. Kaj se uporabnikom pritožuje (forumi — najvrednejši nasveti)

- Reddit r/landscaping (nit o AI krajinskem orodju): **„Glavni problem vseh teh 3D orodij je, da nikoli ne upoštevajo pravih razmakov, pozicioniranja in mer."** — TOČNO to je naše jedro (kalibrirana homografija → cm/px → pravi razmaki/mera desk). Zunanja potrditev smeri.
- Yahoo/Reddit o AI krajinskih aplikacijah: „rezultati izgledajo lažno, dajo pa dobre ideje" — deterministična upodobitev + žig „VIZUALIZACIJA ZA PREDSTAVITEV" rešita obe pritožbi (realizem brez laži).
- Merilne aplikacije (ImageMeter, My Measures, CamToPlan …): „ni natančno … ne deluje v temi/nizki svetlobi" — naš vodič po zajemu s kontrolo svetlobe + iskrene ravni zaupanja (visoka/srednja/nizka) sta že odgovor.
- PaperPlan sam iskreno opozarja (potrjuje naša načela): „barva/žira na zaslonu nista zanesljivi — primerjajte fizikalne vzorce pred naročilom" (= naš `unverified` + blokiran izvoz „original"); „AI lahko spremeni detajle scenarija in nariše nepraktične stopnice/proporte" (= naš determinizem); „izvajalec vseeno potrebuje preverjene mere" (= meritve so del istega orodja).

## 3. Slovenski trg

Ponudbapro, Moj Račun, e-racuni.com, Čebelca BIZ, NeoBiz, Račun123 — vsi **samo ponudbe/računi/FURS**; **noben** nima merjenja po fotki ali vizualizacije. V SI trgu je Obrtnik Pro edinstven: kamera + meritve + fotomontaža + poslovanje v enem. FURS davčno potrjevanje (Moj Račun) je vrzel, ampak zahteva digitalna potrdila in registrirane naprave — **ne smiselno** za lokalno aplikacijo (0 plačljivih storitev, brez obveznih zunanjih integracij); eSLOG je že pokrit v nastavitvah.

## 4. Nemški trg Aufmaß/Handwerker

- Primerjalni članek 2026: magicplan, Moasure, Photo Measures, Polycam, RoomScan Pro (merjenje po fotki/AR/3D sken) — trg obstaja in je plačljiv.
- angebotfix.de: diktiranje mer → AI ustvari pozicije za ponudbo (12,90 €/mesec). Mi: determinističen glasovni vnos + samodejni prefill — ista vrednost, 0 AI.
- Skupno sporočilo trga: „Schluss mit Doppelerfassung" (brez dvojnega vnosa: mera → pozicija → ponudba samodejno). Naš prefill kalkulatorja že to dela.

## 5. KONKRETNI KANDIDATI za izboljšave/dodajanje (razvrščeno, z utemeljitvijo)

1. **Kosovnica iz fotomontaže (BOM)** — iz shranjene različice fotomontaže (profil, razmak, število desk/stebrov je ŽE izračunan v `computePlankLayouts`) en klik „Dodaj material v ponudbo": deske N×, stebri, pritrdilni material. Vzorec iz konkurence: Simpson Strong-Tie (BOM je ključna funkcija #2 na trgu). Uporablja obstoječe funkcije; ni novega cevovoda. **Najvišja vrednost / najmanjše tveganje.**
2. **Pred/po par izvoza za stranko** — PaperPlan prodaja „before/after za pogovor z družino"; pri nas pred/po drsnik obstaja, izvoz pa je posamezen PNG. Majhen dodatek: izvoz obeh slik v enem koraku. Nizka vrednost, zelo majhno delo — opcionalno.
3. **Povezava izmerjene obstoječe deske → izbor profila** — analiza že izmeri obstoječo desko (npr. 14 cm); predlagaj najbližji uradni profil (TERASNA 150×25 / DEKA 140 …). Majhno, deterministično, poveže dva obstoječa sklopa.
4. **NE:** FURS integracija (zunanja obvezna storitev/potrdila — proti načelom), **NE:** AI generativni načini (proti jedru), **NE:** naročnine (notranja aplikacija).

## 6. Viri (vsi dostopani 2026-10-15)

- web_search: „fence visualizer app photo replace fence style", „deck visualizer design tool photo upload backyard forum", „reddit fence visualizer software landscape design app complaints inaccurate", „Handwerker Software Angebot erstellen Foto aufnehmen Massen App", „programska oprema za obrtnike ponudbe računi Slovenija aplikacija", „measure from photo app construction ar measure review accuracy"
- page_reader: outdoorbrite.com/blog/best-free-fence-design-apps (23.472 znakov HTML), paperplan.app/deck-visualizer (6.658 znakov)
- Reddit: r/landscaping niti 15ohomj / 152yjf1 / 1ol4o11 (izseki); Yahoo Lifestyle 2025-09-24; apps.apple.com Fence Genius
