'use strict';

function planPrompt({ issue, repo }) {
  return `You are AgentForge assisting a human software engineer. Produce ONLY valid JSON (no markdown fences).

Analyze this GitHub issue for repository "${repo.fullName}". Do not write or modify code. Do not merge anything.

Issue number: ${issue.number}
Title: ${issue.title}
Body:
${issue.body || '(empty)'}

Relevant frontend files:
${(repo.files || []).filter((f) => /login|auth|frontend\/src/i.test(f)).slice(0, 25).join('\n') || (repo.files || []).slice(0, 25).join('\n')}

README excerpt:
${(repo.readme || '').slice(0, 1200)}

Return JSON with keys:
{
  "summary": "short issue summary",
  "requirements": "what needs to be built or fixed",
  "expectedFiles": ["paths likely to change"],
  "implementation": "proposed approach",
  "testing": "how to verify",
  "risks": "risks including accidental coupling to unrelated app features"
}

Respect existing architecture. expectedFiles MUST be real paths from the file list above — do not invent files (e.g. do not guess frontend/src/components/LoginForm.jsx if the list has frontend/src/components/auth/LoginForm.jsx). Prefer Tailwind/existing CSS; do not add CSS modules unless that file already exists. Do not propose deleting product functionality, changing auth, or altering database schemas unless the issue explicitly requires it.`;
}

function compactPlanPrompt({ issue, repo }) {
  return `Return ONLY a JSON object, no markdown, no extra text.
Repository: ${repo.fullName}
Issue #${issue.number}: ${issue.title}
${issue.body || ''}

JSON keys (all required):
{"summary":"string","requirements":"string","expectedFiles":["path"],"implementation":"string","testing":"string","risks":"string"}`;
}

function reviewPrompt({ pr, files, conventions }) {
  const fileBlock = (files || [])
    .map((f) => `FILE: ${f.filename}\nSTATUS: ${f.status}\nPATCH:\n${(f.patch || '').slice(0, 4000)}`)
    .join('\n\n');
  return `You are AgentForge reviewing a pull request. Produce ONLY valid JSON.

Do not comment on trivial stylistic preferences when the project already has established conventions.
Do not request a merge. A human must merge.

PR #${pr.number}: ${pr.title}
Conventions: ${conventions || 'JavaScript, Express, React, existing file style'}

Changed files:
${fileBlock}

Return JSON:
{
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|SUGGESTION",
      "file": "path",
      "line": 12,
      "problem": "...",
      "why": "why it matters",
      "suggestedFix": "..."
    }
  ]
}

If there are no issues, return {"findings":[]}.
Review tests, security, error handling, performance, and maintainability.`;
}

function diagnosisPrompt({ parsedLogs, pr }) {
  return `You are AgentForge diagnosing a CI failure. Produce ONLY valid JSON. Do not modify code. Do not claim you merged or deployed anything.

PR: ${pr ? `#${pr.number} ${pr.title}` : 'unknown'}
Parsed CI:
Workflow: ${parsedLogs.failedWorkflow}
Step: ${parsedLogs.failedStep}
Error:
${parsedLogs.error}

Log excerpt:
${parsedLogs.excerpt}

Return JSON:
{
  "failedWorkflow": "...",
  "failedStep": "...",
  "error": "...",
  "probableRootCause": "...",
  "relevantFiles": ["..."],
  "suggestedFix": "...",
  "confidence": "low|medium|high"
}`;
}

function formatCheckCommands(commands = {}) {
  const lines = ['lint', 'test', 'build']
    .map((name) => {
      const cmd = String((commands && commands[name]) || '').trim();
      return cmd ? `- ${name}: ${cmd}` : null;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '(no check commands configured)';
}

function implementPrompt({ issue, plan, branch, checks }) {
  return `You are implementing an approved AgentForge plan. You are NOT allowed to merge pull requests, push to main/master, deploy, or modify production configuration.

Work only on branch ${branch} in the current working tree.
Follow the approved plan. Use existing file paths; do not import files that do not exist.
Do not commit, push, or open a pull request. AgentForge will handle git after you finish file edits.
Do not use --yolo.

Issue #${issue.number}: ${issue.title}
${issue.body || ''}

Approved plan:
${JSON.stringify(plan, null, 2)}

After you finish, AgentForge will lint only the files you changed (plus the configured test/build commands). Those must exit 0:
${formatCheckCommands(checks)}

Keep changed JS/JSX clean (no unused vars; --max-warnings 0). You do not need to fix unrelated pre-existing lint in files you did not touch. Do not add unrelated features, auth changes, or schema changes.

Implement the changes now.`;
}

function fixChecksPrompt({ issue, plan, branch, checkName, command, output, attempt, maxAttempts }) {
  return `You already implemented an approved AgentForge plan on branch ${branch}. Configured checks then failed. Fix the failures in the working tree.

You are NOT allowed to merge, push to main/master, deploy, commit, push, or use --yolo.
AgentForge will re-run checks after you edit files.

Issue #${issue.number}: ${issue.title}
Failed check: ${checkName || 'unknown'}
Command: ${command || '(unknown)'}
Attempt ${attempt} of ${maxAttempts}

Check output:
${output || '(no captured output)'}

Approved plan (for context only):
${JSON.stringify(plan, null, 2)}

Fix every reported problem in this check output so the failed command exits 0. If the output only lists files you changed, only edit those. Do not expand into unrelated features, auth, database, or product behavior.
Stay on branch ${branch}.`;
}

module.exports = {
  planPrompt,
  compactPlanPrompt,
  reviewPrompt,
  diagnosisPrompt,
  implementPrompt,
  fixChecksPrompt,
  formatCheckCommands,
};
