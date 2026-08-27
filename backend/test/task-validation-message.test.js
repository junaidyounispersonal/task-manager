const express = require('express');
const test = require('node:test');
const assert = require('node:assert/strict');

const { getValidationMessage } = require('../utils/validation');
const { handleValidationErrors, taskValidation } = require('../middleware/taskValidation');

const sendTask = async (task) => {
  const app = express();
  app.use(express.json());
  app.post('/tasks', taskValidation, handleValidationErrors, (req, res) => {
    res.status(201).json({ message: 'Task created successfully' });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });

    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test('returns the due-date validation message instead of a generic validation failure', () => {
  const message = getValidationMessage([
    {
      type: 'field',
      value: null,
      msg: 'Due Date is required',
      path: 'dueDate',
      location: 'body'
    }
  ]);

  assert.equal(message, 'Due Date is required');
});

test('rejects task creation without a due date using the precise user-facing message', async () => {
  const result = await sendTask({
    title: 'Review issue 8',
    projectId: 1,
    priority: 3
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.message, 'Due Date is required');
  assert.equal(result.body.errors.length, 1);
  assert.equal(result.body.errors[0].path, 'dueDate');
});

test('accepts a valid due date through task validation', async () => {
  const result = await sendTask({
    title: 'Review issue 8',
    projectId: 1,
    priority: 3,
    dueDate: '2026-09-01'
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Task created successfully');
});

test('falls back to the generic validation message only when no specific errors exist', () => {
  assert.equal(getValidationMessage([]), 'Validation failed');
});
