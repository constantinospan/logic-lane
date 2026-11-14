// Prepares the folder that GitHub Pages serves (D16). This is not a build step: it copies the shipped files
// unchanged and writes one value, VERSION in sw.js, as a hash of what ships. A docs-only change keeps the same
// hash (no update banner); any shipped change, or a revert, gets a new one.
// Usage: node tools/build-site.mjs <out-dir>

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_LINE = "const VERSION = 'dev';";

/**
 * The hash of everything that ships: each file's path and contents, plus sw.js with VERSION left as 'dev'.
 * @param {string} root  Folder the paths are relative to.
 * @param {string[]} files  Shipped files (repo-relative, without sw.js).
 * @returns {string} 12 hex characters.
 */
export function siteVersion(root, files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort().concat('sw.js')) {
    // NUL bytes separate fields, so moving bytes between a path and its contents changes the hash.
    hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * sw.js with VERSION set. Throws unless the 'dev' line appears exactly once.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 */
export function stampSw(text, version) {
  const count = text.split(VERSION_LINE).length - 1;
  if (count !== 1) throw new Error(`sw.js must contain "${VERSION_LINE}" exactly once (found ${count})`);
  return text.replace(VERSION_LINE, `const VERSION = '${version}';`);
}

/**
 * Copies the shipped files and the stamped sw.js into outDir (which must not exist yet).
 * @param {string} root
 * @param {string[]} files
 * @param {string} outDir
 * @returns {string} The version written into sw.js.
 */
export function buildSite(root, files, outDir) {
  if (fs.existsSync(outDir)) throw new Error(`${outDir} already exists`);
  const version = siteVersion(root, files);
  for (const file of files) {
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sw.js'), stampSw(sw, version));
  return version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('Usage: node tools/build-site.mjs <out-dir>');
  const { REPO_ROOT, shippedFiles } = await import('../tests/shipped-files.js');
  const version = buildSite(REPO_ROOT, shippedFiles(), path.resolve(outDir));
  console.log(version);
}
