// ─── Preveritev protokolov laserskih merilnikov ─────────────
// Vsaka pričakovanja je ROČNO izračunana iz dokumentiranih zajemov:
//  • GLM 120 C: 6f 81 04 3f (float LE) = 0x3F04816F
//      znak 0, eksponent 0x7E (126) → 2^-1, mantisa 0x04816F/0x800000
//      = 0,035231 → vrednost (1 + 0,035231) · 0,5 = 0,517615 m → 51,7615 cm
//  • Bosch C0: 13 0E 00 00 (u32 LE) = 0x00000E13 = 3603 → 3603 · 0,05 mm
//      = 180,15 mm = 18,015 cm
//  • Generične bajte: 0x0DAC = 3500 mm = 350 cm

import {
  detectLaserModel,
  LASER_MODELS,
  parseBoschC0Response,
  parseBoschGlm120Indication,
  parseGenericBytes,
  parseGenericText,
  parseLaserValue,
  protocolSelfTest,
  GLM120_ENABLE_INDICATIONS,
  GLM120_INIT,
  GLM120_TRIGGER,
  GLM120_MODE_DISTANCE,
  BOSCH_C0_MEASURE,
  type LaserModelId,
} from '../../src/lib/laser-protocols';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const near = (a: number, b: number, eps = 0.05): boolean => Math.abs(a - b) <= eps;

const b = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);

// ── 1) GLM 120 C: dokumentirana merilna indikacija ──────────
{
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0x6f, 0x81, 0x04, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xec),
  );
  check('GLM120 meritev: ni null', r !== null);
  check('GLM120 meritev: 51,76 cm', r !== null && near(r.cm, 51.76), `dobi ${r?.cm}`);
  check('GLM120 meritev: brez opozorila', r !== null && r.warning === undefined);
}

// ── 2) GLM 120 C: odmev priprave (status, ne meritev) ───────
{
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x02, 0x09, 0x53, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc2),
  );
  check('GLM120 odmev: null', r === null, `dobi ${r?.cm ?? 'null'}`);
}

// ── 3) GLM 120 C: pripravljenost brez C0 (00 okvir) ─────────
{
  const r = parseBoschGlm120Indication(
    b(0x00, 0x10, 0x02, 0x08, 0x53, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe8),
  );
  check('GLM120 pripravljenost: null', r === null);
}

// ── 4) GLM 120 C: float 0 → null (odmev z ničlami) ──────────
{
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x02, 0x09, 0x53, 0x05, 0x00, 0x00, 0x00, 0x00),
  );
  check('GLM120 float 0: null', r === null);
}

// ── 5) GLM 120 C: prekratek okvir → null ────────────────────
{
  check('GLM120 < 11 bajtov: null', parseBoschGlm120Indication(b(0xc0, 0x55, 0x10, 0x06)) === null);
  check('GLM120 prazno: null', parseBoschGlm120Indication(new Uint8Array(0)) === null);
}

// ── 6) GLM 120 C: znana resnica float — 2,000 m ─────────────
// float LE 2.0 = 00 00 00 40 → indikacija z [3]=0x06
{
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0x00, 0x00, 0x00, 0x40, 0x00),
  );
  check('GLM120 float 2,0 m → 200 cm', r !== null && near(r.cm, 200), `dobi ${r?.cm}`);
}

// ── 7) GLM 120 C: strpna varianta (nedokumentirana oblika) ──
// C0-okvir, [3] ≠ 0x06, ampak smiselen float na 7–10 → vrednost + opozorilo
{
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x07, 0x08, 0x54, 0x05, 0x00, 0x00, 0x00, 0x40, 0x00),
  );
  check('GLM120 strpna: vrednost', r !== null && near(r.cm, 200), `dobi ${r?.cm}`);
  check('GLM120 strpna: opozorilo', r !== null && !!r.warning);
}

