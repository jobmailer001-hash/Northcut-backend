import { Router } from "express";

import { getCustomer, listCustomers, updateCustomerStatus } from "#controllers/admin-customer.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  idParamsSchema,
  listCustomersQuerySchema,
  updateCustomerStatusBodySchema,
} from "#validators/admin.validator.js";

/**
 * Admin customer routes, mounted at /api/v1/admin/customers (auth + ADMIN applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminCustomerRoutes = Router();

adminCustomerRoutes.get("/", validate({ query: listCustomersQuerySchema }), listCustomers);
adminCustomerRoutes.get("/:id", validate({ params: idParamsSchema }), getCustomer);
adminCustomerRoutes.patch(
  "/:id/status",
  validate({ params: idParamsSchema, body: updateCustomerStatusBodySchema }),
  updateCustomerStatus,
);
