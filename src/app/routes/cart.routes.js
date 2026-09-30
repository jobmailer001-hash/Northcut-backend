import { Router } from "express";

import { previewCart } from "#controllers/cart.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import { previewCartBodySchema } from "#validators/order.validator.js";

/**
 * Public cart routes, mounted at /api/v1/cart. The cart itself lives in the browser.
 * @type {import("express").Router}
 */
export const cartRoutes = Router();

cartRoutes.post("/preview", validate({ body: previewCartBodySchema }), previewCart);
