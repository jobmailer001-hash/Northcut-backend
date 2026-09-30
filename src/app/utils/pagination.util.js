/**
 * Converts page/limit into a Mongo skip value.
 * @param {Object} options
 * @param {number} options.page - 1-based page number.
 * @param {number} options.limit - Page size.
 * @returns {number} Documents to skip.
 */
export const toSkip = ({ page, limit }) => (page - 1) * limit;

/**
 * Builds the `pagination` object returned alongside every list.
 * @param {Object} options
 * @param {number} options.page - 1-based page number.
 * @param {number} options.limit - Page size.
 * @param {number} options.total - Total matching documents.
 * @returns {{ page: number, limit: number, total: number, totalPages: number }} Pagination info.
 */
export const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
