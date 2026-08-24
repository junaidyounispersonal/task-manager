'use strict';

const { WorkflowError } = require('../errors');
const { verifyGitHubSignature } = require('../security/webhook-verify');
const { assertRepoAllowed } = require('../security/permissions');
const { fullName } = require('../config/target');

function parseJsonBody(rawBody) {
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    return JSON.parse(text);
  } catch {
    throw new WorkflowError('Malformed webhook JSON', { code: 'MALFORMED_WEBHOOK', status: 'STOPPED' });
  }
}

function repoFromPayload(payload) {
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (!owner || !repo) {
    throw new WorkflowError('Webhook payload is missing repository owner/name', {
      code: 'MALFORMED_WEBHOOK',
      status: 'STOPPED',
    });
  }
  return { owner, repo };
}

function classifyEvent(githubEvent, payload) {
  const action = payload.action;
  if (githubEvent === 'issues' && (action === 'opened' || action === 'reopened' || action === 'labeled')) {
    if (payload.issue?.pull_request) return { type: 'ignore', reason: 'issue is a pull request' };
    return { type: 'issue', action };
  }
  if (githubEvent === 'issue_comment' && action === 'created') {
    return { type: 'issue_comment', action };
  }
  if (githubEvent === 'pull_request' && (action === 'opened' || action === 'synchronize' || action === 'reopened')) {
    return { type: 'pull_request', action };
  }
  if (githubEvent === 'workflow_run' && action === 'completed' && payload.workflow_run?.conclusion === 'failure') {
    return { type: 'ci_failure', action };
  }
  if (githubEvent === 'check_suite' && action === 'completed' && payload.check_suite?.conclusion === 'failure') {
    return { type: 'ci_failure', action };
  }
  return { type: 'ignore', reason: `${githubEvent}.${action || 'unknown'}` };
}

function authenticateAndParse({ rawBody, signature, secret, githubEvent, allowlist }) {
  if (!githubEvent) {
    throw new WorkflowError('Missing X-GitHub-Event header', { code: 'MALFORMED_WEBHOOK', status: 'STOPPED' });
  }
  verifyGitHubSignature(rawBody, signature, secret);
  const payload = parseJsonBody(rawBody);
  const { owner, repo } = repoFromPayload(payload);
  assertRepoAllowed(owner, repo, allowlist);
  if (payload.repository?.fork) {
    throw new WorkflowError('Ignoring webhook from a forked repository', {
      code: 'FORK_IGNORED',
      status: 'STOPPED',
    });
  }
  const classified = classifyEvent(githubEvent, payload);
  return { owner, repo, fullName: fullName(owner, repo), payload, classified };
}

module.exports = {
  parseJsonBody,
  repoFromPayload,
  classifyEvent,
  authenticateAndParse,
};
