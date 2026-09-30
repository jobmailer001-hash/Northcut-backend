/**
 * MongoDB error code for a unique-index violation.
 * @type {number}
 */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Whether an error is a unique-index violation, optionally on a specific field.
 * Relying on the unique index (instead of checking first) is race-free.
 * @param {Error & { code?: number, keyPattern?: Record<string, unknown> }} error - The caught error.
 * @param {string} [field] - Only match violations on this field.
 * @returns {boolean} Whether it is a matching duplicate-key error.
 */
export const isDuplicateKeyError = (error, field) => {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
    return false;
  }
  return field ? Boolean(error.keyPattern?.[field]) : true;
};
