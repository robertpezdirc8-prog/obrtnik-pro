// E2E: VPISANE mere nobena dejavnost NE SME tiho popraviti (Task 85).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko `craft-inputs-all.ts` pove 474/474: enotski
// testi aritmetiko poznajo, ne morejo pa pokazati, KAJ JE MONTER VIDEL. Pri
// ograjah (Task 84) je bila napaka v zamolčanju med zaslonom in računom — tu
// je bila ista bolezen v petih dejavnostih hkrati: stopnice so računale
// `Math.max(0.6, širina)`, keramika je rezervo usekala na 30 %, fasada je
// `Math.max(0, bruto − odprtine)` naredila nič neto brez razloga. Monter je
// vpisal svojo mero, na zaslonu videl svojo mero, ponudba pa je tekla po naši.
//
// KAJPRIKAŽE V PRAVEM BRSKALNIKU:
//  a) polja nimajo več DOM meje, ki bi obljubljala poseg v vnos (`min={0.6}`),
//     namesto nje je namig z ISTIMI številkami, kot jih preverja resolver;
//  b) 0,45 m širine stopnic je IZRAČUNANO dobesedno — postavka na zaslonu nosi
//     0,45 m in cena se spremeni; stari usek bi pisal 0,6 m;
//  c) 0,3 m je ZAVRNJENO: razlog imenuje VPISANO število, kartica s postavkami
//     izgine, gumb za ponudbo izgine, trajanje montaže se ustavi skupaj s
//     ponudbo, načrt montaže javi ISTO zaustavitev;
//  d) pravilo 2R + G ne laže več o udobju — globine stopnice vnos ne pozna,
//     zato aplikacija našteje samo razpon G, ki ga pravilo zahteva;
//  e) fasada: odprtine, večje od stene, so zavrnjene z izračunano mejo
//     (120 > 100,8), pri plavajoči robi (17 × 2,35 = 39,9499… in 39,95) pa
//     izračun NE javi napake in ne izpiše »neto −0 m²«;
//  f) keramika: vpisana 50 % rezerva ostane 50 % (bilo bi 30 %), 101 % je
//     zavrnjeno;
//  g) vsak krog nazaj na privzeto vrednost da ISTO vsoto — zavračanje ne pusti
//     sledi v računu; man-ure so zapisane z vejico, kot jih bere monter.
//
// Zagon: bun tests/e2e-craft-inputs-ui.ts  (zahteva `next dev`; privzeto :3000,
// zamenljivo z `APP_URL=http://localhost:3005/` — :3000 lahko drži tuji proces)
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju.

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9348;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
const OUT_DIR = join(tmpdir(), 'obrtnik-pro-e2e');
const PROFILE = join(OUT_DIR, 'craft-inputs-profile');

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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp!.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
      if (r.exceptionDetails) throw new Error(`Eval napaka: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    // `document.body` je lahko null, če `next dev` še prevaja prvo stran.
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
    /** Kartica dejavnosti v mreži: gumb, katerega naslov je TOČNO ime dejavnosti. */
    const clickCard = async (name: string): Promise<string> =>
      String(await evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => {
          const h = x.querySelector('h3');
          return h && (h.textContent || '').trim() === ${JSON.stringify(name)};
        });
        if (!b) return 'NOT_FOUND';
        b.scrollIntoView({ block: 'center' });
        b.click();
        return 'OK';
      })()`));

    // ── helpers, vezani na koren ONE dejavnosti ──
    let ROOT = '[data-craft="stopnice"]';
    const setRoot = (craft: string): void => { ROOT = `[data-craft="${craft}"]`; };
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
    const hintFor = async (label: string): Promise<string> =>
      String(await evaluate(`(() => {
        const lab = [...document.querySelectorAll(${JSON.stringify(ROOT)} + ' label')].find((x) => (x.textContent || '').includes(${JSON.stringify(label)}));
        const wrap = lab && lab.parentElement;
        const h = wrap && wrap.querySelector('p');
        return h ? String(h.textContent) : '__MISSING__';
      })()`));
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

    // ── pot: landing → Nova ponudba → mreža dejavnosti ──
    await cdp.send('Page.navigate', { url: APP });
    check('1 landing naložen', await waitForText('Nova ponudba'), (await bodyText()).slice(0, 120));
    check('2 vstop v kalkulatorje', (await clickText('Nova ponudba')) === 'OK', await clickText('Nova ponudba'));
    check('3 mreža dejavnosti odprta', await waitForText('Kalkulatorji odmerka'), (await bodyText()).slice(0, 120));

    // ══ STOPNICE ══════════════════════════════════════════
    check('4 kartica Stopnice odprta', (await clickCard('Stopnice')) === 'OK' && (await waitFor(ROOT)), 'calc');
    await sleep(500);

    check('5 privzeta širina je 1,1 m', (await getValue('Širina stopnic')) === '1,1', await getValue('Širina stopnic'));
    check('6 DOM meje min={0.6}, ki je obljubljala tiho usekanje, ni več',
      (await getAttr('Širina stopnic', 'min')) !== '0.6', await getAttr('Širina stopnic', 'min'));
    check('7 zgornje meje DOM prav tako ne prepušča vnosu (razsodba je samo v resolverju)',
      (await getAttr('Širina stopnic', 'max')) === 'null', await getAttr('Širina stopnic', 'max'));
    const hintSirina = await hintFor('Širina stopnic');
    check('8 namig pod poljem navaja ISTE robove kot resolver (0,4–3 m)',
      hintSirina.includes('0,4–3 m') && hintSirina.includes('zunaj tega izračun ni opravljen'), hintSirina);
    const labelled = await evaluate(`document.querySelectorAll(${JSON.stringify(ROOT)} + ' input[aria-label]').length`);
    check('9 vsako številčno polje ima aria-label (brez imena ni testa in ni bralnika zaslona)',
      Number(labelled) >= 3, String(labelled));

    const vsotaStopnice = await vsota();
    check('10 začetna postavka nosi 1,1 m', (await opisPostavke('Stopnica WPC 25×160 mm')) === 'Širina 1,1 m', await opisPostavke('Stopnica WPC 25×160 mm'));
    check('11 norma za trajanje je živa in z vejico', !/\d\.\d man-ur/.test(await bodyText()),
      ((await bodyText()).match(/Trajanje montaže[^\n]*/) ?? ['__none__'])[0]);

    // ── 0,45 m: dobesedno vpisana mera ──
    check('12 širina 0,45 m vpisana', (await setNumber('Širina stopnic', '0.45')) === 'OK', await setNumber('Širina stopnic', '0.45'));
    await sleep(400);
    check('13 na zaslonu piše 0,45 (koder je ni popravil)', (await getValue('Širina stopnic')) === '0.45', await getValue('Širina stopnic'));
    check('14 postavka cene nosi VPISANIH 0,45 m (stari Math.max bi pisal 0,6 m)',
      (await opisPostavke('Stopnica WPC 25×160 mm')) === 'Širina 0,45 m', await opisPostavke('Stopnica WPC 25×160 mm'));
    check('15 kartica povzetka: 0,45 m', (await summaryValue('Širina stopnic')) === '0,45 m', await summaryValue('Širina stopnic'));
    const vsota045 = await vsota();
    // Meritev res SOČI račun: protidrseči profili so na m² stopnice (12 × 0,45).
    check('16 vsota se je SPREMENILA, ker je mera vpisana (ne samo prikazana)',
      vsota045 !== vsotaStopnice && vsota045 !== '__MISSING__', `${vsotaStopnice} → ${vsota045}`);
    check('17 izračun NI zavrnjen (0,45 m je znotraj okna)', !(await bodyText()).includes('Izračun ni opravljen'));
    const shotSirina = await screenshot('craft-inputs-stopnice-045.png');

    // ── 0,3 m: spodnji rob → zavrnitev, ki imenuje vpisano ──
    check('18 širina 0,3 m vpisana', (await setNumber('Širina stopnic', '0.3')) === 'OK', await setNumber('Širina stopnic', '0.3'));
    await sleep(400);
    let t = await bodyText();
    check('19 povzetek pravi »Izračun ni opravljen«', t.includes('Izračun ni opravljen'), t.slice(0, 200));
    check('20 razlog nosi VPISANIH 0,3 m', /Izračun ni opravljen\s*\n?\s*Širina stopnic 0,3 m/.test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,200}/) ?? ['__none__'])[0]);
    check('21 razlog pojasni rob in okno (0,3 < 0,4, sprejemamo 0,4–3 m)',
      t.includes('premalo za izračun (0,3 < 0,4)') && t.includes('sprejemamo 0,4–3 m'),
      (t.match(/Širina stopnic 0,3 m[^\n]*/) ?? ['__none__'])[0]);
    check('22 razlog reče, da nobena postavka ni obračunana', t.includes('nobena postavka ni obračunana'));
    check('23 kartica s postavkami IZGINILA (iz napačnega vnosa ni ponudbe)', !t.includes('Predlagane postavke'), t.slice(0, 200));
    check('24 gumb »Dodaj v ponudbo« ni dostopen', !t.includes('Dodaj v ponudbo'));
    check('25 norma za trajanje se je USTAVILA SKUPAJ s ponudbo', !(await exists('[data-testid="duration-row"]')),
      (t.match(/Trajanje montaže[^\n]*/) ?? ['__gone__'])[0]);
    check('26 na zaslonu še vedno piše 0,3 (vnosa aplikacija ni popravila)', (await getValue('Širina stopnic')) === '0.3', await getValue('Širina stopnic'));
    check('27 načrt montaže javi ISTO zaustavitev', (t.match(/Izračun ni opravljen/g) ?? []).length >= 2,
      String((t.match(/Izračun ni opravljen/g) ?? []).length));
    const shotZavrnitev = await screenshot('craft-inputs-stopnice-zavrnitev.png');

    // ── krog nazaj: determinističen račun brez sledi ──
    check('28 širina vrnjena na 1,1 m', (await setNumber('Širina stopnic', '1.1')) === 'OK', await setNumber('Širina stopnic', '1.1'));
    await sleep(400);
    check('29 vsota je ISTA kot pred izletom iz okna', (await vsota()) === vsotaStopnice, `${vsotaStopnice} → ${await vsota()}`);
    check('30 postavke, gumb in norma so se vrnili',
      (await bodyText()).includes('Dodaj v ponudbo') && (await exists('[data-testid="duration-row"]')));

    // ── samodejno št. stopnic + pravilo 2R + G brez izmišljene besede ──
    check('31 št. stopnic na 0 (samodejni predlog)', (await setNumber('Št. stopnic', '0')) === 'OK', await setNumber('Št. stopnic', '0'));
    check('32 višinska razlika 260 cm vpisana', (await setNumber('Višinska razlika (od tal do galerije)', '260')) === 'OK',
      await setNumber('Višinska razlika (od tal do galerije)', '260'));
    await sleep(400);
    t = await bodyText();
    const samodejno = await summaryValue('Št. stopnic (samodejno)');
    check('33 samodejni predlog šteje 15 stopnic iz 260 cm (isti izračun kot pri ceni in normi)',
      samodejno.includes('15') && samodejno.includes('260'), samodejno);
    const pravilo = await summaryValue('Pravilo 2R + G');
    check('34 pravilo 2R + G našteje samo razpon G, ki ga ZAHTEVA, ne laže o udobju',
      pravilo.includes('mora biti') && pravilo.includes('kalkulator ne pozna'), pravilo);
    check('35 besedilo »✓ udobje« ni več na zaslonu (ni ga, kaj bi preveril)', !t.includes('udobje'), t.slice(0, 200));
    check('36 kartica pravila ne trdi, da je stopnica izmerjena (brez ✓ na G)', !pravilo.includes('✓'), pravilo);
    const normaStopnice = (t.match(/Trajanje montaže[^\n]*/) ?? ['__none__'])[0];
    check('37 norma za stopnice je živa in zapisana Z VEJICO', /man-ur/.test(normaStopnice) && !/\d\.\d/.test(normaStopnice), normaStopnice);

    // ── zgornji rob: 700 cm razlike ta kalkulator ne predlaga ──
    check('38 višinska razlika 700 cm vpisana', (await setNumber('Višinska razlika (od tal do galerije)', '700')) === 'OK',
      await setNumber('Višinska razlika (od tal do galerije)', '700'));
    await sleep(400);
    t = await bodyText();
    check('39 zavrnitev imenuje RAZLIKO z vpisano številko',
      /Višinska razlika \(od tal do galerije\) 700 cm je preveč za izračun \(700 > 600\)/.test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,240}/) ?? ['__none__'])[0]);
    check('40 norma stoji tudi pri zavrnjeni razliki', !(await exists('[data-testid="duration-row"]')));
    check('41 razlika vrnjena na 0 in stopnice na 12',
      (await setNumber('Višinska razlika (od tal do galerije)', '0')) === 'OK' && (await setNumber('Št. stopnic', '12')) === 'OK');
    await sleep(400);
    check('42 račun je spet IDENTIČEN začetnemu (mutacija nazaj brez sledi)', (await vsota()) === vsotaStopnice, await vsota());

    // ══ FASADE ════════════════════════════════════════════
    check('43 vrnitev na mrežo dejavnosti', (await clickText('Vse dejavnosti')) === 'OK' && (await waitForText('Kalkulatorji odmerka')));
    setRoot('fasada');
    check('44 kartica Fasade odprta', (await clickCard('Fasade')) === 'OK' && (await waitFor(ROOT)), 'calc');
    await sleep(500);
    check('45 privzeti bruto 36 m × 2,8 m = 100,8 m²', (await summaryValue('Bruto površina')) === '100,8 m²', await summaryValue('Bruto površina'));
    check('46 privzeti neto 100,8 − 12 = 88,8 m²', (await summaryValue('Neto površina')) === '88,8 m²', await summaryValue('Neto površina'));
    const vsotaFasada = await vsota();
    check('47 namig pri odprtinah obljublja bruto površino, ne utemeljene številke',
      (await hintFor('Površina odprtin')).includes('bruto površina stene'), await hintFor('Površina odprtin'));

    // ── odprtine večje od stene: povezovalna meja, ki jo SESTAVI izračun ──
    check('48 odprtine 120 m² vpisane', (await setNumber('Površina odprtin (okna, vrata)', '120')) === 'OK',
      await setNumber('Površina odprtin (okna, vrata)', '120'));
    await sleep(400);
    t = await bodyText();
    check('49 zavrnjeno z izračunano mejo (120 > 100,8), ne s približkom',
      t.includes('Izračun ni opravljen') && /Površina odprtin \(okna, vrata\) 120 m² je preveč za izračun \(120 > 100,8\)/.test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,240}/) ?? ['__none__'])[0]);
    check('50 razlog pojasni, zakaj: Odprtine so večje od cele stene (100,8 m²)',
      t.includes('Odprtine so večje od cele stene (100,8 m²), zato se izmere ne izidejo'),
      (t.match(/Površina odprtin \(okna, vrata\) 120 m²[^\n]*/) ?? ['__none__'])[0]);
    check('51 nobena postavka ni obračunana, gumb in norma izginili',
      !t.includes('Predlagane postavke') && !t.includes('Dodaj v ponudbo') && !(await exists('[data-testid="duration-row"]')),
      t.slice(0, 200));
    check('52 vpisanih 120 m² aplikacija ni popravila na največjo veljavno mero',
      (await getValue('Površina odprtin (okna, vrata)')) === '120', await getValue('Površina odprtin (okna, vrata)'));
    check('53 stari `Math.max(0, bruto − odprtine)` ne more več prikazati neto 0 m² namesto razloga',
      !t.includes('Neto površina 0 m²') && t.includes('Izračun ni opravljen'),
      (t.match(/Neto površina[^\n]*\n[^\n]*/) ?? ['__none__'])[0]);
    const shotFasada = await screenshot('craft-inputs-fasada-odprtine.png');

    // ── plavajoča rob: 17 × 2,35 = 39,9499… in odprtine 39,95 ──
    check('54 obseg 17 m vpisan', (await setNumber('Obseg / dolžina stene', '17')) === 'OK', await setNumber('Obseg / dolžina stene', '17'));
    check('55 višina 2,35 m vpisana', (await setNumber('Višina fasade', '2.35')) === 'OK', await setNumber('Višina fasade', '2.35'));
    await sleep(350);
    check('56 odprtine 39,95 m² vpisane (enako bruto, do zadnjega decimale)',
      (await setNumber('Površina odprtin (okna, vrata)', '39.95')) === 'OK', await setNumber('Površina odprtin (okna, vrata)', '39.95'));
    await sleep(400);
    t = await bodyText();
    check('57 rob NI zavrnjen (1e-9 tolerance, sicer bi monter videl napako brez razloga)',
      !t.includes('Izračun ni opravljen'), (t.match(/Izračun ni opravljen[\s\S]{0,200}/) ?? ['__cisto__'])[0]);
    check('58 izmerjena ničla je izpisana kot 0 m², ne kot −0 m²',
      (await summaryValue('Površina fasade')) === '0 m²' && !t.includes('−0 m²'), await summaryValue('Površina fasade'));
    check('59 pri ničli neto ni zaračunane obloge', !(await bodyText()).includes('Dodaj v ponudbo'));
    check('60 odprtine 39,96 m² (tisočinko čez) vpisane',
      (await setNumber('Površina odprtin (okna, vrata)', '39.96')) === 'OK', await setNumber('Površina odprtin (okna, vrata)', '39.96'));
    await sleep(400);
    t = await bodyText();
    check('61 ena tisočinka čez je že zavrnjena, in sicer z izračunano mejo 39,95',
      t.includes('Izračun ni opravljen') && t.includes('preveč za izračun (39,96 > 39,95)'),
      (t.match(/Izračun ni opravljen[\s\S]{0,240}/) ?? ['__none__'])[0]);

    // ── krog nazaj na privzeto ──
    check('62 obseg 36, višina 2,8 in odprtine 12 vrnjene',
      (await setNumber('Obseg / dolžina stene', '36')) === 'OK' && (await setNumber('Višina fasade', '2.8')) === 'OK' &&
      (await setNumber('Površina odprtin (okna, vrata)', '12')) === 'OK');
    await sleep(450);
    check('63 fasadna vsota je ISTA kot pred izleti (zavračanje ne pusti sledi)', (await vsota()) === vsotaFasada,
      `${vsotaFasada} → ${await vsota()}`);

    // ══ KERAMIKA ══════════════════════════════════════════
    check('64 vrnitev na mrežo dejavnosti', (await clickText('Vse dejavnosti')) === 'OK' && (await waitForText('Kalkulatorji odmerka')));
    setRoot('keramika');
    check('65 kartica Keramika odprta', (await clickCard('Keramika')) === 'OK' && (await waitFor(ROOT)), 'calc');
    await sleep(500);
    check('66 privzeta rezerva je 10 %', (await getValue('Rezerva za rezanje')) === '10', await getValue('Rezerva za rezanje'));
    check('67 privzeta postavka: 12 m² tal, rezerva 10 %',
      (await opisPostavke('Keramične ploščice')).includes('Tla 12 m²') && (await opisPostavke('Keramične ploščice')).includes('rezerva 10 %'),
      await opisPostavke('Keramične ploščice'));

    // ── 50 %: stari usek na 30 % bi zaračunal manj, kot je naročeno ──
    check('68 rezerva 50 % vpisana', (await setNumber('Rezerva za rezanje', '50')) === 'OK', await setNumber('Rezerva za rezanje', '50'));
    await sleep(400);
    check('69 postavka nosi VPISANIH 50 % (stari usek bi pisal 30 %)',
      (await opisPostavke('Keramične ploščice')).includes('rezerva 50 %') &&
      !(await opisPostavke('Keramične ploščice')).includes('rezerva 30 %'), await opisPostavke('Keramične ploščice'));
    check('70 kartica »Skupaj z rezervo«: 18 m² (12 m² × 1,5, ne 15,6)',
      (await summaryValue('Skupaj z rezervo')) === '18 m²', await summaryValue('Skupaj z rezervo'));
    check('71 pri vzorcu opozori na priporočljiv odstotek, številke pa NE useka',
      (await summaryValue('Vzorec (ravno)')).includes('odpadek 50 %'), await summaryValue('Vzorec (ravno)'));

    // ── zgornji rob rezerve ──
    check('72 rezerva 101 % vpisana', (await setNumber('Rezerva za rezanje', '101')) === 'OK', await setNumber('Rezerva za rezanje', '101'));
    await sleep(400);
    t = await bodyText();
    check('73 zavrnitev imenuje REZERVO z vpisano vrednostjo',
      t.includes('Izračun ni opravljen') && /Rezerva za rezanje 101 %/.test(t),
      (t.match(/Izračun ni opravljen[\s\S]{0,220}/) ?? ['__none__'])[0]);
    check('74 norma se je ustavila skupaj s ponudbo', !(await exists('[data-testid="duration-row"]')));
    check('75 rezerva vrnjena na 10 %', (await setNumber('Rezerva za rezanje', '10')) === 'OK', await setNumber('Rezerva za rezanje', '10'));
    await sleep(400);
    check('76 zavrnitve ni več, postavke in gumb so se vrnili',
      !(await bodyText()).includes('Izračun ni opravljen') && (await bodyText()).includes('Dodaj v ponudbo'));
    check('77 namig pod poljem nič ne obljublja o ročno usekani meji (ni „največ 30 %“)',
      !(await hintFor('Rezerva za rezanje')).includes('30 %'), await hintFor('Rezerva za rezanje'));
    check('78 račun se je vrnil na 12 m² × 1,1 = 13,2 m² z rezervo',
      (await summaryValue('Skupaj z rezervo')) === '13,2 m²', await summaryValue('Skupaj z rezervo'));

    // ── dokaz na disku ──
    check('79 trije posnetki napisani na disk (0,45 m, zavrnitev, fasada)',
      statSync(shotSirina).size > 20000 && statSync(shotZavrnitev).size > 20000 && statSync(shotFasada).size > 20000,
      `0,45 m ${statSync(shotSirina).size} B · zavrnitev ${statSync(shotZavrnitev).size} B · fasada ${statSync(shotFasada).size} B`);
    console.log(`   posnetki: ${shotSirina}\n             ${shotZavrnitev}\n             ${shotFasada}`);

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
