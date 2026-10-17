// E2E: CENE VPIŠE OBRTNIK, APLIKACIJA JIH NE ZNA (Task 88).
//
// ZAKAJ E2E IN NE SAMO ENOTNI TEST: enotni test (`cenik-guard`) dokaže, da v
// kodi ni denarja. Tu pa dokazujemo štiri stvari, ki jih lahko vidi samo
// monter z zaslonom:
//  a) ZAČETNO STANJE JE PRAZNO — nobena od 54 cenovnih vrstic nima številke;
//     polje je prazno in piše »Ni vpisana«, ne »0,00 €«;
//  b) BREZ CENE NI DOKUMENTA — kalkulator izpiše KOLIČINE in zavrne denar z
//     razlogom, ki IMENUJE vrstice; gumb za ponudbo je zaprt; opcije za
//     stranko (GBB) se ne prikažejo;
//  c) VPISANO JE RESNICA — številka, ki jo tipka, gre na strežnik dobesedno
//     (187,5 → 187.5), preživi osvežitev in je TO ISTA številka, ki jo na
//     koncu najde v bazi v ponudbi. Ničel, zaokroževanj in nadomestnih
//     vrednosti ni;
//  d) IZBRIS JE ZAVESTNA ODLOČITEV — številko odstrani SAMO gumb »Izbriši
//     ceno« (strežniku gre `null`). Izprazniti polje je neodločenost in na
//     strežnik ne gre nič; po izbrisu se ponudba ponovno ZAPRE in imenuje
//     točno tisto vrstico.
//
// PLUS: 0 € je VELJAVNA cena (ne manjkajoča), –5 in »abc« se zavrjeta z
// razlogom, ki ponovi vpisano.
//
// Zagon: bun tests/e2e-cenik-ui.ts  (zahteva `next dev`; privzeto :3000,
// zamenljivo z `APP_URL=http://localhost:3018/`)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9352;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');
const PROFILE = join(OUT_DIR, 'cenik-profile');
const ROOT_CALC = '[data-craft="ograje"]';
const LEAD = 'Cene vpišeš SAMO tu';
const PREFON = 'Cena na enoto — ';

// Nazivi, ki jih vidi monter — vzeti IZ REGISTRA, ne pisati na pamet.
const CENA_ALU = 'Aluminijasta ograja (€/m)';
const CENA_STEBER = 'Stebri (aluminij 40×40) (€/kos)';
const CENA_VIJAKI = 'Vijačevje in pritrdilni material (€/kompl/m)';
const CENA_MONTAZA = 'Montaža ograje (€/m)';

/** Ime vrstice → CENA, KI JO JE VPISAL OBRTNIK (ne aplikacija). */
const IME_ALU = 'Aluminijasta ograja';
const IME_STEBER = 'Stebri (aluminij 40×40)';
const IME_VIJAKI = 'Vijačevje in pritrdilni material';
const IME_MONTAZA = 'Montaža ograje';
const MOJE_CENE: Record<string, number> = {
  [IME_ALU]: 187.5,
  [IME_STEBER]: 40.25,
  [IME_VIJAKI]: 1.2,
  [IME_MONTAZA]: 24,
};
/** Isti zneski v obliki, ki jo morata pokazati zaslon in urejevalnik: vejica
 *  in tolik decimalk, kot jih je vpisal monter (`formatNum` ne dodaja ničel). */
const MOJE_BESEDILA: Record<string, string> = {
  [IME_ALU]: '187,5',
  [IME_STEBER]: '40,25',
  [IME_VIJAKI]: '1,2',
  [IME_MONTAZA]: '24',
};

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
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(rest.length ? rest[0] : '')).slice(0, 300)}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Artefakti SMEJO LIVEITI samo izven repozitorija (Task 78). */
function guardOutSideRepo(p: string): string {
  const root = resolve(process.cwd());
  const rp = resolve(p);
  if (rp === root || rp.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error(`ZASEBNOST: artifact bi bil zapisan v repozitorij: ${rp}`);
  }
  return rp;
}

