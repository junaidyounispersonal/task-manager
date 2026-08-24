'use strict';

const path = require('path');
const dotenv = require('dotenv');
const { loadTarget } = require('./target');
const { WorkflowError } = require('../errors');

const AGENTFORGE_ROOT = path.resolve(__dirname, '../..');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseIntEnv(value, fallback) {
  if (value === undefined || value === '' || value === null) return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadEnv(envPath) {
  dotenv.config({ path: envPath || path.join(AGENTFORGE_ROOT, '.env') });
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ envPath?: string, skipDotenv?: boolean }} [opts]
 */
function loadConfig(env = process.env, opts = {}) {
  if (!opts.skipDotenv) {
    loadEnv(opts.envPath);
    env = process.env;
  }

  const target = loadTarget(env, AGENTFORGE_ROOT);

  if (parseBoolean(env.HERMES_YOLO, false)) {
    throw new WorkflowError('HERMES_YOLO is forbidden. AgentForge will not bypass Hermes command approval.', {
      code: 'YOLO_FORBIDDEN',
    });
  }

  return {
    agentforgeRoot: AGENTFORGE_ROOT,
    host: env.AGENTFORGE_HOST || '127.0.0.1',
    port: parseIntEnv(env.AGENTFORGE_PORT, 5055),
    logLevel: env.LOG_LEVEL || 'info',
    target,
    github: {
      token: env.GITHUB_TOKEN || '',
      webhookSecret: env.GITHUB_WEBHOOK_SECRET || '',
      appId: env.GITHUB_APP_ID || '',
      appPrivateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH || '',
    },
    ai: {
      provider: (env.AI_AGENT_PROVIDER || 'hermes').trim().toLowerCase(),
      hermesBin: env.HERMES_BIN || 'hermes',
      hermesSkills: (env.HERMES_SKILLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      timeoutMs: parseIntEnv(env.HERMES_TIMEOUT_MS, 600000),
    },
    git: {
      userName: env.AGENTFORGE_GIT_USER_NAME || 'AgentForge',
      userEmail: env.AGENTFORGE_GIT_USER_EMAIL || 'agentforge@local',
    },
    maxAutoFixAttempts: parseIntEnv(env.MAX_AUTO_FIX_ATTEMPTS, 2),
    dataDir: path.join(AGENTFORGE_ROOT, '.data'),
  };
}

module.exports = { loadConfig, AGENTFORGE_ROOT, parseBoolean, parseIntEnv };
