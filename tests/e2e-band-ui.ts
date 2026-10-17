// E2E za dvotapni predlog ravnine (FAZA-9) — čist CDP prek WebSocket (bun),
// brez agent-browserja in brez mreže (samo localhost:3000).
//
// ZAKAJ SINTETIČNA FOTKA IN NE KAR POGANJANJE KORPUSA: resnica mora biti
// KONSTRUIRANA, ne prebrana z očmi. Slika 800×600 ima vodoravna roba točno pri
// y = 300 in y = 450; delovna ločljivost detektorja je 256×192, zato sta
// pravilni tirnici 50 % in 75 % višine, leva/desna stran pa sta točno klika
// monerja (20 % in 80 %). Kar tarče spodaj je izpeljano iz risbe, ne iz meritve.
// (Na PRAVI fotki je bil tok doživet ročno — Task 73; ta skript skrbi, da se
// UI-plast ne more pokvariti neopaženo.)
//
// POKRIVA regresije, ki jih 46 jedrnih skriptov strukturno ne more zadeti, ker
// živijo v UI-ju in ne v jedru:
//   1. VRSTNI RED VRAT — korak 6 mora napovedati nepotrjen predlog, ne
//      manjkajoči centimeter;
//   2. ZNAČKA — nepotrjen predlog sme dobiti SAMO amber `SUGGESTED` iz jedra,
//      nikoli zelene `CALIBRATED` in nikoli besedila »potrjena (4 oglišča)«;
//   3. ZAPRTA VRATA — gumb za izris ne sme obstajati, dokler predlog ni potrjen;
//   4. ISKRENA ZAVRNITEV — klik v prazno nebo nad ograjo ne sme roditi
//      štirikotnika in ne sme izmeriti lažne podpore.
//
// NE POKRIVA (in ne trdi, da pokriva): ponastavitev ob MENJAVI slike. Trenutni
// UI nima ponovnega nalaganja fotke (input živi samo v prazni veji), zato ta pot
// iz brskalnika ni dosegljiva — zaklenjena je vir-gledno v `verify/band-ui-contract.ts`.

import { spawn, type ChildProcess } from 'node:child_process';
import * as __vfyFs from 'node:fs';
import * as __vfyOs from 'node:os';
import * as __vfyPath from 'node:path';

