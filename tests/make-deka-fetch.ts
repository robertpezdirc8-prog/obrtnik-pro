// Prenos ORIGINALNIH ROKSAL gradiv za TERASNO deko (150×25 mm) prek CDP
// (chrome-headless-shell, port 9222 — glej tests/make-kubo-fetch.ts za
// tehniko: roksal.com ima JS-izziv "One moment, please...", ki preverja
// navigator.webdriver + /headless/ UA → spoof obojega, bajti preneseni
// iz konteksta strani s piškotki izziva).
//
// VIRI (uradne strani roksal.com, preverjene z page_reader 2026):
//  - stran "Barvni odtenki" (WoodCore WPC deske): TERASNI profil —
//    "Izbirate lahko med sedmimi barvnimi odtenki in tremi površinami…
//    Le Rustic deske so na eni strani popolnoma gladke…"
//  - stran "WPC deske za teraso": KLASIK (150×25×4000/2200, "v petih
//    barvnih odtenkih") + RUSTIC ("izgled STARAN LES", gladka/rebričena)
//    + uradna fotka profila deske in fotka vgradnje.
//
// Zagon: bun tests/make-deka-fetch.ts  (zahteva CDP na 9222)

const CDP = 'http://127.0.0.1:9222';

const urls: Array<[string, string]> = [
  ['BARVNA_LESTVICA_1-terasa4.png', 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_1-terasa4.png'],
  ['deska-za-terase.jpg', 'https://roksal.com/wp-content/uploads/2020/03/deska-za-terase.jpg'],
  ['deske-za-teraso-wpc.jpg', 'https://roksal.com/wp-content/uploads/2020/03/deske-za-teraso-wpc.jpg'],
  ['deske-za-terase_215.jpg', 'https://roksal.com/wp-content/uploads/2020/03/deske-za-terase_215.jpg'],
];

async function cdpCall(ws: WebSocket, id: number, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const m = JSON.parse(ev.data as string);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const out = '/tmp/deka-assets/';
  (await import('node:fs')).mkdirSync(out, { recursive: true });
  for (const [name, url] of urls) {
    const tab = await (await fetch(`${CDP}/json/new?url=${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let idc = 0;
    await cdpCall(ws, ++idc, 'Page.enable');
    await cdpCall(ws, ++idc, 'Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'Linux x86_64' });
    await cdpCall(ws, ++idc, 'Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'webdriver',{get:()=>false});" });
    await cdpCall(ws, ++idc, 'Page.navigate', { url });
    let ok = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const ct = await cdpCall(ws, ++idc, 'Runtime.evaluate', { expression: 'document.contentType', returnByValue: true });
        if (ct?.result?.value && String(ct.result.value).startsWith('image/')) { ok = true; break; }
      } catch { /* reload v teku */ }
    }
    if (!ok) { console.log(`✗ ${name}: izziv ni prešel`); ws.close(); continue; }
    const b64 = await cdpCall(ws, ++idc, 'Runtime.evaluate', {
      expression: `(async () => { const r = await fetch(location.href, {cache:'no-store'}); const b = new Uint8Array(await r.arrayBuffer()); let s=''; for (let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i,i+0x8000))); return btoa(s); })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (!b64?.result?.value) {
      console.log(`✗ ${name}: brez vrednosti →`, JSON.stringify(b64).slice(0, 300));
      ws.close(); continue;
    }
    const buf = Buffer.from(b64.result.value as string, 'base64');
    (await import('node:fs')).writeFileSync(out + name, buf);
    console.log(`✓ ${name}: ${buf.length} bajtov`);
    ws.close();
  }
}
main().catch((e) => { console.error('NAPAKA', e); process.exit(1); });

export {};
