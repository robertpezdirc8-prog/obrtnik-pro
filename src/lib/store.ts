'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DraftItem } from './types';
import type { CameraPrefill } from './camera-types';

// ─── Osnutek ponudbe (traja tudi po osvežitvi) ──────────────

interface DraftState {
  items: DraftItem[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  objectAddress: string;
  note: string;
  addItem: (item: DraftItem) => void;
  addItems: (items: DraftItem[]) => void;
  removeItem: (key: string) => void;
  updateItem: (key: string, patch: Partial<DraftItem>) => void;
  setCustomer: (patch: Partial<Pick<DraftState, 'customerName' | 'customerEmail' | 'customerPhone' | 'customerAddress' | 'objectAddress' | 'note'>>) => void;
  clearDraft: () => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set) => ({
      items: [],
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      customerAddress: '',
      objectAddress: '',
      note: '',
      addItem: (item) =>
        set((s) => ({
          items: [...s.items.filter((i) => i.key !== item.key), item],
        })),
      addItems: (newItems) =>
        set((s) => {
          const keys = new Set(newItems.map((i) => i.key));
          return { items: [...s.items.filter((i) => !keys.has(i.key)), ...newItems] };
        }),
      removeItem: (key) =>
        set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      updateItem: (key, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.key === key ? { ...i, ...patch } : i)),
        })),
      setCustomer: (patch) => set((s) => ({ ...s, ...patch })),
      clearDraft: () =>
        set((s) => ({
          items: [],
          customerName: '',
          customerEmail: '',
          customerPhone: '',
          customerAddress: '',
          objectAddress: '',
          note: '',
        })),
    }),
    { name: 'obrtnik-draft' },
  ),
);

// ─── Aktivni zavihek aplikacije ─────────────────────────────

export type AppView = 'domov' | 'kamera' | 'kalkulatorji' | 'ponudbe' | 'katalog' | 'časovnica' | 'nastavitve';

interface ViewState {
  view: AppView;
  activeCraft: string | null; // slug dejavnosti v kalkulatorjih
  /** Predpolnitve iz pametne kamere za kalkulator. */
  cameraPrefill: CameraPrefill | null;
  setView: (v: AppView) => void;
  setActiveCraft: (c: string | null) => void;
  setCameraPrefill: (p: CameraPrefill | null) => void;
}

export const useView = create<ViewState>()((set) => ({
  view: 'domov',
  activeCraft: null,
  cameraPrefill: null,
  setView: (view) => set({ view }),
  setActiveCraft: (activeCraft) => set({ activeCraft }),
  setCameraPrefill: (cameraPrefill) => set({ cameraPrefill }),
}));

// ─── Terenski način (rokavice + sonce) ──────────────────────
// Veliki gumbi (≥ 48 px), večja pisava in močan kontrast.
// Shranjeno v brskalniku (persist).

interface FieldModeState {
  enabled: boolean;
  set: (v: boolean) => void;
  toggle: () => void;
}

export const useFieldMode = create<FieldModeState>()(
  persist(
    (set) => ({
      enabled: false,
      set: (v) => set({ enabled: v }),
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: 'obrtnik-field-mode' },
  ),
);

// ─── Dodatna dela (change orders) po ponudbah ────────────────
// Raziskava (clearstory, bakertilly): »no additional work proceeds
// without a fully executed change order« — brez zapisa dodatno
// delo izgine v papirjih in sproži spore. Številčenje je
// deterministično iz št. ponudbe (glej lib/paperwork.ts).

export interface ChangeOrderEntry {
  id: string;
  /** Št. dokumenta, npr. "2026-001-D1". */
  docNumber: string;
  date: string;
  description: string;
  /** Vrednost brez DDV. */
  amount: number;
  vatRate: number;
}

interface ChangeOrdersState {
  byOffer: Record<string, ChangeOrderEntry[]>;
  add: (offerId: string, entry: ChangeOrderEntry) => void;
  remove: (offerId: string, entryId: string) => void;
}

export const useChangeOrders = create<ChangeOrdersState>()(
  persist(
    (set) => ({
      byOffer: {},
      add: (offerId, entry) =>
        set((s) => ({
          byOffer: { ...s.byOffer, [offerId]: [...(s.byOffer[offerId] ?? []), entry] },
        })),
      remove: (offerId, entryId) =>
        set((s) => ({
          byOffer: {
            ...s.byOffer,
            [offerId]: (s.byOffer[offerId] ?? []).filter((e) => e.id !== entryId),
          },
        })),
    }),
    { name: 'obrtnik-change-orders' },
  ),
);

// ─── Časomer časovnice (Zeiterfassung) ──────────────
// Zagnan časomer preživi reload (persist) — na gradbišču se
// stran lahko osveži, delo pa teče naprej. Ura je strežniško
// nevtralna: shranjen je samo začetni ISO čas, minute se izračunajo
// ob ustavitvi.

interface TimerState {
  startedAt: string | null;
  label: string;
  start: () => void;
  setLabel: (l: string) => void;
  stop: () => string | null; // vrne ISO začetka in počisti stanje
  reset: () => void;
}

export const useTimer = create<TimerState>()(
  persist(
    (set, get) => ({
      startedAt: null,
      label: '',
      start: () => set({ startedAt: new Date().toISOString() }),
      setLabel: (label) => set({ label }),
      stop: () => {
        const startedAt = get().startedAt;
        set({ startedAt: null });
        return startedAt;
      },
      reset: () => set({ startedAt: null, label: '' }),
    }),
    { name: 'obrtnik-casomer' },
  ),
);

// ─── Sklad ostankov materiala ───────────────────────────────
// Monterji ostanke profilov in desk vozijo po kombiju in jih
// pozabijo. Sklad jih shrani (persist) in skripta matchLeftovers
// pove, kateri kosi prihodnjega načrta jih pokrijejo.

export interface LeftoverEntry {
  id: string;
  craft: string;
  lengthM: number;
  /** Št. enakih kosov (privzeto 1) — enaki ostanki se grupirajo. */
  count?: number;
  label: string;
  createdAt: string;
}

interface LeftoversState {
  items: LeftoverEntry[];
  add: (entries: LeftoverEntry[]) => void;
  remove: (id: string) => void;
  clearCraft: (craft: string) => void;
}

export const useLeftovers = create<LeftoversState>()(
  persist(
    (set) => ({
      items: [],
      add: (entries) => set((s) => ({ items: [...s.items, ...entries] })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clearCraft: (craft) => set((s) => ({ items: s.items.filter((i) => i.craft !== craft) })),
    }),
    { name: 'obrtnik-ostanki' },
  ),
);
