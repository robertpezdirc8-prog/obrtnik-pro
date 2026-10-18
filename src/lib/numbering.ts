// ─── Atomsko številčenje dokumentov (ponudba, račun) ─────────
// PROBLEM: številka (LETNIK-NNN, RAC-LETO-NNN) se izračuna iz
// count() + 1. Dva sočasna vnosa lahko dobita ISTO številko — edini
// čuvaj je UNIQUE omejitev v bazi, ki vrne Prisma napako P2002.
// Prej je zahteva ob trku padla s 500, čeprav je popravilo preprosto:
// številka se izračuna ZNOVA in vnos ponovi (največ 5 poskusov).
//
// TESTNOST brez baze: trk se prepozna po `code === 'P2002'`
// (duck-typing), ne po `instanceof` — prava Prisma
// PrismaClientKnownRequestError nosi ravno ta `code`, sintetična
// napaka pa jedro lahko preveri brez zagona Prisme
// (tests/verify/numbering-retry.ts). Tuje napake se PROPAGIRAJO —
// ponavlja se samo trk številke, ne vsaka napaka.

export const MAX_NUMBER_ATTEMPTS = 5;

export interface NumberRetryResult<T> {
  value: T;
  /** Kolikokrat je bila številka dejansko porabljena (1 = brez trka). */
  attempts: number;
}

export async function createWithUniqueNumber<T>(
  /** Zgenerira NASLEDNJO številko. Klican je natanko enkrat na poskus. */
  generate: () => Promise<string>,
  /** Ustvari dokument s PODANO številko. Ob P2002 se pokliče znova. */
  attempt: (number: string) => Promise<T>,
  opts?: {
    /** Privzeto MAX_NUMBER_ATTEMPTS. */
    maxAttempts?: number;
    /** Injektabilno čakanje med poskusi (preverba gre brez spanja). */
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<NumberRetryResult<T>> {
  const maxAttempts = opts?.maxAttempts ?? MAX_NUMBER_ATTEMPTS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
    const number = await generate();
    try {
      const value = await attempt(number);
      return { value, attempts: attemptNo };
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'P2002') {
        lastError = err;
        if (attemptNo < maxAttempts) await sleep(20 * attemptNo);
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Številčenja ni bilo mogoče dokončati (trk ni izzvel).');
}
