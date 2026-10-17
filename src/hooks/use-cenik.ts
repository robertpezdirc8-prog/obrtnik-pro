'use client';

import { useEffect, useMemo } from 'react';
import { useCenikStore, type CenikSaveResult } from '@/lib/store';
import { readCenik, type CenikReading, type CenikValues, type PriceKey } from '@/lib/cenik';

export interface Cenik {
  /** Je cenik sploh prišel na zaslon? Pred tem ni za pokazati nič denarja. */
  loaded: boolean;
  values: CenikValues;
  /** Vpisanost cene PO KLJUČU — `problem` pove, kaj točno manjka. */
  readings: Partial<Record<PriceKey, CenikReading>>;
  /** Vpisana cena ključa ali null — nikoli 0 in nikoli prejšnja vrednost. */
  priceOf: (key: PriceKey) => number | null;
  save: (patch: Partial<Record<PriceKey, number | null>>) => Promise<CenikSaveResult>;
}

/**
 * Cenik je edini vir cen. Prejšnje različice (kalkulatorji, katalog, kamera,
 * vizualizacija, PDF) so imele številke zapisane v kodi — obrtnik jih ni mogel
 * popraviti, ponudba pa je tekla po njih (Task 88).
 *
 * Dokler odgovor ni prispel, `priceOf` vrne null in vsak nosilec cene izpusti
 * vrstico z razlogom namesto z izmišljeno številko.
 */
export function useCenik(): Cenik {
  const loaded = useCenikStore((s) => s.loaded);
  const values = useCenikStore((s) => s.values);
  const load = useCenikStore((s) => s.load);
  const save = useCenikStore((s) => s.save);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const readings = useMemo(() => readCenik(values), [values]);

  return {
    loaded,
    values,
    readings,
    priceOf: (key) => {
      const r = readings[key];
      return r && r.problem === null ? r.value : null;
    },
    save,
  };
}
