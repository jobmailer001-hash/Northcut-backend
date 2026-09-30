import { Router } from "express";

import { getTransaction, listTransactions } from "#controllers/admin-transaction.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import { idParamsSchema, listTransactionsQuerySchema } from "#validators/admin.validator.js";

/**
 * Admin transaction routes, mounted at /api/v1/admin/transactions (auth + ADMIN applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminTransactionRoutes = Router();

adminTransactionRoutes.get("/", validate({ query: listTransactionsQuerySchema }), listTransactions);
adminTransactionRoutes.get("/:id", validate({ params: idParamsSchema }), getTransaction);
