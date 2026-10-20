# Protokol za preverjanje meril v terenu

Cilj: dokazati, da so **meritve v aplikaciji pravilne** — in to z meritvijo,
ki jih narediš sam z metrom. Brez tega je vsak izpis le trditev.

## 1. Kaj je izmerjeno in kaj je izračunano
| Izraz | Izvor | Preverljivo z metrom? |
|---|---|---|
| širina in višina ravnine (cm) | **tvoj vnos** (umerjeno) | ✅ neposredno |
| cm na piksel | iz tvojega vnosa + štirikotnika | ✅ posredno |
| lege stebrov (cm od začetka) | izračun iz ravnine in razmaka | ✅ z metrom po ograji |
| dolžine rezov | izračun (deska + spoj na stebru) | ✅ z metrom pri rezanju |
| število desk in odpad | izračun | ✅ tehtanje/preverjanje |
| profil, barva, spoj | **izbiraš sam** | — |

Pomembno: **AI in samodejna detekcija v meritvah ne sodelujeta.** Kamera
predlaga le nepovezano pomoč (razpoznan material, orientacijo, predlog družine);
vsaka številka v listu izvira iz tvojega izmerjenega vnosa in geometrije.

## 2. Postopek za vsako novo fotko
1. **Poslikaj tako, da je v kadru vrata (2,00 m) ali okno (1,20 m)**, po
   možnosti tudi metrov trak. Brez merljivega objekta samodejno merilo kamere
   ni uporabno — in aplikacija te zato tako tudi vpraša.
2. V aplikaciji: označi ravnino (štirikotnik) in **vpiši dejansko izmerjeno
   širino v cm**.
3. Preveri, ali se strinjata:
   - **izpis v E2E** (`MERILNI IZPIS: ravnina … × … cm`) in
   - **samodejni predlog kamere** (`tools/meritve-audit.ts`).
4. Zapiši izmerjeno v `tests/fixtures/meritve-gt.json` (oblika je v datoteki).

## 3. Samodejno preverjanje merila (dve neodvisni metodi)
```bash
bun tools/meritve-audit.ts tests/fixtures/meritve-gt.json-slika.jpg
```
Skript izpiše:
- **metoda A (kamera)** — predlog merila iz vrat/okna (px/cm),
- **metoda B (deska)** — korak med deskami ograje ÷ širina profila (px/cm),
- **odstopanje** med njima in oceno: do 8 % = merilo se ujema, nad 20 % =
  merilo ni zanesljivo in je treba meriti z metrom.

POZOR: metoda B vzame najširši korak v sliki — to je lahko druga konstrukcija
(npr. bela »latica«), zato je njena vrednost le orientacijska.

## 3b. Dokaz na sintetični resnici (avtomatsko, brez metra)
`tests/make-sinteticna-ograva.ts` nariše fotko z **znano geometrijo**
(ravnina 350 × 100 cm, profili POLNA-100, stebri na 0/150/300 cm, vrata 200 cm
kot referenčni objekt), `tests/e2e-meritve-sintetika.ts` pa klikne znana
oglišča, vpiše 350 × 100 cm in primerja izid z analitično resnico:

| Izid aplikacije | Pričakovano (resnica) | Napaka |
|---|---|---|
| 4 stebri | 4 (0/150/300 + rob) | **0** |
| 3 celote | 3 | **0** |
| 28 desk (spoj na stebru) | 28 | **0** |
| 28 m desk | 28 m | **0** |
| 6 nabavnih kosov (rez 100 cm, profil 580 cm) | 6 | **0** |
| 680 cm odpada | 680 cm | **0** |

To dokazuje, da je **geometrija (homografija, štetje desk, spoj na stebru,
rezalni načrt) matematično pravilna** — napaka je 0,0 %. Preostalo odstopanje
v terenu je zato izključno **vnosu** (napačno izmerjena širina) in
označevanju oglišč.

## 4. Meja, ki jo smemo pričakovati
| Vir napake | Tipično odstopanje |
|---|---|
| ročno označeni štirikotnik (±5 px na 800 px slike) | ±1 % |
| vpisana širina (zaokrožena na cm) | ±0,5 % |
| perspektiva (homografija) | ravnina: ±1–2 % |
| neznana višina ograje, ocena | do ±5 % |

**Sprejemljivo:** do 3 % za ravninske ograje, do 5 % za nagnjene/terenske.
**Nesprejemljivo:** več, saj pomeni, da je vnesena širina napačna.

## 5. Kaj preveriti v aplikaciji po meritvi
- lege stebrov: prvo stebro ~0 cm, zadnje ~ širina ograje,
- spoj: deska se ne sme končati na sredini polja,
- dolžina reza ≈ višina ograje (manj 1 cm za zaj),
- odpad: realen odpad je 5–15 % (pri dobrem razrezu manj).

## 6. Kje so izhodi
- `tests/fixtures/meritve-gt.json` — tvoj zapis (obliko določa prvi vnos),
- `tests/e2e-real-photo.ts` — E2E izpiše `MERILNI IZPIS`,
- `tools/meritve-audit.ts` — primerjava dveh metod,
- `src/lib/photo-install-sheet.ts` — čisti izračun (brez AI, brez mreže).
