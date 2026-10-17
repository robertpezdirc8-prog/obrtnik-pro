// E2E na PRAVI fotki monterja (Task 78) — dvotapni predlog ravnine, merjen
// proti ročno prebranemu ground truthu iz `tests/gt/gt-quads.ts`.
//
// ZAKAJ OBSTOJA: `e2e-band-ui.ts` in `e2e-fotomontaza-full.ts` tarčita na
// KONSTRUIRANO sliko, kjer je resnica izpeljana iz risbe. Tam je UI dokazan, a
// NAPAKA detektorja na svetu ostaja merjena samo v jedrnih sondah
// (`tests/gt/probe-band-module.ts`, zamrznjeni izpisi v `tests/gt/outputs/`).
// Ta skript združi oboje: fotko odpre PRAV brskalnik, po njem klikne pravi
// `pointerdown` handler, kvadrat pa se meri proti istemu GT in z istim
// računom kot sonda. Če se številki ujemata, izmerjena natančnost jedra
// DRŽI tudi čez UI-plast; če se ne, je to nova informacija, ne zelen izhod.
//
// DOKAZUJE:
//   1. PONOLVLJIVOST ZAMRZNJENE BAZNE MERITVE — tirnici na 04.jpg in 16.jpg
//      se ujemata s `sonda1` (mediana 2,3 %, max 10,1 % na levem oglišču);
//   2. UI NE POSLABI DETEKTORJA — isti tapki na istih bajtih v `bun` (jedro +
//      delovna kopija aplikacije ≤ 1280 px, JPEG 0,82) da tirnico v mejah
//      dveh delovnih pikslov brskalnikovega downscale-a;
//   3. STRANI KVADRATA STA KLIKA MONETERJA, ne detektor — na pravi fotki,
//      kjer imata rob in perspektivo;
//   4. BREZ IZMERJENE MERE IZRIS OSTAJE ZAPRT — na tuji fotki cm NISO
//      izmerjeni, zato skript NE vtipka številke; zahteva, da aplikacija to
//      pove z besedami.
//
// NE POKRIVA (in ne trdi, da pokriva):
//   · izrisa in izvoza na PRAVI fotki — cm na njej niso izmerjeni, zato so
//      vrata zaklenjena in skript to EXPECTIRA (točka 4 zgoraj); celotna pot
//      do PNG-ja je dokazana na konstruirani sliki v `e2e-fotomontaza-full.ts`;
//   · nobena centimeterska trditev in nobena količina materiala;
//   · primeri IZVEN obsega (06, 14, 20, 22) — njihova dolžnost je ZAVRNITEV,
//      kar meri jedrna sonda, ne ta skript;
//   · mobilni prelom in vlečenje oglišč (pokrito v `e2e-band-ui.ts`).
//
// ZASEBNOST (trditev, ne namen): fotke kažejo tuje hiše in NISO v repozitoriju.
// Skript jih bere z diska (pot iz argumenta), v brskalnik jih vstavi prek
// `DataTransfer`, vsak artifact (posnetek) pa zapiše v `os.tmpdir()`. Vedno
// gre prek `guardOutSideRepo`, ki zapiše v repozitorij kot IZJEMA, ne kot
// opozorilo.
//
// Zagon:  bun tests/e2e-fotomontaza-real.ts <mapa-s-fotkami>
//    ali  ROKSAL_GT_PHOTOS=<mapa> bun tests/e2e-fotomontaza-real.ts
// Brez fotk skript zaključi z izhodno kodo 2 in ne izpiše nobene meritve — to je
// pravilo `tests/gt/`, ki preprečuje lažno zeleno. Skript NI del sweepa
// `tests/verify/` (sweep mora teči brez mreže in brez fotk).

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GT_CASES, type GtCase } from './gt/gt-quads';
import { photoPath, median } from './gt/harness';
import { suggestBandQuadPct } from '../src/lib/band-suggest';

