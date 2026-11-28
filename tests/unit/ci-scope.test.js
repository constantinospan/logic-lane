// What a CI run tests (D20): tools/ci/scope.mjs. Wrong rules here could let a break merge unseen, so every rule
// that narrows a run is checked, and so is every way it must fall back to running everything.
import { describe, expect, it } from 'vitest';
import { MIN_SHARDS, PER_SHARD, decide, gameIds, gameOf, parseCount, shardCount }
  from '../../tools/ci/scope.mjs';

const IDS = ['arrow-path', 'demo', 'pattern-train'];
/** @param {string[]} files */
const pr = (files) => decide({ event: 'pull_request', files, ids: IDS });

describe('which game a file belongs to', () => {
  it("knows a game's folder, its own tests and its pictures", () => {
    expect(gameOf('games/pattern-train/view.js', IDS)).toBe('pattern-train');
    expect(gameOf('tests/unit/games/arrow-path.test.js', IDS)).toBe('arrow-path');
    expect(gameOf('tests/e2e/pattern-train.spec.js', IDS)).toBe('pattern-train');
    expect(gameOf('tests/e2e/visual.spec.js-snapshots/pattern-train-two-phone-linux.png', IDS)).toBe('pattern-train');
  });

  it('calls everything else shared', () => {
    for (const f of ['js/core/games.js', 'css/app.css', 'sw.js', 'tests/e2e/fixtures.js', 'tests/e2e/a11y.spec.js',
      'tests/e2e/visual.spec.js', 'tests/e2e/visual.spec.js-snapshots/home-phone-linux.png', 'package.json',
      '.github/workflows/ci.yml', 'games/new-game/game.js', 'tests/e2e/new-game.spec.js', 'games/README',
      'tests/unit/games/new-game.test.js', 'tools/ci/scope.mjs']) {
      expect(gameOf(f, IDS), f).toBeUndefined();
    }
  });

  it('matches pictures to the longest game id, so "arrow" never claims "arrow-path" pictures', () => {
    const ids = ['arrow', 'arrow-path'];
    expect(gameOf('tests/e2e/visual.spec.js-snapshots/arrow-path-board-phone-linux.png', ids)).toBe('arrow-path');
    expect(gameOf('tests/e2e/visual.spec.js-snapshots/arrow-board-phone-linux.png', ids)).toBe('arrow');
    expect(gameOf('tests/e2e/visual.spec.js-snapshots/arrowpath-x.png', ids)).toBeUndefined();
  });
});

describe('what a run tests', () => {
  it('runs everything on main, on manual runs and on unknown events', () => {
    for (const event of ['push', 'workflow_dispatch', 'merge_group', '']) {
      expect(decide({ event, files: ['games/demo/game.js'], ids: IDS })).toMatchObject({ mode: 'all', grep: '' });
    }
  });

  it('runs everything when it found no changed files (it never narrows on a guess)', () => {
    expect(pr([])).toMatchObject({ mode: 'all', grep: '' });
  });

  it('runs only the quick checks when only Markdown files changed', () => {
    expect(pr(['docs/PLAN.md', 'README.md', 'CLAUDE.md'])).toMatchObject({ mode: 'docs' });
  });

  it('treats Markdown the site serves as part of the site, not docs', () => {
    expect(pr(['js/notes.md'])).toMatchObject({ mode: 'all' });
    expect(pr(['css/readme.md', 'docs/PLAN.md'])).toMatchObject({ mode: 'all' });
    expect(pr(['games/pattern-train/notes.md'])).toMatchObject({ mode: 'game', game: 'pattern-train' });
  });

  it("leaves out only other games' tests when one game changed", () => {
    const s = pr(['games/pattern-train/view.js', 'tests/e2e/pattern-train.spec.js', 'docs/DECISIONS.md',
      'tests/e2e/visual.spec.js-snapshots/pattern-train-two-phone-linux.png']);
    expect(s).toMatchObject({ mode: 'game', game: 'pattern-train' });
    expect(s.grep).toBe('@game:(arrow-path)(?![\\w-])'); // never the demo: shared tests use it
  });

  it("the filter matches exactly the other games' tags", () => {
    const grep = new RegExp(pr(['games/demo/game.js']).grep);
    expect(grep.test('Arrow Path board @game:arrow-path')).toBe(true);
    expect(grep.test('x @game:pattern-train')).toBe(true);
    expect(new RegExp(pr(['games/arrow-path/view.js']).grep).test('x @game:arrow-path')).toBe(false);
    // A shorter id never catches a longer one's tag.
    const short = decide({ event: 'pull_request', files: ['games/b/x.js'], ids: ['arrow', 'arrow-path', 'b'] });
    expect(new RegExp(short.grep).test('t @game:arrow-path')).toBe(true);
    const onlyLong = decide({ event: 'pull_request', files: ['games/arrow-path/x.js'], ids: ['arrow', 'arrow-path'] });
    expect(new RegExp(onlyLong.grep).test('t @game:arrow-path')).toBe(false);
    expect(new RegExp(onlyLong.grep).test('t @game:arrow')).toBe(true);
  });

  it('runs everything when a shared file changed too, or two games changed', () => {
    expect(pr(['games/pattern-train/view.js', 'css/app.css'])).toMatchObject({ mode: 'all', grep: '' });
    expect(pr(['games/pattern-train/view.js', 'games/arrow-path/view.js'])).toMatchObject({ mode: 'all' });
    expect(pr(['tests/e2e/fixtures.js'])).toMatchObject({ mode: 'all' });
    expect(pr(['games/brand-new/game.js'])).toMatchObject({ mode: 'all' }); // not a known game yet
  });

  it('a file moved from one game to another counts for both (renames are listed as delete + add)', () => {
    expect(pr(['games/arrow-path/util.js', 'games/pattern-train/util.js'])).toMatchObject({ mode: 'all' });
  });

  it('says why, in plain words', () => {
    expect(pr(['css/app.css']).reason).toBe('a shared file changed (css/app.css)');
    expect(pr(['games/arrow-path/a.js', 'games/pattern-train/b.js']).reason).toBe('more than one game changed');
  });
});

describe('how many machines', () => {
  it(`never fewer than ${MIN_SHARDS}, about one per ${PER_SHARD} tests`, () => {
    expect(shardCount(1)).toBe(1); // never more machines than tests
    expect(shardCount(3)).toBe(3);
    expect(shardCount(120)).toBe(3);
    expect(shardCount(150)).toBe(3);
    expect(shardCount(151)).toBe(4);
    expect(shardCount(315)).toBe(7);
    expect(shardCount(1000)).toBe(20);
  });

  it('stops the run when there are no tests to run (outside docs PRs)', () => {
    expect(() => shardCount(0)).toThrow(/no browser tests/);
    expect(() => shardCount(Number.NaN)).toThrow();
  });

  it('reads the count from playwright --list, and stops if it cannot', () => {
    expect(parseCount('  [phone] › a.spec.js:1:1 › x\nTotal: 315 tests in 8 files\n')).toBe(315);
    expect(parseCount('Total: 1 test in 1 file')).toBe(1);
    expect(() => parseCount('Error: something broke')).toThrow(/test count/);
  });

  it("knows this repo's games", () => {
    expect(gameIds()).toEqual(expect.arrayContaining(['arrow-path', 'demo', 'pattern-train']));
  });
});
