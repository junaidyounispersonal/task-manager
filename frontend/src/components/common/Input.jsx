import React from 'react';
import clsx from 'clsx';

const Input = ({
  label,
  error,
  helperText,
  className = '',
  ...props
}) => {
  const inputClasses = clsx(
    'input-field',
    'transition-all duration-200 hover:shadow-md',
    error ? 
      'border-red-300 focus:border-red-500 focus:ring focus:ring-red-500 focus:pulse-blue' :
      'border-gray-300 focus:border-blue-500 focus:ring focus:ring-blue-500 focus:pulse-blue',
    className
  );

  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
        </label>
      )}
      <input
        className={inputClasses}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-secondary-500">{helperText}</p>
      )}
    </div>
  );
};

export default Input;