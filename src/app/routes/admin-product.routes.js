import { Router } from "express";

import {
  addImages,
  adjustStock,
  createProduct,
  getProduct,
  getProductBySlug,
  listProducts,
  removeImage,
  updateProduct,
} from "#controllers/admin-product.controller.js";
import { MAX_IMAGE_UPLOAD_TOTAL_BYTES, MAX_IMAGES_PER_PRODUCT } from "#constants/product.constants.js";
import { uploadJpegImages } from "#middlewares/upload.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  adjustStockBodySchema,
  createProductBodySchema,
  listAdminProductsQuerySchema,
  productIdParamsSchema,
  productImageParamsSchema,
  productSlugParamsSchema,
  updateProductBodySchema,
} from "#validators/product.validator.js";

/**
 * Multipart field name for product image uploads.
 * @type {string}
 */
const IMAGES_FIELD = "images";

/**
 * Admin product routes, mounted at /api/v1/admin/products (auth + ADMIN role applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminProductRoutes = Router();

adminProductRoutes.get("/", validate({ query: listAdminProductsQuerySchema }), listProducts);
adminProductRoutes.post("/", validate({ body: createProductBodySchema }), createProduct);
adminProductRoutes.get("/by-slug/:slug", validate({ params: productSlugParamsSchema }), getProductBySlug);
adminProductRoutes.get("/:id", validate({ params: productIdParamsSchema }), getProduct);
adminProductRoutes.patch("/:id", validate({ params: productIdParamsSchema, body: updateProductBodySchema }), updateProduct);
adminProductRoutes.patch(
  "/:id/stock",
  validate({ params: productIdParamsSchema, body: adjustStockBodySchema }),
  adjustStock,
);
adminProductRoutes.post(
  "/:id/images",
  validate({ params: productIdParamsSchema }),
  uploadJpegImages({
    fieldName: IMAGES_FIELD,
    maxCount: MAX_IMAGES_PER_PRODUCT,
    maxTotalBytes: MAX_IMAGE_UPLOAD_TOTAL_BYTES,
  }),
  addImages,
);
adminProductRoutes.delete("/:id/images/:imageId", validate({ params: productImageParamsSchema }), removeImage);
