import { toCustomerRef } from "#handlers/admin-order.handler.js";
import { findPage as findSystemLogPage } from "#repositories/system-log.repository.js";
import { findPage as findUserLogPage } from "#repositories/user-log.repository.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";

/**
 * Lists system events, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.level] - Filter by level.
 * @param {string} [options.event] - Filter by event.
 * @param {string} [options.entityId] - Only events about this entity.
 * @returns {Promise<{ logs: Object[], pagination: Object }>} A page of system logs.
 */
export const listSystemLogs = async ({ page, limit, level, event, entityId }) => {
  const filter = { ...(level && { level }), ...(event && { event }), ...(entityId && { entityId }) };
  const { logs, total } = await findSystemLogPage({ filter, skip: toSkip({ page, limit }), limit });
  return { logs, pagination: buildPagination({ page, limit, total }) };
};

/**
 * Lists user actions (customers and admins), newest first, with who did them.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.action] - Filter by action.
 * @param {string} [options.userId] - Only this user's actions.
 * @returns {Promise<{ logs: Object[], pagination: Object }>} A page of user logs.
 */
export const listUserLogs = async ({ page, limit, action, userId }) => {
  const filter = { ...(action && { action }), ...(userId && { userId }) };
  const { logs, total } = await findUserLogPage({ filter, skip: toSkip({ page, limit }), limit });

  return {
    logs: logs.map((log) => {
      const { userId: populatedUser, ...fields } = log.toJSON();
      return { ...fields, user: { ...toCustomerRef(log.userId), role: log.userId?.role } };
    }),
    pagination: buildPagination({ page, limit, total }),
  };
};
