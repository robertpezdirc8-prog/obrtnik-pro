// E2E: objavljena MEJA RAZMIKA v vmesniku razporeda stebrov (Task 24).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko jedrni skript že pove 74/74: meja je bila
// doslej PRIVZETEK v kodi (150), monter je izbiral razmak iz nabora in ni mu
// nihče povedal, od kod številka pride in kdaj je njegova izbira NAD njo. To je
// UI-vedenje — jedrni testi ga strukturno ne morejo zadeti, enako kot pri
// `e2e-band-ui.ts`.
//
// POT V BRskalniku je NAMERNO BRES FOTKE: laser (ročni vnos 640 cm) → zavihek
// Pripomočki → panel. Dokaže tudi to, da je razpored orodje in ne korak
// fotomontaže (panel je zdaj priklopjen na obeh mestih).
//
// Zagon: bun tests/e2e-span-rule-ui.ts   (zahtevá `next dev` na :3000)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju (fotke in posnetki).

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9346;
const APP = 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Microsoft/Edge/Application/msedge.exe` : undefined,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(rest.length ? rest[0] : '')).slice(0, 260)}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Artefakti SMEJO LIVEITI samo izven repozitorija (zasenčene hiše, Task 78). */
function guardOutSideRepo(p: string): string {
  const root = resolve(process.cwd());
  const rp = resolve(p);
  if (rp === root || rp.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error(`ZASEBNOST: artifact bi bil zapisan v repozitorij: ${rp}`);
  }
  return rp;
}

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try { accessSync(p); return true; } catch { return false; }
  });
  if (!bin) throw new Error(`chromium binary ni najden (poskusi: ${CHROME_CANDIDATES.join(', ')})`);
  console.log(`browser: ${bin}`);
  return spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    `--user-data-dir=${join(OUT_DIR, 'span-rule-profile')}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return; } catch { /* še ni gor */ }
    await sleep(250);
  }
  throw new Error('CDP ni postal dosegljiv');
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

