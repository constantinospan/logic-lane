// The ONLY module that touches localStorage (CLAUDE.md, D7).
// One resume slot: the game in progress. It survives refresh, app swipe-away and the tablet killing the app,
// and expires 3 hours after the last save. Every key is prefixed, because all of this account's
// *.github.io sites share one origin (D16).

export const PREFIX = 'logic-lane:';
export const RESUME_KEY = `${PREFIX}resume`;
export const RESUME_WINDOW_MS = 3 * 60 * 60 * 1000;

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

/** @returns {Backend | null} */
function browserBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? ''),
    };
  } catch {
    return null; // Storage blocked (private mode, settings): the game still works, just without resume.
  }
}

/**
 * @param {{ backend?: Backend | null, now?: () => number }} [options]  Injectable for tests.
 */
export function createStore(options = {}) {
  const backend = options.backend === undefined ? browserBackend() : options.backend;
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
      if (!backend) return;
      safely(() => backend.setItem(RESUME_KEY, JSON.stringify({ ...record, savedAt: now() })));
    },

    /**
     * The saved game, if it's fresh and its game version still matches. Otherwise null (and the stale save
     * is removed).
     * @param {(gameId: string) => number | undefined} versionOf  Current version of a game, or undefined if
     *   the game no longer exists.
     * @returns {ResumeRecord | null}
     */
    load(versionOf) {
      if (!backend) return null;
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
      if (backend) safely(() => backend.removeItem(RESUME_KEY));
    },

    /** Emergency reset: removes every logic-lane key, and nothing else. */
    clearAll() {
      if (!backend) return;
      safely(() => {
        for (const key of backend.keys()) if (key.startsWith(PREFIX)) backend.removeItem(key);
      });
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
