// Trajna kakovostna preverba VSEH ROKSAL dekor tlakov na disku (Task 62 —
// nadaljevanje kvalitete tekstur iz Task 55–57/60 na VSEH 5 družinah):
//   1) Registry ↔ disk: vsak dekor-N.png ima registriran asset (tex-roksal-*)
//      z iskrenimi polji (grain vertical, realCm 45, roksal-original, unverified)
//      in noben orphan file na disku ni neregistriran.
//   2) Pikselska vrata za VSAK tlak (32): 256×256 enojni izrez, 0 skoraj-črnih
//      pikslov, NAVPIČNA žira, NI notranje zrcalne (metulj) simetrije, vidna žira.
//
// Pragi so UMERJENI na izmerjenih vrednostih vseh 32 tlakov (kalibracija Task 62,
// bun skripta z sharp nad raw piksli):
//   - vertikalna marža (|dx|−|dy|)/(|dx|+|dy|): izmerjeno min 0,291 → prag 0,15
//     (≈ 2× glava; ravna siva polnilna tekstura bi imela ~0)
//   - zrcalna simetrija symX/symY: izmerjeno min 7,9/7,1 → prag 6 (enak prag kot
//     pikselske preverbe v tests/verify/photo-replace.ts)
//   - vidna žira meanDx (povprečen |gradient| v x): izmerjeno min 4,39 → prag 3,5
//     (ravnina ima ~0–1); std luminance se beleži v izpisu
//   - skoraj-črni piksli (l < 10): prag 0, dosledno z ostalimi preverbami
// Šivi pri zrcalnem tlakovanju (renderer drawMirroredTexture 2×2) so po
// konstrukciji zvezni za poljuben tlak (zrcaljenje podvoji rob), zato ločena
// preverba šivov ni potrebna — tlak mora le biti enojni ne-zrcaljen izrez
// (to zagajata preverbi simetrije).
// Zagon: bun tests/verify/roksal-tiles.ts
import { existsSync, readdirSync } from 'node:fs';
import { ROKSAL_ASSETS, assetById } from '../../src/lib/roksal-assets';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

// Pragovi (glej kalibracijo v glavi).
const MARGIN_MIN = 0.15;
const SYM_MIN = 6;
const MEAN_DX_MIN = 3.5;
const NEAR_BLACK_MAX = 0;
const TILE = 256;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 5 družin, 32 tlakov (POLNA-57/32 uradno uporablja KUBO tlake — brez lastnih).
const FAMILIES = [
  { key: 'KUBO 80/42', pre: 'tex-roksal-kubo-dekor-', n: 4, dir: 'public/roksal/kubo', srcDir: '/roksal/kubo' },
  { key: 'TERASNA (DEKA)', pre: 'tex-roksal-deka-dekor-', n: 7, dir: 'public/roksal/deka', srcDir: '/roksal/deka' },
  { key: 'ROMB-67', pre: 'tex-roksal-romb67-dekor-', n: 7, dir: 'public/roksal/ograje/romb-67', srcDir: '/roksal/ograje/romb-67' },
  { key: 'POLNA-100', pre: 'tex-roksal-polna100-dekor-', n: 8, dir: 'public/roksal/ograje/polna-100', srcDir: '/roksal/ograje/polna-100' },
  { key: 'POLNA-128', pre: 'tex-roksal-polna128-dekor-', n: 6, dir: 'public/roksal/ograje/polna-128', srcDir: '/roksal/ograje/polna-128' },
] as const;

console.log('ROKSAL dekor tlaki — trajna kakovostna preverba (registry ↔ disk + pikselska vrata)\n');

const sharp = (await import('sharp')).default;
let totalTiles = 0;

