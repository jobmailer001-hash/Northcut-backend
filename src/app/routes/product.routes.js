import { Router } from "express";

import { getProduct, listProducts } from "#controllers/product.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import { listPublicProductsQuerySchema, productSlugParamsSchema } from "#validators/product.validator.js";

/**
 * Public product routes, mounted at /api/v1/products.
 * @type {import("express").Router}
 */
export const productRoutes = Router();

productRoutes.get("/", validate({ query: listPublicProductsQuerySchema }), listProducts);
productRoutes.get("/:slug", validate({ params: productSlugParamsSchema }), getProduct);
