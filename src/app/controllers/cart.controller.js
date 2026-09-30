import { previewCart as previewCartHandler } from "#handlers/cart.handler.js";

/**
 * POST /cart/preview — live prices, availability and issues for a cart.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the preview.
 */
export const previewCart = async (req, res) => {
  const preview = await previewCartHandler(req.validated.body.items);
  return res.status(200).json({ data: { preview } });
};
