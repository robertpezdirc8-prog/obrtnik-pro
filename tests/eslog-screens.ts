// Zaslonski posnetki za dokaz Task 49 (e-račun dialog) — čist CDP.
import { spawn, type ChildProcess } from 'node:child_process';
import * as __vfyFs from 'node:fs';
import * as __vfyOs from 'node:os';
import * as __vfyPath from 'node:path';
// Izhodna mapa je odvedena iz os.tmpdir(): '/tmp' je veljala samo v razvojnem
// kontejnerju, na Windows bi pomenila C:\tmp in script bi padel zaradi okolja.
// Uvozi so prostorno poimenovani, da ne morejo zadniti obstojecega uvoza istih
// imen (tri od teh datotek ze uvozijo 'join' iz node:path).
const __vfyOutDir = __vfyPath.join(__vfyOs.tmpdir(), 'obrtnik-pro-e2e');
__vfyFs.mkdirSync(__vfyOutDir, { recursive: true });
const TMP = (name: string) => __vfyPath.join(__vfyOutDir, name);
import { accessSync, rmSync, writeFileSync } from 'node:fs';

const CHROME_CANDIDATES = [
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux/chrome',
  '/home/z/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
];
const PORT = 9336;
const APP = 'http://localhost:3000/';
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
  if (!bin) throw new Error('chromium binary ni najden');
  rmSync(TMP('eslog-shot'), { recursive: true, force: true });
  return spawn(
    bin,
    [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--remote-allow-origins=*', '--user-data-dir=/tmp/eslog-shot',
      `--remote-debugging-port=${PORT}`, 'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP ni dosegljiv');
}

async function main(): Promise<void> {
  const API = 'http://localhost:3000';
  const settingsRes = (await (await fetch(`${API}/api/settings`)).json()) as {
    settings: Record<string, string>;
  };
  const old = settingsRes.settings;
  await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Obrt Test s.p.', address: 'Ulica 14, 1000 Ljubljana',
      taxNumber: '12345678', iban: 'SI56 0510 0801 0555 555',
    }),
  });
  const offerRes = (await (await fetch(`${API}/api/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Stranka e-računa d.o.o.', customerAddress: 'Cesta 1, 2000 Maribor',
      vatRate: 22,
      items: [
        { name: 'Aluminijasta ograja', description: 'Eloksirana', quantity: 12, unit: 'm', unitPrice: 145 },
        { name: 'Steber aluminij 40×40', quantity: 3, unit: 'kos', unitPrice: 38 },
      ],
    }),
  })).json()) as { offer: { id: string; number: string } };
  await fetch(`${API}/api/offers/${offerRes.offer.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  const invRes = (await (await fetch(`${API}/api/invoices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: offerRes.offer.id }),
  })).json()) as { invoice: { number: string } };
  const invNumber = invRes.invoice.number;

  const chrome = launchChrome();
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
      type: string; webSocketDebuggerUrl: string;
    }[];
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('ni page targeta');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method: string, params = {}) =>
      new Promise((res) => {
        id += 1;
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expr: string) => {
      const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as {
        result?: { result?: { value?: unknown } };
      };
      return r.result?.result?.value;
    };

    for (const [name, width, height, mobile] of [
      ['desktop', 1280, 900, false],
      ['mobile', 390, 844, true],
    ] as const) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await send('Page.navigate', { url: APP });
      await sleep(3500);
      await evaluate(`
        [...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('Ponudbe'))?.click();
        'OK'`);
      await sleep(1500);
      await evaluate(`
        [...document.querySelectorAll('button')].find((b) => (b.textContent||'').trim() === 'Račun')?.click();
        'OK'`);
      await sleep(1500);
      await evaluate(`document.querySelector('[data-testid="eslog-${invNumber}"]')?.scrollIntoView({block:'center'}); 'OK'`);
      await sleep(400);
      const shot = (await send('Page.captureScreenshot', { format: 'png' })) as {
        result?: { data?: string };
      };
      const data = shot.result?.data;
      if (data) writeFileSync(`tests/e2e-eslog-${name}.png`, Buffer.from(data, 'base64'));
      console.log(`posnetek: tests/e2e-eslog-${name}.png${data ? '' : ' (BREZ PODATKA)'}`);
    }
  } finally {
    chrome.kill();
    await fetch(`${API}/api/offers/${offerRes.offer.id}`, { method: 'DELETE' });
    await fetch(`${API}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(old),
    });
    console.log('čiščenje OK');
  }
}

await main();
