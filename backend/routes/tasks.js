const express = require('express');
const { body, param, query } = require('express-validator');
const { handleValidationErrors, taskValidation } = require('../middleware/taskValidation');
const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getTaskStatistics,
  updateTaskStatus
} = require('../controllers/taskController');
const auth = require('../middleware/auth');

const router = express.Router();

// Task update validation
const taskUpdateValidation = [
  body('title')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Task title must be between 1 and 200 characters'),
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
  body('status')
    .optional()
    .isIn(['to_do', 'in_progress', 'done'])
    .withMessage('Status must be one of: to_do, in_progress, done'),
  body('assignedToId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Assigned user ID must be a valid integer'),
  body('priority')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Priority must be between 1 and 5'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Due date must be a valid ISO8601 date')
];

// Status update validation
const statusUpdateValidation = [
  body('status')
    .isIn(['to_do', 'in_progress', 'done'])
    .withMessage('Status must be one of: to_do, in_progress, done')
];

// ID parameter validation
const idValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Valid task ID is required')
];

// Query parameter validation for filtering
const queryValidation = [
  query('projectId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Project ID must be a valid integer'),
  query('assignedToId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Assigned user ID must be a valid integer'),
  query('status')
    .optional()
    .isIn(['to_do', 'in_progress', 'done'])
    .withMessage('Status must be one of: to_do, in_progress, done'),
  query('priority')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Priority must be between 1 and 5'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

// All routes require authentication
router.use(auth);

// Task CRUD routes
router.get('/', queryValidation, handleValidationErrors, getTasks);
router.get('/statistics', getTaskStatistics);
router.get('/:id', idValidation, handleValidationErrors, getTask);
router.post('/', taskValidation, handleValidationErrors, createTask);
router.put('/:id', idValidation, taskUpdateValidation, handleValidationErrors, updateTask);
router.delete('/:id', idValidation, handleValidationErrors, deleteTask);

// Quick status update route
router.patch('/:id/status', idValidation, statusUpdateValidation, handleValidationErrors, updateTaskStatus);

module.exports = router;
