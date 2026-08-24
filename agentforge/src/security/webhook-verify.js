'use strict';

const crypto = require('crypto');
const { WorkflowError } = require('../errors');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify GitHub webhook HMAC (X-Hub-Signature-256).
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader
 * @param {string} secret
 */
function verifyGitHubSignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    throw new WorkflowError('GITHUB_WEBHOOK_SECRET is not configured', {
      code: 'WEBHOOK_SECRET_MISSING',
      status: 'STOPPED',
    });
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    throw new WorkflowError('Missing X-Hub-Signature-256 header', {
      code: 'WEBHOOK_SIGNATURE_MISSING',
      status: 'STOPPED',
    });
  }
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  if (!timingSafeEqual(expected, signatureHeader)) {
    throw new WorkflowError('Invalid webhook signature', {
      code: 'WEBHOOK_SIGNATURE_INVALID',
      status: 'STOPPED',
    });
  }
  return true;
}

module.exports = { verifyGitHubSignature, timingSafeEqual };
