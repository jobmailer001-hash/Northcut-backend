import {
  adminCancelOrder as adminCancelOrderHandler,
  getAdminOrder as getAdminOrderHandler,
  listAdminOrders as listAdminOrdersHandler,
  updateOrderStatus as updateOrderStatusHandler,
} from "#handlers/admin-order.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /admin/orders — lists orders.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with orders and pagination.
 */
export const listOrders = async (req, res) => {
  const { orders, pagination } = await listAdminOrdersHandler(req.validated.query);
  return res.status(200).json({ data: { orders, pagination } });
};

/**
 * GET /admin/orders/:id — one order with customer and transactions.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the order.
 */
export const getOrder = async (req, res) => {
  const order = await getAdminOrderHandler(req.validated.params.id);
  return res.status(200).json({ data: { order } });
};

/**
 * PATCH /admin/orders/:id/status — mark SHIPPED or DELIVERED.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the updated order.
 */
export const updateOrderStatus = async (req, res) => {
  const order = await updateOrderStatusHandler({
    orderId: req.validated.params.id,
    status: req.validated.body.status,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { order } });
};

/**
 * POST /admin/orders/:id/cancel — cancel (and refund if paid).
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the cancelled order.
 */
export const cancelOrder = async (req, res) => {
  const order = await adminCancelOrderHandler({
    orderId: req.validated.params.id,
    reason: req.validated.body.reason,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { order } });
};
