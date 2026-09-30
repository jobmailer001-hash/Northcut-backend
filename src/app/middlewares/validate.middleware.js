import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

/**
 * Request parts that can be validated, in the order they are checked.
 * @type {ReadonlyArray<"params" | "query" | "body">}
 */
const requestLocations = ["params", "query", "body"];

/**
 * Builds middleware that validates request params/query/body against Zod schemas.
 * Parsed values are exposed on `req.validated` (Express 5 makes `req.query` read-only,
 * so the originals are never overwritten).
 * @param {Object} schemas
 * @param {import("zod").ZodType} [schemas.params] - Schema for route params.
 * @param {import("zod").ZodType} [schemas.query] - Schema for the query string.
 * @param {import("zod").ZodType} [schemas.body] - Schema for the JSON body.
 * @returns {import("express").RequestHandler} Validation middleware.
 * @throws {AppError} VALIDATION_ERROR - with `details.fields` listing every invalid field.
 */
export const validate = (schemas) => (req, res, next) => {
  const validated = {};
  const fieldErrors = [];

  for (const location of requestLocations) {
    const schema = schemas[location];

    if (!schema) {
      continue;
    }

    const result = schema.safeParse(req[location] ?? {});

    if (result.success) {
      validated[location] = result.data;
      continue;
    }

    for (const issue of result.error.issues) {
      fieldErrors.push({ location, path: issue.path.join("."), message: issue.message });
    }
  }

  if (fieldErrors.length) {
    throw new AppError("Some fields are invalid.", {
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fields: fieldErrors },
    });
  }

  req.validated = validated;
  return next();
};
