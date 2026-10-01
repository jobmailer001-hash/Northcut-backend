import {
  getPublicLook as getPublicLookHandler,
  listPublicLooks as listPublicLooksHandler,
} from "#handlers/look.handler.js";

/**
 * GET /looks — lists public looks.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with looks and pagination.
 */
export const listLooks = async (req, res) => {
  const { looks, pagination } = await listPublicLooksHandler(req.validated.query);
  return res.status(200).json({ data: { looks, pagination } });
};

/**
 * GET /looks/:slug — gets one public look with its products.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the look.
 */
export const getLook = async (req, res) => {
  const look = await getPublicLookHandler(req.validated.params.slug);
  return res.status(200).json({ data: { look } });
};
