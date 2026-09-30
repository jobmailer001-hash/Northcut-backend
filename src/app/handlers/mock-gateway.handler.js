import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { getMockPayment, settleMockPayment } from "#providers/mock-payment.provider.js";

// Development only: backs the fake checkout page (frontend /mock-pay/:reference) that
// stands in for a real provider's hosted checkout.

/**
 * @returns {AppError} PAYMENT_NOT_FOUND error.
 */
const paymentNotFoundError = () => {
  return new AppError("This payment link is invalid or has expired.", { code: ErrorCodes.PAYMENT_NOT_FOUND });
};

/**
 * Gets what the fake checkout page shows.
 * @param {string} reference - Payment reference.
 * @returns {Promise<{ reference: string, amount: number, currency: string, status: string, returnUrl: string }>}
 *   The fake payment.
 * @throws {AppError} PAYMENT_NOT_FOUND
 */
export const getCheckout = async (reference) => {
  const payment = await getMockPayment(reference);

  if (!payment) {
    throw paymentNotFoundError();
  }

  const { amount, currency, status, returnUrl } = payment;
  return { reference, amount, currency, status, returnUrl };
};

/**
 * "Pays" or fails a fake payment; the mock then sends the signed webhook to our API.
 * @param {Object} options
 * @param {string} options.reference - Payment reference.
 * @param {"success" | "failure"} options.outcome - What the customer chose.
 * @returns {Promise<{ status: string, returnUrl: string }>} The result and where to send the customer.
 * @throws {AppError} PAYMENT_NOT_FOUND
 */
export const completeCheckout = async ({ reference, outcome }) => {
  const payment = await settleMockPayment({ reference, isSuccessful: outcome === "success" });

  if (!payment) {
    throw paymentNotFoundError();
  }
  return { status: payment.status, returnUrl: payment.returnUrl };
};
