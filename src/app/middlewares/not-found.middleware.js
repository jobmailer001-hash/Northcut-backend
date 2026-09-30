import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

/**
 * Catch-all for requests that matched no route; mounted after all routers.
 * @param {import("express").Request} req - Express request.
 * @throws {AppError} ROUTE_NOT_FOUND - always.
 */
export const notFoundHandler = (req) => {
  throw new AppError(`Route ${req.method} ${req.originalUrl} not found.`, { code: ErrorCodes.ROUTE_NOT_FOUND });
};
