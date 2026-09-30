import { TransactionStatuses, TransactionTypes } from "#constants/transaction.constants.js";
import { Transaction } from "#models/transaction.model.js";

/**
 * Inserts a transaction.
 * @param {Object} transaction - Transaction fields.
 * @returns {Promise<import("mongoose").Document>} The created transaction.
 */
export const create = async (transaction) => Transaction.create(transaction);

/**
 * Finds a transaction by id.
 * @param {string} transactionId - The transaction's id.
 * @returns {Promise<import("mongoose").Document | null>} The transaction, or null.
 */
export const findById = async (transactionId) => Transaction.findById(transactionId);

/**
 * Returns one page of transactions matching a filter, newest first, with order number and
 * customer, plus the total.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ transactions: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("orderId", "orderNumber")
      .populate("userId", "name email"),
    Transaction.countDocuments(filter),
  ]);
  return { transactions, total };
};

/**
 * Finds a transaction by id with its order, customer, and (for refunds) the payment it reverses.
 * @param {string} transactionId - The transaction's id.
 * @returns {Promise<import("mongoose").Document | null>} The transaction, or null.
 */
export const findByIdWithRelations = async (transactionId) => {
  return Transaction.findById(transactionId)
    .populate("orderId", "orderNumber status total")
    .populate("userId", "name email")
    .populate("refundOf", "providerReference");
};

/**
 * Lists every transaction for an order, oldest first.
 * @param {string} orderId - The order's id.
 * @returns {Promise<import("mongoose").Document[]>} The transactions.
 */
export const findByOrderId = async (orderId) => Transaction.find({ orderId }).sort({ createdAt: 1 });

/**
 * Finds a transaction by our provider reference.
 * @param {string} providerReference - The reference sent to the provider.
 * @returns {Promise<import("mongoose").Document | null>} The transaction, or null.
 */
export const findByReference = async (providerReference) => Transaction.findOne({ providerReference });

/**
 * Finds the refund for a payment, if one was started.
 * @param {string} paymentTransactionId - The PAYMENT transaction's id.
 * @returns {Promise<import("mongoose").Document | null>} The refund, or null.
 */
export const findRefundOf = async (paymentTransactionId) => Transaction.findOne({ refundOf: paymentTransactionId });

/**
 * Lists an order's successful payments (normally one; two if a customer paid twice).
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document[]>} The payments.
 */
export const findSucceededPaymentsForOrder = async ({ orderId, session }) => {
  return Transaction.find({
    orderId,
    type: TransactionTypes.PAYMENT,
    status: TransactionStatuses.SUCCEEDED,
  }).session(session ?? null);
};

/**
 * Moves a transaction to a new status, only if it's currently in one of `fromStatuses`.
 * @param {Object} options
 * @param {string} options.transactionId - The transaction's id.
 * @param {string[]} options.fromStatuses - Statuses it may currently be in.
 * @param {string} options.status - The new status.
 * @param {Object} [options.providerPayload] - What the provider reported.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The updated transaction, or null if it didn't qualify.
 */
export const updateStatus = async ({ transactionId, fromStatuses, status, providerPayload, session }) => {
  return Transaction.findOneAndUpdate(
    { _id: transactionId, status: { $in: fromStatuses } },
    { $set: { status, ...(providerPayload && { providerPayload }) } },
    { returnDocument: "after", session },
  );
};

/**
 * Marks an order's still-pending payment attempts EXPIRED (the order was cancelled or expired).
 * An expired attempt that later succeeds is refunded.
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<void>}
 */
export const expirePendingPaymentsForOrder = async ({ orderId, session }) => {
  await Transaction.updateMany(
    { orderId, type: TransactionTypes.PAYMENT, status: TransactionStatuses.PENDING },
    { $set: { status: TransactionStatuses.EXPIRED } },
    { session },
  );
};
