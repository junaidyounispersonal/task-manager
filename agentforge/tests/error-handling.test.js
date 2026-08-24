'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createChecks } = require('../src/services/checks');
const { createStore } = require('../src/state/store');
const { STATUSES } = require('../src/constants');
const { createIssueToPrWorkflow } = require('../src/workflows/issue-to-pr');
const { createIssueAgent } = require('../src/agents/issue-agent');
const { WorkflowError } = require('../src/errors');
const { sampleIssue, samplePlan, silentLogger, mockAi } = require('./helpers/config');

test('empty check commands are skipped', async () => {
  const checks = createChecks({ repoPath: process.cwd(), commands: { lint: '', test: '', build: '' } });
  const results = await checks.runAll();
  assert.equal(results.every((r) => r.skipped && r.ok), true);
});

test('failing checks include stdout in the error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-checks-out-'));
  const script = path.join(dir, 'fail.js');
  fs.writeFileSync(script, "process.stdout.write('lint boom'); process.exit(1);\n");
  const checks = createChecks({
    repoPath: dir,
    commands: { lint: `node "${script}"`, test: '', build: '' },
  });
  await assert.rejects(
    () => checks.runAll(),
    (err) => {
      assert.equal(err.code, 'CHECKS_FAILED');
      assert.equal(err.details.name, 'lint');
      assert.match(err.details.output, /lint boom/);
      return true;
    }
  );
});

test('failing checks stop the workflow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-checks-'));
  const checks = createChecks({
    repoPath: dir,
    commands: { lint: 'node -e "process.exit(2)"', test: '', build: '' },
  });
  await assert.rejects(() => checks.runAll(), /lint failed/);
});

test('GitHub API failures stop the workflow and record an error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-store-'));
  const store = createStore(dir);
  const target = {
    owner: 'org',
    repo: 'repo',
    fullName: 'org/repo',
    defaultBranch: 'main',
    repoPath: path.resolve(__dirname, '../..'),
  };
  const workflow = createIssueToPrWorkflow({
    store,
    logger: silentLogger(),
    github: {
      createIssueComment: async () => {},
      addLabels: async () => {},
      createPullRequest: async () => {
        throw new WorkflowError('GitHub API failed', { code: 'GITHUB_API_FAILED', status: 'STOPPED' });
      },
    },
    issueAgent: createIssueAgent({ ai: mockAi(samplePlan()), target }),
    git: {
      createBranch: async (n) => n,
      diff: async () => 'diff',
      diffStat: async () => 'stat',
      addAll: async () => {},
      commit: async () => {},
      push: async () => {},
    },
    checks: { runAll: async () => [{ name: 'lint', ok: true, skipped: true }] },
    ai: mockAi(samplePlan()),
    target,
    maxAutoFixAttempts: 0,
  });

  const pending = await workflow.startFromIssue(sampleIssue({ number: 3 }));
  assert.equal(pending.status, STATUSES.PENDING_PLAN_APPROVAL);
  const result = await workflow.handleApproval({
    issueNumber: 3,
    commentBody: '/agentforge approve',
  });
  assert.equal(result.status, STATUSES.STOPPED);
  assert.equal(result.error.code, 'GITHUB_API_FAILED');
});

test('changed lint scope skips when no JS files changed', async () => {
  const { createChecks } = require('../src/services/checks');
  const checks = createChecks({
    repoPath: process.cwd(),
    commands: { lint: 'npm --prefix frontend run lint', test: '', build: '' },
    lintScope: 'changed',
    listChangedFiles: async () => ['README.md'],
  });
  const results = await checks.runAll();
  assert.equal(results[0].skipped, true);
});

test('changed lint command targets frontend files only', () => {
  const { changedLintCommand, lintFilesFromChangeList } = require('../src/services/checks');
  const files = lintFilesFromChangeList(
    ['frontend/src/pages/Login.jsx', 'backend/server.js', 'README.md'],
    'npm --prefix frontend run lint'
  );
  assert.deepEqual(files, ['frontend/src/pages/Login.jsx']);
  assert.match(
    changedLintCommand('npm --prefix frontend run lint', files),
    /eslint --max-warnings 0 "src\/pages\/Login.jsx"/
  );
});

test('repo inspect skips agentforge and prefers frontend', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-inspect-'));
  fs.mkdirSync(path.join(dir, 'agentforge', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agentforge', 'src', 'index.js'), 'x');
  fs.mkdirSync(path.join(dir, 'frontend', 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'frontend', 'src', 'pages', 'Login.jsx'), 'x');
  const { listFiles } = require('../src/services/repo-inspect');
  const files = listFiles(dir);
  assert.ok(files.includes('frontend/src/pages/Login.jsx'));
  assert.equal(files.some((file) => file.startsWith('agentforge/')), false);
});
