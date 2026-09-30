import {
  cancelMyOrder as cancelMyOrderHandler,
  changeMyOrderShippingAddress as changeMyOrderShippingAddressHandler,
  getMyOrder as getMyOrderHandler,
  listMyOrders as listMyOrdersHandler,
  placeOrder as placeOrderHandler,
  placePreorder as placePreorderHandler,
} from "#handlers/order.handler.js";
import { startPaymentForMyOrder as startPaymentForMyOrderHandler } from "#handlers/payment.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * POST /orders — places a normal order.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with the order and where to pay.
 */
export const placeOrder = async (req, res) => {
  const { order, payment } = await placeOrderHandler({
    userId: req.user.id,
    ...req.validated.body,
    context: getRequestContext(req),
  });
  return res.status(201).json({ data: { order, payment } });
};

/**
 * POST /orders/preorder — places a single-item pre-order.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with the order and where to pay.
 */
export const placePreorder = async (req, res) => {
  const { order, payment } = await placePreorderHandler({
    userId: req.user.id,
    ...req.validated.body,
    context: getRequestContext(req),
  });
  return res.status(201).json({ data: { order, payment } });
};

/**
 * POST /orders/:orderNumber/payment — starts (or retries) payment for an unpaid order.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with where to pay.
 */
export const startPayment = async (req, res) => {
  const payment = await startPaymentForMyOrderHandler({
    userId: req.user.id,
    orderNumber: req.validated.params.orderNumber,
  });
  return res.status(201).json({ data: { payment } });
};

/**
 * GET /orders — lists the customer's orders.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with orders and pagination.
 */
export const listOrders = async (req, res) => {
  const { orders, pagination } = await listMyOrdersHandler({ userId: req.user.id, ...req.validated.query });
  return res.status(200).json({ data: { orders, pagination } });
};

/**
 * GET /orders/:orderNumber — one of the customer's orders.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the order.
 */
export const getOrder = async (req, res) => {
  const order = await getMyOrderHandler({ userId: req.user.id, orderNumber: req.validated.params.orderNumber });
  return res.status(200).json({ data: { order } });
};

/**
 * POST /orders/:orderNumber/cancel — cancels an unpaid order.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the cancelled order.
 */
export const cancelOrder = async (req, res) => {
  const order = await cancelMyOrderHandler({
    userId: req.user.id,
    orderNumber: req.validated.params.orderNumber,
    reason: req.validated.body.reason,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { order } });
};

/**
 * PATCH /orders/:orderNumber/shipping-address — changes where an order ships, until it's shipped.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the updated order.
 */
export const changeShippingAddress = async (req, res) => {
  const order = await changeMyOrderShippingAddressHandler({
    userId: req.user.id,
    orderNumber: req.validated.params.orderNumber,
    ...req.validated.body,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { order } });
};
