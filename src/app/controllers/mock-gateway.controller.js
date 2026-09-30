import {
  completeCheckout as completeCheckoutHandler,
  getCheckout as getCheckoutHandler,
} from "#handlers/mock-gateway.handler.js";

/**
 * GET /mock-gateway/payments/:reference — data for the fake checkout page.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the fake payment.
 */
export const getCheckout = async (req, res) => {
  const payment = await getCheckoutHandler(req.validated.params.reference);
  return res.status(200).json({ data: { payment } });
};

/**
 * POST /mock-gateway/payments/:reference/complete — settle the fake payment.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the result and return URL.
 */
export const completeCheckout = async (req, res) => {
  const result = await completeCheckoutHandler({
    reference: req.validated.params.reference,
    outcome: req.validated.body.outcome,
  });
  return res.status(200).json({ data: { result } });
};
