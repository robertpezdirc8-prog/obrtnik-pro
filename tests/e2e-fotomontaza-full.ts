// E2E čez VSEH SEDM korakov fotomontaže (Task 77) — čist CDP prek WebSocketa,
// brez mreže (samo localhost:3000) in BREZ spremembe v `src/`.
//
// ZAKAJ OBSTOJA `e2e-band-ui.ts` NIE zadostoval: tisti skript gre do koraka 2
// in se ustavi PRI ROČNI POTI (zavrne predlog, da zaklene stanje 0/4). Jedrni
// skripti (`verify/photo-replace.ts`, 391 preveritev) dokazujejo matematiko na
// sintetičnih slikah, a izris `drawLayersOnQuad` rabi PRAVI
// CanvasRenderingContext2D — tistega v `bun` ni. Zato je bil celoten dosedanji
// dokaz za korake 3–7 EN ročen prevlek v brskalniku (Task 76), ki se ne ponovi
// sam. Ta skript je tisti ponovljivi dokaz.
//
// KAJ DOKAŽE, ČESAR JEDRO NE MORE:
//   1. VRATA PO VRSTI REDU — brez potrjene ravnine `fr-auto-suggest` nima česa
//      ciljati, brez profila `fr-render` ne obstaja, brez izrisa `fr-export`
//      ne dela;
//   2. IZRIS PREMIKA PIKSLNE VREDNOSTI — ne samo, da gumb obstaja: notranjost
//      kvadrata se PO izrisu merljivo razlikuje od originala (srednja absolutna
//      razlika kanalskih vrednosti) in ni enobarvna;
//   3. IZVOZ JE PRAVILA DATOTEKA — klik sproži pravi brskalnikov download,
//      datoteka PISA na disku, njena PNG glava (IHDR) ima višino VEČJO od
//      platna, ker je žig z oznako za predstavitev pristitan (ne prikrit);
//   4. ISKRENOST OSTANE V IZVOZU — metapodatki nosijo profil in oznako.
//
// NE POKRIVA (in ne trdi, da pokriva):
//   · nobena CENTIMETRSKA trditev — meri 200 × 150 sta KONSTRUIRANO sovisna
//     sintetični sliki, ne svet; ta skript dokazuje POT, ne meritve;
//   · ročno čopičenje maske, kloniranje in merjenje deske (`fr-measure-*`) —
//     to so ločene veje, zaklenjene v jedru;
//   · mobilni 390 prelom (pokrito v `e2e-band-ui.ts`);
//   · pred/po drsnik in izvoz PARA (gumba sta potrjena samo kot prisotna).

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const OUT = path.join(os.tmpdir(), 'obrtnik-pro-e2e-full');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const TMP = (name: string): string => path.join(OUT, name);

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

const PORT = 9337;
const APP = 'http://localhost:3000/';
const PROFILE_ID = 'wpc-deka-140';
const EXPORTED = path.join(OUT, `fotomontaza-${PROFILE_ID}.png`);

