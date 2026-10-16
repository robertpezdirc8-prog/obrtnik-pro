// E2E: objavljena MEJA RAZMIKA in objavljena REŽA v vmesniku razporeda stebrov
// (Task 24 → 25 → 26).
//
// ZAKAJ ŠE ENA E2E DATOTEKA, ko jedrni skript že pove 129/129: meja je bila
// doslej PRIVZETEK v kodi (150), monter je izbiral razmak iz nabora in ni mu
// nihče povedal, od kod številka pride in kdaj je njegova izbira NAD njo. To je
// UI-vedenje — jedrni testi ga strukturno ne morejo zadeti, enako kot pri
// `e2e-band-ui.ts`.
//
// POPRAVEK PROTI PRVI VERZIJI: prva verzija je v vmesniku trdila eno samo mejo
// 150 cm in je ob višini 140 cm javila „razhajanje 150 zoper 180“. Oboje je
// bilo napačno: 150 velja SAMO za profil POLNA DESKA 57-32, 180 pa za profil
// POLNA DESKA 100/128 do 150 cm višine — dva različna izdelka, ne protislovje.
// Skript zato sedaj gre skozi tri stanja, ki jih mora monter videti:
//   a) profil NI izbran → tabela po profilih, ene same številke ni;
//   b) profil 57-32 → 150 cm s citatom; izbrano PREČNO → 133 cm (strožje zmaga);
//   c) profil 100 pri 140 cm → 180 cm in BREZ javljenega razhajanja.
//
// POT V BRSKALNIKU je NAMERNO BRES FOTKE: laser (ročni vnos 640 cm) → zavihek
// Pripomočki → panel. Dokaže tudi to, da je razpored orodje in ne korak
// fotomontaže (panel je zdaj priklopjen na obeh mestih).
//
// Zagon: bun tests/e2e-span-rule-ui.ts   (zahteva `next dev`; privzeto :3000,
// zamenljiv s `APP_URL=http://localhost:3001/` — (:3000 lahko zasede tuj proces))
// Artefakti: samo v os.tmpdir(), NIKOLI v repozitoriju (fotke in posnetki).

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9346;
const APP = process.env.APP_URL ?? 'http://localhost:3000/';
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false });

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
    /** Izbrani Radix `Select`: odpre drsnik in klikne opcijo po besedilu. */
    const pick = async (triggerSel: string, optionText: string): Promise<string> => {
      const opened = await clickSel(triggerSel);
      if (opened !== 'OK') return 'NO_TRIGGER';
      await sleep(350);
      return String(await evaluate(`(() => {
        const want = ${JSON.stringify(optionText)};
        const o = [...document.querySelectorAll('[role="option"]')].find((x) => (x.textContent || '').includes(want));
        if (!o) return 'NO_OPTION';
        o.click();
        return 'OK';
      })()`));
    };
    const numberInput = async (label: string, value: string): Promise<string> =>
      String(await evaluate(`(() => {
        const i = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
        if (!i) return 'NO_INPUT';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
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
    // Laserski vnos ima placeholder, ne aria-label — numberInput() ga ne zadene,
    // zato je tarča zapisana posebej.
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

    // ── 3) a) PROFIL NI IZBRAN: ene same številke NI, pokaže se tabela ──
    // To je bistvo popravka: prva verzija je tu pokazala »Največ 150 cm«, ki pa
    // velja samo za profil 57-32 (in ne npr. za 128, kjer je meja 110 cm).
    const noProfile = await txt('[data-testid="post-layout-span-rule"]');
    check('7 brez profila UI NE trdi ene same meje (150 se ne pojavi kot trditev)',
      !noProfile.includes('Največ 150 cm'), noProfile.slice(0, 260));
    check('8 brez profila se pokaže TABELA mej po profilih',
      (await exists('[data-testid="post-layout-profile-table"]')) &&
        noProfile.includes('Meja je odvisna od profila'), noProfile.slice(0, 260));
    check('9 tabela našteje OBE objavljeni meji: 110 (POLNA 128) in 150 (POLNA 57-32)',
      /POLNA DESKA 128: 110 cm/.test(noProfile) && /POLNA DESKA 57-32: 150 cm/.test(noProfile),
      noProfile.slice(0, 300));
    check('10 tabela citira VIR pri vsaki vrstici (roksal.com)',
      (noProfile.match(/roksal\.com/g) ?? []).length >= 2, noProfile.slice(0, 200));
    check('11 opozorilo se oglasi NAJSTROŽJE meje (110), ne pa proti meji 0 cm',
      noProfile.includes('NAD objavljeno mejo') && noProfile.includes('najstrožja od njih je 110 cm') &&
        !noProfile.includes('je 0 cm'), noProfile.slice(0, 300));
    check('12 manjkajoči vhodi so javljeni (profili, ki jih ni bilo mogoče ovrednotiti)',
      /manjka:/.test(noProfile), noProfile.slice(0, 300));

    // ── 4) b) profil 57-32 → meja 150 s CITATOM, opozorilo izgine ──
    check('13 izbirnik profila obstaja in je na voljo', await exists('[aria-label="Profil polnila"]'), 'aria-label');
    check('14 profil POLNA DESKA 57-32 je izbran', (await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 57-32')) === 'OK',
      await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 57-32'));
    await sleep(400);
    const p57 = await txt('[data-testid="post-layout-span-rule"]');
    check('15 profil 57-32 → OBJAVLJENA meja 150 cm', p57.includes('Največ 150 cm'), p57.slice(0, 260));
    check('16 monter vidi DOBESEDEN citat proizvajalca',
      p57.includes('Maksimalni razmak med stebrički je 150 cm'), p57.slice(0, 300));
    check('17 vir (domena navodila) je v vmesniku', p57.includes('roksal.com'), p57.slice(0, 240));
    check('18 tabela izgine, ko je profil izbran (ne kaže se dveh resnic)',
      !(await exists('[data-testid="post-layout-profile-table"]')), await txt('[data-testid="post-layout"]'));
    check('19 pri 1,50 m in meji 150 cm OPOZORIILA NI (izbira ni nad mejo)',
      !p57.includes('NAD objavljeno'), p57.slice(0, 260));
    check('20 opomba o manjkajoči orientaciji je prikazana (133 je lahko strožje)',
      p57.includes('Orientacija desk ni izbrana'), p57.slice(0, 300));

    // ── 5) orientacija PREČNO → strožje pravilo zmaga (133, ne 150) ──
    check('21 izbirnik postavitve desk obstaja', await exists('[aria-label="Postavitev desk"]'), 'aria-label');
    check('22 orientacija PREČNO je izbrana', (await pick('[aria-label="Postavitev desk"]', 'Prečno')) === 'OK',
      await pick('[aria-label="Postavitev desk"]', 'Prečno'));
    await sleep(400);
    const cross = await txt('[data-testid="post-layout-span-rule"]');
    check('23 prečno → meja pade na 133 cm (min obeh veljavnih citatov)',
      cross.includes('Največ 133 cm') && !cross.includes('Največ 150 cm'), cross.slice(0, 260));
    check('24 pas 133–145 je javljen S SPODNJIM robom, ne kot dovoljenje 145',
      cross.includes('pas 133–145 cm') && cross.includes('spodnji rob 133 cm'), cross.slice(0, 300));
    check('25 izbira 1,50 m je zdaj NAD mejo in je JAVLJENA',
      cross.includes('NAD objavljeno mejo'), cross.slice(0, 300));

    // ── 6) pravilo OPOZORI, ne PREGLASI: račun ostane monterjev ──
    // Meja je 133, monterjeva izbira 1,50 m — razpored mora STILLI 1,50 m
    // (640/5 = 1,28 m), sicer bi aplikacija tiho spreminjala količine.
    check('26 meja 133 NE sme tiho spremeniti razporeda (izbira 1,50 m → razmak 1,28 m)',
      (await txt('[data-testid="post-layout-summary"]')).includes('1,28 m'),
      await txt('[data-testid="post-layout-summary"]'));
    check('27 izbira 2,50 m je na voljo', (await pick('[aria-label="Največji razmak stebrov"]', '2,50 m')) === 'OK',
      await pick('[aria-label="Največji razmak stebrov"]', '2,50 m'));
    await sleep(400);
    check('28 nad-mejna izbira je OPOZORILO, račun pa ostane monterjev (640/3 = 2,13 m)',
      (await txt('[data-testid="post-layout-span-rule"]')).includes('NAD objavljeno') &&
        (await txt('[data-testid="post-layout-summary"]')).includes('2,13 m'),
      await txt('[data-testid="post-layout-summary"]'));

    // ── 7) c) profil 100 pri 140 cm → 180 cm in BREZ lažnega razhajanja ──
    // Prva verzija je tu javila »citat se razhajata (150 / 180)«. Številki
    // pripadata DVEMA različnima izdelkoma, zato se vmesnik NE SME pritoževati.
    check('29 profil POLNA DESKA 100 je izbran', (await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 100')) === 'OK',
      await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 100'));
    await sleep(300);
    check('30 orientacija vrnjena na „ni izbrano“ (da 180 ni zasenčeno s 133)',
      (await pick('[aria-label="Postavitev desk"]', 'ni izbrano')) === 'OK',
      await pick('[aria-label="Postavitev desk"]', 'ni izbrano'));
    await sleep(300);
    check('31 višina polnila 140 cm vpisana', await numberInput('Višina polnila v centimetrih', '140') === 'OK', 'input');
    await sleep(400);
    const p100 = await txt('[data-testid="post-layout-span-rule"]');
    check('32 profil 100 do 150 cm visok → meja 180 cm (citat je svoj, ne splošen)',
      p100.includes('Največ 180 cm') && p100.includes('Maksimalni razmak med stebrički je 180 cm'), p100.slice(0, 300));
    check('33 NAPAKA PRVE VERZIJE JE ODRINJENA: nobenega „razhajanja“ 150/180 ni',
      !p100.includes('razhajata') && !p100.includes('Dva enako splošna objavljena citata'), p100.slice(0, 300));
    check('34 pri meji 180 cm je izbira 2,50 m ŠE VEDI nad mejo (opozorilo ne izgine)',
      p100.includes('NAD objavljeno'), p100.slice(0, 300));
    // Ista izbira (2,50 m) pod strožjo in pod nižjo mejo: mejna logika mora
    // slediti profilu in višini, ne pa ostati priklopljena na prvo številko.
    check('35 vrnitev na 1,50 m pod mejo 180 cm → opozorilo IZGINI',
      (await pick('[aria-label="Največji razmak stebrov"]', '1,50 m')) === 'OK',
      await pick('[aria-label="Največji razmak stebrov"]', '1,50 m'));
    await sleep(400);
    check('36 izbira pod mejo ni javljena kot kršitev',
      !(await txt('[data-testid="post-layout-span-rule"]')).includes('NAD objavljeno'),
      await txt('[data-testid="post-layout-span-rule"]'));
    await numberInput('Višina polnila v centimetrih', '190');
    await sleep(400);
    const tall = await txt('[data-testid="post-layout-span-rule"]');
    check('37 profil 100 pri 190 cm → 150 cm (isti profil, drug pogoj; pravila sledijo vhodu)',
      tall.includes('Največ 150 cm'), tall.slice(0, 300));

    // ── 8) dokaz na disku (velikost preverjena, ne samo „poskus“ — glej e2e-band-ui) ──
    const shotPath = guardOutSideRepo(join(OUT_DIR, 'span-rule-ui.png'));
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
    if (!shot.data) throw new Error('captureScreenshot vrnil ni bajtov');
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    check('38 posnetek napisan na disk', statSync(shotPath).size > 20000, `bajtov ${statSync(shotPath).size}`);
    console.log(`   posnetek: ${shotPath}`);

    // ── 9) MUTACIJA: profil 128 (meja 110) — UI MORA pasti na nižjo mejo.
    //    Če ta preizkus ostane zelen ob 150, modul meje sploh ne bere po profilu.
    check('39 profil POLNA DESKA 128 je izbran', (await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 128')) === 'OK',
      await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 128'));
    await sleep(400);
    const p128 = await txt('[data-testid="post-layout-span-rule"]');
    check('40 profil 128 → 110 cm in opozorilo pri isti izbiri 1,50 m (prva verzija bi montirala 150)',
      p128.includes('Največ 110 cm') && p128.includes('NAD objavljeno'), p128.slice(0, 300));
    check('41 meja 110 cm ima SVOJ citat (133–140 in 200 se ne mešata vanj)',
      p128.includes('vodoravno postavitev desk morajo biti na maksimalni razdalji 110 cm'), p128.slice(0, 320));
    check('42 nobeno stanje ne javi razhajanja (v1 ga je izmislila)', !p128.includes('razhajata'), p128.slice(0, 200));

    // ── 10) REŽA med deskami: objava ali njena ODSOTNOST (Task 26 / 82) ──
    // Ista vrsta napake kot meja: katalog je trdil „uradni obseg 0,2–3 cm“,
    // ki ga nobena stran ne objavlja. Panel sme pokazati samo tisto, kar je
    // objavljeno POD PROFIL, ki ga je monter izbral — in mora reči, da nič
    // ni, namesto da bi njegov privzetek prikazal kot ROKSALovo zahtevo.
    const p128Gap = await txt('[data-testid="post-layout-board-gap"]');
    check('43 profil 128 → reža je pokazana KOT OBJAVLJEN PAS 0,5–3 cm',
      p128Gap.includes('Reža po ROKSALu: 0,5–3 cm'), p128Gap.slice(0, 300));
    check('44 pas je javljen kot priporočilo in ima VIR na zaslonu',
      p128Gap.includes('priporočen pas, ne meja') && p128Gap.includes('roksal.com'), p128Gap.slice(0, 300));
    check('45 decimalke so z vejico (0.5 bi bil tuji zapis)', !p128Gap.includes('0.5'), p128Gap.slice(0, 200));
    check('46 ista objava pokriva profil 100 (naslov imenuje oba)',
      (await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 100')) === 'OK' &&
        (await txt('[data-testid="post-layout-board-gap"]')).includes('0,5–3 cm'),
      await txt('[data-testid="post-layout-board-gap"]'));
    await sleep(300);
    check('47 profil 57-32 → panel JAVE, da reže ni, in kje številka velja',
      (await pick('[aria-label="Profil polnila"]', 'POLNA DESKA 57-32')) === 'OK' &&
        (await txt('[data-testid="post-layout-board-gap"]')).includes('Reže ROKSAL za ta izdelek ne objavlja') &&
        /velja samo za POLNA DESKA 100 \/ POLNA DESKA 128/.test(await txt('[data-testid="post-layout-board-gap"]')),
      await txt('[data-testid="post-layout-board-gap"]'));
    check('48 brez profila ni pokazane NOBE številke reže',
      (await pick('[aria-label="Profil polnila"]', 'profil ni izbran')) === 'OK' &&
        !/Reža po ROKSALu: [0-9]/.test(await txt('[data-testid="post-layout-board-gap-headline"]')),
      await txt('[data-testid="post-layout-board-gap-headline"]'));

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
