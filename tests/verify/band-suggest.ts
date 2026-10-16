// Verifikacija samodejnega predloga namestitvenega pasu (FAZA-9).
//
// Temelji na izmerjenih dejstvih z 24 pravih fotek Ograje Lozar:
//   1. Zgornji/spodnji rob ploskve sta v robnem zemljevidu resnična črta →
//      iskanje ju najde. Levi/desni rob NISTA rob predmeta → ju modul ne išče.
//   2. Modul se NE more sam potrditi → na fotkah izven obsega samozavestno
//      trdi napačno. Zato je izhod VEDNO predlog, nikoli dokaz.
//
// Testi so na NAMENSKO ZGRAJENIH robnih zemljevidih (Uint8Array), brez
// sharpa in brez fotk, da so odločilni in ponovljivi povsod.
// Zagon: bun tests/verify/band-suggest.ts
import { suggestBandQuadPct, suggestBand, bandToQuad, BAND_LIMITS, type BandLimits } from '../../src/lib/band-suggest';
import { calibratePlane } from '../../src/lib/homography';

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};

/** Robni zemljevid z vodoravnimi črtami na danih y-jih. */
const mapWithRows = (W: number, H: number, rows: number[]): Uint8Array => {
  const e = new Uint8Array(W * H);
  for (const y of rows) {
    if (y < 0 || y >= H) continue;
    for (let x = 0; x < W; x++) e[y * W + x] = 1;
  }
  return e;
};

/** Robni zemljevid z nagnjeno črto: y = y0 + slope·x. */
const mapWithSlope = (W: number, H: number, y0: number, slope: number, thickness = 1): Uint8Array => {
  const e = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    const y = Math.round(y0 + slope * x);
    for (let t = 0; t < thickness; t++) if (y + t >= 0 && y + t < H) e[(y + t) * W + x] = 1;
  }
  return e;
};

const LIM: BandLimits = { ...BAND_LIMITS };

console.log('Predlog namestitvenega pasu (band-suggest) — deterministično, brez AI\n');

// ── 1) Osnovni primer: dve tirnici, tapka na sredini ──────────────
console.log('Osnovni primer (256×128, tirnici na y=20 in y=100, tapka na 60):');
{
  const W = 256;
  const H = 128;
  const edge = mapWithRows(W, H, [20, 100]);
  const b = suggestBand({ edge, W, H }, { x: 128, y: 60 }, 60, LIM);
  check('najden pas', !!b);
  if (b) {
    check(`zgornja tirnica na y=20 (dobijeno ${b.top.y})`, b.top.y === 20);
    check(`spodnja tirnica na y=100 (dobijeno ${b.bottom.y})`, b.bottom.y === 100);
    check(`podpora zgornje = 1 (dobijeno ${b.top.support.toFixed(2)})`, b.top.support > 0.99);
    check(`višina pasu = 80 (dobijeno ${b.heightPx})`, b.heightPx === 80);
    check('podpora obeh tirnic je veljaven delež (0..1)', b.top.support >= 0 && b.top.support <= 1 && b.bottom.support >= 0 && b.bottom.support <= 1);
    check('iskani polovični pas = podani 60 px', b.halfWidth === 60, `dobijeno ${b.halfWidth}`);
  }
}

// ── 2) ZNANA OMEJITEV, izmerjena na pravi fotki ───────────────────
// Na fb-hi/04.jpg je tapka 11 % višine pod zgornjim robom, vmes je spoj med
// lamelama. Iskanje ustavi na spoju in NE na robu (napaka +9,9 % višine).
// To ni napaka kode, to je meja pristopa — zato je predlog vedno človek.
console.log('\nZnana omejitev: notranji spoj med lamelama je močnejši od roba:');
{
  const W = 256;
  const H = 128;
  // pravi rob na 20, notranji spoj na 46, rob na 100; tapka na 60
  const edge = mapWithRows(W, H, [20, 46, 100]);
  const b = suggestBand({ edge, W, H }, { x: 128, y: 60 }, 60, LIM);
  check('pas najden', !!b);
  if (b) {
    check(`zgoraj se ustavi na SPOJU 46 in ne na robu 20 (dokazano obnašanje)`, b.top.y === 46, `dobijeno ${b.top.y}`);
    check('spodaj najde pravi rob 100', b.bottom.y === 100);
  }
}

