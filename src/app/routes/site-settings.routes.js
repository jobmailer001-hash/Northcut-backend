import { Router } from "express";

import { getSiteSettings } from "#controllers/site-settings.controller.js";

/**
 * Public site settings, mounted at /api/v1/site-settings. No authentication: the storefront
 * needs them before it renders. Changes go through adminSiteSettingsRoutes.
 * @type {import("express").Router}
 */
export const siteSettingsRoutes = Router();

siteSettingsRoutes.get("/", getSiteSettings);