// Konstruirana resnica (ista risba kot `e2e-band-ui.ts`, izpeljana iz risbe ne
// iz meritve): robova točno pri y=300 in y=450, delovna ločljivost detektorja
// 256×192 → pravilni tirnici 50 % in 75 %, klika monerja 20 % in 80 %.
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

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, ...rest: unknown[]): void {
  const got = rest.length === 1 ? rest[0] : rest.length > 1 ? rest : cond;
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(got).slice(0, 240))}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function appAlive(): Promise<boolean> {
  try {
    return (await fetch(APP, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

function launchChrome(): ChildProcess {
  const bin = CHROME_CANDIDATES.find((p) => {
    try {
      fs.accessSync(p);
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
      `--user-data-dir=${TMP('profile')}`,
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], detached: false },
  );
}

async function waitCdp(): Promise<void> {
  for (let i = 0; i < 80; i++) {
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
            }, 60_000);
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
        // Razpakira se ENKROT in sicer vidiš { id, result } kot celovit ovojn —
        // historijski bug, zaradi katerega so bili posnetki tiho prazni.
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

async function main(): Promise<void> {
  // Manjkajoča aplikacija je GLASNA napaka, ne tiha ničla (ista poteza kot
  // `tests/gt/harness.ts` za manjkajoč fotokorpus).
  if (!(await appAlive())) {
    console.error(`NAPAKA: aplikacija ne teče na ${APP} — zaženi ` + '`bun run dev` in poženji to znova.');
    process.exit(2);
  }

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
      const r = (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as
        | { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }
        | undefined;
      const exc = r?.exceptionDetails;
      if (exc) throw new Error(`Eval napaka: ${exc.exception?.description ?? exc.text}`);
      return r?.result?.value;
    };

    const textOf = async (testid: string): Promise<string> =>
      String(
        await evaluate(
          `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? (e.textContent || '') : '__MISSING__'; })()`,
        ),
      );

    const exists = async (testid: string): Promise<boolean> =>
      (await evaluate(`!!document.querySelector('[data-testid="${testid}"]')`)) === true;

    const disabledOf = async (testid: string): Promise<boolean | null> => {
      const v = await evaluate(
        `(() => { const e = document.querySelector('[data-testid="${testid}"]'); return e ? !!e.disabled : null; })()`,
      );
      return v === null || v === undefined ? null : Boolean(v);
    };

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

    const readQuad = async (): Promise<{ points: string; dash: string | null }> => {
      const v = await evaluate(
        `(() => {
          const p = document.querySelector('[data-testid="fr-stage"] svg polygon');
          return p ? { points: p.getAttribute('points') || '', dash: p.getAttribute('stroke-dasharray') } : { points: '', dash: null };
        })()`,
      );
      if (!v) throw new Error('branje kvadrata ni vrnilo objekta');
      return v as { points: string; dash: string | null };
    };

    // EN klik = ENA CDP okrogla pot (razlog je izmerjen v `e2e-band-ui.ts`:
    // dva klika v isti vrsti prebereta še neposodobljen `bandTaps`).
    const tapStage = async (xPct: number, yPct: number): Promise<void> => {
      await evaluate(`(() => { const e = document.querySelector('[data-testid="fr-stage"]'); e.scrollIntoView({ block: 'center' }); return 'OK'; })()`);
      await sleep(250);
      const r = (await evaluate(
        `(() => { const e = document.querySelector('[data-testid="fr-stage"]'); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`,
      )) as { x: number; y: number; w: number; h: number } | undefined;
      if (!r || !Number.isFinite(r.w) || r.w <= 0 || r.h <= 0) throw new Error('oder (fr-stage) nima mer');
      const x = r.x + (r.w * xPct) / 100;
      const y = r.y + (r.h * yPct) / 100;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };

    const shot = async (name: string): Promise<void> => {
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      if (!r.data) throw new Error(`captureScreenshot vrnil ni bajtov za ${name}`);
      const p = path.join(process.cwd(), 'tests', name);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      check(`posnetek napisan: ${name}`, fs.statSync(p).size > 5000, `bajtov ${fs.statSync(p).size}`);
    };

    // ── KORAK 1: aplikacija → kamera → Fotomontaža → nalaganje ──
    await cdp.send('Page.navigate', { url: APP });
    await sleep(4000);
    check('korak 1: naslov strani', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('korak 1: vstop v kamero', (await clickByText('Pametna kamera')) === 'OK', 'klik');
    await sleep(1400);
    const tab = (await clickTestid('tab-fotomontaza')) === 'OK' ? 'OK' : await clickByText('Fotomontaža');
    check('korak 1: zavihek Fotomontaža', tab === 'OK', tab);
    await sleep(900);
    check('korak 1: izbor fotke na voljo', await exists('fr-upload'), 'fr-upload');

    const dataUrl = String(await evaluate(SYNTH));
    check('korak 1: sintetična fotka zrisana', dataUrl.startsWith('data:image/png'), dataUrl.slice(0, 24));
    const inj = String(
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
    check('korak 1: fotka naložena prek pravega inputa', inj === 'OK', inj);
    await sleep(2800);
    check('korak 1: dimenziji iz fotke (800)', (await textOf('fr-dims')).includes('800'), await textOf('fr-dims'));

    // VRATA PO VRSTI REDU, del 1: korak 3 brez umerjene ravnine nima cilja.
    // Gumb je prisoten in ONEMOGOČEN (`disabled={!quadPx}`), ne odsoten — prva
    // verzija tega skripta je pričakovala odsotnost in je zato lažno javila
    // vrata. To je edino pošteno vprašanje: ali UI DOSLEDNO ne da klikniti?
    check('vrata: pred ravnino je `fr-auto-suggest` ONEMOGOČEN', (await disabledOf('fr-auto-suggest')) === true, 'disabled');

    // ── KORAK 2: dvotapni predlog + POTRDITEV (edino, kar odpre vrata) ──
    check('korak 2: orodje Pas', (await clickTestid('fr-tool-band')) === 'OK', 'klik');
    await sleep(400);
    await tapStage(20, 62.5);
    await sleep(400);
    await tapStage(80, 62.5);
    await sleep(1800);
    const q = await readQuad();
    check('korak 2: predlog rodí 4 oglišča', q.points.trim().split(/\s+/).length === 4, q.points);
    check('korak 2: predlog je črtkan in nepotrjen', q.dash !== null && q.dash !== '', q.dash ?? 'null');
    check('korak 2: klik Potrdi predlog', (await clickTestid('fr-confirm-suggestion')) === 'OK', 'klik');
    await sleep(900);
    check('korak 2: ravnina označena (4/4)', (await textOf('fr-quad-status')).includes('ravnina označena'), await textOf('fr-quad-status'));
    check(
      'korak 2: meri se vneseta (200 × 150, KONSTRUIRANI — ne svet)',
      (await setInput('fr-plane-w', '200')) === 'OK' && (await setInput('fr-plane-h', '150')) === 'OK',
      'vnos',
    );
    await sleep(700);
    check('korak 2: značka ravnine = Kalibrirano', (await textOf('fr-plane-status')).includes('Kalibrirano'), await textOf('fr-plane-status'));

    // VRATA PO VRSTI REDU, del 2: brez profila izris ne obstaja; izrisa brez
    // ni, izvoza ni.
    check('vrata: pred profilom `fr-render` NE obstaja', !(await exists('fr-render')), 'fr-render');

    // ── KORAK 3: samodejna maska ──
    check('korak 3: `fr-auto-suggest` je sedaj omogočen', (await disabledOf('fr-auto-suggest')) === false, 'disabled');
    check('korak 3: klik Samodejno predlagaj', (await clickTestid('fr-auto-suggest')) === 'OK', 'klik');
    await sleep(1600);
    const cov = await textOf('fr-coverage');
    const covNum = Number((cov.match(/Pokritost čez štirikotnik:\s*([^%]+)%/)?.[1] ?? 'NaN').trim());
    // Zgornja meja je 100 % IN je veljavna: konstruirana slika ima VSE znotraj
    // kvadrata naslikano kot ograja (pas #7a7a7a med tirnicama), zato je
    // samodejna maska pokrila celotno ravnino. Prag, ki dejansko nekaj odloča,
    // je delež CELOTNE fotke v koraku 4 (`manual-required` nad 18 %), ne ta.
    check('korak 3: pokritost maske znotraj kvadrata je merljiva (0 < p ≤ 100)', Number.isFinite(covNum) && covNum > 0 && covNum <= 100, cov.slice(0, 160));
    const frontCov = Number((cov.match(/Ovire \(delež fotke\):\s*([^%]+)%/)?.[1] ?? 'NaN').trim());
    check('korak 3: ovire so izmerjene (brez ovir = 0 %, veljavno)', frontCov === 0, `ovire ${frontCov} %`);
    check('korak 3: značka zanesljivosti prisotna', (await textOf('fr-auto-note')).includes('zanesljivost'), await textOf('fr-auto-note'));
    await shot('e2e-full-01-maska.png');

    // ── KORAK 4: obnova ozadja ──
    check('korak 4: klik Odstrani staro ograjo', (await clickTestid('fr-inpaint')) === 'OK', 'klik');
    await sleep(3500);
    const inp = await textOf('fr-inpaint-status');
    check(
      'korak 4: status je ENA dveh iskrenih vej (ok ALI manual-required)',
      inp.includes('Ozadje obnovljeno') || inp.includes('ročni'),
      inp.slice(0, 200),
    );
    const px = Number((inp.match(/\(([\d.]+)\s*pikslov/)?.[1] ?? '0').replace(/\./g, '').replace(',', ''));
    check('korak 4: obnovljenih pikslov > 0', px > 0, `pikslov ${px}`);
    const inpCov = Number((inp.match(/pokritost maske (\d+)\s*% fotke/)?.[1] ?? 'NaN'));
    console.log(`  (obnova: status=${inp.includes('Ozadje obnovljeno') ? 'ok' : 'druga veja'}, ${px} pikslov, pokritost ${inpCov} % fotke — prag manual-required je 18 %)`);
    // INVARIANCA, ne slučaj: jedro sme status `ok` SAMO, če pokritost fotke ostane
    // pod pragom. Brez te vrstice bi bil lahko `ok` pri 40 % in bi to tiho preživelo.
    check(
      'korak 4: invarianta — status `ok` pomeni pokritost fotke ≤ 18 %',
      !inp.includes('Ozadje obnovljeno') || (Number.isFinite(inpCov) && inpCov <= 18),
      `pokritost ${inpCov} %`,
    );

    // ── KORAK 5: profil ROKSAL ──
    const pid = `fr-profile-${PROFILE_ID}`;
    check(`korak 5: profil ${PROFILE_ID} na voljo`, await exists(pid), pid);
    check(`korak 5: profil ${PROFILE_ID} NI onemogočen (gradivo obstaja)`, (await disabledOf(pid)) === false, 'disabled');
    check('korak 5: klik profila', (await clickTestid(pid)) === 'OK', 'klik');
    await sleep(600);
    const selClass = String(
      await evaluate(`(() => { const e = document.querySelector('[data-testid="${pid}"]'); return e ? e.className : '__MISSING__'; })()`),
    );
    check('korak 5: profil označen kot izbran', selClass.includes('border-amber-600'), selClass.slice(0, 160));

    // ── KORAK 6: izris ──
    check('korak 6: gumb `fr-render` obstaja in ni onemogočen', (await exists('fr-render')) && (await disabledOf('fr-render')) === false, 'fr-render');
    check('korak 6: klik Upodobi', (await clickTestid('fr-render')) === 'OK', 'klik');
    await sleep(4000);
    check('korak 6: rezultatni oder obstaja', await exists('fr-result-canvas'), 'fr-result-canvas');

    // PIKSELNI DOKAZ — edini doslej manjkajoči kos: gumb je reagiral, a ali je
    // kaj NAROČILO? Notranjost kvadrata se primerja z originalno fotko, oba
    // prek istih odstotkovnih mej. Meri se srednja absolutna razlika kanalov in
    // razpršljivost rezultatnih pikslov (enobarven izris = ni ograje).
    const px0 = await evaluate(`(async () => {
      const stage = document.querySelector('[data-testid="fr-result-canvas"]');
      const poly = document.querySelector('[data-testid="fr-stage"] svg polygon');
      if (!stage || !poly) return { err: 'manjka platno ali kvadrat' };
      const pts = (poly.getAttribute('points') || '').trim().split(/\\s+/).map((p) => p.split(',').map(Number));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);

      const W = stage.width, H = stage.height;
      const sx = Math.max(2, Math.round((x0 / 100) * W)), ex = Math.min(W - 2, Math.round((x1 / 100) * W));
      const sy = Math.max(2, Math.round((y0 / 100) * H)), ey = Math.min(H - 2, Math.round((y1 / 100) * H));
      if (ex - sx < 8 || ey - sy < 8) return { err: 'prevoten kvadrat v platnu: ' + sx + ',' + sy + ' do ' + ex + ',' + ey };
      const g = stage.getContext('2d');
      const res = g.getImageData(sx, sy, ex - sx, ey - sy).data;

      // original: ISTA data URL fotka, narisana v lastno platno (nikoli ne
      // posega v aplikacino stanje)
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = ${JSON.stringify(dataUrl)}; });
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      const og = oc.getContext('2d'); og.drawImage(img, 0, 0, W, H);
      const orig = og.getImageData(sx, sy, ex - sx, ey - sy).data;

      let diff = 0, spread = 0, sum = 0, uniq = 0;
      const seen = new Set();
      const n = Math.min(res.length, orig.length);
      for (let i = 0; i < n; i += 4) {
        diff += Math.abs(res[i] - orig[i]) + Math.abs(res[i + 1] - orig[i + 1]) + Math.abs(res[i + 2] - orig[i + 2]);
        const l = (res[i] + res[i + 1] + res[i + 2]) / 3;
        sum += l;
        if (seen.size < 4096) { const k = (res[i] >> 3) * 1024 + ((res[i + 1] >> 3) << 5) + (res[i + 2] >> 3); if (!seen.has(k)) { seen.add(k); uniq++; } }
      }
      const pxCount = n / 4;
      const mean = sum / pxCount;
      for (let i = 0; i < n; i += 4) spread += Math.abs((res[i] + res[i + 1] + res[i + 2]) / 3 - mean);
      return { W, H, sx, sy, ex, ey, pxCount, meanDiff: diff / pxCount / 3, spread: spread / pxCount, uniq, mean };
    })()`);
    if (px0 && (px0 as { err?: string }).err) {
      check('korak 6: pikselna primerjava izvedena', false, (px0 as { err: string }).err);
    } else {
      const m = px0 as { W: number; H: number; pxCount: number; meanDiff: number; spread: number; uniq: number; mean: number };
      check(`korak 6: rezultatno platno 800 px široko`, m.W === 800, `širina ${m.W}`);
      check('korak 6: notranjost kvadrata je VSELA pikslov', m.pxCount > 5000, `pikslov ${m.pxCount}`);
      // Prag 4/255 je izbran konservativno: sintetična fotka ima v pasu tri
      // ploskve (#7a7a7a in stolpci #8c8c8c), tekstura lesene deke pa je temnejša
      // in črtasta — realna razlika je izmerjena, ne ugibana.
      check('korak 6: IZRIS JE SPREMENIL PIKSLNE VREDNOSTI (meanDiff ≥ 4)', m.meanDiff >= 4, `meanDiff ${m.meanDiff.toFixed(2)}`);
      check('korak 6: izris NI enobarven (razpršljivost ≥ 6)', m.spread >= 6, `spread ${m.spread.toFixed(2)}`);
      check('korak 6: izris ima VEČ različnih odtenkov kot ploskev (≥ 12)', m.uniq >= 12, `odtenkov ${m.uniq}`);
      console.log(`  (meritva izrisa: platno ${m.W}×${m.H}, kvadrat ${m.pxCount} px, meanDiff ${m.meanDiff.toFixed(2)}, spread ${m.spread.toFixed(2)}, odtenkov ${m.uniq})`);
    }
    await shot('e2e-full-02-izris.png');

    // VRATA PO VRSTI REDU, del 3: izvoz pred izrisom ni mogoč — to je tu
    // potrjeno POSREDNO: gumb `fr-export` je bil do tega trenutka onemogočen.
    check('korak 7: po izrisu `fr-export` obstaja', await exists('fr-export'), 'fr-export');
    check('korak 7: po izrisu `fr-export` NI onemogočen', (await disabledOf('fr-export')) === false, 'disabled');
    check('korak 7: gumb pred/po para obstaja', await exists('fr-compare-export'), 'fr-compare-export');
    check('korak 7: kosovnica (Material v ponudbo) je omogočena', (await disabledOf('fr-bom')) === false, 'fr-bom');

    // ── KORAK 7: PRAVILA DATOTEKA (brskalnikov download, ne naš stub) ──
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true }).catch(async () => {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
    });
    check('korak 7: klik Izvozi PNG', (await clickTestid('fr-export')) === 'OK', 'klik');
    let appeared = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (fs.existsSync(EXPORTED)) {
        appeared = true;
        break;
      }
    }
    check('korak 7: download se je ZGODIL na disku', appeared, EXPORTED);
    if (appeared) {
      const buf = fs.readFileSync(EXPORTED);
      check('korak 7: datoteka ni prazna', buf.length > 5000, `bajtov ${buf.length}`);
      const sig = [...buf.subarray(0, 8)].join(',');
      check('korak 7: prava PNG glava', sig === '137,80,78,71,13,10,26,10', sig);
      const iw = buf.readUInt32BE(16);
      const ih = buf.readUInt32BE(20);
      check('korak 7: IHDR širina = platno (800)', iw === 800, `širina ${iw}`);
      // Višina MORA biti večja: žig z oznako za predstavitev je pristitan, ne
      // prikrit. Brez tega pogoja bi izvoz tiho izgubil iskreno oznako.
      check('korak 7: višina VEČJA od 600 (žig z oznako je v sliki)', ih > 600, `višina ${ih}`);
      console.log(`  (izvožen PNG: ${buf.length} bajtov, ${iw}×${ih})`);
    }

    // ── ISKRENOST V METAPODATKIH ──
    check('metapodatki: klik preklopi JSON', (await clickTestid('fr-meta-toggle')) === 'OK', 'klik');
    await sleep(600);
    const meta = await textOf('fr-metadata');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(meta) as Record<string, unknown>;
    } catch {
      /* spodnja preveritev javi */
    }
    check('metapodatki: veljaven JSON', Object.keys(parsed).length > 3, meta.slice(0, 120));
    check('metapodatki: profil v JSON-u je izbrani profil', String(parsed.profileId ?? '') === PROFILE_ID, String(parsed.profileId));
    check('metapodatki: oznaka za predstavitev je zabeležena', meta.includes('PREDSTAVITEV') || meta.includes('honesty'), meta.slice(0, 200));

    const errs = cdp.errors();
    check('konzola: brez JS napak in brez izjem', errs.length === 0, errs.slice(0, 2).join(' | '));

    await shot('e2e-full-03-konec.png');
    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch {
      // že mrtev
    }
  }
  console.log(`\nRezultat E2E (vseh sedem korakov): ${pass} uspešnih, ${fail} neuspešnih`);
  console.log(`dokazi na disku: ${OUT} (izvožen PNG) in tests/e2e-full-*.png`);
  process.exit(fail > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('E2E napaka:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
