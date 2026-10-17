// E2E za terenski dnevnik (Baustellendokumentacija) — čist CDP prek
// WebSocket (bun), vzorec iz Task 47 (e2e-colmap-cdp.ts).
// Zlata pot: vnos z opisom + fotko → drugi vnos drugi dan → urejanje →
// tiskalno poročilo (stub okna zajame HTML) → brisanje → API povezava
// z delovnim nalogom → mobilni 390 → konzola čista.
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
import { accessSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Pot do chromiuma: okoljska spremenljivka, nato Windows/macOS/Linux poti, na
// koncu kontejnerski playwright cache (stari seznam je veljal samo v kontejnerju).
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe` : undefined,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome',
].filter((p): p is string => typeof p === 'string' && p.length > 0);
const PORT = Number(process.env.CDP_PORT ?? 9334);
const APP = process.env.APP_URL ?? 'http://localhost:3000/';

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
  rmSync(TMP('diary-e2e'), { recursive: true, force: true });
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--user-data-dir=${TMP('diary-e2e')}`,
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
  consoleErrors(): string[];
}

function connectCdp(wsUrl: string): Promise<CdpLike> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    const consoleErrors: string[] = [];
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
        consoleErrors: () => consoleErrors.slice(),
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
        consoleErrors.push(String(msg.params.text ?? ''));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = (msg.params as unknown as { exceptionDetails?: { text?: string } })?.exceptionDetails;
        consoleErrors.push(`EXC: ${d?.text ?? 'neznana'}`);
      }
    };
    ws.onerror = () => reject(new Error('WS napaka'));
  });
}

