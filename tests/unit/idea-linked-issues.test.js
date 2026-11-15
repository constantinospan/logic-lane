// The filter both collectors use to read the issues a PR closes (D21): tools/idea/linked-issues.jq.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** @param {object} input @param {string} repo @returns {string[]} */
function run(input, repo) {
  const out = execFileSync('jq', ['-r', '-f', 'tools/idea/linked-issues.jq'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: repo },
  });
  return out.split('\n').filter(Boolean);
}

/** @param {number} number @param {string} owner @param {string} name */
const ref = (number, owner, name) => ({ number, repository: { name, owner: { login: owner } } });

describe('linked-issues.jq', () => {
  it("keeps only this repo's issues, in any letter case", () => {
    const refs = [ref(1, 'constantinospan', 'logic-lane'), ref(2, 'someone', 'other'), ref(3, 'ConstantinosPan', 'Logic-Lane')];
    expect(run({ closingIssuesReferences: refs }, 'constantinospan/logic-lane')).toEqual(['1', '3']);
  });

  it('an issue with the same name in another owner is not ours', () => {
    expect(run({ closingIssuesReferences: [ref(7, 'someone', 'logic-lane')] }, 'constantinospan/logic-lane')).toEqual([]);
  });

  it('no linked issues: nothing', () => {
    expect(run({ closingIssuesReferences: [] }, 'constantinospan/logic-lane')).toEqual([]);
  });
});
