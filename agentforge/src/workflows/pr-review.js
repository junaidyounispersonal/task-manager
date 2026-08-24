'use strict';

const { STATUSES, EVENTS } = require('../constants');
const { WorkflowError } = require('../errors');

function createPrReviewWorkflow(deps) {
  const { store, logger, github, prReviewAgent, target } = deps;

  async function reviewPullRequest(rawPr) {
    logger.event(EVENTS.WORKFLOW_STARTED, { workflow: 'pr-review' });
    const pr = prReviewAgent.receive(rawPr);
    const run = store.create({
      workflow: 'pr-review',
      status: STATUSES.RECEIVED,
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.number,
      pr,
    });

    try {
      if (!github) {
        throw new WorkflowError('GitHub client is required for PR review', {
          code: 'GITHUB_AUTH_MISSING',
          status: 'STOPPED',
        });
      }
      const files = await github.listPullFiles(pr.number);
      const result = await prReviewAgent.review({ pr, files });
      await github.createPullReview({
        pullNumber: pr.number,
        body: result.body,
        event: 'COMMENT',
        comments: result.comments,
      });
      logger.event(EVENTS.PR_REVIEW_COMPLETED, {
        runId: run.id,
        prNumber: pr.number,
        findingCount: result.findings.length,
      });
      return store.update(run.id, {
        status: STATUSES.REVIEW_COMPLETED,
        findings: result.findings,
      });
    } catch (err) {
      logger.error(EVENTS.WORKFLOW_STOPPED, { runId: run.id, error: err.message, code: err.code });
      return store.update(run.id, {
        status: err.status || STATUSES.FAILED,
        error: { code: err.code || 'WORKFLOW_ERROR', message: err.message },
      });
    }
  }

  return { reviewPullRequest };
}

module.exports = { createPrReviewWorkflow };