// ── 3) Iskanje se ustavi na meji dosega ───────────────────────────
console.log('\nDoseg iskanja (maxSearchFrac):');
{
  const W = 256;
  const H = 128;
  const maxSteps = Math.round(H * LIM.maxSearchFrac);
  const justInside = 64 - maxSteps + 2;
  const justOutside = 64 - maxSteps - 4;
  const bIn = suggestBand({ edge: mapWithRows(W, H, [justInside, 90]), W, H }, { x: 128, y: 64 }, 60, LIM);
  check(`črtica znotraj dosega (y=${justInside}) je najdena`, !!bIn && bIn.top.y === justInside);
  const bOut = suggestBand({ edge: mapWithRows(W, H, [justOutside, 90]), W, H }, { x: 128, y: 64 }, 60, LIM);
  check(`črtica zunaj dosega (y=${justOutside}) ni najdena → null`, bOut === null, bOut ? `dobijeno y=${bOut.top.y}` : '');
}

// ── 4) Zavrnitve: kadar modul NE VE ───────────────────────────────
console.log('\nZavrnitev (null = "ne vem", UI ostane pri ročnem vnosu):');
{
  const W = 256;
  const H = 128;
  check('prazen zemljevid → null', suggestBand({ edge: new Uint8Array(W * H), W, H }, { x: 128, y: 64 }, 60, LIM) === null);
  check('samo ena tirnica → null', suggestBand({ edge: mapWithRows(W, H, [20]), W, H }, { x: 128, y: 64 }, 60, LIM) === null);
  check('tapka izven slike → null', suggestBand({ edge: mapWithRows(W, H, [20, 100]), W, H }, { x: 128, y: -5 }, 60, LIM) === null);
  check('tapka NaN → null', suggestBand({ edge: mapWithRows(W, H, [20, 100]), W, H }, { x: NaN, y: 60 }, 60, LIM) === null);
  check('delovna slika premajhna → null', suggestBand({ edge: new Uint8Array(4 * 4), W: 4, H: 4 }, { x: 2, y: 2 }, 1, LIM) === null);
  // preozek pas: tirnici 2 px narazen pod minBandHeightFrac
  const thin = suggestBand({ edge: mapWithRows(W, H, [62, 65]), W, H }, { x: 128, y: 63 }, 60, LIM);
  check(`preozek pas (3 px od pričakovanih ≥ ${(H * LIM.minBandHeightFrac).toFixed(0)} px) → null`, thin === null, thin ? `heightPx=${thin.heightPx}` : '');
  // šum: posamezne piksli ne smejo delati tirnice
  const noisy = new Uint8Array(W * H);
  for (let x = 0; x < W; x += 7) noisy[30 * W + x] = 1;
  for (let x = 3; x < W; x += 7) noisy[90 * W + x] = 1;
  const nb = suggestBand({ edge: noisy, W, H }, { x: 128, y: 60 }, 60, LIM);
  check('redki piksli (pod pragom podpore) ne ustvarijo tirnice → null', nb === null, nb ? `dobijeno ${nb.top.y}/${nb.bottom.y}` : '');
}

