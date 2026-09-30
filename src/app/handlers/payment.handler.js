import { v4 as uuidv4 } from "uuid";

import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";
import { EmailTemplates } from "#constants/email.constants.js";
import { LogLevels, SystemLogEvents } from "#constants/log.constants.js";
import { OrderStatuses, ReservationStatuses } from "#constants/order.constants.js";
import { TransactionStatuses, TransactionTypes } from "#constants/transaction.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { queueOrderEmail } from "#handlers/email.handler.js";
import {
  createPayment,
  createRefund,
  PAYMENT_PROVIDER_NAME,
  parseWebhookEvent,
  verifyPayment,
  verifyWebhookSignature,
} from "#providers/payment.provider.js";
import { findByNumberForUser, markPaid } from "#repositories/order.repository.js";
import {
  create as createTransactionRepo,
  findById as findTransactionById,
  findByReference,
  findRefundOf,
  findSucceededPaymentsForOrder,
  updateStatus as updateTransactionStatus,
} from "#repositories/transaction.repository.js";
import { findById as findUserById } from "#repositories/user.repository.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import { writeSystemLog } from "#utils/log.util.js";
import { isDuplicateKeyError } from "#utils/mongo.util.js";

/**
 * Statuses a payment attempt can still move out of. EXPIRED is included because money can
 * arrive after its order died — it must still be recorded (and refunded).
 * @type {string[]}
 */
const OPEN_PAYMENT_STATUSES = [TransactionStatuses.PENDING, TransactionStatuses.EXPIRED];

/**
 * Where the customer lands after the provider's checkout.
 * @param {string} orderNumber - The order number.
 * @returns {string} Frontend order page, flagged so it knows to wait for confirmation.
 */
const buildReturnUrl = (orderNumber) => `${env.clientUrl}/orders/${orderNumber}?payment=return`;

/**
 * Starts a payment attempt for an order: records a PENDING transaction, then asks the
 * provider for a checkout URL. Each attempt gets its own reference.
 * @param {Object} options
 * @param {import("mongoose").Document} options.order - The unpaid order.
 * @returns {Promise<{ reference: string, checkoutUrl: string }>} Where to send the customer.
 */
export const startPayment = async ({ order }) => {
  const user = await findUserById(order.userId);
  const payment = await createTransactionRepo({
    orderId: order.id,
    userId: order.userId,
    type: TransactionTypes.PAYMENT,
    provider: PAYMENT_PROVIDER_NAME,
    providerReference: `NCPAY-${uuidv4()}`,
    amount: order.total,
    currency: order.currency,
  });

  try {
    const { checkoutUrl } = await createPayment({
      reference: payment.providerReference,
      amount: payment.amount,
      currency: payment.currency,
      customerEmail: user.email,
      returnUrl: buildReturnUrl(order.orderNumber),
    });
    return { reference: payment.providerReference, checkoutUrl };
  } catch (error) {
    await updateTransactionStatus({
      transactionId: payment.id,
      fromStatuses: [TransactionStatuses.PENDING],
      status: TransactionStatuses.FAILED,
    });
    throw error;
  }
};

/**
 * Starts (or retries) payment for one of the customer's unpaid orders.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} options.orderNumber - The order number.
 * @returns {Promise<{ reference: string, checkoutUrl: string }>} Where to send the customer.
 * @throws {AppError} ORDER_NOT_FOUND | PAYMENT_NOT_ALLOWED - not awaiting payment (paid, expired, cancelled).
 */
export const startPaymentForMyOrder = async ({ userId, orderNumber }) => {
  const order = await findByNumberForUser({ orderNumber, userId });

  if (!order) {
    throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
  }
  if (order.status !== OrderStatuses.PENDING_PAYMENT || order.reservationStatus !== ReservationStatuses.HELD) {
    throw new AppError("This order isn't awaiting payment.", {
      code: ErrorCodes.PAYMENT_NOT_ALLOWED,
      details: { status: order.status },
    });
  }

  return startPayment({ order });
};

/**
 * Accepts a provider webhook: checks its signature and queues it for the worker.
 * Does no business logic here, so the provider gets a fast 200.
 * @param {Object} options
 * @param {Buffer | undefined} options.rawBody - Exact request bytes (the signature covers these).
 * @param {string | undefined} options.signature - The signature header.
 * @param {Object} options.body - Parsed JSON body.
 * @returns {Promise<void>}
 * @throws {AppError} INVALID_WEBHOOK_SIGNATURE | VALIDATION_ERROR - malformed event.
 */
