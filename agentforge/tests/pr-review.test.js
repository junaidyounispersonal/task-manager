'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSystem } = require('../src/system');
const { STATUSES, SEVERITIES } = require('../src/constants');
const { formatReviewBody } = require('../src/github/pull-requests');
const { testConfig, mockGithub, silentLogger } = require('./helpers/config');

test('PR review posts classified findings and never merges', async () => {
  const github = mockGithub();
  const config = testConfig();
  const system = createSystem(config, {
    logger: silentLogger(),
    github,
    ai: {
      generateReview: async () => ({
        findings: [
          {
            severity: 'HIGH',
            file: 'backend/app.js',
            line: 10,
            problem: 'Unauthenticated route',
            why: 'Anyone can call it',
            suggestedFix: 'Add auth middleware',
          },
          {
            severity: 'SUGGESTION',
            file: 'backend/app.js',
            line: 12,
            problem: 'Could rename variable',
            why: 'Readability',
            suggestedFix: 'Optional rename',
          },
        ],
      }),
    },
    git: {},
    checks: { runAll: async () => [] },
  });

  const run = await system.prReview.reviewPullRequest({
    number: 5,
    title: 'Add feature',
    body: '',
    head: { ref: 'feat/x' },
    base: { ref: 'main' },
    html_url: 'https://example.com/pr/5',
    user: { login: 'bot' },
  });

  assert.equal(run.status, STATUSES.REVIEW_COMPLETED);
  assert.equal(run.findings.length, 2);
  assert.ok(SEVERITIES.includes(run.findings[0].severity));
  assert.equal(github.reviews.length, 1);
  assert.equal(github.reviews[0].event, 'COMMENT');
  assert.match(github.reviews[0].body, /must not merge/i);
  await assert.rejects(() => github.mergePullRequest(), /never merge/);
});

test('formatReviewBody groups by severity', () => {
  const body = formatReviewBody([
    { severity: 'CRITICAL', file: 'a.js', line: 1, problem: 'rce', why: 'bad', suggestedFix: 'remove' },
  ]);
  assert.match(body, /CRITICAL/);
  assert.match(body, /a\.js:1/);
});
