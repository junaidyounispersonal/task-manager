const { body, validationResult } = require('express-validator');
const { getValidationMessage } = require('../utils/validation');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const validationErrors = errors.array();

    return res.status(400).json({
      message: getValidationMessage(validationErrors),
      errors: validationErrors
    });
  }

  next();
};

const taskValidation = [
  body('title')
    .notEmpty()
    .withMessage('Task title is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Task title must be between 1 and 200 characters'),
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
  body('projectId')
    .isInt({ min: 1 })
    .withMessage('Valid project ID is required'),
  body('assignedToId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Assigned user ID must be a valid integer'),
  body('priority')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Priority must be between 1 and 5'),
  body('dueDate')
    .notEmpty()
    .withMessage('Due Date is required')
    .bail()
    .isISO8601()
    .withMessage('Due date must be a valid ISO8601 date')
];

module.exports = { handleValidationErrors, taskValidation };
