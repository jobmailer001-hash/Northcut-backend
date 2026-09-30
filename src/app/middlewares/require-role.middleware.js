import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

/**
 * Builds middleware allowing only the given roles. Mount after `authenticate`.
 * @param {...string} allowedRoles - One or more of Roles.
 * @returns {import("express").RequestHandler} Role-check middleware.
 * @throws {AppError} FORBIDDEN - when the user's role is not allowed.
 */
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user?.role)) {
    throw new AppError("You don't have permission to do that.", { code: ErrorCodes.FORBIDDEN });
  }

  return next();
};
