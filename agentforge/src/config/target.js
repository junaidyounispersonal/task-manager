'use strict';

const path = require('path');
const { WorkflowError } = require('../errors');

function parseAllowlist(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function fullName(owner, repo) {
  return `${owner}/${repo}`.toLowerCase();
}

/**
 * Per-project settings. Nothing here imports the Task Manager app.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} agentforgeRoot
 */
function loadTarget(env, agentforgeRoot) {
  const owner = (env.GITHUB_OWNER || '').trim();
  const repo = (env.GITHUB_REPO || '').trim();
  const defaultBranch = (env.GITHUB_DEFAULT_BRANCH || 'main').trim();
  const relativePath = env.TARGET_REPO_PATH || '..';
  const repoPath = path.resolve(agentforgeRoot, relativePath);
  const allowlist = parseAllowlist(
    env.GITHUB_REPO_ALLOWLIST || (owner && repo ? `${owner}/${repo}` : '')
  );

  if (!owner || !repo) {
    throw new WorkflowError('GITHUB_OWNER and GITHUB_REPO are required', {
      code: 'CONFIG_INVALID',
    });
  }

  if (allowlist.length === 0) {
    throw new WorkflowError('GITHUB_REPO_ALLOWLIST must contain at least one owner/repo', {
      code: 'CONFIG_INVALID',
    });
  }

  return {
    owner,
    repo,
    fullName: fullName(owner, repo),
    defaultBranch,
    repoPath,
    allowlist,
    checks: {
      lint: (env.CHECK_LINT || '').trim(),
      build: (env.CHECK_BUILD || '').trim(),
      test: (env.CHECK_TEST || '').trim(),
    },
    lintScope: (env.CHECK_LINT_SCOPE || 'changed').trim().toLowerCase() || 'changed',
  };
}

module.exports = { loadTarget, parseAllowlist, fullName };
