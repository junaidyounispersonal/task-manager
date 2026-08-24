'use strict';

const { redact } = require('../security/redaction');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(opts = {}) {
  const levelName = opts.level || process.env.LOG_LEVEL || 'info';
  const min = LEVELS[levelName] ?? LEVELS.info;
  const write = opts.write || ((line) => process.stdout.write(`${line}\n`));

  function emit(level, event, data = {}) {
    if ((LEVELS[level] ?? LEVELS.info) > min) return;
    const payload = redact({
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    });
    write(JSON.stringify(payload));
  }

  return {
    event: (name, data) => emit('info', name, data),
    info: (event, data) => emit('info', event, data),
    warn: (event, data) => emit('warn', event, data),
    error: (event, data) => emit('error', event, data),
    debug: (event, data) => emit('debug', event, data),
  };
}

module.exports = { createLogger };
