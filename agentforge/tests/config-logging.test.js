'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../src/security/redaction');
const { createLogger } = require('../src/services/logger');
const { loadTarget } = require('../src/config/target');
const { loadConfig } = require('../src/config');
const { createAiProvider } = require('../src/services/ai-provider');
const { EVENTS } = require('../src/constants');
const path = require('path');

test('redaction strips tokens and secret keys', () => {
  const out = redact({
    token: 'github_pat_abcdefghijklmnop',
    nested: { GITHUB_TOKEN: 'ghp_1234567890abcd' },
    note: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
  });
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.nested.GITHUB_TOKEN, '[REDACTED]');
  assert.equal(out.note.includes('Bearer '), false);
});

test('logger never emits raw secrets', () => {
  const lines = [];
  const log = createLogger({ level: 'info', write: (line) => lines.push(line) });
  log.event(EVENTS.WORKFLOW_STARTED, { GITHUB_TOKEN: 'ghp_secretvalue12', ok: true });
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).GITHUB_TOKEN, '[REDACTED]');
  assert.equal(JSON.parse(lines[0]).ok, true);
});

test('target config is env-driven and does not hardcode a second repo', () => {
  const target = loadTarget(
    {
      GITHUB_OWNER: 'acme',
      GITHUB_REPO: 'other',
      GITHUB_REPO_ALLOWLIST: 'acme/other',
      TARGET_REPO_PATH: '.',
      CHECK_TEST: 'pytest',
    },
    path.resolve(__dirname, '../')
  );
  assert.equal(target.fullName, 'acme/other');
  assert.equal(target.checks.test, 'pytest');
  assert.equal(target.lintScope, 'changed');
  assert.ok(target.allowlist.includes('acme/other'));
});

test('HERMES_YOLO cannot be enabled via config', () => {
  assert.throws(
    () =>
      loadConfig(
        {
          GITHUB_OWNER: 'a',
          GITHUB_REPO: 'b',
          GITHUB_REPO_ALLOWLIST: 'a/b',
          TARGET_REPO_PATH: '.',
          HERMES_YOLO: 'true',
        },
        { skipDotenv: true }
      ),
    /YOLO/
  );
});

test('unknown AI provider fails closed', () => {
  assert.throws(
    () =>
      createAiProvider({
        ai: { provider: 'mystery', hermesBin: 'hermes', hermesSkills: [], timeoutMs: 1 },
        target: { repoPath: process.cwd() },
      }),
    /Unsupported AI_AGENT_PROVIDER/
  );
});
