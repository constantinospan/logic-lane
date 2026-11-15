// Guards for the idea gate in .github/workflows/claude.yml and its rule files (D21). Plain text checks, in the same
// style as review-workflow.test.js (no YAML package).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (/** @type {string} */ p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const yml = read('.github/workflows/claude.yml');

/**
 * The text of one job: from its "  name:" line to the next job.
 * @param {string} name
 * @returns {string}
 */
function job(name) {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`).exec(yml);
  if (!m) throw new Error(`no job ${name}`);
  return m[1];
}

/**
 * Every run: block's script (single line or the indented lines after "run: |").
 * @returns {string[]}
 */
function runBlocks() {
  const lines = yml.split('\n');
  /** @type {string[]} */
  const out = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(line);
    if (!m) return;
    if (m[2] !== '|' && m[2] !== '>-') {
      out.push(m[2]);
      return;
    }
    const indent = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() && l.search(/\S/) <= indent + (line.includes('- run') ? 2 : 0)) break;
      body.push(l);
    }
    out.push(body.join('\n'));
  });
  return out;
}

describe('claude.yml: idea gate', () => {
  it('has the route, idea-review, idea-verdict and builder jobs', () => {
    for (const name of ['route', 'idea-review', 'idea-verdict', 'claude']) expect(() => job(name)).not.toThrow();
  });

  it('starts with no permissions; each job sets its own', () => {
    expect(yml).toMatch(/\npermissions: \{\}\n/);
    for (const name of ['route', 'idea-review', 'idea-verdict', 'claude']) expect(job(name)).toMatch(/permissions:/);
  });

  it('the owner-only guard is on the route job, which every other job depends on', () => {
    expect(job('route')).toContain("github.actor == 'constantinospan'");
    expect(job('idea-review')).toMatch(/needs: route/);
    expect(job('idea-verdict')).toMatch(/needs: \[route, idea-review\]/);
    expect(job('claude')).toMatch(/needs: \[route, idea-verdict\]/);
    expect(job('claude')).toContain("needs.route.result == 'success'");
  });

  it('the builder runs only on a skip or a passed check', () => {
    expect(job('claude')).toMatch(
      /needs\.route\.outputs\.route == 'skip' \|\|\s+\(needs\.idea-verdict\.result == 'success' && needs\.idea-verdict\.outputs\.go == 'true'\)/,
    );
  });

  it('a crashed reviewer is still reported', () => {
    expect(job('idea-verdict')).toMatch(/if: \$\{\{ !cancelled\(\) && needs\.route\.outputs\.route == 'review' \}\}/);
    expect(job('idea-verdict')).toContain('--job "$REVIEW_JOB"');
  });

  // A PR must not change its own reviewer, checklist or pass mark.
  it.each(['route', 'idea-review', 'idea-verdict'])('%s checks out main', (name) => {
    expect(job(name)).toMatch(/ref: main\n/);
    expect(job(name)).toContain('persist-credentials: false');
  });

  it('the idea reviewer can only read', () => {
    const j = job('idea-review');
    expect(j).toContain('--allowedTools "Read,Glob,Grep"');
    expect(j).toContain('--disallowedTools "Bash,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch"');
    expect(j).not.toMatch(/: write/);
    expect(j).toContain('github_token: ${{ github.token }}');
    expect(j).not.toContain('id-token');
  });

  it('the verdict job can comment and label, nothing more', () => {
    expect(job('idea-verdict')).toMatch(/permissions:\n      contents: read\n      issues: write\n      pull-requests: write\n    outputs:/);
  });

  it('only the builder has a concurrency group (a group on the idea jobs could drop a waiting request)', () => {
    expect(yml.match(/concurrency:/g)).toHaveLength(1);
    expect(job('claude')).toContain('concurrency:');
  });

  // Text from the owner or the AI must never be pasted into a script: only env variables and files.
  it('no ${{ }} inside any run: script', () => {
    const blocks = runBlocks();
    expect(blocks.length).toBeGreaterThan(5);
    for (const b of blocks) expect(b).not.toContain('${{');
  });

  it('the gate only adds needs-you, never removes it', () => {
    expect(yml).toContain("labels[]=needs-you");
    expect(yml).not.toMatch(/remove-label|DELETE/);
  });

  it('the builder gets the report only when there is one', () => {
    expect(job('claude')).toContain("steps.idea.outputs.has == 'true' && '--append-system-prompt");
    expect(job('claude')).toContain("needs.route.outputs.reason == 'go-anyway'");
    expect(job('claude')).toContain("printf '/idea-input/\\n' >> .git/info/exclude");
  });

  it('the comment marker matches the scripts', () => {
    const marker = '<!-- logic-lane:idea-review -->';
    expect(read('tools/idea/decide.mjs')).toContain(`'${marker}'`);
    expect(read('tools/idea/collect.sh')).toContain(`marker='${marker}'`);
    expect(job('claude')).toContain(marker);
  });
});

describe('scripts the workflows call', () => {
  it.each(['.github/workflows/claude.yml', '.github/workflows/review.yml'])('every tools/ script in %s exists', (wf) => {
    const paths = [...read(wf).matchAll(/tools\/[a-z/-]+\.(?:mjs|sh)/g)].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(fs.existsSync(new URL(`../../${p}`, import.meta.url)), p).toBe(true);
  });

  it('the idea verdict uses the rules script', () => {
    expect(job('idea-verdict')).toContain('node tools/idea/decide.mjs');
  });
});

describe('review.yml: the agreed brief', () => {
  const review = read('.github/workflows/review.yml');
  it('both AI reviewer jobs can read the linked issue', () => {
    expect(review.match(/issues: read # the agreed brief/g)).toHaveLength(2);
  });
  it('a failed brief fetch never stops the review', () => {
    expect(read('tools/review/collect-inputs.sh')).toMatch(/collect_brief \|\| \{/);
  });
});

describe('linked issues (the issues a PR closes)', () => {
  const scripts = [
    ['tools/idea/collect.sh', '/linked-issues.jq'],
    ['tools/review/collect-inputs.sh', '/../idea/linked-issues.jq'],
  ];
  it.each(scripts)("%s reads only this repo's issues, with the shared filter", (file, jq) => {
    const text = read(file);
    expect(text).toContain(`jq -r -f "$(dirname "$0")${jq}"`);
    expect(text).not.toContain('.closingIssuesReferences[].number');
  });
  it('the list is read before the loop, so a failed lookup is not "no linked issues"', () => {
    expect(read('tools/idea/collect.sh')).toMatch(/linked=\$\(gh pr view[\s\S]*?\n {2}for n in \$linked; do/);
    expect(read('tools/review/collect-inputs.sh')).toMatch(/issues=\$\(gh pr view[\s\S]*?\) \|\| return 1/);
  });
  it.each([
    ['tools/idea/collect.sh', 'rm -f "$out/linked-start.json" "$out/linked-comments.json"\n      continue'],
    ['tools/review/collect-inputs.sh', 'rm -f "$tmp/pages-$n.json" "$tmp/issue-$n.json"\n      continue'],
  ])('%s skips an unreadable issue and removes its files', (file, skip) => {
    expect(read(file)).toContain(skip);
  });
});

describe('idea gate rule files', () => {
  const agent = read('.claude/agents/idea-reviewer.md');
  const schema = JSON.parse(read('tools/idea/schema.json'));

  it('the agent is read-only', () => {
    expect(agent).toMatch(/^---\nname: idea-reviewer\n[\s\S]*?\ntools: Read, Glob, Grep\n---/);
  });

  it('the agent describes every field and label in the schema', () => {
    for (const field of Object.keys(schema.properties)) expect(agent).toContain(`"${field}"`);
    for (const s of schema.properties.findings.items.properties.kind.enum) expect(agent).toContain(`\`${s}\``);
  });

  it('the checklist explains every label', () => {
    const checklist = read('docs/IDEA-CHECKLIST.md');
    for (const s of schema.properties.findings.items.properties.kind.enum) expect(checklist).toContain(`**${s}**`);
  });

  it('CLAUDE.md tells sessions to run the check with main\'s settings', () => {
    const rules = read('CLAUDE.md');
    expect(rules).toContain('idea-reviewer');
    expect(rules).toContain('node tools/idea/decide.mjs <file> --main');
    expect(rules).toContain('idea-input/report.md');
  });

  it('the README and CLAUDE.md list the same skip phrases as route.mjs', () => {
    for (const phrase of ['revert PR #N', 'go anyway', 'fix the Blocking items', 'fix CI', 'CI is red']) {
      expect(read('CLAUDE.md')).toContain(`\`${phrase}\``);
      expect(read('README.md')).toContain(`@claude ${phrase}`);
    }
  });

  it('the builder copies the brief into the PR, and the code reviewer checks the idea check\'s own copy', () => {
    expect(read('CLAUDE.md')).toContain('copy its **What will be built** lines and its **Assumptions**');
    expect(read('tools/review/prompts/code.md')).toContain('review-input/idea-brief.md');
    expect(read('tools/review/collect-inputs.sh')).toContain('brief.mjs');
  });

  it('the builder knows what to do after "go anyway", and the reviewer checks it would be visible', () => {
    const rules = read('CLAUDE.md');
    expect(rules).toContain('**After "go anyway"**');
    expect(rules).toContain('🛑 blockers still stand');
    expect(rules).toContain('already said "go anyway" twice');
    expect(rules).toContain('Never call it "from the idea check"');
    expect(rules).toContain('shows nothing she can see today');
    expect(read('docs/IDEA-CHECKLIST.md')).toContain("she wouldn't see any change today");
  });

  it('the reviewer lists each separate guess as its own assumption', () => {
    for (const f of ['docs/IDEA-CHECKLIST.md', '.claude/agents/idea-reviewer.md']) {
      expect(read(f), f).toContain('**One assumption per separate choice:** never combine unrelated');
    }
  });

  it('idea-input/ is never committed', () => {
    expect(read('.gitignore')).toMatch(/^idea-input\/$/m);
  });
});
