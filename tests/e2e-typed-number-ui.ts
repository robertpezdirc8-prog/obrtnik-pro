// E2E: VPISANA ŠTEVILKA NE SME TIHO POSTATI 0 (Task 87).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko je aritmetika že pokrita z `settings-input-guard`:
// krivica je živela v DOM-u. Številčna polja so bila `type="number"`, slovenska
// tipkovnica pa tipe VEJICO. Brskalnik je za `33,7` vrnil PRAZEN string, koda je
// naredila `Number('') || 0` in je tiho zapisala nič — monter je na zaslonu videl
// svojo vejico, račun pa 0 €. Enotski test tega ne more ujeti, ker ne more
// vprašati, kaj je vrnil brskalnik in KAJ JE MONTER VIDEL.
//
// KAJ POKAŽE V PRAVEM BRSKALNIKU (tri površine, isti pogon):
//  a) NASTAVITVE: `33,7` ostane `33,7`, preživi shrani + osveži in na strežniku
//     je točno 33.7; `150` in `abc` se ZAVRNETA s posnetkom vpisanega besedila,
//     prazno polje pa reče »številka ni vpisana«, ne »0 %«;
//  b) KALKULATOR (NumField): izprazniti polje = izračun se USTAVI z razlogom,
//     ne = izračun po ničli; vejica in pika obe sta sprejeti, na zaslonu pa je
//     vedno vejica, kot jo monter bere;
//  c) ročna CENA NA ENOTO v kalkulatorju in UREJEVALNIK PONUDBE: vrstica ob
//     neveljavnem vpisu pokaže »—« (ne 0,00 €), shranjevanje je zaprto,
//     obvestilo pa imenuje VPISANO, ne nadomestne številke;
//  d) na nobeni od površin ni več `input[type="number"]` — meja, ki jo hrani
//     brskalnik, je videti kot obljuba posega v vnos.
//
// Zagon: bun tests/e2e-typed-number-ui.ts  (zahteva `next dev`; privzeto :3000,
// zamenljivo z `APP_URL=http://localhost:3017/`)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9351;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');
const PROFILE = join(OUT_DIR, 'typed-number-profile');
const ROOT_CALC = '[data-craft="ograje"]';

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

/** Znesek nazaj v število: »1.342,00 €« → 1342. Test mora računati razmerje,
 *  sicer bi bral samo besedilo in ne trditve, ki jo številka nosi. */
