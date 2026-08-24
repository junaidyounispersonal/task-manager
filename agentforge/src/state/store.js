'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATUSES } = require('../constants');
const { WorkflowError } = require('../errors');

function createStore(dataDir) {
  const runsDir = path.join(dataDir, 'runs');

  function ensure() {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  function runPath(id) {
    return path.join(runsDir, `${id}.json`);
  }

  function create(partial) {
    ensure();
    const id = partial.id || `run_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const run = {
      id,
      workflow: partial.workflow,
      status: partial.status || STATUSES.RECEIVED,
      owner: partial.owner,
      repo: partial.repo,
      issueNumber: partial.issueNumber || null,
      prNumber: partial.prNumber || null,
      branch: partial.branch || null,
      plan: partial.plan || null,
      error: null,
      autoFixAttempts: 0,
      events: [],
      createdAt: now,
      updatedAt: now,
      ...partial,
      id,
    };
    fs.writeFileSync(runPath(id), JSON.stringify(run, null, 2), 'utf8');
    return run;
  }

  function get(id) {
    const file = runPath(id);
    if (!fs.existsSync(file)) {
      throw new WorkflowError(`Run not found: ${id}`, { code: 'RUN_NOT_FOUND', status: 'STOPPED' });
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function update(id, patch) {
    const current = get(id);
    const next = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(runPath(id), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  function list() {
    ensure();
    return fs
      .readdirSync(runsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf8')))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function findByIssue(owner, repo, issueNumber) {
    const matches = list().filter(
      (run) =>
        run.owner === owner &&
        run.repo === repo &&
        Number(run.issueNumber) === Number(issueNumber) &&
        run.workflow === 'issue-to-pr'
    );
    if (!matches.length) return undefined;
    const pending = matches.find((run) => run.status === STATUSES.PENDING_PLAN_APPROVAL);
    if (pending) return pending;
    return matches[0];
  }

  function findByPr(owner, repo, prNumber) {
    return list().filter(
      (run) => run.owner === owner && run.repo === repo && Number(run.prNumber) === Number(prNumber)
    );
  }

  return { create, get, update, list, findByIssue, findByPr, runsDir };
}

module.exports = { createStore };
