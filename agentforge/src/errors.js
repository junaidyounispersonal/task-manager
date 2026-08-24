'use strict';

class WorkflowError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: string, details?: object }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = opts.code || 'WORKFLOW_ERROR';
    this.status = opts.status || 'FAILED';
    this.details = opts.details || {};
  }
}

module.exports = { WorkflowError };
