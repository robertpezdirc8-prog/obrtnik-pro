# Poročilo o okrevanju specifikacije iz GitLab issue-jev (Task ID: 39)

> Datum: 2026-10-13 · Agent: general-purpose (GitLab spec recovery)
> POMEMBNO: Ta dokument JE ISKREN zapis. Specifikacijskih issue-jev NI BLO MOGOČE PRIDOBITI.
> Nobeno besedilo faz ni izmišljeno ali parafrazirano.

## 1. Povzetek

Pričakovani specifikacijski issue-ji (#3 »Field Capture 2.0«, #4, #6 »Original ROKSAL Product
Asset Library«, #7, #8, #9, #10, #14 »FOTOZAMENJAVA BREZ AI« ter issue »ROKSAL Measurement
Reliability & Classical 3D« s fazami Faza 0–8) **NE obstajajo** v nobenem projektu na
gitlab.com, do katerega ima dostop podani osebni žeton (personal access token).

Zato **besedila Faza 5, 6, 7 in 8 NI BLO MOGOČE PRIDOBITI v izvirniku** — glej
`SPEC-B-PHASES-5-8.md` (eksplicitno označeno »NI PRIDOBLJENO«; brez izmišljenega besedila).

## 2. Dokazni postopek (vsi koraki preverjeni prek API v4, gitlab.com)

1. **Žeton veljaven** — `GET /api/v4/user` → uporabnik `robertpezdirc8` (id 43141577,
   »Robert Pezdirc«, stanje `active`). (Vsaka zahteva je poslana z brskalniškim
   User-Agent, saj gitlab.com brez njega vrača HTTP 403 »Blocked«; tudi z njim je bilo
   treba več poskusov ponoviti.)
2. **Projekti članstva** — `GET /api/v4/projects?membership=true&per_page=50` → natanko 5 projektov:

   | Projekt ID | Pot | Opomba |
   |---|---|---|
   | 87573786 | `robertpezdirc8/restaurantos` | osebni, 0 issue-jev |
   | 87474527 | `markec-group1/roksal-railing-manager` | »Roksal Railing Manager — odpovedniški sistem za ograje (mirror)«, 0 issue-jev |
   | 87464605 | `markec-group1/discover-slovenia-ai` | 0 issue-jev |
   | 87462760 | `markec-group1/muzej` | 0 issue-jev |
   | 87360791 | `markec-group1/markec-project` | 0 issue-jev |

3. **Skupina** — `markec-group1` (id 144207225, ustvarjena 2026-10-07); člani: natanko 1
   (`robertpezdirc8`, nivo 50/Owner); brez podskupin; brez arhiviranih projektov.
4. **Statistika issue-jev** — `GET /api/v4/projects/<ID>/issues_statistics` za vse 4 skupinske
   projekte + restaurantos: povsod `{"all": 0, "closed": 0, "opened": 0}`.
5. **Seznam issue-jev** — `GET /api/v4/projects/<ID>/issues?per_page=50&order_by=created_at`
   (+ `scope=all`): povsod prazen seznam (shranjeno v `/tmp/gl-issues.json` in
   `/tmp/gl-issues-<ID>.json`; vsebina: `[]`).
6. **Neposredni dostopi** — `GET /api/v4/projects/<ID>/issues/3` in `.../issues/14` za vseh 5
   projektov: povsod **HTTP 404** (issue ne obstaja). Enako `GET .../issues/3/notes` → 404.
7. **Globalno iskanje** — `GET /api/v4/issues?scope=created_by_me` → 0;
   `?author_id=43141577&scope=all` → 0; `?search=ROKSAL` → 0;
   `GET /api/v4/search?scope=issues&search=Faza` → 0 relevantnih (samo javni projekt tretje osebe).
   (Globalni `/issues` endpoint je ob prvih poskusih vračal tudi HTTP 500 — ponovljeno do 200.)
8. **Dogodki projekta** — `GET /api/v4/projects/87474527/events` → edini dogodek je
   `created | Project` (2026-10-10); nobenega dogodka `opened | Issue`. Tudi ostali projekti:
   samo push/MR dogodki, nobenih issue dogodkov.
9. **GitHub preverjanje** (dvojni pregled, saj je `origin` GitHub zrcalo): repozitorij
   `robertpezdirc8-prog/obrtnik-pro` ima `has_issues: true`, vendar **0 issue-jev**
   (`state=all` → prazno); `robertpezdirc8-prog/monter3d` ima 4 issue-je, a so nepovezani
   (niso specifikacije Obrtnik Pro / ROKSAL).

## 3. Tabela vseh dostopnih issue-jev (popolna, brez izpuščanja)

| # | Stanje | Naslov |
|---|---|---|
| — | — | (prazno — v dostopnih projektih ni nobenega issue-ja, odprtega ali zaprtega) |

## 4. Sklepi

- Issue-jev #3, #4, #6, #7, #8, #9, #10, #14 ter »ROKSAL Measurement Reliability &
  Classical 3D« **ni bilo mogoče najti** (ne v dostopnih projektih, ne globalno).
- Verjetni razlogi (nešpekulativno, dejstva): issue-ji so bodisi v projektu/napačnem
  GitLab-strežniku, do katerega žeton NIMA dostopa, bodisi so bili izbrisani, bodisi so na
  drugem računu. Projekt `markec-group1/roksal-railing-manager` je zrcalo, ustvarjeno
  2026-10-10, in je brez issue-jev.
- **Faza 0–4** so po `docs/MEASUREMENT-BASELINE.md` in `worklog.md` implementirane (Taski
  36-a/36-b/36-c, 37-a/37-b/37-c, 38) — to je edini vir stanja faz, ki je trenutno na voljo.
- **Faza 5–8: izvirno besedilo ni dosegljivo.** Za nadaljevanje je potrebno bodisi
  (a) žeton z dostopom do pravega projekta z issue-ji, (b) pravi naslov projekta/GitLab
  instance, ali (c) uvoz issue-jev v dostopen projekt.
- Žeton ni bil zapisan v nobeno datoteko v tem repozitoriju.