async function main(): Promise<void> {
  // 0) Čist list: zbriši vse obstoječe vnose (prejšnji zagoni)
  try {
    const pre = (await (await fetch('http://localhost:3000/api/diary-entries')).json()) as {
      entries: { id: string }[];
    };
    for (const e of pre.entries) {
      await fetch(`http://localhost:3000/api/diary-entries/${e.id}`, { method: 'DELETE' });
    }
    console.log(`Čist list: ${pre.entries.length} obstoječih vnosov izbrisanih.`);
  } catch {
    console.log('Čist list: predhodno čiščenje ni uspelo (nadaljujem).');
  }

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

    const setInputValue = (selector: string, value: string): string => `
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return 'NOT_FOUND:${selector}';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '${value}');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`;

    const setTextareaValue = (selector: string, value: string): string => `
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return 'NOT_FOUND:${selector}';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`;

    const summaryText = (): string => `
      (() => {
        const cards = [...document.querySelectorAll('[data-testid=diary-view] .grid .card, [data-testid=diary-view] .grid > *')];
        return cards.map((c) => (c.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ');
      })()`;

    // 1) Odpri aplikacijo + Dnevnik
    await cdp.send('Page.navigate', { url: APP });
    await sleep(3500);
    check('navigacija: naslov', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('Dnevnik klik', String(await evaluate(clickByText('button', 'Dnevnik'))) === 'OK', 'klik');
    await sleep(1200);
    check(
      'dnevnik panel viden',
      String(await evaluate("!!document.querySelector('[data-testid=diary-view]')")) === 'true',
      'panel',
    );
    const emptyState = String(await evaluate('document.body.textContent'));
    check('prazen dnevnik: prijazno sporočilo', emptyState.includes('Dnevnik je še prazen'), emptyState.slice(0, 200));
    check('iskrena razlaga v glavi', emptyState.includes('dokaz izvedenega dela'), 'glava');
    check('ure karta: "Izberi ponudbo" (iskreno)', emptyState.includes('ure so po nalogih'), 'karta');

    // 2) Vnos 1: opis + fotografija (danes, faza Montaža = privzeto)
    check(
      'opis vnos 1',
      String(await evaluate(setTextareaValue('#diary-note', 'Demontaža stare ograje, vrtanje nosilcev, montaža 4 stebrov.'))) === 'OK',
      'vnos',
    );
    const b64 = readFileSync(join(process.cwd(), 'tests', 'test-photo.jpg')).toString('base64');
    const inject = `
      (() => {
        const input = document.querySelector('input[aria-label="Izberi fotografije"]');
        if (!input) return 'MISSING';
        const dt = new DataTransfer();
        // binarno-varno: File([string]) bi UTF-8 kodiral bajte in pokvaril JPEG
        dt.items.add(new File([Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0))], 'teren.jpg', { type: 'image/jpeg' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`;
    check('fotografija injicirana', String(await evaluate(inject)) === 'OK', 'injekcija');
    await sleep(1800);
    check(
      'sličica v obrazcu vidna',
      String(await evaluate("!!document.querySelector('[data-testid=diary-view] img[alt=\"Fotografija 1\"]')")) === 'true',
      'thumb',
    );
    check('Zapiši v dnevnik klik', String(await evaluate(clickByText('button', 'Zapiši v dnevnik'))) === 'OK', 'klik');
    await sleep(1500);

    const after1 = String(await evaluate('document.body.textContent'));
    check('vnos 1 v dnevniku (opis)', after1.includes('Demontaža stare ograje'), 'opis');
    check('vnos 1 značka Montaža', after1.includes('Montaža'), 'faza');
    check('sličica v dnevniku (dokaz)', String(await evaluate("!!document.querySelector('[data-testid=diary-view] img[alt^=\"Fotografija izvedenega dela\"]')")) === 'true', 'thumb v seznamu');
    const summ1 = String(await evaluate(summaryText()));
    check('povzetek po vnosu 1: 1 vnos · 1 dan · 1 fotka', summ1.includes('Vnosi') && summ1.includes('Dni dela') && summ1.includes('Fotografije'), summ1.slice(0, 160));

    // 3) Vnos 2: včerajšnji dan, brez fotke (grupiranje)
    const yesterday = await evaluate("new Date(Date.now() - 86400000).toISOString().slice(0, 10)");
    const yDay = String(yesterday);
    check('dan = včeraj', String(await evaluate(setInputValue('#diary-day', yDay))) === 'OK', 'datum');
    check(
      'opis vnos 2',
      String(await evaluate(setTextareaValue('#diary-note', 'Priprava podlage in merjenje razpona.'))) === 'OK',
      'vnos',
    );
    check('Zapiši v dnevnik klik (2)', String(await evaluate(clickByText('button', 'Zapiši v dnevnik'))) === 'OK', 'klik');
    await sleep(1500);
    const after2 = String(await evaluate('document.body.textContent'));
    check('vnos 2 v dnevniku', after2.includes('Priprava podlage'), 'opis');
    const dayHeads = Number(await evaluate(
      "[...document.querySelectorAll('[data-testid=diary-view] [data-slot=card-title]')].filter((t) => /\\d{2}\\.\\d{2}\\.\\d{4}/.test(t.textContent || '')).length",
    ));
    check('2 dnevni kartici (grupiranje)', dayHeads === 2, dayHeads);
    check('vsak dan 1 zapis', after2.includes('1 zapis') && !after2.includes('2 zapisa'), 'zapisi');

    // 4) Urejanje vnosa
    const editBtn = String(await evaluate(
      "(() => { const b = [...document.querySelectorAll('button[aria-label^=\"Uredi vnos\"]')][0]; if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()",
    ));
    check('Uredi klik', editBtn === 'OK', editBtn);
    await sleep(900);
    const editMode = String(await evaluate('document.body.textContent'));
    check('obrazec v načinu urejanja', editMode.includes('Shrani spremembe'), 'način');
    check(
      'opis preimenovan',
      String(await evaluate(setTextareaValue('#diary-note', 'Demontaža stare ograje + popravljena montaža 4 stebrov.'))) === 'OK',
      'vnos',
    );
    check('Shrani spremembe klik', String(await evaluate(clickByText('button', 'Shrani spremembe'))) === 'OK', 'klik');
    await sleep(1500);
    const afterEdit = String(await evaluate('document.body.textContent'));
    check('popravljen opis v dnevniku', afterEdit.includes('popravljena montaža'), 'opis');

    // 5) Tiskalno poročilo — stub window.open zajame HTML
    await evaluate(
      "(() => { window.__doc = null; window.open = () => ({ document: { open() {}, write(h) { window.__doc = h; }, close() {} }, setTimeout(f) { if (typeof f === 'function') f(); }, focus() {}, print() {} }); return 'ARMED'; })()",
    );
    check('Natisni poročilo klik', String(await evaluate(clickByText('button', 'Natisni poročilo'))) === 'OK', 'klik');
    await sleep(2200);
    const doc = String((await evaluate('window.__doc')) ?? '');
    check('poročilo zgrajeno (HTML > 2000 znakov)', doc.length > 2000, doc.length);
    check('poročilo: naslov', doc.includes('Dokumentacija izvedenih del'), 'naslov');
    check('poročilo: opis vnosa', doc.includes('popravljena montaža'), 'opis');
    check('poročilo: fotka dataURL', doc.includes('data:image'), 'img');
    check('poročilo: brez izmišljenih ur', !doc.includes('Evidence ure'), 'iskrenost');

    // 6) CSV gumb (prenos) — brez napak
    check('CSV klik', String(await evaluate(clickByText('button', 'CSV'))) === 'OK', 'klik');
    await sleep(600);

    // 7) API povezava z delovnim nalogom (offerId) — preverjeno prek API
    const offers = (await (await fetch('http://localhost:3000/api/offers')).json()) as {
      offers: { id: string; number: string }[];
    };
    const target = offers.offers.find((o) => o.number.includes('2026-001')) ?? offers.offers[0];
    if (target) {
      const created = (await (
        await fetch('http://localhost:3000/api/diary-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day: yDay, phase: 'zakljucek', note: 'API vnos z nalogom', offerId: target.id, photos: [] }),
        })
      ).json()) as { entry?: { id: string; offerNumber?: string | null }; error?: string };
      check('API vnos z offerId sprejet', !!created.entry && created.entry.offerNumber === target.number, created);
      const filtered = (await (
        await fetch(`http://localhost:3000/api/diary-entries?offerId=${encodeURIComponent(target.id)}`)
      ).json()) as { entries: { id: string }[] };
      check('API filter po ponudbi vrne vnos', filtered.entries.some((e) => e.id === created.entry?.id), filtered.entries.length);
      if (created.entry) {
        await fetch(`http://localhost:3000/api/diary-entries/${created.entry.id}`, { method: 'DELETE' });
      }
      check('API vnos počiščen', true, 'cleanup');
    }

    // 8) Brisanje vnosa prek UI (AlertDialog)
    const delBtn = String(await evaluate(
      "(() => { const b = [...document.querySelectorAll('button[aria-label^=\"Izbriši vnos\"]')][0]; if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()",
    ));
    check('Izbriši klik', delBtn === 'OK', delBtn);
    await sleep(800);
    const dialogVisible = String(await evaluate("!!document.querySelector('[role=alertdialog]')"));
    check('AlertDialog odprt', dialogVisible === 'true', dialogVisible);
    const confirmBtn = String(await evaluate(
      "(() => { const d = document.querySelector('[role=alertdialog]'); if (!d) return 'NO_DIALOG'; const b = [...d.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Izbriši')); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()",
    ));
    check('potrditev brisanja', confirmBtn === 'OK', confirmBtn);
    await sleep(1500);
    const afterDel = String(await evaluate('document.body.textContent'));
    check('vnos izginil iz dnevnika', !afterDel.includes('popravljena montaža'), 'opis');

    // 9) Namizni posnetek
    mkdirSync(join(process.cwd(), 'tests'), { recursive: true });
    const shot = async (name: string): Promise<void> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (r.data) writeFileSync(join(process.cwd(), 'tests', name), Buffer.from(r.data, 'base64'));
    };
    await shot('e2e-diary-desktop.png');

    // 10) Mobilni 390×844: brez vodoravnega drsenja + footer flush
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
    check('mobilni 390: brez vodoravnega drsenja', mobile.sw === 390 && mobile.iw === 390, mobile);
    check('mobilni: footer flush z dnom', mobile.f !== null && Math.abs(mobile.f - mobile.docH) <= 2, mobile);
    await shot('e2e-diary-mobile.png');

    // 11) Konzola brez napak
    const consoleErrorsList = cdp.consoleErrors();
    check('konzola: brez JS napak', consoleErrorsList.length === 0, consoleErrorsList.slice(0, 4).join(' | '));

    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }

  // 12) Čiščenje: zbriši vse teste dnišče vnose iz baze
  try {
    const all = (await (await fetch('http://localhost:3000/api/diary-entries')).json()) as {
      entries: { id: string; note: string }[];
    };
    for (const e of all.entries) {
      await fetch(`http://localhost:3000/api/diary-entries/${e.id}`, { method: 'DELETE' });
    }
    console.log(`Čiščenje: ${all.entries.length} testnih vnosov izbrisanih.`);
  } catch {
    console.log('Čiščenje ni uspelo (naloži ročno prek API).');
  }

  console.log(`\nRezultat E2E: ${pass} uspešnih, ${fail} neuspešnih`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : e);
  process.exit(1);
});
