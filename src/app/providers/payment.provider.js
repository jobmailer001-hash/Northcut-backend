import { env } from "#configs/env.config.js";

import {
  createPayment as createMockPayment,
  createRefund as createMockRefund,
  parseWebhookEvent as parseMockWebhookEvent,
  verifyPayment as verifyMockPayment,
  verifyWebhookSignature as verifyMockWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER as MOCK_WEBHOOK_SIGNATURE_HEADER,
} from "./mock-payment.provider.js";

// The payment adapter. Handlers import only from here, never a provider SDK, so swapping
// providers means adding one implementation below and changing PAYMENT_PROVIDER.
// Every implementation must provide the same functions with the same shapes.

/**
 * Available provider implementations, keyed by PAYMENT_PROVIDER.
 * @type {Record<string, Object>}
 */
const implementations = {
  mock: {
    signatureHeader: MOCK_WEBHOOK_SIGNATURE_HEADER,
    createPayment: createMockPayment,
    verifyPayment: verifyMockPayment,
    verifyWebhookSignature: verifyMockWebhookSignature,
    parseWebhookEvent: parseMockWebhookEvent,
    createRefund: createMockRefund,
  },
};

/**
 * The implementation selected by configuration.
 * @type {Object}
 */
const provider = implementations[env.paymentProvider];

/**
 * Name recorded on every Transaction.
 * @type {string}
 */
export const PAYMENT_PROVIDER_NAME = env.paymentProvider;

/**
 * Header the active provider puts its webhook signature in.
 * @type {string}
 */
export const WEBHOOK_SIGNATURE_HEADER = provider.signatureHeader;

/**
 * Starts a payment. See mock-payment.provider.js for the contract.
 * @param {{ reference: string, amount: number, currency: string, customerEmail: string, returnUrl: string }} options
 * @returns {Promise<{ checkoutUrl: string }>} Where to send the customer.
 */
export const createPayment = async (options) => provider.createPayment(options);

/**
 * Gets a payment's real status from the provider.
 * @param {string} reference - Our payment reference.
 * @returns {Promise<{ status: string, amount: number, currency: string, raw: Object } | null>} The status, or null if unknown.
 */
export const verifyPayment = async (reference) => provider.verifyPayment(reference);

/**
 * Checks a webhook signature.
 * @param {{ rawBody: Buffer | undefined, signature: string | undefined }} options
 * @returns {boolean} Whether it's genuine.
 */
export const verifyWebhookSignature = (options) => provider.verifyWebhookSignature(options);

/**
 * Extracts the event name and reference from a webhook body.
 * @param {Object} body - Parsed webhook JSON.
 * @returns {{ event: string, reference: string } | null} The event, or null if malformed.
 */
export const parseWebhookEvent = (body) => provider.parseWebhookEvent(body);

/**
 * Refunds a payment; idempotent by refund reference.
 * @param {{ paymentReference: string, refundReference: string, amount: number }} options
 * @returns {Promise<{ status: string, raw: Object }>} SUCCEEDED or FAILED.
 */
export const createRefund = async (options) => provider.createRefund(options);