/** Slovensko število (pika = tisočice, vejica = decimalna, € in NBSP stran). */
function slStevil(s: string): number {
  const c = String(s).replace(/[\s\u00a0]/g, '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return c === '' ? Number.NaN : Number(c);
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
  let cdp: Cdp | null = null;
  try {
    await waitCdp();
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
      { type: string; url?: string; webSocketDebuggerUrl: string }[];
    const pages = list.filter((t) => t.type === 'page' && !/^chrome-extension:/.test(t.url ?? ''));
    const page = pages.find((t) => (t.url ?? '').startsWith('http://localhost')) ?? pages[0];
    if (!page) throw new Error('zavihek ni najden na /json/list');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });

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
    // Vnos KOT GA UDERI MONTER: native setter + EN `input` dogodek.
    const setVal = async (sel: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(sel)});
        if (!i) return 'NO_INPUT';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`));
    const val = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(sel)});
        return i ? String(i.value) : 'NO_INPUT';
      })()`));
    const attr = async (sel: string, a: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(sel)});
        return i ? String(i.getAttribute(${JSON.stringify(a)})) : 'NO_INPUT';
      })()`));
    const byLabel = (label: string): string => `input[aria-label="${label}"]`;
    /** Cenik se po osvežitvi POLNI ASINHRONO (useCenik → /api/cenik). Brati
     *  vrednosti takoj za prvim besedilom pomeni meriti prazen zaslon, ne
     *  shranjenih cen — zato test POČAKA, da je toliko polj napolnjenih,
     *  kolikor jih je na strežniku, in šele takoj trdi. */
    const pocakajNapolnjeno = async (pricanih: number, ms = 20000): Promise<number> => {
      const t0 = Date.now();
      let n = -1;
      while (Date.now() - t0 < ms) {
        n = Number(await evaluate(`[...document.querySelectorAll('[id^="cenik-row-"] input')].filter((i) => i.value !== '').length`));
        if (n === pricanih) return n;
        await sleep(150);
      }
      return n;
    };
    // ID cenovne vrstice VSEBUJE piko ('cenik-row-ograje.alu'), zato `#id` NE
    // sme: CSS bi iz 'ograje' naredil razred. Vedno atributni selector.
    const rowSel = (key: string): string => `[id="cenik-row-${key}"]`;
    const clearSel = (key: string): string => `${rowSel(key)} [data-testid="cenik-clear-${key}"]`;
    const pendingSel = (key: string): string => `${rowSel(key)} [data-testid="cenik-pending-delete"]`;
    /** Stavek NEVELJAVNOSTI pod cenovnim poljem — NumField ga piše v ovoju
     *  vrstice `#cenik-row-<key>` (na Nastavitvah je drug testid; tu živi
     *  cenikova differentna pot). */
    const noteField = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(byLabel(label))});
        const row = i && i.closest('[id^="cenik-row-"]');
        const p = row && row.querySelector('[data-testid="numfield-refusal"]');
        return p ? String(p.textContent) : '__MISSING__';
      })()`));
    /** `disabled` je DOM PROSTORINA: React ga izriše kot attribute="", zato
     *  getAttribute('disabled') NI dokaz. Branje lastnosti je dokaz. */
    const isDisabled = async (sel: string): Promise<string> =>
      String(await evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(sel)});
        return b ? String(b.disabled) : '__NI_GUMBA__';
      })()`));
    /** Obvestilo: zaslon jih hrani ENO samo (TOAST_LIMIT = 1), a ne izrine
     *  sam — brez tega bi STOJEČE obvestilo iz prejšnjega koraka »potrdilo«
     *  naslednjega. Beremo samo odprto obvestilo in ga pred akcijo zapremo. */
    // Radix NIMA `role="status"` na vidnem obvestilu (li) — tam je samo
    // `data-state`. `role="status"` je skrita avdio- napoved, ki vsebuje isto
    // besedilo, zato uporabiva oboje: vidni li, če je še v igri, sicer
    // napoved. Nikoli kar `li` brez stanja, ker je zaprto obvestilo še v DOM.
    const toastSel = 'li[data-state="open"], [role="status"]';
    const toastText = async (): Promise<string> =>
      String(await evaluate(`(() => {
        const li = document.querySelector('li[data-state="open"]') || document.querySelector('[role="status"]');
        return li ? String(li.textContent) : '';
      })()`));
    const closeToast = async (): Promise<void> => {
      await evaluate(`(() => {
        const li = document.querySelector('li[data-state="open"]');
        if (!li) return 0;
        const bs = li.querySelectorAll('button');
        // ToastClose je ZADNJI gumb v obvestilu; prvi je lahko akcija (»Odpri
        // ponudbo«), ki je NE smemo pritisniti.
        const b = bs[bs.length - 1];
        if (b) b.click();
        return 1;
      })()`);
      await sleep(350);
    };
    const waitForToast = async (needle: string, ms = 20000): Promise<string> => {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < ms) {
        last = await toastText();
        if (last.includes(needle)) return last;
        await sleep(120);
      }
      return last;
    };
    /** KATEROKOLI obvestilo v naslednjih ms-ih — za diagnose, ko test trdi,
     *  da določenega NI: takrat je pomembno vedeti, kaj je pa zaslon REKEL. */
    const catchToast = async (ms = 4000): Promise<string> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const t = await toastText();
        if (t.trim() !== '') return t;
        await sleep(120);
      }
      return '';
    };
    /** Vrstica kalkulatorja, razčlenjena na ime / količina × cena / znesek —
     *  test mora računati IZ ZASLONA, ne iz predpostavke o količini. */
    const calcRows = async (): Promise<{ name: string; detail: string; amount: string }[]> =>
      (await evaluate(`[...document.querySelectorAll(${JSON.stringify(`${ROOT_CALC} [data-testid="price-line"]`)})].map((r) => ({
        name: String((r.querySelector('p') || {}).textContent || ''),
        detail: String((r.querySelector('[data-testid="line-detail"]') || {}).textContent || ''),
        amount: r.querySelector('[data-testid="line-amount"]')
          ? String(r.querySelector('[data-testid="line-amount"]').textContent) : '__BREZ__',
      }))`)) as { name: string; detail: string; amount: string }[];
    const cenikApi = (): Promise<Record<string, number>> =>
      evaluate(`fetch('/api/cenik').then((r) => r.json()).then((d) => d.values ?? {})`) as Promise<Record<string, number>>;
    const vsotaTeksta = async (): Promise<string> => {
      const t = await bodyText();
      const m = /Vsota \(brez DDV\)\s*\n\s*([^\n]*)/.exec(t);
      return m ? m[1] : '__MISSING__';
    };
    const ceneUrejevalnika = (): Promise<Record<string, string>> =>
      evaluate(`(() => {
        const pref = ${JSON.stringify(PREFON)};
        const out = {};
        for (const i of document.querySelectorAll('input[aria-label^="' + pref + '"]')) {
          out[i.getAttribute('aria-label').slice(pref.length)] = i.value;
        }
        return out;
      })()`) as Promise<Record<string, string>>;
    const zadnjaPonudba = (): Promise<{ st: number; stevilka: string | null; cene: Record<string, number>; kolicine: string[] }> =>
      evaluate(`fetch('/api/offers').then((r) => r.json()).then((d) => {
        const o = (d.offers ?? [])[0];
        if (!o) return { st: (d.offers ?? []).length, stevilka: null, cene: {}, kolicine: [] };
        const cene = {};
        for (const i of o.items) cene[i.name] = i.unitPrice;
        return {
          st: (d.offers ?? []).length,
          stevilka: o.number,
          cene,
          kolicine: o.items.map((i) => i.quantity + ' ' + i.unit),
        };
      })`) as Promise<{ st: number; stevilka: string | null; cene: Record<string, number>; kolicine: string[] }>;
    const screenshot = async (file: string): Promise<string> => {
      const p = guardOutSideRepo(join(OUT_DIR, file));
      const s = (await cdp!.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!s.data) throw new Error(`captureScreenshot (${file}) vrnil ni bajtov`);
      writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    };

    // ══ A) CENIK SE ZAČNE PRAZEN ═════════════════════════════
    // KORAK 0 — preden trdimo karkoli o PRACHEM ceniku, ga izpraznimo po
    // ISTI poti, po kateri ga izprazni obrtnik (zavesten izbris = null).
    // Brez tega drugi zagon testa meri stanje prvega in vsa poglavja A/B
    // padejo, ker denar že visi na vrsticah.
    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    const reset = await evaluate(`fetch('/api/cenik').then((r) => r.json()).then((d) => {
      const patch = {};
      for (const k of Object.keys(d.values ?? {})) patch[k] = null;
      if (Object.keys(patch).length === 0) return "PRAZEN";
      return fetch("/api/cenik", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json()).then((s) => "IZBRISANO_" + Object.keys(patch).length + "_OSTALO_" + Object.keys(s.values ?? {}).length);
    })`) as string;
    check('0 Cenik je pred zagonom izpraznjen (null = isti izbris kot na zaslonu)',
      reset === 'PRAZEN' || reset.endsWith('_OSTALO_0'), reset);

    await cdp.send('Page.navigate', { url: APP });
    check('1 aplikacija naložena', await waitForText('Domov'), (await bodyText()).slice(0, 120));
    check('2 vrata v Cenik so v vrhu zaslona', (await clickText('Cenik')) === 'OK' && await waitForText(LEAD), (await bodyText()).slice(0, 160));
    const st0 = await cenikApi();
    check('3 na strežniku ni VPISANE nobene cene (prazen Cenik, ne ničle)', Object.keys(st0).length === 0, JSON.stringify(st0).slice(0, 160));
    check('4 Cenik ima 54 vnosnih polj — eno za vsako registrirano vrstico', (await count('[id^="cenik-row-"] input')) === 54, String(await count('[id^="cenik-row-"] input')));
    const praznaA = Number(await evaluate(`[...document.querySelectorAll('[id^="cenik-row-"] input')].filter((i) => i.value === '').length`));
    check('5 vseh 54 polj je PRAZNIH (nobena predvpisana številka)', praznaA === 54, `${praznaA}/54`);
    const placeHolder = await attr('[id^="cenik-row-"] input', 'placeholder');
    check('6 prazno polje piše »Ni vpisana«, ne »0,00 €«', placeHolder === 'Ni vpisana', placeHolder);
    check('7 na Ceniku ni input[type="number"] (mejo brskalnika bi bilo mogoče tiho usekati)', (await count('input[type="number"]')) === 0);
    check('8 cenovna polja obljubljajo decimalni način (monter tipka vejico)', (await count('[id^="cenik-row-"] input[inputmode="decimal"]')) === 54);
    const brezMeje = await evaluate(`[...document.querySelectorAll('[id^="cenik-row-"] input')]
      .every((i) => ['min', 'max', 'step'].every((k) => i.getAttribute(k) === null))`);
    check('9 nobeno polje nima DOM meje (min/max/step), ki bi obljubljala tiho usekanje', brezMeje === true);
    const t1 = await bodyText();
    check('10 števec pravi 0 / 54 vpisanih', t1.includes('0 / 54 vpisanih'), (t1.match(/\d+ \/ \d+ vpisanih/) ?? ['__none__'])[0]);
    check('11 pas pove, KOLIKO cen manjka',
      (await exists('[data-testid="cenik-missing"]')) && t1.includes('Cena manjka: 54'),
      (t1.match(/Cena manjka[^\n]*/) ?? ['__none__'])[0]);
    check('12 in IMENUJE manjkajoče vrstice poimensko (ne samo števila)',
      t1.includes(CENA_ALU) && t1.includes(CENA_STEBER),
      (t1.match(/Cena manjka[\s\S]{0,300}/) ?? ['__none__'])[0]);
    check('13 in pove, kaj pomeni manjkajoča cena (dokument se ne more shraniti ali natisniti)',
      t1.includes('se ne more shraniti ali natisniti'), (t1.match(/Cena manjka[^\n]*/) ?? ['__none__'])[0]);
    check('14 okno cene je samo spodaj (0 € je veljavno, zgornje meje ni)',
      t1.includes('sprejemamo najmanj 0 €'), (t1.match(/sprejemamo[^\n]*/) ?? ['__none__'])[0]);
    check('15 gumba »Izbriši ceno« ni na nobeni vrstici — nič ni shranjenega za odstraniti',
      (await count('[data-testid^="cenik-clear-"]')) === 0, String(await count('[data-testid^="cenik-clear-"]')));
    const shotEmpty = await screenshot('cenik-01-prazen-zacetek.png');

    // DDV je OBRTNIKOVA nastavitev, ne številka aplikacije. Brez njega
    // urejevalnik ponudbe ZAVRNE shranjevanje (»DDV ni izračunan«), zato ga
    // test vpiše tu — sicer poglavje E ne more dokazati, kar dokazuje.
    check('15a Nastavitve odprte', (await clickText('Nastavitve')) === 'OK' && await waitForText('DDV stopnja'), (await bodyText()).slice(0, 160));
    check('15b DDV 22 % vpisan in shranjen (test ga vpiše kot obrtnik, ga ne predpisuje aplikacija)',
      (await setVal('#settings-vatRate', '22')) === 'OK' && (await clickText('Shrani nastavitve')) === 'OK' &&
      (await val('#settings-vatRate')) === '22', await val('#settings-vatRate'));
    await closeToast();

    // ══ B) KALKULATOR IZDA KOLIČINO, ZAVRNE DENAR ════════════
    check('16 preklop v kalkulatorje', (await clickText('Nova ponudba')) === 'OK' && (await waitForText('Kalkulatorji odmerka')), (await bodyText()).slice(0, 120));
    check('17 kalkulator ograj odprt', (await clickText('Balkonske ograje')) === 'OK' && (await waitForText('Vsota (brez DDV)')), (await bodyText()).slice(0, 160));
    await sleep(600);
    let rows = await calcRows();
    check('18 kalkulator ima štiri vrstice iz registra', rows.length === 4, JSON.stringify(rows.map((r) => r.name)));
    check('19 vse štiri vrstice povejo, da cene ni (»količina × cena ni vpisana«)',
      rows.every((r) => r.detail.includes('cena ni vpisana')) &&
      rows.every((r) => r.name in MOJE_CENE),
      JSON.stringify(rows.map((r) => r.detail)));
    check('20 nobena vrstica nima zneska — denar na zaslonu ne obstaja',
      rows.every((r) => r.amount === '__BREZ__') && (await count(`${ROOT_CALC} [data-testid="line-amount"]`)) === 0,
      JSON.stringify(rows.map((r) => r.amount)));
    check('21 količina je IZRAČUNANA in pokazana (6 m, stebri v kosih)',
      rows.some((r) => r.name === IME_ALU && /^6(\.0+)?\s*m\s*×/.test(r.detail.replace(/\u00a0/g, ' '))) &&
      rows.some((r) => r.name === IME_STEBER && /\s*kos\s*×/.test(r.detail.replace(/\u00a0/g, ' '))),
      JSON.stringify(rows.map((r) => r.detail)));
    // Šteje se SAMO gumbe na vrsticah; `cenik-open-from-calc` ima isti
    // predpon, a je en sam navigacijski gumb pod seštevkom.
    const gumbiVrstic = async (): Promise<number> =>
      (await count(`${ROOT_CALC} [data-testid^="cenik-open-"]`)) -
      (await count(`${ROOT_CALC} [data-testid="cenik-open-from-calc"]`));
    check('22 vsaka vrstica namesto zneska nosi gumb »Vpiši ceno«',
      (await gumbiVrstic()) === 4, String(await gumbiVrstic()));
    const t2 = await bodyText();
    const refB = await textOf(`${ROOT_CALC} [data-testid="calc-price-refusal"]`);
    check('23 seštevek je ZAVRNJEN in imenuje število vrstic brez cene',
      (await exists(`${ROOT_CALC} [data-testid="subtotal-refusal"]`)) &&
      t2.includes('Vsota ni izračunana — 4 vrstice brez vpisane cene'),
      (t2.match(/Vsota ni izračunana[^\n]*/) ?? ['__none__'])[0]);
    check('24 zavrnitev IMENUJE vrstice poimensko (ne samo števila)',
      refB.includes(IME_ALU) && refB.includes(IME_STEBER) && refB.includes(IME_VIJAKI) && refB.includes(IME_MONTAZA),
      refB.replace(/\s+/g, ' ').slice(0, 200));
    check('25 gumb »Dodaj v ponudbo« je ZAPRT (DOM lastnost disabled, ne samo videz)',
      (await isDisabled(`${ROOT_CALC} [data-testid="add-to-offer"]`)) === 'true',
      await isDisabled(`${ROOT_CALC} [data-testid="add-to-offer"]`));
    check('26 opcije za stranko (GBB) se ne prikažejo brez cene', !(await exists(`${ROOT_CALC} [data-testid="gbb-panel"]`)));
    const shotRefusal = await screenshot('cenik-02-kalkulator-zavrne-denar.png');

    // ══ C) OBRTNIK VPIŠE SVOJE ŠTEVILKE ═════════════════════
    check('27 kalkulator ponudi pot v Cenik', (await clickSel(`${ROOT_CALC} [data-testid="cenik-open-from-calc"]`)) === 'OK' && await waitForText(LEAD), (await bodyText()).slice(0, 140));
    const active = await evaluate(`(() => { const i = document.activeElement; return i && i.getAttribute ? String(i.getAttribute('aria-label')) : '__none__'; })()`);
    check('28 Cenik se odpre NA VRSTICI, ki jo kalkulator pogreša', active === CENA_ALU, String(active));
    check('29 187,5 € vpisano z vejico', (await setVal(byLabel(CENA_ALU), '187,5')) === 'OK', await val(byLabel(CENA_ALU)));
    check('30 na zaslonu piše DOBESEDNO 187,5', (await val(byLabel(CENA_ALU))) === '187,5', await val(byLabel(CENA_ALU)));
    check('31 40,25 € v stebre', (await setVal(byLabel(CENA_STEBER), '40,25')) === 'OK');
    check('32 1,2 € v vijačevje', (await setVal(byLabel(CENA_VIJAKI), '1,2')) === 'OK');
    check('33 24 € v montažo', (await setVal(byLabel(CENA_MONTAZA), '24')) === 'OK');
    const t3 = await bodyText();
    check('34 števec zdaj pove 4 / 54', t3.includes('4 / 54 vpisanih'), (t3.match(/\d+ \/ \d+ vpisanih/) ?? ['__none__'])[0]);
    check('35 gumb za izbris je ŠE VEDNO povsod odsoten — na strežniku ni nič',
      (await count('[data-testid^="cenik-clear-"]')) === 0, String(await count('[data-testid^="cenik-clear-"]')));
    await closeToast();
    check('36 shrani cene', (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Cenik shranjen')).includes('Cenik shranjen'), await toastText());
    const toastC = await toastText();
    check('37 potrditev pove, da je cena POSLOVNI PODATEK obrtnika, ne aplikacije',
      toastC.includes('Cena je tvoj poslovni podatek'), toastC.slice(0, 220));
    check('38 potrditev pravi »4 cene vpisane« in NE omenja odstranjenih',
      toastC.includes('4 cene vpisane') && !toastC.includes('odstranjena'), toastC.slice(0, 220));
    const api = await cenikApi();
    check('39 na strežniku je TOČNO 187.5 (vejica je preživela, nič se ni zaokrožilo)', api['ograje.alu'] === 187.5, JSON.stringify(api));
    check('40 in 40.25, 1.2, 24 do besede besedno',
      api['ograje.steber'] === 40.25 && api['ograje.vijaki'] === 1.2 && api['montaza.ograje'] === 24, JSON.stringify(api));
    check('41 v bazi ni NITI ene dodatne cene (4 vpisane, ne 54 ničel)', Object.keys(api).length === 4, JSON.stringify(Object.keys(api)));
    check('42 ŠELE zdaj, ko je cena na strežniku, ima vrstica gumb za izbris',
      (await count('[data-testid^="cenik-clear-"]')) === 4, String(await count('[data-testid^="cenik-clear-"]')));

    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    check('43 preklop v Cenik po osvežitvi', (await clickText('Cenik')) === 'OK' && await waitForText(LEAD));
    check('43b shranjene cene po osvežitvi PRIDEJO na zaslon (asinhrono branje iz strežnika)',
      (await pocakajNapolnjeno(4)) === 4, String(await pocakajNapolnjeno(4)));
    check('44 187,5 je po osvežitvi spet vpisano Z VEJICO (shranjeno, ne izmišljeno)',
      (await val(byLabel(CENA_ALU))) === '187,5', await val(byLabel(CENA_ALU)));
    const praznaB = Number(await evaluate(`[...document.querySelectorAll('[id^="cenik-row-"] input')].filter((i) => i.value === '').length`));
    check('45 preostalih 50 polj je še vedno praznih', praznaB === 50, `${praznaB}/54`);
    check('46 gumbi za izbris so še vedno štirje (pogojeni so s stanjem na strežniku, ne z lokalnim vpisom)',
      (await count('[data-testid^="cenik-clear-"]')) === 4, String(await count('[data-testid^="cenik-clear-"]')));
    const shotTyped = await screenshot('cenik-03-stirje-vpisane.png');

    // ══ D) DENAR SE PRIKAŽE ŠELE, KO GA JE OBRTNIK DAL ═══════
    check('47 nazaj v kalkulatorje', (await clickText('Nova ponudba')) === 'OK' && (await waitForText('Kalkulatorji odmerka')));
    check('48 kalkulator ograj', (await clickText('Balkonske ograje')) === 'OK' && (await waitForText('Vsota (brez DDV)')));
    await sleep(700);
    check('49 obe zavrnitvi sta izginili (vse štiri vrstice imajo ceno)',
      !(await exists(`${ROOT_CALC} [data-testid="calc-price-refusal"]`)) &&
      !(await exists(`${ROOT_CALC} [data-testid="subtotal-refusal"]`)),
      (await bodyText()).slice(0, 200));
    rows = await calcRows();
    check('50 vse štiri vrstice imajo ZNESEK in nobena ne piše več »cene ni«',
      rows.length === 4 && rows.every((r) => r.amount !== '__BREZ__' && !r.detail.includes('cena ni vpisana')),
      JSON.stringify(rows.map((r) => `${r.name}: ${r.amount}`)));
    const vsota = slStevil(await vsotaTeksta());
    check('51 vsota je KONČNA številka, sestavljena iz VPISANIH cen', Number.isFinite(vsota) && vsota > 0, await vsotaTeksta());
    const zneski = rows.map((r) => slStevil(r.amount));
    const vsotaVrstic = zneski.reduce((s, n) => s + n, 0);
    check('52 vsota je DOBESEDNO seštevek zneskov na zaslonu',
      zneski.every((n) => Number.isFinite(n)) && Math.abs(vsota - vsotaVrstic) < 0.02,
      `zaslon ${vsota} · vrstice ${vsotaVrstic}`);
    const racUN = rows.map((r) => {
      const d = r.detail.replace(/\u00a0/g, ' ');
      const m = /^([\d.,]+)\s*(\S+)\s*×\s*([\d.,\s]+€)\s*$/.exec(d);
      const kolicina = m ? slStevil(m[1]) : Number.NaN;
      const cena = m ? slStevil(m[3]) : Number.NaN;
      const znesek = slStevil(r.amount);
      return { name: r.name, kolicina, cena, znesek, unit: m ? m[2] : '__none__', detail: d };
    });
    check('53 cena na vrstici je MOJA cena (187,5 / 40,25 / 1,2 / 24), ne tabela aplikacije',
      racUN.every((r) => r.name in MOJE_CENE && r.cena === MOJE_CENE[r.name]),
      JSON.stringify(racUN.map((r) => `${r.name}→${r.cena}`)));
    check('54 vsak znesek je KOLIČINA × MOJA cena (izračunano iz zaslona)',
      racUN.every((r) => Number.isFinite(r.kolicina) && Math.abs(r.kolicina * r.cena - r.znesek) < 0.02 * Math.max(1, r.znesek)),
      JSON.stringify(racUN.map((r) => `${r.kolicina}${r.unit}×${r.cena}=${r.znesek}`)));
    check('55 količine so ostale takšne kot pred vpisom cene (6 m ograje, stebri v kosih)',
      racUN[0].kolicina === 6 && racUN[1].unit === 'kos' && racUN[1].kolicina === 5,
      JSON.stringify(racUN.map((r) => `${r.name} ${r.kolicina} ${r.unit}`)));
    check('56 gumb za ponudbo je ODPRT', (await isDisabled(`${ROOT_CALC} [data-testid="add-to-offer"]`)) === 'false',
      await isDisabled(`${ROOT_CALC} [data-testid="add-to-offer"]`));
    check('57 opcije za stranko (GBB) so zdaj na voljo', await exists(`${ROOT_CALC} [data-testid="gbb-panel"]`));
    const shotPriced = await screenshot('cenik-04-kalkulator-z-denarjem.png');

    // ══ E) PONUDBA NOSI OBRTNIKOVE CENE ══════════════════════
    const ponudbPred = (await zadnjaPonudba()).st;
    await closeToast();
    check('58 dodano v ponudbo', (await clickText('Dodaj v ponudbo')) === 'OK' && (await waitForToast('Dodano v ponudbo')).includes('Dodano v ponudbo'), await toastText());
    check('59 odprt urejevalnik ponudbe', (await clickText('Odpri ponudbo')) === 'OK' && (await waitForText('Postavke ponudbe')), (await bodyText()).slice(0, 160));
    const ured = await ceneUrejevalnika();
    check('60 urejevalnik pokaže MOJE cene dobesedno z vejico (187,5 / 40,25 / 1,2 / 24)',
      Object.keys(MOJE_BESEDILA).every((n) => ured[n] === MOJE_BESEDILA[n]),
      JSON.stringify(ured));
    check('61 urejevalnik nima vnosov za cene, ki jih obrtnik ni vpisal',
      Object.keys(ured).length === 4, JSON.stringify(Object.keys(ured)));
    check('62 ime stranke vpisano', (await setVal('input[placeholder="Janez Novak"]', 'Test Cenik Ograja')) === 'OK');
    await closeToast();
    const toastSave = await (async () => { await clickText('Shrani ponudbo'); return catchToast(); })();
    check('63 shrani ponudbo', toastSave.includes('shranjena ✓') && (await waitForToast('shranjena ✓')).includes('shranjena ✓'), toastSave.slice(0, 220));
    const zadnja = await zadnjaPonudba();
    check('64 v bazi je NOVA ponudba', zadnja.st === ponudbPred + 1, JSON.stringify({ pred: ponudbPred, zdaj: zadnja.st, stevilka: zadnja.stevilka }));
    check('65 njene cene so DOBESEDNO vpisane (187.5 / 40.25 / 1.2 / 24)',
      Object.keys(MOJE_CENE).every((n) => zadnja.cene[n] === MOJE_CENE[n]),
      JSON.stringify(zadnja.cene));
    check('66 ponudba nosi ISTE količine kot kalkulator (6 m, 5 kos)',
      zadnja.kolicine.length === 4 && zadnja.kolicine[0] === '6 m' && zadnja.kolicine[1] === '5 kos',
      JSON.stringify(zadnja.kolicine));
    const shotOffer = await screenshot('cenik-05-ponudba-z-mojimi-cenami.png');

    // ══ F) ROB: 0 JE CENA, –5 IN »abc« PA NE; PRAZNO NI IZBRIS
    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    await clickText('Cenik');
    await waitForText(LEAD);
    await closeToast();
    check('67 0,00 € vpisano v vijačevje', (await setVal(byLabel(CENA_VIJAKI), '0')) === 'OK');
    check('68 shrani 0', (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Cenik shranjen')).includes('Cenik shranjen'), await toastText());
    check('69 potrditev pravi »1 cena vpisana« (skladna slovenščina, ne »1 cen vpisanih«)',
      (await toastText()).includes('1 cena vpisana'), (await toastText()).slice(0, 220));
    check('70 0 € je na strežniku SHRANJENA cena, ne manjkajoča', (await cenikApi())['ograje.vijaki'] === 0, JSON.stringify(await cenikApi()));
    check('71 polje po shranjevanju kaže »0«, ne praznega mesta', (await val(byLabel(CENA_VIJAKI))) === '0', await val(byLabel(CENA_VIJAKI)));
    await closeToast();
    check('72 –5 vpisano v montažo', (await setVal(byLabel(CENA_MONTAZA), '-5')) === 'OK');
    check('73 strežnik zavrne –5 in v razlogu ponovi VPISANO',
      (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Cene niso shranjene')).includes('Cene niso shranjene'), await toastText());
    const refF = await toastText();
    check('74 zavrnitev imenuje –5 in pove, da negativnega zneska ni',
      refF.includes('-5') && refF.includes('pod ničlo'), refF.slice(0, 240));
    check('75 v bazi je ŠE VEDNO 24 — zavrnjena številka ni bila zapisana', (await cenikApi())['montaza.ograje'] === 24, JSON.stringify(await cenikApi()));
    check('76 polje je ostalo -5 (vpisanega ni popravilo)', (await val(byLabel(CENA_MONTAZA))) === '-5', await val(byLabel(CENA_MONTAZA)));
    const shotNeg = await screenshot('cenik-06-negativna-zavrnitev.png');

    check('77 »abc« vpisano namesto montaže', (await setVal(byLabel(CENA_MONTAZA), 'abc')) === 'OK');
    check('78 polje samo pove, da številka ni, in ponovi »abc«',
      (await noteField(CENA_MONTAZA)).includes('abc') && (await attr(byLabel(CENA_MONTAZA), 'aria-invalid')) === 'true',
      await noteField(CENA_MONTAZA));
    await closeToast();
    check('79 sam poskus shraniti (brez veljavne spremembe) NE pošlje ničesar',
      (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Nič za shraniti')).includes('Nič za shraniti'), await toastText());
    check('80 obvestilo reče, da vnosa ni popravilo in na strežnik ni šlo niča',
      (await toastText()).includes('Vpisanega nismo popravili') && (await toastText()).includes('ničesar'), (await toastText()).slice(0, 240));
    check('81 v bazi je še vedno 24', (await cenikApi())['montaza.ograje'] === 24);

    check('82 montaža IZPRAZNJENA (to ni izbris, ampak neodločitev)', (await setVal(byLabel(CENA_MONTAZA), '')) === 'OK');
    await closeToast();
    check('83 shrani na praznem polju NE pošlje ničesar',
      (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Nič za shraniti')).includes('Nič za shraniti'), await toastText());
    check('84 na strežniku je ŠE VEDNO 24 — izprazniti polje ne more izbrisati cene',
      (await cenikApi())['montaza.ograje'] === 24, JSON.stringify(await cenikApi()));
    check('85 gumb »Izbriši ceno« je na montaži ŠE VEDNO tu (cena živi, čeprav je polje prazno)',
      await exists(clearSel('montaza.ograje')));

    // ══ G) ZAVESTEN IZBRIS SPET ZAPRE DOKUMENT ═══════════════
    await closeToast();
    check('86 monter pritisne »Izbriši ceno« na montaži', (await clickSel(clearSel('montaza.ograje'))) === 'OK', await val(byLabel(CENA_MONTAZA)));
    const opG = await textOf(pendingSel('montaza.ograje'));
    check('87 vrstica pove, da je cena OZNAČENA za izbris, ne da je že izbrisana',
      (await exists(pendingSel('montaza.ograje'))) && opG.includes('Cena je označena za izbris'), opG.replace(/\s+/g, ' ').slice(0, 200));
    check('88 in mu reče, da prazno polje cene NE odstrani (izbris je samo ta gumb)',
      opG.includes('prazno polje je same ne odstrani'), opG.replace(/\s+/g, ' ').slice(0, 200));
    check('89 na drugih vrsticah izbris ni označen (opozorilo je eno samo)',
      (await count('[data-testid="cenik-pending-delete"]')) === 1, String(await count('[data-testid="cenik-pending-delete"]')));
    check('90 gumb za izbris je na tej vrstici nadomestilo opozorilo', !(await exists(clearSel('montaza.ograje'))));
    check('91 polje je na zaslonu PRAZNO (null se prikaže kot prazno, ne kot 0)', (await val(byLabel(CENA_MONTAZA))) === '', await val(byLabel(CENA_MONTAZA)));
    const tG = await bodyText();
    check('92 števec pade na 3 / 54 (izbrisana cena šteje kot manjkajoča)',
      tG.includes('3 / 54 vpisanih'), (tG.match(/\d+ \/ \d+ vpisanih/) ?? ['__none__'])[0]);
    check('93 pas manjkajočih našteje TO ISTO vrstico', tG.includes('Cena manjka: 51') && tG.includes(IME_MONTAZA),
      (tG.match(/Cena manjka[^\n]*/) ?? ['__none__'])[0]);
    await closeToast();
    check('94 shrani izbris', (await clickText('Shrani cene')) === 'OK' && (await waitForToast('Cenik shranjen')).includes('Cenik shranjen'), await toastText());
    const toastG = await toastText();
    check('95 potrditev loči vpisano od odstranjenega: »0 cen vpisanih, 1 cena odstranjena«',
      toastG.includes('0 cen vpisanih') && toastG.includes('1 cena odstranjena'), toastG.slice(0, 240));
    const apiG = await cenikApi();
    check('96 na strežniku montaže VEČ NI (manjkajoča ≠ 0)', !('montaza.ograje' in apiG), JSON.stringify(apiG));
    check('97 ostale tri cene so NESPREMENJENE (izbris je lokalna odločitev)',
      apiG['ograje.alu'] === 187.5 && apiG['ograje.steber'] === 40.25 && apiG['ograje.vijaki'] === 0, JSON.stringify(apiG));
    check('98 gumb za izbris je z te vrstice IZGINIL (cena ni več shranjena)',
      (await count('[data-testid^="cenik-clear-"]')) === 3 && !(await exists(clearSel('montaza.ograje'))),
      String(await count('[data-testid^="cenik-clear-"]')));
    const shotDelete = await screenshot('cenik-07-cena-odstranjena.png');

    await clickText('Nova ponudba');
    await waitForText('Kalkulatorji odmerka');
    await clickText('Balkonske ograje');
    await waitForText('Vsota (brez DDV)');
    await sleep(700);
    const refG = await textOf(`${ROOT_CALC} [data-testid="calc-price-refusal"]`);
    check('99 kalkulator TAKOJ spet zavrne denar', (await exists(`${ROOT_CALC} [data-testid="calc-price-refusal"]`)) && refG !== '__MANJKA__', `${refG.replace(/\s+/g, ' ').slice(0, 160)} || ZASLON: ${(await bodyText()).replace(/\s+/g, ' ').slice(0, 220)}`);
    check('100 in imenuje TOČNO tisto vrstico, ki smo jo izbrisali',
      refG.includes(IME_MONTAZA) && !refG.includes(IME_ALU) && !refG.includes(IME_STEBER),
      refG.replace(/\s+/g, ' ').slice(0, 220));
    check('101 pri ENI sami vrstici se slovenščina glasi »1 vrstica brez cene«',
      refG.includes('1 vrstica brez cene') &&
      (await textOf(`${ROOT_CALC} [data-testid="subtotal-refusal"]`)).includes('1 vrstica brez vpisane cene'),
      `${refG.replace(/\s+/g, ' ').slice(0, 120)} · ${await textOf(`${ROOT_CALC} [data-testid="subtotal-refusal"]`)}`);
    check('102 gumb za ponudbo je spet ZAPRT', (await isDisabled(`${ROOT_CALC} [data-testid="add-to-offer"]`)) === 'true');
    check('103 GBB opcije so spet zaklenjene', !(await exists(`${ROOT_CALC} [data-testid="gbb-panel"]`)));
    rows = await calcRows();
    check('104 količine so še vedno na zaslonu (izbris cene ne uniči odmerek)',
      rows.length === 4 && rows[3].name === IME_MONTAZA && rows[3].amount === '__BREZ__' &&
      /^6(\.0+)?\s*m\s*×/.test(rows[3].detail.replace(/\u00a0/g, ' ')) &&
      rows[0].amount !== '__BREZ__',
      JSON.stringify(rows.map((r) => `${r.name}:${r.detail}:${r.amount}`)));
    const shotClosed = await screenshot('cenik-08-izbris-spet-zapre.png');

    // ══ H) IZBRIS SE NE MORE ZGODITI TIHO ═══════════════════
    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    await clickText('Cenik');
    await waitForText(LEAD);
    await closeToast();
    check('105 alu IZPRAZNJENA in shrani → na strežniku ostane 187,5',
      (await setVal(byLabel(CENA_ALU), '')) === 'OK' && (await clickText('Shrani cene')) === 'OK' &&
      (await waitForToast('Nič za shraniti')).includes('Nič za shraniti') && (await cenikApi())['ograje.alu'] === 187.5,
      JSON.stringify(await cenikApi()));
    check('106 izbrisane cene se NE vrne na zaslon kot 0 (placeholder je »Ni vpisana«)',
      (await val(byLabel(CENA_MONTAZA))) === '' && (await attr(byLabel(CENA_MONTAZA), 'placeholder')) === 'Ni vpisana',
      await val(byLabel(CENA_MONTAZA)));
    check('107 gumb za izbris se po osvežitvi vrne SAMO na treh cenjenih vrsticah',
      (await count('[data-testid^="cenik-clear-"]')) === 3, String(await count('[data-testid^="cenik-clear-"]')));

    // ══ I) dokazi na disku ═══════════════════════════════════
    const shots = [shotEmpty, shotRefusal, shotTyped, shotPriced, shotOffer, shotNeg, shotDelete, shotClosed];
    const sizes = shots.map((p) => { try { return statSync(p).size; } catch { return 0; } });
    check('108 osem posnetkov napisanih na disk (vsak > 20 kB)', sizes.every((n) => n > 20000),
      shots.map((p, i) => `${p.split(/[\\/]/).pop()} ${sizes[i]} B`).join(' · '));
    check('109 v konzoli ni JS izjem', cdp!.exceptions().length === 0, cdp!.exceptions().join(' | ').slice(0, 240));

    console.log(`\n${pass}/${pass + fail} e2e preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
    console.log(`   posnetki: ${shots.join('\n             ')}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('e2e napaka:', e instanceof Error ? e.message : e);
  process.exit(1);
});