export const acceptPaymentWebhook = async ({ rawBody, signature, body }) => {
  if (!verifyWebhookSignature({ rawBody, signature })) {
    throw new AppError("Invalid webhook signature.", { code: ErrorCodes.INVALID_WEBHOOK_SIGNATURE });
  }

  const event = parseWebhookEvent(body);

  if (!event) {
    throw new AppError("Unrecognised webhook payload.", { code: ErrorCodes.VALIDATION_ERROR });
  }

  // Same event twice (provider retries) → same job id → queued once.
  await getQueue(QueueNames.PAYMENT_EVENTS).add(event.event, event, {
    jobId: `payment-event-${event.reference}-${event.event}`,
  });
};

/**
 * Queues a refund for one successful payment. Safe to call twice for the same payment.
 * @param {string} paymentTransactionId - The PAYMENT transaction's id.
 * @returns {Promise<void>}
 */
export const queueRefund = async (paymentTransactionId) => {
  await getQueue(QueueNames.REFUNDS).add(
    "refund",
    { paymentTransactionId },
    { jobId: `refund-${paymentTransactionId}` },
  );
};

/**
 * Queues refunds for every successful payment on an order (a cancelled paid order).
 * @param {string} orderId - The order's id.
 * @returns {Promise<void>}
 */
export const queueRefundsForOrder = async (orderId) => {
  const payments = await findSucceededPaymentsForOrder({ orderId });
  await Promise.all(payments.map((payment) => queueRefund(payment.id)));
};

/**
 * Applies a verified successful payment: marks it SUCCEEDED and its order PAID, together.
 * If the order can no longer be paid (expired/cancelled, or already paid by another attempt),
 * or the amount doesn't match, the payment is still recorded and flagged for refund.
 * @param {Object} options
 * @param {import("mongoose").Document} options.payment - The PAYMENT transaction.
 * @param {{ amount: number, currency: string, raw: Object }} options.verification - Provider's confirmation.
 * @returns {Promise<void>}
 */
const applySuccessfulPayment = async ({ payment, verification }) => {
  const isAmountCorrect = verification.amount === payment.amount && verification.currency === payment.currency;

  const outcome = await runInTransaction(async (session) => {
    const recordedPayment = await updateTransactionStatus({
      transactionId: payment.id,
      fromStatuses: OPEN_PAYMENT_STATUSES,
      status: TransactionStatuses.SUCCEEDED,
      providerPayload: verification.raw,
      session,
    });

    // Another worker already applied this event.
    if (!recordedPayment) return { isAlreadyApplied: true };
    if (!isAmountCorrect) return { needsRefund: true };

    const paidOrder = await markPaid({ orderId: payment.orderId, session });
    return { needsRefund: !paidOrder, paidOrder };
  });

  if (outcome.needsRefund) {
    await writeSystemLog({
      level: LogLevels.WARN,
      event: SystemLogEvents.PAYMENT_NOT_APPLICABLE,
      entityType: "Transaction",
      entityId: payment.id,
      message: isAmountCorrect
        ? `Payment ${payment.providerReference} arrived for an order that can no longer be paid; refunding.`
        : `Payment ${payment.providerReference} amount didn't match the order; refunding.`,
      meta: { orderId: String(payment.orderId), paidAmount: verification.amount, expectedAmount: payment.amount },
    });
    await queueRefund(payment.id);
    return;
  }

  if (outcome.paidOrder) {
    await writeSystemLog({
      level: LogLevels.INFO,
      event: SystemLogEvents.ORDER_PAID,
      entityType: "Order",
      entityId: outcome.paidOrder.id,
      message: `Order ${outcome.paidOrder.orderNumber} paid (${payment.providerReference}).`,
    });
    await queueOrderEmail({ template: EmailTemplates.ORDER_PAID, order: outcome.paidOrder });
  }
};

/**
 * Processes a payment webhook event (worker). Verifies with the provider rather than trusting
 * the webhook, and is safe to run repeatedly: settled payments are skipped.
 * A failed attempt doesn't release the order — the customer can retry until it expires.
 * @param {Object} options
 * @param {string} options.reference - Our payment reference.
 * @returns {Promise<void>}
 */
