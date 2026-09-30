import { logger } from "#configs/logger.config.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

/**
 * Converts known non-AppError failures (e.g. express.json parse errors) into AppErrors.
 * @param {Error & { type?: string }} err - The error passed to the error handler.
 * @returns {Error} An AppError when the failure is recognised, otherwise the original error.
 */
const normalizeError = (err) => {
  if (err.type === "entity.parse.failed") {
    return new AppError("Request body is not valid JSON.", { code: ErrorCodes.MALFORMED_JSON });
  }

  return err;
};

/**
 * Centralized Express error handler, mounted last. Sends the `{ error }` envelope
 * and logs anything that isn't an expected, operational AppError.
 * @param {Error} err - The thrown or forwarded error.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @param {import("express").NextFunction} next - Required in the signature for Express to treat this as an error handler.
 * @returns {import("express").Response} The JSON error response.
 */
export const errorHandler = (err, req, res, next) => {
  const error = normalizeError(err);
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;
  const code = isAppError ? error.code : ErrorCodes.INTERNAL_ERROR;

  if (!isAppError || !error.isOperational) {
    // Unexpected / programmer error — log full detail for investigation.
    logger.error(error.message, { stack: error.stack, method: req.method, path: req.originalUrl });
  }

  return res.status(statusCode).json({
    error: {
      code,
      message: isAppError ? error.message : "Something went wrong.",
      ...(isAppError && error.details && { details: error.details }),
    },
  });
};
