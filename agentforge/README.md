# AgentForge

Human-in-the-loop AI software engineering control plane. It orchestrates [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) against a **configured target git repository** and talks to GitHub for issues, PRs, and reviews.

This package lives next to the Task Manager app only as a bootstrap. It does **not** import Prisma, JWT, CopilotKit, or Task Manager routes. Point `TARGET_REPO_PATH` / `GITHUB_OWNER` / `GITHUB_REPO` at another clone later.

The AI never merges pull requests and never deploys.

## What it does

1. **Issue → plan** — analyze a GitHub issue, inspect the target repo, post a plan, wait at `PENDING_PLAN_APPROVAL`.
2. **Human approval** — `/agentforge approve` (or label `agentforge:plan-approved`) before any significant code change. `/agentforge reject` stops.
3. **Issue → PR** — after approval: feature branch (reuses the branch on retry; does not reset it), Hermes implementation, lint of **changed files only**, then test/build. If those checks fail, Hermes gets the output and retries up to `MAX_AUTO_FIX_ATTEMPTS` (default 2). Then diff, push, open PR (reuses an existing PR if GitHub returns 422). **No merge.**
4. **PR review** — on open/update, post classified findings (`CRITICAL` … `SUGGESTION`).
5. **CI investigator** — on Actions failure, post a diagnosis. Does **not** auto-edit the repo.

Cursor remains the human review tool for diffs and edits.

## Not the desktop app

AgentForge calls the **Hermes CLI**, not `Hermes.exe`.

| Used | Not used |
|------|----------|
| `hermes --version` | `Hermes.exe` (Electron desktop) |
| `hermes -z "<prompt>"` (plan/review/diagnosis JSON) | `--yolo` (forbidden) |
| `hermes chat --query-file <file> --quiet --source tool` (implementation with tools) | CopilotKit / Groq in the Task Manager |

Local install verified on this machine: Hermes Agent **v0.20.4** (`2026.8.18`). CLI binaries (not the desktop app):

- `%LOCALAPPDATA%\hermes\hermes-agent\bin\hermes.exe`
- `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`

Set `HERMES_BIN` to one of those if `hermes` is not on `PATH`. Do **not** point it at `apps\desktop\release\win-unpacked\Hermes.exe`.

```bash
npm run doctor
```

## Setup

```bash
cd agentforge
cp .env.example .env
npm install
```

Edit `.env`:

- Target repo path, owner, name, allowlist, check commands
- `GITHUB_TOKEN` (fine-grained PAT or GitHub App installation token)
- `GITHUB_WEBHOOK_SECRET`
- `AI_AGENT_PROVIDER=hermes` and `HERMES_BIN`

Do not commit `.env`.

### GitHub permissions (least privilege)

Prefer a **GitHub App** or **fine-grained PAT** installed only on the allowlisted repo.

| Permission | Access | Why |
|------------|--------|-----|
| Metadata | Read | Identify the repo |
| Issues | Read & write | Read issues, post plan/diagnosis comments, labels |
| Pull requests | Read & write | Open PRs, post review comments. **Do not grant merge-only admin.** |
| Contents | Read & write | Push **feature branches** only. Protect `main` so the token cannot skip human merge. |
| Actions | Read | CI logs (investigator) |
| Webhooks | Read & write | Optional, for registering the webhook |

Do **not** grant: administration, org secrets, other repositories, deploy keys, Actions write, environment secrets for production.

Webhook: `POST /webhooks/github` on `AGENTFORGE_HOST:AGENTFORGE_PORT` (default `127.0.0.1:5055`). Events: `issues`, `issue_comment`, `pull_request`, `workflow_run`. Delivery must include `X-Hub-Signature-256`. Use smee/ngrok only for local development.

### Human approval

1. AgentForge comments the plan and labels `agentforge:pending-plan`.
2. Human replies `/agentforge approve` **or** adds `agentforge:plan-approved`.
3. Local fallback: `npm run approve -- --run <id>` or `--issue <n>`.

There is no Task Manager UI button on purpose.

## Commands

```bash
npm test
npm run doctor
npm start                          # webhook server
node src/index.js process-issue --number 7
node src/index.js approve --issue 7
node src/index.js retry --issue 7  # resume after Hermes/check failure (does not re-plan)
```

## Tests

`node:test` covers issue parsing, plan generation, approval state, branch/PR creation (mocked git/GitHub), PR review, CI log parsing/diagnosis, allowlist/merge/yolo permissions, webhook HMAC, and failure handling.

## Using another project later

Keep this package as-is. Change env:

```text
TARGET_REPO_PATH=E:\path\to\other-repo
GITHUB_OWNER=acme
GITHUB_REPO=other
GITHUB_REPO_ALLOWLIST=acme/other
CHECK_LINT=...
CHECK_TEST=...
CHECK_BUILD=...
```

Install a **new** GitHub App/PAT on that repo only. Do not widen the first token to the whole org.

Optional later step: move `agentforge/` to its own git repository.

## Safety

- Never merge, never deploy, never `--yolo`
- Never push `main` / `master` / `production`
- Webhooks from forks or non-allowlisted repos are rejected
- Logs redact tokens, passwords, and `Authorization` headers
- Hermes subprocess env does not receive `GITHUB_TOKEN` or app secrets
- Local lint of **changed files** after an approved implementation; Hermes retries up to `MAX_AUTO_FIX_ATTEMPTS` (default 2)
- GitHub Actions CI diagnosis does not modify code
- `retry` resumes an approved run without wiping the feature branch

## What this package does not change

Task Manager `backend/` and `frontend/` application code is untouched. CopilotKit remains the in-app product assistant, unrelated to AgentForge.
