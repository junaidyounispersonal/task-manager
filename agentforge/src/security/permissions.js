'use strict';

const { WorkflowError } = require('../errors');
const { PROTECTED_BRANCHES } = require('../constants');
const { fullName } = require('../config/target');

function assertRepoAllowed(owner, repo, allowlist) {
  const name = fullName(owner, repo);
  const allowed = (allowlist || []).map((item) => item.toLowerCase());
  if (!allowed.includes(name)) {
    throw new WorkflowError(`Repository ${owner}/${repo} is not on GITHUB_REPO_ALLOWLIST`, {
      code: 'REPO_NOT_ALLOWED',
      status: 'STOPPED',
      details: { owner, repo },
    });
  }
  return true;
}

function isProtectedBranch(branch, defaultBranch) {
  const name = String(branch || '').replace(/^refs\/heads\//, '').toLowerCase();
  const def = String(defaultBranch || 'main').toLowerCase();
  return name === def || PROTECTED_BRANCHES.includes(name);
}

function assertSafeFeatureBranch(branch, defaultBranch) {
  if (!branch || typeof branch !== 'string') {
    throw new WorkflowError('Branch name is required', { code: 'BRANCH_INVALID' });
  }
  if (isProtectedBranch(branch, defaultBranch)) {
    throw new WorkflowError(`Refusing to use protected branch "${branch}" as a feature branch`, {
      code: 'PROTECTED_BRANCH',
      status: 'STOPPED',
    });
  }
  if (branch.includes('..') || branch.startsWith('-') || /[\s~^:?*[@\\]/.test(branch)) {
    throw new WorkflowError(`Unsafe branch name: ${branch}`, { code: 'BRANCH_INVALID' });
  }
}

function assertCanPush(branch, defaultBranch) {
  if (isProtectedBranch(branch, defaultBranch)) {
    throw new WorkflowError(`Refusing to push to protected branch "${branch}"`, {
      code: 'PUSH_DENIED',
      status: 'STOPPED',
    });
  }
  assertSafeFeatureBranch(branch, defaultBranch);
}

function assertMergeForbidden() {
  throw new WorkflowError('AgentForge must never merge pull requests. A human must merge.', {
    code: 'MERGE_DENIED',
    status: 'STOPPED',
  });
}

function assertDeployForbidden() {
  throw new WorkflowError('AgentForge must never deploy to production.', {
    code: 'DEPLOY_DENIED',
    status: 'STOPPED',
  });
}

function assertYoloForbidden(yolo) {
  if (yolo) {
    throw new WorkflowError('Hermes --yolo is forbidden', { code: 'YOLO_FORBIDDEN', status: 'STOPPED' });
  }
}

module.exports = {
  assertRepoAllowed,
  isProtectedBranch,
  assertSafeFeatureBranch,
  assertCanPush,
  assertMergeForbidden,
  assertDeployForbidden,
  assertYoloForbidden,
};
