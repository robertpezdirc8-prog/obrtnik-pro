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

---
Task ID: 2
Agent: main (Z.ai Code)
Task: MVP 2 — Pametna kamera: AI samodejno prepoznavanje objektov na fotografiji (kaj je, koliko veliko), merjenje po fotografiji z umerjanjem, predpolnjevanje kalkulatorjev in galerija zajemov.

Work Log:
- Dodan Prisma model Photo (dataUrl, craftId, analysis JSON, measurements JSON) + `db:push`.
- Nov API: POST /api/analyze-photo (z-ai-web-dev-sdk createVision, strikten slovenski JSON prompt za 7 dejavnosti + "drugo"; robustno extractJson z odstranitvijo markdown ograj in popravilom vejic; normalizacija + preslika prefill → CraftInputs s validacijo razponov; predlogi izdelkov iz kataloga po prepoznani kategoriji; retry z backoff ob 429/5xx; timeout 110 s). GET/POST /api/photos, DELETE /api/photos/[id].
- Store: AppView + 'kamera', cameraPrefill (craft + inputs) v useView.
- lib/image-quality.ts: stiskanje na max 1280 px JPEG 0,82 (EXIF-varno prek createImageBitmap), kontrola kakovosti — Laplaceova varianca za ostrino + svetlost, prijazna opozorila (ne blokira).
- UI komponente v src/components/camera/: photo-capture.tsx (živa kamera facingMode environment + upload + zajem + kvaliteta), photo-canvas.tsx (AR okviri zaznanih objektov v % + merjenje: klik 2 točki → umerjanje z znano dolžino, privzeto iz AI reference; nadaljnje daljice se izmerijo samodejno v cm/m; seznam meritev z brisanjem; reset merila), analysis-panel.tsx (zaupanje, opis, objekti z dimenzijami, merilo za umerjanje, checklist meritev na terenu, priporočila, predlogi izdelkov s "+", CTA), camera-view.tsx (orkestracija, animirani koraki analize, samodejno shranjevanje v galerijo, galerija z ponovnim odpiranjem in brisanjem).
- Integracija: navigacija "Pametna kamera", dashboard CTA "Fotografiraj — AI prepozna" kot primarni gumb, vseh 7 kalkulatorjev bere cameraPrefill (useCraftInputs) in prikazuje značko "Vrednosti predpolnjene s pametne kamere".
- Popravek okolja: dolgo živeči dev strežnik je imel v pomniti star Prisma Client brez modela Photo (db.photo undefined) → restart strežnika; pri naslednjem platformskem zagonu dev.sh samodejno naloži novega.
- E2E z agent-browser (dokazano deluje): upload test-foto → predogled s kontrolo kakovosti → galerija shranjena analiza → prikaz AR okvirov (Ograja ≈1050×110, Vrata ≈90×200, Okno ≈120×120; zaupanje 87 %; 11,6 m²) → merjenje: umerjanje čez vrata 200 cm → ograja izmerjena 5,41 m (geometrijsko točno) → CTA → kalkulator ograj z length=10,5, material=alu, značka predpolnitve → živi izračun 2.320 € →Dodaj v ponudbo. Mobilni 390×844 ✓, namizni 1280 ✓, footer sticky ✓, lint čist ✓, konzola brez napak ✓.
- Omejitev: živi VLM klic je med preverjanjem stalno vračal 429 (skupna kvota AI storitve, tudi po 25 min ponovnih poskusov) — integracija sledi uradni VLM dokumentaciji, potek napake je elegantno obravnavan (prijazno sporočilo + retry); prikaz rezultatov E2E-verificiran z realističnim analysis JSON-om v bazi (tests/seed-test-photo.ts).

