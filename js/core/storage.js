// The ONLY module that touches localStorage (CLAUDE.md, D7).
// If storage is blocked or full (e.g. Safari "Block All Cookies"), it falls back to memory: she can always play,
// she just loses resume when the page reloads.
// One resume slot: the game in progress. It survives refresh, app swipe-away and the tablet killing the app,
// and expires 3 hours after the last save. Every key is prefixed, because all of this account's
// *.github.io sites share one origin (D16).

export const PREFIX = 'logic-lane:';
export const RESUME_KEY = `${PREFIX}resume`;
export const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * @typedef {object} ResumeRecord
 * @property {string} gameId
 * @property {number} gameVersion  The game's `version` when saved; a different version drops the save.
 * @property {number} level
 * @property {number} n  Which puzzle within the level (0-based; keeps counting at the endless top).
 * @property {string} seed
 * @property {unknown} state  Game-specific progress inside the current puzzle, or null.
 * @property {boolean} active  True while she's on the play screen; startup only jumps back in when true.
 * @property {number} [savedAt]  Set by save().
 */

/**
 * @typedef {object} Backend
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 * @property {() => string[]} keys
 */

/**
 * Storage that only lasts until the page reloads. Used when the browser won't let us save.
 * @returns {Backend}
 */
export function memoryBackend() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

/** @returns {Backend | null} null if localStorage is missing or blocked. (A full store is handled in save.) */
function browserBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    ls.getItem(RESUME_KEY); // throws when blocked; a read, so a full-but-readable store still resumes
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k) => k !== null),
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ backend?: Backend | null, now?: () => number }} [options]  Injectable for tests. `backend: null` means
 *   "no usable browser storage", which falls back to memory.
 */
export function createStore(options = {}) {
  let backend = (options.backend === undefined ? browserBackend() : options.backend) ?? memoryBackend();
  const now = options.now ?? (() => Date.now());

  /** @param {() => void} fn */
  const safely = (fn) => {
    try {
      fn();
    } catch {
      /* quota or blocked storage: ignore, never crash the game */
    }
  };

  return {
    /** @param {ResumeRecord} record */
    save(record) {
      const value = JSON.stringify({ ...record, savedAt: now() });
      try {
        backend.setItem(RESUME_KEY, value);
      } catch {
        // Storage is full or blocked: drop the old real save (so it can't come back later and jump her into an
        // old puzzle), then keep playing from memory.
        const old = backend;
        safely(() => old.removeItem(RESUME_KEY));
        backend = memoryBackend();
        backend.setItem(RESUME_KEY, value);
      }
    },

    /**
     * The saved game, if it's fresh and its game version still matches. Otherwise null (and the stale save
     * is removed).
     * @param {(gameId: string) => number | undefined} versionOf  Current version of a game, or undefined if
     *   the game no longer exists.
     * @returns {ResumeRecord | null}
     */
    load(versionOf) {
      /** @type {ResumeRecord | null} */
      let record = null;
      try {
        record = JSON.parse(backend.getItem(RESUME_KEY) ?? 'null');
      } catch {
        record = null;
      }
      const fresh =
        record !== null &&
        typeof record === 'object' &&
        typeof record.savedAt === 'number' &&
        now() - record.savedAt < RESUME_WINDOW_MS &&
        record.savedAt <= now() + 60_000 && // clock moved backwards a lot: treat as stale
        versionOf(record.gameId) === record.gameVersion;
      if (!fresh) {
        safely(() => backend.removeItem(RESUME_KEY));
        return null;
      }
      return record;
    },

    clear() {
      safely(() => backend.removeItem(RESUME_KEY));
    },

    /** Emergency reset: removes every logic-lane key, and nothing else. */
    clearAll() {
      safely(() => {
        for (const key of backend.keys()) if (key.startsWith(PREFIX)) backend.removeItem(key);
      });
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
