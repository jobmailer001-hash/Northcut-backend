import { Router } from "express";

import {
  createLook,
  getLook,
  getLookBySlug,
  listLooks,
  updateLook,
  uploadImage,
} from "#controllers/admin-look.controller.js";
import { MAX_IMAGE_UPLOAD_TOTAL_BYTES } from "#constants/product.constants.js";
import { uploadJpegImages } from "#middlewares/upload.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  createLookBodySchema,
  listAdminLooksQuerySchema,
  lookIdParamsSchema,
  lookSlugParamsSchema,
  updateLookBodySchema,
} from "#validators/look.validator.js";

/**
 * Multipart field name for a look image upload.
 * @type {string}
 */
const LOOK_IMAGE_FIELD = "image";

/**
 * Admin look routes, mounted at /api/v1/admin/looks (auth + ADMIN role applied by admin.routes.js).
 * @type {import("express").Router}
 */
export const adminLookRoutes = Router();

adminLookRoutes.get("/", validate({ query: listAdminLooksQuerySchema }), listLooks);
adminLookRoutes.post("/", validate({ body: createLookBodySchema }), createLook);
adminLookRoutes.get("/by-slug/:slug", validate({ params: lookSlugParamsSchema }), getLookBySlug);
adminLookRoutes.get("/:id", validate({ params: lookIdParamsSchema }), getLook);
adminLookRoutes.patch("/:id", validate({ params: lookIdParamsSchema, body: updateLookBodySchema }), updateLook);
adminLookRoutes.post(
  "/:id/image",
  validate({ params: lookIdParamsSchema }),
  uploadJpegImages({ fieldName: LOOK_IMAGE_FIELD, maxCount: 1, maxTotalBytes: MAX_IMAGE_UPLOAD_TOTAL_BYTES }),
  uploadImage,
);
