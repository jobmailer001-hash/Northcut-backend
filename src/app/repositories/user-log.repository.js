import { UserLog } from "#models/user-log.model.js";

/**
 * Inserts a user audit log entry.
 * @param {Object} options
 * @param {string} options.userId - The acting user's id.
 * @param {string} options.action - One of UserLogActions.
 * @param {string} [options.ip] - Request IP.
 * @param {string} [options.userAgent] - Request user agent.
 * @param {Object} [options.meta] - Extra context.
 * @returns {Promise<import("mongoose").Document>} The created log entry.
 */
export const create = async ({ userId, action, ip, userAgent, meta }) => {
  return UserLog.create({ userId, action, ip, userAgent, meta });
};

/**
 * Returns one page of user logs matching a filter, newest first, with the user's name/email.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ logs: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [logs, total] = await Promise.all([
    UserLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("userId", "name email role"),
    UserLog.countDocuments(filter),
  ]);
  return { logs, total };
};
