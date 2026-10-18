// E2E: KAJ KAMERA ZMORE — pregled zmogljivosti modula Pametna kamera.
//
// ZAKAJ: verify skripti dokazujejo, da so ALGORITMI pravilni (fotomontaža 391
// trditev, večpogled 362, razmiki 133, …). Kamero so v brskalniku odprli že pet
// E2E-jev, a vsak samo v ENI podpoti (fotomontaža 2×, 3D model, razpored stebrov,
// dvotapni predlog). Živega zajema `getUserMedia` ni meril nihče. Tu dokazujemo
// drugo plat: kaj monter DEJANSKO dobi, ko odpre kamero.
//  a) vseh sedem zavihkov odprtih v živem brskalniku, vsak s posnetkom na disku;
//  b) ŽIVI zajem (getUserMedia na lažni kameri) → kader → analiza → galerija →
//     baza: dokaz, da je v bazi res ISTA fotka z isto analizo in svojim seznamom
//     meritev, ne samo lep zaslon;
//  c) vsaka zmožnost, ki je v tem brskalniku NI (kamera, senzor libele, Web
//     Bluetooth, Web Speech, WebXR, odložišče): aplikacija mora povedati KAJ
//     naj monter naredi namesto nje in NE SME tiho izginiti;
//  d) vrata, ki so zaprta, dokler manjka podatek (merila, mere, cena) — in
//     besedilo, ki to razloži;
//  e) denarna vrata (Task 88): projekt iz fotk sme pokazati evre ŠELE, ko jih je
//     obrtnik vpisal v Cenik, in spet zapreti, ko jih izbriše.
//
// Kjer meritev pokaže, da uporabnik ne vidi NIČ, to NE prikažemo kot delujoče:
// checks imenujejo dejanski simptom in ostanejo obarvani po resnici (`gap`).
//
// Zagon: bun tests/e2e-kamera-zmogljivosti.ts
//   APP_URL=http://127.0.0.1:3018/  (privzeto :3000)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const PORT = 9353;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = `${tmpdir()}/obrtnik-pro-e2e`;
const PROFILE = `${OUT_DIR}/kamera-profile`;
const LOG = `${OUT_DIR}/kamera-zmogljivosti-dump.txt`;

const TABLIST = '[aria-label="Načini pametne kamere"]';
const CAM_INPUT = 'input[capture]';
/** Prava fotografija, ki jo streže sama aplikacija — CV jo prepozna kot
 *  dejavnost, zato sme nastati tudi projekt iz fotk. Merjeno 2026-10-18:
 *  /crafts/keramika.jpg → craft "ograje" (zaupanje 89), /crafts/ograje.jpg → "drugo". */
