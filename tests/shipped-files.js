// THE definition of "shipped files": what the live site serves, and what the service worker must precache.
// Used by the PRECACHE test, the deploy job's VERSION hash (plan step 6a) and the reviewer's
// "does this PR need a play review?" rule (D19). sw.js itself is excluded (it holds the list).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ROOT_FILES = ['index.html', 'manifest.webmanifest'];
const FOLDERS = ['css/', 'js/', 'games/', 'icons/'];

/**
 * Tracked files plus new, not-ignored files (so a just-created game file counts before it's committed).
 * @returns {string[]} Repo-relative paths, sorted.
 */
export function shippedFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => ROOT_FILES.includes(f) || FOLDERS.some((d) => f.startsWith(d)))
    .sort();
}

/**
 * @param {string} path  Repo-relative path.
 * @returns {boolean}
 */
export function isShipped(path) {
  return ROOT_FILES.includes(path) || FOLDERS.some((d) => path.startsWith(d)) || path === 'sw.js';
}
