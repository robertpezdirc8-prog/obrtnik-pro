// E2E NA PRAVI FOTOGRAFIJI — hiša z balkonom (Wikimedia Commons, CC BY-SA 2.0):
// ali fotomontaža na RESNIČNI fotografiji zamenja staro balkonsko ograjo z
// ROKSALovim profilom? Vsi dosedanji E2E-ji so risali na SINTETIČNI sliki, kjer
// je resnica konstruirana. Ta skript ne trdi, da je lepa — trdi, da tok
// (nalaganje → 4 oglišča → mere → maska → obnova → profil → izris → montažni
// list) na pravi fotki prehodi BREZ napak v konzoli in da izris nastane.
//
// ISKRENO: to NI meritev kakovosti. Kakovost fotomontaže je odvisna od tega,
// kako natančno monter označi oglišča in popravi masko — skript tega ne sodi,
// zato ne preverja videza, ampak samo, da so vrata po vrsti redu in da noben
// korak ne vrže napake. Za videz so priloženi posnetki (tests/e2e-real-*.png).
//
// Zagon: CHROME_PATH=... bun tests/e2e-real-photo.ts

import { spawn, type ChildProcess } from 'node:child_process';
import * as __vfyFs from 'node:fs';
import * as __vfyOs from 'node:os';
import * as __vfyPath from 'node:path';