export const processPaymentEvent = async ({ reference }) => {
  const payment = await findByReference(reference);

  if (!payment || payment.type !== TransactionTypes.PAYMENT) {
    logger.warn("Payment event for unknown reference", { reference });
    return;
  }
  if (!OPEN_PAYMENT_STATUSES.includes(payment.status)) {
    return;
  }

  const verification = await verifyPayment(reference);

  if (!verification || verification.status === TransactionStatuses.PENDING) {
    // Not settled yet — the provider sends another event when it is.
    return;
  }

  if (verification.status === TransactionStatuses.FAILED) {
    await updateTransactionStatus({
      transactionId: payment.id,
      fromStatuses: OPEN_PAYMENT_STATUSES,
      status: TransactionStatuses.FAILED,
      providerPayload: verification.raw,
    });
    await writeSystemLog({
      level: LogLevels.INFO,
      event: SystemLogEvents.PAYMENT_FAILED,
      entityType: "Transaction",
      entityId: payment.id,
      message: `Payment attempt ${reference} failed; the order can still be paid until it expires.`,
      meta: { orderId: String(payment.orderId) },
    });
    return;
  }

  await applySuccessfulPayment({ payment, verification });
};

/**
 * Gets (or creates) the single REFUND transaction for a payment. The unique `refundOf`
 * index means concurrent jobs end up with the same refund.
 * @param {import("mongoose").Document} payment - The PAYMENT transaction.
 * @returns {Promise<import("mongoose").Document>} The refund transaction.
 */
const getOrCreateRefund = async (payment) => {
  const existingRefund = await findRefundOf(payment.id);

  if (existingRefund) {
    return existingRefund;
  }

  try {
    return await createTransactionRepo({
      orderId: payment.orderId,
      userId: payment.userId,
      type: TransactionTypes.REFUND,
      provider: payment.provider,
      // Deterministic, so a retried job asks the provider for the same refund, not a second one.
      providerReference: `NCREF-${payment.id}`,
      amount: payment.amount,
      currency: payment.currency,
      refundOf: payment.id,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return findRefundOf(payment.id);
    }
    throw error;
  }
};

/**
 * Refunds one successful payment in full (worker). Idempotent end to end.
 * @param {Object} options
 * @param {string} options.paymentTransactionId - The PAYMENT transaction's id.
 * @returns {Promise<void>}
 * @throws {Error} When the provider declines — BullMQ retries, then the failed job needs a person.
 */
export const processRefund = async ({ paymentTransactionId }) => {
  const payment = await findTransactionById(paymentTransactionId);

  if (payment?.type !== TransactionTypes.PAYMENT || payment.status !== TransactionStatuses.SUCCEEDED) {
    logger.warn("Refund requested for a payment that isn't refundable", { paymentTransactionId });
    return;
  }

  const refund = await getOrCreateRefund(payment);

  if (refund.status === TransactionStatuses.SUCCEEDED) {
    return;
  }

  const result = await createRefund({
    paymentReference: payment.providerReference,
    refundReference: refund.providerReference,
    amount: refund.amount,
  });

  await updateTransactionStatus({
    transactionId: refund.id,
    fromStatuses: [TransactionStatuses.PENDING, TransactionStatuses.FAILED],
    status: result.status,
    providerPayload: result.raw,
  });

  if (result.status !== TransactionStatuses.SUCCEEDED) {
    await writeSystemLog({
      level: LogLevels.ERROR,
      event: SystemLogEvents.REFUND_FAILED,
      entityType: "Transaction",
      entityId: refund.id,
      message: `Provider declined refund ${refund.providerReference}; will retry.`,
      meta: { paymentReference: payment.providerReference },
    });
    throw new Error(`Provider declined refund ${refund.providerReference}`);
  }

  await writeSystemLog({
    level: LogLevels.INFO,
    event: SystemLogEvents.REFUND_SUCCEEDED,
    entityType: "Transaction",
    entityId: refund.id,
    message: `Refunded ${payment.providerReference} in full (${refund.providerReference}).`,
    meta: { orderId: String(payment.orderId), amount: refund.amount },
  });
};
