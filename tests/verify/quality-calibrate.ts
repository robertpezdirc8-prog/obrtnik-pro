// ─── Kalibracija + verifikacija kakovosti posnetka (bun + sharp) ──
// Ista mreža kot checkQuality: 240×240, fit fill. Generira ostra /
// meglena / temna / svetla / odsevne različice realnih fotk in
// preveri, da je vsaka klasifikacija pravilna in monotona.

import sharp from 'sharp';
import {
  qualityMetrics, qualityScore, qualityVerdict, QUALITY_THRESHOLDS,
} from '../../src/lib/image-quality';

interface Row {
  name: string; blur: number; brightness: number; darkPct: number;
  brightPct: number; glarePct: number; score: number; verdict: string;
}

async function toGray(buf: Buffer, size = 240): Promise<{ gray: Float32Array; w: number; h: number }> {
  const { data, info } = await sharp(buf)
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(info.width * info.height);
  for (let i = 0; i < info.width * info.height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return { gray, w: info.width, h: info.height };
}

async function row(name: string, buf: Buffer): Promise<Row> {
  const { gray, w, h } = await toGray(buf);
  const m = qualityMetrics(gray, w, h);
  const s = qualityScore(m);
  return {
    name, blur: Math.round(m.blurScore), brightness: Math.round(m.brightness),
    darkPct: +m.darkPct.toFixed(2), brightPct: +m.brightPct.toFixed(2),
    glarePct: +m.glarePct.toFixed(2), score: s, verdict: qualityVerdict(s),
  };
}

function print(rows: Row[]) {
  console.log(
    'ime'.padEnd(22), 'VoL'.padStart(6), 'svetl'.padStart(6), 'temno%'.padStart(7),
    'svetlo%'.padStart(8), 'odsev%'.padStart(7), 'ocene'.padStart(6), '  sodba',
  );
  for (const r of rows) {
    console.log(
      r.name.padEnd(22), String(r.blur).padStart(6), String(r.brightness).padStart(6),
      String(r.darkPct).padStart(7), String(r.brightPct).padStart(8),
      String(r.glarePct).padStart(7), String(r.score).padStart(6), '  ' + r.verdict,
    );
  }
}

const T = QUALITY_THRESHOLDS;
let fails = 0;
const check = (cond: boolean, msg: string) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fails++;
};

for (const photo of ['public/crafts/ograje.jpg', 'public/crafts/wpc-terasa.jpg']) {
  console.log('\n══ ' + photo + ' ══');
  const base = sharp(photo).toBuffer();
  const rows: Row[] = [];

  const baseBuf = await sharp(photo).toBuffer();
  rows.push(await row('original', baseBuf));
  const blurred: Row[] = [];
  for (const s of [0.5, 1, 2, 3, 5, 8]) {
    blurred.push(await row(`megla σ=${s}`, await sharp(photo).blur(s).toBuffer()));
  }
  rows.push(...blurred);
  rows.push(await row('temna (×0.2)', await sharp(photo).linear(0.2, 0).toBuffer()));
  rows.push(await row('svetla (2.2/40)', await sharp(photo).linear(2.2, 40).toBuffer()));

  // Odsev: bela elipsa (60×40) na sredini, rahlo zabrisana (realistično)
  const svg = Buffer.from(
    '<svg width="240" height="240"><ellipse cx="120" cy="120" rx="30" ry="20" fill="white"/></svg>',
  );
  rows.push(await row('odsev elipsa', await sharp(photo).resize(240, 240, { fit: 'fill' }).composite([{ input: svg }]).blur(0.4).toBuffer()));

  print(rows);

  const orig = rows[0];
  console.log('\n  Preveritve:');
  check(orig.blur > T.blurSharp, `original oster (VoL ${orig.blur} ≥ ${T.blurSharp})`);
  check(orig.score >= 60 && orig.verdict !== 'slabo', `original ocena ${orig.score} (${orig.verdict}) ≥ 60`);
  let mono = true;
  for (let i = 1; i < blurred.length; i++) {
    if (blurred[i].blur >= blurred[i - 1].blur) mono = false;
  }
  check(mono, 'VoL monoton padajoč z rastjo megle');
  check(blurred[blurred.length - 1].blur < T.blurWarn, `σ=8 megleno (VoL ${blurred[blurred.length - 1].blur} < ${T.blurWarn})`);
  const dark = rows.find((r) => r.name === 'temna (×0.2)')!;
  check(dark.darkPct > T.darkPctMax || dark.brightness < T.meanDark, `temna odkrita (temno% ${dark.darkPct}, svetl. ${dark.brightness})`);
  const bright = rows.find((r) => r.name === 'svetla (2.2/40)')!;
  check(bright.brightPct > T.brightPctMax || bright.brightness > T.meanBright, `svetla odkrita (svetlo% ${bright.brightPct}, svetl. ${bright.brightness})`);
  const glare = rows.find((r) => r.name === 'odsev elipsa')!;
  check(glare.glarePct >= T.glarePctMax, `odsev odkrit (${glare.glarePct}% ≥ ${T.glarePctMax}%)`);
  check(glare.score < orig.score, `odsev zniža oceno (${glare.score} < ${orig.score})`);
}

// Sintetika: šahovnica (max VoL) + ravnina (min VoL = 0)
{
  console.log('\n══ sintetika ══');
  const checker = await sharp({
    create: { width: 240, height: 240, channels: 3, background: '#808080' },
  }).composite([
    { input: Buffer.from('<svg width="240" height="240">' + Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => (x + y) % 2 === 0 ? `<rect x="${x * 20}" y="${y * 20}" width="20" height="20" fill="white"/>` : '').join('')).join('') + '</svg>') },
  ]).jpeg().toBuffer();
  const flat = await sharp({ create: { width: 240, height: 240, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  const a = await row('šahovnica', checker);
  const b = await row('ravnina', flat);
  print([a, b]);
  console.log('  Preveritve:');
  check(a.blur > 400, `šahovnica zelo ostra (VoL ${a.blur})`);
  check(b.blur < T.blurBad && b.score <= 35, `ravnina = najslabša ostrina (VoL ${b.blur}, ocena ${b.score} ≤ 35 z stropom)`);
}

console.log(fails === 0 ? '\nVSE PREVERITVE USPEŠNE ✓' : `\n${fails} NAPAČNIH ✗`);
process.exit(fails === 0 ? 0 : 1);
