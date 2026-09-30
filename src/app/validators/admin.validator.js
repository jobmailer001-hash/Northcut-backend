import { z } from "zod";

import { LogLevels, SystemLogEvents, UserLogActions } from "#constants/log.constants.js";
import { OrderStatuses, OrderTypes } from "#constants/order.constants.js";
import { TransactionStatuses, TransactionTypes } from "#constants/transaction.constants.js";
import { UserStatuses } from "#constants/user.constants.js";

import { objectIdField, paginationQueryShape } from "./common.validator.js";

/**
 * `:id` route param for any admin resource.
 * @type {import("zod").ZodObject}
 */
export const idParamsSchema = z.object({ id: objectIdField });

/**
 * GET /admin/orders query.
 * @type {import("zod").ZodObject}
 */
export const listAdminOrdersQuerySchema = z.object({
  ...paginationQueryShape(20),
  status: z.enum(Object.values(OrderStatuses)).optional(),
  type: z.enum(Object.values(OrderTypes)).optional(),
  search: z.string().trim().max(20).optional(),
  customerId: objectIdField.optional(),
});

/**
 * PATCH /admin/orders/:id/status body. Only forward fulfilment steps; cancelling has its own endpoint.
 * @type {import("zod").ZodObject}
 */
export const updateOrderStatusBodySchema = z.object({
  status: z.enum([OrderStatuses.SHIPPED, OrderStatuses.DELIVERED]),
});

/**
 * POST /admin/orders/:id/cancel body.
 * @type {import("zod").ZodObject}
 */
export const adminCancelOrderBodySchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/**
 * GET /admin/transactions query.
 * @type {import("zod").ZodObject}
 */
export const listTransactionsQuerySchema = z.object({
  ...paginationQueryShape(20),
  type: z.enum(Object.values(TransactionTypes)).optional(),
  status: z.enum(Object.values(TransactionStatuses)).optional(),
  search: z.string().trim().max(60).optional(),
});

/**
 * GET /admin/customers query.
 * @type {import("zod").ZodObject}
 */
export const listCustomersQuerySchema = z.object({
  ...paginationQueryShape(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(Object.values(UserStatuses)).optional(),
});

/**
 * PATCH /admin/customers/:id/status body.
 * @type {import("zod").ZodObject}
 */
export const updateCustomerStatusBodySchema = z.object({
  status: z.enum(Object.values(UserStatuses)),
});

/**
 * GET /admin/logs/system query.
 * @type {import("zod").ZodObject}
 */
export const listSystemLogsQuerySchema = z.object({
  ...paginationQueryShape(30),
  level: z.enum(Object.values(LogLevels)).optional(),
  event: z.enum(Object.values(SystemLogEvents)).optional(),
  entityId: z.string().trim().max(40).optional(),
});

/**
 * GET /admin/logs/users query.
 * @type {import("zod").ZodObject}
 */
export const listUserLogsQuerySchema = z.object({
  ...paginationQueryShape(30),
  action: z.enum(Object.values(UserLogActions)).optional(),
  userId: objectIdField.optional(),
});