// ── 5) NAKLONA modul NE OCENJUJE (izmerjena odločitev) ───────────
// Meritev na korpusu (baseline/probe-band-module.ts): tri različice ocene
// nagiba so POLOŽAJ poslabšale (mediana napake 5,1–6,4 % višine slike proti
// 2,3 % brez ocene), ker se napačno pripeti nagib ekstrapolira do oglišča —
// enkrat celo z napačnim predznakom (GT +1,2° → napoved −2,5°). Modul zato
// nagiba NE trdi: pas je vodoraven, nagib doda monter z ogliščem.
console.log('\nNaklon se ne ocenjuje (noben izhod ne trdi nagnjene tirnice):');
{
  const W = 256;
  const H = 128;
  // Močno nagnjeni črti (6°) čez celotno iskalno okno: vodoravno iskanje je
  // NE more prečkati (12,6 px razlike čez 120 px pri toleranci ±2). Pravilen
  // izhod je null — NE izmislena nagnjena črta.
  const slope = Math.tan((6 * Math.PI) / 180);
  const top = mapWithSlope(W, H, 20 - slope * (W / 2), slope);
  const bot = mapWithSlope(W, H, 100 - slope * (W / 2), slope);
  const merged = new Uint8Array(W * H);
  for (let i = 0; i < merged.length; i++) merged[i] = top[i] | bot[i];
  const wide = suggestBand({ edge: merged, W, H }, { x: W / 2, y: 60 }, 60, LIM);
  check('močno nagnjena tirnica čez širok pas → null (ne izmišljen naklon)', wide === null, wide ? `dobijeno ${wide.top.y}/${wide.bottom.y}` : '');
  // Ozek pas → rob je najden, tirnica pa je NAPovedana VODORAVNO. To je
  // zavestna odločitev: monter vidi položaj, ki drži, ne nagiba, ki ne drži.
  const narrow = suggestBand({ edge: merged, W, H }, { x: W / 2, y: 60 }, 20, LIM);
  check('ozek pas je najden (rob obstaja)', narrow !== null);
  if (narrow) {
    const q = bandToQuad(narrow, 40, 216, W);
    check('predlog nima naklona: obe zgornji oglišči na istem y', q[0][1] === q[1][1], `${q[0][1]} vs ${q[1][1]}`);
    check('predlog nima naklona: obe spodnji oglišči na istem y', q[2][1] === q[3][1]);
    check('tirnica ne nosi polja za nagib', !('tiltDeg' in narrow.top), JSON.stringify(Object.keys(narrow.top)));
  }
}

// ── 6) bandToQuad ─────────────────────────────────────────────────
console.log('\npas → štirikotnik (vhod za obstoječo homografijo):');
{
  const W = 256;
  const H = 128;
  const b = suggestBand({ edge: mapWithRows(W, H, [20, 100]), W, H }, { x: 128, y: 60 }, 60, LIM);
  if (!b) check('pas za kvadrant je najden', false);
  else {
    const q = bandToQuad(b, 30, 220, W);
    check('oglišč je 4', q.length === 4);
    const [zl, zd, sd, sl] = q;
    check('vrstni red ZL, ZD, SD, SL (x narašča, nato pada)', zl[0] === 30 && zd[0] === 220 && sd[0] === 220 && sl[0] === 30);
    check('zgornja y = 20 na obeh zgornjih ogliščih', zl[1] === 20 && zd[1] === 20);
    check('spodnja y = 100 na obeh spodnjih ogliščih', sd[1] === 100 && sl[1] === 100);
    check('pravokotnik, ne paralelogram (višina enaka na obeh straneh)', sd[1] - zl[1] === sl[1] - zd[1]);
    const zamenjan = bandToQuad(b, 220, 30, W);
    check('zamenjana x (desna→leva) da ISTI štirikotnik', JSON.stringify(zamenjan) === JSON.stringify(q));
    const prestopljena = bandToQuad(b, -500, 9999, W);
    check(
      'x izven slike se omeji na [0, W−1]',
      prestopljena[0][0] === 0 && prestopljena[1][0] === W - 1,
      JSON.stringify(prestopljena.map((p) => p[0])),
    );
    // Kvad MORA biti veljaven vhod za obstoječo homografijo: pozitivna
    // ploščina in štiri različne točke, sicer calibratePlane zavrne.
    const area = Math.abs(
      (zl[0] * zd[1] - zd[0] * zl[1] + (zd[0] * sd[1] - sd[0] * zd[1]) + (sd[0] * sl[1] - sl[0] * sd[1]) + (sl[0] * zl[1] - zl[0] * sl[1])) / 2,
    );
    check('oglišči data pozitivno ploščino (homografija jo sprejme)', area > 0, `ploscina=${area}`);
  }
}

