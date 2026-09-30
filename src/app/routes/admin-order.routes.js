import { Router } from "express";

import { cancelOrder, getOrder, listOrders, updateOrderStatus } from "#controllers/admin-order.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  adminCancelOrderBodySchema,
  idParamsSchema,
  listAdminOrdersQuerySchema,
  updateOrderStatusBodySchema,
} from "#validators/admin.validator.js";

/**
 * Admin order routes, mounted at /api/v1/admin/orders (auth + ADMIN applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminOrderRoutes = Router();

adminOrderRoutes.get("/", validate({ query: listAdminOrdersQuerySchema }), listOrders);
adminOrderRoutes.get("/:id", validate({ params: idParamsSchema }), getOrder);
adminOrderRoutes.patch(
  "/:id/status",
  validate({ params: idParamsSchema, body: updateOrderStatusBodySchema }),
  updateOrderStatus,
);
adminOrderRoutes.post("/:id/cancel", validate({ params: idParamsSchema, body: adminCancelOrderBodySchema }), cancelOrder);