const OUT = path.join(os.tmpdir(), 'obrtnik-pro-e2e-real');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Zamrznjena baza (tests/gt/outputs/2026-10-16-sonda1-bazeline.txt, varianta
// »končni modul«). Vrednosti so NAPAKE V ODSTOTKIH VIŠINE SLIKE na levem
// oglišču (zg/sp) — kopirane iz zamrznjenega izpisa, da jih ta skript ne more
// tiho spremeniti skupaj s kodo.
const FROZEN: Record<string, { top: number; bottom: number }> = {
  '../fb-hi/04.jpg': { top: 10.1, bottom: 0.8 },
  '../fb-hi/16.jpg': { top: 1.3, bottom: 2.3 },
};
const MEDIAN_BASE = 2.3;
const MAX_BASE = 10.1;

// Delovna kopija aplikacije (src/lib/image-quality.ts:28, MAX_DIM in
// JPEG_QUALITY sta modulska konstanta, ne izvoz) — skript jih mora ponoviti,
// sicer se jedrna primerjava meri na drugih pikslih kot v brskalniku.
const MAX_DIM = 1280;
const JPEG_Q = 0.82;

const PORT = 9338;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe` : undefined,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  const got = rest.length === 1 ? rest[0] : rest.length > 1 ? rest : cond;
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(got).slice(0, 240))}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const abs = (v: number): number => Math.abs(v);

// ZASEBNOST: noben artifact ne sme pristati v repozitoriju.
function guardOutSideRepo(p: string): string {
  const root = path.resolve(process.cwd());
  const rp = path.resolve(p);
  if (rp === root || rp.startsWith(root + path.sep)) {
    throw new Error(`ZASEBNOST: artifact bi bil zapisan v repozitorij: ${rp}`);
  }
  return rp;
}

/** GT tirnici v ODDSTOTKIH višine slike — isti račun kot sonda 1
 *  (`probe-band-module.ts:27`), le brez delitve z H, ker je enota že %. */
function gtRails(c: GtCase) {
  const p = c.quad.map(([x, y]) => ({ x, y }));
  const seg = (a: number, b: number) => {
    const [l, r] = p[a].x <= p[b].x ? [p[a], p[b]] : [p[b], p[a]];
    return { yl: l.y, yr: r.y };
  };
  return { top: seg(0, 1), bottom: seg(3, 2) };
}

/** Tapki sta IZPELJANI iz GT (težišče + 30 % širine), ne ročno nastavljani —
 *  isto izbirno pravilo kot sonda 1 (`cx, cy, half = |x1-x0| * 0.3`), da sta
 *  meritvi primerljivi. */
function tapsFor(c: GtCase) {
  const xs = c.quad.map((q) => q[0]);
  const ys = c.quad.map((q) => q[1]);
  const cx = xs.reduce((a, b) => a + b, 0) / 4;
  const cy = ys.reduce((a, b) => a + b, 0) / 4;
  const half = Math.abs(xs[1] - xs[0]) * 0.3;
  return { xL: cx - half, xR: cx + half, y: cy };
}

/** Jedrna referenca NA ISTIH BAJTIH: aplikatinina delovna kopija (≤1280 px,
 *  JPEG 0,82) → extractFeatures(256) → suggestBandQuadPct. */
async function coreReference(c: GtCase) {
  const sharp = (await import('sharp')).default;
  const buf = await sharp(photoPath(c.file))
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: Math.round(JPEG_Q * 100) }) // sharp meri kakovost 1..100, canvas 0..1
    .toBuffer();
  const { data, info } = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const img = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  const t = tapsFor(c);
  const res = suggestBandQuadPct(img, { xPct: t.xL, yPct: t.y }, { xPct: t.xR, yPct: t.y });
  if (!res) return null;
  return {
    topPct: (res.quadPct[0][1] + res.quadPct[1][1]) / 2,
    bottomPct: (res.quadPct[2][1] + res.quadPct[3][1]) / 2,
    workH: res.H,
  };
}

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try {
      fs.accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!bin) throw new Error(`chromium binary ni najden (poskusi: ${CHROME_CANDIDATES.join(', ')})`);
  console.log(`browser: ${bin}`);
  return spawn(
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--user-data-dir=${path.join(OUT, 'profile')}`,
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], detached: false },
  );
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {
      // še ni gor
    }
    await sleep(250);
  }
  throw new Error('CDP ni postal dosegljiv');
}

interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
  errors(): string[];
}

function connectCdp(wsUrl: string): Promise<CdpLike> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const errs: string[] = [];
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    ws.onopen = () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            id += 1;
            const myId = id;
            pending.set(myId, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: myId, method, params }));
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId);
                rej(new Error(`CDP timeout: ${method}`));
              }
            }, 60_000);
          });
        },
        close: () => ws.close(),
        errors: () => errs,
      });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
        result?: Record<string, unknown>;
      };
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id) as { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        // Razpakira se ENKROT: odziv je { id, result }. { params } je samo za
        // evente; zamešanje je v prejšnjem skriptu tiho napisalo nič posnetkov.
        else p.resolve((msg as { result?: Record<string, unknown> }).result ?? {});
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const args = (msg.params.args ?? []) as { value?: unknown; description?: string }[];
        errs.push(args.map((a) => String(a.value ?? a.description ?? '')).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = (msg.params as { exceptionDetails?: { text?: string } })?.exceptionDetails;
        errs.push(d?.text ?? 'exception');
      }
    };
    ws.onerror = () => reject(new Error('WS napaka'));
  });
}

interface UiResult {
  quad: [number, number][];
  dash: string | null;
  dimsText: string;
  statusText: string;
}

async function main(): Promise<void> {
  // ── Vrata: manjkajoči dokazi so glasna napaka (pravilo tests/gt/). ──
  const dirRaw = process.argv[2] ?? process.env.ROKSAL_GT_PHOTOS ?? '';
  if (!dirRaw) {
    console.error(
      '\nMANJKA FOTOKORPUS. Pot do map s fotkami je obvezna:\n' +
        '  bun tests/e2e-fotomontaza-real.ts <mapa-s-fotkami>\n' +
        'ali  ROKSAL_GT_PHOTOS=<mapa-s-fotkami> bun tests/e2e-fotomontaza-real.ts\n' +
        'Brez fotk skript ne meri ničesar in zato ne izpiše nobene meritve.\n',
    );
    process.exit(2);
  }
  if (!fs.existsSync(dirRaw)) {
    console.error(`\nFOTOKORPUS NE OBSTAJA: ${dirRaw}\n`);
    process.exit(2);
  }

  const cases = GT_CASES.filter((c) => c.inScope && c.frontal && FROZEN[c.file]);
  if (cases.length === 0) {
    console.error('\nNIT V OBSEGU s zamrznjeno bazno meritvijo — ni kaj primerjati.\n');
    process.exit(2);
  }
  for (const c of cases) {
    const p = photoPath(c.file);
    if (!fs.existsSync(p)) {
      console.error(`\nFOTKA MANJKA: ${p}\nSkript ne more meriti proti GT brez nje.\n`);
      process.exit(2);
    }
  }
  try {
    if (!(await fetch(APP, { method: 'HEAD' })).ok) throw new Error('!ok');
  } catch {
    console.error(`NAPAKA: aplikacija ne teče na ${APP} — zaženi \`bun run dev\` in poženji to znova.`);
    process.exit(2);
  }

  // Jedrne reference se izračunajo NA DISKU (bun + sharp), brez brskalnika.
  const refs = new Map<string, Awaited<ReturnType<typeof coreReference>>>();
  for (const c of cases) refs.set(c.file, await coreReference(c));

  const chrome = launchChrome();
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('page target ni najden');
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        | { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }
        | undefined;
      const exc = r?.exceptionDetails;
      if (exc) throw new Error(`Eval napaka: ${exc.exception?.description ?? exc.text}`);
      return r?.result?.value;
    };
    const textOf = async (testid: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? (e.textContent || '') : '__MISSING__'; })()`,
        ),
      );
    const exists = async (testid: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector('[data-testid="${testid}"]')`)) === true;
    const disabledOf = async (testid: string): Promise<boolean | null> => {
      const v = await evaluate(
        `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? !!e.disabled : null; })()`,
      );
      return v === null || v === undefined ? null : Boolean(v);
    };
    const clickTestid = async (testid: string): Promise<string> =>      String(
        await evaluate(
          `(() => { const e = document.querySelector('[data-testid="${testid}"]'); if (!e) return 'NOT_FOUND'; e.click(); return 'OK'; })()`,
        ),
      );
    const clickByText = async (text: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()`,
        ),
      );
    const valueOf = async (testid: string): Promise<string | null> => {
      const v = await evaluate(
        `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? String(e.value) : null; })()`,
      );
      return v === null || v === undefined ? null : String(v);
    };

    const readQuad = async (): Promise<{ quad: [number, number][]; dash: string | null }> => {
      const v = (await evaluate(
        `(() => {
          const p = document.querySelector('[data-testid="fr-stage"] svg polygon');
          return p ? { points: p.getAttribute('points') || '', dash: p.getAttribute('stroke-dasharray') } : { points: '', dash: null };
        })()`,
      )) as { points: string; dash: string | null } | undefined;
      if (!v) throw new Error('branje kvadrata ni vrnilo objekta (prazen CDP odgovor)');
      const quad = v.points
        .trim()
        .split(/\s+/)
        .filter((s) => s.includes(','))
        .map((pt) => pt.split(',').map(Number) as [number, number]);
      return { quad, dash: v.dash };
    };

    // EN klik = ENA CDP okrogla pot. Dva klika v isti JS vrsti prebereta še
    // neposodobljen `bandTaps` in zmerita izmišljen pas (izmerjeno v Task 73).
    const tapStage = async (xPct: number, yPct: number): Promise<void> => {
      await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-stage"]'); e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
      await sleep(250);
      const r = (await evaluate(
        `(() => { const e = document.querySelector('[data-testid="fr-stage"]'); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`,
      )) as { x: number; y: number; w: number; h: number } | undefined;
      if (!r || !Number.isFinite(r.w) || r.w <= 0 || r.h <= 0) throw new Error('oder (fr-stage) nima mer');
      const x = r.x + (r.w * xPct) / 100;
      const y = r.y + (r.h * yPct) / 100;
      const vp = (await evaluate('({ iw: window.innerWidth, ih: window.innerHeight })')) as { iw: number; ih: number };
      if (x < 0 || x > vp.iw || y < 0 || y > vp.ih) throw new Error(`klik (${x.toFixed(0)}, ${y.toFixed(0)}) zunaj viewporta ${vp.iw}×${vp.ih}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };

    const shot = async (name: string): Promise<string> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!r.data) throw new Error(`captureScreenshot vrnil ni bajtov za ${name}`);
      const p = guardOutSideRepo(path.join(OUT, name));
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      check(`posnetek napisan IZVEN repozitorija: ${name}`, fs.statSync(p).size > 5000, `bajtov ${fs.statSync(p).size}`);
      return p;
    };

    /** Naloži fotko iz diska kot data URL prek pravega `input[type=file]`. */
    const injectPhoto = async (file: string): Promise<string> => {
      const b64 = fs.readFileSync(photoPath(file)).toString('base64');
      const name = file.split('#')[0].split('/').pop() ?? 'fotka.jpg';
      return String(
        await evaluate(
          `(() => {
            const dataUrl = 'data:image/jpeg;base64,' + ${JSON.stringify(b64)};
            const btn = document.querySelector('[data-testid="fr-upload"]');
            const scope = btn ? btn.parentElement : null;
            const input = (scope && scope.querySelector('input[type=file]')) || document.querySelector('input[type=file]');
            if (!input) return 'NO_INPUT';
            const bin = atob(dataUrl.split(',')[1]);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const f = new File([u8], ${JSON.stringify(name)}, { type: 'image/jpeg' });
            const dt = new DataTransfer();
            dt.items.add(f);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return 'OK';
          })()`,
        ),
      );
    };

    const openTab = async (): Promise<void> => {
      await cdp.send('Page.navigate', { url: APP });
      await sleep(3500);
      check('vstop v kamero', (await clickByText('Pametna kamera')) === 'OK', 'klik');
      await sleep(1400);
      const tab = (await clickTestid('tab-fotomontaza')) === 'OK' ? 'OK' : await clickByText('Fotomontaža');
      check('zavihek Fotomontaža', tab === 'OK', tab);
      await sleep(900);
      check('izbor fotke na voljo', await exists('fr-upload'), 'fr-upload');
    };

    const runCase = async (c: GtCase): Promise<UiResult | null> => {
      const t = tapsFor(c);
      console.log(`\n──── ${c.file} — ${c.what}`);
      const inj = await injectPhoto(c.file);
      check(`${c.file}: fotka naložena prek pravega inputa`, inj === 'OK', inj);
      await sleep(3200);
      check(`${c.file}: oder nastal`, await exists('fr-stage'), 'fr-stage');
      const dimsText = await textOf('fr-dims');
      console.log(`  (dimenzije aplikacije: ${dimsText.replace(/\s+/g, ' ').trim()} — delovna kopija ≤ ${MAX_DIM} px)`);

      check(`${c.file}: orodje Pas`, (await clickTestid('fr-tool-band')) === 'OK', 'klik');
      await sleep(400);
      await tapStage(t.xL, t.y);
      await sleep(450);
      await tapStage(t.xR, t.y);
      await sleep(2000);

      const { quad, dash } = await readQuad();
      if (quad.length !== 4) {
        check(`${c.file}: predlog rodí 4 oglišča`, false, `točk ${quad.length} — detektor je na pravi fotki zavrnil`);
        return null;
      }
      check(`${c.file}: predlog rodí 4 oglišča`, true, 'ok');
      check(`${c.file}: nepotrjen predlog je črtkan`, dash !== null && dash !== '', dash ?? 'null');
      const statusText = await textOf('fr-quad-status');
      check(`${c.file}: značka pravi ŠE NI potrjen`, statusText.includes('ŠE NI potrjen'), statusText.replace(/\s+/g, ' ').slice(0, 140));
      check(`${c.file}: panel za potrditev obstaja`, await exists('fr-confirm-suggestion'), 'fr-confirm-suggestion');

      // 3. STRANI KVADRATA = KLIKA, ne detektor.
      const xs = quad.map((q) => q[0]);
      check(
        `${c.file}: leva stran je ENAKA kliku (${t.xL.toFixed(1)} %)`,
        abs(Math.min(...xs) - t.xL) <= 0.6,
        `min x ${Math.min(...xs).toFixed(2)}`,
      );
      check(
        `${c.file}: desna stran je ENAKA kliku (${t.xR.toFixed(1)} %)`,
        abs(Math.max(...xs) - t.xR) <= 0.6,
        `max x ${Math.max(...xs).toFixed(2)}`,
      );

      await shot(`real-${(c.file.split('/').pop() ?? 'x').replace('.jpg', '')}-predlog.png`);
      return { quad, dash, dimsText, statusText };
    };

    // ── Vsi v obsegu čelni primeri: ponovljivost zamrznjene baze ──
    await openTab();
    const errLeft: number[] = [];
    const uiRails = new Map<string, { top: number; bottom: number }>();
    let first: { c: GtCase; r: UiResult } | null = null;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (i > 0) await openTab(); // čisto stanje: nova fotka ponastavi ravnino
      const r = await runCase(c);
      if (!r) continue;
      const gt = gtRails(c);
      const top = (r.quad[0][1] + r.quad[1][1]) / 2;
      const bottom = (r.quad[2][1] + r.quad[3][1]) / 2;
      uiRails.set(c.file, { top, bottom });
      const eTopL = top - gt.top.yl;
      const eBotL = bottom - gt.bottom.yl;
      const eTopR = top - gt.top.yr;
      const eBotR = bottom - gt.bottom.yr;
      errLeft.push(abs(eTopL), abs(eBotL));
      console.log(
        `  (GT napaka: L zg ${eTopL >= 0 ? '+' : ''}${eTopL.toFixed(1)} / sp ${eBotL >= 0 ? '+' : ''}${eBotL.toFixed(1)} %, ` +
          `D zg ${eTopR >= 0 ? '+' : ''}${eTopR.toFixed(1)} / sp ${eBotR >= 0 ? '+' : ''}${eBotR.toFixed(1)} %)`,
      );

      // 1. PONOLVLJIVOST ZAMRZNJENE BAZE (sonda 1, levo oglišče).
      const fz = FROZEN[c.file];
      check(`${c.file}: zgornja tirnica se ujema z zamrznjeno bazo (±1,5 %)`, abs(eTopL - fz.top) <= 1.5, `napaka ${eTopL.toFixed(1)} %, baza ${fz.top} %`);
      check(`${c.file}: spodnja tirnica se ujema z zamrznjeno bazo (±1,5 %)`, abs(eBotL - fz.bottom) <= 1.5, `napaka ${eBotL.toFixed(1)} %, baza ${fz.bottom} %`);

      // 2. UI == JEDRO NA ISTIH BAJTIH (z delovno kopijo aplikacije).
      const ref = refs.get(c.file);
      if (!ref) {
        check(`${c.file}: jedrna referenca obstaja`, false, 'suggestBandQuadPct je vrnil null na disku');
      } else {
        const dTop = top - ref.topPct;
        const dBot = bottom - ref.bottomPct;
        const onePx = (1 / ref.workH) * 100;
        console.log(
          `  (jedro na disku: zg ${ref.topPct.toFixed(2)} / sp ${ref.bottomPct.toFixed(2)} %, delovna višina ${ref.workH} px, ` +
            `1 delovni piksel = ${onePx.toFixed(2)} %; razlika UI−jedro: zg ${dTop >= 0 ? '+' : ''}${dTop.toFixed(2)} / sp ${dBot >= 0 ? '+' : ''}${dBot.toFixed(2)} %)`,
        );
        // Toleranca je dvakratnik delovnega piksla: brskalnikov downscale in
        // sharpov nista identična, JPEG-koderja prav tako ne. Več kot to bi
        // pomenilo, da UI NE teče istega koda.
        check(`${c.file}: UI tirnici soglašata z jedrom (≤ 2 delovna piksla)`, abs(dTop) <= 2 * onePx && abs(dBot) <= 2 * onePx, `Δ ${dTop.toFixed(2)} / ${dBot.toFixed(2)} %`);
      }
      if (!first) first = { c, r };
    }

    check('vsaj dva v obsegu čelna primera zmerjena', uiRails.size >= 2, `primerov ${uiRails.size}`);
    const med = median(errLeft);
    const mx = Math.max(...errLeft);
    console.log(`\n  (V OBSEGU levo oglišče: mediana ${med.toFixed(1)} %, max ${mx.toFixed(1)} % — baza ${MEDIAN_BASE} / ${MAX_BASE})`);
    check('mediana napake ostane pri zamrznjeni bazi (±1,5 %)', abs(med - MEDIAN_BASE) <= 1.5, `mediana ${med.toFixed(1)} %`);
    check('MAX napake ne preseže zamrznjene baze (+1,5 %)', mx <= MAX_BASE + 1.5, `max ${mx.toFixed(1)} %`);

    // ── Nadaljevanje po VERIGI na prvi fotki: potrditev → maska → obnova →
    //    profil → in zaklenjena vrata izrisa, ker cm na tuji fotki NISO izmerjeni.
    if (!first) {
      check('veriga se lahko nadaljuje (obstaja vsaj en potrjen predlog)', false, 'noben primer ni rodil kvadrata');
    } else {
      const c = first.c;
      console.log(`\n──── ${c.file}: potrditev in vrata izrisa`);
      check('klik Potrdi predlog', (await clickTestid('fr-confirm-suggestion')) === 'OK', 'klik');
      await sleep(900);
      const st = await textOf('fr-quad-status');
      check('ravnina označena (4/4)', st.includes('ravnina označena'), st.replace(/\s+/g, ' ').slice(0, 140));
      const q2 = await readQuad();
      check('potrjen kvadrat ni več črtkan', q2.dash === null || q2.dash === '', q2.dash ?? 'null');
      check('panel za potrditev je izginil', !(await exists('fr-confirm-suggestion')), 'fr-confirm-suggestion');
      // Nameo: vneska cm OSTATA prazna. Na tuji fotki nimamo trakova, zato bi
      // vsaka številka tu bila izmišljena mera — skript je dolžan dokazati, da
      // je NI vnesel, ne le trditi.
      const wRaw = await valueOf('fr-plane-w');
      const hRaw = await valueOf('fr-plane-h');
      check('vneska cm ostaneta PRAZNA (nobena izmišljena mera)', wRaw === '' && hRaw === '', `w="${wRaw}" h="${hRaw}"`);

      check('korak 3: `fr-auto-suggest` omogočen', (await disabledOf('fr-auto-suggest')) === false, 'disabled');
      check('korak 3: klik Samodejno predlagaj', (await clickTestid('fr-auto-suggest')) === 'OK', 'klik');
      await sleep(2200);
      const cov = await textOf('fr-coverage');
      const covNum = Number((cov.match(/Pokritost čez štirikotnik:\s*([^%]+)%/)?.[1] ?? 'NaN').trim());
      check('korak 3: pokritost maske izmerjena (0 < p ≤ 100)', Number.isFinite(covNum) && covNum > 0 && covNum <= 100, cov.replace(/\s+/g, ' ').slice(0, 160));

      check('korak 4: klik Odstrani staro ograjo', (await clickTestid('fr-inpaint')) === 'OK', 'klik');
      await sleep(4500);
      const inp = await textOf('fr-inpaint-status');
      const inpClean = inp.replace(/\s+/g, ' ');
      const okBranch = inp.includes('Ozadje obnovljeno');
      check('korak 4: status je ENA dveh iskrenih vej (ok ALI ročna pot)', okBranch || inp.includes('ročni'), inpClean.slice(0, 200));
      const inpCov = Number((inp.match(/pokritost maske (\d+)\s*% fotke/)?.[1] ?? 'NaN'));
      console.log(`  (obnova: veja ${okBranch ? 'ok' : 'manualna'}, ${inpClean.slice(0, 120)}; pokritost fotke ${inpCov} %, prag manual-required 18 %)`);
      // Ročna veja mora IMENOVATI številko, ki jo je prerežala — sicer je
      // «prevelik pas» trditev brez dokaza.
      const manualPct = Number(inp.match(/skritih >\s*(\d+)\s*%/)?.[1] ?? 'NaN');
      if (!okBranch) check('korak 4: ročna veja IMENUJE merjeni delež fotke', manualPct === 18, `prebrano ${manualPct}`);
      check('korak 4: invarianta — status `ok` pomeni pokritost fotke ≤ 18 %', !okBranch || (Number.isFinite(inpCov) && inpCov <= 18), `pokritost ${inpCov} %`);

      check('korak 5: profil wpc-deka-140 obstaja', await exists('fr-profile-wpc-deka-140'), 'fr-profile-wpc-deka-140');
      console.log(`  (profil onemogočen? disabled=${String(await disabledOf('fr-profile-wpc-deka-140'))})`);

      // 4. ZAKLENJENA VRATA: brez vnesene mere izris NI mogoč in aplikacija to
      //    pove z besedami. To je edina poštena končna to na tuji fotki — če bi
      //    skript vtipkal poljubno višino, bi bil izris lažna trditev.
      check('vrata: brez mere `fr-render` NE obstaja', !(await exists('fr-render')), 'fr-render');
      const blocker = (await textOf('fr-render-blocker')).replace(/\s+/g, ' ');
      // Ravnina je POTRJENA (4/4, dokaz zgoraj), edino, kar manjka, je mera. Če besedilo spet krivi oglišča, je to regresija, ki jo je
      // ta skript našel 2026-10-16 in jo je `band-ui-contract.ts` zaklenil.
      check('vrata: zavrnitev IMENUJE manjkajočo mero v cm', blocker.includes('Vnesi višino ravnine v cm'), blocker.slice(0, 200));
      check('vrata: zavrnitev NE krivi oglišč, ki so potrjena', !blocker.includes('Geometrija ravnine ni potrjena'), blocker.slice(0, 200));
      await shot('real-06-vrata-zaprt.png');
    }

    const errs = cdp.errors();
    check('konzola: brez JS napak in brez izjem', errs.length === 0, errs.slice(0, 2).join(' | '));
    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E (prava fotka): ${pass} uspešnih, ${fail} neuspešnih`);
  console.log(`dokazi na disku (IZVEN repozitorija, tuje hiše): ${OUT}`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
