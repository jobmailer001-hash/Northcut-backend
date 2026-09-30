import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { toCustomerRef } from "#handlers/admin-order.handler.js";
import { findByIdWithRelations, findPage } from "#repositories/transaction.repository.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";
import { escapeRegex } from "#utils/string.util.js";

/**
 * The admin view of a transaction, with its order and customer (populated) renamed for clarity.
 * @param {import("mongoose").Document} transaction - Transaction with populated relations.
 * @returns {Object} The transaction.
 */
const toAdminTransaction = (transaction) => {
  const { orderId, userId, refundOf, ...fields } = transaction.toJSON();
  const order = transaction.orderId;

  return {
    ...fields,
    order: order?.orderNumber
      ? { id: order.id, orderNumber: order.orderNumber, status: order.status, total: order.total }
      : { id: String(order) },
    customer: toCustomerRef(transaction.userId),
    refundOf: transaction.refundOf?.providerReference
      ? { id: transaction.refundOf.id, providerReference: transaction.refundOf.providerReference }
      : undefined,
  };
};

/**
 * Lists transactions for the admin, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.type] - PAYMENT or REFUND.
 * @param {string} [options.status] - Filter by status.
 * @param {string} [options.search] - Provider-reference substring.
 * @returns {Promise<{ transactions: Object[], pagination: Object }>} A page of transactions.
 */
export const listTransactions = async ({ page, limit, type, status, search }) => {
  const filter = {
    ...(type && { type }),
    ...(status && { status }),
    ...(search && { providerReference: new RegExp(escapeRegex(search), "i") }),
  };
  const { transactions, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return {
    transactions: transactions.map(toAdminTransaction),
    pagination: buildPagination({ page, limit, total }),
  };
};

/**
 * Gets one transaction, including what the provider reported.
 * @param {string} transactionId - The transaction's id.
 * @returns {Promise<Object>} The transaction.
 * @throws {AppError} TRANSACTION_NOT_FOUND
 */
export const getTransaction = async (transactionId) => {
  const transaction = await findByIdWithRelations(transactionId);

  if (!transaction) {
    throw new AppError("Transaction not found.", { code: ErrorCodes.TRANSACTION_NOT_FOUND });
  }
  return toAdminTransaction(transaction);
};
