import { logger } from "#configs/logger.config.js";
import { create as createSystemLogRepo } from "#repositories/system-log.repository.js";
import { create as createUserLogRepo } from "#repositories/user-log.repository.js";

/**
 * Records a user action in UserLogs and winston. A failed audit write is logged
 * but never fails the request that triggered it.
 * @param {Object} options
 * @param {string} options.userId - The acting user's id.
 * @param {string} options.action - One of UserLogActions.
 * @param {{ ip?: string, userAgent?: string }} [options.context] - Request context.
 * @param {Object} [options.meta] - Extra details (never passwords, tokens or codes).
 * @returns {Promise<void>}
 */
export const writeUserLog = async ({ userId, action, context = {}, meta }) => {
  logger.info(`user.${action}`, { userId: String(userId), ...meta });

  try {
    await createUserLogRepo({ userId, action, ip: context.ip, userAgent: context.userAgent, meta });
  } catch (error) {
    logger.error("Failed to write user log", { userId: String(userId), action, message: error.message });
  }
};

/**
 * Records a system event in SystemLogs and winston. Like writeUserLog, a failed audit
 * write is logged but never fails the job or request that triggered it.
 * @param {Object} options
 * @param {string} options.level - One of LogLevels.
 * @param {string} options.event - One of SystemLogEvents.
 * @param {string} options.entityType - e.g. "Order", "Transaction", "Product".
 * @param {string} options.entityId - The entity's id.
 * @param {string} options.message - Human-readable summary.
 * @param {Object} [options.meta] - Extra details.
 * @returns {Promise<void>}
 */
export const writeSystemLog = async ({ level, event, entityType, entityId, message, meta }) => {
  logger.log(level, `system.${event}: ${message}`, { entityType, entityId: String(entityId), ...meta });

  try {
    await createSystemLogRepo({ level, event, entityType, entityId: String(entityId), message, meta });
  } catch (error) {
    logger.error("Failed to write system log", { event, message: error.message });
  }
};