// ── 8) GLM 120 C: nesmiselen float (NaN-like prevelik) → null ─
{
  // float 1e38 = prevelik za razpon 0,001–100 m
  const r = parseBoschGlm120Indication(
    b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0xff, 0xff, 0x7f, 0x7e, 0x00),
  );
  check('GLM120 float 1e38: null', r === null, `dobi ${r?.cm ?? 'null'}`);
}

// ── 9) Bosch C0: dokumentiran odgovor 00 04 13 0E 00 00 32 ──
{
  const r = parseBoschC0Response(b(0x00, 0x04, 0x13, 0x0e, 0x00, 0x00, 0x32));
  check('C0 meritev: ni null', r !== null);
  check('C0 meritev: 18,015 cm ≈ 18,0', r !== null && near(r.cm, 18.0, 0.02), `dobi ${r?.cm}`);
  check('C0 meritev: brez opozorila', r !== null && r.warning === undefined);
}

// ── 10) Bosch C0: ročna resnica — u32 LE 0x0001D4C0 = 120000 → 6000 mm → 600 cm
// 120000 · 0,05 mm = 6000 mm = 600 cm (6 m)
{
  const r = parseBoschC0Response(b(0x00, 0x04, 0xc0, 0xd4, 0x01, 0x00, 0x99));
  check('C0: 0x0001D4C0 → 600 cm', r !== null && near(r.cm, 600, 0.02), `dobi ${r?.cm}`);
}

// ── 11) Bosch C0: statusi → opozorila, brez vrednosti ───────
{
  const cases: Array<[number, string]> = [
    [0x01, 'zamik'],
    [0x03, 'kontrolna vsota'],
    [0x04, 'ne prepozna ukaza'],
    [0x05, 'dostop'],
    [0x08, 'Strojna napaka'],
    [0x10, 'pripravljena'],
    [0x42, 'status 0x42'],
  ];
  for (const [status, frag] of cases) {
    const r = parseBoschC0Response(b(status, 0x00, 0x11));
    check(`C0 status 0x${status.toString(16)}: cm=0 + opozorilo`, r !== null && r.cm === 0 && !!r.warning);
    check(`C0 status 0x${status.toString(16)}: namig vsebuje "${frag}"`, r !== null && r.warning !== undefined && r.warning.includes(frag));
  }
}

// ── 12) Bosch C0: napačne dolžine → null ────────────────────
{
  check('C0: len<4 → null', parseBoschC0Response(b(0x00, 0x02, 0x13, 0x0e)) === null);
  check('C0: prekratek za len → null', parseBoschC0Response(b(0x00, 0x04, 0x13)) === null);
  check('C0: < 3 bajtov → null', parseBoschC0Response(b(0x00, 0x00)) === null);
}

// ── 13) Generično besedilo ──────────────────────────────────
{
  const t1 = parseGenericText(new TextEncoder().encode(' 350 '));
  check('Besedilo "350" → 350 cm', t1 !== null && t1.cm === 350, `dobi ${t1?.cm}`);
  const t2 = parseGenericText(new TextEncoder().encode('3,50'));
  check('Besedilo "3,50" → 3,5 cm (< 100 = cm)', t2 !== null && near(t2.cm, 3.5), `dobi ${t2?.cm}`);
  const t3 = parseGenericText(new TextEncoder().encode('D=1.234m'));
  check('Besedilo "1.234" → 123,4 cm (mm / 10)', t3 !== null && near(t3.cm, 123.4), `dobi ${t3?.cm}`);
  check('Besedilo brez številke → null', parseGenericText(new TextEncoder().encode('OK READY')) === null);
}

