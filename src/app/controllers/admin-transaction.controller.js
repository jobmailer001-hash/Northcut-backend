import {
  getTransaction as getTransactionHandler,
  listTransactions as listTransactionsHandler,
} from "#handlers/admin-transaction.handler.js";

/**
 * GET /admin/transactions — lists payments and refunds.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with transactions and pagination.
 */
export const listTransactions = async (req, res) => {
  const { transactions, pagination } = await listTransactionsHandler(req.validated.query);
  return res.status(200).json({ data: { transactions, pagination } });
};

/**
 * GET /admin/transactions/:id — one transaction.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the transaction.
 */
export const getTransaction = async (req, res) => {
  const transaction = await getTransactionHandler(req.validated.params.id);
  return res.status(200).json({ data: { transaction } });
};
