import {
  adjustStock as adjustStockHandler,
  createProduct as createProductHandler,
  getAdminProduct as getAdminProductHandler,
  getAdminProductBySlug as getAdminProductBySlugHandler,
  listAdminProducts as listAdminProductsHandler,
  queueProductImages as queueProductImagesHandler,
  removeProductImage as removeProductImageHandler,
  updateProduct as updateProductHandler,
} from "#handlers/product.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /admin/products — lists all products, including hidden.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with products and pagination.
 */
export const listProducts = async (req, res) => {
  const { products, pagination } = await listAdminProductsHandler(req.validated.query);
  return res.status(200).json({ data: { products, pagination } });
};

/**
 * GET /admin/products/:id — gets one product.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product.
 */
export const getProduct = async (req, res) => {
  const product = await getAdminProductHandler(req.validated.params.id);
  return res.status(200).json({ data: { product } });
};

/**
 * GET /admin/products/by-slug/:slug — gets one product (including hidden) by slug.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product.
 */
export const getProductBySlug = async (req, res) => {
  const product = await getAdminProductBySlugHandler(req.validated.params.slug);
  return res.status(200).json({ data: { product } });
};

/**
 * POST /admin/products — creates a product.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with the product.
 */
export const createProduct = async (req, res) => {
  const product = await createProductHandler({
    fields: req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(201).json({ data: { product } });
};

/**
 * PATCH /admin/products/:id — updates product details.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product and any looks hidden with it.
 */
export const updateProduct = async (req, res) => {
  const { product, hiddenLooks } = await updateProductHandler({
    productId: req.validated.params.id,
    changes: req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { product, hiddenLooks } });
};

/**
 * PATCH /admin/products/:id/stock — adjusts physical stock.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product.
 */
export const adjustStock = async (req, res) => {
  const product = await adjustStockHandler({
    productId: req.validated.params.id,
    ...req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { product } });
};

/**
 * POST /admin/products/:id/images — accepts images and queues their upload to Cloudinary.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 202 with the queued upload.
 */
export const addImages = async (req, res) => {
  const upload = await queueProductImagesHandler({
    productId: req.validated.params.id,
    files: req.files,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(202).json({ data: { upload: { ...upload, status: "PROCESSING" } } });
};

/**
 * DELETE /admin/products/:id/images/:imageId — removes an image.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the product.
 */
export const removeImage = async (req, res) => {
  const product = await removeProductImageHandler({
    productId: req.validated.params.id,
    imageId: req.validated.params.imageId,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { product } });
};