for (const fam of FAMILIES) {
  console.log(`${fam.key} (${fam.n} tlakov, ${fam.dir}/):`);

  // 1) Registry ↔ disk
  for (let i = 1; i <= fam.n; i++) {
    const id = `${fam.pre}${i}`;
    const a = assetById(id);
    const src = `${fam.srcDir}/dekor-${i}.png`;
    const onDisk = existsSync(`${process.cwd()}/${fam.dir}/dekor-${i}.png`);
    check(`${id}: registriran (texture, src ${src}, grain vertical, realCm 45, roksal-original, unverified) + datoteka na disku`,
      !!a && a.kind === 'texture' && a.src === src && a.grain === 'vertical' && a.realCm === 45
      && a.origin === 'roksal-original' && a.verification === 'unverified' && onDisk,
      !a ? 'asset manjka v registru' : !onDisk ? 'datoteka manjka na disku' : `grain=${a!.grain} realCm=${a!.realCm}`);
  }
  // Orphan preverba: na disku je TOČNO n decor datotek (brez dodatnih/neregistriranih)
  const diskDecor = existsSync(`${process.cwd()}/${fam.dir}`)
    ? readdirSync(`${process.cwd()}/${fam.dir}`).filter((f) => /^dekor-\d+\.png$/.test(f)).length
    : -1;
  check(`${fam.key}: število dekor datotek na disku = ${fam.n} (brez orphan datotek)`, diskDecor === fam.n, `na disku: ${diskDecor}`);

  // 2) Pikselska vrata za vsak tlak
  for (let i = 1; i <= fam.n; i++) {
    totalTiles++;
    const path = `${fam.dir}/dekor-${i}.png`;
    const name = `${fam.key} dekor-${i}`;
    const d = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    const W = d.info.width, H = d.info.height, C = d.info.channels;
    check(`${name}: ${TILE}×${TILE} enojni izrez`, W === TILE && H === TILE, `${W}×${H}`);

    let nearBlack = 0, ex = 0, ey = 0, sumL = 0, sumL2 = 0;
    const N = W * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const j = (y * W + x) * C;
        const l = lum(d.data[j], d.data[j + 1], d.data[j + 2]);
        if (l < 10) nearBlack++;
        sumL += l; sumL2 += l * l;
        if (x < W - 1) {
          const jr = j + C;
          ex += Math.abs(lum(d.data[jr], d.data[jr + 1], d.data[jr + 2]) - l);
        }
        if (y < H - 1) {
          const jd = ((y + 1) * W + x) * C;
          ey += Math.abs(lum(d.data[jd], d.data[jd + 1], d.data[jd + 2]) - l);
        }
      }
    }
    const meanL = sumL / N;
    const std = Math.sqrt(Math.max(0, sumL2 / N - meanL * meanL));
    const meanDx = ex / (N - H), meanDy = ey / (N - W);
    const margin = (ex - ey) / Math.max(1, ex + ey);

    check(`${name}: ${NEAR_BLACK_MAX} skoraj-črnih pikslov (črno ozadje lestvice NI v tile-u)`,
      nearBlack <= NEAR_BLACK_MAX, String(nearBlack));
    check(`${name}: žira NAVPIČNA (marža ${margin.toFixed(2)} ≥ ${MARGIN_MIN}; |dx| ${ex.toFixed(0)} > |dy| ${ey.toFixed(0)})`,
      margin >= MARGIN_MIN && ex > ey, `marža=${margin.toFixed(3)}`);
    check(`${name}: vidna žira (meanDx ${meanDx.toFixed(1)} ≥ ${MEAN_DX_MIN}; std lum ${std.toFixed(1)})`,
      meanDx >= MEAN_DX_MIN, `meanDx=${meanDx.toFixed(2)}`);

    // ne-zrcaljenost: povprečni lev/des in gor/dol zrcalni odmik morata biti opazna
    let symX = 0, symY = 0;
    for (let x = 0; x < W; x++) {
      let diff = 0;
      for (let y = 0; y < H; y++) {
        const ia = (y * W + x) * C, ib = (y * W + (W - 1 - x)) * C;
        diff += Math.abs(d.data[ia] - d.data[ib]) + Math.abs(d.data[ia + 1] - d.data[ib + 1]) + Math.abs(d.data[ia + 2] - d.data[ib + 2]);
      }
      symX += diff / (H * 3);
    }
    symX /= W;
    for (let y = 0; y < H; y++) {
      let diff = 0;
      for (let x = 0; x < W; x++) {
        const ia = (y * W + x) * C, ib = ((H - 1 - y) * W + x) * C;
        diff += Math.abs(d.data[ia] - d.data[ib]) + Math.abs(d.data[ia + 1] - d.data[ib + 1]) + Math.abs(d.data[ia + 2] - d.data[ib + 2]);
      }
      symY += diff / (W * 3);
    }
    symY /= H;
    check(`${name}: NI notranje zrcalne simetrije (symX ${symX.toFixed(1)} + symY ${symY.toFixed(1)} ≥ ${2 * SYM_MIN} — enojni neprekinjen izrez, brez metulja)`,
      symX >= SYM_MIN && symY >= SYM_MIN, `symX=${symX.toFixed(1)} symY=${symY.toFixed(1)}`);
  }
  console.log('');
}

check(`skupaj preverjenih tlakov = 32 (4+7+7+8+6) — vsi registrirani, vsi na disku`, totalTiles === 32, String(totalTiles));
check(`ROKSAL_ASSETS: vsak texture kazalec z realnim src (/roksal/…) kaže na obstoječo datoteko (src=null = iskreno manjkajoči originali, dovoljeni)`,
  ROKSAL_ASSETS.filter((a) => !!a && a.kind === 'texture' && typeof a.src === 'string' && a.src.startsWith('/roksal/'))
    .every((a) => existsSync(`${process.cwd()}/public${a.src}`)));

console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
process.exit(fail > 0 ? 1 : 0);
