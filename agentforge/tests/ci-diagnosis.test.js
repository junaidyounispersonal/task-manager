'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCiLogs } = require('../src/services/ci-logs');
const { createSystem } = require('../src/system');
const { STATUSES } = require('../src/constants');
const { testConfig, mockGithub, silentLogger } = require('./helpers/config');

const SAMPLE_LOG = `
Workflow: CI
##[group]Run npm run lint
> frontend@0.0.0 lint
Error: no-unused-vars
##[error]Process completed with exit code 1
`;

test('parseCiLogs identifies failed step and error lines', () => {
  const parsed = parseCiLogs(SAMPLE_LOG);
  assert.equal(parsed.failedWorkflow, 'CI');
  assert.match(parsed.failedStep, /npm run lint/);
  assert.match(parsed.error, /no-unused-vars|exit code/i);
});

test('CI investigator posts diagnosis and does not modify code', async () => {
  const github = mockGithub({ logs: SAMPLE_LOG });
  const config = testConfig({ maxAutoFixAttempts: 0 });
  const system = createSystem(config, {
    logger: silentLogger(),
    github,
    ai: {
      generateDiagnosis: async () => ({
        failedWorkflow: 'CI',
        failedStep: 'npm run lint',
        error: 'no-unused-vars',
        probableRootCause: 'Unused import in App.jsx',
        relevantFiles: ['frontend/src/App.jsx'],
        suggestedFix: 'Remove the unused import',
        confidence: 'high',
      }),
    },
    git: { createBranch: async () => assert.fail('must not create a branch on CI diagnosis') },
    checks: { runAll: async () => assert.fail('must not run checks as a fix') },
  });

  const run = await system.ciInvestigate.handleFailure({
    workflowRun: { name: 'CI', id: 44, pull_requests: [{ number: 5 }] },
    prNumber: 5,
    logs: SAMPLE_LOG,
  });

  assert.equal(run.status, STATUSES.CI_DIAGNOSIS_COMPLETED);
  assert.equal(run.diagnosis.confidence, 'high');
  assert.ok(github.comments.some((c) => c.body.includes('diagnosis only')));
  assert.equal(run.autoFixAttempts, 0);
});
