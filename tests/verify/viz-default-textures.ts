// ─── Verify: samodejne materialne teksture (Task 34) ─────────
// Čiste funkcije (brez DOM): defaultTextureForPattern + makeLayer.
// Poženemo: bun tests/verify/viz-default-textures.ts

import {
  VIZ_COLORS,
  defaultColorForPattern,
  defaultTextureForPattern,
  makeLayer,
} from '../../src/lib/viz';
import { texturesForPattern } from '../../src/lib/viz-textures';
import type { VizPattern } from '../../src/lib/viz';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

console.log('— RAL = barvana kovina → brez teksture (flat je realen) —');
const ralIds = VIZ_COLORS.filter((c) => c.group === 'ral').map((c) => c.id);
const fencePatterns: VizPattern[] = ['vertikalne', 'piketna', 'vozlik', 'lamele45', 'horizontalne', 'panel'];
for (const rid of ralIds) {
  for (const p of fencePatterns) {
    ok(`${rid} + ${p} → undefined`, defaultTextureForPattern(p, rid) === undefined);
  }
}

console.log('— WPC → žirana / gladka tekstura po tonu —');
ok('wpc-tikovina + terasa → wpc-tikovina', defaultTextureForPattern('terasa', 'wpc-tikovina') === 'wpc-tikovina');
ok('wpc-svetli-les + terasa → wpc-tikovina', defaultTextureForPattern('terasa', 'wpc-svetli-les') === 'wpc-tikovina');
ok('wpc-oreh + terasa → wpc-tikovina', defaultTextureForPattern('terasa', 'wpc-oreh') === 'wpc-tikovina');
ok('wpc-siva + terasa → wpc-siva', defaultTextureForPattern('terasa', 'wpc-siva') === 'wpc-siva');
ok('wpc-antracit + terasa → wpc-siva', defaultTextureForPattern('terasa', 'wpc-antracit') === 'wpc-siva');
ok('wpc-tikovina + vertikalne → wpc-tikovina', defaultTextureForPattern('vertikalne', 'wpc-tikovina') === 'wpc-tikovina');
ok('wpc-antracit + horizontalne → wpc-siva', defaultTextureForPattern('horizontalne', 'wpc-antracit') === 'wpc-siva');

console.log('— Keramika / fasada —');
ok('ker-siva + ploscice → keramika-kamen', defaultTextureForPattern('ploscice', 'ker-siva') === 'keramika-kamen');
ok('ker-bela + ploscice → keramika-kamen', defaultTextureForPattern('ploscice', 'ker-bela') === 'keramika-kamen');
ok('ker-antracit + ploscice → keramika-kamen', defaultTextureForPattern('ploscice', 'ker-antracit') === 'keramika-kamen');
ok('ker-bez + ploscice → keramika-kamen', defaultTextureForPattern('ploscice', 'ker-bez') === 'keramika-kamen');
ok('fas-bela + panel → fasada-omet', defaultTextureForPattern('panel', 'fas-bela') === 'fasada-omet');
// obloga (horizontalne) NI omet — fasadne barve so za vzorec 'barva',
// zato katalog za horizontalne ponuja samo les/WPC teksture → undefined
ok('fas-antracit + horizontalne → undefined (obloga ni omet)', defaultTextureForPattern('horizontalne', 'fas-antracit') === undefined);

console.log('— Vzorci brez opačnega materiala → vedno brez teksture —');
ok('steklo + ral-7016 → undefined', defaultTextureForPattern('steklo', 'ral-7016') === undefined);
ok('barva + wpc-tikovina → undefined', defaultTextureForPattern('barva', 'wpc-tikovina') === undefined);
ok('mreza + wpc-tikovina → undefined (mreža nima tekstur)', defaultTextureForPattern('mreza', 'wpc-tikovina') === undefined);
ok('neznana barva (iz fotke) → undefined', defaultTextureForPattern('terasa', 'custom-neznana') === undefined);

console.log('— Vrnikatalog: hrast se NIKOLI ne dodeli samodejno (samo ročno) —');
let hrastAuto = false;
for (const p of ['panel', 'vertikalne', 'horizontalne', 'lamele45', 'vozlik', 'vertikalne', 'piketna', 'terasa', 'ploscice'] as VizPattern[]) {
  for (const c of VIZ_COLORS) {
    if (defaultTextureForPattern(p, c.id) === 'hrast') hrastAuto = true;
  }
}
ok('hrast ni med samodejnimi', !hrastAuto);

console.log('— Samodejna tekstura je vedno v ponudbi za vzorec —');
for (const p of ['panel', 'vertikalne', 'horizontalne', 'lamele45', 'vozlik', 'piketna', 'terasa', 'ploscice'] as VizPattern[]) {
  for (const c of VIZ_COLORS) {
    const t = defaultTextureForPattern(p, c.id);
    if (t !== undefined) {
      const allowed = texturesForPattern(p).map((x) => x.id);
      ok(`(${p}, ${c.id}) → ${t} je v allowed`, allowed.includes(t));
    }
  }
}

console.log('— makeLayer: privzeta plast nosi material za svoj obrt —');
const lTerasa = makeLayer('x1', 0, 'wpc-terasa');
ok('wpc-terasa: vzorec terasa', lTerasa.pattern === 'terasa');
ok('wpc-terasa: barva wpc', defaultColorForPattern('terasa').group === 'wpc');
ok('wpc-terasa: tekstura nastavljena', lTerasa.textureId === 'wpc-tikovina' || lTerasa.textureId === 'wpc-siva');

const lOgraje = makeLayer('x2', 0, 'ograje');
ok('ograje: vzorec vertikalne', lOgraje.pattern === 'vertikalne');
ok('ograje: RAL barva → brez teksture', lOgraje.textureId === undefined);

const lKeramika = makeLayer('x3', 0, 'keramika');
ok('keramika: vzorec ploscice', lKeramika.pattern === 'ploscice');
ok('keramika: tekstura kamen', lKeramika.textureId === 'keramika-kamen');

const lFasada = makeLayer('x4', 0, 'fasada');
ok('fasada: privzeti vzorec barva → brez teksture', lFasada.pattern === 'barva' && lFasada.textureId === undefined);

console.log(`\nRezultat: ${pass} OK, ${fail} FAIL`);
if (fail > 0) process.exit(1);