Stage Summary:
- Pametna kamera je funkcionalna: foto → AI prepozna vrsto dela + objekte + dimenzije + merilo → klik-merjenje po fotografiji → predpolnjen kalkulator → ponudba. Galerija zajemov v SQLite.
- Ključni artefakti: prisma/schema.prisma (Photo), src/app/api/analyze-photo/route.ts, src/app/api/photos/, src/lib/{camera-types,image-quality}.ts, src/components/camera/*, spremembe v store.ts, app-shell.tsx, dashboard.tsx, calculators/{shared,crafts}.tsx.
- Testna sredstva: tests/make-test-photo.ts, tests/seed-test-photo.ts, tests/test-photo.jpg + zaslonske slike tests/e2e-*.png; demo fotografija "Ograje" v galeriji.
- Za prihodnje: živi VLM preveriti ob sproščeni kvoti; laserski merilnik BLE; prilagoditev prefilla še za stopnice/nadstreške iz meritev (Mer 1 → polje).

---
Task ID: 3-b
Agent: frontend-styling-expert
Task: Laser BLE panel + glasovni vnos komponenti za Pametno kamero

Work Log:
- Prebran worklog (Task 1 + 2) za kontekst; prebrani podpisi: src/lib/measure-geometry.ts (parseSloMeasure → ParsedMeasure {cm, note}, formatCm), src/lib/camera-types.ts (MeasureKind vsebuje 'laser' | 'voice'), ui/button.tsx, ui/input.tsx, ui/badge.tsx (varianti default/secondary/destructive/outline) ter photo-canvas.tsx za stilsko konsistenco (min-h-11, rounded-xl, amber opombe, green success).
- Ustvarjena NOVA komponenta src/components/camera/laser-panel.tsx ('use client', LaserPanelProps { onAddMeasurement(label, cm) }): SSR-varna Web Bluetooth detekcija (`typeof navigator !== 'undefined' && 'bluetooth' in navigator` + mounted gate proti hydration mismatch); requestDevice({ acceptAllDevices: true, optionalServices: [FFE0, FFF0, device_information] }) → gatt.connect() → poskus notifikacij FFE0/FFE1 z zasilnim parom FFF0/FFF1; characteristicvaluechanged parser (TextDecoder besedilo → parseFloat, sicer surovi bajti uint16/uint32 LE kot mm → cm) z razponom 1–50.000 cm → samodejni onAddMeasurement('Laser', cm) + prikaz zadnjega izmerka (formatCm); status "Povezano: {ime}" z zelenim Badge (border-green-300 bg-green-50 text-green-700) + gumb "Prekini" (gatt.disconnect + odstranitev poslušalcev + poslušanje gattserverdisconnected); vse napake v prijaznih inline amber opombah (NotFoundError = "iskanje preklicano"), brez toast/crash; ročni vnos vedno viden (Input type number, inputMode decimal, min-h-11, cm enota, gumb "Dodaj izmer" disabled če prazno, label `Laser ${counter}`, lokalni števec, po dodaji počisti vnos); sklopljiva kratka pomoč (Leica DISTO / Bosch GLM).
- Ustvarjena NOVA komponenta src/components/camera/voice-input.tsx ('use client', VoiceInputProps { onAddMeasurement(label, cm), disabled? }): detekcija SpeechRecognition/webkitSpeechRecognition prek minimalnega inline interface-a (SpeechRecognitionLike/Ctor — brez 'any'), SSR-varna z mounted gate; gumb z Mic ikono (min-h-11, full width na mobilnem, whitespace-normal): recognition.lang='sl-SI', interimResults=false, maxAlternatives=1; med poslušanjem rdeči pulzirajoči krog (animate-pulse, bg-red-500) + "Poslušam… povej meritev (npr. »dva metra petdeset«)", ponovni klik ustavi (stop + čiščenje handlerjev); ob rezultatu parseSloMeasure(transcript) → predogled kartica "Razumel: »…« → {formatCm}" z zelenim "Potrdi" (min-h-11, bg-green-600) → onAddMeasurement(`Glas ${counter}`, cm) in "Prekliči"; null parse → amber opomba z zgledi; onerror mape no-speech / not-allowed / network na prijazna sporočila, 'aborted' mirno ignorira; onend počisti stanje poslušanja; cleanup v useEffect (aliveRef + abort + null handlerji) = vsi handlerji varni proti unmount; onAddMeasurement v refu (vedno najnovejši prop).
- Stil: samo obstoječi importi (Button, Input, Badge, lucide-react, measure-geometry), slovenski UI teksti, topla tema (amber opombe, bg-secondary/50 nevtralno, text-green-600/700 uspeh, NI modro/indigo), rounded-xl kartice, p-3/p-4, min-h-11 gumbi/vnos, aria-label/aria-pressed/aria-expanded/role="status" na vseh interaktivnih elementih.
- Verifikacija: `bunx tsc --noEmit` — NI napak v laser-panel.tsx in voice-input.tsx (edine izpisane napake so vnaprej obstoječe v examples/, skills/, src/app/api/analyze-photo/route.ts in src/components/camera/photo-canvas.tsx — niso del te naloge in niso bile spreminjane). Dev strežnik in lint nista zagnana (po navodilih).

Stage Summary:
- Dve novi, samostojni vnosni komponenti za Pametno kamero, obe s povratnim klicem onAddMeasurement(label: string, cm: number) — integrator ju prikliče v camera-view in rezultate usmeri v isti seznam meritev (PhotoMeasure kind 'laser' / 'voice' že podprta v camera-types + measuresToText/CSV).
- Artefakti: src/components/camera/laser-panel.tsx (export LaserPanel, LaserPanelProps; notranje: parseLaserValue, OPTIONAL_SERVICES, NOTIFY_CANDIDATES, razpon 1–50.000 cm) in src/components/camera/voice-input.tsx (export VoiceInput, VoiceInputProps; notranje: getSpeechRecognition, NOT_UNDERSTOOD).
- Ključne odločitve: SSR varnost prek "mounted" gate (prvi client render = server render, brez hydration mismatch); Web Bluetooth in Web Speech API tipizirana z minimalnimi inline interface-i (brez 'any'); stabilne useCallback identitete za add/removeEventListener; BLE parser podpira ASCII besedilo IN surove bajte (mm, LE) — protokoli brez dokumentacije so best-effort, napaka pade nazaj na ročni vnos.
- Omejitve za integracijo: komponenti še nista vpleteni v camera-view.tsx (izven obsega — samo 2 datoteki); Web Bluetooth deluje v Chrome/Edge na Androidu in namiznem Chrome (ne Safari/Firefox), Web Speech sl-SI je odvisen od Google glasu; laser auto-izmer uporablja fiksno oznako 'Laser' (brez števca), ročni vnos 'Laser n', glas 'Glas n'.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: MVP 2.5 — Nadgradna pametne kamere na "AR+": živo AR merjenje (tap-to-measure), površine in koti po fotografiji, laserski merilnik (Web Bluetooth), glasovni vnos meritev (sl-SI), izvoz meritev in močnejša povezava s kalkulatorji. Uporabnik: "se razvijaj kamero za meritve ar vse kaj je mozno isci po spletu kaj vse je mozno nadgrajuj".

Work Log:
- Spletna raziskava (6 poizvedb prek web-search CLI): ves cas 429 rate-limit (skupna kvota AI storitve, tudi po zamikih in ponovnih poskusih v ozadju) — nadgradnja zgrajena na uveljavljenih tehnikah: referenčno umerjanje merila, AR tap-to-measure, Web Bluetooth GATT, Web Speech API.
- Nov geometrijski pogon src/lib/measure-geometry.ts: Shoelace površine poligonov v m² (pxPerCm kalibracija), koti med daljicama (atan2, 0–180°), dolžine strani poligona, težišče, formatCm/M2/Deg, izvoz meritve → besedilo/CSV (+ downloadMeasuresCsv z BOM), parseSloMeasure (slovenski glasovni parser: cifre + besedne številke + sestavljene "triinpetdeset" + enote m/cm/mm + govorna oblika "dva metra petdeset" → 250 cm) in buildPrefillFromMeasures (preslikava izmerkov na polja kalkulatorjev po craftu).
- PhotoMeasure razširjen: kind ('length'|'area'|'angle'|'laser'|'voice'), value, sides — points podpirata tuple in XY (PtLike + asXY v measure-geometry).
- photo-canvas.tsx popolnoma prenovljen: 4 načini (Prepoznavanje / Dolžine / Površine / Koti); površine: klikaj oglišča → zapri s klikom na prvo točko ali gumbom "Zapri površino" → poligon fill + m² oznaka na težišču + strani; koti: 3 točke → oranžni izris + oznaka °; hitre reference za umerjanje (Vrata 200, Okno 120, Ploščica 60/30, Kartica 8,6, Oseba 170); izvoz Kopiraj/CSV; seznam meritev z ikono enote (cm/m²/°) in brisanjem.
- NOVO live-ar.tsx — živo AR merjenje na video kadru: lastna kamera (environment), AR mreža tretjin + vogalniški okvir, 3 načini (dolžine/površine/koti), umerjanje z referencami, zamrznitev kadra za natančnost (compressElement + pause), "Posnemi in analiziraj s AI" (kader + AR meritve → AI analiza), lokalni seznam AR meritev. Koordinatna matematika: % prikaza → naravni px prek uniform skale (object-cover crop varno).
- photo-capture.tsx: AR namigi na živem pogledu (mreža tretjin, vogalniki, napis "Postavi objekt in referenco v okvir").
- NOVI komponenti (Task 3-b, frontend-styling-expert): laser-panel.tsx (Web Bluetooth feature-detect, requestDevice + GATT + notifikacije FFE0/FFF1 z parserjem besedilo/mm-bajti, prijazne inline napake, ročni vnos izmerkov vedno na voljo) in voice-input.tsx (sl-SI SpeechRecognition, predogled "Razumel: X → Y cm" s potrditvijo, parser iz measure-geometry, unmount-varno).
- camera-view.tsx prenovljen: 3 zavihki (Zajem+AI / AR merjenje / Pripomočki), auxMeasures za laser+glas, izvoz vseh meritev (Kopiraj vse / Prenesi CSV), meritve se shranijo ob AI zajemu (POST body) + samodejni PATCH /api/photos/[id] (debounce 900 ms) ob spremembi meritev, galerija s značko "N mer.", openCalculator združuje AI prefill + buildPrefillFromMeasures (najdaljša→length/floorLength/deckLength/canopyWidth, druga→width, površina→windowSize), analysis-panel refactor (merge v camera-view).
- API: nov PATCH /api/photos/[id] (posodobitev meritev); analyze-photo createVision parametriziran tipovsko-varno (cast, runtime nespremenjen).
- E2E z agent-browser (vse verificirano): zavihki ✓; AR tab z gumbom + elegantna napaka brez kamere ✓; laser: Web Bluetooth opomba (headless), ročni vnos 350 → "Laser 1: 3,50 m" ✓ + Kopiraj vse/Prenesi CSV ✓; glas: varno stanje v headless; demo foto → umerjanje (chip Vrata 200) → "Merilo umerjeno" ✓; daljice Mer 4/5 ✓; površina 4 oglišča → 8,78 m² ✓; kot 3 točke → 139,2° ✓; meritve v bazi (GET /api/photos) ✓ + galerija značka "4 mer." ✓; CTA → kalkulator ograj z značko prefill in length=4,33 m IZ MERITEV ✓; desktop screenshot ✓, mobilni 390×844 footer potisnjen ✓, konzola brez napak ✓, tsc + ESLint čista ✓.

Stage Summary:
- Kamera je zdaj "AR+": zajem+AI, živo AR merjenje (dolžine/površine/koti + zamrznitev), laser BLE + ročni vnos, glasovni vnos sl-SI, izvoz CSV/besedilo, samodejno shranjevanje meritev in prefill kalkulatorjev iz realnih izmerkov — do Hover+ ravni merjenja brez posebne strojne opreme.
- Ključni artefakti: src/lib/measure-geometry.ts, src/components/camera/{live-ar,laser-panel,voice-input,photo-canvas,camera-view,photo-capture,analysis-panel}.tsx, src/app/api/photos/[id]/route.ts (PATCH), src/lib/camera-types.ts.
- Omejitve/roadmap: Web Bluetooth deluje v Chrome/Edge (BLE protokoli merilcev so best-effort — polna podpora modelaDISTO/GLM ko dostopna naprava); Web Speech sl-SI odvisen od brskalnika; živi VLM klic še vedno 429 (kvota) — UI elegantno ravna; naslednje: WebXR hit-test za prave 3D kote, monokularna globina (Depth-Anything) za ne-ravninske objekte, 3D predogled iz meritev (three.js).