const __vfyOutDir = __vfyPath.join(__vfyOs.tmpdir(), 'obrtnik-pro-e2e');
__vfyFs.mkdirSync(__vfyOutDir, { recursive: true });
const TMP = (name: string): string => __vfyPath.join(__vfyOutDir, name);
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
      webSocketDebuggerUrl: string;
    }[];
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('page target ni najden');
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr: string): Promise<unknown> => {
      // cdp.send že vrne razpakirjen `result` Runtime.evaluate-a.
      const r = (await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })) as unknown as {
        result?: { value?: unknown };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      };
      const exc = r.exceptionDetails;
      if (exc) throw new Error(`Eval napaka: ${exc.exception?.description ?? exc.text}`);
      return r.result?.value;
    };

    const textOf = async (testid: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? (e.textContent || '') : '__MISSING__'; })()`,
        ),
      );

    const exists = async (testid: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector('[data-testid="${testid}"]')`)) === true;

    const clickTestid = async (testid: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const e = document.querySelector('[data-testid="${testid}"]'); if (!e) return 'NOT_FOUND'; e.click(); return 'OK'; })()`,
        ),
      );

    const clickByText = async (text: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'OK'; })()`,
        ),
      );

    const setInput = async (testid: string, value: string): Promise<string> =>
      String(
        await evaluate(
          `(() => {
            const el = document.querySelector('[data-testid="${testid}"]');
            if (!el) return 'NOT_FOUND';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, ${JSON.stringify(value)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return 'OK';
          })()`,
        ),
      );

    // Prvi <polygon> v SVG-ju odra je štirikotnik ravnine (masi se izrišeta
    // šele kasneje); njegov `points` JE quadPct v odstotkih slike.
    const readQuad = async (): Promise<{ points: string; dash: string | null }> => {
      const v = await evaluate(
        `(() => {
          const p = document.querySelector('[data-testid="fr-stage"] svg polygon');
          return p ? { points: p.getAttribute('points') || '', dash: p.getAttribute('stroke-dasharray') } : { points: '', dash: null };
        })()`,
      );
      if (!v) throw new Error('branje kvadrata ni vrnilo objekta (CDP odgovor je prazen)');
      return v as { points: string; dash: string | null };
    };

    const parsePoints = (s: string): { xs: number[]; ys: number[] } => {
      const pairs = s.trim().split(/\s+/).map((pt) => pt.split(',').map(Number));
      return { xs: pairs.map((p) => p[0] ?? NaN), ys: pairs.map((p) => p[1] ?? NaN) };
    };

    // EN klik = ENA CDP okrogla pot. Dva klika v isti JS vrsti bi drugi prebral
    // še neposodobljen `bandTaps`, oba bi pristala na isti točki in iskalni pas
    // bi se skrčil na 4 px — izmerjena izmišljena podpora 100 %/100 % (Task 73).
    // Pravi prsti prispejo v ločenih nalogah, zato mora tudi avtomatizacija
    // pošiljati en dogodek na klic; to ni okras, je pogoj za veljavno meritvo.
    //
    // scrollIntoView je Nujen, ne okras: oder je v koraku 2, daleč pod zavihkom,
    // zunaj vidnega polja. Klik zunaj viewporta se v brskalniku ne zgodi nikoli
    // in pade tiho — to je bila prva stvar, ki jo je zagrizel ta skript (isti
    // pogoj je že zapisan v MEASUREMENT-BASELINE za ročne klikove oglišč).
    const tapStage = async (xPct: number, yPct: number): Promise<void> => {
      await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-stage"]'); e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
      await sleep(250);
      const r = (await evaluate(
        `(() => { const e = document.querySelector('[data-testid="fr-stage"]'); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`,
      )) as { x: number; y: number; w: number; h: number } | undefined;
      if (!r || !Number.isFinite(r.w) || r.w <= 0 || r.h <= 0) throw new Error('oder (fr-stage) nima mer — klik ni mogoč');
      const x = r.x + (r.w * xPct) / 100;
      const y = r.y + (r.h * yPct) / 100;
      const vp = (await evaluate('({ iw: window.innerWidth, ih: window.innerHeight })')) as { iw: number; ih: number };
      if (x < 0 || x > vp.iw || y < 0 || y > vp.ih) {
        throw new Error(`klik (${x.toFixed(0)}, ${y.toFixed(0)}) je zunaj viewporta ${vp.iw}×${vp.ih} — klik bi padel tiho`);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };

    const injectPhoto = async (): Promise<string> => {
      const dataUrl = String(await evaluate(SYNTH));
      if (!dataUrl.startsWith('data:image/png')) throw new Error('sintetična risba ni uspela');
      return String(
        await evaluate(
          `(() => {
            const btn = document.querySelector('[data-testid="fr-upload"]');
            const scope = btn ? btn.parentElement : null;
            const input = (scope && scope.querySelector('input[type=file]')) || document.querySelector('input[type=file]');
            if (!input) return 'NO_INPUT';
            const bin = atob(${JSON.stringify(dataUrl)}.split(',')[1]);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const file = new File([u8], 'sinteticna-ograja.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return 'OK';
          })()`,
        ),
      );
    };

    mkdirSync(join(process.cwd(), 'tests'), { recursive: true });
    // Posnetek je DOKAZ, ne stranski produkt: brez size-preverbe je prazna
    // odgovorna lupina (zgodovinski bug te datoteke) pomenila zelene preizkuse
    // in nič napisanih datotek.
    const shot = async (name: string): Promise<void> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!r.data) throw new Error(`captureScreenshot vrnil ni nobenih bajtov za ${name}`);
      const p = join(process.cwd(), 'tests', name);
      writeFileSync(p, Buffer.from(r.data, 'base64'));
      const sz = statSync(p).size;
      check(`posnetek napisan: ${name}`, sz > 5000, `bajtov ${sz}`);
    };

    // ── 1) aplikacija → kamera → Fotomontaža ──
    // Vidno polje je nastavljeno Z NAMEROM (1280×900): headless privzetnik je
    // 800×600, ali je oder koraka 2 zunaj njega in klik bi padel tiho.
    await cdp.send('Page.navigate', { url: APP });
    await sleep(4000);
    check('navigacija: naslov', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('vstop v kamero', (await clickByText('Pametna kamera')) === 'OK', 'klik');
    await sleep(1400);
    const tabClick = (await clickTestid('tab-fotomontaza')) === 'OK' ? 'OK' : await clickByText('Fotomontaža');
    check('zavihek Fotomontaža', tabClick === 'OK', tabClick);
    await sleep(900);
    check('izbor fotke je na voljo', await exists('fr-upload'), 'fr-upload');
    check('pred nalaganjem ni štirikotnika', (await readQuad()).points === '', 'prazen oder');

    // ── 2) nalaganje sintetične fotke ──
    const inj = await injectPhoto();
    check('vstavljanje sintetične fotke', inj === 'OK', inj);
    await sleep(2800);
    check('oder nastal po nalaganju', await exists('fr-stage'), 'fr-stage');
    check('dimenziji iz fotke (800×600)', (await textOf('fr-dims')).includes('800'), await textOf('fr-dims'));
    check('pred orodjem je stanje 0/4', (await textOf('fr-quad-status')).includes('0/4'), await textOf('fr-quad-status'));

    // ── 3) orodje Pas (2 klika) ──
    check('klik orodja Pas', (await clickTestid('fr-tool-band')) === 'OK', 'klik');
    await sleep(400);
    check('namig se je preimenoval v dvoklik', (await textOf('fr-tool-hint')).includes('LEVO in DESNO'), await textOf('fr-tool-hint'));

    // ── 4) ISKRENA ZAVRNITEV: klika v prazno nebo nad ograjo ──
    await tapStage(LEFT_PCT, 10);
    await sleep(400);
    await tapStage(RIGHT_PCT, 10);
    await sleep(1400);
    const bodyAfterRefusal = String(await evaluate('document.body.textContent'));
    check('zavrnitev: obvestilo brez ugibanja', bodyAfterRefusal.includes('Pasu ograje ni bilo mogoče najti'), 'toast');
    check('zavrnitev: nikakšen štirikotnik', (await readQuad()).points === '', 'brez poligona');
    check('zavrnitev: stanje ravnine ostane 0/4', (await textOf('fr-quad-status')).includes('0/4'), await textOf('fr-quad-status'));
    check('zavrnitev: panel za potrditev se NE pojavi', !(await exists('fr-suggest-confirm')), 'fr-suggest-confirm');
    check('zavrnitev: gumb za izris še vedno ne obstaja', !(await exists('fr-render')), 'fr-render');

    // ── 5) PRAVILNA POT: klika levo/desno na višini sredine trakova ──
    await tapStage(LEFT_PCT, 62.5);
    await sleep(400);
    check('prvi klik še NE rodí predloga', (await readQuad()).points === '', 'brez poligona');
    check('prvi klik spremeni namig v drugi klik', (await textOf('fr-tool-hint')).includes('še DESNO'), await textOf('fr-tool-hint'));
    await tapStage(RIGHT_PCT, 62.5);
    await sleep(1800);

    const quad = await readQuad();
    const { xs, ys } = parsePoints(quad.points);
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL_PCT;
    check('drugi klik rodí štirikotnik (4 oglišča)', xs.length === 4, quad.points);
    check(`zgornja tirnica na konstruirani ${TOP_PCT} %`, ys.length === 4 && near(ys[0], TOP_PCT) && near(ys[1], TOP_PCT), ys.join(','));
    check(`spodnja tirnica na konstruirani ${BOTTOM_PCT} %`, ys.length === 4 && near(ys[2], BOTTOM_PCT) && near(ys[3], BOTTOM_PCT), ys.join(','));
    check(`leva stran = klik monerja (${LEFT_PCT} %)`, xs.length === 4 && near(xs[0], LEFT_PCT) && near(xs[3], LEFT_PCT), xs.join(','));
    check(`desna stran = klik monerja (${RIGHT_PCT} %)`, xs.length === 4 && near(xs[1], RIGHT_PCT) && near(xs[2], RIGHT_PCT), xs.join(','));
    check('nepotrjen predlog je ČRTKAN', quad.dash !== null && quad.dash !== '', quad.dash ?? 'null');
    check('značka pravi ŠE NI potrjen', (await textOf('fr-quad-status')).includes('ŠE NI potrjen'), await textOf('fr-quad-status'));
    const confirmText = await textOf('fr-suggest-confirm');
    const supports = [...confirmText.matchAll(/(\d+)\s*%/g)].map((m) => Number(m[1]));
    check('obema tirnicama je podpora ≥ 95 % (konstruiran rob)', supports.length >= 2 && supports[0] >= 95 && supports[1] >= 95, confirmText.slice(0, 200));

    // ── 6) REGRESIJA 1: vrstni red vrat (brez vnesenega cm) ──
    const blockerNoCm = await textOf('fr-render-blocker');
    check('bloker brez cm napove PREDLOG, ne centimeter', blockerNoCm.includes('samodejni predlog') && !blockerNoCm.includes('Vnesi višino'), blockerNoCm);

    // ── 7) REGRESIJA 2 + 3: z merama in nepotrjeno ravnino sme obstajati SAMO
    //    amber SUGGESTED blok jedra; izris mora ostati brez gumba ──
    check('meri se vneseta (200 × 150)', (await setInput('fr-plane-w', '200')) === 'OK' && (await setInput('fr-plane-h', '150')) === 'OK', 'vnos');
    await sleep(800);
    check('značka ravnine = jedrsni »Predlagana geometrija«', (await textOf('fr-plane-status')).includes('Predlagana geometrija'), await textOf('fr-plane-status'));
    const stepTwoText = String(
      await evaluate(
        `(() => { const e = document.querySelector('[data-testid="fr-plane-status"]'); const c = e ? e.closest('div') : null; return c ? (c.textContent || '') : '__MISSING__'; })()`,
      ),
    );
    check('NI zelene trditve o potrjeni geometriji', stepTwoText !== '__MISSING__' && !stepTwoText.includes('potrjena (4 oglišča)') && !stepTwoText.includes('Kalibrirano'), stepTwoText.slice(0, 220));
    check('amber blok priznava neumerjeno perspektivo', stepTwoText.includes('še NI umerjena'), stepTwoText.slice(0, 220));
    check('bloker po vnosu cm je ŠE VEDJ predlog', (await textOf('fr-render-blocker')).includes('samodejni predlog'), await textOf('fr-render-blocker'));
    check('izris ostane zaprt (gumb fr-render ne obstaja)', !(await exists('fr-render')), 'fr-render');
    // Ime posnetka obljublja AMBER blok — zato se pred kadrom pripelje v viewport,
    // sicer bi slika pokazala oder, beseda pa bi trdila nekaj drugega.
    await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-plane-status"]'); if (e) e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
    await sleep(400);
    await shot('e2e-band-01-predlog-amber.png');

    // ── 8) mobilni 390: dolg amber stavek ne sme povzročiti drsenja ──
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(900);
    const mob = (await evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
    check('mobilni 390: brez vodoravnega drsenja ob predlogu', mob.sw === 390 && mob.iw === 390, mob);
    await shot('e2e-band-02-mobilni390.png');
    await cdp.send('Emulation.clearDeviceMetricsOverride', {});
    await sleep(700);

    // ── 9) POTRDITEV odpre vrata in napravi ravnino potrjeno ──
    check('klik Potrdi predlog', (await clickTestid('fr-confirm-suggestion')) === 'OK', 'klik');
    await sleep(900);
    check('značka po potrditvi: ravnina označena (4/4)', (await textOf('fr-quad-status')).includes('ravnina označena'), await textOf('fr-quad-status'));
    const afterConfirm = await readQuad();
    check('potrjen predlog NI več črtkan', afterConfirm.dash === null || afterConfirm.dash === '', afterConfirm.dash ?? 'null');
    check('panel za potrditev izgine', !(await exists('fr-suggest-confirm')), 'fr-suggest-confirm');
    check('značka ravnine je sedaj Kalibrirano', (await textOf('fr-plane-status')).includes('Kalibrirano'), await textOf('fr-plane-status'));
    const blockerAfter = await textOf('fr-render-blocker');
    check(
      'bloker po potrditvi ne omenja več predloga ne cm (napreduje)',
      blockerAfter !== '__MISSING__' && !blockerAfter.includes('samodejni predlog') && !blockerAfter.includes('Vnesi višino'),
      blockerAfter,
    );

    // ── 10) ZAVRNITEV PREDLOGA (»Označi ročno«) na isti sliki ──
    check('klik orodja Pas drugič', (await clickTestid('fr-tool-band')) === 'OK', 'klik');
    await sleep(400);
    await tapStage(LEFT_PCT, 62.5);
    await sleep(400);
    await tapStage(RIGHT_PCT, 62.5);
    await sleep(1800);
    const reSuggested = await readQuad();
    check('nov predlog je spet črtkan', reSuggested.dash !== null && reSuggested.dash !== '', reSuggested.dash ?? 'null');
    check('klik Označi ročno', (await clickTestid('fr-reject-suggestion')) === 'OK', 'klik');
    await sleep(800);
    check('ročna pot pobriše predlog', (await readQuad()).points === '', 'brez poligona');
    check('ročna pot vrže stanje na 0/4', (await textOf('fr-quad-status')).includes('0/4'), await textOf('fr-quad-status'));
    check('ročna pot ostane pri prvem oglišču', (await textOf('fr-tool-hint')).includes('LEVI'), await textOf('fr-tool-hint'));

    await shot('e2e-band-03-desktop.png');
    const errs = cdp.errors();
    check('konzola: brez JS napak in brez izjem', errs.length === 0, errs.slice(0, 2).join(' | '));

    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E (dvotapni predlog): ${pass} uspešnih, ${fail} neuspešnih`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
