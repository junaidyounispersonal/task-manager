'use strict';

const { createLogger } = require('./services/logger');
const { createStore } = require('./state/store');
const { createGitHubClient } = require('./github/client');
const { createAiProvider } = require('./services/ai-provider');
const { createGitService } = require('./services/git');
const { createChecks } = require('./services/checks');
const { createIssueAgent } = require('./agents/issue-agent');
const { createPrReviewAgent } = require('./agents/pr-review-agent');
const { createCiInvestigator } = require('./agents/ci-investigator');
const { createIssueToPrWorkflow } = require('./workflows/issue-to-pr');
const { createPrReviewWorkflow } = require('./workflows/pr-review');
const { createCiInvestigateWorkflow } = require('./workflows/ci-investigate');
const { authenticateAndParse } = require('./github/webhooks');
const { LABELS } = require('./constants');
const { WorkflowError } = require('./errors');

function createSystem(config, overrides = {}) {
  const logger = overrides.logger || createLogger({ level: config.logLevel });
  const store = overrides.store || createStore(overrides.dataDir || config.dataDir);
  const github =
    overrides.github !== undefined
      ? overrides.github
      : createGitHubClient({
          token: config.github.token,
          octokit: overrides.octokit,
          owner: config.target.owner,
          repo: config.target.repo,
          allowlist: config.target.allowlist,
        });
  const ai = overrides.ai || createAiProvider(config, overrides.aiOverrides || {});
  const git =
    overrides.git ||
    createGitService({
      repoPath: config.target.repoPath,
      defaultBranch: config.target.defaultBranch,
      userName: config.git.userName,
      userEmail: config.git.userEmail,
    });
  const checks =
    overrides.checks ||
    createChecks({
      repoPath: config.target.repoPath,
      commands: config.target.checks,
      lintScope: config.target.lintScope,
      listChangedFiles: git.listChangedFiles ? () => git.listChangedFiles() : undefined,
    });

  const issueAgent = createIssueAgent({ ai, target: config.target });
  const prReviewAgent = createPrReviewAgent({ ai });
  const ciInvestigator = createCiInvestigator({ ai });

  const issueToPr = createIssueToPrWorkflow({
    store,
    logger,
    github,
    issueAgent,
    git,
    checks,
    ai,
    target: config.target,
    maxAutoFixAttempts: config.maxAutoFixAttempts,
  });
  const prReview = createPrReviewWorkflow({
    store,
    logger,
    github,
    prReviewAgent,
    target: config.target,
  });
  const ciInvestigate = createCiInvestigateWorkflow({
    store,
    logger,
    github,
    ciInvestigator,
    target: config.target,
    maxAutoFixAttempts: config.maxAutoFixAttempts,
  });

  async function dispatchWebhook({ rawBody, signature, githubEvent }) {
    const parsed = authenticateAndParse({
      rawBody,
      signature,
      secret: config.github.webhookSecret,
      githubEvent,
      allowlist: config.target.allowlist,
    });
    return handleClassified(parsed);
  }

  async function handleClassified(parsed) {
    const { classified, payload } = parsed;
    if (classified.type === 'ignore') {
      return { ignored: true, reason: classified.reason };
    }

    if (classified.type === 'issue') {
      if (classified.action === 'labeled') {
        const labelName = payload.label?.name;
        if (labelName === LABELS.PLAN_APPROVED) {
          const run = await issueToPr.handleApproval({
            issueNumber: payload.issue.number,
            labels: payload.issue.labels,
          });
          return { workflow: 'issue-to-pr', status: run.status, runId: run.id };
        }
        return { ignored: true, reason: `label ${labelName}` };
      }
      const run = await issueToPr.startFromIssue(payload.issue);
      return { workflow: 'issue-to-pr', status: run.status, runId: run.id };
    }

    if (classified.type === 'issue_comment') {
      const run = await issueToPr.handleApproval({
        issueNumber: payload.issue.number,
        commentBody: payload.comment?.body,
        labels: payload.issue.labels,
      });
      return { workflow: 'issue-to-pr', status: run.status, runId: run.id };
    }

    if (classified.type === 'pull_request') {
      const run = await prReview.reviewPullRequest(payload.pull_request);
      return { workflow: 'pr-review', status: run.status, runId: run.id };
    }

    if (classified.type === 'ci_failure') {
      const workflowRun = payload.workflow_run || {
        name: payload.check_suite?.app?.name || 'check_suite',
        id: payload.check_suite?.id,
        pull_requests: payload.check_suite?.pull_requests || [],
      };
      const run = await ciInvestigate.handleFailure({
        workflowRun,
        prNumber: workflowRun.pull_requests?.[0]?.number,
      });
      return { workflow: 'ci-investigate', status: run.status, runId: run.id };
    }

    throw new WorkflowError(`Unhandled webhook type ${classified.type}`, {
      code: 'MALFORMED_WEBHOOK',
      status: 'STOPPED',
    });
  }

  return {
    config,
    logger,
    store,
    github,
    ai,
    git,
    checks,
    issueToPr,
    prReview,
    ciInvestigate,
    dispatchWebhook,
    handleClassified,
  };
}

module.exports = { createSystem };
