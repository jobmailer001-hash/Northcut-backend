import { SystemLog } from "#models/system-log.model.js";

/**
 * Inserts a system log entry.
 * @param {Object} entry - Log fields.
 * @returns {Promise<import("mongoose").Document>} The created entry.
 */
export const create = async (entry) => SystemLog.create(entry);

/**
 * Returns one page of system logs matching a filter, newest first, plus the total.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ logs: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [logs, total] = await Promise.all([
    SystemLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SystemLog.countDocuments(filter),
  ]);
  return { logs, total };
};
