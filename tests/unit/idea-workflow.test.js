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
    expect(read('tools/idea/score.mjs')).toContain(`'${marker}'`);
    expect(read('tools/idea/collect.sh')).toContain(`marker='${marker}'`);
    expect(job('claude')).toContain(marker);
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
    for (const s of schema.properties.findings.items.properties.severity.enum) expect(agent).toContain(`\`${s}\``);
  });

  it('the checklist explains every label', () => {
    const checklist = read('docs/IDEA-CHECKLIST.md');
    for (const s of schema.properties.findings.items.properties.severity.enum) expect(checklist).toContain(`**${s}**`);
  });

  it('CLAUDE.md tells sessions to run the check with main\'s settings', () => {
    const rules = read('CLAUDE.md');
    expect(rules).toContain('idea-reviewer');
    expect(rules).toContain('node tools/idea/score.mjs <file> --main');
    expect(rules).toContain('idea-input/report.md');
  });

  it('the README and CLAUDE.md list the same skip phrases as route.mjs', () => {
    for (const phrase of ['revert PR #N', 'go anyway', 'fix the Blocking items', 'fix CI', 'CI is red']) {
      expect(read('CLAUDE.md')).toContain(`\`${phrase}\``);
      expect(read('README.md')).toContain(`@claude ${phrase}`);
    }
  });

  it('idea-input/ is never committed', () => {
    expect(read('.gitignore')).toMatch(/^idea-input\/$/m);
  });
});