// ── 14) Generične bajte ─────────────────────────────────────
{
  const u16 = parseGenericBytes(b(0xac, 0x0d)); // 0x0DAC = 3500 mm → 350 cm
  check('u16 LE 3500 → 350 cm', u16 !== null && near(u16.cm, 350), `dobi ${u16?.cm}`);
  // u32 LE: 0x00002710 = 10000 mm → 1000 cm
  const u32 = parseGenericBytes(b(0x10, 0x27, 0x00, 0x00));
  check('u32 LE 10000 → 1000 cm', u32 !== null && near(u32.cm, 1000), `dobi ${u32?.cm}`);
  check('3 bajti → null', parseGenericBytes(b(0x01, 0x02, 0x03)) === null);
  // 5 mm = 0,5 cm → izven razpona (< 1 cm) → null
  check('u16 5 mm = 0,5 cm: izven razpona → null', parseGenericBytes(b(0x05, 0x00)) === null);
}

// ── 15) Skupni vhod: modeli ─────────────────────────────────
{
  const glm120Bytes = b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, 0x6f, 0x81, 0x04, 0x3f);
  const dv = new DataView(glm120Bytes.buffer);

  const auto = parseLaserValue(dv, 'auto');
  check('auto: GLM120 okvir → 51,76 cm', auto !== null && near(auto.cm, 51.76), `dobi ${auto?.cm ?? 'null'}`);

  const specific = parseLaserValue(dv, 'bosch-glm120');
  check('bosch-glm120: 51,76 cm', specific !== null && near(specific.cm, 51.76));

  // C0 odgovor v auto: 00 04 … (status 00, besedilo bi pokvarilo)
  const c0Bytes = b(0x00, 0x04, 0x13, 0x0e, 0x00, 0x00, 0x32);
  const autoC0 = parseLaserValue(new DataView(c0Bytes.buffer), 'auto');
  check('auto: C0 odgovor → 18,0 cm (GLM120 pasus naprej)', autoC0 !== null && near(autoC0.cm, 18.0, 0.02), `dobi ${autoC0?.cm ?? 'null'}`);

  // specific bosch-c0 na GLM120 okviru → null (status c0 ≠ 0? — c0=192 ni znan status → opozorilo z neznanim statusom)
  const c0On120 = parseLaserValue(dv, 'bosch-c0');
  check('bosch-c0 na GLM120 okviru: opozorilo o neznanem statusu', c0On120 !== null && c0On120.cm === 0 && !!c0On120.warning, c0On120?.warning);

  // generic-bytes na 11-bajtnem okviru → null
  check('generic-bytes na 11 bajtih: null', parseLaserValue(dv, 'generic-bytes') === null);
}

// ── 16) Prepoznavanje modelov po imenu ──────────────────────
{
  check('GLM 120 C → bosch-glm120', detectLaserModel('GLM 120 C') === 'bosch-glm120');
  check('glm120c → bosch-glm120', detectLaserModel('glm120c') === 'bosch-glm120');
  check('GLM 50-27 CG → bosch-c0', detectLaserModel('GLM 50-27 CG') === 'bosch-c0');
  check('Bosch GLM 100C → bosch-c0', detectLaserModel('Bosch GLM 100C') === 'bosch-c0');
  check('PLR 30 C → bosch-c0', detectLaserModel('PLR 30 C') === 'bosch-c0');
  check('Leica DISTO D2 → auto', detectLaserModel('Leica DISTO D2') === 'auto');
  check('null → auto', detectLaserModel(null) === 'auto');
  check('prazno → auto', detectLaserModel('') === 'auto');
}

// ── 17) Sprožitvena zaporedja = KONSTANTE iz virov ──────────
{
  const hex = (a: number[]): string => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  check('GLM120_ENABLE_INDICATIONS = 02 00', hex(GLM120_ENABLE_INDICATIONS) === '02 00');
  check('GLM120_INIT = c0 55 02 01 00 1a', hex(GLM120_INIT) === 'c0 55 02 01 00 1a');
  check('GLM120_TRIGGER = c0 56 01 00 1e', hex(GLM120_TRIGGER) === 'c0 56 01 00 1e');
  check('GLM120_MODE_DISTANCE = c0 55 02 f1 01 ee', hex(GLM120_MODE_DISTANCE) === 'c0 55 02 f1 01 ee');
  check('BOSCH_C0_MEASURE = c0 40 00 ee', hex(BOSCH_C0_MEASURE) === 'c0 40 00 ee');
}

