'use strict';

const { STATUSES, LABELS, EVENTS } = require('../constants');
const { WorkflowError } = require('../errors');
const { parseApprovalComment, hasApprovedLabel } = require('../github/issues');

function createIssueToPrWorkflow(deps) {
  const { store, logger, github, issueAgent, git, checks, ai, target, maxAutoFixAttempts } = deps;

  async function startFromIssue(rawIssue) {
    logger.event(EVENTS.WORKFLOW_STARTED, { workflow: 'issue-to-pr' });
    const issue = issueAgent.receive(rawIssue);
    logger.event(EVENTS.ISSUE_RECEIVED, { issueNumber: issue.number, title: issue.title });

    const existing = store.findByIssue(target.owner, target.repo, issue.number);
    if (existing && existing.status === STATUSES.PENDING_PLAN_APPROVAL && existing.plan) {
      logger.event(EVENTS.PLAN_GENERATED, {
        runId: existing.id,
        issueNumber: issue.number,
        reused: true,
      });
      return existing;
    }

    const run = store.create({
      workflow: 'issue-to-pr',
      status: STATUSES.ANALYZING,
      owner: target.owner,
      repo: target.repo,
      issueNumber: issue.number,
      issue,
    });

    try {
      const { plan } = await issueAgent.analyzeAndPlan(issue);
      logger.event(EVENTS.PLAN_GENERATED, { runId: run.id, issueNumber: issue.number });
      const body = issueAgent.planComment(plan, run.id);
      let githubWarning = null;
      if (github) {
        try {
          await github.createIssueComment(issue.number, body);
          await github.addLabels(issue.number, [LABELS.PENDING_PLAN]);
        } catch (err) {
          if (err.code !== 'GITHUB_PERMISSIONS') throw err;
          githubWarning = err.message;
          logger.warn('github.comment.skipped', {
            runId: run.id,
            code: err.code,
            error: err.message,
            note: 'Plan is saved locally. Approve with: node src/index.js approve --issue <n>. Grant Issues: Read and write on the fine-grained PAT to post comments on GitHub.',
          });
        }
      }
      return store.update(run.id, {
        status: STATUSES.PENDING_PLAN_APPROVAL,
        plan,
        planComment: body,
        githubWarning,
      });
    } catch (err) {
      return fail(run.id, err);
    }
  }

  async function handleApproval({ issueNumber, commentBody, labels }) {
    const run = store.findByIssue(target.owner, target.repo, issueNumber);
    if (!run) {
      throw new WorkflowError('No AgentForge run found for this issue', {
        code: 'RUN_NOT_FOUND',
        status: 'STOPPED',
      });
    }
    if (run.status !== STATUSES.PENDING_PLAN_APPROVAL) {
      if (canRetryImplement(run)) {
        throw new WorkflowError(
          `Run ${run.id} is ${run.status}, not waiting for plan approval. Retry implementation with: node src/index.js retry --issue ${issueNumber}`,
          { code: 'INVALID_STATE', status: 'STOPPED' }
        );
      }
      throw new WorkflowError(`Run ${run.id} is not waiting for plan approval (status ${run.status})`, {
        code: 'INVALID_STATE',
        status: 'STOPPED',
      });
    }

    const fromComment = commentBody ? parseApprovalComment(commentBody) : null;
    const fromLabel = hasApprovedLabel(labels);
    if (fromComment === 'reject') {
      logger.event(EVENTS.WORKFLOW_STOPPED, { runId: run.id, reason: 'rejected' });
      return store.update(run.id, { status: STATUSES.REJECTED });
    }
    if (fromComment !== 'approve' && !fromLabel) {
      return run;
    }

    logger.event(EVENTS.HUMAN_APPROVAL_RECEIVED, { runId: run.id, issueNumber });
    store.update(run.id, { status: STATUSES.APPROVED, approved: true });
    return implement(run.id);
  }

  function canRetryImplement(run) {
    if (!run || !run.plan) return false;
    if (
      run.status === STATUSES.PR_CREATED ||
      run.status === STATUSES.REJECTED ||
      run.status === STATUSES.PENDING_PLAN_APPROVAL
    ) {
      return false;
    }
    return Boolean(run.approved || run.branch);
  }

  async function retryImplement({ issueNumber, runId }) {
    const run = runId
      ? store.get(runId)
      : store.list().find(
          (item) =>
            item.owner === target.owner &&
            item.repo === target.repo &&
            Number(item.issueNumber) === Number(issueNumber) &&
            item.workflow === 'issue-to-pr' &&
            canRetryImplement(item)
        );
    if (!run) {
      throw new WorkflowError('No approved AgentForge run found to retry', {
        code: 'RUN_NOT_FOUND',
        status: 'STOPPED',
      });
    }
    if (!canRetryImplement(run)) {
      throw new WorkflowError(`Run ${run.id} cannot retry implementation (status ${run.status})`, {
        code: 'INVALID_STATE',
        status: 'STOPPED',
      });
    }
    logger.event(EVENTS.IMPLEMENTATION_RETRY, { runId: run.id, issueNumber: run.issueNumber });
    return implement(run.id);
  }

  async function implement(runId) {
    const run = store.get(runId);
    const branch = `agentforge/issue-${run.issueNumber}`;
    try {
      store.update(runId, { status: STATUSES.IMPLEMENTING, branch });
      await git.createBranch(branch);
      logger.event(EVENTS.BRANCH_CREATED, { runId, branch });

      logger.event(EVENTS.IMPLEMENTATION_STARTED, { runId, branch });
      await ai.implement({
        issue: run.issue,
        plan: run.plan,
        branch,
        checks: target.checks,
      });

      const checkResults = await runChecksWithAutoFix(runId, { ...run, branch });

      const diff = await git.diff();
      store.update(runId, { status: STATUSES.PUSHING, diffStat: (await git.diffStat()).slice(0, 4000) });
      await git.addAll();
      await git.commit(`feat: implement #${run.issueNumber} via AgentForge\n\nApproved plan run ${runId}. Do not merge without human review.`);
      await git.push(branch);

      if (!github) {
        throw new WorkflowError('GitHub client is required to open a pull request', {
          code: 'GITHUB_AUTH_MISSING',
          status: 'STOPPED',
        });
      }

      const pr = await github.createPullRequest({
        title: `AgentForge: ${run.issue?.title || `issue #${run.issueNumber}`}`,
        head: branch,
        base: target.defaultBranch,
        body: [
          `Closes #${run.issueNumber}`,
          '',
          'Opened by AgentForge after human plan approval.',
          '**Do not merge without a human review. AgentForge will not merge this PR.**',
          '',
          `Run ID: \`${runId}\``,
          '',
          '## Plan',
          run.plan?.implementation || '',
        ].join('\n'),
      });

      logger.event(EVENTS.PR_CREATED, { runId, prNumber: pr.number, branch });
      return store.update(runId, {
        status: STATUSES.PR_CREATED,
        prNumber: pr.number,
        prUrl: pr.html_url,
        diffPreview: diff.slice(0, 4000),
      });
    } catch (err) {
      return fail(runId, err);
    }
  }

  async function runChecksWithAutoFix(runId, run) {
    const limit = Math.max(0, Number(maxAutoFixAttempts) || 0);
    let lastErr = null;
    for (let attempt = 0; attempt <= limit; attempt += 1) {
      if (attempt > 0) {
        logger.event(EVENTS.AUTO_FIX_STARTED, {
          runId,
          attempt,
          maxAutoFixAttempts: limit,
          check: lastErr?.details?.name,
        });
        store.update(runId, { status: STATUSES.IMPLEMENTING, autoFixAttempts: attempt });
        const fixer = ai.fixChecks || ai.implement;
        await fixer({
          issue: run.issue,
          plan: run.plan,
          branch: run.branch,
          checks: target.checks,
          checkName: lastErr?.details?.name,
          command: lastErr?.details?.command,
          output: lastErr?.details?.output,
          attempt,
          maxAttempts: limit,
        });
      }

      store.update(runId, { status: STATUSES.CHECKS, autoFixAttempts: attempt });
      logger.event(EVENTS.TESTS_STARTED, { runId, autoFixAttempts: attempt });
      try {
        const checkResults = await checks.runAll();
        logger.event(EVENTS.TESTS_COMPLETED, {
          runId,
          results: checkResults.map((r) => ({ name: r.name, ok: r.ok, skipped: r.skipped })),
        });
        return checkResults;
      } catch (err) {
        lastErr = err;
        logger.warn(EVENTS.CHECKS_FAILED, {
          runId,
          attempt,
          maxAutoFixAttempts: limit,
          error: err.message,
          command: err.details?.command,
          output: err.details?.output,
        });
        if (err.code !== 'CHECKS_FAILED' || attempt >= limit) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  function fail(runId, err) {
    const message = err.message || String(err);
    const code = err.code || 'WORKFLOW_ERROR';
    const output = err.details?.output || [err.details?.stdout, err.details?.stderr].filter(Boolean).join('\n') || null;
    logger.error(EVENTS.WORKFLOW_STOPPED, {
      runId,
      code,
      error: message,
      preview: err.details?.preview,
      command: err.details?.command,
      output,
    });
    const status = err.status || STATUSES.FAILED;
    try {
      return store.update(runId, {
        status,
        error: {
          code,
          message,
          preview: err.details?.preview || null,
          command: err.details?.command || null,
          output,
        },
      });
    } catch {
      throw err;
    }
  }

  return { startFromIssue, handleApproval, implement, retryImplement, fail };
}

module.exports = { createIssueToPrWorkflow };