const FIXTURE = '/crafts/keramika.jpg';
const TABS = ['Zajem + analiza', 'AR merjenje', 'Vizualizer', 'Fotomontaža', 'Večpogled', '3D model', 'Pripomočki'];
const FILES = [
  'kamera-00-zajem.png', 'kamera-01-zivi-kader.png', 'kamera-02-analiza.png',
  'kamera-03-ar.png', 'kamera-04-vizualizer.png', 'kamera-05-fotomontaza.png',
  'kamera-06-vecpogled.png', 'kamera-07-model3d.png', 'kamera-08-orodja.png',
  'kamera-09-brez-kamere.png', 'kamera-10-napaka-analize.png', 'kamera-11-projekt-z-cenami.png',
  'kamera-12-merilni-list.png', 'kamera-13-analiza-ziva.png',
];

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
const manjki: string[] = [];
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(rest.length ? rest[0] : '')).slice(0, 320)}`);
  }
}
/** Izmerjena resnica, ki je aplikacija še ne zmore: prijavimo jo kot MANJKO,
 *  da je v povzetku vidna, sweep pa trdi resnico o tem, kar DEJANSKO deluje.
 *  Ko potrjena pot postane zmožnost, se vrstica spremeni v ✓ in manjko izgine. */
function gap(name: string, deluje: boolean, ...rest: unknown[]): void {
  if (deluje) { pass++; console.log(`✓ ${name}`); return; }
  manjki.push(`${name} — ${String(rest[0] ?? '').slice(0, 220)}`);
  console.log(`! MANJKO ${name} — dobil: ${JSON.stringify(String(rest[0] ?? '')).slice(0, 320)}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  return spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    // Lažna kamera: edini pošten način, da se živi zajem preizkusi v avtomatizaciji.
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--user-data-dir=${PROFILE}`,
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
  exceptions(): string[];
  close(): void;
}

async function connectCdp(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('WS napaka')); });
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const exceptions: string[] = [];
  let id = 0;
  ws.onmessage = (d: MessageEvent) => {
    const m = JSON.parse(String(d.data)) as {
      id?: number; method?: string; error?: { message: string };
      result?: Record<string, unknown>;
      params?: { exceptionDetails?: { text: string; exception?: { description?: string } } };
    };
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params?.exceptionDetails;
      exceptions.push(e?.exception?.description ?? e?.text ?? 'neznana izjema');
    }
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
    exceptions: () => exceptions,
    close: () => ws.close(),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const chrome = launchChrome();
  const dump: string[] = [];
  let cdp: Cdp | null = null;
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
      { type: string; url?: string; webSocketDebuggerUrl: string }[];
    const pages = list.filter((t) => t.type === 'page' && !/^chrome-extension:/.test(t.url ?? ''));
    const page = pages.find((t) => (t.url ?? '').startsWith('http://localhost') || (t.url ?? '').startsWith('http://127.0.0.1')) ?? pages[0];
    if (!page) throw new Error('zavihek ni najden na /json/list');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1700, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
      if (r.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    const bodyText = async (): Promise<string> =>
      String(await evaluate('document.body ? document.body.innerText : ""'));
    const count = async (sel: string): Promise<number> =>
      Number(await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`));
    const exists = async (sel: string): Promise<boolean> => (await count(sel)) > 0;
    const textOf = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? String(e.innerText ?? e.textContent) : '__MANJKA__'; })()`));
    const stateOf = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return 'NO_ELEMENT';
        return e.disabled === true ? 'DISABLED' : (e.getAttribute('aria-disabled') === 'true' ? 'ARIA_DISABLED' : 'ENABLED');
      })()`));
    const waitForText = async (label: string, ms = 30000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if ((await bodyText()).includes(label)) return true; await sleep(200); }
      return false;
    };
    const clickText = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const want = ${JSON.stringify(label)};
        const b = [...document.querySelectorAll('button,[role="tab"],a')].find((x) => (x.textContent || '').includes(want));
        if (!b) return 'NOT_FOUND';
        b.scrollIntoView({ block: 'center' });
        b.click();
        return 'OK';
      })()`));
    const clickSel = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(sel)});
        if (!b) return 'NOT_FOUND';
        b.scrollIntoView({ block: 'center' });
        b.click();
        return 'OK';
      })()`));
    const setVal = async (sel: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(sel)});
        if (!i) return 'NO_INPUT';
        const proto = i.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`));
    const val = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); return i ? String(i.value) : '__MANJKA__'; })()`));
    /** Fotka, vzeta IZ APLIKACIJE (in-page fetch → File → DataTransfer):
     *  E2E ne potrebuje fixture na disku in nobene absolutne poti. Slika je
     *  prava fotografija, ki jo aplikacija streže sama, zato jo CV prepozna
     *  kot dejavnost in projekt iz fotk sploh lahko nastane. */
    const naloziFotko = (): Promise<string> => evaluate(`(async () => {
      const input = document.querySelector(${JSON.stringify(CAM_INPUT)});
      if (!input) return 'NO_INPUT';
      const r = await fetch(${JSON.stringify(FIXTURE)});
      if (!r.ok) return 'FIXTURE_' + r.status;
      const blob = await r.blob();
      const file = new File([blob], 'izpit.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    })()`) as Promise<string>;
    const toastText = async (): Promise<string> =>
      String(await evaluate(`(() => {
        const li = document.querySelector('li[data-state="open"]') || document.querySelector('[role="status"]');
        return li ? String(li.textContent) : '';
      })()`));
    const closeToast = async (): Promise<void> => {
      await evaluate(`(() => {
        const li = document.querySelector('li[data-state="open"]');
        if (!li) return 'NO_TOAST';
        const bs = li.querySelectorAll('button');
        bs[bs.length - 1]?.click();
        return 'OK';
      })()`);
      await sleep(350);
    };
    /** Odgovor, ki ga aplikacija dene na zaslon (obvestila, razlogi, opozorila).
     *  Denarna zavrnitev Cenika stoji na zaslonu ves čas in ni obvestilo o
     *  zajemu — brez tega filtra bi tiho napako šteli kot povedano. */
    const notifications = async (): Promise<string> =>
      String(await evaluate(`(() => {
        const sel = 'li[data-state="open"],[role="alert"],[data-testid*="refusal"],[data-testid*="blocker"]';
        return [...document.querySelectorAll(sel)]
          .filter((e) => e.getAttribute('data-testid') !== 'project-price-refusal')
          .map((e) => String(e.textContent).replace(/\\s+/g,' ').trim()).join(' || ');
      })()`));

    /** Kader PREDOGLEDA, ne katera koli slika na zaslonu. Galerija drži fotke
     *  iz prejšnjih zagonov kot data-URL in bi sicer 'največjo sliko' vedno
     *  vrnila iz baze — meritev tako ne bi povedala ničesar o zajemu. */
    const kader = async (): Promise<{ glava: string; b: number; px: number }> =>
      JSON.parse(String(await evaluate(`(() => {
        const i = document.querySelector('img[alt="Zajeta fotografija za analizo"]');
        return JSON.stringify(i ? { glava: i.src.slice(0, 22), b: i.src.length, px: i.naturalWidth } : { glava: 'NI_PREDOGLEDA', b: 0, px: 0 });
      })()`))) as { glava: string; b: number; px: number };

    /** Katera faza analize je na zaslonu — branje DOM značk, ne domnevanje. */
    const faza = async (): Promise<string> => {
      if (await exists('[data-testid="open-viz"]')) return 'rezultat';
      if ((await bodyText()).includes('Analiziram')) return 'analizira';
      if (await exists('[data-testid="capture-guide"]')) return 'zajem';
      return 'neznano';
    };

    /** Kaj je res na zaslonu: zavihek, faza, način vnosa. Dokaz za napake,
     *  kjer `bodyText` vrne samo glavo navigacije in zato nič ne pove. */
    const pogled = async (): Promise<string> => {
      const izbrani = String(await evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(TABLIST)} + ' [role="tab"][aria-selected="true"]');
        return b ? (b.textContent || '').trim() : 'NI_ZAVIHKA';
      })()`));
      const načina = String(await evaluate(`(() => {
        const t = [...document.querySelectorAll('button')].find((x) => ['Kamera', 'Naloži sliko'].includes((x.textContent || '').trim()));
        return t ? (t.textContent || '').trim() + '=' + String(t.getAttribute('aria-pressed')) : 'NI_PREKLOPA';
      })()`));
      return `zavihek=${izbrani} faza=${await faza()} vnos=${načina} h1=${await textOf('h1')}`;
    };

    /** Vrnitev na rezultatno stran prek ceste, ki jo monter res uporablja. */
    const pojdiVRezultat = async (): Promise<string> => {
      await clickText('Zajem + analiza');
      await sleep(500);
      if ((await faza()) === 'rezultat') return 'že rezultat';
      await clickTočno('Naloži sliko');
      await sleep(400);
      const izbrano = await naloziFotko();
      if (izbrano !== 'OK') return `nalaganje=${izbrano}`;
      await sleep(1_500);
      await clickText('Analiziraj s pametjo');
      const dosežen = await waitForText('Vizualiziraj za stranko', 60_000);
      await closeToast();
      return dosežen ? 'rezultat' : `faza=${await faza()}`;
    };

    /** Klik na gumb s TOČNIM napisom. `clickText('Kamera')` zadene navigacijo
     *  'Pametna kamera' in s tem ZAPUSTI modul — zato mora biti primerjava enaka. */
    const clickTočno = (label: string): Promise<string> =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)});
        if (!b) return 'NOT_FOUND';
        b.scrollIntoView({ block: 'center' });
        b.click();
        return 'OK';
      })()`) as Promise<string>;

    /** Počaka, da je zaslon res priklopljen. `waitForText(LEAD)` se vrne že s
     *  stranice Cenika, kjer je isti stavek, in takrat meri DOM, ki še ni naš. */
    const cekajZaslon = async (naslov: string, ms = 20_000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if ((await textOf('h1')).includes(naslov)) return true;
        await sleep(250);
      }
      return false;
    };
    /** Počaka, da je STREŽNIK sprejel cene. `Shrani cene` je kliknjen, PUT pa
     *  teče v ozadju — brez tega bi test bral kartico z vrednostmi iz prejšnjega
     *  zapisa (merjeno: vmesni posnetek je pokazal 460 € na že izpraznjenem ceniku). */
    const cekajCenik = async (n: number, ms = 20_000): Promise<string> => {
      const t0 = Date.now();
      let nazadnje = '';
      while (Date.now() - t0 < ms) {
        nazadnje = String(await evaluate(`(async () => Object.keys((((await (await fetch('/api/cenik')).json())) || {}).values ?? {}).length)()`));
        if (nazadnje === String(n)) return nazadnje;
        await sleep(250);
      }
      return `${nazadnje}≠${n}`;
    };
    const cekajElement = async (sel: string, ms = 20_000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await exists(sel)) return true; await sleep(300); }
      return false;
    };
    /** Počaka, da v kartici res STOJI iskanega besedila — React mora po izbrisu
     *  cen najprej predelati projekt, sicer bi brali prejšnji izris. */
    const cekajVsebino = async (sel: string, besedilo: string, ms = 20_000): Promise<string> => {
      const t0 = Date.now();
      let nazadnje = '';
      while (Date.now() - t0 < ms) {
        nazadnje = await textOf(sel);
        if (nazadnje.includes(besedilo)) return nazadnje;
        await sleep(300);
      }
      return nazadnje;
    };


    const zasledujFetch = async (): Promise<string> =>
      String(await evaluate(`(() => {
        if (window.__z) return 'ŽE_VKLOPLJEN';
        const izvirni = window.fetch;
        window.__z = [];
        window.fetch = async (u, o) => {
          const r = await izvirni(u, o);
          try {
            window.__z.push({ u: String(u), m: (o && o.method) || 'GET', s: r.status, b: r.ok ? '' : String(await r.clone().text()).slice(0, 200) });
          } catch (e) { window.__z.push({ u: String(u), err: String(e).slice(0, 120) }); }
          return r;
        };
        return 'VKLOPLJEN';
      })()`));
    const zaznano = async (): Promise<string> => String(await evaluate('JSON.stringify(window.__z || [])'));


    const shot = async (name: string): Promise<void> => {
      const r = (await cdp!.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!r.data) throw new Error(`captureScreenshot vrnil ni nobenih bajtov za ${name}`);
      const file = guardOutSideRepo(`${OUT_DIR}/${name}`);
      writeFileSync(file, Buffer.from(r.data, 'base64'));
      const bytes = statSync(file).size;
      if (bytes < 10_000) throw new Error(`posnetek ${name} ima samo ${bytes} B — sumljivo prazen`);
      dump.push(`SCREENSHOT ${name} ${bytes} B`);
    };

    interface Snapped { izbrani: string[]; h: string[]; dis: string[]; ids: string[] }
    const snapshot = async (label: string): Promise<Snapped> => {
      const raw = await evaluate(`(() => {
        const t = (e) => String(e.innerText ?? e.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const izbrani = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map(t);
        const h = [...document.querySelectorAll('h1,h2,h3')].map(t).filter(Boolean);
        const dis = [...document.querySelectorAll('button')].filter((b) => b.disabled).map(t);
        const ids = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
        return JSON.stringify({ izbrani, h, dis, ids });
      })()`) as string;
      const o = JSON.parse(raw) as { izbrani: string[]; h: string[]; dis: string[]; ids: string[] };
      dump.push(`\n===== ${label} =====\n${JSON.stringify(o, null, 1)}`);
      console.log(`… ${label}: izbrani=${o.izbrani.join('/')} h=${o.h.length} onemogočeni=[${o.dis.join(' | ')}]`);
      return o;
    };

    // ── 00–09 VSTOP ────────────────────────────────────────────
    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Pametna kamera', 30000);
    check('00 aplikacija se naloži in ponudi pot do kamere', (await bodyText()).includes('Pametna kamera'), (await bodyText()).slice(0, 120));
    check('01 vstop v kamero je kliknjen', (await clickText('Pametna kamera')) === 'OK' && await cekajZaslon('Pametna kamera'), await pogled());
    check('02 naslov modula je viden', (await textOf('h1')).includes('Pametna kamera'), await textOf('h1'));
    check('03 modul ponudi natanko sedem načinov', (await count(`${TABLIST} [role="tab"]`)) === 7, String(await count(`${TABLIST} [role="tab"]`)));
    for (const [i, label] of TABS.entries()) {
      const najden = await evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(TABLIST)} + ' [role="tab"]')].some((b) => (b.textContent||'').includes(${JSON.stringify(label)})))()`) as boolean;
      check(`0${i + 4} način "${label}" je na pogumu`, najden, label);
    }
    await shot(FILES[0]);

    // ── 10–29 ŽIVI ZAJEM (lažna kamera → prava koda) ───────────
    await snapshot('10 zajem');
    check('10 brskalnik ponuja mediaDevices (nujno za živi zajem)',
      (await evaluate('!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)')) === true, 'null');
    check('11 privzeti način je KAMERA, ne nalaganje',
      (await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === 'Kamera'); return b ? String(b.getAttribute('aria-pressed')) : 'NO'; })()`)) === 'true', 'aria-pressed');
    check('12 živ predogled ima video element', await exists('video[aria-label="Živi predogled kamere"]'), String(await count('video')));
    check('13 monter potrdi vklop kamero z gumbom', (await clickText('Vključi kamero')) === 'OK', (await bodyText()).slice(0, 140));
    const stream = String(await evaluate(`(async () => {
      const v = document.querySelector('video[aria-label="Živi predogled kamere"]');
      for (let i = 0; i < 40; i++) {
        if (v && v.srcObject && v.videoWidth > 0) return 'OK:' + v.videoWidth + 'x' + v.videoHeight + ':tracks=' + v.srcObject.getVideoTracks().length;
        await new Promise((r) => setTimeout(r, 250));
      }
      return 'NO_STREAM';
    })()`));
    check('14 tok teče: živi kader dobi dejanske piksle', stream.startsWith('OK:'), stream);
    check('15 senzorja ni → aplikacija to POVEDO (libela ni tiho izpuščena)',
      await exists('[data-testid="capture-level-unsupported"]'), await notifications());
    check('16 mreža za kader se preklopi', (await clickSel('[data-testid="capture-grid"]')) === 'OK' && await exists('[data-testid="capture-grid-overlay"]'), await textOf('[data-testid="capture-grid"]'));
    check('17 auto-zajem je na voljo', await exists('[data-testid="capture-auto"]'), '0');
    check('18 snemalni vodič po dejavnostih je prikazan', await exists('[data-testid="capture-guide"]'), '0');
    await shot(FILES[1]);
    check('19 sprožilec živega kadra je pritisnjen',
      (await evaluate(`(() => { const b = document.querySelector('button[aria-label="Posnemi fotografijo"]'); if (!b) return 'NO_SHUTTER'; b.click(); return 'CLICKED'; })()`)) === 'CLICKED', 'NO_SHUTTER');
    check('20 kader se shrani v predogled z oceno kakovosti', await waitForText('Zamenjaj fotko', 20000), (await bodyText()).slice(0, 200));
    check('21 kakovost fotke je ocenjena IN povedana', await exists('[data-testid="quality-card"]'), await notifications());
    await shot(FILES[2]);
    // 22–25 KAJ JE V KADRU, KI GA vrne živi zajem? To je edini preostali
    // dokaz, da monterjeva fotka sploh obstaja — merimo ga, ne verjanje.
    // Task 89 je tu izmeril MANJKO (kader = `data:,`); po popravku vrstnega reda
    // v photo-capture.tsx so te vrstice zaklenjene kot CHECK, ne več kot blagi
    // MANJKO — regresija zdaj pade, ne samo označi.
    const živi = await kader();
    check('22 živi zajem vrne pravo sliko (JPEG data-URL z dejanskimi piksli)',
      živi.glava.startsWith('data:image/') && živi.b > 5_000 && živi.px > 0, JSON.stringify(živi));
    await zasledujFetch();
    await clickText('Analiziraj s pametjo');
    await sleep(6_000);
    const živiFaza = await faza();
    check('23 analiza živega kadra pride do rezultata (monter vidi analizo, ne začetnega zaslona)',
      živiFaza === 'rezultat', `faza=${živiFaza}; poteze aplikacije=${await zaznano()}`);
    // 'Merilni list' tu NE more biti zahtevan: kartica je namenoma skrita, dokler
    // `allMeasures.length === 0`, svež živi zajem pa še nima nobene mere.
    check('24 rezultat živega kadra je viden v celoti: označena fotka in panel analize',
      (await exists('img[alt="Zajeta fotografija z oznakami"]')) && Number(await evaluate(
        `(() => { const i = document.querySelector('img[alt="Zajeta fotografija z oznakami"]'); return i ? i.naturalWidth : 0; })()`
      )) > 0 && (await exists('[data-testid="photo-analysis"]')),
      await pogled());
    await shot(FILES[13]);
    // Uspešna pot NE sme pustiti lažnega razloga; razlog ob padcu meri 80/81 na
    // isti banner (gleda na fazo, ne na pot vnosa).
    check('24b ob uspehu aplikacija ne izmišlja napake',
      !(await bodyText()).includes('Analiza ni uspela'), (await bodyText()).slice(0, 160));
    await clickText('Nova fotografija');
    await sleep(900);
    check('25 z rezultatne strani monter vrne na čist zaslon za nov zajem',
      (await exists('[data-testid="capture-guide"]')) && (await bodyText()).includes('Vključi kamero'), await pogled());
    await sleep(1_200);
    // Od tu dalje gre E2E po cesti, ki jo monter res uporabi, ko kamere ni:
    // izberi datoteko → stiskanje → analiza. Živi zajem je izmerjen zgoraj.
    await clickText('Naloži sliko');
    await sleep(400);
    const izbrano26 = await naloziFotko();
    check('26 slika je izbrana z istim vhodom, kot ga ima monter', izbrano26 === 'OK', `${izbrano26} :: ${CAM_INPUT} :: ${await pogled()}`);
    await sleep(1_500);
    const naložena = await kader();
    check('27 naložena fotka dobi pravi kader v predogled', naložena.glava.startsWith('data:image/') && naložena.px > 0 && naložena.b > 5_000, JSON.stringify(naložena));
    check('28 naložena fotka je ocenjena (kakovostni kartica)', await exists('[data-testid="quality-card"]'), await notifications());
    await clickText('Analiziraj s pametjo');
    const analizirano = await waitForText('Vizualiziraj za stranko', 60_000);
    check('29 analiza NALOŽENE fotke konča na rezultatni strani', analizirano && (await faza()) === 'rezultat', `faza=${await faza()}; poteze=${await zaznano()}`);
    const baza = String(await evaluate(`(async () => {
      const r = await fetch('/api/photos'); const d = await r.json();
      const p = (d.photos ?? [])[0];
      if (!p) return 'PRAZNO';
      let an = null; try { an = JSON.parse(p.analysis); } catch { /* pokvarjena analiza */ }
      return JSON.stringify({ n: (d.photos ?? []).length, dataUrl: p.dataUrl.slice(0, 12), h: p.dataUrl.length, analiza: !!an, objekti: an?.analysis?.objects?.length ?? -1, merila: p.measurements, craft: p.craftId });
    })()`));
    const bazaO = JSON.parse(baza === 'PRAZNO' ? '{}' : baza) as { n?: number; analiza?: boolean; objekti?: number; merila?: string | null; craft?: string };
    check('30 analiza gre v bazo (persistirana, ne samo prikazana)', (bazaO.n ?? 0) > 0 && bazaO.analiza === true, baza);
    check('31 v bazi je ANALIZIRANA vsebina (objekti / scena), ne surov kader', (bazaO.objekti ?? 0) >= 0 && (bazaO.craft ?? '') !== '', baza);
    check('32 shrani fotka ima seznam meritev, ki je res JSON (lahko prazen)', typeof bazaO.merila === 'string' && (bazaO.merila.startsWith('[')), baza);
    check('33 obvestilo o shranjevanju je monterju povedano',
      (await toastText()).includes('galerijo') || (await bodyText()).includes('Shranjeno v galerijo'), await toastText());
    await closeToast();
    check('34 galerija pokaže sličico, ki jo je razloži brskalnik (ni pokvarjen bajt)',
      (await evaluate(`(() => { const i = document.querySelector('section[aria-label="Galerija fotografij"] img'); return i ? (i.naturalWidth > 0 ? 'OK' : 'NOPX') : 'NO_THUMB'; })()`)) === 'OK',
      String(await evaluate('document.querySelectorAll(\'section[aria-label="Galerija fotografij"] img\').length')));
    const projekt = String(await evaluate(`(() => {
      const e = document.querySelector('[data-testid="photo-project"]');
      return e ? String(e.innerText).replace(/\\s+/g, ' ').trim().slice(0, 200) : '__MANJKA__';
    })()`));
    check('35 projekt iz fotk se pokaže pod galerijo', await waitForText('Projekt iz fotografij', 20000) && await exists('[data-testid="photo-project"]'),
      `prepoznana dejavnost v bazi=${bazaO.craft ?? '-'}; kartuša=${projekt}; glave=${JSON.stringify((await snapshot('35 projekt')).h)}`);
    // Merilni list je NA ZASLONU šele, ko obstaja mera — to je pogoj, ki ga
    // monitor vidi kot praznino, test pa kot pravilno zavrnjen element.
    await clickText('Pripomočki');
    await sleep(700);
    await setVal('input[aria-label="Dolžina iz laserskega merilnika v centimetrih"]', '800');
    await clickSel('button[aria-label="Dodaj izmer iz laserskega merilnika"]');
    await sleep(500);
    await closeToast();
    await clickText('Zajem + analiza');
    await sleep(700);
    check('36 mera iz laserja je takoj na voljo v merilnem listu (fotka + mera = dokument)',
      await exists('[data-testid="sheet-download"]') && await exists('[data-testid="report-print"]'),
      JSON.stringify((await snapshot('36 merilni list')).ids).slice(0, 300));
    check('37 fotka in mera sta prikazani skupaj (3D predogled meritev)', (await bodyText()).includes('3D predogled meritev'), (await bodyText()).slice(0, 200));
    await shot(FILES[12]);

    // ── 40–45 DENARNA VRATA (Task 88) ──────────────────────────
    // Cene se vpisujejo in brišejo IZ KONA ZASLONA Cenik — test ne piše v bazo,
    // ker bi sicer mimo store-a potrdil stanje, ki ga monitor nikoli ne vidi.
    const natipkajVseCene = (): Promise<number> => evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      let n = 0;
      for (const i of document.querySelectorAll('[id^="cenik-row-"] input')) {
        set.call(i, '10'); i.dispatchEvent(new Event('input', { bubbles: true })); n++;
      }
      return n;
    })()`) as Promise<number>;
    const pocistiVseCene = (): Promise<number> => evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-testid^="cenik-clear-"]')];
      for (const x of b) x.click();
      return b.length;
    })()`) as Promise<number>;

    // Denarna vrata merimo OD ZACETKA: Cenik se najprej izprazni, da odvek 40–45
    // ne visi na tem, kaj je v bazi pustil kak prejšnji zagon.
    await clickText('Cenik');
    await waitForText('vpisanih', 20000);
    await pocistiVseCene();
    await clickText('Shrani cene');
    const začetno = await cekajCenik(0);
    await closeToast();
    await clickText('Pametna kamera');
    await cekajZaslon('Pametna kamera');
    await cekajElement('[data-testid="photo-project"]');
    const karticaBrezCen = await cekajVsebino('[data-testid="photo-project"]', 'ni izračunano');
    check(`40 brez vpisanih cen se številka NE prikaže (cenik na strežniku: ${začetno})`,
      karticaBrezCen.includes('ni izračunano') && !karticaBrezCen.includes('€'), karticaBrezCen);
    check('41 gumb za zbiranje je ZAPRT (DOM disabled, ne videz)', (await stateOf('[data-testid="collect-project"]')) === 'DISABLED', await stateOf('[data-testid="collect-project"]'));
    const refusal = await textOf('[data-testid="project-price-refusal"]');
    check('42 zavrnitev IMENUJE vrstice in pot (Cenik)', refusal.includes('Cen') && refusal.includes('Vpiši cene'), refusal.replace(/\s+/g, ' ').slice(0, 260));

    await clickText('Cenik');
    await waitForText('vpisanih', 20000);
    const tipkanih = await natipkajVseCene();
    check('43a monter v Ceniku tipka VSE vrstice (54 polj na zaslonu)', tipkanih === 54, String(tipkanih));
    check('43b Shrani cene sprejme vpis (strežnik: 54 cen)', (await clickText('Shrani cene')) === 'OK' && (await cekajCenik(54)) === '54', await notifications());
    await closeToast();
    await clickText('Pametna kamera');
    await cekajZaslon('Pametna kamera');
    const karticaZCenami = await cekajVsebino('[data-testid="photo-project"]', 'brez DDV');
    check('43 projekt iz fotk prevzame CENE, KI JIH JE VPISAL MONTER', karticaZCenami.includes('brez DDV') && karticaZCenami.includes('€'), karticaZCenami);
    await shot(FILES[11]);
    check('44 ko so cene vpisane, se gumb ODPRE', (await stateOf('[data-testid="collect-project"]')) === 'ENABLED', await stateOf('[data-testid="collect-project"]'));
    await clickText('Cenik');
    await waitForText('vpisanih', 20000);
    const pocistih = await pocistiVseCene();
    check('45a izbris je ZAVESTEN gumb na vrstici, ne izpraznjeno polje', pocistih === 54, String(pocistih));
    check('45b Shrani cene zabeleži izbris (strežnik ostane BREZ cen)',
      (await clickText('Shrani cene')) === 'OK' && (await cekajCenik(0)) === '0', await notifications());
    await closeToast();
    await clickText('Pametna kamera');
    await cekajZaslon('Pametna kamera');
    const karticaPoIzbrisu = await cekajVsebino('[data-testid="photo-project"]', 'ni izračunano');
    check('45 zavesten izbris cen SPET zapre dokument (null, ne 0)',
      (await stateOf('[data-testid="collect-project"]')) === 'DISABLED' && karticaPoIzbrisu.includes('ni izračunano') && !karticaPoIzbrisu.includes('€'),
      `${await stateOf('[data-testid="collect-project"]')} :: ${karticaPoIzbrisu}`);

    // ── 50–58 SEDEM ZAVIHKOV V ŽIVEM BRSKALNIKU ────────────────
    await clickText('Zajem + analiza');
    await sleep(500);
    await shot(FILES[0]);
    const tabV = [FILES[3], FILES[4], FILES[5], FILES[6], FILES[7], FILES[8]];
    for (const [i, label] of TABS.slice(1).entries()) {
      check(`5${i} preklop na "${label}" uspe`, (await clickText(label)) === 'OK' && (await evaluate(`(() => {
        const b = [...document.querySelectorAll(${JSON.stringify(TABLIST)} + ' [role="tab"]')].find((x) => (x.textContent||'').includes(${JSON.stringify(label)}));
        return b?.getAttribute('aria-selected') === 'true' ? 1 : 0;
      })()`)) === 1, label);
      await sleep(800);
      const o = await snapshot(`5${i} ${label}`);
      check(`5${i} "${label}" ni prazna lupina (ima svojo vsebino)`, o.h.length >= 2 || o.ids.length >= 2, JSON.stringify(o.h).slice(0, 200));
      await shot(tabV[i]);
    }
    // AR zavihek: svoja kamera, svoja zavrnitev brez kamere.
    await clickText('AR merjenje');
    await sleep(600);
    check('56 AR ima svoj živi pogled in svoj gumb', (await bodyText()).includes('AR'), (await bodyText()).slice(0, 140));
    // 3D model: shranjevanje sme biti zaprto, dokler merilo ni znano.
    await clickText('3D model');
    await sleep(600);
    check('57 3D model brez uvoženega merila ZAVRNE shranjevanje',
      (await count('button[disabled]')) > 0 || (await bodyText()).includes('meril'), await notifications());
    // Pripomočki: laser + glas.
    await clickText('Pripomočki');
    await sleep(700);
    const orodja = await snapshot('58 pripomočki');
    check('58 pripomočki ponudijo laser, glas in skico prostora',
      (await bodyText()).includes('laser') || (await bodyText()).includes('Laser'), JSON.stringify(orodja.h).slice(0, 220));

    // ── 60–70 ZMOŽNOSTI, KI IH TA BRSKALNIK NIMA ───────────────
    const hasBT = (await evaluate('!!(navigator.bluetooth)')) === true;
    check(`60 aplikacija ve, ali brskalnik podpira Web Bluetooth (tu: ${hasBT})`,
      hasBT ? (await bodyText()).includes('Poveži') : (await bodyText()).includes('ne podpira Web Bluetooth'), (await bodyText()).slice(0, 160));
    check('61 brez Bluetootha sme ostati ROČNI VNOS (monter ne izgubi mere)',
      (await bodyText()).includes('Ročni vnos izmerka'), (await bodyText()).slice(0, 160));
    const laserInput = 'input[aria-label="Dolžina iz laserskega merilnika v centimetrih"]';
    const laserGumb = 'button[aria-label="Dodaj izmer iz laserskega merilnika"]';
    check('62 ročni izmer je vpisan', (await setVal(laserInput, '350')) === 'OK' && (await clickSel(laserGumb)) === 'OK', await val(laserInput));
    // Branje prek data-testid, NE prek slovenskega naslova: naslov se sklania
    // (1 → »Dodana mera«, 5 → »Dodane meritve«), test pa ne sme zasledovati copypaste.
    const seznamMer = async (): Promise<string> => String(await evaluate(`(() => {
      const el = document.querySelector('[data-testid="aux-measures"]');
      return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240) : '__NI_SEZNAMA__';
    })()`));
    const steviloMer = async (): Promise<number> =>
      Number(await evaluate(`Number(document.querySelector('[data-testid="aux-measures"]')?.getAttribute('data-count') ?? -1)`));
    const naslovMer = async (): Promise<string> => String(await evaluate(
      `document.querySelector('[data-testid="aux-measures-title"]')?.textContent ?? '__NI_NASLOVA__'`));
    const SKLONI = ['Dodana mera', 'Dodani meri', 'Dodane mere', 'Dodane meritve'];
    const pričakovaniNaslov = (n: number): string => {
      const m = n % 100;
      const oblika = n === 1 ? SKLONI[0] : n === 2 || m === 2 ? SKLONI[1] : n === 3 || n === 4 || m === 3 || m === 4 ? SKLONI[2] : SKLONI[3];
      return `${oblika} (${n})`;
    };
    await sleep(400);
    const predZavrnitvijo = await steviloMer();
    check('63 mera iz laserja je dodana in OZNAČENA kot ročna (laser)',
      (await steviloMer()) >= 1 && (await seznamMer()).includes('Laser'), await seznamMer());
    check('63a naslov seznama se SKLONI po številu mer (ne »Dodane meritve (1)«)',
      (await naslovMer()) === pričakovaniNaslov(await steviloMer()), `${await naslovMer()} <> ${pričakovaniNaslov(await steviloMer())}`);
    gap('63b mera, dodana v prejšnjem obisku modula, JE še na seznamu (800 cm iz koraka 36)',
      (await seznamMer()).includes('8,00 m'), await seznamMer());
    check('64 350 cm se pokaže kot 3,50 m (enotna pretvorba na zaslonu)', (await bodyText()).includes('3,50 m'), await seznamMer());
    check('65 mera je takoj uporabljena naprej (razpored stebrov se pojavi)',
      (await bodyText()).includes('Razpored stebrov iz teh meritev'), (await bodyText()).slice(0, 140));
    await shot(FILES[8]);
    await closeToast();
    await setVal(laserInput, '90000');
    await clickSel(laserGumb);
    await sleep(400);
    check('66 mera zunaj razpona se ZAVRNE z razlogom, ki ponovi mejo',
      (await bodyText()).includes('1–50.000 cm'), (await bodyText()).replace(/\s+/g, ' ').slice((await bodyText()).indexOf('Ročni vnos'), (await bodyText()).indexOf('Ročni vnos') + 260));
    check('67 in zavrnitev res NI dodala mere (števci se ne smejo lagati)',
      (await steviloMer()) === predZavrnitvijo && predZavrnitvijo > 0, `${predZavrnitvijo} → ${await steviloMer()} :: ${await seznamMer()}`);
    await closeToast();
    // Nedeljivi API-ji: aplikacija sme pokazati svojo pot, ne zrušiti se.
    // Pogoj v kodi je `'bluetooth' in navigator`, zato je ključ treba
    // odstraniti z navigatorjevega PROTOTIPE. `defineProperty(navigator, …)`
    // pusti ključ na mestu in veja do te mere nikoli ne pride.
    await evaluate('(() => { try { return String(Reflect.deleteProperty(Navigator.prototype, "bluetooth")); } catch (e) { return "locked:" + e.name; } })()');
    await clickText('Zajem + analiza'); await sleep(400);
    await clickText('Pripomočki'); await sleep(600);
    gap('68 brez Bluetootha aplikacija POVEDO, naj uporabi ročni vnos',
      (await bodyText()).includes('ne podpira Web Bluetooth'), await bodyText().then((b) => b.slice(0, 220)));
    await evaluate('(() => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; return "ok"; } catch (e) { return "e"; } })()');
    await clickText('Zajem + analiza'); await sleep(300);
    await clickText('Pripomočki'); await sleep(600);
    gap('69 brez prepoznavanja govora aplikacija to POVEDO (ne pusti praznega gumba)',
      (await bodyText()).includes('Glasovni vnos ni podprt'), (await bodyText()).slice(0, 200));
    check('70 in je kljub temu dosegljiva ročna pot do mere', (await bodyText()).includes('Ročni vnos izmerka'), (await bodyText()).slice(0, 160));

    // WebXR: na namizju ga ni → mora pokazati 2D AR namesto prazne poti.
    const xr = String(await evaluate(`(async () => {
      const md = navigator.xr;
      if (!md) return 'BREZ_NAVIGATOR_XR';
      try { return 'PODPORA:' + await md.isSessionSupported('immersive-ar'); } catch (e) { return 'ZAVRNJE:' + e.name; }
    })()`));
    check('71 aplikacija ve, ali je pravi AR mogoč (namizje: ne)', /BREZ_NAVIGATOR_XR|PODPORA:false|ZAVRNJE/.test(xr), xr);

    // ── 72–82 POTI, KI SE TAJO TIHO: kjer uporabnik ne vidi nič ─
    // Rezultatna stran NI samoumevna: vsak obisk Cenika ponovno priklopi modul,
    // zato se tja vrneva po isti poti, po kateri gre monter (nalaganje → analiza).
    const potNaRezultat = await pojdiVRezultat();
    check('72 iz rezultatne strani vodi gumb nazaj na zajem (Nova fotografija)',
      potNaRezultat === 'rezultat' && (await clickText('Nova fotografija')) === 'OK', `${potNaRezultat} :: ${await pogled()}`);
    await sleep(700);
    check('73 gumb vrne čist zaslon za zajem (vodič + ponudba za vklop kamere, ne praznina)',
      (await exists('[data-testid="capture-guide"]')) && (await bodyText()).includes('Vključi kamero'), await pogled());
    // Gumb modula je PREKLOP: klik, ko je 'Kamera' že pritisnjen, te vleče
    // nazaj na nalaganje. Zato stanje najprej preberemo, kliknemo samo če treba.
    const kameraPrižgana = async (): Promise<string> => String(await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Kamera');
      if (!b) return 'NI_GUMBA';
      if (b.getAttribute('aria-pressed') !== 'true') { b.scrollIntoView({ block: 'center' }); b.click(); return 'PREKLOPLJENO'; }
      return 'ŽE_KAMERA';
    })()`));
    // Pot brez kamere: dovoljenje je zavrnjeno, preden jo monter sploh vklopi.
    await evaluate('(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Dovoljenje zavrnjeno", "NotAllowedError")); return "STUB"; })()');
    const preklop = await kameraPrižgana();
    check('74a pogled je na KAMERI (gumb modula, ne navigacija)', preklop === 'ŽE_KAMERA' || preklop === 'PREKLOPLJENO', `${preklop} :: ${await pogled()}`);
    await sleep(400);
    check('74 monter izrecno potrdi vklop kamere', (await clickText('Vključi kamero')) === 'OK', await pogled());
    await sleep(1500);
    const mode = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === 'Naloži sliko'); return b ? String(b.getAttribute('aria-pressed')) : 'NO'; })()`);
    check('75 brez kamere se aplikacija SAMA preklopi na nalaganje (monter ne obtiči)', mode === 'true', String(mode));
    check('76 in razlog, zakaj kamera ni zažela, je monterju POVEDAN',
      (await bodyText()).includes('Dostop do kamere ni mogoč'), await notifications());
    // 76b: NA TABLICI IZMERJENO, da Android zavrne kamero tudi, ko je dovoljenje
    // `granted` (brskalnik je bil v ozadju) — takrat je napaka `NotReadableError`
    // in svetovanje »preveri dovoljenja« monterja pošlje v napačno smer.
    await evaluate(`(() => { const d = navigator.mediaDevices; window.__pravi = d.getUserMedia.bind(d);
      d.getUserMedia = () => Promise.reject(new DOMException('zasedena', 'NotReadableError')); return 'stub'; })()`);
    await clickText('Kamera');
    await sleep(1800);
    const razlog76b = await bodyText();
    check('76b zasedena kamera (NotReadableError) DOBI svoj razlog, ne besedila o dovoljenjih',
      razlog76b.includes('Kamera je zasedena') && !razlog76b.includes('preveri dovoljenja'),
      (await evaluate(`JSON.stringify([...document.querySelectorAll('[role="alert"]')].map((x) => (x.textContent||'').trim()))`)));
    await evaluate(`(() => { const d = navigator.mediaDevices; if (window.__pravi) d.getUserMedia = window.__pravi; return 'pravi'; })()`);
    await shot(FILES[9]);

    // Analiza, ki jo strežnik zavrne → kje je uporabnik?
    await evaluate(`(() => {
      const izvirni = window.fetch;
      window.fetch = (u, o) => (String(u).includes('/api/analyze-photo') && o && String(o.method) === 'POST')
        ? Promise.resolve(new Response(JSON.stringify({ error: 'Fotografije ni bilo mogoče prebrati. Posnemi jo znova.' }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
        : izvirni(u, o);
      return 'BROKEN';
    })()`);
    const izbrano77 = await naloziFotko();
    check('77 slika je izbrana z istim vhodom, kot ga ima monter', izbrano77 === 'OK', `${izbrano77} :: ${await pogled()}`);
    await sleep(1500);
    check('78 pred analizo je vidna ocena kakovosti', await exists('[data-testid="quality-card"]'), await notifications());
    await clickText('Analiziraj s pametjo');
    await sleep(6000);
    const failText = await bodyText();
    check('79 zavrnitev strežnika ne pokaže polovičnega rezultata', !failText.includes('Merilni list'), failText.slice(0, 200));
    check('80 razlog zavrnitve je monterju POVEDAN', failText.includes('Fotografije ni bilo mogoče prebrati'), await notifications());
    check('81 in izbira fotke NI tiho izgubljena (monter je ne rabi ponovno brati)',
      failText.includes('Zamenjaj fotko'), await pogled());
    await shot(FILES[10]);
    await evaluate('location.reload()');
    await sleep(3000);
    await waitForText('Pametna kamera', 30000);
    await clickText('Pametna kamera');
    await cekajZaslon('Pametna kamera');
    check('82 po ponovnem zagonu je galerija še vedno polna (baza preživi)',
      (await evaluate(`(async () => { const d = await (await fetch('/api/photos')).json(); return (d.photos ?? []).length; })()`)) as number > 0,
      String(await evaluate(`(async () => ((await (await fetch('/api/photos')).json()).photos ?? []).length)()`)));

    // ── 90–105 DOKAZI NA DISKU + IZVLEČEK ───────────────────────
    for (const [i, f] of FILES.entries()) {
      let bytes = 0;
      try { bytes = statSync(guardOutSideRepo(`${OUT_DIR}/${f}`)).size; } catch { /* manjka */ }
      check(`${90 + i} dokaz ${f} je na disku (> 10 kB)`, bytes > 10_000, `${bytes} B`);
    }
    // Tretji argument je moral biti IZMERJENA vrednost: prej je bila tu hardkodirana
    // beseda 'PRAZNO', zato je vsak drug izid (FAIL:500, undefined) izgledal kot
    // prazna galerija in je maskiral pravi vzrok.
    // Drugi zaporedni ukrep: aritmetika dolžine ni lastnost brisanja. `GET /api/photos`
    // vrača samo 24 najnovejših (`take: 24` v api/photos/route.ts), zato se v polni bazi
    // seznam po brisanju NE skrči — zamešeno je bilo 27 fotk v bazi, ne izguba brisanja.
    // Pravi dokaz: status 200 IN izbrisani id izgine iz seznama.
    const brisanje = String(await evaluate(`(async () => {
      const pred = ((await (await fetch('/api/photos')).json()).photos ?? []);
      const p = pred[0];
      if (!p) return 'PRAZNO';
      const r = await fetch('/api/photos/' + p.id, { method: 'DELETE' });
      if (!r.ok) return 'FAIL:' + r.status;
      const posle = ((await (await fetch('/api/photos')).json()).photos ?? []);
      if (posle.some((x) => x.id === p.id)) return 'OSTALA_V_SEZNAMU';
      if (pred.length < 24 && posle.length !== pred.length - 1) {
        return 'STEVILO:' + pred.length + '->' + posle.length;
      }
      return 'OK:' + pred.length + '->' + posle.length + ' (id ' + p.id.slice(0, 6) + ' izginil)';
    })()`));
    check('104 brisanje fotke iz galerije uspe (200, fotka izgine, ne molk)',
      brisanje.startsWith('OK'), brisanje);
    const exceptions = cdp.exceptions();
    check('105 v celotnem zagonu ni nobene konzolne izjeme', exceptions.length === 0, exceptions.join(' | ').slice(0, 320));

    writeFileSync(guardOutSideRepo(LOG), dump.join('\n'), 'utf8');
    console.log(`\ndnevnik stanja zaslonov: ${LOG}`);
    if (manjki.length > 0) {
      console.log(`\nIZMERJENI MANJKI (${manjki.length}) — aplikacija te poti še ne zmore:`);
      for (const m of manjki) console.log(`  • ${m}`);
    }
    console.log(`\nREZULTAT: ${pass} OK, ${fail} NAPAK, ${manjki.length} IZMERJENIH MANJKOV`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    try { cdp?.close(); } catch { /* že zaprto */ }
    chrome.kill();
  }
}

void main();
