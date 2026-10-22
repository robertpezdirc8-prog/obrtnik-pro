// Verifikacija trajne shrambe fotografij (Supabase Storage):
//   1) možgani odločitve so ČISTI: `photoRemoteConfigured` je edini vir resnice
//      (oba podatka ali nič) — brez tihega polovičnega delovanja;
//   2) `objectUrl` pravilno sestavi pot in URL-encoda ime;
//   3) `putRemote` pošlje POST na pravi URL z `x-upsert` in `apikey`;
//   4) `savePhoto` naloži tudi v shrambo (write-through) IN o tem pošteno
//      poroča (`remote`/`remoteError`), kadar shramba ni nastavljena pa ne.
// Omrežje je STUBANO (globalThis.fetch) — preverba ne potrebuje interneta.
// Zagon: bun tests/verify/photo-remote.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  objectUrl,
  photoRemoteConfigured,
  putRemote,
  getRemote,
  supabaseUrl,
} from '../../src/lib/photo-remote';
import { savePhoto } from '../../src/lib/photo-store';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, info?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`); }
};

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' } as unknown as NodeJS.ProcessEnv;
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// `putRemote` bere process.env (kot v produkciji) — za preizkus ga nastavimo
// tukaj; razdelek 4 ga nato namerno briše in vrača.
process.env.SUPABASE_URL = ENV.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

type Call = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array };
const calls: Call[] = [];
const stubFetch = (status = 200) => async (input: string | URL | Request, init?: RequestInit) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  calls.push({
    url: String(input),
    method: String(init?.method ?? 'GET'),
    headers,
    body: init?.body instanceof Uint8Array ? init.body : undefined,
  });
  if (status >= 400) return new Response('napaka', { status });
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
};

console.log('Trajna shramba fotografij (photo-remote) — čisto jedro + write-through\n');

// ── 1) Odločitev: oba podatka ali nič ──
{
  check('brez okolja → ni nastavljeno', photoRemoteConfigured({} as unknown as NodeJS.ProcessEnv) === false);
  check('samo URL → ni nastavljeno', photoRemoteConfigured({ SUPABASE_URL: 'https://x.supabase.co' } as unknown as NodeJS.ProcessEnv) === false);
  check('samo ključ → ni nastavljeno', photoRemoteConfigured({ SUPABASE_SERVICE_ROLE_KEY: 'k' } as unknown as NodeJS.ProcessEnv) === false);
  check('oba → nastavljeno', photoRemoteConfigured(ENV) === true);
  check('URL brez končne poševnice', supabaseUrl({ SUPABASE_URL: 'https://x.supabase.co///' } as unknown as NodeJS.ProcessEnv) === 'https://x.supabase.co');
}

// ── 2) Pot objekta ──
{
  check('objectUrl: pravi bucket in ime', objectUrl('abc.jpg', ENV) === 'https://proj.supabase.co/storage/v1/object/photos/abc.jpg', objectUrl('abc.jpg', ENV));
  check('objectUrl: URL-encode posebnih znakov', objectUrl('a b.jpg', ENV).endsWith('/photos/a%20b.jpg'), objectUrl('a b.jpg', ENV));
  check('objectUrl: privzeti bucket je photos', objectUrl('x.png', { ...ENV, SUPABASE_BUCKET: '' } as unknown as NodeJS.ProcessEnv).includes('/object/photos/x.png'));
}

// ── 3) putRemote / getRemote ──
{
  const orig = globalThis.fetch;
  globalThis.fetch = stubFetch(200) as unknown as typeof fetch;
  const ok = await putRemote('abc.jpg', new Uint8Array([9, 9]), 'image/png');
  globalThis.fetch = orig;
  check('putRemote: uspeh', ok.ok === true && ok.error === null, ok);
  const c = calls.at(-1)!;
  check('putRemote: POST na pravi URL', c.method === 'POST' && c.url === objectUrl('abc.jpg', ENV), [c.method, c.url]);
  check('putRemote: upsert glava', c.headers['x-upsert'] === 'true', c.headers);
  check('putRemote: apikey + bearer', c.headers.apikey === 'service-key' && c.headers.authorization === 'Bearer service-key', c.headers);
  check('putRemote: vsebina poslana', c.body?.length === 2, c.body?.length);

  globalThis.fetch = stubFetch(403) as unknown as typeof fetch;
  const bad = await putRemote('abc.jpg', new Uint8Array([1]), 'image/png');
  globalThis.fetch = orig;
  check('putRemote: napaka je VRNJENA, ne vrže', bad.ok === false && String(bad.error).includes('403'), bad);

  globalThis.fetch = stubFetch(404) as unknown as typeof fetch;
  const missing = await getRemote('abc.jpg');
  globalThis.fetch = orig;
  check('getRemote: 404 → null (brez izjeme)', missing === null, missing);
}

// ── 4) savePhoto: write-through ──
{
  const dir = mkdtempSync(join(tmpdir(), 'photo-remote-'));
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(200) as unknown as typeof fetch;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  calls.length = 0;
  const plain = await savePhoto(TINY_PNG, 'brez-shrambe', dir);
  check('savePhoto brez shrambe: shrani na disk', plain !== null && plain.remote === undefined, plain);
  check('savePhoto brez shrambe: NI omrežnega klica', calls.length === 0, calls.length);

  process.env.SUPABASE_URL = ENV.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
  calls.length = 0;
  const withRemote = await savePhoto(TINY_PNG, 's-shrambo', dir);
  check('savePhoto s shrambo: remote = true', withRemote?.remote === true, withRemote);
  check('savePhoto s shrambo: en omrežni klic', calls.length === 1, calls.length);
  check('savePhoto s shrambo: datoteka je na disku', withRemote?.fileName.endsWith('.png') === true, withRemote?.fileName);

  globalThis.fetch = stubFetch(500) as unknown as typeof fetch;
  const failed = await savePhoto(TINY_PNG, 'shramba-pade', dir);
  check('savePhoto ob napaki shrambe: disk ostane', failed !== null && failed.fileName.length > 0, failed?.fileName);
  check('savePhoto ob napaki shrambe: remoteError viden (iskreno)', failed?.remote === false && typeof failed?.remoteError === 'string', failed);

  globalThis.fetch = origFetch;
  if (origUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = origUrl;
  if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} OK · ${fail} NAPAK`);
process.exit(fail === 0 ? 0 : 1);

