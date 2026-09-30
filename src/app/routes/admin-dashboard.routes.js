import { Router } from "express";

import { getDashboard, listSystemLogs, listUserLogs } from "#controllers/admin-dashboard.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import { listSystemLogsQuerySchema, listUserLogsQuerySchema } from "#validators/admin.validator.js";

/**
 * Admin overview routes (dashboard and logs), mounted at /api/v1/admin (auth + ADMIN applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminDashboardRoutes = Router();

adminDashboardRoutes.get("/dashboard", getDashboard);
adminDashboardRoutes.get("/logs/system", validate({ query: listSystemLogsQuerySchema }), listSystemLogs);
adminDashboardRoutes.get("/logs/users", validate({ query: listUserLogsQuerySchema }), listUserLogs);
