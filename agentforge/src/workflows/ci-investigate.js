'use strict';

const { STATUSES, EVENTS } = require('../constants');
const { WorkflowError } = require('../errors');

function createCiInvestigateWorkflow(deps) {
  const { store, logger, github, ciInvestigator, target } = deps;

  async function handleFailure({ workflowRun, prNumber, logs }) {
    logger.event(EVENTS.CI_FAILURE_RECEIVED, {
      workflow: workflowRun?.name,
      runId: workflowRun?.id,
      prNumber,
    });

    const run = store.create({
      workflow: 'ci-investigate',
      status: STATUSES.CI_FAILURE_RECEIVED,
      owner: target.owner,
      repo: target.repo,
      prNumber: prNumber || workflowRun?.pull_requests?.[0]?.number || null,
      workflowRunId: workflowRun?.id || null,
      autoFixAttempts: 0,
    });

    try {
      let logText = logs || '';
      if (!logText && github && workflowRun?.id) {
        const jobs = await github.listJobsForWorkflowRun(workflowRun.id);
        const failed = jobs.filter((job) => job.conclusion === 'failure');
        const parts = [];
        for (const job of failed.slice(0, 3)) {
          try {
            parts.push(await github.downloadJobLogs(job.id));
          } catch {
            parts.push(`(could not download logs for job ${job.name})`);
          }
        }
        logText = parts.join('\n');
      }
      if (!logText) {
        throw new WorkflowError('No CI logs available to diagnose', {
          code: 'CI_LOGS_MISSING',
          status: 'STOPPED',
        });
      }

      const pr = run.prNumber && github ? await github.getPullRequest(run.prNumber).catch(() => null) : null;
      const { diagnosis, comment } = await ciInvestigator.diagnose({
        logs: logText,
        pr,
        workflowName: workflowRun?.name,
      });

      if (github && run.prNumber) {
        await github.createIssueCommentOnPr(run.prNumber, comment);
      }

      logger.event(EVENTS.CI_DIAGNOSIS_COMPLETED, { runId: run.id, confidence: diagnosis.confidence });

      return store.update(run.id, {
        status: STATUSES.CI_DIAGNOSIS_COMPLETED,
        diagnosis,
      });
    } catch (err) {
      logger.error(EVENTS.WORKFLOW_STOPPED, { runId: run.id, error: err.message, code: err.code });
      return store.update(run.id, {
        status: err.status || STATUSES.FAILED,
        error: { code: err.code || 'WORKFLOW_ERROR', message: err.message },
      });
    }
  }

  return { handleFailure };
}

module.exports = { createCiInvestigateWorkflow };
