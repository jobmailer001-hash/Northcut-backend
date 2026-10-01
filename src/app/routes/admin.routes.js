import { Router } from "express";

import { Roles } from "#constants/user.constants.js";
import { authenticate } from "#middlewares/authenticate.middleware.js";
import { requireRole } from "#middlewares/require-role.middleware.js";

import { adminCustomerRoutes } from "./admin-customer.routes.js";
import { adminDashboardRoutes } from "./admin-dashboard.routes.js";
import { adminLookRoutes } from "./admin-look.routes.js";
import { adminOrderRoutes } from "./admin-order.routes.js";
import { adminProductRoutes } from "./admin-product.routes.js";
import { adminSiteSettingsRoutes } from "./admin-site-settings.routes.js";
import { adminTransactionRoutes } from "./admin-transaction.routes.js";

/**
 * Every admin router, mounted at /api/v1/admin. Authentication and the ADMIN role
 * are enforced once here, so no admin route can be added without them.
 * @type {import("express").Router}
 */
export const adminRoutes = Router();

adminRoutes.use(authenticate, requireRole(Roles.ADMIN));
adminRoutes.use("/products", adminProductRoutes);
adminRoutes.use("/looks", adminLookRoutes);
adminRoutes.use("/orders", adminOrderRoutes);
adminRoutes.use("/transactions", adminTransactionRoutes);
adminRoutes.use("/customers", adminCustomerRoutes);
adminRoutes.use("/site-settings", adminSiteSettingsRoutes);
adminRoutes.use(adminDashboardRoutes);
