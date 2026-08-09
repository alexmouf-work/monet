/** Autosave loop — docs/07 §9. Every dirty document snapshots to IndexedDB. */
import { putAutosave } from '../integrations/idb';
import { useDocStore } from './docStore';
import { useSettingsStore } from './settingsStore';

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutosave(): () => void {
  stopAutosave();
  const seconds = useSettingsStore.getState().autosaveSeconds || 30;
  timer = setInterval(() => void tick(), seconds * 1000);
  return stopAutosave;
}

export function stopAutosave(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const { docs } = useDocStore.getState();
  for (const doc of Object.values(docs)) {
    if (!doc.dirty) continue;
    try {
      await putAutosave(doc);
    } catch {
      // Storage full or blocked — autosave is best-effort and must never break editing.
    }
  }
}

/** Force a snapshot now (used before unload). */
export const autosaveNow = tick;
