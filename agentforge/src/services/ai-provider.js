'use strict';

const { WorkflowError } = require('../errors');
const { createHermesCli, detectProviderError } = require('./hermes-cli');
const { extractJson, previewText } = require('./json-extract');
const { redact } = require('../security/redaction');
const {
  planPrompt,
  compactPlanPrompt,
  reviewPrompt,
  diagnosisPrompt,
  implementPrompt,
  fixChecksPrompt,
} = require('../prompts');

function asNonEmptyString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n').trim();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function asFileList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    summary: asNonEmptyString(raw.summary || raw.issue_summary),
    requirements: asNonEmptyString(raw.requirements || raw.understanding || raw.requirement),
    expectedFiles: asFileList(raw.expectedFiles || raw.expected_files || raw.files),
    implementation: asNonEmptyString(raw.implementation || raw.proposed_implementation || raw.approach),
    testing: asNonEmptyString(raw.testing || raw.testing_strategy || raw.tests),
    risks: asNonEmptyString(raw.risks || raw.risk),
  };
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  return Boolean(
    plan.summary &&
      plan.requirements &&
      plan.implementation &&
      plan.testing &&
      plan.risks &&
      Array.isArray(plan.expectedFiles)
  );
}

function validateReview(review) {
  if (!review || typeof review !== 'object' || !Array.isArray(review.findings)) return false;
  return review.findings.every(
    (f) =>
      f &&
      f.severity &&
      f.problem &&
      f.why &&
      f.suggestedFix
  );
}

function validateDiagnosis(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') return false;
  return Boolean(
    diagnosis.failedWorkflow &&
      diagnosis.failedStep &&
      diagnosis.error &&
      diagnosis.probableRootCause &&
      diagnosis.suggestedFix &&
      diagnosis.confidence
  );
}

function parseOrThrow(raw, kind, validate, normalize) {
  if (typeof raw === 'string') {
    const billing = detectProviderError(raw);
    if (billing) {
      throw new WorkflowError(
        `Hermes provider billing failed: ${billing}. Add credits or pick an OpenRouter :free model via hermes model.`,
        { code: 'AI_PROVIDER_FAILED', status: 'STOPPED' }
      );
    }
  }
  const extracted = typeof raw === 'object' && raw !== null ? raw : extractJson(raw);
  const parsed = normalize ? normalize(extracted) : extracted;
  if (!validate(parsed)) {
    throw new WorkflowError(`AI response is not a valid ${kind}`, {
      code: 'AI_RESPONSE_INVALID',
      status: 'STOPPED',
      details: { preview: redact(previewText(typeof raw === 'string' ? raw : JSON.stringify(raw || ''))) },
    });
  }
  return parsed;
}

function createAiProvider(config, overrides = {}) {
  const name = (overrides.provider || config.ai.provider || 'hermes').toLowerCase();
  if (name !== 'hermes') {
    throw new WorkflowError(`Unsupported AI_AGENT_PROVIDER: ${name}`, {
      code: 'AI_PROVIDER_FAILED',
      status: 'STOPPED',
    });
  }

  const hermes =
    overrides.hermes ||
    createHermesCli({
      bin: config.ai.hermesBin,
      timeoutMs: config.ai.timeoutMs,
      cwd: config.target.repoPath,
    });

  async function generatePlan(context) {
    if (overrides.generatePlan) {
      const raw = await overrides.generatePlan(context);
      return parseOrThrow(raw, 'implementation plan', validatePlan, normalizePlan);
    }

    const attempts = [planPrompt(context), compactPlanPrompt(context)];
    let lastError;
    for (const prompt of attempts) {
      try {
        const raw = await hermes.oneshot(prompt, config.target.repoPath);
        return parseOrThrow(raw, 'implementation plan', validatePlan, normalizePlan);
      } catch (err) {
        lastError = err;
        if (err.code === 'AI_PROVIDER_FAILED') throw err;
      }
    }
    throw lastError;
  }

  async function generateReview(context) {
    const prompt = reviewPrompt(context);
    const raw = overrides.generateReview
      ? await overrides.generateReview(context)
      : await hermes.oneshot(prompt, config.target.repoPath);
    return parseOrThrow(raw, 'PR review', validateReview);
  }

  async function generateDiagnosis(context) {
    const prompt = diagnosisPrompt(context);
    const raw = overrides.generateDiagnosis
      ? await overrides.generateDiagnosis(context)
      : await hermes.oneshot(prompt, config.target.repoPath);
    return parseOrThrow(raw, 'CI diagnosis', validateDiagnosis);
  }

  async function implement(context) {
    const prompt = implementPrompt(context);
    if (overrides.implement) {
      return overrides.implement(context);
    }
    return hermes.chatWithTools({
      prompt,
      skills: config.ai.hermesSkills,
      spawnCwd: config.target.repoPath,
    });
  }

  async function fixChecks(context) {
    if (overrides.fixChecks) {
      return overrides.fixChecks(context);
    }
    return hermes.chatWithTools({
      prompt: fixChecksPrompt(context),
      skills: config.ai.hermesSkills,
      spawnCwd: config.target.repoPath,
    });
  }

  return {
    name,
    generatePlan,
    generateReview,
    generateDiagnosis,
    implement,
    fixChecks,
    hermes,
  };
}

module.exports = {
  createAiProvider,
  validatePlan,
  validateReview,
  validateDiagnosis,
  normalizePlan,
};
