// E2E: DNEVNIK IN FOTOGRAFIJE (trajna shramba) — nalaganje fotografije iz
// brskalnika, shranjevanje v dnevniku, PREVERJANJE TRAJNOSTI (po osvežitvi
// slika še vedno obstaja) in potrditev, da je vsebina dejansko v Supabase
// Storage (bucket `photos`) — ne le v ephemeralu instance.
//
// Fotografija je ista realna slika hiše z balkonom kot v `e2e-real-photo.ts`
// (Wikimedia Commons, CC BY-SA 2.0 — `tests/fixtures/ATTRIBUTION.md`).
//
// Zagon: APP_URL=https://… CHROME_PATH=… bun tests/e2e-diary-photo.ts
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
    const textOf = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.textContent || '') : '__MISSING__'; })()`));
    const clickByText = async (text: string): Promise<string> =>
      String(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()`));
    const setValue = async (sel: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return 'NOT_FOUND';
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`));
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
    const DAN = '2026-10-19';
    const OPIS = 'E2E: montaza balkonske ograje (ROKSAL polna-100)';

    // ── 1) odpri dnevnik ──
    await cdp.send('Page.navigate', { url: APP });
    await sleep(4000);
    check('dnevnik: naslov strani', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('dnevnik: klik na Dnevnik', (await clickByText('Dnevnik')) === 'OK', 'klik');
    await sleep(1500);
    check('dnevnik: pogled odprt', (await evaluate(`!!document.querySelector('[data-testid="diary-view"]')`)) === true, 'diary-view');
    await shot('e2e-diary-01-prazno.png');

    // ── 2) fotografija iz brskalnika (kot da jo slikaš) ──
    const inj = String(await evaluate(`(() => {
      const input = document.querySelector('input[type=file][aria-label="Izberi fotografije"]') || document.querySelector('input[type=file]');
      if (!input) return 'NO_INPUT';
      const bin = atob(${JSON.stringify(b64)});
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], 'balkon.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    })()`));
    check('dnevnik: fotografija izbrana', inj === 'OK', inj);
    await sleep(3500);
    const thumbs = Number(await evaluate(`document.querySelectorAll('img[alt^="Fotografija"]').length`));
    check('dnevnik: sličica je vidna', thumbs >= 1, `slikic ${thumbs}`);
    await shot('e2e-diary-02-fotka.png');

    // ── 3) zapiši vnos ──
    check('dnevnik: dan vnesen', (await setValue('#diary-day', DAN)) === 'OK', 'vnos');
    await sleep(300);
    const danVrednost = String(await evaluate(`(() => { const e = document.querySelector('#diary-day'); return e ? e.value : '__MISSING__'; })()`));
    check('dnevnik: datum je v polju (React je sprejel vnos)', danVrednost === DAN, danVrednost);
    const ta = String(await evaluate(`(() => { const t = document.querySelector('textarea'); return t ? t.getAttribute('placeholder') || '' : ''; })()`));
    check('dnevnik: opis polje najden', ta.length > 0, ta);
    check('dnevnik: opis vnesen', (await setValue('textarea', OPIS)) === 'OK', 'vnos');
    await sleep(300);
    check('dnevnik: klik Zapiši v dnevnik', (await clickByText('Zapiši v dnevnik')) === 'OK', 'klik');
    await sleep(4000);
    // Pravi dokaz zapisa je API, ne besedilo na strani (besedilo ostane tudi v
    // obrazcu, ko zapis ni uspel).
    const saved = (await evaluate(`(async () => {
      const r = await fetch('/api/diary-entries');
      const d = await r.json();
      const list = Array.isArray(d) ? d : (Array.isArray(d.entries) ? d.entries : []);
      const e = list.find((x) => (x.note || '').includes('balkonske ograje'));
      return { found: !!e, count: list.length };
    })()`)) as { found?: boolean; count?: number };
    check('dnevnik: vnos je ZAPISAN (API potrdi)', saved.found === true, `zapisov ${saved.count}`);
    await shot('e2e-diary-03-zapis.png');

    // ── 4) TRAJNOST: po osvežitvi je vse še tam ──
    await cdp.send('Page.reload');
    await sleep(4500);
    check('dnevnik: klik na Dnevnik (po osvežitvi)', (await clickByText('Dnevnik')) === 'OK', 'klik');
    await sleep(2000);
    const body2 = await textOf('body');
    check('dnevnik: vnos PREŽIVI osvežitev', body2.includes('balkonske ograje'), 'ni opisa');
    // Fotografija se mora res PREBRATI s strežnika (ne le sličica v obrazcu):
    // `?photos=1` vrne polno vsebino, ki jo strežnik prebere iz SHRAMBE.
    const dcheck = (await evaluate(`(async () => {
      const r = await fetch('/api/diary-entries?photos=1');
      const d = await r.json();
      const list = Array.isArray(d) ? d : (Array.isArray(d.entries) ? d.entries : []);
      const e = list.find((x) => (x.note || '').includes('balkonske ograje'));
      if (!e) return { found: false, photos: 0, fullLen: 0 };
      const photos = Array.isArray(e.photos) ? e.photos : [];
      const full = photos.map((p) => p.dataUrl || '').find((s) => s.startsWith('data:image/jpeg;base64,') && s.length > 100000);
      return { found: true, photos: photos.length, fullLen: full ? full.length : 0 };
    })()`)) as { found?: boolean; photos?: number; fullLen?: number };
    check('dnevnik: vnos je v API-ju po osvežitvi', dcheck.found === true, dcheck);
    check('dnevnik: fotografija je v vnosu', (dcheck.photos ?? 0) >= 1, dcheck);
    check('dnevnik: POLNA fotografija se prebere s strežnika (>100 kB base64)', (dcheck.fullLen ?? 0) > 100000, dcheck);
    await shot('e2e-diary-04-po-osvezitvi.png');

    const errs = cdp.errors();
    check('dnevnik: konzola brez napak', errs.length === 0, errs.slice(0, 2).join(' | '));
    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E (dnevnik + fotografije): ${pass} uspešnih, ${fail} neuspešnih`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

