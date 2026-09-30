import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

import { env } from "#configs/env.config.js";

/**
 * Only algorithm accepted when verifying, so a token can't pick a weaker one.
 * @type {string}
 */
const ACCESS_TOKEN_ALGORITHM = "HS256";

/**
 * Signs a short-lived access token with payload `{ sub, role }`.
 * @param {Object} options
 * @param {string} options.userId - Becomes the `sub` claim.
 * @param {string} options.role - One of Roles.
 * @returns {string} The signed JWT.
 */
export const signAccessToken = ({ userId, role }) => {
  return jwt.sign({ role }, env.jwtAccessSecret, {
    subject: String(userId),
    expiresIn: env.accessTokenTtlSeconds,
    algorithm: ACCESS_TOKEN_ALGORITHM,
  });
};

/**
 * Verifies an access token's signature and expiry.
 * @param {string} token - The JWT from the Authorization header.
 * @returns {{ sub: string, role: string }} The decoded payload.
 * @throws {import("jsonwebtoken").JsonWebTokenError} When the token is invalid or expired.
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwtAccessSecret, { algorithms: [ACCESS_TOKEN_ALGORITHM] });
};

/**
 * Generates an opaque refresh token, used as the Redis session key.
 * @returns {string} A random UUID v4.
 */
export const generateRefreshToken = () => uuidv4();

/**
 * Generates an opaque, single-use password-reset token.
 * @returns {string} A random UUID v4.
 */
export const generateResetToken = () => uuidv4();
