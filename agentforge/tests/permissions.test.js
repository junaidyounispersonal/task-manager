'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRepoAllowed,
  assertCanPush,
  assertMergeForbidden,
  assertDeployForbidden,
  assertYoloForbidden,
  assertSafeFeatureBranch,
} = require('../src/security/permissions');
const { createGitService } = require('../src/services/git');
const { FORBIDDEN_FLAGS, resolveHermesBin, isDesktopHermes, detectProviderError, stripHermesNoise } = require('../src/services/hermes-cli');

test('permission checks reject repos outside the allowlist', () => {
  assert.throws(
    () => assertRepoAllowed('other', 'secrets', ['junaidyounispersonal/task-manager']),
    /not on GITHUB_REPO_ALLOWLIST/
  );
  assert.equal(
    assertRepoAllowed('junaidyounispersonal', 'task-manager', ['junaidyounispersonal/task-manager']),
    true
  );
});

test('cannot use or push protected branches', () => {
  assert.throws(() => assertSafeFeatureBranch('main', 'main'), /protected branch/);
  assert.throws(() => assertCanPush('main', 'main'), /protected branch/);
  assert.throws(() => assertCanPush('production', 'main'), /protected branch/);
  assertSafeFeatureBranch('agentforge/issue-1', 'main');
});

test('merge and deploy are always denied', () => {
  assert.throws(() => assertMergeForbidden(), /never merge/);
  assert.throws(() => assertDeployForbidden(), /never deploy/);
});

test('git service merge is denied', async () => {
  const git = createGitService({
    repoPath: process.cwd(),
    defaultBranch: 'main',
    userName: 'x',
    userEmail: 'y',
  });
  await assert.rejects(() => git.merge(), /never merge/);
});

test('yolo is forbidden and hermes adapter rejects the flag', () => {
  assert.throws(() => assertYoloForbidden(true), /yolo/i);
  assert.ok(FORBIDDEN_FLAGS.has('--yolo'));
});

test('Hermes resolver skips the desktop exe', () => {
  assert.equal(
    isDesktopHermes('C:\\Users\\me\\AppData\\Local\\hermes\\hermes-agent\\apps\\desktop\\release\\win-unpacked\\Hermes.exe'),
    true
  );
  const resolved = resolveHermesBin(
    'C:\\Users\\me\\AppData\\Local\\hermes\\hermes-agent\\apps\\desktop\\release\\win-unpacked\\Hermes.exe'
  );
  assert.equal(isDesktopHermes(resolved), false);
});

test('detectProviderError catches OpenRouter 402 text', () => {
  assert.ok(
    detectProviderError('Billing or credits exhausted: HTTP 402: This request requires more credits')
  );
  assert.equal(detectProviderError('{"summary":"ok"}'), null);
});

test('stripHermesNoise drops deprecation banners and session ids', () => {
  const raw =
    '\u001b[33m⚠ Deprecated .env settings detected:\u001b[0m\n  TERMINAL_CWD=E:\\Agent Forge\\task-manager found in .env — this is deprecated.\n  Then remove the old entries from ~/AppData\\Local\\hermes/.env\n\nsession_id: 20260820_193905_6bfad3\n';
  assert.equal(stripHermesNoise(raw), '');
});