// ── 7) Determinizem ───────────────────────────────────────────────
console.log('\nDeterminizem (enak vhod → identičen izhod):');
{
  const W = 256;
  const H = 128;
  const edge = mapWithRows(W, H, [18, 44, 101]);
  const a = suggestBand({ edge, W, H }, { x: 100, y: 62 }, 50, LIM);
  const bb = suggestBand({ edge, W, H }, { x: 100, y: 62 }, 50, LIM);
  check('dva zaporedna klica data identičen JSON', JSON.stringify(a) === JSON.stringify(bb));
  const c = suggestBand({ edge: edge.slice(), W, H }, { x: 100, y: 62 }, 50, LIM);
  check('kopija zemljevida da identičen rezultat', JSON.stringify(a) === JSON.stringify(c));
}

// ── 8) Mutacije: dokaz, da testi sploh kaj preverjajo ────────────
console.log('\nMutacijski preizkusi (pragovi morajo biti odločilni):');
{
  const W = 256;
  const H = 128;
  const edge = mapWithRows(W, H, [20, 100]);
  const strict: BandLimits = { ...LIM, minSupport: 1.5 };
  check('minSupport > 1 → nic ni več najdenega (prag je dejansko v uporabi)', suggestBand({ edge, W, H }, { x: 128, y: 60 }, 60, strict) === null);
  const wide: BandLimits = { ...LIM, minBandHeightFrac: 0.99 };
  check('minBandHeightFrac=0,99 → pas 80 px je zavrnjen (varovalo je dejansko v uporabi)', suggestBand({ edge, W, H }, { x: 128, y: 60 }, 60, wide) === null);
  const noTol: BandLimits = { ...LIM, edgeTolerancePx: 0 };
  // Črti, narisani na vsakem tretjem stolpcu: z toleranco ±2 px je črta
  // vidna povsod, brez tolerance je vsak tretji vzorec slep → podpora pade
  // na ~1/3 in modul mora zavrniti. Dokaže, da tolerance dejansko nekaj stane.
  const sparseRows = (rows: number[]): Uint8Array => {
    const e = new Uint8Array(W * H);
    for (const y of rows) for (let x = 0; x < W; x += 3) e[y * W + x] = 1;
    return e;
  };
  check('edgeTolerancePx=0 na redki črti → zavrnjen (toleranca je odločilna)', suggestBand({ edge: sparseRows([20, 100]), W, H }, { x: 128, y: 60 }, 60, noTol) === null);
  check('ista redka črta z privzeto toleranco → najdena', suggestBand({ edge: sparseRows([20, 100]), W, H }, { x: 128, y: 60 }, 60, LIM) !== null);
  const narrow = suggestBand({ edge: mapWithRows(W, H, [20, 100]), W, H }, { x: 128, y: 60 }, 2, LIM);
  check('ozek iskalni pas (halfWidth=2) je še vedno podprt', narrow !== null);
  const noSearch: BandLimits = { ...LIM, maxSearchFrac: 0 };
  check('maxSearchFrac=0 → noben korak iskanja → null (parameter je v uporabi)', suggestBand({ edge: mapWithRows(W, H, [20, 100]), W, H }, { x: 128, y: 60 }, 60, noSearch) === null);
}

