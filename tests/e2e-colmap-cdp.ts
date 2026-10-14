// E2E za 3D model (COLMAP) — čist CDP prek WebSocket (bun), brez agent-browser.
// Zlatа pot: uvoz 3 datotek (DataTransfer injekcija) → par po ID 1→2 →
// kalibracija 100 cm → par 2→3 (80 cm) → par 1→6 (2,00 m) → zaključi →
// meritve v Pripomočkih z značko 3D. Resnica fixture: 1 enota = 40 cm.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux/chrome',
  '/home/z/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
];
const PORT = 9333;
const APP = 'http://localhost:3000/';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  const got = rest.length === 1 ? rest[0] : rest.length > 1 ? rest : cond;
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(got).slice(0, 160))}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Chrome zagon (WebGL onemogočen — glava brez 3D izrisa, merjenje deluje) ──
function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try {
      accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!bin) throw new Error('chromium binary ni najden');
  rmSync('/tmp/colmap-e2e', { recursive: true, force: true });
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--disable-webgl',
      '--disable-webgl2',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--user-data-dir=/tmp/colmap-e2e`,
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], detached: false },
  );
  return child;
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 40; i++) {
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
  onConsoleError(cb: (text: string) => void): void;
}

function connectCdp(wsUrl: string): Promise<CdpLike> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    const consoleErrors: string[] = [];
    const errorCbs: ((t: string) => void)[] = [];
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
        onConsoleError(cb) {
          errorCbs.push(cb);
        },
      });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        error?: { message: string };
        method?: string;
        params?: { type?: string; text?: string };
      };
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id) as { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.params ?? msg);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = String(msg.params.text ?? '');
        consoleErrors.push(text);
        errorCbs.forEach((cb) => cb(text));
      }
    };
    ws.onerror = () => reject(new Error('WS napaka'));
  });
}

async function main(): Promise<void> {
  const chrome = launchChrome();
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
      url: string;
    }[];
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('page target ni najden');
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })) as unknown as {
        result?: {
          result?: { value?: unknown; type?: string };
          exceptionDetails?: { text: string; exception?: { description?: string } };
        };
      };
      const remote = r.result?.result;
      const exc = r.result?.exceptionDetails;
      if (exc) throw new Error(`Eval napaka: ${exc.exception?.description ?? exc.text}`);
      if (remote === undefined) {
        console.log(`[debug] undefined odgovor za: ${expr.slice(0, 90).replace(/\n/g, ' ')}`);
      }
      return remote?.value;
    };

    const clickByText = (selector: string, text: string): string => `
      (() => {
        const els = [...document.querySelectorAll('${selector}')];
        const el = els.find((e) =>
          (e.textContent || '').includes('${text}') ||
          (e.getAttribute('aria-label') || '').includes('${text}'));
        if (!el) return 'NOT_FOUND:${text}';
        el.click();
        return 'OK';
      })()`;

    const setInputValue = (ariaLabel: string, value: string): string => `
      (() => {
        const el = document.querySelector('input[aria-label="${ariaLabel}"]')
          ?? [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === '${ariaLabel}');
        if (!el) return 'NOT_FOUND:${ariaLabel}';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '${value}');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`;

    // 1) Odpri aplikacijo + kamera + zavihek 3D model
    await cdp.send('Page.navigate', { url: APP });
    await sleep(3500);
    check('navigacija: naslov', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'), 'vrednost');
    check('kamera klik', String(await evaluate(clickByText('button', 'Pametna kamera'))) === 'OK', 'klik');

    await sleep(1200);
    check('3D model zavihek klik', String(await evaluate(clickByText('button', '3D model'))) === 'OK', 'klik');

    await sleep(700);
    check(
      '3D model panel viden',
      String(await evaluate("document.body.textContent.includes('3D model objekta (COLMAP)')")) === 'true',
      'panel',
    );

    // 2) Injekcija treh datotek (DataTransfer — bypass file chooser)
    const b64 = (p: string): string => readFileSync(p).toString('base64');
    const dir = join(process.cwd(), 'tests', 'colmap-fixture');
    const injectOne = (label: string, b: string): string => `
      (() => {
        const input = document.querySelector('input[aria-label="Uvozi ${label}"]');
        if (!input) return 'MISSING:${label}';
        const dt = new DataTransfer();
        dt.items.add(new File([atob('${b}')], '${label}', { type: 'text/plain' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`;
    const r1 = await evaluate(injectOne('cameras.txt', b64(join(dir, 'cameras.txt'))));
    await sleep(500);
    const r2 = await evaluate(injectOne('images.txt', b64(join(dir, 'images.txt'))));
    await sleep(500);
    const r3 = await evaluate(injectOne('points3D.txt', b64(join(dir, 'points3D.txt'))));
    await sleep(2000);
    check('uvozi cameras.txt', r1 === 'OK', r1, 'vrednost');
    check('uvozi images.txt', r2 === 'OK', r2, 'vrednost');
    check('uvozi points3D.txt', r3 === 'OK', r3, 'vrednost');
    const summary = String(await evaluate(
      "([...document.querySelectorAll('[role=status]')].map((e) => e.textContent || '').find((t) => t.includes('Model naložen')) || '')",
    ));
    check('povzetek: 3 fotk, 1 kamer, 8 točk', summary.includes('3 fotk, 1 kamer, 8 točk'), summary, 'vrednost');

    // 3) Par 1→2 (pred kalibracijo → enote)
    check('ID A = 1', String(await evaluate(setInputValue('ID točke A', '1'))) === 'OK', 'vnos');

    check('ID B = 2', String(await evaluate(setInputValue('ID točke B', '2'))) === 'OK', 'vnos');

    check('Postavi par klik', String(await evaluate(clickByText('button', 'Postavi par točk po ID'))) === 'OK', 'klik');

    await sleep(700);
    const pair1 = String(await evaluate(
      "([...document.querySelectorAll('[role=status]')].map((e) => e.textContent || '').find((t) => t.includes('Par 1 → 2')) || '')",
    ));
    check('par 1→2 v enotah (2,5)', pair1.includes('Par 1 → 2') && pair1.includes('2,5'), pair1, 'vrednost');

    // 4) Kalibracija: znana dolžina 100 cm → 1 enota = 40 cm
    check('ref vnos 100', String(await evaluate(setInputValue('Znana dolžina med točkama v centimetrih', '100'))) === 'OK', 'vrednost');
    check('Kalibriraj klik', String(await evaluate(clickByText('button', 'Kalibriraj merilo'))) === 'OK', 'vrednost');
    await sleep(700);
    const pair1c = String(await evaluate(
      "([...document.querySelectorAll('[role=status]')].map((e) => e.textContent || '').find((t) => t.includes('Par 1 → 2')) || '')",
    ));
    check('par 1→2 po kalibraciji = 1,00 m (100 cm)', pair1c.includes('1,00 m'), pair1c, 'vrednost');
    const scaleNote = String(await evaluate("document.body.textContent.includes('1 enota = 40 cm')"));
    check('merilo izpisano (1 enota = 40 cm)', scaleNote === 'true', scaleNote, 'vrednost');

    // 5) Dodaj 3D 1
    check('Dodaj meritev klik', String(await evaluate(clickByText('button', 'Dodaj razdaljo v seznam'))) === 'OK', 'vrednost');
    await sleep(500);

    // 6) Par 2→3 = 80 cm
    check('ID A = 2', String(await evaluate(setInputValue('ID točke A', '2'))) === 'OK', 'vrednost');
    check('ID B = 3', String(await evaluate(setInputValue('ID točke B', '3'))) === 'OK', 'vrednost');
    check('Postavi par klik (2→3)', String(await evaluate(clickByText('button', 'Postavi par točk po ID'))) === 'OK', 'vrednost');
    await sleep(700);
    const pair2 = String(await evaluate(
      "([...document.querySelectorAll('[role=status]')].map((e) => e.textContent || '').find((t) => t.includes('Par 2 → 3')) || '')",
    ));
    check('par 2→3 = 80 cm', pair2.includes('80 cm'), pair2, 'vrednost');
    check('Dodaj meritev (2)', String(await evaluate(clickByText('button', 'Dodaj razdaljo v seznam'))) === 'OK', 'vrednost');
    await sleep(500);

    // 7) Par 1→6 = 200 cm → "2,00 m"
    check('ID A = 1', String(await evaluate(setInputValue('ID točke A', '1'))) === 'OK', 'vnos');

    check('ID B = 6', String(await evaluate(setInputValue('ID točke B', '6'))) === 'OK', 'vrednost');
    check('Postavi par klik (1→6)', String(await evaluate(clickByText('button', 'Postavi par točk po ID'))) === 'OK', 'vrednost');
    await sleep(700);
    const pair3 = String(await evaluate(
      "([...document.querySelectorAll('[role=status]')].map((e) => e.textContent || '').find((t) => t.includes('Par 1 → 6')) || '')",
    ));
    check('par 1→6 = 2,00 m', pair3.includes('2,00 m'), pair3, 'vrednost');
    check('Dodaj meritev (3)', String(await evaluate(clickByText('button', 'Dodaj razdaljo v seznam'))) === 'OK', 'vrednost');
    await sleep(500);

    // 8) Zaključi in shrani (3) → meritve kamere
    const finishBtn = String(await evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Zaključi in shrani')); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()",
    ));
    check('Zaključi in shrani klik', finishBtn === 'OK', finishBtn, 'vrednost');
    await sleep(900);

    // 9) Pripomočki → seznam meritev z značko 3D
    check('Pripomočki zavihek', String(await evaluate(clickByText('button', 'Pripomočki'))) === 'OK', 'klik');

    await sleep(900);
    const auxText = String(await evaluate('document.body.textContent'));
    check('meritev 3D 1 v seznamu (1,00 m)', auxText.includes('3D 1') && auxText.includes('1,00 m'), auxText, 'vrednost');
    check('meritev 3D 2 v seznamu (80 cm)', auxText.includes('3D 2') && auxText.includes('80 cm'), auxText, 'vrednost');
    check('meritev 3D 3 v seznamu (2,00 m)', auxText.includes('3D 3') && auxText.includes('2,00 m'), auxText, 'vrednost');
    check('značka "3D" prisotna', auxText.includes('3D') === true, 'značka');


    // 10) Slike: namizje
    mkdirSync(join(process.cwd(), 'tests'), { recursive: true });
    const shot = async (name: string): Promise<void> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (r.data) writeFileSync(join(process.cwd(), 'tests', name), Buffer.from(r.data, 'base64'));
    };
    await shot('e2e-colmap-desktop.png');

    // 11) Mobilni 390×844: brez vodoravnega drsenja + footer flush
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(900);
    const mobile = (await evaluate(
      "(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, docH: document.documentElement.scrollHeight, f: (() => { const el = document.querySelector('footer'); if (!el) return null; const top = el.getBoundingClientRect().top + window.scrollY; return top + el.offsetHeight; })() }))()",
    )) as { sw: number; iw: number; docH: number; f: number | null };
    check('mobilni 390: brez vodoravnega drsenja', mobile.sw === 390 && mobile.iw === 390, mobile, 'vrednost');
    check('mobilni: footer flush z dnom', mobile.f !== null && Math.abs(mobile.f - mobile.docH) <= 2, mobile, 'vrednost');
    await shot('e2e-colmap-mobile.png');

    // 12) Konzola brez napak
    const consoleErr = String(await evaluate("window.__cdpErrors ?? ''"));
    check('konzola: brez JS napak (nismo ujeli crasha)', !consoleErr.includes('Uncaught'), consoleErr, 'vrednost');

    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E: ${pass} uspešnih, ${fail} neuspešnih`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : e);
  process.exit(1);
});
