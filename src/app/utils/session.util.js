import { env } from "#configs/env.config.js";
import { redis } from "#db/redis/redis.connection.js";

// Every Redis key the app uses is built here and nowhere else.

/**
 * @param {string} refreshToken - The session's refresh token.
 * @returns {string} The session key.
 */
const sessionKey = (refreshToken) => `session:${refreshToken}`;

/**
 * @param {string} userId - The user's id.
 * @returns {string} The key of the set holding a user's refresh tokens.
 */
const userSessionsKey = (userId) => `user_sessions:${userId}`;

/**
 * @param {string} userId - The user's id.
 * @returns {string} The password-reset code key.
 */
const resetCodeKey = (userId) => `pwreset:code:${userId}`;

/**
 * @param {string} resetToken - The reset token issued after code verification.
 * @returns {string} The password-reset token key.
 */
const resetTokenKey = (resetToken) => `pwreset:token:${resetToken}`;

/**
 * Stores a new session and indexes it under the user so it can be revoked with the rest.
 * @param {Object} options
 * @param {string} options.refreshToken - The new refresh token.
 * @param {string} options.userId - The user's id.
 * @param {string} options.role - One of Roles.
 * @param {string} options.email - The user's email.
 * @returns {Promise<void>}
 */
export const createSession = async ({ refreshToken, userId, role, email }) => {
  const session = { userId: String(userId), role, email, createdAt: new Date().toISOString() };
  const ttl = env.refreshTokenTtlSeconds;

  await redis
    .multi()
    .set(sessionKey(refreshToken), JSON.stringify(session), "EX", ttl)
    .sadd(userSessionsKey(session.userId), refreshToken)
    .expire(userSessionsKey(session.userId), ttl)
    .exec();
};

/**
 * Reads a session by refresh token.
 * @param {string} refreshToken - The refresh token from the cookie.
 * @returns {Promise<{ userId: string, role: string, email: string, createdAt: string } | null>} The session, or null if missing/expired.
 */
export const getSession = async (refreshToken) => {
  const rawSession = await redis.get(sessionKey(refreshToken));
  return rawSession ? JSON.parse(rawSession) : null;
};

/**
 * Deletes one session (logout).
 * @param {string} refreshToken - The refresh token from the cookie.
 * @returns {Promise<{ userId: string } | null>} The deleted session, or null if it didn't exist.
 */
export const deleteSession = async (refreshToken) => {
  const session = await getSession(refreshToken);

  if (!session) {
    return null;
  }

  await redis.multi().del(sessionKey(refreshToken)).srem(userSessionsKey(session.userId), refreshToken).exec();
  return session;
};

/**
 * Deletes every session a user has (password reset/change, account disabled).
 * @param {string} userId - The user's id.
 * @returns {Promise<void>}
 */
export const revokeAllSessions = async (userId) => {
  const refreshTokens = await redis.smembers(userSessionsKey(userId));
  await redis.del(...refreshTokens.map(sessionKey), userSessionsKey(userId));
};

/**
 * Deletes every session a user has except one (password change keeps the current device logged in).
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string | undefined} options.keepRefreshToken - The session to keep; if missing, all are revoked.
 * @returns {Promise<void>}
 */
export const revokeOtherSessions = async ({ userId, keepRefreshToken }) => {
  const refreshTokens = await redis.smembers(userSessionsKey(userId));
  const tokensToRevoke = refreshTokens.filter((refreshToken) => refreshToken !== keepRefreshToken);

  if (!tokensToRevoke.length) {
    return;
  }

  await redis
    .multi()
    .del(...tokensToRevoke.map(sessionKey))
    .srem(userSessionsKey(userId), ...tokensToRevoke)
    .exec();
};

/**
 * Stores a hashed reset code with a zero attempt count, replacing any previous code.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.codeHash - Hash of the reset code.
 * @returns {Promise<void>}
 */
export const saveResetCode = async ({ userId, codeHash }) => {
  const key = resetCodeKey(userId);
  await redis.multi().del(key).hset(key, { codeHash, attempts: 0 }).expire(key, env.passwordResetCodeTtlSeconds).exec();
};

/**
 * Reads a user's pending reset code.
 * @param {string} userId - The user's id.
 * @returns {Promise<{ codeHash: string, attempts: number } | null>} The code record, or null if none/expired.
 */
export const getResetCode = async (userId) => {
  const record = await redis.hgetall(resetCodeKey(userId));
  return record.codeHash ? { codeHash: record.codeHash, attempts: Number(record.attempts) } : null;
};

/**
 * Records a failed verification attempt against a user's reset code.
 * @param {string} userId - The user's id.
 * @returns {Promise<number>} The new attempt count.
 */
export const incrementResetCodeAttempts = async (userId) => {
  return redis.hincrby(resetCodeKey(userId), "attempts", 1);
};

/**
 * Deletes a user's reset code (used, or too many attempts).
 * @param {string} userId - The user's id.
 * @returns {Promise<void>}
 */
export const deleteResetCode = async (userId) => {
  await redis.del(resetCodeKey(userId));
};

/**
 * Stores a short-lived reset token that authorises setting a new password.
 * @param {Object} options
 * @param {string} options.resetToken - The token returned to the client.
 * @param {string} options.userId - The user it belongs to.
 * @returns {Promise<void>}
 */
export const saveResetToken = async ({ resetToken, userId }) => {
  await redis.set(resetTokenKey(resetToken), String(userId), "EX", env.passwordResetTokenTtlSeconds);
};

/**
 * Reads and deletes a reset token in one step, so it can only be used once.
 * @param {string} resetToken - The token from the client.
 * @returns {Promise<string | null>} The user id, or null if invalid/expired/used.
 */
export const consumeResetToken = async (resetToken) => {
  return redis.getdel(resetTokenKey(resetToken));
};
