// Edge cases of the shared core that the main unit tests don't reach.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findGame, GAMES, versionOf } from '../../js/core/games.js';
import { newSeed } from '../../js/core/rng.js';
import { createStore, RESUME_KEY } from '../../js/core/storage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('games registry helpers', () => {
  it('finds games and their versions by id', () => {
    const first = GAMES[0];
    expect(findGame(first.id)).toBe(first);
    expect(versionOf(first.id)).toBe(first.version);
    expect(findGame('no-such-game')).toBeUndefined();
    expect(versionOf('no-such-game')).toBeUndefined();
  });
});

describe('seeds without crypto', () => {
  it('still makes valid seeds when crypto.getRandomValues is missing', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newSeed()).toMatch(/^[0-9a-z]{6}$/);
  });
});

/** A fake window.localStorage. */
function fakeLocalStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const record = { gameId: 'demo', gameVersion: 1, level: 2, n: 0, seed: 'abcdef', state: null, active: true };

describe('storage with the real localStorage adapter', () => {
  it('saves, loads, clears and clearAll through window.localStorage', () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    ls.setItem('other-site:x', '1');
    const store = createStore();
    store.save(record);
    expect(ls.map.has(RESUME_KEY)).toBe(true);
    expect(store.load(() => 1)).toMatchObject({ level: 2 });
    store.clear();
    expect(ls.map.has(RESUME_KEY)).toBe(false);
    store.save(record);
    store.clearAll();
    expect([...ls.map.keys()]).toEqual(['other-site:x']);
  });

  it('falls back to memory when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = createStore();
    store.save(record);
    expect(store.load(() => 1)).toMatchObject({ level: 2 });
    store.clear();
    expect(store.load(() => 1)).toBeNull();
  });

  it('falls back to memory when accessing localStorage throws (e.g. Safari "Block All Cookies")', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const store = createStore();
      store.save(record);
      expect(store.load(() => 1)).toMatchObject({ level: 2 });
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });

  it('falls back to memory when localStorage is full from the start', () => {
    const ls = fakeLocalStorage();
    ls.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    vi.stubGlobal('localStorage', ls);
    const store = createStore();
    store.save(record);
    expect(store.load(() => 1)).toMatchObject({ level: 2 });
  });

  it('switches to memory when localStorage fills up mid-game', () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const store = createStore(); // probe succeeds
    ls.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    store.save(record);
    expect(store.load(() => 1)).toMatchObject({ level: 2 });
  });

  it('ignores a save that is not an object', () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    ls.setItem(RESUME_KEY, '42');
    expect(createStore().load(() => 1)).toBeNull();
  });
});
