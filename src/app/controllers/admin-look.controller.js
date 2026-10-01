import {
  createLook as createLookHandler,
  getAdminLook as getAdminLookHandler,
  getAdminLookBySlug as getAdminLookBySlugHandler,
  listAdminLooks as listAdminLooksHandler,
  queueLookImage as queueLookImageHandler,
  updateLook as updateLookHandler,
} from "#handlers/look.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /admin/looks — lists all looks, including hidden.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with looks and pagination.
 */
export const listLooks = async (req, res) => {
  const { looks, pagination } = await listAdminLooksHandler(req.validated.query);
  return res.status(200).json({ data: { looks, pagination } });
};

/**
 * GET /admin/looks/:id — gets one look with its products.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the look.
 */
export const getLook = async (req, res) => {
  const look = await getAdminLookHandler(req.validated.params.id);
  return res.status(200).json({ data: { look } });
};

/**
 * GET /admin/looks/by-slug/:slug — gets one look (including hidden) by slug.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the look.
 */
export const getLookBySlug = async (req, res) => {
  const look = await getAdminLookBySlugHandler(req.validated.params.slug);
  return res.status(200).json({ data: { look } });
};

/**
 * POST /admin/looks — creates a look.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with the look.
 */
export const createLook = async (req, res) => {
  const look = await createLookHandler({
    fields: req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(201).json({ data: { look } });
};

/**
 * PATCH /admin/looks/:id — updates a look's details, publicity or products.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the look.
 */
export const updateLook = async (req, res) => {
  const look = await updateLookHandler({
    lookId: req.validated.params.id,
    changes: req.validated.body,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { look } });
};

/**
 * POST /admin/looks/:id/image — accepts the look's image and queues its upload.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 202 with the queued upload.
 */
export const uploadImage = async (req, res) => {
  const upload = await queueLookImageHandler({
    lookId: req.validated.params.id,
    file: req.files?.[0],
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(202).json({ data: { upload: { ...upload, status: "PROCESSING" } } });
};
