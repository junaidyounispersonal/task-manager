'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { createStore } = require('../../src/state/store');

function tempDir(prefix = 'agentforge-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function testConfig(overrides = {}) {
  const dataDir = overrides.dataDir || path.join(tempDir(), 'data');
  return {
    agentforgeRoot: path.resolve(__dirname, '../..'),
    host: '127.0.0.1',
    port: 0,
    logLevel: 'error',
    dataDir,
    target: {
      owner: 'junaidyounispersonal',
      repo: 'task-manager',
      fullName: 'junaidyounispersonal/task-manager',
      defaultBranch: 'main',
      repoPath: path.resolve(__dirname, '../../..'),
      allowlist: ['junaidyounispersonal/task-manager'],
      checks: { lint: '', build: '', test: '' },
      lintScope: 'all',
      ...(overrides.target || {}),
    },
    github: {
      token: 'test-token',
      webhookSecret: 'test-secret',
      appId: '',
      appPrivateKeyPath: '',
      ...(overrides.github || {}),
    },
    ai: {
      provider: 'hermes',
      hermesBin: 'hermes',
      hermesSkills: ['github-issue-to-pr'],
      timeoutMs: 5000,
      ...(overrides.ai || {}),
    },
    git: { userName: 'AgentForge', userEmail: 'agentforge@local' },
    maxAutoFixAttempts: 0,
    ...overrides,
    dataDir,
  };
}

function samplePlan(extra = {}) {
  return {
    summary: 'Add a health endpoint',
    requirements: 'Expose GET /health that returns ok',
    expectedFiles: ['backend/app.js'],
    implementation: 'Add a route without changing auth',
    testing: 'Request GET /health',
    risks: 'None beyond a small Express change',
    ...extra,
  };
}

function sampleIssue(extra = {}) {
  return {
    number: 12,
    title: 'Add health check',
    body: 'Please add GET /health',
    labels: [],
    html_url: 'https://github.com/junaidyounispersonal/task-manager/issues/12',
    user: { login: 'human' },
    state: 'open',
    ...extra,
  };
}

function silentLogger() {
  const noop = () => {};
  return { event: noop, info: noop, warn: noop, error: noop, debug: noop };
}

function mockAi(plan = samplePlan()) {
  return {
    name: 'hermes',
    generatePlan: async () => plan,
    generateReview: async () => ({ findings: [] }),
    generateDiagnosis: async () => ({
      failedWorkflow: 'CI',
      failedStep: 'lint',
      error: 'exit 1',
      probableRootCause: 'eslint error',
      relevantFiles: ['frontend/src/App.jsx'],
      suggestedFix: 'Fix the lint error',
      confidence: 'high',
    }),
    implement: async () => 'implemented',
    fixChecks: async () => 'fixed',
  };
}

function mockGit() {
  const calls = [];
  return {
    calls,
    createBranch: async (name) => {
      calls.push(['createBranch', name]);
      return name;
    },
    listChangedFiles: async () => {
      calls.push(['listChangedFiles']);
      return [];
    },
    diff: async () => 'diff --git a/file b/file',
    diffStat: async () => ' 1 file changed',
    addAll: async () => {
      calls.push(['addAll']);
    },
    commit: async (message) => {
      calls.push(['commit', message]);
    },
    push: async (branch) => {
      calls.push(['push', branch]);
    },
    merge: async () => {
      const { assertMergeForbidden } = require('../../src/security/permissions');
      assertMergeForbidden();
    },
  };
}

function mockGithub(extra = {}) {
  const comments = [];
  const labels = [];
  const prs = [];
  const reviews = [];
  return {
    comments,
    labels,
    prs,
    reviews,
    getIssue: async (n) => sampleIssue({ number: n }),
    createIssueComment: async (number, body) => {
      comments.push({ number, body });
      return { id: 1, body };
    },
    addLabels: async (number, names) => {
      labels.push({ number, names });
      return names;
    },
    createPullRequest: async (pr) => {
      const created = { number: 99, html_url: 'https://example.com/pr/99', ...pr };
      prs.push(created);
      return created;
    },
    listPullFiles: async () => extra.files || [{ filename: 'frontend/src/App.jsx', status: 'modified', patch: '+console.log(1)' }],
    createPullReview: async (payload) => {
      reviews.push(payload);
      return { id: 2 };
    },
    createIssueCommentOnPr: async (number, body) => {
      comments.push({ number, body });
      return { id: 3, body };
    },
    getPullRequest: async (number) => ({
      number,
      title: 'PR',
      body: '',
      head: { ref: 'agentforge/issue-12' },
      base: { ref: 'main' },
      html_url: 'https://example.com/pr/' + number,
    }),
    listJobsForWorkflowRun: async () => extra.jobs || [],
    downloadJobLogs: async () => extra.logs || '##[group]Run npm run lint\nError: failed\n',
    mergePullRequest: async () => {
      const { assertMergeForbidden } = require('../../src/security/permissions');
      assertMergeForbidden();
    },
  };
}

function storeFor(config) {
  return createStore(config.dataDir);
}

module.exports = {
  tempDir,
  testConfig,
  samplePlan,
  sampleIssue,
  silentLogger,
  mockAi,
  mockGit,
  mockGithub,
  storeFor,
};
