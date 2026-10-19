// ─── Trajna shramba fotografij (Supabase Storage) ────────────────────────
// Zakaj obstaja: Vercel je serverless — datotečni sistem je pisanje-sposoben
// samo v `/tmp`, ki se ob reciklaži instance izbriše. Fotke so zato na
// produkciji preživele le do naslednje zahteve. Ta modul doda TRAJNO shrambo
// prek Supabase Storage REST API-ja (brez SDK, brez novih odvisnosti).
//
// VZOREC (pošten, brez čarovnije):
//   1. `savePhoto` vedno najprej zapiše na lokalni disk (hitro branje,
//      deluje tudi brez omrežja) — nato, če je shramba nastavljena, objekt
//      ŠE naloži v Supabase (write-through);
//   2. branje poskusi disk, nato Supabase (instance se je medtem lahko
//      reciklirala);
//   3. brisanje pobriše oboje, najboljše prizadevanje.
//
// Če okolje ni nastavljeno (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), se
// modul NE oglaša in vse ostane na disku — lokalni razvoj in testi se ne
// spremenijo. `photoRemoteConfigured()` je edini vir resnice o tem.

const BUCKET = (): string => (process.env.SUPABASE_BUCKET ?? 'photos').trim() || 'photos';

/** Osnovni URL projekta brez končne poševnice; '' kadar ni nastavljen. */
export function supabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
}

/** Ali je trajna shramba nastavljena? (oba podatka sta potrebna) */
export function photoRemoteConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return supabaseUrl(env) !== '' && (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim() !== '';
}

/** Pot objekta v bucketu: samo varno ime datoteke (`<id>.jpg`). */
export function objectUrl(fileName: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = supabaseUrl(env);
  const bucket = (env.SUPABASE_BUCKET ?? 'photos').trim() || 'photos';
  return `${base}/storage/v1/object/${bucket}/${encodeURIComponent(fileName)}`;
}

function authHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Naloži objekt (upsert). Vrne `{ ok, error }` — nikoli ne vrže. */
export async function putRemote(
  fileName: string,
  bytes: Buffer | Uint8Array,
  mime: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!photoRemoteConfigured()) return { ok: false, error: 'shramba ni nastavljena' };
  try {
    const r = await fetch(objectUrl(fileName), {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': mime,
        'x-upsert': 'true',
        'cache-control': 'max-age=31536000',
      },
      body: new Uint8Array(bytes),
    });
    if (r.ok) return { ok: true, error: null };
    const txt = await r.text().catch(() => '');
    return { ok: false, error: `HTTP ${r.status}${txt ? ` — ${txt.slice(0, 180)}` : ''}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Preberi objekt; null kadar ga ni (ali shramba ni nastavljena). */
export async function getRemote(fileName: string): Promise<Buffer | null> {
  if (!photoRemoteConfigured()) return null;
  try {
    const r = await fetch(objectUrl(fileName), { headers: authHeaders() });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Izbriši objekt (najboljše prizadevanje). */
export async function deleteRemote(fileName: string): Promise<boolean> {
  if (!photoRemoteConfigured()) return false;
  try {
    const r = await fetch(objectUrl(fileName), { method: 'DELETE', headers: authHeaders() });
    return r.ok;
  } catch {
    return false;
  }
}
