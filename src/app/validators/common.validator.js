import { z } from "zod";

/**
 * Largest page size any list endpoint accepts.
 * @type {number}
 */
const MAX_PAGE_SIZE = 50;

/**
 * A MongoDB ObjectId in its 24-character hex form.
 * @type {import("zod").ZodString}
 */
export const objectIdField = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id.");

/**
 * `?page=&limit=` for list endpoints (query strings arrive as text, so values are coerced).
 * @param {number} defaultLimit - Page size when `limit` is omitted.
 * @returns {import("zod").ZodRawShape} Pagination fields to spread into a query schema.
 */
export const paginationQueryShape = (defaultLimit) => ({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(defaultLimit),
});
