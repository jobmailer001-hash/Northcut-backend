import { acceptPaymentWebhook as acceptPaymentWebhookHandler } from "#handlers/payment.handler.js";
import { WEBHOOK_SIGNATURE_HEADER } from "#providers/payment.provider.js";

/**
 * POST /webhooks/payments — payment provider events. Verifies, queues, and answers fast;
 * the worker does the processing.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200.
 */
export const receivePaymentWebhook = async (req, res) => {
  await acceptPaymentWebhookHandler({
    rawBody: req.rawBody,
    signature: req.get(WEBHOOK_SIGNATURE_HEADER),
    body: req.body,
  });
  return res.status(200).json({ data: { received: true } });
};
