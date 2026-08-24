'use strict';

const { SEVERITIES } = require('../constants');

function parsePullRequest(pr) {
  if (!pr || typeof pr !== 'object' || !pr.number) {
    throw Object.assign(new Error('Malformed pull request payload'), { code: 'MALFORMED_PR' });
  }
  return {
    number: pr.number,
    title: pr.title || '',
    body: pr.body || '',
    head: pr.head?.ref || '',
    base: pr.base?.ref || '',
    url: pr.html_url || '',
    draft: Boolean(pr.draft),
    user: pr.user?.login || '',
  };
}

function formatReviewBody(findings) {
  const lines = ['## AgentForge automated review', '', 'The AI must not merge this PR. A human remains responsible.', ''];
  if (!findings.length) {
    lines.push('No blocking findings. Please still do a human review before merge.');
    return lines.join('\n');
  }
  for (const severity of SEVERITIES) {
    const group = findings.filter((f) => f.severity === severity);
    if (!group.length) continue;
    lines.push(`### ${severity}`);
    for (const finding of group) {
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file || '(unknown file)';
      lines.push(`- **${loc}** — ${finding.problem}`);
      lines.push(`  - Why it matters: ${finding.why}`);
      lines.push(`  - Suggested fix: ${finding.suggestedFix}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function toReviewComments(findings) {
  return findings
    .filter((f) => f.file && f.line && f.severity !== 'SUGGESTION')
    .slice(0, 20)
    .map((f) => ({
      path: f.file,
      line: Number(f.line),
      body: `**${f.severity}:** ${f.problem}\n\nWhy it matters: ${f.why}\n\nSuggested fix: ${f.suggestedFix}`,
    }));
}

module.exports = { parsePullRequest, formatReviewBody, toReviewComments };
