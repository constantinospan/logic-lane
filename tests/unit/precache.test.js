import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { precacheList, REPO_ROOT, shippedFiles } from '../shipped-files.js';

const sw = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
const precache = precacheList();

describe('service worker', () => {
  it('precaches exactly the shipped files (so everything works offline)', () => {
    expect(precache).toContain(''); // './' (the start page)
    expect(precache.filter(Boolean).sort()).toEqual(shippedFiles());
  });

  it('keeps VERSION as "dev" in the repo (deploy stamps it)', () => {
    expect(sw).toMatch(/^const VERSION = 'dev';$/m);
  });

  it('names its caches with the logic-lane: prefix', () => {
    expect(sw).toMatch(/const PREFIX = 'logic-lane:';/);
    expect(sw).toMatch(/const CACHE = `\$\{PREFIX\}\$\{VERSION\}`;/);
  });
});
