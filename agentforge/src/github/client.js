'use strict';

const { Octokit } = require('@octokit/rest');
const { WorkflowError } = require('../errors');
const { assertRepoAllowed } = require('../security/permissions');

function createGitHubClient(opts) {
  const { token, octokit, owner, repo, allowlist } = opts;
  const api = octokit || (token ? new Octokit({ auth: token }) : null);

  function requireApi() {
    if (!api) {
      throw new WorkflowError('GitHub authentication is missing (set GITHUB_TOKEN)', {
        code: 'GITHUB_AUTH_MISSING',
        status: 'STOPPED',
      });
    }
    return api;
  }

  function scope(o = owner, r = repo) {
    assertRepoAllowed(o, r, allowlist);
    return { owner: o, repo: r };
  }

  return {
    owner,
    repo,
    api: () => requireApi(),

    async getIssue(number, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().issues.get({ owner: ow, repo: re, issue_number: number });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async createIssueComment(number, body, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().issues.createComment({
          owner: ow,
          repo: re,
          issue_number: number,
          body,
        });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async addLabels(number, labels, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().issues.addLabels({
          owner: ow,
          repo: re,
          issue_number: number,
          labels,
        });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async createPullRequest({ title, head, base, body, draft = false }, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().pulls.create({
          owner: ow,
          repo: re,
          title,
          head,
          base,
          body,
          draft,
        });
        return data;
      } catch (err) {
        const status = err.status || err.response?.status;
        if (status === 422) {
          try {
            const { data } = await requireApi().pulls.list({
              owner: ow,
              repo: re,
              head: `${ow}:${head}`,
              state: 'open',
            });
            if (data && data[0]) return data[0];
          } catch {
            /* fall through to wrap */
          }
        }
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async getPullRequest(number, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().pulls.get({ owner: ow, repo: re, pull_number: number });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async listPullFiles(number, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const files = await requireApi().paginate(requireApi().pulls.listFiles, {
          owner: ow,
          repo: re,
          pull_number: number,
          per_page: 100,
        });
        return files;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async createPullReview({ pullNumber, body, event = 'COMMENT', comments = [] }, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().pulls.createReview({
          owner: ow,
          repo: re,
          pull_number: pullNumber,
          body,
          event,
          comments: comments.length ? comments : undefined,
        });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async createIssueCommentOnPr(number, body, o, r) {
      return this.createIssueComment(number, body, o, r);
    },

    async getWorkflowRun(runId, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().actions.getWorkflowRun({
          owner: ow,
          repo: re,
          run_id: runId,
        });
        return data;
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async listJobsForWorkflowRun(runId, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().actions.listJobsForWorkflowRun({
          owner: ow,
          repo: re,
          run_id: runId,
        });
        return data.jobs || [];
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    async downloadJobLogs(jobId, o, r) {
      const { owner: ow, repo: re } = scope(o, r);
      try {
        const { data } = await requireApi().actions.downloadJobLogsForWorkflowRun({
          owner: ow,
          repo: re,
          job_id: jobId,
        });
        if (Buffer.isBuffer(data)) return data.toString('utf8');
        if (typeof data === 'string') return data;
        return String(data || '');
      } catch (err) {
        throw wrapGitHubError(err, 'GITHUB_API_FAILED');
      }
    },

    /** Intentionally unimplemented: AgentForge must never merge. */
    async mergePullRequest() {
      const { assertMergeForbidden } = require('../security/permissions');
      assertMergeForbidden();
    },
  };
}

function wrapGitHubError(err, code) {
  if (err instanceof WorkflowError) return err;
  const status = err.status || err.response?.status;
  const message = err.message || 'GitHub API request failed';
  const inaccessible = /resource not accessible by personal access token/i.test(message);
  const hint = inaccessible
    ? ' Fine-grained PAT is missing write access. Edit the token → Repository permissions → Issues: Read and write (required to comment). Also set Contents: Read and write and Pull requests: Read and write. Save; GitHub may ask you to re-authorize. Repo: Settings → Fine-grained tokens, not a classic PAT.'
    : '';
  return new WorkflowError(`GitHub API failed: ${message}${hint}`, {
    code: status === 403 || status === 401 ? 'GITHUB_PERMISSIONS' : code,
    status: 'STOPPED',
    details: { httpStatus: status },
  });
}

module.exports = { createGitHubClient, wrapGitHubError };
