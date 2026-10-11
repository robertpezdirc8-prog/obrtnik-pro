# Worklog — Obrtnik Pro

---

Task ID: 1
Agent: main (Z.ai Code)
Task: Zgraditi MVP 1 aplikacije "Obrtnik Pro" — digitalni pomočnik obrtnika za balkonske ograje, stopnice, keramiko, WPC terase, okna/vrata, nadstreške in fasade (kalkulatorji odmerka + katalog + PDF ponudbe). Referenca poslovnega modela: Hover (hover.to).

Work Log:
- Analiziral referenčni repo robertpezdirc8-prog/monter3d (Mera3D Pro) v /tmp/monter3d-analysis — ugotovitve: dobra konstrukcijska logika, pokvarjena fotogrametrija, monolit, IndexedDB-only. Ideje reciklirane, arhitektura zavrnjena.
- Predlagal pozicioniranje "Od fotke do podpisanega naročila" (MVP 1: katalog + 7 kalkulatorjev + PDF ponudba). Uporabnik odobril ("odlično zacni").
- Ustvaril Prisma shemo: Category, Product, Offer, OfferItem, Settings (SQLite, db/custom.db) — `bun run db:push` uspešen.
- Napisal idempotenten seed (src/lib/seed.ts): 7 kategorij, ~50 izdelkov z realističnimi slovenskimi cenami; auto-seed ob prvem API klicu.
- Izračunski pogon (src/lib/pricing.ts): čiste funkcije za 7 dejavnosti (ograje/stopnice/keramika/WPC/okna-vrata/nadstreški/fasada) — stebri na 1,5 m, rezerva rezanja, lepilo 4 kg/m², nosilci na 0,4 m, preklopi kritine, neto m² minus odprtine. Numerično verificirano v brskalniku.
- API rute: GET /api/catalog, GET+PUT /api/settings, GET+POST /api/offers, GET+PATCH+DELETE /api/offers/[id]. Številčenje ponudb LETO-NNN server-side, vsote računa server.
- Zustand store z persist: osnutek ponudbe (items + stranka) preživi reload.
- UI (Tailwind 4 + shadcn/ui, topla jantar/stone tema, brez modro-indigo): app-shell z sticky header + scroll-nav + sticky footer (min-h-screen flex + mt-auto), dashboard (hero, statistika, kartice dejavnosti, zadnje ponudbe), 7 kalkulatorjev z živim izračunom + urejanjem cen pred dodajanjem, urejevalnik ponudbe (urejanje količin/enot/cen, DDV), seznam ponudb (status, PDF, brisanje z AlertDialog), katalog (harmonikon, + v osnutek), nastavitve podjetja.
- PDF izvoz: print-okno z profesionalno postavitvijo (glava podjetja, stranka, tabela postavk, DDV, podpisi, IBAN) — src/lib/pdf.ts.
- Agent-browser verifikacija zlate poti: kalkulator ograje (6,5 m) → dodaj 4 postavke (1.476 €) → reload (persist ✓) → urejevalnik → stranka Ana Kovač → shrani → ponudba 2026-001 (1.800,72 € z DDV) ✓; PDF okno se odpre z dokumentom ✓; keramika matematika točna (12+35 m², 51,7 m² z rezervo, 8 vrečk lepila) ✓; mobilni viewport 390×844 in footer sticky (900=900=900) ✓; konzola brez napak ✓; lint čist ✓.
- Popravljen bug: "Odpri ponudbo"/"Nadaljuj z osnutkom" ni počistil activeCraft (urejevalnik se ni odprl).
- AI slike kategorij: vztrajno 429 rate-limit — vgrajen fallback (gradient + emoji) deluje elegantno.

Stage Summary:
- MVP 1 je funkcionalen in brskalno verificiran: 7 kalkulatorjev, katalog (~50 izdelkov), ponudbe z PDF izvozom, nastavitve podjetja, SQLite/Prisma backend.
- Ključni artefakti: prisma/schema.prisma, src/lib/{pricing,seed,types,store,format,pdf,crafts-meta}.ts, src/components/{app-shell,dashboard,calculators-view,offer-editor,offers-list,catalog-view,settings-view,craft-image}.tsx, src/components/calculators/{shared,crafts}.tsx, src/app/api/{catalog,settings,offers}/.
- Demo stanje: testna ponudba 2026-001 (Ana Kovač, 1.800,72 €) ostaja v bazi kot prikaz delovanja; brisljiva prek UI.
- Odprto za naslednjo fazo: AI slike kategorij (rate-limit), laserski merilnik / AR zajem (MVP 2), strankinski portal (MVP 4), trije čekirani додатни kalkulator parametri.
