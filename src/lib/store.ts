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

export type AppView = 'domov' | 'kamera' | 'kalkulatorji' | 'ponudbe' | 'katalog' | 'nastavitve';

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
