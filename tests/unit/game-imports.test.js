// Games never use each other's files (D20). CI relies on this: a PR that changes one game leaves out the other games'
// browser tests, which is only safe if no other game can be broken by it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IDS = fs.readdirSync(path.join(ROOT, 'games'), { withFileTypes: true }).filter((d) => d.isDirectory())
  .map((d) => d.name);

/**
 * Every relative path a file imports: `import … from '…'`, `import('…')` (also in JSDoc types) and `export … from`.
 * Not caught (none are used today): `new URL('…', import.meta.url)`, imports built from template strings, and an
 * `import` that follows other code on the same line.
 * @param {string} text
 * @returns {string[]}
 */
export function importsOf(text) {
  const found = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  return found.filter((s) => s.startsWith('.'));
}

/**
 * Which game folder a path is in, or undefined.
 * @param {string} abs
 * @returns {string | undefined}
 */
function gameFolder(abs) {
  const rel = path.relative(path.join(ROOT, 'games'), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep)[0];
}

/** @param {string} dir @returns {string[]} every .js file under dir */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js')).map((d) => path.join(d.parentPath, d.name));
}

/**
 * Files that belong to a game: its folder, its unit test and its browser test.
 * @param {string} id
 * @returns {string[]}
 */
function filesOf(id) {
  return [
    ...jsFiles(path.join(ROOT, 'games', id)),
    path.join(ROOT, 'tests/unit/games', `${id}.test.js`),
    path.join(ROOT, 'tests/e2e', `${id}.spec.js`),
  ].filter((f) => fs.existsSync(f));
}

describe('games stay apart', () => {
  it('finds the imports it is looking for', () => {
    expect(importsOf("import a from './a.js';\nexport { b } from '../b.js';\n/** @type {import('../c.js').C} */\n" +
      "import './side.js';\nconst x = await import('./d.js');\nimport y from 'vitest';")).toEqual(
      ['./a.js', '../b.js', '../c.js', './side.js', './d.js']);
  });

  for (const id of IDS) {
    it(`${id} and its tests use no other game's files`, () => {
      const files = filesOf(id);
      expect(files.length).toBeGreaterThan(0);
      /** @type {string[]} */
      const crossings = [];
      for (const file of files) {
        for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
          const target = gameFolder(path.resolve(path.dirname(file), spec));
          if (target && target !== id) crossings.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
      expect(crossings).toEqual([]);
    });
  }

  it('would catch one game using another', () => {
    const file = path.join(ROOT, 'games/arrow-path/game.js');
    const target = gameFolder(path.resolve(path.dirname(file), '../pattern-train/model.js'));
    expect(target).toBe('pattern-train');
  });
});
