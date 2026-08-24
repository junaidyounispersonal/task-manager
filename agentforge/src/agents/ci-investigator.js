'use strict';

const { parseCiLogs, formatDiagnosisComment } = require('../services/ci-logs');

function createCiInvestigator({ ai }) {
  function parse(logs) {
    return parseCiLogs(logs);
  }

  async function diagnose({ logs, pr, workflowName }) {
    const parsed = parseCiLogs(logs);
    if (workflowName && parsed.failedWorkflow === 'unknown') {
      parsed.failedWorkflow = workflowName;
    }
    const diagnosis = await ai.generateDiagnosis({ parsedLogs: parsed, pr });
    return {
      diagnosis,
      parsed,
      comment: formatDiagnosisComment(diagnosis),
    };
  }

  return { parse, diagnose };
}

module.exports = { createCiInvestigator };
