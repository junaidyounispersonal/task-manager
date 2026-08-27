const getValidationMessage = (errors) => {
  const firstError = Array.isArray(errors) ? errors[0] : null;

  return firstError?.msg || 'Validation failed';
};

module.exports = { getValidationMessage };
