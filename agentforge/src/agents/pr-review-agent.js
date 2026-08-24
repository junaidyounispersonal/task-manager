'use strict';

const { parsePullRequest, formatReviewBody, toReviewComments } = require('../github/pull-requests');
const { SEVERITIES } = require('../constants');

function normalizeFindings(findings) {
  return (findings || [])
    .filter((f) => SEVERITIES.includes(f.severity))
    .map((f) => ({
      severity: f.severity,
      file: f.file || '',
      line: f.line || null,
      problem: f.problem,
      why: f.why,
      suggestedFix: f.suggestedFix,
    }));
}

function createPrReviewAgent({ ai }) {
  function receive(rawPr) {
    return parsePullRequest(rawPr);
  }

  async function review({ pr, files }) {
    const result = await ai.generateReview({
      pr,
      files,
      conventions: 'Match existing JavaScript/React/Express style. Skip trivia that the repo already encodes in ESLint/Tailwind conventions.',
    });
    const findings = normalizeFindings(result.findings);
    return {
      findings,
      body: formatReviewBody(findings),
      comments: toReviewComments(findings),
    };
  }

  return { receive, review };
}

module.exports = { createPrReviewAgent, normalizeFindings };
