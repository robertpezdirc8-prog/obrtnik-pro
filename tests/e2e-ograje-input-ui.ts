// E2E: kalkulator OGRAJ NE SME TIHO POPRAVITI vpisane višine (Task 84).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko `ograje-input-guard.ts` pove 73/73: napaka je
// bila v ZAMOLČANJU med zaslonom in računom. Cena je računala
// `Math.max(0.9, višina)`, načrt montaže pa je bral vpisano višino neposredno.
// Monter je vpisal 0,5 m, na zaslonu videl 0,5 m, ponudba pa je tekla pri 0,9 m
// — in noben napis na zaslonu tega ni izdal. Enotski testi aritmetiko poznajo,
// ne morejo pa pokazati, KAJ JE MONTER VIDEL. To je UI-vedenje, enako kot pri
// `e2e-terasa-input-ui.ts`, `e2e-span-rule-ui.ts` in `e2e-band-ui.ts`.
//
// KAJPRIKAŽE V PRAVEM BRSKALNIKU:
//  a) polje za višino nima več DOM meje `min={0.9}`, ki je obljubljala poseg v
//     vnos; namesto nje je namig, vzet IZ ISTEGA registra kot resolver;
//  b) 0,5 m je IZRAČUNANO: postavka na zaslonu nosi 0,5 m, ne 0,9 m — stari
//     usek bi monterjevo mero zamenjal s številko aplikacije;
//  c) kljub veljavni meri 0,5 m je kontrola v načrtu označena kot bad in pravi,
//     da zahteve po predpisu aplikacija NE MORE preveriti (vira ni);
//  d) 5 m in 300 prehodov: ničesar ni zaračunano, kartice s postavkami ni,
//     gumba za dodajanje v ponudbo ni, trajanje montaže se je USTAVILO SKUPAJ
//     s ponudbo (tretji bralec istega vnosa), razlog pa nosi VPISANO vrednost;
//  e) po vrnitvi na 1,1 m je vsota ISTA kot na začetku — zavračanje ne pusti
//     sledi v računu;
//  f) man-ure so zapisane z vejico (7,2), kot jih bere monter.
//
// Zagon: bun tests/e2e-ograje-input-ui.ts  (zahteva `next dev`; privzeto :3000,
// zamenljivo z `APP_URL=http://localhost:3005/` — :3000 lahko drži tuji proces)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9347;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');
const PROFILE = join(OUT_DIR, 'ograje-input-profile');
const ROOT = '[data-craft="ograje"]';

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
    // počakaj (prazen string), ne zrni, sicer ves E2E pade na tekmo s prevajanjem.
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
    const selFor = (label: string): string => `${ROOT} input[aria-label="${label}"]`;
    const setNumber = async (label: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(selFor(label))});
        if (!i) return 'NO_INPUT';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`));
    const getAttr = async (label: string, attr: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(selFor(label))});
        return i ? String(i.getAttribute(${JSON.stringify(attr)})) : 'NO_INPUT';
      })()`));
    const getValue = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(selFor(label))});
        return i ? String(i.value) : 'NO_INPUT';
      })()`));
    /** Vrednost kartice povzetka po njeni oznaki. */
    const summaryValue = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const p = [...document.querySelectorAll(${JSON.stringify(`${ROOT} p`)})].find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)});
        const card = p && p.parentElement;
        const v = card && card.querySelector('p:last-child');
        return v ? String(v.textContent) : '__MISSING__';
      })()`));
    const vsota = async (): Promise<string> => {
      const t = await bodyText();
      const m = /Vsota \(brez DDV\)\s*\n?\s*([0-9][^\n]*)/.exec(t);
      return m ? m[1] : '__MISSING__';
    };
    /** Postavka cene po imenu — tu je bil usek neviden, a cena je tekla naprej.
     *  Ime vrstice in njegov podpis sta bratka v istem ovoju. */
    const opisPostavke = async (name: string): Promise<string> =>
      String(await evaluate(`(() => {
        const n = [...document.querySelectorAll(${JSON.stringify(`${ROOT} p`)})].find((x) => (x.textContent || '').trim() === ${JSON.stringify(name)});
        const box = n && n.parentElement;
        const d = box && box.querySelector('p.text-xs');
        return d ? String(d.textContent) : '__MISSING__';
      })()`));
    const screenshot = async (file: string): Promise<string> => {
      const p = guardOutSideRepo(join(OUT_DIR, file));
      const s = (await cdp!.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!s.data) throw new Error(`captureScreenshot (${file}) vrnil ni bajtov`);
      writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    };

    // ── 1) pot: landing → Nova ponudba → Balkonske ograje ──
    await cdp.send('Page.navigate', { url: APP });
    check('1a landing naložen (povezava na ponudbo obstaja)', await waitForText('Nova ponudba'), (await bodyText()).slice(0, 120));
    check('1b vstop v kalkulatorje', (await clickText('Nova ponudba')) === 'OK', await clickText('Nova ponudba'));
    check('2 mreža dejavnosti (naslov Kalkulatorji odmerka)', await waitForText('Kalkulatorji odmerka'), (await bodyText()).slice(0, 120));
    check('3 kalkulator ograj odprt', (await clickText('Balkonske ograje')) === 'OK' && (await waitFor(ROOT)), 'calc');
    await sleep(500);

    // ── 2) polje obljublja samo še okno vnosa, ne posega v meritev ──
    // Nalog 87: polje prikaže številko TAKO kot jo monter bere (vejica), ne
    // interno obliko `String(1.1)`. Če bi tu pisalo piko, bi bil vnos ponovno
    // sestavljen iz number-formata in ne iz vpisanega besedila.
    check('4 privzeta višina je 1,1 m', (await getValue('Višina ograje')) === '1,1', await getValue('Višina ograje'));
    check('5 DOM meje min={0.9}, ki je obljubljala tiho usekanje, ni več',
      (await getAttr('Višina ograje', 'min')) !== '0.9', await getAttr('Višina ograje', 'min'));
    const hint = await evaluate(`(() => {
      const lab = [...document.querySelectorAll(${JSON.stringify(ROOT)} + ' label')].find((x) => (x.textContent || '').includes('Višina ograje'));
      const wrap = lab && lab.parentElement;
      const h = wrap && wrap.querySelector('p');
      return h ? String(h.textContent) : '__MISSING__';
    })()`);
    check('6 namig pod poljem navaja ISTE robove kot resolver (0,2–4 m)',
      String(hint).includes('0,2–4 m') && String(hint).includes('zunaj tega izračun ni opravljen'), String(hint));
    const labelled = await evaluate(`document.querySelectorAll(${JSON.stringify(ROOT)} + ' input[aria-label]').length`);
    check('7 vsak vnos ima aria-label (brez imena ni testa in ni bralnika zaslona)', Number(labelled) >= 3, String(labelled));

    // ── 8) začetno stanje: cena, povzetek, norma ──
    let t = await bodyText();
    check('8 privzeta postavka na zaslonu nosi 1,1 m', await opisPostavke('Aluminijasta ograja') === 'Višina 1,1 m, dolžina 6 m', await opisPostavke('Aluminijasta ograja'));
    check('9 kartica povzetka: Višina 1,1 m', (await summaryValue('Višina')) === '1,1 m', await summaryValue('Višina'));
    const vsotaZacetna = await vsota();
    // `formatEUR` je Intl.NumberFormat — med številko in € nepretržen presledek
    // (U+00A0), ki ga v kodi ne moremo napisati kot navadne besede.
    check('10 začetna vsota je na zaslonu (6 m alu = 1342,00 €)',
      vsotaZacetna.replace(/\u00a0/g, ' ') === '1342,00 €', vsotaZacetna);
    check('11 norma za trajanje je živa in zapisana Z VEJICO (7,2, ne 7.2)',
      t.includes('7,2 man-ur') && !/\d\.\d man-ur/.test(t),
      (t.match(/Trajanje montaže[^\n]*/) ?? ['__none__'])[0]);

    // ── 12) 0,5 m: IZRAČUNANO po vpisani meri, ne usekano na 0,9 m ──
    check('13 višina 0,5 m vpisana', (await setNumber('Višina ograje', '0.5')) === 'OK', await setNumber('Višina ograje', '0.5'));
    await sleep(400);
    check('14 na zaslonu piše 0,5 (koder je ni popravil)', (await getValue('Višina ograje')) === '0.5', await getValue('Višina ograje'));
    check('15 postavka cene nosi VPISANIH 0,5 m (stari Math.max bi pisal 0,9 m)',
      (await opisPostavke('Aluminijasta ograja')) === 'Višina 0,5 m, dolžina 6 m', await opisPostavke('Aluminijasta ograja'));
    check('16 kartica povzetka: 0,5 m', (await summaryValue('Višina')) === '0,5 m', await summaryValue('Višina'));
    t = await bodyText();
    check('17 mera je kljub izračunu označena, ker je pod priporočilom',
      t.includes('0,5 m — pod 0,9 m'), (t.match(/Višina ograje[^\n]*\n[^\n]*/) ?? ['__none__'])[0]);
    check('18 in pošteno reče, da predpisa NE MORE preveriti (vira ni v aplikaciji)',
      t.includes('vira ni v aplikaciji'), (t.match(/pod 0,9 m[^\n]*/) ?? ['__none__'])[0]);
    check('19 nobena izmišljana navedba predpisa ni več na zaslonu', !t.includes('predpis zahteva'), t.slice(0, 200));
    check('20 ponudba je živa (0,5 m NI zavrnjen)', t.includes('Dodaj v ponudbo'));
    // Aluminijasta ograja se obračuna na meter dolžine, zato 0,5 m NE spremeni
    // vsote — spremeni se opis, po katerem monter preverja, kaj je dejansko
    // naročeno. Test zato gleda opis, ne cene.
    check('21 vsota ostane deterministična (1342,00 €)', (await vsota()) === vsotaZacetna, await vsota());
    const shotVisina = await screenshot('ograje-input-050-velicina.png');

    // ── 22) 5 m: zunaj okna → ničesar ni zaračunano ──
    check('22 višina 5 m vpisana', (await setNumber('Višina ograje', '5')) === 'OK', await setNumber('Višina ograje', '5'));
    await sleep(400);
    t = await bodyText();
    check('23 povzetek pravi »Izračun ni opravljen«', t.includes('Izračun ni opravljen'), t.slice(0, 200));
    check('24 razlog nosi VPISANIH 5 m', /Izračun ni opravljen\s*\n\s*Višina ograje 5 m/.test(t), (t.match(/Izračun ni opravljen[\s\S]{0,220}/) ?? ['__none__'])[0]);
    check('25 razlog pojasni, od kod rob (okno vnosa, ne inženirski predpis)',
      /ne more preveriti nosilnosti/.test(t), (t.match(/Višina ograje 5 m[^\n]*/) ?? ['__none__'])[0]);
    check('26 nobena postavka ni obračunana', /nobena postavka ni obračunana/.test(t), (t.match(/Višina ograje 5 m je[^\n]*/) ?? ['__none__'])[0]);
    check('27 kartica s postavkami IZGINILA (iz napačnega vnosa ni ponudbe)', !t.includes('Predlagane postavke'), t.slice(0, 200));
    check('28 gumb »Dodaj v ponudbo« ni dostopen', !t.includes('Dodaj v ponudbo'));
    check('29 norma za trajanje se je USTAVILA SKUPAJ s ponudbo', !(await exists('[data-testid="duration-row"]')), await bodyText().then((x) => (x.match(/Trajanje montaže[^\n]*/) ?? ['__gone__'])[0]));
    check('30 na zaslonu še vedno piše 5 (vnosa aplikacija ni popravila)', (await getValue('Višina ograje')) === '5', await getValue('Višina ograje'));
    check('31 načrt montaže javi ISTO zaustavitev', (t.match(/Izračun ni opravljen/g) ?? []).length >= 2, String((t.match(/Izračun ni opravljen/g) ?? []).length));
    const shotZavrnitev = await screenshot('ograje-input-zavrnitev.png');

    // ── 32) drug rob: prehodi, ki jih cena še kako šteje ──
    check('32 višina vrnjena na 1,1 m', (await setNumber('Višina ograje', '1.1')) === 'OK', await setNumber('Višina ograje', '1.1'));
    await sleep(350);
    check('33 300 prehodov vpisanih', (await setNumber('Št. oključljivih prehodov', '300')) === 'OK', await setNumber('Št. oključljivih prehodov', '300'));
    await sleep(400);
    t = await bodyText();
    check('34 zavrnitev imenuje PREHODE z vpisano številko',
      t.includes('Izračun ni opravljen') && /Št\. oključljivih prehodov 300 kos je preveč za izračun \(300 > 200\)/.test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,240}/) ?? ['__none__'])[0]);
    check('35 norma stoji tudi pri zavrnjenih prehodih', !(await exists('[data-testid="duration-row"]')));

    // ── 36) mutacija nazaj: determinističen krog ──
    check('36 prehodi vrnjeni na 0', (await setNumber('Št. oključljivih prehodov', '0')) === 'OK', await setNumber('Št. oključljivih prehodov', '0'));
    await sleep(400);
    check('37 vsota je ISTA kot pred izletom iz okna (zavračanje ne pusti sledi)', (await vsota()) === vsotaZacetna, `${vsotaZacetna} → ${await vsota()}`);
    check('38 postavke in gumb so se vrnili', (await bodyText()).includes('Dodaj v ponudbo'));
    check('39 norma se je vrnila', await exists('[data-testid="duration-row"]'));
    check('40 povzetek več ne javlja napake', (await bodyText()).includes('Izračun ni opravljen') === false);
    check('41 vrnjen na 1,1 m je opis spet 1,1 m', (await setNumber('Višina ograje', '1.1')) === 'OK' && (await opisPostavke('Aluminijasta ograja')) === 'Višina 1,1 m, dolžina 6 m', await opisPostavke('Aluminijasta ograja'));

    // ── 42) dokaz na disku ──
    check('42 oba posnetka napisana na disk (0,5 m in zavrnitev)',
      statSync(shotVisina).size > 20000 && statSync(shotZavrnitev).size > 20000,
      `0,5 m ${statSync(shotVisina).size} B · zavrnitev ${statSync(shotZavrnitev).size} B`);
    console.log(`   posnetka: ${shotVisina}\n             ${shotZavrnitev}`);

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
