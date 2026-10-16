# `tests/gt/` — meritve dvotapnega predloga na ročno prebranem ground truthu

Ta mapa ni zbirka testov. Je **dokazno gradivo za odločitve v
`src/lib/band-suggest.ts`**: pet sond, ki na pravih fotkah izmerijo, kolikšno
napako ima samodejni predlog namestitvenega pasu, in katere variante so bile
zaradi te mere zavrnjene.

## Zakaj sond ni v sweepu `tests/verify/`

Sonde berejo **fotke, ki jih ni v repozitoriju**. Na njih so tuje hiše, vrtovi
in napisi na hišah; ali se smejo objaviti, se odloči lastnik fotk (monter), ne
koda. Zato:

- `gt-quads.ts` nosi **samo koordinate in opise** (10 primerov, 5 v obsegu),
  ne slik;
- sonde pot do fotk vzamejo iz argumenta ali iz `ROKSAL_GT_PHOTOS`;
- **brez fotek sonda PROPASE** (izhodna koda 2) — ne izpiše ničesar in ne
  nadaljuje z delno mero. To je pravilo, ki smo ga 2026-10-16 plačali z lažnim
  zelenim izhodom: manjkajoč dokaz je napaka, ne tiha ničla.

Zato v sweepu sonde ne tečejo. Njihov izpis je kot zamrznjen dokaz v `outputs/`,
integriteto tistega dokaza pa preverja `tests/verify/gt-evidence.ts` — skript,
ki fotk ne rabi. Same sonde ne požene, preveri pa, da izpisi obstajajo, da se
ujajo s številkami, ki jih navajajo dokumenti, in da jih nobena roka ni
skrajšala.

## Zagon

```
bun tests/gt/probe-band-module.ts     <mapa-s-fotkami> 256
bun tests/gt/probe-per-side-rail.ts   <mapa-s-fotkami> 256
bun tests/gt/probe-stop-rule.ts       <mapa-s-fotkami> 256
bun tests/gt/probe-rail-visibility.ts <mapa-s-fotkami> 256
bun tests/gt/probe-resolution.ts      <mapa-s-fotkami>
```

## Kaj posamezna sonda dokaže

| sonda | vprašanje | izmerjeni odgovor |
| --- | --- | --- |
| 1 `probe-band-module` | kolikšna je napaka produkcijskega modula in kje | mediana **2,3 %** višine slike, max 10,1 %, 5 najdenih / 5 zavrnjenih; prag 0,85 je izmerjen optimum (0,80 in 0,90 sta slabša, toleranca ±3 px poslabša na 16,2 %) |
| 2 `probe-per-side-rail` | ali trapež (ločeni tirnici na levem in desnem robu) premaga pravokotnik | **NE**: mediana 3,3 % proti 2,3 %; pravi GT rob v ozkem bočnem oknu sploh ne preseže podpore (0,55 / 0,77 / 0,71) |
| 3 `probe-stop-rule` | ali je krivo pravilo ustavljanja (prvi zadetek) | **NE**: zunanji zadetek 8,0 % / max 24,3 % s hudo napako, najboljša podpora 4,6 % / max 24,3 % — oba padeta na max. Kontrola: drugačna implementacija V0 vrne enake tirnice kot produkcija v **10/10** |
| 4 `probe-rail-visibility` | ali je pravi rob v robnem zemljevidu sploh ločljiv | **Pogosto ne**: GT rob preseže prag pri ±2 px v 8/10 tirnic, a izbrana napačna vrstica ima pri ±2 px več podpore v 4/10; z razliko > 0,02 GT zmaga samo v 2/10 |
| 5 `probe-resolution` | ali je ožja delovna ločljivost kompromis | **256 px je izmerjeni optimum**: 192 → 5,5 %, 256 → 2,3 %, 320 → 3,0 %, 384 → 6,5 %, 512 → 13,2 % |

## Kaj je skupni sklep

Napake predloga **ni več zmanjšati z izbirnimi pravili** (prag, okno,
ustavljanje, oblika, ločljivost). Štiri hipoteze so izmerjene in padle;
4. sonda pokaže zakaj: notranja črta panela je v Sobelovem zemljevidu pri
večini fotk *bolj robata* od dejanskega roba ploskve. Naslednji korak v
natančnosti bi bil drug robni zemljevid (barvni/svetlobni prehod, ne Sobelov
piksel), kar je nova odvisnost in nov risk — ne pametnejše iskanje po istem
zemljevidu.

Zato predlog ostane **samo predlog** (`planeConfirmed: false` → stopnja
`SUGGESTED`, izris zaprt, dokler človek ne potrdi). Monterjev poseg pri
dvotapnem predlogu ni nujen, je pa poceni: mediana 2,3 % je pri 150 cm višine
približno 3,5 cm, kar za pas ni usodno, potrditi ga ali povleči oglišče pa
traja sekundo.

## Kaj ta mapa NE dokaže

- Nobena številka tu ni izmerjena proti ROKSAL katalogu (kataloga višin
  nimamo).
- GT kvadrate je razvrstil agent, ne Robert, in so vizualno prebrani iz fotk;
  zato je `why` pri vsakem primeru obvezen — brez njega se ponovi napaka iz
  2026-10-16, ko je bil GT narisana čez fasado namesto čez ograjo.
- 10 primerov je majhen vzorec. Mediane se ne sme navajati kot obljuba
  pričakovane natančnosti pri strankah, samo kot razlog za izbrane pragove.
- Izpisi v `outputs/` so zamrznjeni, ne paživi. Če se `src/lib/cv-engine.ts`
  ali `band-suggest.ts` spremeni, mora sondo ponovno pognati človek s fotkami;
  `gt-evidence.ts` spremembe števk ne more preveriti brez korpusa.
