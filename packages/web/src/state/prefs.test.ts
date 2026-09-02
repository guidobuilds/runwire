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
      showAutomated: false,
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
      store.setShowAutomated(true);
      store.toggleTray('sess-a');
    }).not.toThrow();
    expect(store.getSnapshot()).toEqual({
      inclusive: false,
      showTitles: false,
      showAutomated: true,
      compareTray: ['sess-a'],
    });
  });

  test('setShowTitles(false) persists', () => {
    const storage = new MemoryStorage();
    createPrefsStore(storage).setShowTitles(false);
    expect(createPrefsStore(storage).getSnapshot().showTitles).toBe(false);
  });

  describe('showAutomated', () => {
    test('defaults to false: machine-initiated sessions are hidden until asked for', () => {
      // The one behavioral default this whole feature turns on. An empty
      // storage, a storage that throws and a corrupt blob must all agree.
      expect(createPrefsStore(new MemoryStorage()).getSnapshot().showAutomated).toBe(false);
    });

    test('setShowAutomated(true) persists across a reload', () => {
      const storage = new MemoryStorage();
      createPrefsStore(storage).setShowAutomated(true);
      expect(JSON.parse(storage.getItem(PREFS_STORAGE_KEY) ?? 'null')).toMatchObject({
        showAutomated: true,
      });
      // A second store reading the same storage is what a page reload is.
      expect(createPrefsStore(storage).getSnapshot().showAutomated).toBe(true);
    });

    test('a blob written before this field existed is read, not discarded', () => {
      // Zero-migration claim: `mergePrefs` is tolerant field by field, so an
      // existing user's inclusive/showTitles/compareTray survive untouched and
      // only the new key falls back to its default.
      const storage = new MemoryStorage();
      storage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({ inclusive: false, showTitles: false, compareTray: ['sess-a'] }),
      );
      expect(createPrefsStore(storage).getSnapshot()).toEqual({
        inclusive: false,
        showTitles: false,
        showAutomated: false,
        compareTray: ['sess-a'],
      });
    });

    test('a non-boolean value falls back to the default rather than being coerced', () => {
      const storage = new MemoryStorage();
      storage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ showAutomated: 'yes' }));
      expect(createPrefsStore(storage).getSnapshot().showAutomated).toBe(false);
    });

    test('subscribers are notified, and a no-op set does not notify', () => {
      const store = createPrefsStore(new MemoryStorage());
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });
      store.setShowAutomated(false); // already false
      expect(notifications).toBe(0);
      store.setShowAutomated(true);
      expect(notifications).toBe(1);
    });
  });
});
