import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";
import { TransactionStatuses } from "#constants/transaction.constants.js";
import { redis } from "#db/redis/redis.connection.js";

// A stand-in payment provider for development. It plays both sides:
// - the adapter functions our handlers call (same shape a real provider adapter will have), and
// - the provider's own servers: it keeps fake payments in Redis, serves the fake checkout page's
//   data, and sends signed webhooks back to our API when the customer "pays".

/**
 * How long fake payments and refunds are kept.
 * @type {number}
 */
const MOCK_RECORD_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Header carrying the webhook's HMAC-SHA256 signature.
 * @type {string}
 */
export const WEBHOOK_SIGNATURE_HEADER = "x-payment-signature";

/**
 * Webhook event names the mock sends.
 * @type {Readonly<Record<string, string>>}
 */
const MockEvents = {
  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
};

/**
 * @param {string} reference - Payment reference.
 * @returns {string} Redis key of a fake payment.
 */
const paymentKey = (reference) => `mockpay:payment:${reference}`;

/**
 * @param {string} reference - Refund reference.
 * @returns {string} Redis key of a fake refund.
 */
const refundKey = (reference) => `mockpay:refund:${reference}`;

/**
 * Reads a JSON record from Redis.
 * @param {string} key - Redis key.
 * @returns {Promise<Object | null>} The record, or null.
 */
const readRecord = async (key) => {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
};

/**
 * Writes a JSON record to Redis with the mock TTL.
 * @param {string} key - Redis key.
 * @param {Object} record - The record.
 * @returns {Promise<void>}
 */
const writeRecord = async (key, record) => {
  await redis.set(key, JSON.stringify(record), "EX", MOCK_RECORD_TTL_SECONDS);
};

/**
 * Signs a webhook body the way the provider would.
 * @param {string | Buffer} body - The exact raw body.
 * @returns {string} Hex HMAC-SHA256 signature.
 */
const signPayload = (body) => createHmac("sha256", env.paymentWebhookSecret).update(body).digest("hex");

// ---- Adapter interface (called by our handlers through payment.provider.js) ----

/**
 * Starts a payment and returns where to send the customer.
 * @param {Object} options
 * @param {string} options.reference - Our unique payment reference.
 * @param {number} options.amount - Amount in kobo.
 * @param {string} options.currency - Currency code.
 * @param {string} options.customerEmail - Payer's email.
 * @param {string} options.returnUrl - Where the customer returns after paying.
 * @returns {Promise<{ checkoutUrl: string }>} The hosted checkout URL.
 */
export const createPayment = async ({ reference, amount, currency, customerEmail, returnUrl }) => {
  await writeRecord(paymentKey(reference), {
    reference,
    amount,
    currency,
    customerEmail,
    returnUrl,
    status: TransactionStatuses.PENDING,
    createdAt: new Date().toISOString(),
  });
  return { checkoutUrl: `${env.clientUrl}/mock-pay/${encodeURIComponent(reference)}` };
};

/**
 * Asks the provider for a payment's real status (never trust a webhook body on its own).
 * @param {string} reference - Our payment reference.
 * @returns {Promise<{ status: string, amount: number, currency: string, raw: Object } | null>}
 *   Status is one of TransactionStatuses PENDING | SUCCEEDED | FAILED; null if the provider doesn't know it.
 */
export const verifyPayment = async (reference) => {
  const record = await readRecord(paymentKey(reference));
  return record ? { status: record.status, amount: record.amount, currency: record.currency, raw: record } : null;
};

/**
 * Checks a webhook's signature against its exact raw body, in constant time.
 * @param {Object} options
 * @param {Buffer | undefined} options.rawBody - The request body bytes as received.
 * @param {string | undefined} options.signature - The signature header.
 * @returns {boolean} Whether the webhook is genuine.
 */
export const verifyWebhookSignature = ({ rawBody, signature }) => {
  if (!rawBody || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(signPayload(rawBody), "hex"), Buffer.from(signature, "hex"));
};

/**
 * Extracts what we need from a webhook body.
 * @param {Object} body - Parsed webhook JSON.
 * @returns {{ event: string, reference: string } | null} The event, or null if malformed.
 */
export const parseWebhookEvent = (body) => {
  const event = body?.event;
  const reference = body?.data?.reference;
  return typeof event === "string" && typeof reference === "string" ? { event, reference } : null;
};

/**
 * Refunds a successful payment. Idempotent by `refundReference`: asking again returns the first result.
 * @param {Object} options
 * @param {string} options.paymentReference - The payment to refund.
 * @param {string} options.refundReference - Our unique refund reference.
 * @param {number} options.amount - Amount to refund, in kobo.
 * @returns {Promise<{ status: string, raw: Object }>} SUCCEEDED or FAILED.
 */
export const createRefund = async ({ paymentReference, refundReference, amount }) => {
  const existingRefund = await readRecord(refundKey(refundReference));

  if (existingRefund) {
    return { status: existingRefund.status, raw: existingRefund };
  }

  const payment = await readRecord(paymentKey(paymentReference));
  const isRefundable = payment?.status === TransactionStatuses.SUCCEEDED && amount <= payment.amount;
  const refund = {
    refundReference,
    paymentReference,
    amount,
    status: isRefundable ? TransactionStatuses.SUCCEEDED : TransactionStatuses.FAILED,
    createdAt: new Date().toISOString(),
  };

  await writeRecord(refundKey(refundReference), refund);
  return { status: refund.status, raw: refund };
};

// ---- Gateway simulation (the fake checkout page, via mock-gateway routes) ----

/**
 * Returns a fake payment for the checkout page.
 * @param {string} reference - Payment reference.
 * @returns {Promise<Object | null>} The fake payment, or null.
 */
export const getMockPayment = async (reference) => readRecord(paymentKey(reference));

/**
 * Settles a fake payment as the customer chose, then sends the signed webhook to our API —
 * exactly what a real provider does. Settling twice has no further effect.
 * @param {Object} options
 * @param {string} options.reference - Payment reference.
 * @param {boolean} options.isSuccessful - Pay (true) or simulate a failed payment (false).
 * @returns {Promise<Object | null>} The settled payment, or null if it doesn't exist.
 */
export const settleMockPayment = async ({ reference, isSuccessful }) => {
  const payment = await readRecord(paymentKey(reference));

  if (!payment || payment.status !== TransactionStatuses.PENDING) {
    return payment;
  }

  payment.status = isSuccessful ? TransactionStatuses.SUCCEEDED : TransactionStatuses.FAILED;
  payment.settledAt = new Date().toISOString();
  await writeRecord(paymentKey(reference), payment);

  const body = JSON.stringify({
    event: isSuccessful ? MockEvents.PAYMENT_SUCCEEDED : MockEvents.PAYMENT_FAILED,
    data: { reference, amount: payment.amount, currency: payment.currency },
  });

  try {
    const response = await fetch(`${env.apiUrl}/api/v1/webhooks/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: signPayload(body) },
      body,
    });
    if (!response.ok) {
      logger.warn("Mock gateway webhook was rejected", { reference, status: response.status });
    }
  } catch (error) {
    // A real provider would retry; for the mock, the API can still verify on the next event.
    logger.error("Mock gateway couldn't deliver webhook", { reference, message: error.message });
  }

  return payment;
};
