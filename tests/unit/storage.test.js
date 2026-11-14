import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, RESUME_KEY, RESUME_WINDOW_MS } from '../../js/core/storage.js';

/** In-memory stand-in for localStorage. */
function memoryBackend() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

const record = { gameId: 'demo', gameVersion: 1, level: 3, n: 1, seed: 'aaaaaa', state: { wrong: 2 }, active: true };
const versionOf = (id) => (id === 'demo' ? 1 : undefined);

describe('storage', () => {
  it('resumes for 3 hours, as decided (D7)', () => {
    expect(RESUME_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
  });

  let backend, now, store;
  beforeEach(() => {
    backend = memoryBackend();
    now = 1_000_000_000;
    store = createStore({ backend, now: () => now });
  });

  it('resumes a fresh save', () => {
    store.save(record);
    expect(store.load(versionOf)).toMatchObject({ level: 3, seed: 'aaaaaa', state: { wrong: 2 } });
  });

  it('only ever writes keys starting with logic-lane:', () => {
    store.save(record);
    expect([...backend.map.keys()]).toEqual([RESUME_KEY]);
    expect(RESUME_KEY.startsWith('logic-lane:')).toBe(true);
  });

  it('resumes just inside 3 hours and expires at exactly 3 hours', () => {
    store.save(record);
    now += RESUME_WINDOW_MS - 1;
    expect(store.load(versionOf)).not.toBeNull();
    store.save(record);
    now += RESUME_WINDOW_MS;
    expect(store.load(versionOf)).toBeNull();
    expect(backend.map.has(RESUME_KEY)).toBe(false);
  });

  it('treats a save from more than 60 s in the future (clock moved back) as stale', () => {
    store.save(record);
    now -= 61_000;
    expect(store.load(versionOf)).toBeNull();
  });

  it('drops the save when the game version changed or the game is gone', () => {
    store.save(record);
    expect(store.load(() => 2)).toBeNull();
    store.save(record);
    expect(store.load(() => undefined)).toBeNull();
  });

  it('ignores a corrupt save', () => {
    backend.map.set(RESUME_KEY, '{not json');
    expect(store.load(versionOf)).toBeNull();
  });

  it('returns nothing when nothing was saved', () => {
    expect(store.load(versionOf)).toBeNull();
  });

  it('without browser storage, falls back to memory so she can still play', () => {
    const blocked = createStore({ backend: null });
    blocked.save(record);
    expect(blocked.load(versionOf)).toMatchObject({ level: 3 });
    blocked.clearAll();
    expect(blocked.load(versionOf)).toBeNull();
  });

  it('when storage fails mid-game (e.g. full), keeps going from memory and never throws', () => {
    const failing = createStore({
      backend: { ...memoryBackend(), setItem: () => { throw new Error('QuotaExceededError'); } },
    });
    expect(() => failing.save(record)).not.toThrow();
    expect(failing.load(versionOf)).toMatchObject({ level: 3 });
  });

  it('never throws when removing fails', () => {
    const broken = createStore({
      backend: { ...memoryBackend(), removeItem: () => { throw new Error('nope'); }, keys: () => { throw new Error('nope'); } },
    });
    expect(() => broken.clear()).not.toThrow();
    expect(() => broken.clearAll()).not.toThrow();
  });

  it('clearAll removes only logic-lane keys', () => {
    backend.map.set('other-site:key', 'keep me');
    backend.map.set('logic-lane:something-else', 'x');
    store.save(record);
    store.clearAll();
    expect([...backend.map.keys()]).toEqual(['other-site:key']);
  });
});
