'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSystem } = require('../src/system');
const { STATUSES } = require('../src/constants');
const { WorkflowError } = require('../src/errors');
const {
  testConfig,
  sampleIssue,
  samplePlan,
  mockAi,
  mockGit,
  mockGithub,
  silentLogger,
} = require('./helpers/config');

function systemWith(overrides = {}) {
  const config = testConfig();
  return createSystem(config, {
    logger: silentLogger(),
    github: overrides.github || mockGithub(),
    ai: overrides.ai || mockAi(samplePlan()),
    git: overrides.git || mockGit(),
    checks: overrides.checks || { runAll: async () => [{ name: 'lint', ok: true, skipped: true }] },
  });
}

test('issue workflow waits at PENDING_PLAN_APPROVAL', async () => {
  const system = systemWith();
  const run = await system.issueToPr.startFromIssue(sampleIssue());
  assert.equal(run.status, STATUSES.PENDING_PLAN_APPROVAL);
  assert.ok(run.plan.summary);
  assert.ok(system.github.comments[0].body.includes('PENDING_PLAN_APPROVAL'));
});

test('approval comment moves the run into implementation and opens a PR', async () => {
  const git = mockGit();
  const github = mockGithub();
  const system = systemWith({ git, github });
  await system.issueToPr.startFromIssue(sampleIssue());
  const result = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: '/agentforge approve',
  });
  assert.equal(result.status, STATUSES.PR_CREATED);
  assert.equal(result.prNumber, 99);
  assert.ok(git.calls.some((c) => c[0] === 'createBranch'));
  assert.ok(git.calls.some((c) => c[0] === 'push'));
  assert.equal(github.prs[0].head, 'agentforge/issue-12');
  assert.equal(github.prs[0].base, 'main');
});

test('reject comment stops without implementing', async () => {
  const git = mockGit();
  const system = systemWith({ git });
  await system.issueToPr.startFromIssue(sampleIssue());
  const result = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: '/agentforge reject',
  });
  assert.equal(result.status, STATUSES.REJECTED);
  assert.equal(git.calls.length, 0);
});

test('unrelated comments do not leave PENDING_PLAN_APPROVAL', async () => {
  const system = systemWith();
  await system.issueToPr.startFromIssue(sampleIssue());
  const result = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: 'looks interesting',
  });
  assert.equal(result.status, STATUSES.PENDING_PLAN_APPROVAL);
});

test('comment 403 keeps local PENDING_PLAN_APPROVAL', async () => {
  const { WorkflowError } = require('../src/errors');
  const github = mockGithub();
  github.createIssueComment = async () => {
    throw new WorkflowError('GitHub API failed: Resource not accessible by personal access token', {
      code: 'GITHUB_PERMISSIONS',
      status: 'STOPPED',
    });
  };
  const system = systemWith({ github });
  const run = await system.issueToPr.startFromIssue(sampleIssue());
  assert.equal(run.status, STATUSES.PENDING_PLAN_APPROVAL);
  assert.ok(run.plan.summary);
  assert.match(run.githubWarning, /personal access token/);
  assert.match(run.planComment, /PENDING_PLAN_APPROVAL/);
});

test('failed checks are sent back to Hermes then re-run', async () => {
  let checkRuns = 0;
  const ai = mockAi();
  const fixCalls = [];
  ai.fixChecks = async (ctx) => {
    fixCalls.push(ctx);
    return 'fixed';
  };
  const git = mockGit();
  const github = mockGithub();
  const system = createSystem(testConfig({ maxAutoFixAttempts: 2 }), {
    logger: silentLogger(),
    github,
    ai,
    git,
    checks: {
      runAll: async () => {
        checkRuns += 1;
        if (checkRuns === 1) {
          throw new WorkflowError('lint failed (exit 1)', {
            code: 'CHECKS_FAILED',
            status: 'STOPPED',
            details: {
              name: 'lint',
              command: 'npm --prefix frontend run lint',
              output: "error  'setLocalLoading' is assigned a value but never used  no-unused-vars",
            },
          });
        }
        return [{ name: 'lint', ok: true, skipped: false }];
      },
    },
  });
  await system.issueToPr.startFromIssue(sampleIssue());
  const result = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: '/agentforge approve',
  });
  assert.equal(result.status, STATUSES.PR_CREATED);
  assert.equal(checkRuns, 2);
  assert.equal(fixCalls.length, 1);
  assert.match(fixCalls[0].output, /setLocalLoading/);
  assert.equal(fixCalls[0].checkName, 'lint');
  assert.equal(result.autoFixAttempts, 1);
});

test('exhausted check auto-fix stops and records check output', async () => {
  let fixCalls = 0;
  const ai = mockAi();
  ai.fixChecks = async () => {
    fixCalls += 1;
    return 'still broken';
  };
  const system = createSystem(testConfig({ maxAutoFixAttempts: 1 }), {
    logger: silentLogger(),
    github: mockGithub(),
    ai,
    git: mockGit(),
    checks: {
      runAll: async () => {
        throw new WorkflowError('lint failed (exit 1)', {
          code: 'CHECKS_FAILED',
          status: 'STOPPED',
          details: {
            name: 'lint',
            command: 'npm --prefix frontend run lint',
            output: 'no-unused-vars in UserDropdown.jsx',
          },
        });
      },
    },
  });
  await system.issueToPr.startFromIssue(sampleIssue());
  const result = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: '/agentforge approve',
  });
  assert.equal(result.status, STATUSES.STOPPED);
  assert.equal(result.error.code, 'CHECKS_FAILED');
  assert.match(result.error.output, /UserDropdown/);
  assert.equal(result.error.command, 'npm --prefix frontend run lint');
  assert.equal(fixCalls, 1);
  assert.equal(result.autoFixAttempts, 1);
});

test('pending plans are reused instead of creating a duplicate run', async () => {
  const system = systemWith();
  const first = await system.issueToPr.startFromIssue(sampleIssue());
  const second = await system.issueToPr.startFromIssue(sampleIssue());
  assert.equal(second.id, first.id);
  assert.equal(second.status, STATUSES.PENDING_PLAN_APPROVAL);
});

test('retry continues implementation after a failed approved run', async () => {
  let checkRuns = 0;
  const git = mockGit();
  const github = mockGithub();
  const system = createSystem(testConfig({ maxAutoFixAttempts: 0 }), {
    logger: silentLogger(),
    github,
    ai: mockAi(),
    git,
    checks: {
      runAll: async () => {
        checkRuns += 1;
        if (checkRuns === 1) {
          throw new WorkflowError('lint failed (exit 1)', {
            code: 'CHECKS_FAILED',
            status: 'STOPPED',
            details: { name: 'lint', command: 'eslint', output: 'no-unused-vars' },
          });
        }
        return [{ name: 'lint', ok: true, skipped: false }];
      },
    },
  });
  await system.issueToPr.startFromIssue(sampleIssue());
  const failed = await system.issueToPr.handleApproval({
    issueNumber: 12,
    commentBody: '/agentforge approve',
  });
  assert.equal(failed.status, STATUSES.STOPPED);
  await assert.rejects(
    () =>
      system.issueToPr.handleApproval({
        issueNumber: 12,
        commentBody: '/agentforge approve',
      }),
    /retry --issue/
  );
  const retried = await system.issueToPr.retryImplement({ issueNumber: 12 });
  assert.equal(retried.status, STATUSES.PR_CREATED);
  assert.equal(checkRuns, 2);
});
