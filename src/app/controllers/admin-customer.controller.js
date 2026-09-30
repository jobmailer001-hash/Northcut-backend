import {
  getCustomer as getCustomerHandler,
  listCustomers as listCustomersHandler,
  updateCustomerStatus as updateCustomerStatusHandler,
} from "#handlers/admin-customer.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /admin/customers — lists customers.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with customers and pagination.
 */
export const listCustomers = async (req, res) => {
  const { customers, pagination } = await listCustomersHandler(req.validated.query);
  return res.status(200).json({ data: { customers, pagination } });
};

/**
 * GET /admin/customers/:id — customer details, stats and recent orders.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the customer page data.
 */
export const getCustomer = async (req, res) => {
  const { customer, stats, recentOrders } = await getCustomerHandler(req.validated.params.id);
  return res.status(200).json({ data: { customer, stats, recentOrders } });
};

/**
 * PATCH /admin/customers/:id/status — enable or disable.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the customer.
 */
export const updateCustomerStatus = async (req, res) => {
  const customer = await updateCustomerStatusHandler({
    customerId: req.validated.params.id,
    status: req.validated.body.status,
    adminId: req.user.id,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { customer } });
};
