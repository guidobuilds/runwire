import { useSyncExternalStore } from 'react';

export const PREFS_STORAGE_KEY = 'scout.prefs.v1';

export type Prefs = {
  inclusive: boolean;
  showTitles: boolean;
  /**
   * Whether machine-initiated sessions (SDK, CI, agent dispatch) appear in
   * lists, counts and rollups. **Default off**: the great majority of a real
   * `~/.claude/projects` is automation, so the honest default view is the work
   * a person actually started.
   *
   * This is a display *preference*, not a toolbar filter, and the difference is
   * deliberate: it is global (one setting, every screen), it persists, and
   * "Clear filters" does not touch it — clearing filters must always reveal
   * more rows, never hide them. It follows `showTitles`, the existing global
   * pref that also changes what the table shows, rather than inventing a
   * second pattern.
   *
   * Unlike the toolbar filters this one is applied SERVER-side (`?automated=`
   * on the list/aggregate routes), because it has to move the aggregates too —
   * a hidden session must not contribute to a project's token total.
   */
  showAutomated: boolean;
  compareTray: string[];
};

const DEFAULTS: Prefs = {
  inclusive: true,
  showTitles: true,
  showAutomated: false,
  compareTray: [],
};

export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function copyPrefs(prefs: Prefs): Prefs {
  return {
    inclusive: prefs.inclusive,
    showTitles: prefs.showTitles,
    showAutomated: prefs.showAutomated,
    compareTray: [...prefs.compareTray],
  };
}

function mergePrefs(partial: unknown): Prefs {
  if (typeof partial !== 'object' || partial === null) {
    return copyPrefs(DEFAULTS);
  }
  const rec = partial as Record<string, unknown>;
  return {
    inclusive: typeof rec.inclusive === 'boolean' ? rec.inclusive : DEFAULTS.inclusive,
    showTitles: typeof rec.showTitles === 'boolean' ? rec.showTitles : DEFAULTS.showTitles,
    // Field-by-field tolerance is what makes adding a key a zero-migration
    // change: every `scout.prefs.v1` blob written before this field existed
    // simply falls back to the default here.
    showAutomated:
      typeof rec.showAutomated === 'boolean' ? rec.showAutomated : DEFAULTS.showAutomated,
    compareTray: Array.isArray(rec.compareTray)
      ? rec.compareTray.filter((id): id is string => typeof id === 'string')
      : [...DEFAULTS.compareTray],
  };
}

function readPrefs(storage: PrefsStorage | undefined): Prefs {
  if (!storage) return copyPrefs(DEFAULTS);
  let raw: string | null;
  try {
    raw = storage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return copyPrefs(DEFAULTS);
  }
  if (!raw) return copyPrefs(DEFAULTS);
  try {
    return mergePrefs(JSON.parse(raw) as unknown);
  } catch {
    return copyPrefs(DEFAULTS);
  }
}

function writePrefs(storage: PrefsStorage | undefined, prefs: Prefs): void {
  if (!storage) return;
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / quota / tests with throwing storage: keep working in memory.
  }
}

function resolveStorage(storage?: PrefsStorage): PrefsStorage | undefined {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

export function createPrefsStore(storage?: PrefsStorage) {
  const resolved = resolveStorage(storage);
  let snapshot = readPrefs(resolved);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const commit = (next: Prefs): void => {
    snapshot = next;
    writePrefs(resolved, snapshot);
    notify();
  };

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== PREFS_STORAGE_KEY && event.key !== null) return;
    snapshot = readPrefs(resolved);
    notify();
  };

  try {
    if (
      typeof window !== 'undefined' &&
      resolved &&
      'localStorage' in window &&
      resolved === window.localStorage
    ) {
      window.addEventListener('storage', onStorage);
    }
  } catch {
    // Cross-tab sync is optional; a missing window/localStorage must not throw.
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): Prefs {
      return snapshot;
    },
    setInclusive(value: boolean): void {
      if (snapshot.inclusive === value) return;
      commit({ ...snapshot, inclusive: value });
    },
    setShowTitles(value: boolean): void {
      if (snapshot.showTitles === value) return;
      commit({ ...snapshot, showTitles: value });
    },
    setShowAutomated(value: boolean): void {
      if (snapshot.showAutomated === value) return;
      commit({ ...snapshot, showAutomated: value });
    },
    toggleTray(id: string): void {
      const idx = snapshot.compareTray.indexOf(id);
      const compareTray =
        idx === -1
          ? [...snapshot.compareTray, id]
          : snapshot.compareTray.filter((existing) => existing !== id);
      commit({ ...snapshot, compareTray });
    },
    setTray(ids: string[]): void {
      commit({ ...snapshot, compareTray: [...ids] });
    },
    clearTray(): void {
      if (snapshot.compareTray.length === 0) return;
      commit({ ...snapshot, compareTray: [] });
    },
    isInTray(id: string): boolean {
      return snapshot.compareTray.includes(id);
    },
  };
}

export type PrefsStore = ReturnType<typeof createPrefsStore>;

const defaultStore = createPrefsStore();

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    defaultStore.subscribe,
    defaultStore.getSnapshot,
    defaultStore.getSnapshot,
  );
}

export function setInclusive(value: boolean): void {
  defaultStore.setInclusive(value);
}

export function setShowTitles(value: boolean): void {
  defaultStore.setShowTitles(value);
}

export function setShowAutomated(value: boolean): void {
  defaultStore.setShowAutomated(value);
}

export function toggleTray(id: string): void {
  defaultStore.toggleTray(id);
}

export function setTray(ids: string[]): void {
  defaultStore.setTray(ids);
}

export function clearTray(): void {
  defaultStore.clearTray();
}

export function isInTray(id: string): boolean {
  return defaultStore.isInTray(id);
}