function parseEUR(s: string): number {
  return Number(s.replace(/[\s\u00a0]/g, '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try { accessSync(p); return true; } catch { return false; }
  });
  if (!bin) throw new Error(`chromium binary ni najden (poskusi: ${CHROME_CANDIDATES.join(', ')})`);
  console.log(`browser: ${bin}`);
  // Prazen profil = prazen localStorage: sicer bi osnutek iz prejšnjega zagona
  // pomaknil število vrstic, na katere se test zanaša po indeksu.
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
      if (r.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    // `document.body` je lahko null, če `next dev` še prevaja prvo stran — takrat
    // vrni prazen string in počakaj, ne zruši, sicer ves E2E pade na tekmo s
    // prevajanjem.
    const bodyText = async (): Promise<string> =>
      String(await evaluate('document.body ? document.body.innerText : ""'));
    const exists = async (sel: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
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

    // Vnos KOT GA UDERI MONTER: native setter + EN `input` dogodek. Drugi
    // dogodek (change) je pri kontroliranem vnosu Reacta odveč in je že
    // priredil dvakratno vpisano vrednost.
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
    /** Stavek pod poljem v Nastavitvah — živi v istem ovoju kot vnos. */
    const noteSettings = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(byLabel(label))});
        const cell = i && i.parentElement;
        const p = cell && cell.querySelector('[data-testid="settings-field-problem"]');
        return p ? String(p.textContent) : '__MISSING__';
      })()`));
    const numCount = async (scope: string): Promise<number> =>
      Number(await evaluate(`document.querySelectorAll(${JSON.stringify(`${scope} input[type="number"]`)}).length`));
    const vsotaTeksta = async (): Promise<string> => {
      const t = await bodyText();
      const m = /Vsota \(brez DDV\)\s*\n\s*([^\n]*)/.exec(t);
      return m ? m[1] : '__MISSING__';
    };
    const screenshot = async (file: string): Promise<string> => {
      const p = guardOutSideRepo(join(OUT_DIR, file));
      const s = (await cdp!.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!s.data) throw new Error(`captureScreenshot (${file}) vrnil ni bajtov`);
      writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    };

    // ══ A) NASTAVITVE — vpisano besedilo JE resnica ══════════
    await cdp.send('Page.navigate', { url: APP });
    check('1 aplikacija naložena (povezava v nastavitve obstaja)', await waitForText('Domov'), (await bodyText()).slice(0, 120));
    check('2 preklop v Nastavitve', (await clickText('Nastavitve')) === 'OK' && (await waitForText('Nastavitve podjetja')), (await bodyText()).slice(0, 120));

    const AKONTACIJA = 'Akontacija (%)';
    const DDV_POLJE = 'DDV stopnja (%)';
    check('3 na nastavitvah ni več input[type="number"] (tipka vejice ne more več vrniti praznega)',
      (await numCount('')) === 0, String(await numCount('')));
    const decimals = await evaluate(`document.querySelectorAll('input[inputmode="decimal"]').length`);
    check('4 vnosna polja obljubljajo decimalni način tipkanja', Number(decimals) >= 5, String(decimals));
    check('5 polje ima ime, ki ga vidi bralec zaslona', (await attr(byLabel(AKONTACIJA), 'aria-label')) === AKONTACIJA, await attr(byLabel(AKONTACIJA), 'aria-label'));
    check('6 nobeno nastavitveno polje nima DOM meje (min/max/step), ki bi obljubljala tiho usekanje',
      (await evaluate(`(() => {
        const a = ['min', 'max', 'step'];
        return [...document.querySelectorAll('input')].every((i) => a.every((k) => i.getAttribute(k) === null));
      })()`)) === true);
    const zacetna = await val(byLabel(AKONTACIJA));
    check('7 shranjena akontacija je prikazana brez pike (monter tipka vejico)',
      /^[0-9,\s]+$/.test(zacetna), zacetna);

    check('8 33,7 vpisano z vejico', (await setVal(byLabel(AKONTACIJA), '33,7')) === 'OK', await val(byLabel(AKONTACIJA)));
    check('9 na zaslonu DOBESEDNO piše 33,7 (brskalnik ga ni spral, koda ga ni prepisala)',
      (await val(byLabel(AKONTACIJA))) === '33,7', await val(byLabel(AKONTACIJA)));
    check('10 33,7 je v oknu → polje nima aria-invalid', (await attr(byLabel(AKONTACIJA), 'aria-invalid')) === 'null', await attr(byLabel(AKONTACIJA), 'aria-invalid'));
    check('11 namig pod poljem navaja OKNO (0–100 %), ne besede o napaki',
      (await noteSettings(AKONTACIJA)).includes('0–100'), await noteSettings(AKONTACIJA));

    check('12 shrani 33,7', (await clickText('Shrani nastavitve')) === 'OK' && (await waitForText('Nastavitve shranjene')), (await bodyText()).slice(-260));
    let t = await bodyText();
    check('13 potrditev pove, da se številka pozna na NOVIH dokumentih', t.includes('NOVIH dokumentih'), (t.match(/Nastavitve shranjene[\s\S]{0,220}/) ?? ['__none__'])[0]);
    const apiDep = await evaluate(`fetch('/api/settings').then((r) => r.json()).then((d) => d.settings.depositPercent)`);
    check('14 na strežniku je TOČNO 33.7 (ne 33 in ne 33.700000000000003)', apiDep === 33.7, String(apiDep));

    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    check('15 po osvežitvi spet piše 33,7 (vejica je shranjena, ni bila nadomeščena)',
      (await clickText('Nastavitve')) === 'OK' && (await waitForText('Nastavitve podjetja')) &&
      (await val(byLabel(AKONTACIJA))) === '33,7', await val(byLabel(AKONTACIJA)));

    // Zunaj okna: ZAVRNITEV, ki imenuje vpisano — in NE shrani.
    check('16 150 vpisano', (await setVal(byLabel(AKONTACIJA), '150')) === 'OK', await val(byLabel(AKONTACIJA)));
    check('17 polje je označeno kot napačno', (await attr(byLabel(AKONTACIJA), 'aria-invalid')) === 'true', await attr(byLabel(AKONTACIJA), 'aria-invalid'));
    const note150 = await noteSettings(AKONTACIJA);
    check('18 zavrnitev nosi VPISANIH 150 in rob, od koder je vzeta odločitev',
      note150.includes('150') && note150.includes('0–100'), note150);
    check('19 in pojasni, da vnosa ni popravila', note150.includes('nismo popravili'), note150);
    check('20 kapara na 100 % ali 0 % NI bila izmišljena (vpisano ostane 150)', (await val(byLabel(AKONTACIJA))) === '150', await val(byLabel(AKONTACIJA)));
    const shotMax = await screenshot('typed-number-150-zavrnitev.png');

    // Besedilo, ki številka ni — edini zapis, ki ga monter dejansko vidi.
    check('21 abc vpisano', (await setVal(byLabel(AKONTACIJA), 'abc')) === 'OK', await val(byLabel(AKONTACIJA)));
    const noteAbc = await noteSettings(AKONTACIJA);
    check('22 zavrnitev DOBESEDNO ponovi „abc“ (Number(abc) bi izginilo)',
      noteAbc.includes('abc') && noteAbc.includes('številka ni'), noteAbc);
    check('23 in jasno pravi, da te vrednosti ne shranimo', noteAbc.includes('ne shranimo'), noteAbc);
    check('24 polje je še vedno abc — aplikacija ga ni izpraznila ali prepisala z 0',
      (await val(byLabel(AKONTACIJA))) === 'abc', await val(byLabel(AKONTACIJA)));
    const shotAbc = await screenshot('typed-number-abc-zavrnitev.png');

    check('25 poskus shrani z abc: delno, ne tiho', (await clickText('Shrani nastavitve')) === 'OK' && (await waitForText('Delno shranjeno')), (await bodyText()).slice(-300));
    t = await bodyText();
    check('26 obvestilo imenuje polje in pove, da dokumenti uporabijo zadnjo veljavno vrednost',
      t.includes('Akontacija') && t.includes('zadnjo veljavno'), (t.match(/Delno shranjeno[\s\S]{0,300}/) ?? ['__none__'])[0]);
    await cdp.send('Page.navigate', { url: APP });
    await waitForText('Domov');
    check('27 na strežniku je ŠE VEDNO 33.7 — 150 in abc nikoli nista bila poslana',
      (await evaluate(`fetch('/api/settings').then((r) => r.json()).then((d) => d.settings.depositPercent)`)) === 33.7,
      String(await evaluate(`fetch('/api/settings').then((r) => r.json()).then((d) => d.settings.depositPercent)`)));

    // Prazno polje: TIHO NI 0. Tu je bil pravi krivec — `Number('') || 0`.
    await clickText('Nastavitve');
    await waitForText('Nastavitve podjetja');
    check('28 akontacija izpraznjena', (await setVal(byLabel(AKONTACIJA), '')) === 'OK', await val(byLabel(AKONTACIJA)));
    const noteEmpty = await noteSettings(AKONTACIJA);
    check('29 izpraznjeno polje reče »številka ni vpisana«, ne trdi, da je vrednost 0 %',
      noteEmpty.includes('številka ni vpisana') && !noteEmpty.includes('0 % je'), noteEmpty);
    check('30 polje je ostalo prazno (nadomestna vrednost ni bila vtisnjena)', (await val(byLabel(AKONTACIJA))) === '', await val(byLabel(AKONTACIJA)));
    check('31 DDV polje je nedotaknjeno — napaka na enem vnosu ne ugasne ostalih vrst',
      (await val(byLabel(DDV_POLJE))) === '22', await val(byLabel(DDV_POLJE)));
    check('32 akontacija vrnjena na 30 in shranjena (baza ostane v začetnem stanju)',
      (await setVal(byLabel(AKONTACIJA), '30')) === 'OK' && (await clickText('Shrani nastavitve')) === 'OK' && (await waitForText('Nastavitve shranjene')));

    // ══ B) KALKULATOR (NumField) — izprazniti ≠ ničela ══════
    check('33 preklop v kalkulatorje', (await clickText('Nova ponudba')) === 'OK' && (await waitForText('Kalkulatorji odmerka')), (await bodyText()).slice(0, 120));
    check('34 kalkulator ograj odprt', (await clickText('Balkonske ograje')) === 'OK' && (await waitForText('Vsota (brez DDV)')), 'calc');
    await sleep(400);
    const VISINA = 'Višina ograje';
    const DOLZINA = 'Dolžina ograje';
    check('35 v kalkulatorju ni input[type="number"]', (await numCount(ROOT_CALC)) === 0, String(await numCount(ROOT_CALC)));
    check('36 privzeta višina je zapisana Z VEJICO (1,1), kot jo monter bere',
      (await val(byLabel(VISINA))) === '1,1', await val(byLabel(VISINA)));
    const vsota6 = parseEUR(await vsotaTeksta());
    check('37 začetna vsota je številka (6 m alu ≈ 1342), ne besedilo', Number.isFinite(vsota6) && vsota6 > 1000, await vsotaTeksta());

    check('38 višina izpraznjena', (await setVal(byLabel(VISINA), '')) === 'OK', await val(byLabel(VISINA)));
    await sleep(400);
    t = await bodyText();
    check('39 NumField javi zavrnitev pod poljem', await exists(`${ROOT_CALC} [data-testid="numfield-refusal"]`));
    check('40 stavek imenuje polje in pove, da je račun zaustavljen',
      t.includes('Višina ograje: številka ni vpisana') && t.includes('izračun je zaustavljen'),
      (t.match(/Višina ograje[^\n]*ni vpisana[^\n]*/) ?? ['__none__'])[0]);
    check('41 polje je PRAZNO — ni bilo prepisano z 0', (await val(byLabel(VISINA))) === '', await val(byLabel(VISINA)));
    check('42 nobena postavka ni obračunana (stari Number(\x27\x27) || 0 bi računal naprej)',
      t.includes('Izračun ni opravljen') && !t.includes('Predlagane postavke'), t.slice(0, 200));
    check('43 gumb za ponudbo NI dostopen (iz praznega vnosa ni ponudbe)', !t.includes('Dodaj v ponudbo'));
    check('44 norma za trajanje se je ustavila skupaj z računom', !(await exists(`${ROOT_CALC} [data-testid="duration-row"]`)));
    const shotEmpty = await screenshot('typed-number-numfield-prazno.png');

    check('45 višina 1,1 m vrnjena z vejico', (await setVal(byLabel(VISINA), '1,1')) === 'OK', await val(byLabel(VISINA)));
    await sleep(400);
    check('46 vejica je razumljena kot 1,1 in ne kot 1 ali 0',
      (await val(byLabel(VISINA))) === '1,1' && (await bodyText()).includes('Višina 1,1 m'),
      ((await bodyText()).match(/Višina[^\n]*/) ?? ['__none__'])[0]);

    check('47 dolžina 12,5 m vpisana z vejico', (await setVal(byLabel(DOLZINA), '12,5')) === 'OK', await val(byLabel(DOLZINA)));
    await sleep(450);
    t = await bodyText();
    check('48 na zaslonu piše 12,5 (koder ni spral vejice v piko)', (await val(byLabel(DOLZINA))) === '12,5', await val(byLabel(DOLZINA)));
    check('49 mera je DOBESEDNO v opisu postavke, ki gre stranki', t.includes('dolžina 12,5 m'),
      (t.match(/Višina[^\n]*dolžina[^\n]*/) ?? ['__none__'])[0]);
    const vsota125 = parseEUR(await vsotaTeksta());
    check('50 vejica je štela kot 12,5: vrstica nosi 12,5 m in vsota je ~12,5/6 začetne',
      t.includes('12,5 m ×') && Math.abs(vsota125 / vsota6 - 12.5 / 6) < 0.02,
      `${vsota6} → ${vsota125}`);
    check('51 pika JE sprejeta, na tipkovnici vpisana oblika pa ostane nedotaknjena',
      (await setVal(byLabel(DOLZINA), '6.5')) === 'OK' && (await val(byLabel(DOLZINA))) === '6.5',
      await val(byLabel(DOLZINA)));
    await sleep(400);
    t = await bodyText();
    check('52 6,5 m je preračunano (pika ni rodila 6 ali 0)', t.includes('dolžina 6,5 m'),
      (t.match(/Višina[^\n]*dolžina[^\n]*/) ?? ['__none__'])[0]);

    // Ročna CENA NA ENOTO v kalkulatorju — isti pogon, ista poved.
    const CENA_ALU = 'Cena za Aluminijasta ograja';
    const SEL_CENA_ALU = `${ROOT_CALC} ${byLabel(CENA_ALU)}`;
    check('53 ročna cena na enoto je besedilni vnos brez DOM meje',
      (await attr(SEL_CENA_ALU, 'type')) === 'text' && (await attr(SEL_CENA_ALU, 'max')) === 'null',
      `${await attr(SEL_CENA_ALU, 'type')} / ${await attr(SEL_CENA_ALU, 'max')}`);
    check('54 cena 0,75 vpisana z vejico', (await setVal(SEL_CENA_ALU, '0,75')) === 'OK', await val(SEL_CENA_ALU));
    await sleep(400);
    const vsotaCena075 = parseEUR(await vsotaTeksta());
    check('55 ob 0,75 €/m je vsota manjša, a ne ničla (ostale postavke se še vedno računajo)',
      Number.isFinite(vsotaCena075) && vsotaCena075 > 0 && vsotaCena075 < vsota125,
      `${vsota125} → ${vsotaCena075}`);
    check('56 abc v ceno: zavrnitev ponovi vpisano besedilo',
      (await setVal(SEL_CENA_ALU, 'abc')) === 'OK' && (await exists(`${ROOT_CALC} [data-testid="price-refusal"]`)) &&
      (await bodyText()).includes('Cena „abc“ številka ni'),
      ((await bodyText()).match(/Cena[^\n]*številka ni/) ?? ['__none__'])[0]);
    check('57 vpisano ostane abc — nič ni prevzelo prejšnje cene ali ničle', (await val(SEL_CENA_ALU)) === 'abc', await val(SEL_CENA_ALU));
    t = await bodyText();
    check('58 vsota je ZASTAVLJENA (brez cene ni seštevka)',
      t.includes('Vsota ni izračunana') && (await exists(`${ROOT_CALC} [data-testid="subtotal-refusal"]`)),
      (t.match(/Vsota ni izračunana[^\n]*/) ?? ['__none__'])[0]);
    const shotPrice = await screenshot('typed-number-cena-abc.png');
    const ponudbPred = await evaluate(`fetch('/api/offers').then((r) => r.ok ? r.json() : { offers: null }).then((d) => Array.isArray(d.offers) ? d.offers.length : -1)`);
    check('59 dodajanje v ponudbo je zavrnjeno, preden je cena prebrana',
      (await clickText('Dodaj v ponudbo')) === 'OK' && (await waitForText('Cena na enoto ni prebrana')),
      (await bodyText()).slice(-260));
    t = await bodyText();
    check('60 obvestilo imenuje vpisano in reče, da postavk ni dodala',
      t.includes('Cena „abc“ številka ni') && t.includes('postavk nismo dodali'), (t.match(/Cena na enoto ni prebrana[\s\S]{0,300}/) ?? ['__none__'])[0]);
    check('61 cena vrnjena na veljavno 223,67', (await setVal(SEL_CENA_ALU, '223,67')) === 'OK');
    await sleep(400);
    check('62 zavrnitev cene je izginila in se je vsota vrnila',
      !(await bodyText()).includes('Vsota ni izračunana') && !(await exists(`${ROOT_CALC} [data-testid="price-refusal"]`)));
    check('63 dodano v ponudbo', (await clickText('Dodaj v ponudbo')) === 'OK' && (await waitForText('Dodano v ponudbo')), (await bodyText()).slice(-200));
    check('64 odprt urejevalnik ponudbe', (await clickText('Odpri ponudbo')) === 'OK' && (await waitForText('Postavke ponudbe')), (await bodyText()).slice(0, 160));

    // ══ C) UREJEVALNIK — vrstica NE SME pokazati 0,00 € ═════
    const KOLICINA = 'input[aria-label^="Količina — "]';
    const CENA_ENO = 'input[aria-label^="Cena na enoto — "]';
    const IME_STRANKE = 'input[placeholder="Janez Novak"]';
    check('65 v urejevalniku ni input[type="number"]', (await numCount('')) === 0, String(await numCount('')));
    const vrstice = await evaluate(`document.querySelectorAll('[data-testid="item-line-value"]').length`);
    check('66 postavke so na zaslonu (vsaj tri vrstice iz kalkulatorja)', Number(vrstice) >= 3, String(vrstice));
    const vrednost0 = async (): Promise<string> =>
      String(await evaluate(`(() => {
        const v = document.querySelectorAll('[data-testid="item-line-value"]');
        return v[0] ? String(v[0].textContent) : '__MISSING__';
      })()`));
    /** Številka iz besedila polja: »6,5« → 6,5. Test mora racunati, ne brati. */
    const parseNum = (s: string): number =>
      Number(s.replace(/[\s\u00a0]/g, '').replace(/\./g, '').replace(',', '.'));
    // Ime stranke mora biti vpisano, sicer handleSave javi manjkajoče ime in
    // test ne bi več govoril o vpisani številki.
    check('67 ime stranke vpisano (test mora zadeti vrstico, ne manjkajočega imena)',
      (await setVal(IME_STRANKE, 'Test Vpisan Ograja')) === 'OK');
    check('68 privzeta Količina je 6,5 in je zapisana z vejico', (await val(KOLICINA)) === '6,5', await val(KOLICINA));
    const cenaEnote = parseNum(await val(CENA_ENO));
    const v65 = parseEUR(await vrednost0());
    check('69 vrstica je Količina × Cena/en., ne »—« ali ničla',
      Number.isFinite(v65) && Number.isFinite(cenaEnote) && Math.abs(v65 - 6.5 * cenaEnote) < 0.02,
      `6,5 × ${cenaEnote} = ${v65}`);

    check('70 Količina 3,5 vpisana z vejico', (await setVal(KOLICINA, '3,5')) === 'OK', await val(KOLICINA));
    await sleep(350);
    const v35 = parseEUR(await vrednost0());
    check('71 vejica je štela: vrstica = 3,5 × vpisana cena',
      Math.abs(v35 - 3.5 * cenaEnote) < 0.02, `${v65} → ${v35}`);
    check('72 na zaslonu piše 3,5 DOBESEDNO (vtipkana oblika ostane)', (await val(KOLICINA)) === '3,5', await val(KOLICINA));

    check('73 Količina izpraznjena', (await setVal(KOLICINA, '')) === 'OK', await val(KOLICINA));
    await sleep(350);
    t = await bodyText();
    check('74 vrstica pokaže »—«, ne 0,00 € (ničla bi bila cena, ki je monter ni napisal)',
      (await vrednost0()) === '—', await vrednost0());
    check('75 polje javi, da številka ni vpisana',
      (await exists('[data-testid="item-field-problem"]')) && t.includes('Količina: številka ni vpisana'),
      (t.match(/Količina[^\n]*/) ?? ['__none__'])[0]);
    check('76 celotna ponudba je označena kot neshranjena',
      t.includes('Ponudba ni shranjena') && (await exists('[data-testid="item-refusal"]')),
      (t.match(/Ponudba ni shranjena[^\n]*/) ?? ['__none__'])[0]);
    check('77 in pojasni, da vpisanih vrednosti ni popravila', t.includes('Vpisanih vrednosti nismo popravili'),
      (t.match(/Vpisanih vrednosti[^\n]*/) ?? ['__none__'])[0]);
    const shotQty = await screenshot('typed-number-kolicina-prazno.png');

    check('78 poskus shrani: ponudba JE ZAPRTA', (await clickText('Shrani ponudbo')) === 'OK' && (await waitForText('Postavka ni izračunana')), (await bodyText()).slice(-260));
    t = await bodyText();
    check('79 obvestilo pove, da ponudbe ni shranila', t.includes('ponudbe nismo shranili'),
      (t.match(/Postavka ni izračunana[\s\S]{0,300}/) ?? ['__none__'])[0]);
    const ponudbPo = await evaluate(`fetch('/api/offers').then((r) => r.ok ? r.json() : { offers: null }).then((d) => Array.isArray(d.offers) ? d.offers.length : -1)`);
    check('80 v bazi NI NOVE ponudbe z izmišljenimi številkami', Number(ponudbPo) === Number(ponudbPred), `${String(ponudbPred)} → ${String(ponudbPo)}`);

    check('81 Cena/en. „abc“ vpisana', (await setVal(CENA_ENO, 'abc')) === 'OK', await val(CENA_ENO));
    await sleep(350);
    t = await bodyText();
    check('82 zavrnitev imenuje polje in ponovi „abc“', t.includes('Cena/en. (€) „abc“ številka ni'),
      (t.match(/Cena[^\n]*številka ni/) ?? ['__none__'])[0]);
    check('83 vrstica ostane »—«', (await vrednost0()) === '—', await vrednost0());
    const shotItem = await screenshot('typed-number-cena-enote-abc.png');

    check('84 Količina 2 in Cena/en. 13,50 vpisani', (await setVal(KOLICINA, '2')) === 'OK' && (await setVal(CENA_ENO, '13,50')) === 'OK');
    await sleep(400);
    check('85 2 × 13,50 € = 27,00 €: vejica v ceni je šla v račun',
      (await vrednost0()).replace(/\u00a0/g, ' ') === '27,00 €', await vrednost0());
    check('86 na zaslonu piše 13,50 DOBESEDNO (ničla ni prevzela prejšnje vrednosti)',
      (await val(CENA_ENO)) === '13,50', await val(CENA_ENO));
    check('87 zavrnitve ni več in ponudba je spet shranljiva',
      !(await bodyText()).includes('Ponudba ni shranjena') && !(await exists('[data-testid="item-refusal"]')));
    check('88 Cena/en. izpraznjena', (await setVal(CENA_ENO, '')) === 'OK', await val(CENA_ENO));
    await sleep(350);
    check('89 tudi tu vrstica pokaže »—«', (await vrednost0()) === '—', await vrednost0());
    check('90 in stavek loči »ni vpisano« od »nič«',
      (await bodyText()).includes('Cena/en. (€): številka ni vpisana'),
      ((await bodyText()).match(/Cena\/en[^\n]*/) ?? ['__none__'])[0]);
    await setVal(CENA_ENO, '13,50');

    // ══ D) dokazi na disku ══════════════════════════════════
    const shots = [shotMax, shotAbc, shotEmpty, shotPrice, shotQty, shotItem];
    const sizes = shots.map((p) => { try { return statSync(p).size; } catch { return 0; } });
    check('91 šest posnetkov napisanih na disk (vsak > 20 kB)', sizes.every((n) => n > 20000),
      shots.map((p, i) => `${p.split(/[\\/]/).pop()} ${sizes[i]} B`).join(' · '));
    check('92 v konzoli ni JS izjem (pokvarjen vnos se ne zruši, ampak se javi)',
      cdp!.exceptions().length === 0, cdp!.exceptions().join(' | ').slice(0, 240));

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
