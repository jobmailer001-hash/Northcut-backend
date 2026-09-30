import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { verifyAccessToken } from "#utils/token.util.js";

/**
 * Prefix of the Authorization header value.
 * @type {string}
 */
const BEARER_PREFIX = "Bearer ";

/**
 * Requires a valid access token and exposes `req.user = { id, role }`.
 * Stateless: the token alone is trusted until it expires (~15 min), so this
 * never hits the database.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @param {import("express").NextFunction} next - Next middleware.
 * @returns {void}
 * @throws {AppError} UNAUTHORIZED - when the token is missing, invalid or expired.
 */
export const authenticate = (req, res, next) => {
  const header = req.get("authorization") ?? "";

  if (!header.startsWith(BEARER_PREFIX)) {
    throw new AppError("Authentication required.", { code: ErrorCodes.UNAUTHORIZED });
  }

  let payload;

  try {
    payload = verifyAccessToken(header.slice(BEARER_PREFIX.length));
  } catch {
    // Any verification failure (expired, bad signature, malformed) means the same thing to the client.
    throw new AppError("Your session has expired. Please log in again.", { code: ErrorCodes.UNAUTHORIZED });
  }

  req.user = { id: payload.sub, role: payload.role };
  return next();
};