const __vfyOutDir = __vfyPath.join(__vfyOs.tmpdir(), 'obrtnik-pro-e2e');
__vfyFs.mkdirSync(__vfyOutDir, { recursive: true });
const TMP = (name: string): string => __vfyPath.join(__vfyOutDir, name);
import { accessSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Pot do chromiuma: okoljska spremenljivka, nato Windows/macOS/Linux poti, na
// koncu kontejnerski playwright cache. Prva obstoječa zmaga — brez te liste je
// bil E2E vezan na en sam razvoj stroj (domači `CHROME_CANDIDATES` je imel
// samo Linux poti in na Windowsu ni mogel zagnati ničesar).
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe` : undefined,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

const PORT = 9335;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';

// Konstruirana resnica (glej glavo). Toleranca 1,5 % višine ≈ 3 px pri
// delovnih 192 px: pokriva zaokroževanje downscale-a, ne zgrešene črte.
const TOP_PCT = 50;
const BOTTOM_PCT = 75;
const LEFT_PCT = 20;
const RIGHT_PCT = 80;
const TOL_PCT = 1.5;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  const got = rest.length === 1 ? rest[0] : rest.length > 1 ? rest : cond;
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(got).slice(0, 220))}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try {
      accessSync(p);
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
      `--user-data-dir=${TMP('band-e2e-profile')}`,
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], detached: false },
  );
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
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
            }, 30_000);
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
        // Odziv CDP-ja je { id, result }, NE { params }. Prva verzija je vzela
        // `msg.params ?? msg` (celovit ovojn), kar je v RUNITI funkcije delovalo
        // po nesreči (brala so r.result.result) — Page.captureScreenshot pa je
        // bral r.data in je TIHO vrnil prazno: trije posnetki nikoli niso bili
        // napisani, preizkus pa zelen. Zato se zdaj razpakira ENKROT.
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

// Sintetična fotka se zriše V STRANI (canvas → dataURL → File → DataTransfer),
// zato E2E ne potrebuje fixture datoteke na disku in nobene absolutne poti.
//
// NOTRANJOST PASU NI PRAZNA, a mora biti REDKA. Prva verzija je imela letve na
// 24 px in je ZAVRNILA sam sebe (izmerjeno: E2E rdeč, nič štirikotnika). Računica
// brez zabrisa za to periodo da podporo 0,80 — pod pragom 0,85 — kar pomeni, da
// jo čez prag potegne zabris (downscale 800→256 in JPEG 0,82). Zabris kot
// mehanizem NI neposredno izmerjen; izmerjena je zavrnitev pri 24 px in uspeh pri
// 120 px, ki ima izračunano podporo 0,246.
// Pouk za naprej: notranji spoji smejo biti prisotni, a morajo biti REDKI glede
// na zabris delovne ločljivosti, sicer iskanje zadene »tirnico« en korak od
// tapke, pas je visok 2 px in minBandHeightFrac upravičeno zavrne.
const SYNTH = `(() => {
  const W = 800, H = 600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#d2d2d2'; g.fillRect(0, 0, W, 300);
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 300, W, 150);
  g.fillStyle = '#3c3c3c'; g.fillRect(0, 450, W, 150);
  g.fillStyle = '#8c8c8c';
  for (let x = 0; x < W; x += 120) g.fillRect(x, 300, 20, 150);
  return c.toDataURL('image/png');
})()`;

async function main(): Promise<void> {
  const chrome = launchChrome();
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl?: string;
    }[];
    const target = list.find((t) => t.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('ni strani v CDP seznamu');
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
        result?: { value?: unknown };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      };
      if (r?.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r?.result?.value;
    };
    const textOf = async (testid: string): Promise<string> =>
      String(await evaluate(`(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? (e.textContent || '') : '__MISSING__'; })()`));
    const exists = async (testid: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector('[data-testid="${testid}"]')`)) === true;
    const disabledOf = async (testid: string): Promise<boolean | null> => {
      const v = await evaluate(`(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? !!e.disabled : null; })()`);
      return v === null || v === undefined ? null : Boolean(v);
    };
    const clickTestid = async (testid: string): Promise<string> =>
      String(await evaluate(`(() => { const e = document.querySelector('[data-testid="${testid}"]'); if (!e) return 'NOT_FOUND'; e.click(); return 'OK'; })()`));
    const clickByText = async (text: string): Promise<string> =>
      String(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()`));
    const setInput = async (testid: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const el = document.querySelector('[data-testid="${testid}"]');
        if (!el) return 'NOT_FOUND';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`));
    const tapStage = async (xPct: number, yPct: number): Promise<void> => {
      await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-stage"]'); e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
      await sleep(250);
      const r = (await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-stage"]'); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`)) as { x: number; y: number; w: number; h: number };
      const x = r.x + (r.w * xPct) / 100;
      const y = r.y + (r.h * yPct) / 100;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    mkdirSync(join(process.cwd(), 'tests'), { recursive: true });
    const shot = async (name: string): Promise<void> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!r.data) throw new Error(`captureScreenshot brez bajtov za ${name}`);
      const p = join(process.cwd(), 'tests', name);
      writeFileSync(p, Buffer.from(r.data, 'base64'));
      check(`posnetek napisan: ${name}`, statSync(p).size > 5000, `bajtov ${statSync(p).size}`);
    };


    const PHOTO = join(process.cwd(), 'tests', 'fixtures', 'hisa-balkon-parkgate.jpg');
    const b64 = readFileSync(PHOTO).toString('base64');

    // ── 1) aplikacija → kamera → Fotomontaža → nalaganje PRAVE fotke ──
    await cdp.send('Page.navigate', { url: APP });
    await sleep(4000);
    check('prava fotka: naslov strani', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('prava fotka: vstop v kamero', (await clickByText('Pametna kamera')) === 'OK', 'klik');
    await sleep(1400);
    check('prava fotka: zavihek Fotomontaža', (await clickTestid('tab-fotomontaza')) === 'OK', 'klik');
    await sleep(900);

    const inj = String(await evaluate(`(() => {
      const input = document.querySelector('input[type=file]');
      if (!input) return 'NO_INPUT';
      const bin = atob(${JSON.stringify(b64)});
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'hisa-balkon.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    })()`));
    check('prava fotka: naložena prek pravega inputa', inj === 'OK', inj);
    await sleep(3200);
    check('prava fotka: dimenzije prebrane (1200)', (await textOf('fr-dims')).includes('1200'), await textOf('fr-dims'));
    await shot('e2e-real-01-fotka.png');

    // ── 2) ročno označena oglišča balkonske ograje + mere ──
    check('prava fotka: orodje Oglišča', (await clickTestid('fr-tool-corners')) === 'OK', 'klik');
    await sleep(300);
    for (const [xp, yp] of [[57.5, 50.5], [87, 45.5], [87, 52.5], [57.5, 57]] as [number, number][]) {
      await tapStage(xp, yp);
      await sleep(350);
    }
    check('prava fotka: ravnina označena (4/4)', (await textOf('fr-quad-status')).includes('ravnina označena'), await textOf('fr-quad-status'));
    check('prava fotka: mere vnesene (350 × 100)', (await setInput('fr-plane-w', '350')) === 'OK' && (await setInput('fr-plane-h', '100')) === 'OK', 'vnos');
    await sleep(700);
    check('prava fotka: ravnina kalibrirana', (await textOf('fr-plane-status')).includes('Kalibrirano'), await textOf('fr-plane-status'));
    await shot('e2e-real-02-ravnina.png');

    // ── 3) samodejna maska (na pravi fotki je NE moremo jamčiti) ──
    check('prava fotka: samodejni predlog je omogočen', (await disabledOf('fr-auto-suggest')) === false, 'disabled');
    check('prava fotka: klik Samodejno predlagaj', (await clickTestid('fr-auto-suggest')) === 'OK', 'klik');
    await sleep(2200);
    const cov = await textOf('fr-coverage');
    const covNum = Number((cov.match(/Pokritost čez štirikotnik:\s*([^%]+)%/)?.[1] ?? 'NaN').trim());
    // Iskreno: hevristika na realni fotki lahko pokrije malo ali veliko — preverjamo
    // samo, da je številka IZMERJENA in v mejah, ne da je »pravilna«.
    check('prava fotka: pokritost maske je izmerjena (0 < p ≤ 100)', Number.isFinite(covNum) && covNum > 0 && covNum <= 100, cov.slice(0, 160));
    await shot('e2e-real-03-maska.png');

    // ── 4) obnova ozadja ──
    check('prava fotka: klik Odstrani staro ograjo', (await clickTestid('fr-inpaint')) === 'OK', 'klik');
    await sleep(4500);
    const inp = await textOf('fr-inpaint-status');
    check('prava fotka: obnova vrne ENO iskreno vej (ok ali ročno)', inp.includes('Ozadje obnovljeno') || inp.includes('ročni'), inp.slice(0, 200));
    await shot('e2e-real-04-obnova.png');

    // ── 4b) PREPOZNAJ STARO OGRAJO (kaj kamera gleda) ──
    check('prepoznavanje: gumb je', (await clickTestid('fr-recognise')) === 'OK', 'klik');
    await sleep(700);
    const recMat = await textOf('fr-recognise-material');
    const recOri = await textOf('fr-recognise-orientation');
    const recScr = await textOf('fr-recognise-screws');
    check('prepoznavanje: material je povedan', recMat.startsWith('material:'), recMat);
    check('prepoznavanje: orientacija je povedana', recOri.startsWith('deske:'), recOri);
    check('prepoznavanje: vijaki so prešteti', recScr.startsWith('vijaki:'), recScr);
    check('prepoznavanje: zanesljivost je navedena', (await textOf('fr-recognise-confidence')).startsWith('zanesljivost:'), '');

    // ── 5) profil + razmak stebrov + 6) izris ──
    const pid = 'fr-profile-polna-100';
    check('prava fotka: profil polna-100 na voljo', await exists(pid), pid);
    check('prava fotka: klik profila', (await clickTestid(pid)) === 'OK', 'klik');
    await sleep(500);
    // Razmak stebrov: vnesen → stebri in spoj na stebru v renderju
    check('prava fotka: vnos razmaka stebrov', (await setInput('fr-post-every', '150')) === 'OK', 'vnos');
    await sleep(700);
    check('prava fotka: gumb Upodobi obstaja', await exists('fr-render'), 'fr-render');
    check('prava fotka: klik Upodobi', (await clickTestid('fr-render')) === 'OK', 'klik');
    await sleep(5000);
    check('prava fotka: rezultat nastane (platno)', await exists('fr-result-canvas'), 'fr-result-canvas');
    await shot('e2e-real-05-rezultat.png');
    // Dokaz, da je izris RES nastal: posnetek SAMO platna (brez UI), da se vidi
    // zamenjana ograja. Klip iz rect-a elementa — enako, kot bi monter videl v koraku 7.
    const rect = (await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-result-canvas"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height }; })()`)) as { x: number; y: number; w: number; h: number } | null;
    if (rect && rect.w > 50 && rect.h > 50) {
      const r2 = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } })) as { data?: string };
      if (r2.data) {
        const p = join(process.cwd(), 'tests', 'e2e-real-06-izris.png');
        writeFileSync(p, Buffer.from(r2.data, 'base64'));
        check('posnetek napisan: e2e-real-06-izris.png', statSync(p).size > 5000, `bajtov ${statSync(p).size}`);
      }
    }

    // ── 7) montažni list (novi panel) na PRAVIH merah ──
    check('prava fotka: panel montažnega lista', await exists('fr-installer-sheet'), 'fr-installer-sheet');
    check('prava fotka: vnos razmaka stebrov', (await setInput('fr-sheet-bay', '150')) === 'OK', 'vnos');
    await sleep(500);
    const kpi = await textOf('fr-sheet-kpi');
    check('prava fotka: KPI lista izračunan', /Stebrov\s*4/.test(kpi) && /Celot\s*3/.test(kpi) && /Desk\s*28/.test(kpi), kpi);
    check('prava fotka: gumb za sporočilo monterju je', (await disabledOf('fr-sheet-message')) === false, 'fr-sheet-message');
    check('prava fotka: gumb za prenos HTML je', (await disabledOf('fr-sheet-download')) === false, 'fr-sheet-download');
    // Posnetek panela z listom (za dokumentacijo v PR-ju)
    await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-installer-sheet"]'); if (e) e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
    await sleep(400);
    await shot('e2e-real-07-panel.png');

    const errs = cdp.errors();
    check('prava fotka: konzola brez napak', errs.length === 0, errs.slice(0, 2).join(' | '));
    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E (prava fotografija — balkon): ${pass} uspešnih, ${fail} neuspešnih`);
  console.log('dokazi: tests/e2e-real-*.png · vir fotografije: tests/fixtures/ATTRIBUTION.md');
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

