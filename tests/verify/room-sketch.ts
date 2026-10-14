// Numerična verifikacija room-sketch (bun, brez brskalnika) — Faza: skica prostora
// Znana resnica: kvadrat/pravokotnik/L-prostor/trikotnik se morajo zapreti
// točno; Bowditch porazdelitev preverjena ročno (pravokotnik 500/300/505/300).
import {
  closeRoomPolygon,
  rectWalls,
  polygonAreaCm2,
  type WallInput,
} from '../../src/lib/room-sketch';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(got)}`);
  }
}
const close = (a: number, b: number, tol = 0.2) => Math.abs(a - b) <= tol;
const sq = (n: number, a = 90): WallInput[] => Array.from({ length: n }, () => ({ lengthCm: 400, angleDeg: a }));

// 1) Popoln kvadrat 400×400 → zaprto, 16 m²
{
  const r = closeRoomPolygon(sq(4));
  check('kvadrat: rezultat obstaja', r !== null, r);
  check('kvadrat: level closed', r?.level === 'closed', r?.level);
  check('kvadrat: zapiralna napaka 0', close(r?.closureErrorCm ?? -1, 0, 0.01), r?.closureErrorCm);
  check('kvadrat: površina 16 m²', close(r?.areaM2 ?? -1, 16, 0.01), r?.areaM2);
  check('kvadrat: obseg 1600 cm', close(r?.perimeterCm ?? -1, 1600, 0.1), r?.perimeterCm);
  check('kvadrat: ovojnica 4×4 m', close(r?.bboxM.lengthM ?? -1, 4, 0.01) && close(r?.bboxM.widthM ?? -1, 4, 0.01), r?.bboxM);
  check('kvadrat: prefill keramika', close(r?.prefill.keramika?.floorLength ?? -1, 4, 0.01), r?.prefill.keramika);
  check('kvadrat: prefill fasada 16 m', close(r?.prefill.fasada?.facadePerimeter ?? -1, 16, 0.01), r?.prefill.fasada);
}

// 2) Pravokotnik 500×300 → 15 m²
{
  const r = closeRoomPolygon([
    { lengthCm: 500, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
    { lengthCm: 500, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
  ]);
  check('pravokotnik: closed', r?.level === 'closed', r?.level);
  check('pravokotnik: 15 m²', close(r?.areaM2 ?? -1, 15, 0.01), r?.areaM2);
  check('pravokotnik: WPC prefill 5×3', close(r?.prefill['wpc-terasa']?.deckLength ?? -1, 5, 0.01) && close(r?.prefill['wpc-terasa']?.deckWidth ?? -1, 3, 0.01), r?.prefill['wpc-terasa']);
}

// 3) Popačen pravokotnik [500,300,505,300] → Bowditch (ročno izračunano)
{
  const r = closeRoomPolygon([
    { lengthCm: 500, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
    { lengthCm: 505, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
  ]);
  check('popačen: level adjusted', r?.level === 'adjusted', r?.level);
  check('popačen: zapiralna napaka 5 cm', close(r?.closureErrorCm ?? -1, 5, 0.05), r?.closureErrorCm);
  check('popačen: 0,31 % obsega', close(r?.closureErrorPct ?? -1, 0.31, 0.02), r?.closureErrorPct);
  // Bowditch: popravki 1,558/0,935/1,573/0,935 cm → stranice 501,56/300,00/503,43/300,00
  check('popačen: stranica 1 = 501,56', close(r?.adjustedSidesCm[0] ?? -1, 501.56, 0.05), r?.adjustedSidesCm[0]);
  check('popačen: stranica 3 = 503,43', close(r?.adjustedSidesCm[2] ?? -1, 503.43, 0.05), r?.adjustedSidesCm[2]);
  check('popačen: obseg ohranjen 1605', close(r?.perimeterCm ?? -1, 1605, 0.1), r?.perimeterCm);
  check('popačen: površina 15,07 m²', close(r?.areaM2 ?? -1, 15.07, 0.05), r?.areaM2);
  // poligon se mora po poravnavi točno zapreti (zadnja točka = izhodišče)
  const last = r!.vertices[r!.vertices.length - 1];
  check('popačen: Bowditch zapre poligon', close(last.x, 0, 0.01) && close(last.y, 0, 0.01), last);
  check('popačen: opozorilo o poravnavi', (r?.warnings ?? []).some((w) => w.includes('Bowditch')), r?.warnings);
}

// 4) L-prostor (6 sten, en vdolben kot 270°) → točno 7 m²
{
  const r = closeRoomPolygon([
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 100, angleDeg: 90 },
    { lengthCm: 200, angleDeg: 270 },
    { lengthCm: 150, angleDeg: 90 },
    { lengthCm: 200, angleDeg: 90 },
    { lengthCm: 250, angleDeg: 90 },
  ]);
  check('L-prostor: closed', r?.level === 'closed', r?.level);
  check('L-prostor: zapiralna napaka ~0', close(r?.closureErrorCm ?? -1, 0, 0.01), r?.closureErrorCm);
  check('L-prostor: 7 m² (400×250 − 200×150)', close(r?.areaM2 ?? -1, 7, 0.01), r?.areaM2);
  check('L-prostor: obseg 1300 cm', close(r?.perimeterCm ?? -1, 1300, 0.1), r?.perimeterCm);
  check('L-prostor: ovojnica 4×2,5 m', close(r?.bboxM.lengthM ?? -1, 4, 0.01) && close(r?.bboxM.widthM ?? -1, 2.5, 0.01), r?.bboxM);
}

// 5) Enakostranični trikotnik 300 (koti 60°) → 3,897 m²
{
  const r = closeRoomPolygon([
    { lengthCm: 300, angleDeg: 60 },
    { lengthCm: 300, angleDeg: 60 },
    { lengthCm: 300, angleDeg: 60 },
  ]);
  check('trikotnik: closed', r?.level === 'closed', r?.level);
  check('trikotnik: 3,897 m² (√3/4·300²)', close(r?.areaM2 ?? -1, 3.9, 0.02), r?.areaM2);
}

// 6) Odprt: manjka stena [400,400,400,100] → 23 % napake, površina = null
{
  const r = closeRoomPolygon([
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 100, angleDeg: 90 },
  ]);
  check('odprt: level open', r?.level === 'open', r?.level);
  check('odprt: napaka 300 cm', close(r?.closureErrorCm ?? -1, 300, 0.1), r?.closureErrorCm);
  check('odprt: 23,08 % obsega', close(r?.closureErrorPct ?? -1, 23.08, 0.05), r?.closureErrorPct);
  check('odprt: površina NI izračunana', r?.areaM2 === null, r?.areaM2);
  check('odprt: brez prefilla', Object.keys(r?.prefill ?? {}).length === 0, r?.prefill);
  check('odprt: opozorilo o zaprtju', (r?.warnings ?? []).some((w) => w.includes('ne zapre')), r?.warnings);
  // surove dolžine ostanejo nedotaknjene (ne tihe poravnave)
  check('odprt: stranice ostanejo surove', close(r?.adjustedSidesCm[3] ?? -1, 100, 0.01), r?.adjustedSidesCm[3]);
}

// 7) Zmotni koti (odstopanje > 15°/kot) → odprt
{
  const r = closeRoomPolygon([
    { lengthCm: 500, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
    { lengthCm: 500, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 20 },
  ]);
  check('kotna napaka: level open', r?.level === 'open', r?.level);
  check('kotna napaka: opozorilo o kotih', (r?.warnings ?? []).some((w) => w.includes('ne seštejejo')), r?.warnings);
}

// 8) Majhna kotna napaka se porazdeli (opozorilo), Bowditch še vedno zapre
{
  const r = closeRoomPolygon([
    { lengthCm: 500, angleDeg: 91 },
    { lengthCm: 300, angleDeg: 90 },
    { lengthCm: 505, angleDeg: 90 },
    { lengthCm: 300, angleDeg: 90 },
  ]);
  check('kot 91°: adjusted (ne open)', r?.level === 'adjusted', r?.level);
  check('kot 91°: opozorilo o kotnem zaprtju', (r?.warnings ?? []).some((w) => w.includes('Kotno zaprtje')), r?.warnings);
  check('kot 91°: površina blizu 15 m²', Math.abs((r?.areaM2 ?? 0) - 15) < 0.5, r?.areaM2);
  const last = r!.vertices[r!.vertices.length - 1];
  check('kot 91°: poligon zaprt', close(last.x, 0, 0.02) && close(last.y, 0, 0.02), last);
}

// 9) rectWalls: nasprotna para se povprečita
{
  const walls = rectWalls({ widthA: 400, widthB: 402, lengthA: 300, lengthB: 298 });
  const r = closeRoomPolygon(walls);
  check('rectWalls: 4 stene', walls.length === 4, walls.length);
  check('rectWalls: closed', r?.level === 'closed', r?.level);
  check('rectWalls: 4,01×2,99 = 11,99 m²', close(r?.areaM2 ?? -1, 11.99, 0.01), r?.areaM2);
}

// 10) Validacija: < 3 stene → null; neveljavni koti → null; neveljavne dolžine izpuščene
{
  check('2 steni: null', closeRoomPolygon(sq(2)) === null, closeRoomPolygon(sq(2)));
  const badAngle = closeRoomPolygon([
    { lengthCm: 400, angleDeg: 10 },
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
  ]);
  check('kot 10°: null', badAngle === null, badAngle);
  const r = closeRoomPolygon([
    { lengthCm: 0, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
    { lengthCm: 400, angleDeg: 90 },
  ]);
  check('dolžina 0: izpuščena, preostale 3 zaprejo', r !== null && r.n === 3, r?.n);
  check('dolžina 0: opozorilo', (r?.warnings ?? []).some((w) => w.includes('izpuščene')), r?.warnings);
}

// 11) Shoelace referenca: pravokotnik 500×300 = 150000 cm²
{
  const a = polygonAreaCm2([
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 300 },
    { x: 0, y: 300 },
  ]);
  check('shoelace: 150000 cm²', close(a, 150000, 0.5), a);
}

console.log(`\n${pass}/${pass + fail} testov uspešnih`);
if (fail > 0) process.exit(1);
