'use strict';

const { loadConfig } = require('./config');
const { createSystem } = require('./system');
const { createServer } = require('./server');
const { STATUSES } = require('./constants');

function parseFlag(argv, name) {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx >= 0) return argv[idx + 1];
  return undefined;
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'serve';
  if (command === 'doctor') {
    const { createHermesCli, resolveHermesBin } = require('./services/hermes-cli');
    const dotenv = require('dotenv');
    const path = require('path');
    dotenv.config({ path: path.join(__dirname, '../.env') });
    const bin = resolveHermesBin(process.env.HERMES_BIN || 'hermes');
    const hermes = createHermesCli({
      bin,
      timeoutMs: 15000,
      cwd: process.cwd(),
    });
    try {
      const version = await hermes.version();
      console.log(
        JSON.stringify(
          {
            ok: true,
            hermesBin: bin,
            hermesVersion: version,
            provider: process.env.AI_AGENT_PROVIDER || 'hermes',
            note: 'Use the Hermes CLI (hermes), not Hermes.exe. Commands used: hermes --version, hermes -z, hermes chat --query-file --quiet --source tool.',
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
    return;
  }

  const config = loadConfig();
  const system = createSystem(config);

  if (command === 'serve') {
    const app = createServer(system);
    await new Promise((resolve) => {
      const server = app.listen(config.port, config.host, () => {
        system.logger.event('workflow.started', {
          workflow: 'server',
          host: config.host,
          port: config.port,
          target: config.target.fullName,
        });
        resolve(server);
      });
    });
    return;
  }

  if (command === 'process-issue') {
    const number = Number(parseFlag(argv, '--number') || parseFlag(argv, '-n'));
    if (!number) {
      console.error('Usage: node src/index.js process-issue --number <n>');
      process.exitCode = 1;
      return;
    }
    const issue = await system.github.getIssue(number);
    const run = await system.issueToPr.startFromIssue(issue);
    console.log(
      JSON.stringify(
        {
          runId: run.id,
          status: run.status,
          error: run.error,
          githubWarning: run.githubWarning || null,
          next:
            run.status === STATUSES.PENDING_PLAN_APPROVAL
              ? `Review the plan, then: node src/index.js approve --issue ${number}`
              : null,
          plan: run.plan || null,
        },
        null,
        2
      )
    );
    if (run.status === STATUSES.FAILED || run.status === STATUSES.STOPPED) process.exitCode = 1;
    return;
  }

  if (command === 'retry') {
    const runId = parseFlag(argv, '--run');
    const issueNumber = parseFlag(argv, '--issue');
    if (!runId && !issueNumber) {
      console.error('Usage: node src/index.js retry --run <id> | --issue <n>');
      process.exitCode = 1;
      return;
    }
    const result = await system.issueToPr.retryImplement({
      runId,
      issueNumber: issueNumber ? Number(issueNumber) : undefined,
    });
    console.log(JSON.stringify({ runId: result.id, status: result.status, error: result.error }, null, 2));
    if (result.status === STATUSES.FAILED || result.status === STATUSES.STOPPED) process.exitCode = 1;
    return;
  }

  if (command === 'approve') {
    const runId = parseFlag(argv, '--run');
    const issueNumber = parseFlag(argv, '--issue');
    if (runId) {
      const run = system.store.get(runId);
      const result = await system.issueToPr.handleApproval({
        issueNumber: run.issueNumber,
        commentBody: '/agentforge approve',
      });
      console.log(JSON.stringify({ runId: result.id, status: result.status, error: result.error }, null, 2));
      if (result.status === STATUSES.FAILED || result.status === STATUSES.STOPPED) process.exitCode = 1;
      return;
    }
    if (issueNumber) {
      const result = await system.issueToPr.handleApproval({
        issueNumber: Number(issueNumber),
        commentBody: '/agentforge approve',
      });
      console.log(JSON.stringify({ runId: result.id, status: result.status, error: result.error }, null, 2));
      if (result.status === STATUSES.FAILED || result.status === STATUSES.STOPPED) process.exitCode = 1;
      return;
    }
    console.error('Usage: node src/index.js approve --run <id> | --issue <n>');
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { main, parseFlag };
