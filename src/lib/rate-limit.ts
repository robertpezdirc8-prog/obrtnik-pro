// ─── Omejevalnik zahtev v pomnilniku (in-memory rate limit) ────
// ZAKAJ: /api/analyze-photo požene sharp + celoten CV cevovod (Sobel,
// Hough, povezane komponente) — za poštenega obrtnika je to ena analiza
// na eno fotko, za zlonamernega klienta pa poceni zanka, ki utruja
// stroj. Omejevalnik drži grobe zlorabe, ne posega v pošteno delo.
//
// ISKRENOST (del načel README): omejevalnik je v pomnilniku PROCESA —
// po ponovnem zagonu se števci izgubijo in več-instancna namestitev
// ga NE pokriva (ni Redis). To je zavestna izbira za eno-mašinsko
// SQLite aplikacijo, tu zapisana, ne skrita.
//
// Okno je fiksno (fixed window): prvi zadetek ga odpre, po `windowMs`
// se števec ponastavi. Čas je INJEKTIRAN (`hit(key, now)`), zato je
// jedro deterministično preverljivo brez spanja — glej
// tests/verify/rate-limit.ts.

export interface RateLimitRule {
  /** Širina okna v milisekundah. */
  windowMs: number;
  /** Največ dovoljenih zadetkov znotraj enega okna. */
  max: number;
  /** Več kot toliko ključev hkrati pomeni, da se pred vsakim zadetkom
   *  počistijo iztekli (ekspirani) okni. Privzeto 5000. */
  maxKeys?: number;
}

export interface RateLimitDecision {
  ok: boolean;
  /** Koliko sekund naj klient čaka (Retry-After). 0, ko je zahteva dovoljena. */
  retryAfterSec: number;
  /** Koliko dovoljenih zadetkov klientu ŠE ostaja v tem oknu. */
  remaining: number;
}

export interface RateLimitStore {
  hit(key: string, now: number): RateLimitDecision;
  /** Koliko ključev trenutno živi v pomnilniku (za preverjanje pranja). */
  size(): number;
}

export function createRateLimiter(rule: RateLimitRule): RateLimitStore {
  const maxKeys = rule.maxKeys ?? 5000;
  const windows = new Map<string, { start: number; count: number }>();

  const prune = (now: number): void => {
    if (windows.size < maxKeys) return;
    for (const [k, w] of windows) {
      if (now - w.start >= rule.windowMs) windows.delete(k);
    }
  };

  return {
    hit(key: string, now: number): RateLimitDecision {
      prune(now);
      const w = windows.get(key);
      if (!w || now - w.start >= rule.windowMs) {
        windows.set(key, { start: now, count: 1 });
        return { ok: true, retryAfterSec: 0, remaining: rule.max - 1 };
      }
      if (w.count < rule.max) {
        w.count += 1;
        return { ok: true, retryAfterSec: 0, remaining: rule.max - w.count };
      }
      // Okno je polno — koliko časa do ponastavitve je še ostalo.
      const retryAfterSec = Math.max(1, Math.ceil((w.start + rule.windowMs - now) / 1000));
      return { ok: false, retryAfterSec, remaining: 0 };
    },
    size(): number {
      return windows.size;
    },
  };
}

/** Klientov ključ iz glave `x-forwarded-for` — prvi vnos je IZVIRNI klient
 *  (cesta za proxi). Brez glave je ključ iskreno 'local' (eno-mašinski
 *  zagon), brez izmišljevanja naslovov. */
export function clientKeyFromHeaders(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (typeof fwd === 'string') {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'local';
}

/** Privzeto pravilo za /api/analyze-photo: 30 analiz na minuto na klienta.
 *  Meja lovi ZANKE, ne poštenega dela — 30 je več, kot monter analiza
 *  fotk utegne potrebovati v minuti. */
export const ANALYZE_RATE_RULE: RateLimitRule = { windowMs: 60_000, max: 30 };
