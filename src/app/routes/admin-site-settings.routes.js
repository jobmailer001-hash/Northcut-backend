import { Router } from "express";

import { removeHeroImage, updateSiteSettings, uploadHeroImage } from "#controllers/site-settings.controller.js";
import { MAX_IMAGE_UPLOAD_TOTAL_BYTES } from "#constants/product.constants.js";
import { uploadJpegImages } from "#middlewares/upload.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import { heroPanelParamsSchema, updateSiteSettingsBodySchema } from "#validators/site-settings.validator.js";

/**
 * Multipart field name for a hero image upload.
 * @type {string}
 */
const HERO_IMAGE_FIELD = "image";

/**
 * Admin site-settings routes, mounted at /api/v1/admin/site-settings (auth + ADMIN role applied
 * by admin.routes.js). Reading the settings is public — see site-settings.routes.js.
 * @type {import("express").Router}
 */
export const adminSiteSettingsRoutes = Router();

adminSiteSettingsRoutes.patch("/", validate({ body: updateSiteSettingsBodySchema }), updateSiteSettings);
adminSiteSettingsRoutes.post(
  "/hero/:panel",
  validate({ params: heroPanelParamsSchema }),
  uploadJpegImages({ fieldName: HERO_IMAGE_FIELD, maxCount: 1, maxTotalBytes: MAX_IMAGE_UPLOAD_TOTAL_BYTES }),
  uploadHeroImage,
);
adminSiteSettingsRoutes.delete("/hero/:panel", validate({ params: heroPanelParamsSchema }), removeHeroImage);