// ── 9) Celotna pot za UI: odstotki noter, odstotki ven ──────────
// Enotni vmesnik, ki ga sme uporabljati komponenta. Monter tapne dvakrat,
// komponenta NE pozna delovne ločljivosti — če bi jo, bi se tapke izgubile ob
// vsaki spremembi maxSide. Zato ta blok preverja jenost enot, ne le geometrije.
console.log('\nsuggestBandQuadPct (dvotapni vhod v odstotkih → kvad v odstotkih):');
{
  // Sintetična "ograja": dve svetli letvi na temnem ozadju.
  const W = 160;
  const H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const on = (y >= 15 && y <= 22) || (y >= 60 && y <= 67);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = on ? 235 : 12;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const img = { width: W, height: H, data };
  const A = { xPct: 20, yPct: 42 };
  const B = { xPct: 80, yPct: 44 };
  const r = suggestBandQuadPct(img, A, B);
  check('slika + dve tapki znotraj ploskve → predlog kvadrata', r !== null, r ? '' : 'null (roba ni najdena v sintetični sliki)');
  if (r) {
    check('oglišč je 4', r.quadPct.length === 4);
    const inRange = r.quadPct.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100);
    check('vsa oglišča so znotraj [0,100] % (delovna ločljivost ni utekla ven)', inRange, JSON.stringify(r.quadPct));
    check('zgornji par je nad spodnjim parom', r.quadPct[0][1] < r.quadPct[2][1] && r.quadPct[1][1] < r.quadPct[3][1]);
    check('oba zgornja oglišča na istem y (predlog nima izmišljenega nagiba)', r.quadPct[0][1] === r.quadPct[1][1]);
    const swapped = suggestBandQuadPct(img, B, A);
    check('zamenjan vrstni red tapk da ISTI kvad', swapped !== null && JSON.stringify(swapped.quadPct) === JSON.stringify(r.quadPct));
    const again = suggestBandQuadPct(img, A, B);
    check('dva klica data identičen JSON', !!again && JSON.stringify(again.quadPct) === JSON.stringify(r.quadPct));
    // Kvad MORA prenesti obstoječo homografijo — sicer je predlog neuporaben.
    const plane = calibratePlane(r.quadPct.map(([x, y]) => ({ x, y })), 200, 100, { w: W, h: H });
    check('calibratePlane predlog sprejme (200×100 cm)', plane !== null);
    // POKRITOST, ne ploscina: robova pasu morata stati NA robovih svetlih
    // letvi (15–22 in 60–67 v slikovnih pikslih = procentih, H=100). Trditev o
    // "100 cm" bi bila krožna — kalibracija kvad vedno preslika v točno
    // 200×100, torej ne pove nicesar o tem, kje detektor zagrne roba.
    check(`zgornji rob v območju stika zgornje letvi (22–24 %, dobijeno ${r.quadPct[0][1].toFixed(1)})`, r.quadPct[0][1] >= 20 && r.quadPct[0][1] <= 26);
    check(`spodnji rob v območju zgornjega roba spodnje letvi (58–60 %, dobijeno ${r.quadPct[2][1].toFixed(1)})`, r.quadPct[2][1] >= 55 && r.quadPct[2][1] <= 62);
    check('levo/desno oglišče sta na tapkah, ki ju je monter dal', r.quadPct[0][0] === 20 && r.quadPct[1][0] === 80);
  }
  check('tapka izven slike (>100 %) → null', suggestBandQuadPct(img, { xPct: 20, yPct: 42 }, { xPct: 140, yPct: 44 }) === null);
  check('tapka z NaN → null', suggestBandQuadPct(img, { xPct: NaN, yPct: 42 }, B) === null);
  check('tapki nad ograjo (izven ploskve) → null, ne izmišljen kvad', suggestBandQuadPct(img, { xPct: 20, yPct: 2 }, { xPct: 80, yPct: 3 }) === null);
}

console.log(`\n${pass}/${pass + fail} preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);process.exit(fail === 0 ? 0 : 1);
