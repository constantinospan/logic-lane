// The deploy's only preparation step (tools/build-site.mjs): copy what ships, stamp VERSION in sw.js (D16).
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite, siteVersion, stampSw } from '../../tools/build-site.mjs';
import { precacheList, REPO_ROOT, shippedFiles } from '../shipped-files.js';

const SW = "// sw\nconst VERSION = 'dev';\nconst CACHE = `logic-lane:${VERSION}`;\n";

/** @type {string[]} */
const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-lane-build-'));
  temps.push(dir);
  return dir;
}

/** A small fake repo. @param {Record<string, string>} [overrides] */
function fakeRepo(overrides = {}) {
  const root = tempDir();
  /** @type {Record<string, string>} */
  const files = {
    'index.html': '<h1>hi</h1>',
    'js/app.js': 'console.log(1);',
    'docs/NOTES.md': 'not shipped',
    'sw.js': SW,
    ...overrides,
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const SHIPPED = ['index.html', 'js/app.js'];

/** Every file under dir, repo-relative, sorted. @param {string} dir */
function listFiles(dir) {
  return /** @type {string[]} */ (fs.readdirSync(dir, { recursive: true }))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => f.split(path.sep).join('/'))
    .sort();
}

describe('buildSite', () => {
  it('copies exactly the shipped files plus sw.js, unchanged', () => {
    const root = fakeRepo();
    const out = path.join(tempDir(), 'site');
    buildSite(root, SHIPPED, out);
    expect(listFiles(out)).toEqual(['index.html', 'js/app.js', 'sw.js']);
    expect(fs.readFileSync(path.join(out, 'js/app.js'), 'utf8')).toBe('console.log(1);');
  });

  it('stamps VERSION with a 12-character hash and leaves the rest of sw.js as it was', () => {
    const root = fakeRepo();
    const out = path.join(tempDir(), 'site');
    const version = buildSite(root, SHIPPED, out);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(siteVersion(root, SHIPPED));
    expect(fs.readFileSync(path.join(out, 'sw.js'), 'utf8')).toBe(SW.replace("'dev'", `'${version}'`));
  });

  it('refuses to write into a folder that already exists', () => {
    const root = fakeRepo();
    expect(() => buildSite(root, SHIPPED, tempDir())).toThrow(/already exists/);
  });

  it('on the real repo, every PRECACHE entry exists in the built site (offline install cannot fail)', () => {
    const out = path.join(tempDir(), 'site');
    const version = buildSite(REPO_ROOT, shippedFiles(), out);
    for (const entry of precacheList()) {
      expect(fs.existsSync(path.join(out, entry || 'index.html')), entry).toBe(true);
    }
    const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    expect(sw).toContain(`const VERSION = '${version}';`);
    expect(sw).not.toContain("const VERSION = 'dev';");
    expect(listFiles(out).some((f) => /^(docs|tests|tools|node_modules)\/|package/.test(f))).toBe(false);
  });
});

describe('command line (what the deploy job runs)', () => {
  it('builds the real site and prints the version it stamped', () => {
    const out = path.join(tempDir(), 'site');
    const printed = execFileSync('node', ['tools/build-site.mjs', out], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(printed).toBe(siteVersion(REPO_ROOT, shippedFiles()));
    expect(fs.readFileSync(path.join(out, 'sw.js'), 'utf8')).toContain(`const VERSION = '${printed}';`);
  });
});

describe('siteVersion', () => {
  it('is the same for the same files', () => {
    expect(siteVersion(fakeRepo(), SHIPPED)).toBe(siteVersion(fakeRepo(), SHIPPED));
  });

  it('does not depend on the order files are listed in', () => {
    const root = fakeRepo();
    expect(siteVersion(root, [...SHIPPED].reverse())).toBe(siteVersion(root, SHIPPED));
  });

  it('changes when a shipped file changes', () => {
    expect(siteVersion(fakeRepo({ 'js/app.js': 'console.log(2);' }), SHIPPED)).not.toBe(
      siteVersion(fakeRepo(), SHIPPED),
    );
  });

  it('changes when sw.js changes', () => {
    expect(siteVersion(fakeRepo({ 'sw.js': `${SW}// more\n` }), SHIPPED)).not.toBe(siteVersion(fakeRepo(), SHIPPED));
  });

  it('stays the same when only a doc changes (no update banner for docs-only changes)', () => {
    expect(siteVersion(fakeRepo({ 'docs/NOTES.md': 'edited' }), SHIPPED)).toBe(siteVersion(fakeRepo(), SHIPPED));
  });

  it('changes when a file is renamed, even with the same contents', () => {
    const a = fakeRepo({ 'js/app.js': 'x' });
    const b = fakeRepo({ 'js/app2.js': 'x' });
    expect(siteVersion(a, ['index.html', 'js/app.js'])).not.toBe(siteVersion(b, ['index.html', 'js/app2.js']));
  });

  it('keeps file names and contents apart (moving bytes between them changes the hash)', () => {
    const a = fakeRepo({ ab: 'c' });
    const b = fakeRepo({ a: 'bc' });
    expect(siteVersion(a, ['ab'])).not.toBe(siteVersion(b, ['a']));
  });
});

describe('stampSw', () => {
  it('replaces the dev VERSION line', () => {
    expect(stampSw(SW, 'abc123abc123')).toContain("const VERSION = 'abc123abc123';");
  });

  it('fails loudly if the VERSION line is missing', () => {
    expect(() => stampSw("const VERSION = 'x';", 'v')).toThrow(/exactly once \(found 0\)/);
  });

  it('fails loudly if the VERSION line appears twice', () => {
    expect(() => stampSw(SW + SW, 'v')).toThrow(/exactly once \(found 2\)/);
  });
});
