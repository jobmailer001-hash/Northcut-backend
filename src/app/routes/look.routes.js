import { Router } from "express";

import { getLook, listLooks } from "#controllers/look.controller.js";
import { validate } from "#middlewares/validate.middleware.js";
import { listPublicLooksQuerySchema, lookSlugParamsSchema } from "#validators/look.validator.js";

/**
 * Public look routes, mounted at /api/v1/looks.
 * @type {import("express").Router}
 */
export const lookRoutes = Router();

lookRoutes.get("/", validate({ query: listPublicLooksQuerySchema }), listLooks);
lookRoutes.get("/:slug", validate({ params: lookSlugParamsSchema }), getLook);
