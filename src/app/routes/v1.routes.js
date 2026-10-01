import { Router } from "express";

import { env } from "#configs/env.config.js";

import { adminRoutes } from "./admin.routes.js";
import { authRoutes } from "./auth.routes.js";
import { cartRoutes } from "./cart.routes.js";
import { healthRoutes } from "./health.routes.js";
import { lookRoutes } from "./look.routes.js";
import { meRoutes } from "./me.routes.js";
import { mockGatewayRoutes } from "./mock-gateway.routes.js";
import { orderRoutes } from "./order.routes.js";
import { productRoutes } from "./product.routes.js";
import { siteSettingsRoutes } from "./site-settings.routes.js";
import { webhookRoutes } from "./webhook.routes.js";

/**
 * Every v1 feature router, mounted at /api/v1.
 * @type {import("express").Router}
 */
export const v1Routes = Router();

v1Routes.use("/health", healthRoutes);
v1Routes.use("/auth", authRoutes);
v1Routes.use("/me", meRoutes);
v1Routes.use("/products", productRoutes);
v1Routes.use("/looks", lookRoutes);
v1Routes.use("/cart", cartRoutes);
v1Routes.use("/orders", orderRoutes);
v1Routes.use("/site-settings", siteSettingsRoutes);
v1Routes.use("/webhooks", webhookRoutes);

// The fake payment gateway is only reachable in production when deliberately enabled
// (ALLOW_MOCK_PAYMENTS=true) — see env.isMockGatewayEnabled.
if (env.isMockGatewayEnabled) {
  v1Routes.use("/mock-gateway", mockGatewayRoutes);
}
v1Routes.use("/admin", adminRoutes);
