// E2E za e-račun (Task 49: e-SLOG / EN 16931 UBL XML) — čist CDP prek
// WebSocket (bun), vzorec iz Task 47/48 (e2e-diary-cdp.ts).
// Pot: nastavitve (prodajalec) → ponudba 2 postavki → sprejeta → račun
// (snapshot postavk) → API XML z ročno resnico → UI gumb resnično prenese
// XML (zajem prek URL.createObjectURL) → iskrna vrata 409 (brez davčne
// številke) → mobilni 390 → konzola čista → čiščenje.
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
import { accessSync, rmSync } from 'node:fs';

// Pot do chromiuma: okoljska spremenljivka, nato Windows/macOS/Linux poti, na
// koncu kontejnerski playwright cache. Seznam je bil samo kontejnerski, zato ta
// skript na domačem računalniku nikoli ni mogel zagnati brskalnika.
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
const PORT = Number(process.env.CDP_PORT ?? 9335);
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
    console.log(`✗ ${name} — dobil: ${JSON.stringify(String(got).slice(0, 200))}`);
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
  rmSync(TMP('eslog-e2e'), { recursive: true, force: true });
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--user-data-dir=${TMP('eslog-e2e')}`,
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

interface SettingsSnapshot {
  companyName: string;
  address: string;
  taxNumber: string;
  iban: string;
}

async function main(): Promise<void> {
  // API JE aplikacija: `/api/...` je bil hardcoded na :3000, zato je skript na
  // drugem razvojnem portu takoj padel, čeprav je brskalnik deloval.
  const API = (process.env.APP_URL ?? 'http://localhost:3000/').replace(/\/+$/, '');

  // ── 0) Resnica nastavitev (za obnovo ob koncu) ──
  const settingsRes = (await (await fetch(`${API}/api/settings`)).json()) as {
    settings: SettingsSnapshot;
  };
  const oldSettings = settingsRes.settings;
  const PRODAJALEC: SettingsSnapshot = {
    companyName: 'Obrt Test s.p.',
    address: 'Ulica 14, 1000 Ljubljana',
    taxNumber: '12345678',
    iban: 'SI56 0510 0801 0555 555',
  };
  await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PRODAJALEC),
  });

  // ── 1) Ponudba z 2 postavkami (ročna resnica: 12 m × 145 = 1740; 3 kos × 38 = 114; osnova 1854; DDV 407,88; skupaj 2261,88) ──
  const offerRes = (await (
    await fetch(`${API}/api/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Stranka e-računa d.o.o.',
        customerAddress: 'Cesta 1, 2000 Maribor',
        vatRate: 22,
        // Strežnik ne izmišlja 22 % (Task 86): klient pošlje stopnjo, ki jo je
        // monter dejansko videl na zaslonu.
        items: [
          { name: 'Aluminijasta ograja', description: 'Eloksirana', quantity: 12, unit: 'm', unitPrice: 145 },
          { name: 'Steber aluminij 40×40', quantity: 3, unit: 'kos', unitPrice: 38 },
        ],
      }),
    })
  ).json()) as { offer: { id: string; number: string } };
  const offerId = offerRes.offer.id;
  check('ponudba ustvarjena', !!offerId, offerRes);
  await fetch(`${API}/api/offers/${offerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });

  // ── 2) Račun iz ponudbe (snapshot postavk) ──
  const invRes = (await (
    await fetch(`${API}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId }),
    })
  ).json()) as { invoice: { id: string; number: string; itemCount: number } };
  const inv = invRes.invoice;
  check('račun izdan', !!inv?.id, invRes);
  check('snapshot: itemCount = 2', inv.itemCount === 2, inv.itemCount);

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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const evaluate = async (expr: string): Promise<unknown> => {
      const r = (await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })) as unknown as {
        result?: { result?: { value?: unknown } };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      };
      const exc = r.exceptionDetails;
      if (exc) throw new Error(`Eval napaka: ${exc.exception?.description ?? exc.text}`);
      return r.result?.result?.value;
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

    // ── 3) API: XML z ročno resnico ──
    const xmlRes = await fetch(`${API}/api/invoices/${inv.id}/eslog`);
    check('eslog API 200', xmlRes.status === 200, xmlRes.status);
    const disposition = xmlRes.headers.get('content-disposition') ?? '';
    check('Content-Disposition attachment', disposition.includes('attachment') && disposition.includes(`${inv.number}-eslog.xml`), disposition);
    const xml = await xmlRes.text();
    check('XML deklaracija', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), xml.slice(0, 60));
    check('UBL ns', xml.includes('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));
    check('EN 16931 CustomizationID', xml.includes('urn:cen.eu:en16931:2017'));
    check('št. računa v ID', xml.includes(`<cbc:ID>${inv.number}</cbc:ID>`));
    check('TypeCode 380', xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>'));
    check('EUR', xml.includes('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>'));
    check('izdajatelj', xml.includes('<cbc:Name>Obrt Test s.p.</cbc:Name>'));
    check('davčna SI12345678', xml.includes('<cbc:CompanyID>SI12345678</cbc:CompanyID>'));
    check('IBAN v plačilu', xml.includes('SI56 0510 0801 0555 555'));
    check('kupec', xml.includes('<cbc:Name>Stranka e-računa d.o.o.</cbc:Name>'));
    check('kupec kraj Maribor', xml.includes('<cbc:CityName>Maribor</cbc:CityName>'));
    // ročna resnica zneskov
    check('vrstica 1 MTR 12', xml.includes('<cbc:InvoicedQuantity unitCode="MTR">12</cbc:InvoicedQuantity>'));
    check('vrstica 2 C62 3', xml.includes('<cbc:InvoicedQuantity unitCode="C62">3</cbc:InvoicedQuantity>'));
    check('vrstica 1: 1740.00', xml.includes('currencyID="EUR">1740.00</cbc:LineExtensionAmount>'));
    check('vrstica 2: 114.00', xml.includes('currencyID="EUR">114.00</cbc:LineExtensionAmount>'));
    check('osnova 1854.00', xml.includes('currencyID="EUR">1854.00</cbc:TaxableAmount>'));
    check('DDV 407.88', xml.includes('currencyID="EUR">407.88</cbc:TaxAmount>'));
    check('skupaj 2261.88', xml.includes('currencyID="EUR">2261.88</cbc:PayableAmount>'));
    check('2 vrstici', (xml.match(/<cac:InvoiceLine>/g) ?? []).length === 2);
    check('brez opozorilnih komentarjev', !xml.includes('<!-- OPOZORILO'));

    // ── 4) UI: gumb resnično prenese XML (zajem createObjectURL) ──
    await cdp.send('Page.navigate', { url: APP });
    await sleep(3500);
    check('navigacija: naslov', String(await evaluate('document.title')).includes('Obrtnik'), await evaluate('document.title'));
    check('Ponudbe klik', String(await evaluate(clickByText('button', 'Ponudbe'))) === 'OK', 'klik');
    await sleep(1500);
    // Zajemalnik: URL.createObjectURL prestregamo (blobov tekst shranimo)
    await evaluate(`
      window.__eslogXml = null;
      const __orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        try { blob.text().then((t) => { window.__eslogXml = t; }); } catch {}
        return __orig(blob);
      };
      'OK'`);
    // Odpri dialog računov za našo ponudbo
    check(
      `Račun gumb (${offerRes.offer.number})`,
      String(await evaluate(clickByText('button', `Račun`))) === 'OK',
      'klik Račun',
    );
    await sleep(1200);
    const dialogTxt = String(await evaluate('document.body.textContent'));
    check('dialog: izdani računi viden', dialogTxt.includes(inv.number), dialogTxt.slice(0, 200));
    check('dialog: opomba ZIERDED', dialogTxt.includes('ZIERDED'), 'opomba');
    // Klik na e-račun gumb po testidu
    const clickEslog = `
      (() => {
        const el = document.querySelector('[data-testid="eslog-${inv.number}"]');
        if (!el) return 'NOT_FOUND';
        el.click();
        return 'OK';
      })()`;
    check('e-račun gumb obstaja', String(await evaluate(clickEslog)) === 'OK', 'gumb');
    await sleep(2000);
    const downloaded = String(await evaluate('window.__eslogXml'));
    check('UI prenos: XML zajet', downloaded.includes('<Invoice xmlns='), downloaded.slice(0, 120));
    check('UI prenos: pravilen račun', downloaded.includes(`<cbc:ID>${inv.number}</cbc:ID>`), 'ID');
    check('UI prenos: skupaj 2261.88', downloaded.includes('currencyID="EUR">2261.88</cbc:PayableAmount>'), 'znesek');
    const toastTxt = String(await evaluate('document.body.textContent'));
    check('toast: prenesen', toastTxt.includes('E-račun') && toastTxt.includes('prenesen'), 'toast');

    // ── 5) Iskrna vrata: brez davčne številke → 409 z razlogom ──
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...PRODAJALEC, taxNumber: '' }),
    });
    const noTax = await fetch(`${API}/api/invoices/${inv.id}/eslog`);
    check('brez davčne: 409', noTax.status === 409, noTax.status);
    const noTaxBody = (await noTax.json()) as { error?: string };
    check('409: razlog davčna', String(noTaxBody.error ?? '').includes('Davčna številka'), noTaxBody.error);

    // UI: toast z iskreno napako (gumb kliče strežnik, ki zavrne)
    await evaluate(`
      window.__eslogXml = null;
      'OK'`);
    check('e-račun gumb (2. klik)', String(await evaluate(clickEslog)) === 'OK', 'klik 2');
    await sleep(1800);
    const toast2 = String(await evaluate('document.body.textContent'));
    check('UI toast: E-račun ni mogoč', toast2.includes('E-račun ni mogoč'), 'toast 2');
    check('UI toast: davčna razlog', toast2.includes('Davčna številka'), 'razlog');

    // ── 6) Starejši račun brez postavk → 409 (če obstaja) ──
    const allInv = (await (await fetch(`${API}/api/invoices`)).json()) as {
      invoices: { id: string; number: string; itemCount: number }[];
    };
    const legacy = allInv.invoices.find((i) => i.itemCount === 0 && i.id !== inv.id);
    if (legacy) {
      const legacyRes = await fetch(`${API}/api/invoices/${legacy.id}/eslog`);
      check('starejši račun: 409', legacyRes.status === 409, legacyRes.status);
      const legacyBody = (await legacyRes.json()) as { error?: string };
      check('starejši račun: razlog postavke', String(legacyBody.error ?? '').includes('nima postavk'), legacyBody.error);
    } else {
      console.log('(brez starejšega računa s 0 postavkami — test preskočen)');
    }

    // ── 7) Mobilni 390: brez vodoravnega drsenja, footer flush ──
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(1200);
    const m1 = (await evaluate(
      '({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })',
    )) as { sw: number; cw: number };
    check('mobilni 390: brez vodoravnega drsenja', m1.sw <= 390, m1);
    // Dialog zapri, da merimo osnovni layout
    await cdp.send('Page.navigate', { url: APP });
    await sleep(2500);
    await evaluate(clickByText('button', 'Ponudbe'));
    await sleep(1200);
    const f = (await evaluate(
      '({ last: Math.round(document.documentElement.scrollHeight), bottom: Math.round(document.documentElement.getBoundingClientRect().bottom + window.scrollY) })',
    )) as { last: number; bottom: number };
    check('mobilni: vsebina se konča z dokumentom (footer flush)', f.last >= f.bottom && f.last - f.bottom < 4, f);

    // ── 8) Konzola čista ──
    await sleep(500);
    const errs = cdp.consoleErrors().filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
    check('konzola brez napak', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    chrome.kill();
    // ── 9) Čiščenje: ponudba kaskadira račun; obnovi nastavitve ──
    await fetch(`${API}/api/offers/${offerId}`, { method: 'DELETE' });
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(oldSettings),
    });
  }

  console.log(`\n${pass} prešlo, ${fail} padlo`);
  if (fail > 0) process.exit(1);
}

await main();
