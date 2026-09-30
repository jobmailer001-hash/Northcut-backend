import { Router } from "express";

import { getHealth } from "#controllers/health.controller.js";

/**
 * Health-check routes, mounted at /api/v1/health.
 * @type {import("express").Router}
 */
export const healthRoutes = Router();

healthRoutes.get("/", getHealth);
