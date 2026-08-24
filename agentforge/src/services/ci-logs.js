'use strict';

function parseCiLogs(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  let failedStep = 'unknown';
  let failedWorkflow = 'unknown';
  const errorLines = [];

  for (const line of lines) {
    const workflowMatch = line.match(/workflow[:\s]+["']?([^"'\n]+)/i);
    if (workflowMatch && failedWorkflow === 'unknown') failedWorkflow = workflowMatch[1].trim();

    const stepMatch = line.match(/##\[error\]Process completed with exit code|##\[group\](.+)|Process completed with exit code/);
    const namedStep = line.match(/^\s*\d+s\s+Run (.+)$/) || line.match(/##\[group\]Run (.+)/);
    if (namedStep) failedStep = namedStep[1].trim();

    if (/error|failed|FAIL|ELIFECYCLE|Error:/i.test(line)) {
      errorLines.push(line.trim());
    }
    void stepMatch;
  }

  const groupRun = source.match(/##\[group\]Run ([^\n]+)/g);
  if (groupRun && groupRun.length) {
    failedStep = groupRun[groupRun.length - 1].replace('##[group]Run ', '').trim();
  }

  const nameMatch = source.match(/Workflow:\s*(.+)/i);
  if (nameMatch) failedWorkflow = nameMatch[1].trim();

  return {
    failedWorkflow,
    failedStep,
    error: errorLines.slice(-15).join('\n') || 'CI failed (no error lines extracted)',
    excerpt: lines.slice(-40).join('\n'),
  };
}

function formatDiagnosisComment(diagnosis) {
  const files = (diagnosis.relevantFiles || []).map((f) => `- \`${f}\``).join('\n') || '- (none listed)';
  return [
    '## AgentForge CI diagnosis',
    '',
    'This is a diagnosis only. AgentForge will not modify code for a CI failure until a human approves a later fix workflow.',
    '',
    `**Failed workflow:** ${diagnosis.failedWorkflow}`,
    `**Failed step:** ${diagnosis.failedStep}`,
    `**Confidence:** ${diagnosis.confidence}`,
    '',
    '### Error',
    '```',
    diagnosis.error,
    '```',
    '',
    '### Probable root cause',
    diagnosis.probableRootCause,
    '',
    '### Relevant files',
    files,
    '',
    '### Suggested fix',
    diagnosis.suggestedFix,
    '',
    'GitHub Actions CI auto-fix is not enabled. A human must apply any code fix.',
  ].join('\n');
}

module.exports = { parseCiLogs, formatDiagnosisComment };
