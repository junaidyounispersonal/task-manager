'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIssueAgent } = require('../src/agents/issue-agent');
const { createAiProvider, validatePlan } = require('../src/services/ai-provider');
const { extractJson } = require('../src/services/json-extract');
const { testConfig, sampleIssue, samplePlan } = require('./helpers/config');

test('extractJson reads fenced, raw, and prose-wrapped objects', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('here\n```json\n{"b":2}\n```'), { b: 2 });
  assert.deepEqual(extractJson('Sure.\n{"summary":"ok","requirements":"x"}\nThanks.'), {
    summary: 'ok',
    requirements: 'x',
  });
});

test('validatePlan requires required fields', () => {
  assert.equal(validatePlan(samplePlan()), true);
  assert.equal(validatePlan({ summary: 'x' }), false);
});

test('normalizePlan accepts expectedFiles as a string', async () => {
  const { normalizePlan, validatePlan: validate } = require('../src/services/ai-provider');
  const plan = normalizePlan({
    summary: 's',
    requirements: 'r',
    expectedFiles: 'frontend/src/pages/Login.jsx, frontend/src/index.css',
    implementation: 'i',
    testing: 't',
    risks: 'k',
  });
  assert.equal(validate(plan), true);
  assert.deepEqual(plan.expectedFiles, ['frontend/src/pages/Login.jsx', 'frontend/src/index.css']);
});

test('issue agent produces a plan via AI provider', async () => {
  const config = testConfig();
  const ai = createAiProvider(config, {
    generatePlan: async () => samplePlan({ summary: 'Health check route' }),
  });
  const agent = createIssueAgent({ ai, target: config.target });
  const issue = agent.receive(sampleIssue());
  const { plan } = await agent.analyzeAndPlan(issue);
  assert.equal(plan.summary, 'Health check route');
  assert.ok(Array.isArray(plan.expectedFiles));
  const comment = agent.planComment(plan, 'run_1');
  assert.match(comment, /PENDING_PLAN_APPROVAL/);
  assert.match(comment, /\/agentforge approve/);
});

test('invalid AI plan stops the workflow', async () => {
  const config = testConfig();
  const ai = createAiProvider(config, {
    generatePlan: async () => 'not json at all',
  });
  const agent = createIssueAgent({ ai, target: config.target });
  await assert.rejects(() => agent.analyzeAndPlan(agent.receive(sampleIssue())), /not a valid implementation plan/);
});

test('OpenRouter billing text is reported as AI_PROVIDER_FAILED', async () => {
  const config = testConfig();
  const ai = createAiProvider(config, {
    generatePlan: async () =>
      'Billing or credits exhausted: HTTP 402: This request requires more credits',
  });
  const agent = createIssueAgent({ ai, target: config.target });
  await assert.rejects(
    () => agent.analyzeAndPlan(agent.receive(sampleIssue())),
    /billing failed/i
  );
});
