'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIssue, parseApprovalComment, hasApprovedLabel } = require('../src/github/issues');
const { LABELS } = require('../src/constants');

test('parseIssue extracts core fields', () => {
  const parsed = parseIssue({
    number: 7,
    title: 'Fix login',
    body: 'Users cannot log in',
    labels: [{ name: 'bug' }, 'help wanted'],
    html_url: 'https://github.com/org/repo/issues/7',
    user: { login: 'alice' },
    state: 'open',
  });
  assert.equal(parsed.number, 7);
  assert.equal(parsed.title, 'Fix login');
  assert.equal(parsed.body, 'Users cannot log in');
  assert.deepEqual(parsed.labels, ['bug', 'help wanted']);
  assert.equal(parsed.pullRequest, false);
});

test('parseIssue rejects malformed payloads', () => {
  assert.throws(() => parseIssue(null), /Malformed/);
  assert.throws(() => parseIssue({ title: 'x' }), /missing number/);
});

test('parseApprovalComment recognizes approve and reject', () => {
  assert.equal(parseApprovalComment('/agentforge approve'), 'approve');
  assert.equal(parseApprovalComment('Looks good\n/agentforge approve\n'), 'approve');
  assert.equal(parseApprovalComment('/agentforge reject because scope is wrong'), 'reject');
  assert.equal(parseApprovalComment('please do this'), null);
});

test('hasApprovedLabel detects plan-approved', () => {
  assert.equal(hasApprovedLabel([{ name: LABELS.PLAN_APPROVED }]), true);
  assert.equal(hasApprovedLabel(['bug']), false);
});
