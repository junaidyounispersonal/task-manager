'use strict';

const STATUSES = Object.freeze({
  RECEIVED: 'RECEIVED',
  ANALYZING: 'ANALYZING',
  PENDING_PLAN_APPROVAL: 'PENDING_PLAN_APPROVAL',
  APPROVED: 'APPROVED',
  IMPLEMENTING: 'IMPLEMENTING',
  CHECKS: 'CHECKS',
  PUSHING: 'PUSHING',
  PR_CREATED: 'PR_CREATED',
  REVIEW_COMPLETED: 'REVIEW_COMPLETED',
  CI_FAILURE_RECEIVED: 'CI_FAILURE_RECEIVED',
  CI_DIAGNOSIS_COMPLETED: 'CI_DIAGNOSIS_COMPLETED',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
});

const LABELS = Object.freeze({
  PENDING_PLAN: 'agentforge:pending-plan',
  PLAN_APPROVED: 'agentforge:plan-approved',
  STOPPED: 'agentforge:stopped',
});

const EVENTS = Object.freeze({
  WORKFLOW_STARTED: 'workflow.started',
  ISSUE_RECEIVED: 'issue.received',
  PLAN_GENERATED: 'plan.generated',
  HUMAN_APPROVAL_RECEIVED: 'human.approval.received',
  BRANCH_CREATED: 'branch.created',
  IMPLEMENTATION_STARTED: 'implementation.started',
  TESTS_STARTED: 'tests.started',
  TESTS_COMPLETED: 'tests.completed',
  CHECKS_FAILED: 'checks.failed',
  AUTO_FIX_STARTED: 'autofix.started',
  IMPLEMENTATION_RETRY: 'implementation.retry',
  PR_CREATED: 'pr.created',
  PR_REVIEW_COMPLETED: 'pr.review.completed',
  CI_FAILURE_RECEIVED: 'ci.failure.received',
  CI_DIAGNOSIS_COMPLETED: 'ci.diagnosis.completed',
  WORKFLOW_STOPPED: 'workflow.stopped',
});

const SEVERITIES = Object.freeze([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'SUGGESTION',
]);

const APPROVE_COMMAND = '/agentforge approve';
const REJECT_COMMAND = '/agentforge reject';

const PROTECTED_BRANCHES = Object.freeze(['main', 'master', 'production', 'prod']);

module.exports = {
  STATUSES,
  LABELS,
  EVENTS,
  SEVERITIES,
  APPROVE_COMMAND,
  REJECT_COMMAND,
  PROTECTED_BRANCHES,
};
