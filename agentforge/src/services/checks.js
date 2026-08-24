'use strict';

const { spawn } = require('child_process');
const { WorkflowError } = require('../errors');

function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    if (!command) {
      resolve({ skipped: true, code: 0, stdout: '', stderr: '' });
      return;
    }
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
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
        new WorkflowError(`Check command failed to start: ${err.message}`, {
          code: 'CHECKS_FAILED',
          status: 'STOPPED',
        })
      );
    });
    child.on('close', (code) => {
      resolve({ skipped: false, code, stdout, stderr, command });
    });
  });
}

function quote(file) {
  return `"${String(file).replace(/"/g, '\\"')}"`;
}

function lintFilesFromChangeList(changed, command) {
  const files = (changed || [])
    .map((file) => String(file).replace(/\\/g, '/'))
    .filter((file) => /\.(js|jsx|mjs|cjs|ts|tsx)$/i.test(file) && !file.includes('node_modules'));
  if (/frontend/i.test(command || '')) {
    return files.filter((file) => file.startsWith('frontend/'));
  }
  return files;
}

function changedLintCommand(command, files) {
  if (!files.length) return '';
  if (/npm --prefix frontend/.test(command || '')) {
    const rel = files.map((file) => quote(file.replace(/^frontend\//, '')));
    return `npm --prefix frontend exec -- eslint --max-warnings 0 ${rel.join(' ')}`;
  }
  return `npx eslint --max-warnings 0 ${files.map(quote).join(' ')}`;
}

function createChecks({ repoPath, commands, listChangedFiles, lintScope = 'all' }) {
  async function resolveLintCommand() {
    const command = commands.lint;
    if (!command) return '';
    if (String(lintScope).toLowerCase() !== 'changed' || typeof listChangedFiles !== 'function') {
      return command;
    }
    const changed = await listChangedFiles();
    return changedLintCommand(command, lintFilesFromChangeList(changed, command));
  }

  async function runNamed(name, command) {
    const result = await runCommand(command, repoPath);
    if (result.skipped) {
      return { name, skipped: true, ok: true };
    }
    if (result.code !== 0) {
      const output = [result.stdout, result.stderr]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(-6000);
      throw new WorkflowError(`${name} failed (exit ${result.code})`, {
        code: 'CHECKS_FAILED',
        status: 'STOPPED',
        details: {
          name,
          command: result.command,
          output,
        },
      });
    }
    return { name, skipped: false, ok: true };
  }

  async function runAll() {
    const results = [];
    results.push(await runNamed('lint', await resolveLintCommand()));
    results.push(await runNamed('test', commands.test));
    results.push(await runNamed('build', commands.build));
    return results;
  }

  return { runNamed, runAll, resolveLintCommand };
}

module.exports = { createChecks, runCommand, lintFilesFromChangeList, changedLintCommand };
