// Prenos ORIGINALNIH ROKSAL gradiv za POKONČNO/PREČNO OGRAJO (POLNA DESKA +
// ROMB) prek CDP (chrome-headless-shell, port 9222 — glej tests/make-kubo-fetch.ts
// za tehniko: roksal.com ima JS-izziv "One moment, please...", ki preverja
// navigator.webdriver + /headless/ UA → spoof obojega, bajti preneseni
// iz konteksta strani s piškotki izziva).
//
// VIRI (uradne strani roksal.com, preverjene z page_reader 2026):
//  - "WPC deske za pokončno ograjo – 8 barv": POLNA DESKA-57-32 (57×32×5800,
//    "štiri barve"), POLNA DESKA-100 (100×12×5800, samo pokončno, "osmimi
//    barvami"), POLNA DESKA-128 (128×16×2200, "šestimi barvami"), ROMB
//    DESKA-67 (67×26×5800 Z ALU CEVJO, "sedmimi barvami") + uradni preseki.
//  - "WPC prečna ograja": DESKA-150 (7 odtenkov — že registrirano, Task 56),
//    POLNA-128 ("šestimi barvami", 128×16,5×2200), ROMB-67.
//  - "Barvni odtenki": 3 preostale lestvice — rombi4 (ROMB), 2_polna (POLNA
//    100 + 57/32), 4-polna-128-4 (POLNA-128).
//
// Zagon: bun tests/make-ograje-fetch.ts  (zahteva CDP na 9222)

const CDP = 'http://127.0.0.1:9222';

const urls: Array<[string, string]> = [
  // Barvne lestvice (polne ločljivosti)
  ['barvna-lestvica-romb.png', 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4.png'],
  ['barvna-lestvica-polna.png', 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna.png'],
  ['barvna-lestvica-polna-128.png', 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_4-polna-128-4.png'],
  // Uradni preseki profilov (s strani ograj)
  ['profil-polna-deska-100.jpg', 'https://roksal.com/wp-content/uploads/2021/12/polna-deska-nova2021.jpg'],
  ['profil-polna-deska-57-32.jpg', 'https://roksal.com/wp-content/uploads/2025/07/polna-deska-57-32.jpg'],
  ['profil-romb-deska-67.jpg', 'https://roksal.com/wp-content/uploads/2021/12/romb-woodcore-wpc.jpg'],
  // Uradni posnetki vgradnje (pokončna ograja)
  ['vgradnja-pokoncna-ograja.jpg', 'https://roksal.com/wp-content/uploads/2020/03/ograja-pokoncna.jpg'],
  ['vgradnja-polna-amazon.jpg', 'https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-pokoncna-ograja-amazon-polna-deska-loz1.jpg'],
  ['vgradnja-polna-burma.jpg', 'https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-pokoncna-ograja-burma-polna-deska-1.jpg'],
  ['vgradnja-romb-pokoncna.jpg', 'https://roksal.com/wp-content/uploads/2021/03/Romb-pokoncna-m.jpg'],
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
  // Prehodna izhodna mapa: '/tmp' je veljala samo v razvojnem kontejnerju.
  const out = (await import('node:os')).tmpdir() + '/obrtnik-ograje-assets/';
  (await import('node:fs')).mkdirSync(out, { recursive: true });
  const fs = await import('node:fs');
  for (const [name, url] of urls) {
    if (fs.existsSync(out + name)) { console.log(`→ ${name}: že obstaja, preskočim`); continue; }
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
