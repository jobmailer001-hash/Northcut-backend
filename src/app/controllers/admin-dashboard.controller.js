import { getDashboard as getDashboardHandler } from "#handlers/dashboard.handler.js";
import {
  listSystemLogs as listSystemLogsHandler,
  listUserLogs as listUserLogsHandler,
} from "#handlers/log.handler.js";

/**
 * GET /admin/dashboard — overview figures.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the dashboard.
 */
export const getDashboard = async (req, res) => {
  const dashboard = await getDashboardHandler();
  return res.status(200).json({ data: { dashboard } });
};

/**
 * GET /admin/logs/system — system events.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with logs and pagination.
 */
export const listSystemLogs = async (req, res) => {
  const { logs, pagination } = await listSystemLogsHandler(req.validated.query);
  return res.status(200).json({ data: { logs, pagination } });
};

/**
 * GET /admin/logs/users — user actions.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with logs and pagination.
 */
export const listUserLogs = async (req, res) => {
  const { logs, pagination } = await listUserLogsHandler(req.validated.query);
  return res.status(200).json({ data: { logs, pagination } });
};
