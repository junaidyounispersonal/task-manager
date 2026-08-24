'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WorkflowError } = require('../errors');
const { assertYoloForbidden } = require('../security/permissions');

const FORBIDDEN_FLAGS = new Set(['--yolo', '-yolo']);

function stripSecretsFromEnv(env) {
  const next = { ...env };
  delete next.GITHUB_TOKEN;
  delete next.GITHUB_WEBHOOK_SECRET;
  delete next.JWT_SECRET;
  delete next.GROQ_API_KEY;
  delete next.OPENAI_API_KEY;
  delete next.DATABASE_URL;
  return next;
}

function candidateBins(configured) {
  const localAppData = process.env.LOCALAPPDATA;
  const extras = [];
  if (localAppData) {
    extras.push(
      path.join(localAppData, 'hermes', 'hermes-agent', 'bin', 'hermes.exe'),
      path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    );
  }
  const list = [];
  if (configured) list.push(configured);
  list.push('hermes', ...extras);
  return [...new Set(list)];
}

function isDesktopHermes(candidate) {
  return /apps[\\/]desktop[\\/].*Hermes\.exe$/i.test(String(candidate));
}

function resolveHermesBin(configured) {
  const candidates = candidateBins(configured);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === 'hermes' || candidate === 'hermes.exe') continue;
    if (isDesktopHermes(candidate)) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return configured && !isDesktopHermes(configured) ? configured : 'hermes';
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function stripHermesNoise(text) {
  return stripAnsi(text)
    .replace(/[⚠⚠]/g, '')
    .replace(/Deprecated \.env settings detected:[\s\S]*?(Then remove the old entries from[^\n]*)/gi, '')
    .replace(/session_id:\s*\S+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function combinedHermesOutput(stdout, stderr) {
  return stripAnsi(`${stdout || ''}\n${stderr || ''}`)
    .trim()
    .slice(-8000);
}

function detectProviderError(text) {
  const blob = String(text || '');
  if (/HTTP 402|credits exhausted|requires more credits|billing, credits, or account entitlement/i.test(blob)) {
    return blob.split('\n').filter(Boolean).slice(0, 6).join(' ').slice(0, 500);
  }
  return null;
}

function createHermesCli(opts) {
  const bin = resolveHermesBin(opts.bin);
  const timeoutMs = opts.timeoutMs || 600000;
  const cwd = opts.cwd;

  function spawnHermes(args, spawnCwd) {
    if (args.some((arg) => FORBIDDEN_FLAGS.has(String(arg)))) {
      throw new WorkflowError('Refusing to invoke Hermes with --yolo', {
        code: 'YOLO_FORBIDDEN',
        status: 'STOPPED',
      });
    }
    assertYoloForbidden(false);

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd: spawnCwd || cwd,
        windowsHide: true,
        env: stripSecretsFromEnv(process.env),
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new WorkflowError('Hermes timed out', {
            code: 'AI_PROVIDER_FAILED',
            status: 'STOPPED',
          })
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new WorkflowError(
            `Hermes CLI failed to start (${bin}): ${err.message}. Set HERMES_BIN to the Hermes CLI, not Hermes.exe. On this Windows install the CLI is typically %LOCALAPPDATA%\\hermes\\hermes-agent\\bin\\hermes.exe.`,
            { code: 'AI_PROVIDER_FAILED', status: 'STOPPED' }
          )
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const output = combinedHermesOutput(stdout, stderr);
        const billing = detectProviderError(output);
        if (billing) {
          reject(
            new WorkflowError(
              `Hermes provider billing failed: ${billing}. Add credits, pick an OpenRouter :free model, or switch provider with: & "$env:LOCALAPPDATA\\hermes\\hermes-agent\\bin\\hermes.exe" model`,
              { code: 'AI_PROVIDER_FAILED', status: 'STOPPED', details: { output } }
            )
          );
          return;
        }
        if (code !== 0) {
          const meaningful = stripHermesNoise(output);
          const hint = meaningful
            ? ''
            : ' Hermes printed no model output (often a .env deprecation plus a silent tool failure). Remove TERMINAL_CWD from %LOCALAPPDATA%\\hermes\\.env or move cwd into config.yaml, then: node src/index.js retry --issue <n>';
          reject(
            new WorkflowError(`Hermes exited with code ${code}.${hint}`, {
              code: 'AI_PROVIDER_FAILED',
              status: 'STOPPED',
              details: { output: meaningful || output },
            })
          );
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), output });
      });
    });
  }

  async function withQueryFile(prompt, extraArgs, spawnCwd, { quiet = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-hermes-'));
    const file = path.join(dir, 'prompt.txt');
    fs.writeFileSync(file, prompt, 'utf8');
    const args = quiet
      ? ['chat', '--query-file', file, '--quiet', ...extraArgs]
      : ['chat', '--query-file', file, ...extraArgs];
    try {
      return await spawnHermes(args, spawnCwd);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  async function version() {
    const { stdout } = await spawnHermes(['--version']);
    return stdout;
  }

  /**
   * One-shot text reply via query file (Windows-safe; avoids MAX_PATH argv limits).
   * Official: `hermes chat --query-file --quiet`
   */
  async function oneshot(prompt, spawnCwd) {
    const { stdout } = await withQueryFile(prompt, [], spawnCwd);
    return stdout;
  }

  /**
   * One-shot with tools. Official: `hermes chat --query-file --quiet --source tool`.
   */
  async function chatWithTools({ prompt, skills = [], spawnCwd }) {
    const extra = ['--source', 'tool'];
    if (skills.length) extra.push('-s', skills.join(','));
    try {
      const { stdout } = await withQueryFile(prompt, extra, spawnCwd, { quiet: false });
      return stdout;
    } catch (err) {
      const blob = `${err.message || ''} ${err.details?.output || ''}`;
      const skillMissing = skills.length && /unknown skill|skill not found|invalid skill/i.test(blob);
      if (!skillMissing) throw err;
      const { stdout } = await withQueryFile(prompt, ['--source', 'tool'], spawnCwd, { quiet: false });
      return stdout;
    }
  }

  return { bin, version, oneshot, chatWithTools };
}

module.exports = {
  createHermesCli,
  stripSecretsFromEnv,
  resolveHermesBin,
  FORBIDDEN_FLAGS,
  isDesktopHermes,
  detectProviderError,
  stripAnsi,
  stripHermesNoise,
  combinedHermesOutput,
};
