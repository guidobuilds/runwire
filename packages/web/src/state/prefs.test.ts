import { describe, expect, test } from 'vitest';
import { createPrefsStore, PREFS_STORAGE_KEY } from './prefs';

class MemoryStorage {
  #map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
}

describe('prefs store', () => {
  test('persists under the literal key scout.prefs.v1', () => {
    // A persistence contract: renaming the key silently drops every user's
    // prefs, so the literal is pinned here rather than read from the constant.
    expect(PREFS_STORAGE_KEY).toBe('scout.prefs.v1');
    const storage = new MemoryStorage();
    createPrefsStore(storage).setInclusive(false);
    const raw = storage.getItem('scout.prefs.v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? 'null')).toMatchObject({ inclusive: false });
  });

  test('toggleTray twice on different ids persists in insertion order', () => {
    const storage = new MemoryStorage();
    const store = createPrefsStore(storage);
    store.toggleTray('sess-a');
    store.toggleTray('sess-b');
    expect(store.getSnapshot().compareTray).toEqual(['sess-a', 'sess-b']);

    const fresh = createPrefsStore(storage);
    expect(fresh.getSnapshot().compareTray).toEqual(['sess-a', 'sess-b']);
  });

  test('toggling an id already in the tray removes it', () => {
    const store = createPrefsStore(new MemoryStorage());
    store.toggleTray('sess-a');
    store.toggleTray('sess-b');
    store.toggleTray('sess-a');
    expect(store.getSnapshot().compareTray).toEqual(['sess-b']);
    expect(store.isInTray('sess-a')).toBe(false);
    expect(store.isInTray('sess-b')).toBe(true);
  });

  test('a corrupt blob yields defaults and does not throw', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_STORAGE_KEY, '{not json');
    expect(() => createPrefsStore(storage)).not.toThrow();
    expect(createPrefsStore(storage).getSnapshot()).toEqual({
      inclusive: true,
      showTitles: true,
      compareTray: [],
    });
  });

  test('throwing getItem/setItem yields a working in-memory store and never throws', () => {
    const storage = {
      getItem(): string {
        throw new Error('blocked getItem');
      },
      setItem(): void {
        throw new Error('blocked setItem');
      },
    };
    expect(() => createPrefsStore(storage)).not.toThrow();
    const store = createPrefsStore(storage);
    expect(() => {
      store.setInclusive(false);
      store.setShowTitles(false);
      store.toggleTray('sess-a');
    }).not.toThrow();
    expect(store.getSnapshot()).toEqual({
      inclusive: false,
      showTitles: false,
      compareTray: ['sess-a'],
    });
  });

  test('setShowTitles(false) persists', () => {
    const storage = new MemoryStorage();
    createPrefsStore(storage).setShowTitles(false);
    expect(createPrefsStore(storage).getSnapshot().showTitles).toBe(false);
  });
});
