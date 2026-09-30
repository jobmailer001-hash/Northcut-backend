import {
  getPublicProduct as getPublicProductHandler,
  listPublicProducts as listPublicProductsHandler,
} from "#handlers/product.handler.js";

/**
 * GET /products — lists public products.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with products and pagination.
 */
export const listProducts = async (req, res) => {
  const { products, pagination } = await listPublicProductsHandler(req.validated.query);
  return res.status(200).json({ data: { products, pagination } });
};

/**
 * GET /products/:slug — gets one public product.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product.
 */
export const getProduct = async (req, res) => {
  const product = await getPublicProductHandler(req.validated.params.slug);
  return res.status(200).json({ data: { product } });
};
