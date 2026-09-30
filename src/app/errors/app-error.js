import { ErrorStatusCodes } from "./error-codes.js";

/**
 * The single custom error class for every deliberately thrown error.
 * Errors are distinguished by `code`; the HTTP status defaults from ErrorStatusCodes.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Client-safe description of what went wrong.
   * @param {Object} [options]
   * @param {string} [options.code="INTERNAL_ERROR"] - A key of ErrorCodes.
   * @param {number} [options.statusCode] - Overrides the code's canonical status; rarely needed.
   * @param {boolean} [options.isOperational=true] - false marks an unexpected failure that must be logged loudly.
   * @param {*} [options.details] - Structured data the client needs to recover (e.g. field errors).
   */
  constructor(message, { statusCode, code = "INTERNAL_ERROR", isOperational = true, details } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode ?? ErrorStatusCodes[code] ?? 500;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