// ── 18) Modeli: seznam in unikatni ID-ji ────────────────────
{
  check('5 modelov', LASER_MODELS.length === 5, `dobi ${LASER_MODELS.length}`);
  const ids = new Set(LASER_MODELS.map((m) => m.id));
  check('ID-ji unikatni', ids.size === LASER_MODELS.length);
  check('vsi imajo ime + namig', LASER_MODELS.every((m) => m.name.length > 0 && m.hint.length > 0));
  const cast = LASER_MODELS[0].id as LaserModelId;
  check('prvi model je auto', cast === 'auto');
}

// ── 19) Samopreizkus: notranja usklajenost ──────────────────
{
  const rows = protocolSelfTest();
  check('8 vrstic samopreizkusa', rows.length === 8, `dobi ${rows.length}`);
  check('vse vrstice OK', rows.every((r) => r.ok), rows.filter((r) => !r.ok).map((r) => r.name).join('; '));
  check('vsaka vrstica ima ime in podrobnost', rows.every((r) => r.name.length > 0 && r.detail.length > 0));
  // determinizem
  const rows2 = protocolSelfTest();
  check('determinističen (dve zagoni enaki)', JSON.stringify(rows) === JSON.stringify(rows2));
}

// ── 20) Razpon: izven 1–50.000 cm → null ────────────────────
{
  // GLM120 float 0,0005 m = 0,5 cm → izven razpona → null
  // float LE 0,0005: exponent = -11 → bits 0x3A03126F (približek) — uporabi DataBuffer
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, 0.0005, true);
  const le = [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
  const r = parseBoschGlm120Indication(b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, ...le));
  check('GLM120 0,5 cm: izven razpona → null', r === null, `dobi ${r?.cm ?? 'null'}`);

  // GLM120 float 150 m → izven razpona (> 100 m zavržen prej, 150 m tudi > 50.000 cm)
  dv.setFloat32(0, 150, true);
  const le150 = [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
  const r150 = parseBoschGlm120Indication(b(0xc0, 0x55, 0x10, 0x06, 0x08, 0x54, 0x05, ...le150));
  check('GLM120 150 m: izven razpona → null', r150 === null, `dobi ${r150?.cm ?? 'null'}`);

  // meja: 50.000 cm = 500 m — C0: u32 0x04C4B400 = 80.000.000 × 0,05 = 4.000.000 mm → preveliko → null
  const c0big = parseBoschC0Response(b(0x00, 0x04, 0x00, 0xb4, 0xc4, 0x04, 0x00));
  check('C0 4.000.000 mm: izven razpona → null', c0big === null, `dobi ${c0big?.cm ?? 'null'}`);
}

// ── 21) Zaokroževanje na 0,1 cm ─────────────────────────────
{
  // u32 LE 0x00000001 = 1 → 0,05 mm = 0,005 cm → zaokroženo 0,0 → izven razpona → null
  check('C0: 0,005 cm → zaokroženo 0 → null', parseBoschC0Response(b(0x00, 0x04, 0x01, 0x00, 0x00, 0x00, 0x05)) === null);
  // u32 LE 0x000000C8 = 200 → 10 mm = 1 cm → spodnja meja točno
  const r = parseBoschC0Response(b(0x00, 0x04, 0xc8, 0x00, 0x00, 0x00, 0xc8));
  check('C0: 10 mm → 1,0 cm (spodnja meja)', r !== null && r.cm === 1, `dobi ${r?.cm ?? 'null'}`);
}

console.log(`\n═══ laser-protocols: ${pass} uspešnih, ${fail} spodletelih ═══`);
if (fail > 0) {
  console.log('\nSPODLETELO:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('VSE PREVERITVE USPEŠNE ✓');
