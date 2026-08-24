'use strict';

const { parseIssue, formatPlanComment } = require('../github/issues');
const { analyzeRepository } = require('../services/repo-inspect');
const { WorkflowError } = require('../errors');

function createIssueAgent({ ai, target }) {
  function receive(rawIssue) {
    const issue = parseIssue(rawIssue);
    if (issue.pullRequest) {
      throw new WorkflowError('Refusing to treat a pull request as an issue workflow', {
        code: 'MALFORMED_ISSUE',
        status: 'STOPPED',
      });
    }
    return issue;
  }

  async function analyzeAndPlan(issue) {
    const repo = analyzeRepository(target.repoPath);
    const plan = await ai.generatePlan({
      issue,
      repo: {
        fullName: target.fullName,
        files: repo.files,
        readme: repo.readme,
      },
    });
    return { repo, plan };
  }

  function planComment(plan, runId) {
    return formatPlanComment(plan, runId);
  }

  return { receive, analyzeAndPlan, planComment };
}

module.exports = { createIssueAgent };
