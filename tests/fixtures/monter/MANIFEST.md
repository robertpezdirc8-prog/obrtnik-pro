# Fotografije od monterjev → ostrí tile-i

V ta mapo spusti **posnetke bližnjih fotografij vgrajenih ROKSAL ograj**
(npr. fotografije iz skupine »Ograje Lozar«): ena deska mora zapolniti dovolj
piksljev, da je vzorec oster.

Za vsako datoteko dodaj vrstico v `manifest.json` (format):

```json
[
  { "file": "balakon-amazon.jpg", "colour": "Amazon wood", "profile": "polna-100", "boardWidthCm": 10 }
]
```

- `colour` mora biti **uradno ime odtenka** (Amazon wood, Ash wood, Golden teak,
  Burma teak, Oak wood, White, Rustic oak, Rustic walnut),
- `profile` je družina profila (`polna-100`, `polna-128`, `romb-67`, `kubo-80-42`, `terasna-150`),
- `boardWidthCm` je **realna širina deske v cm** (za POLNA-100 je 10 cm).

Nato zaženi:

```bash
bun tests/make-monter-tiles.ts
```

Skript sam poišče desko v fotografiji (temna šprinja med deskami → korak v
pikslih), odreže natanko eno desko in jo shrani kot tile 256 × 256 z
**pravim merilom** (`realCm` = realna širina deske) v
`public/roksal/ograje/<profil>/mont-<odtenek>.png`.
