'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyGitHubSignature } = require('../src/security/webhook-verify');
const { authenticateAndParse, classifyEvent } = require('../src/github/webhooks');
const { createSystem } = require('../src/system');
const { STATUSES } = require('../src/constants');
const { testConfig, sampleIssue, samplePlan, mockAi, mockGit, mockGithub, silentLogger } = require('./helpers/config');

function sign(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('invalid webhook signatures are rejected', () => {
  const body = '{"ok":true}';
  assert.throws(
    () => verifyGitHubSignature(body, 'sha256=deadbeef', 'secret'),
    /Invalid webhook signature/
  );
  assert.equal(verifyGitHubSignature(body, sign(body, 'secret'), 'secret'), true);
});

test('malformed webhook JSON stops safely', () => {
  const secret = 'secret';
  const raw = Buffer.from('not-json');
  assert.throws(
    () =>
      authenticateAndParse({
        rawBody: raw,
        signature: sign(raw, secret),
        secret,
        githubEvent: 'issues',
        allowlist: ['junaidyounispersonal/task-manager'],
      }),
    /Malformed webhook JSON/
  );
});

test('webhooks from other repositories are denied', () => {
  const secret = 'secret';
  const payload = {
    action: 'opened',
    repository: { name: 'secrets', owner: { login: 'evil' }, fork: false },
    issue: sampleIssue(),
  };
  const raw = Buffer.from(JSON.stringify(payload));
  assert.throws(
    () =>
      authenticateAndParse({
        rawBody: raw,
        signature: sign(raw, secret),
        secret,
        githubEvent: 'issues',
        allowlist: ['junaidyounispersonal/task-manager'],
      }),
    /not on GITHUB_REPO_ALLOWLIST/
  );
});

test('classifyEvent maps GitHub events to workflows', () => {
  assert.equal(classifyEvent('issues', { action: 'opened', issue: {} }).type, 'issue');
  assert.equal(classifyEvent('pull_request', { action: 'opened' }).type, 'pull_request');
  assert.equal(
    classifyEvent('workflow_run', { action: 'completed', workflow_run: { conclusion: 'failure' } }).type,
    'ci_failure'
  );
  assert.equal(classifyEvent('ping', { action: 'ping' }).type, 'ignore');
});

test('dispatchWebhook opens an issue-to-pr run', async () => {
  const config = testConfig();
  const system = createSystem(config, {
    logger: silentLogger(),
    github: mockGithub(),
    ai: mockAi(samplePlan()),
    git: mockGit(),
    checks: { runAll: async () => [] },
  });
  const payload = {
    action: 'opened',
    repository: {
      name: 'task-manager',
      owner: { login: 'junaidyounispersonal' },
      fork: false,
    },
    issue: sampleIssue(),
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const result = await system.dispatchWebhook({
    rawBody: raw,
    signature: sign(raw, config.github.webhookSecret),
    githubEvent: 'issues',
  });
  assert.equal(result.workflow, 'issue-to-pr');
  assert.equal(result.status, STATUSES.PENDING_PLAN_APPROVAL);
});
