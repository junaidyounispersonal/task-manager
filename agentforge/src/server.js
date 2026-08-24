'use strict';

const express = require('express');
const { WorkflowError } = require('./errors');

function createServer(system) {
  const app = express();

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'agentforge',
      target: system.config.target.fullName,
      provider: system.config.ai.provider,
    });
  });

  app.post('/webhooks/github', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const result = await system.dispatchWebhook({
        rawBody: req.body,
        signature: req.header('x-hub-signature-256'),
        githubEvent: req.header('x-github-event'),
      });
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      const code = err.code || 'WORKFLOW_ERROR';
      const http =
        code === 'WEBHOOK_SIGNATURE_INVALID' || code === 'WEBHOOK_SIGNATURE_MISSING'
          ? 401
          : code === 'REPO_NOT_ALLOWED' || code === 'FORK_IGNORED'
            ? 403
            : code === 'MALFORMED_WEBHOOK'
              ? 400
              : 500;
      system.logger.error('workflow.stopped', {
        code,
        error: err.message,
      });
      res.status(http).json({
        ok: false,
        code,
        error: err.message,
      });
    }
  });

  app.use((err, req, res, next) => {
    void next;
    const message = err instanceof WorkflowError ? err.message : 'Internal error';
    res.status(500).json({ ok: false, error: message });
  });

  return app;
}

module.exports = { createServer };