// CDP odziv je { id, result } — razpakira se ENKROT (glej e2e-band-ui.ts).
// WebSocket je GLOBALKA (bun jo daje); uvoz `ws` bi v `tsc --noEmit` storil
// napako TS2307, ker `ws` ni odvisnost aplikacije.
async function connectCdp(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('WS napaka')); });
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  let id = 0;
  ws.onmessage = (d: MessageEvent) => {
    const m = JSON.parse(String(d.data)) as { id?: number; error?: { message: string }; result?: Record<string, unknown> };
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result ?? {});
    }
  };
  return {
    send: (method, params = {}) => new Promise((res, rej) => {
      const my = ++id;
      pending.set(my, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: my, method, params }));
    }),
    close: () => ws.close(),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const chrome = launchChrome();
  let cdp: Cdp | null = null;
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
      { type: string; url?: string; webSocketDebuggerUrl: string }[];
    // Tarča MORA biti zavihek: /json/list v Edgeu vrne tudi ozadje razširitev,
    // kjer `document` ne obstaja — prva verzija se je na tako tarčo priklopila
    // in je dobila prazne odgovore namesto DOM-a.
    const pages = list.filter((t) => t.type === 'page' && !/^chrome-extension:/.test(t.url ?? ''));
    const page = pages.find((t) => (t.url ?? '').startsWith('http://localhost')) ?? pages[0];
    if (!page) throw new Error('zavihek ni najden na /json/list');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
      if (r.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    const txt = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.textContent || '') : '__MISSING__'; })()`));
    const exists = async (sel: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
    const waitFor = async (sel: string, ms = 25000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await exists(sel)) return true; await sleep(200); }
      return false;
    };
    const clickSel = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return 'NOT_FOUND';
        e.scrollIntoView({ block: 'center' });
        e.click();
        return 'OK';
      })()`));
    const clickText = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const want = ${JSON.stringify(label)};
        const b = [...document.querySelectorAll('button,[role="tab"],a')].find((x) => (x.textContent || '').includes(want));
        if (!b) return 'NOT_FOUND';
        b.scrollIntoView({ block: 'center' });
        b.click();
        return 'OK';
      })()`));

    const waitForText = async (label: string, ms = 30000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const found = await evaluate(`(() => { const want = ${JSON.stringify(label)};
          return [...document.querySelectorAll('button,[role="tab"],a')].some((x) => (x.textContent || '').includes(want)); })()`);
        if (found === true) return true;
        await sleep(200);
      }
      return false;
    };

    // ── 1) pot do orodja brez fotografije ──
    await cdp.send('Page.navigate', { url: APP });
    // Koren je LANDING stran z navigacijo; kamera živi za povezavo »Pametna
    // kamera«. Klik brez čakanja je bil NOT_FOUND (hydracija še ni končana) —
    // zato najprej počakamo na povezavo, nato kliknemo.
    check('1a koren je landing (povezava na kamero obstaja)', await waitForText('Pametna kamera'), 'povezava');
    check('1b vstop v kamero', (await clickText('Pametna kamera')) === 'OK', await clickText('Pametna kamera'));
    check('1 aplikacija naložena (zavihki kamere)', await waitFor('[role="tab"]', 30000),
      String(await evaluate('document.body.innerText.slice(0, 140)')));
    check('2 zavihek Pripomočki se odpre',
      (await waitForText('Pripomočki')) && (await clickText('Pripomočki')) === 'OK',
      await clickText('Pripomočki'));
    check('3 laserski vnos je na voljo', await waitFor('input[placeholder="npr. 350"]'), 'input');

    // ── 2) ročni laser 640 cm → zadostuje za razpored (≥ 100 cm) ──
    const filled = await evaluate(`(() => {
      const i = document.querySelector('input[placeholder="npr. 350"]');
      if (!i) return 'NO_INPUT';
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, '640');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    })()`);
    check('4 dolžina 640 cm vpisana v laserski vnos', filled === 'OK', filled);
    check('5 gumb „Dodaj izmer“ obstaja', (await clickText('Dodaj izmer')) === 'OK', await clickText('Dodaj izmer'));
    check('6 panel razporeda se prikaže (brez fotke!)', await waitFor('[data-testid="post-layout"]'), 'post-layout');

    // ── 3) POKRIVNO: meja je citirana, ne domnevana ──
    const rule = await txt('[data-testid="post-layout-span-rule"]');
    check('7 svetuje se OBJAVLJENA meja 150 cm', rule.includes('Največ 150 cm'), rule.slice(0, 200));
    check('8 citat proizvajalca je v vmesniku (monter vidi, od kod številka pride)',
      rule.includes('Maksimalni razmak med stebrički je 150 cm'), rule.slice(0, 240));
    check('9 vir (domena navodila) je v vmesniku', rule.includes('roksal.com'), rule.slice(0, 240));
    check('10 opomba o manjkajoči orientaciji je prikazana (133–140 je lahko strožje)',
      rule.includes('Orientacija'), rule.slice(0, 240));

    // ── 4) izbira NAD objavljeno mejo → javljeno, ne tiho prešteto ──
    await clickSel('[aria-label="Največji razmak stebrov"]');
    await sleep(400);
    const optPicked = await evaluate(`(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || '').includes('2,50 m'));
      if (!o) return 'NO_OPTION';
      o.click();
      return 'OK';
    })()`);
    check('11 izbira 2,50 m je na voljo', optPicked === 'OK', optPicked);
    await sleep(400);
    const warn = await txt('[data-testid="post-layout-span-rule"]');
    check('12 izbira nad mejo je OPOZORILO (ne tiho sprejeta)', warn.includes('NAD objavljeno'), warn.slice(0, 240));
    check('13 izbrana meja ostane VELJAVNA za računano (640/3 = 2,13 m, ne tiho prikrito na 150)',
      (await txt('[data-testid="post-layout-summary"]')).includes('2,13 m'),
      await txt('[data-testid="post-layout-summary"]'));

    // ── 5) višina 140 cm odpre proizvajalčevo NASPROTJE ──
    await evaluate(`(() => {
      const i = document.querySelector('input[aria-label="Višina polnila v centimetrih"]');
      if (!i) return 'NO_INPUT';
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, '140');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    })()`);
    await sleep(400);
    const conf = await txt('[data-testid="post-layout-span-rule"]');
    check('14 pri 140 cm se javi RAZHAJANJE navodil (150 proti 180)',
      conf.includes('razhajata') && conf.includes('180 cm'), conf.slice(0, 260));
    check('15 kljub razhajanju velja NIŽJA meja (2.60 m izbira ni utemeljena)',
      conf.includes('Največ 150 cm'), conf.slice(0, 200));

    // ── 6) dokaz na disku (velikost preverjena, ne samo „poskus“ — glej e2e-band-ui) ──
    const shotPath = guardOutSideRepo(join(OUT_DIR, 'span-rule-ui.png'));
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
    if (!shot.data) throw new Error('captureScreenshot vrnil ni bajtov');
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    check('16 posnetek napisan na disk', statSync(shotPath).size > 20000, `bajtov ${statSync(shotPath).size}`);
    console.log(`   posnetek: ${shotPath}`);

    // ── 7) MUTACIJA: ista pot z mejo 1,00 m (pod objavljenimi 150) — moralna
    //    obveznost: opozorilo IZGINI, ker izbira ni več nad mejo. Če ta preizkus
    //    ostane zelen, je opozorilo okras in ne odziv.
    await clickSel('[aria-label="Največji razmak stebrov"]');
    await sleep(400);
    const optLow = await evaluate(`(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || '').includes('1,00 m'));
      if (!o) return 'NO_OPTION';
      o.click();
      return 'OK';
    })()`);
    check('17 izbira 1,00 m je na voljo', optLow === 'OK', optLow);
    await sleep(400);
    const calm = await txt('[data-testid="post-layout-span-rule"]');
    check('18 pod mejo opozorilo IZGINI (ostane samo citat in vir)',
      calm.includes('Največ 150 cm') && !calm.includes('NAD objavljeno'), calm.slice(0, 240));

    console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK`);
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('napaka', e); process.exit(1); });
