'use client';

import { useEffect, useState } from 'react';
import { readSettings } from '@/lib/settings-inputs';

export interface LaborRate {
  /** So nastavitve sploh prišle na zaslon? Pred tem ni za pokazati cene. */
  loaded: boolean;
  /** Nastavljena urna postavka; NaN, dokler ni prebrana veljavna. */
  value: number;
  /** Razlog, zakaj cena dela ni izračunana (null = postavka je veljavna). */
  problem: ReturnType<typeof readSettings>['laborRate']['problem'];
}

/**
 * Urna postavka dela je edini vir cene dela in sme priti SAMO iz Nastavitev.
 *
 * Prejšnje različice (kalkulatorji, kamera, vizualizacija, povzetek projekta)
 * so imele v kodi zapisano `35` — aplikacija je obrtniku natisnila uro, ki
 * je ni nastavil, ponudba pa je tekla po njej (Task 86). Vrača NaN, dokler
 * nastavitve niso veljavne, zato vsaki nosilec cene dela izpusti z razlogom
 * namesto z izmišljeno številko.
 */
export function useLaborRate(): LaborRate {
  const [raw, setRaw] = useState(Number.NaN);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setRaw(d.settings?.laborRate ?? Number.NaN))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const delo = readSettings({ laborRate: raw }).laborRate;
  return { loaded, value: delo.value, problem: delo.problem };
}
