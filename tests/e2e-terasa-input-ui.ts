// E2E: kalkulator WPC terase NE SME TIHO POPRAVITI vpisanega razmika (Task 83).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko `terasa-input-guard.ts` pove 84/84: napaka je
// BILA V ZAMOLČANJU med zaslonom in računom. Drsnik je dovolil 8 m, koder pa je
// računal pri 0,6 m. Enotski testi aritmetiko poznajo, ne morejo pa pokazati,
// KAJ JE MONTER VIDEL in kaj je bilo zaračunano — to je UI-vedenje, enako kot
// pri `e2e-span-rule-ui.ts` in `e2e-band-ui.ts`.
//
// KAJPRIKAŽE V PRAVEM BRSKALNIKU:
//  a) privzeta vrednost je 0,33 m (ROKSALov spodnji rob pasu), NE več 0,4 m,
//     ki je samo sprožilo lastno opozorilo »preširoko«;
//  b) 1,2 m je IZRAČUNANO (odmerek se spremeni) in hkrati pošteno označeno
//     kot PREŠIROKO — starejša koda bi številko usekla na 0,6 m;
//  c) pri 8 m NIČ ni zaračunano: kartice s postavkami ni, gumba za dodajanje v
//     ponudbo ni, razlog pa na zaslonu nosi VPISANO vrednost;
//  d) po vrnitvi na 0,33 m je vsota ISTA kot na začetku (determinističen
//     krog — zavračanje ne pusti sledi v računu);
//  e) 12 mm reža in 0 €/m cena ostaneta takšni, kot sta vpisani.
//
// Zagon: bun tests/e2e-terasa-input-ui.ts  (zahteva `next dev`; privzeto :3000,
// zamenljivo z `APP_URL=http://localhost:3005/` — :3000 lahko drži tuji proces)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9347;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');
const PROFILE = join(OUT_DIR, 'terasa-input-profile');

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

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try { accessSync(p); return true; } catch { return false; }
  });
  if (!bin) throw new Error(`chromium binary ni najden (poskusi: ${CHROME_CANDIDATES.join(', ')})`);
  console.log(`browser: ${bin}`);
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
  close(): void;
}

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
    const pages = list.filter((t) => t.type === 'page' && !/^chrome-extension:/.test(t.url ?? ''));
    const page = pages.find((t) => (t.url ?? '').startsWith('http://localhost')) ?? pages[0];
    if (!page) throw new Error('zavihek ni najden na /json/list');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
      if (r.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    // `document.body` je lahko null, če `next dev` še prevaja prvo stran — takrat
    // počakaj (prazen string), ne zrni, sicer ves E2E pade na tekmi z gradio.
    const bodyText = async (): Promise<string> =>
      String(await evaluate('document.body ? document.body.innerText : ""'));
    const exists = async (sel: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
    const waitFor = async (sel: string, ms = 30000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await exists(sel)) return true; await sleep(200); }
      return false;
    };
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
    /** Vnos po imenu, ki ga vidi monter (`aria-label`, dodan zaradi dostopnosti). */
    const setNumber = async (label: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector('[data-craft="wpc-terasa"] input[aria-label=${JSON.stringify(label)}]');
        if (!i) return 'NO_INPUT';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`));
    const getValue = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector('[data-craft="wpc-terasa"] input[aria-label=${JSON.stringify(label)}]');
        return i ? String(i.value) : 'NO_INPUT';
      })()`));
    /** Vrednost kartice povzetka po njeni oznaki. */
    const summaryValue = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const p = [...document.querySelectorAll('[data-craft="wpc-terasa"] p')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)});
        const card = p && p.parentElement;
        const v = card && card.querySelector('p:last-child');
        return v ? String(v.textContent) : '__MISSING__';
      })()`));
    const vsota = async (): Promise<string> => {
      const t = await bodyText();
      const m = /Vsota \(brez DDV\)\s*\n?\s*([0-9][^\n]*)/.exec(t);
      return m ? m[1] : '__MISSING__';
    };

    // ── 1) pot: landing → Nova ponudba → WPC terasa ──
    await cdp.send('Page.navigate', { url: APP });
    check('1a landing naložen (povezava na ponudbo obstaja)', await waitForText('Nova ponudba'), (await bodyText()).slice(0, 120));
    check('1b vstop v kalkulatorje', (await clickText('Nova ponudba')) === 'OK', await clickText('Nova ponudba'));
    check('2 mreža dejavnosti (naslov Kalkulatorji odmerka)', await waitForText('Kalkulatorji odmerka'), (await bodyText()).slice(0, 120));
    check('3 kalkulator WPC terase odprt', (await clickText('WPC terasa')) === 'OK' && (await waitFor('[data-craft="wpc-terasa"]')), 'calc');
    await sleep(500);

    // ── 2) privzeta vrednost = utemeljena vrednost ──
    const spacingDefault = await getValue('Razmak nosilcev');
    check('4 privzeti razmak je 0,33 m (ROKSALov spodnji rob), ne več 0,4 m', spacingDefault === '0.33', spacingDefault);
    const hint = await evaluate(`(() => {
      const lab = [...document.querySelectorAll('[data-craft="wpc-terasa"] label')].find((x) => (x.textContent || '').includes('Razmak nosilcev'));
      const wrap = lab && lab.parentElement;
      const h = wrap && wrap.querySelector('p');
      return h ? String(h.textContent) : '__MISSING__';
    })()`);
    check('5 namig pod poljem navaja ROKSALov pas 33–35 cm', String(hint).includes('33–35') && String(hint).includes('ROKSAL'), String(hint));
    check('6 polje nima več zgornje meje, ki je obljubljala usek (max odstranjen)', (await evaluate(`(() => {
      const i = document.querySelector('[data-craft="wpc-terasa"] input[aria-label="Razmak nosilcev"]');
      return i ? (i.getAttribute('max') === null && i.getAttribute('min') !== '0.3') : false;
    })()`)) === true);
    let t = await bodyText();
    check('7 privzeti izračun je znotraj pasu (ne samookusani »preširoko«)', t.includes('znotraj objavljenega pasu'), (t.match(/Razmak nosilcev[^\n]*/) ?? ['__none__'])[0]);
    const vsotaZacetna = await vsota();
    const nosilciZacetni = await summaryValue('Nosilci');
    check('8 začetna vsota in odmerek nosilcev sta na zaslonu', /[0-9]/.test(vsotaZacetna) && /lm/.test(nosilciZacetni), `${vsotaZacetna} · ${nosilciZacetni}`);

    // ── 9) dostopnost: vsako vnosno polje ima ime ──
    const labelled = await evaluate(`document.querySelectorAll('[data-craft="wpc-terasa"] input[aria-label]').length`);
    check('9 vseh sedem vnosov ima aria-label (brez imena ni testa in ni bralnika zaslona)', Number(labelled) >= 7, String(labelled));

    // ── 10) 1,2 m: IZRAČUNANO in označeno, ne usekano ──
    check('10 razmak 1,2 m vpisan', (await setNumber('Razmak nosilcev', '1.2')) === 'OK', await setNumber('Razmak nosilcev', '1.2'));
    await sleep(400);
    check('11 na zaslonu piše 1,2 (koder ga ni popravil)', (await getValue('Razmak nosilcev')) === '1.2', await getValue('Razmak nosilcev'));
    const nosilci120 = await summaryValue('Nosilci');
    check('12 1,2 m se POZNA pri računu (odmerek padel z začetnega)', nosilci120 !== nosilciZacetni && /lm/.test(nosilci120), `${nosilciZacetni} → ${nosilci120}`);
    // Živi kalkulator začne z privzeto teraso 4 × 3 m (CRAFT_INPUT_DEFAULTS), zato
    // ceil(4/1,2) + 1 = 5 nosilcev × 3 m = 15 lm. Stari Math.min(0.6, …) bi vpisani
    // 1,2 m spremenil v 0,6 m → ceil(4/0,6) + 1 = 8 nosilcev × 3 m = 24 lm, torej
    // 60 % več materiala, kot ga je monter ravnokar plati na zaslonu.
    check('13 1,2 m da točno 15 lm (stari usek na 0,6 m bi pokazal 24 lm)', nosilci120.includes('15 lm') && nosilci120.includes('5 kosov'), nosilci120);
    t = await bodyText();
    check('14 kljub veljavnemu izračunu je 120 cm označen PREŠIROKO (pas odloča o oceni)', /120 cm[^\n]*PREŠIROKO/.test(t), (t.match(/Razmak nosilcev[^\n]*/) ?? ['__none__'])[0]);
    check('15 postavke so še vedno na voljo (1,2 m NI zavrnjen)', (await bodyText()).includes('Dodaj v ponudbo'));
    // Posnetek TOG stanja je tisti, ki ga monter potrebuje: 1,2 m je na zaslonu,
    // 15 lm je v računu, kontrola je rdeča »PREŠIROKO« — in ponudba je kljub temu živa.
    const shot120 = guardOutSideRepo(join(OUT_DIR, 'terasa-input-120-presiroko.png'));
    {
      const s = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!s.data) throw new Error('captureScreenshot (stanje 1,2 m) vrnil ni bajtov');
      writeFileSync(shot120, Buffer.from(s.data, 'base64'));
    }

    // ── 16) 8 m: zunaj okna → ničesar ne zaračuna ──
    check('16 razmak 8 m vpisan', (await setNumber('Razmak nosilcev', '8')) === 'OK', await setNumber('Razmak nosilcev', '8'));
    await sleep(400);
    t = await bodyText();
    check('17 povzetek pravi »Izračun ni opravljen«', t.includes('Izračun ni opravljen'), t.slice(0, 160));
    check('18 razlog na zaslonu nosi VPISANIH 8 m', /Izračun ni opravljen\s*\n\s*Razmak nosilcev 8 m/.test(t), (t.match(/Izračun ni opravljen[\s\S]{0,220}/) ?? ['__none__'])[0]);
    check('19 razlog pojasni, od kod rob (okno vnosa, ne inženirski predpis)',
      /ne zna več pretvoriti v število nosilcev/.test(t), (t.match(/Razmak nosilcev 8 m[^\n]*/) ?? ['__none__'])[0]);
    check('20 kartica s postavkami IZGINILA (iz napačnega vnosa ni ponudbe)', !t.includes('Predlagane postavke'), t.slice(0, 160));
    check('21 gumb »Dodaj v ponudbo« ni dostopen', !t.includes('Dodaj v ponudbo'));
    check('22 na zaslonu še vedno piše 8 (vnosa aplikacija ni popravila)', (await getValue('Razmak nosilcev')) === '8', await getValue('Razmak nosilcev'));
    check('23 načrt montaže javi ISTO zaustavitev', (t.match(/Izračun ni opravljen/g) ?? []).length >= 2, String((t.match(/Izračun ni opravljen/g) ?? []).length));

    // ── 24) mutacija nazaj: determinističen krog ──
    check('24 razmak vrnjen na 0,33 m', (await setNumber('Razmak nosilcev', '0.33')) === 'OK', await setNumber('Razmak nosilcev', '0.33'));
    await sleep(400);
    check('25 vsota je ISTA kot pred izletom iz okna (zavračanje ne pusti sledi)', (await vsota()) === vsotaZacetna, `${vsotaZacetna} → ${await vsota()}`);
    check('26 postavke so se vrnile', (await bodyText()).includes('Dodaj v ponudbo'));
    check('27 povzetek več ne javlja napake', (await bodyText()).includes('Izračun ni opravljen') === false);

    // ── 28) ostala dva nekdanja useka: reža in cena ──
    check('28 stranska reža 12 mm vpisana', (await setNumber('Stranska dilatacija', '12')) === 'OK', await setNumber('Stranska dilatacija', '12'));
    await sleep(350);
    const dilatacija = await summaryValue('Dilatacija');
    check('29 12 mm ostane 12 mm (stari usek bi jo skrčil na 10 mm)', dilatacija.includes('str. 12 mm'), dilatacija);
    check('30 cena 0 €/m vpisana', (await setNumber('Cena deske', '0')) === 'OK', await setNumber('Cena deske', '0'));
    await sleep(350);
    t = await bodyText();
    check('31 deska je prikazana po 0,00 € (stari Math.max(1, …) bi jo dvignil na 1 €)', /0,00\s*€/.test(t), (t.match(/Terasna deska[^\n]*\n[^\n]*/) ?? ['__none__'])[0]);
    check('32 ob 0 €/m je vsota manjša, a ostali material se še vedno računa',
      Number((await vsota()).replace(/\s?€/, '').replace(',', '.')) > 0, await vsota());
    check('33 negativna cena vpisana', (await setNumber('Cena deske', '-3')) === 'OK', await setNumber('Cena deske', '-3'));
    await sleep(350);
    t = await bodyText();
    check('34 negativna cena je zavrnjena in imenovana po imenu s zaslona',
      t.includes('Izračun ni opravljen') && new RegExp('Cena deske [−-]3 €/m je premalo za izračun').test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,200}/) ?? ['__none__'])[0]);

    // ── 34) dokaz na disku ──
    const shotPath = guardOutSideRepo(join(OUT_DIR, 'terasa-input-ui.png'));
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
    if (!shot.data) throw new Error('captureScreenshot vrnil ni bajtov');
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    check('35 oba posnetka napisana na disk (stanje 1,2 m in stanje zavrnitve)',
      statSync(shotPath).size > 20000 && statSync(shot120).size > 20000,
      `zavrnitev ${statSync(shotPath).size} B · 1,2 m ${statSync(shot120).size} B`);
    console.log(`   posnetka: ${shotPath}\n             ${shot120}`);

    console.log(`\n${pass}/${pass + fail} e2e preverb ${fail === 0 ? '— VSE SKOZI' : '— ' + fail + ' NAPAK'}`);
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
