// Guards for the tool allow-lists in .github/workflows/review.yml (D15, D19).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = fs.readFileSync(new URL('../../.github/workflows/review.yml', import.meta.url), 'utf8');
const rules = [...yml.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1]);

describe('review.yml allow-lists', () => {
  it('has rules to check', () => {
    expect(rules.length).toBeGreaterThan(10);
  });

  // Learned in the 6b proof (2026-11-14): `Bash(node review-tmp/:*)` never matches `node review-tmp/play.mjs`,
  // because `:*` means "then a space and anything". A folder needs `Bash(node review-tmp/*)`.
  it.each(rules)('Bash(%s) is not a folder followed by :*', (rule) => {
    expect(rule).not.toMatch(/\/:\*$/);
  });

  // Owner, 2026-11-14: a fix run that leaves items for the owner stops the automatic rounds.
  it('the fix instructions and the workflow agree on review-input/skipped-count', () => {
    const fix = fs.readFileSync(new URL('../../tools/review/prompts/fix.md', import.meta.url), 'utf8');
    expect(fix).toContain('review-input/skipped-count');
    expect(yml).toContain('review-input/skipped-count');
    expect(yml).toMatch(/--add-label ai-fix-1 --add-label ai-fix-2/);
  });

  it('lets the play reviewer run its own scripts', () => {
    expect(rules).toContain('node review-tmp/*');
  });
});
