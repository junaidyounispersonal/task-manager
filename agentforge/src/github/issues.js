'use strict';

const { APPROVE_COMMAND, REJECT_COMMAND, LABELS } = require('../constants');

function parseIssue(issue) {
  if (!issue || typeof issue !== 'object') {
    throw Object.assign(new Error('Malformed GitHub issue payload'), { code: 'MALFORMED_ISSUE' });
  }
  const number = issue.number;
  const title = issue.title;
  if (!number || !title) {
    throw Object.assign(new Error('Issue is missing number or title'), { code: 'MALFORMED_ISSUE' });
  }
  return {
    number,
    title: String(title),
    body: issue.body ? String(issue.body) : '',
    labels: (issue.labels || []).map((label) => (typeof label === 'string' ? label : label.name)).filter(Boolean),
    url: issue.html_url || '',
    user: issue.user?.login || '',
    state: issue.state || 'open',
    pullRequest: Boolean(issue.pull_request),
  };
}

function parseApprovalComment(body) {
  if (!body || typeof body !== 'string') return null;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  for (const line of lines) {
    if (line === APPROVE_COMMAND || line.startsWith(`${APPROVE_COMMAND} `)) return 'approve';
    if (line === REJECT_COMMAND || line.startsWith(`${REJECT_COMMAND} `)) return 'reject';
  }
  return null;
}

function hasApprovedLabel(labels) {
  const names = (labels || []).map((label) => (typeof label === 'string' ? label : label.name));
  return names.includes(LABELS.PLAN_APPROVED);
}

function formatPlanComment(plan, runId) {
  const files = (plan.expectedFiles || []).map((f) => `- \`${f}\``).join('\n') || '- (none listed)';
  return [
    '## AgentForge implementation plan',
    '',
    `Run ID: \`${runId}\``,
    `State: \`PENDING_PLAN_APPROVAL\``,
    '',
    '### Issue summary',
    plan.summary || '',
    '',
    '### Understanding of requirements',
    plan.requirements || '',
    '',
    '### Files expected to change',
    files,
    '',
    '### Proposed implementation',
    plan.implementation || '',
    '',
    '### Testing strategy',
    plan.testing || '',
    '',
    '### Potential risks',
    plan.risks || '',
    '',
    '---',
    'Human approval required before any significant code changes.',
    '',
    `Reply with \`${APPROVE_COMMAND}\` or add the \`${LABELS.PLAN_APPROVED}\` label to continue.`,
    `Reply with \`${REJECT_COMMAND}\` to stop.`,
  ].join('\n');
}

module.exports = {
  parseIssue,
  parseApprovalComment,
  hasApprovedLabel,
  formatPlanComment,
};
