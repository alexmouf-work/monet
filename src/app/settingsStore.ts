/** Persisted settings — docs/01 §9. IndexedDB via idb-keyval; the GitHub PAT in localStorage. */
import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Background, Hex } from '../core/model/types';

const KEY = 'monet.settings';
export const TOKEN_KEY = 'monet.github.token';

export interface LastDoc {
  width: number;
  height: number;
  background: Background;
}

interface Persisted {
  lastDoc: LastDoc;
  swatches: Hex[];
  recents: Hex[];
  color: Hex;
  alpha: number;
  defaultExport: string;
  autosaveSeconds: number;
}

interface SettingsState extends Persisted {
  loaded: boolean;
  load(): Promise<void>;
  setLastDoc(d: LastDoc): void;
  patch(p: Partial<Persisted>): void;
}

const DEFAULTS: Persisted = {
  lastDoc: { width: 16, height: 16, background: { mode: 'transparent', color: '#FFFFFF' } },
  swatches: [],
  recents: ['#000000'],
  color: '#000000',
  alpha: 1,
  defaultExport: 'png',
  autosaveSeconds: 30,
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  async load() {
    try {
      const stored = (await idbGet(KEY)) as Partial<Persisted> | undefined;
      if (stored) set({ ...stored });
    } catch {
      /* first run, or storage unavailable — defaults stand */
    }
    set({ loaded: true });
  },

  setLastDoc(d) {
    set({ lastDoc: d });
    schedule(get);
  },

  patch(p) {
    set(p);
    schedule(get);
  },
}));

function schedule(get: () => SettingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    const data: Persisted = {
      lastDoc: s.lastDoc,
      swatches: s.swatches,
      recents: s.recents,
      color: s.color,
      alpha: s.alpha,
      defaultExport: s.defaultExport,
      autosaveSeconds: s.autosaveSeconds,
    };
    void idbSet(KEY, data).catch(() => undefined);
  }, 400);
}

export const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const writeToken = (t: string) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked — the token simply won't persist */
  }
};
