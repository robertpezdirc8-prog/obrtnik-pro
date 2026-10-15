// Prenos zaščitenih slik roksal.com prek CDP (chrome --headless=new z stealth zastavicami).
// izziv: "One moment, please..." preveri navigator.webdriver + UA → naš chrome ju spoofa.
const CDP = 'http://127.0.0.1:9222';

const urls: Array<[string, string]> = [
  ['BARVNA_LESTVICA_5-kubo4.png', 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_5-kubo4.png'],
  ['BARVNA_LESTVICA_2_polna.png', 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna-1024x240.png'],
  ['BARVNA_LESTVICA_3-rombi4.png', 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4-1024x268.png'],
  ['deske-kubo-razlicne-cevi.jpg', 'https://roksal.com/wp-content/uploads/2024/03/deske-kubo-razlicne-cevi.jpg'],
  ['pregradna-stena-k_h.jpg', 'https://roksal.com/wp-content/uploads/2026/03/pregradna-stena-k_h.jpg'],
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
  const out = '/tmp/kubo-assets/';
  for (const [name, url] of urls) {
    // nov tab
    const tab = await (await fetch(`${CDP}/json/new?url=${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let idc = 0;
    await cdpCall(ws, ++idc, 'Page.enable');
    // stealth: normalen UA (brez "HeadlessChrome") + navigator.webdriver=false pred vsakim dokumentom
    await cdpCall(ws, ++idc, 'Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'Linux x86_64' });
    await cdpCall(ws, ++idc, 'Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'webdriver',{get:()=>false});" });
    await cdpCall(ws, ++idc, 'Page.navigate', { url });
    // čakaj, da izziv preide (do 40 s; izziv se po 5 s reloada)
    let ok = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const ct = await cdpCall(ws, ++idc, 'Runtime.evaluate', { expression: 'document.contentType', returnByValue: true });
        if (ct?.result?.value && String(ct.result.value).startsWith('image/')) { ok = true; break; }
      } catch { /* reload v teku */ }
    }
    if (!ok) { console.log(`✗ ${name}: izziv ni prešel`); ws.close(); continue; }
    // pridobi bajte iz konteksta strani (piškotki so že nastavljeni)
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
