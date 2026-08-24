'use strict';

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|api[_-]?key|private[_-]?key|credential|webhook[_-]?secret|database_url|jwt/i;
const SENSITIVE_VALUE = /(?:ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

function redactString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(SENSITIVE_VALUE, '[REDACTED]');
}

function redact(value, key) {
  if (key && SENSITIVE_KEY.test(String(key))) {
    return '[REDACTED]';
  }
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  return value;
}

module.exports = { redact, redactString };
