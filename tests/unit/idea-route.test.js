// Which requests skip the idea check (D21): tools/idea/route.mjs. Only fixed phrases, as the whole request.
import { describe, expect, it } from 'vitest';
import { decide, normalise, requestText, skipReason } from '../../tools/idea/route.mjs';

const ON = { enabled: true, passMark: 75, weights: { major: 15, question: 10, minor: 5 } };
const OFF = { ...ON, enabled: false };

describe('skipReason', () => {
  it.each([
    ['@claude revert PR #9', 'revert'],
    ['@claude Revert PR #12.', 'revert'],
    ['@claude revert #9', 'revert'],
    ['@claude go anyway', 'go-anyway'],
    ['@claude, go anyway!', 'go-anyway'],
    ['  @claude   GO   ANYWAY  ', 'go-anyway'],
    ['@claude fix the Blocking items', 'fix-review'],
    ['@claude fix CI', 'fix-ci'],
    ['@claude fix the CI', 'fix-ci'],
    ['@claude CI is red', 'fix-ci'],
    ['go anyway @claude', 'go-anyway'],
  ])('%j skips (%s)', (text, reason) => {
    expect(skipReason(text)).toBe(reason);
  });

  // The whole request must be the phrase, so nothing new slips past the check.
  it.each([
    '@claude fix CI and add a timer game',
    '@claude go anyway, and also make it red',
    '@claude revert PR #9 then add sounds',
    '@claude revert the arrows to blue',
    '@claude fix the failing tests and make the stars bigger',
    '@claude add a new game',
    '@claude',
    '',
    '@claude please go anyway with a countdown',
  ])('%j is reviewed', (text) => {
    expect(skipReason(text)).toBeNull();
  });
});

describe('normalise', () => {
  it('drops @claude, case, extra spaces and closing punctuation', () => {
    expect(normalise('@Claude   Go Anyway!!')).toBe('go anyway');
  });
});

describe('requestText', () => {
  it('new issue: the body', () => {
    expect(requestText('issues', { issue: { title: 'Revert', body: '@claude revert PR #9' } })).toBe(
      '@claude revert PR #9',
    );
  });

  it('new issue with only "@claude" in the body: the title', () => {
    expect(requestText('issues', { issue: { title: 'Add a star', body: '@claude' } })).toBe('Add a star');
  });

  it('comments and reviews', () => {
    expect(requestText('issue_comment', { comment: { body: 'a' } })).toBe('a');
    expect(requestText('pull_request_review_comment', { comment: { body: 'b' } })).toBe('b');
    expect(requestText('pull_request_review', { review: { body: 'c' } })).toBe('c');
    expect(requestText('pull_request_review', { review: { body: null } })).toBe('');
  });
});

describe('decide', () => {
  const comment = (body, extra = {}) => ({ issue: { number: 7, ...extra }, comment: { body } });

  it('reviews a request on an issue', () => {
    expect(decide('issue_comment', comment('@claude add stars'), ON)).toEqual({
      route: 'review',
      reason: 'request',
      number: 7,
      kind: 'issue',
    });
  });

  it('knows a PR conversation comment is on a PR', () => {
    expect(decide('issue_comment', comment('@claude add stars', { pull_request: {} }), ON).kind).toBe('pr');
  });

  it('PR review events', () => {
    expect(decide('pull_request_review', { pull_request: { number: 3 }, review: { body: '@claude x' } }, ON)).toEqual(
      { route: 'review', reason: 'request', number: 3, kind: 'pr' },
    );
  });

  it('skips a fixed phrase', () => {
    expect(decide('issue_comment', comment('@claude go anyway'), ON)).toMatchObject({
      route: 'skip',
      reason: 'go-anyway',
    });
  });

  it('switched off: everything skips, as before 6c', () => {
    expect(decide('issue_comment', comment('@claude add stars'), OFF)).toMatchObject({ route: 'skip', reason: 'off' });
  });
});
