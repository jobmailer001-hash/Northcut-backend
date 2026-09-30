import {
  getSiteSettings as getSiteSettingsHandler,
  queueHeroImage as queueHeroImageHandler,
  removeHeroImage as removeHeroImageHandler,
  updateSiteSettings as updateSiteSettingsHandler,
} from "#handlers/site-settings.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /site-settings — public; the storefront loads these before it renders.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the settings.
 */
export const getSiteSettings = async (req, res) => {
  const settings = await getSiteSettingsHandler();
  return res.status(200).json({ data: { settings } });
};

/**
 * PATCH /admin/site-settings — updates settings (currently the brand colours).
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the settings.
 */
export const updateSiteSettings = async (req, res) => {
  const settings = await updateSiteSettingsHandler({
    ...req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { settings } });
};

/**
 * POST /admin/site-settings/hero/:panel — accepts a hero image and queues its upload.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 202 with the queued upload.
 */
export const uploadHeroImage = async (req, res) => {
  const upload = await queueHeroImageHandler({
    panel: req.validated.params.panel,
    file: req.files?.[0],
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(202).json({ data: { upload: { ...upload, status: "PROCESSING" } } });
};

/**
 * DELETE /admin/site-settings/hero/:panel — clears a hero panel.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the settings.
 */
export const removeHeroImage = async (req, res) => {
  const settings = await removeHeroImageHandler({
    panel: req.validated.params.panel,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { settings } });
};
