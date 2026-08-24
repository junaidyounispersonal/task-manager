'use strict';

const { spawn } = require('child_process');
const { WorkflowError } = require('../errors');
const {
  assertSafeFeatureBranch,
  assertCanPush,
  assertMergeForbidden,
  isProtectedBranch,
} = require('../security/permissions');

function runGit(cwd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: opts.env || process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(
        new WorkflowError(`git failed to start: ${err.message}`, {
          code: 'GIT_FAILED',
          status: 'STOPPED',
        })
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new WorkflowError(`git ${args.join(' ')} failed`, {
            code: 'GIT_FAILED',
            status: 'STOPPED',
            details: { stderr: stderr.slice(0, 2000), code },
          })
        );
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function createGitService({ repoPath, defaultBranch, userName, userEmail }) {
  async function status() {
    const { stdout } = await runGit(repoPath, ['status', '--porcelain']);
    return stdout;
  }

  async function currentBranch() {
    const { stdout } = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout;
  }

  async function createBranch(name) {
    assertSafeFeatureBranch(name, defaultBranch);
    let current = '';
    try {
      current = await currentBranch();
    } catch {
      current = '';
    }
    if (current === name) return name;

    const { stdout: listed } = await runGit(repoPath, ['branch', '--list', name]);
    const exists = listed
      .split(/\r?\n/)
      .some((line) => line.replace(/^\*\s*/, '').trim() === name);
    if (exists) {
      await runGit(repoPath, ['checkout', name]);
      return name;
    }

    await runGit(repoPath, ['checkout', defaultBranch]);
    await runGit(repoPath, ['checkout', '-B', name]);
    return name;
  }

  async function listChangedFiles() {
    const names = new Set();
    const commands = [
      ['diff', '--name-only', '--diff-filter=ACMR', defaultBranch],
      ['diff', '--name-only', '--diff-filter=ACMR'],
      ['ls-files', '--others', '--exclude-standard'],
    ];
    for (const args of commands) {
      try {
        const { stdout } = await runGit(repoPath, args);
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/\\/g, '/'))
          .filter(Boolean)
          .forEach((file) => names.add(file));
      } catch {
        /* comparison against missing base branch is fine */
      }
    }
    return [...names];
  }

  async function diff() {
    const { stdout } = await runGit(repoPath, ['diff']);
    return stdout;
  }

  async function diffStat() {
    const { stdout } = await runGit(repoPath, ['diff', '--stat']);
    return stdout;
  }

  async function addAll() {
    await runGit(repoPath, ['add', '-A']);
  }

  async function commit(message) {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: userName,
      GIT_AUTHOR_EMAIL: userEmail,
      GIT_COMMITTER_NAME: userName,
      GIT_COMMITTER_EMAIL: userEmail,
    };
    const porcelain = await status();
    if (!porcelain) {
      throw new WorkflowError('No changes to commit', { code: 'NO_CHANGES', status: 'STOPPED' });
    }
    await runGit(repoPath, ['commit', '-m', message], { env });
  }

  async function push(branch) {
    assertCanPush(branch, defaultBranch);
    if (isProtectedBranch(branch, defaultBranch)) {
      throw new WorkflowError('Refusing to push protected branch', { code: 'PUSH_DENIED', status: 'STOPPED' });
    }
    await runGit(repoPath, ['push', '-u', 'origin', branch]);
  }

  async function merge() {
    assertMergeForbidden();
  }

  return {
    repoPath,
    status,
    currentBranch,
    createBranch,
    listChangedFiles,
    diff,
    diffStat,
    addAll,
    commit,
    push,
    merge,
  };
}

module.exports = { createGitService, runGit };
