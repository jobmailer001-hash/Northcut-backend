import { UserLogActions } from "#constants/log.constants.js";
import { OrderStatuses } from "#constants/order.constants.js";
import { Roles, UserStatuses } from "#constants/user.constants.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { listAdminOrders } from "#handlers/admin-order.handler.js";
import { count as countOrders, sumRevenue } from "#repositories/order.repository.js";
import { findOne, findPage, updateStatus } from "#repositories/user.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";
import { revokeAllSessions } from "#utils/session.util.js";
import { escapeRegex } from "#utils/string.util.js";

/**
 * Orders that count as money received.
 * @type {string[]}
 */
const PAID_STATUSES = [OrderStatuses.PAID, OrderStatuses.SHIPPED, OrderStatuses.DELIVERED];

/**
 * How many recent orders the customer page shows.
 * @type {number}
 */
const RECENT_ORDERS_LIMIT = 20;

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 */

/**
 * @returns {AppError} CUSTOMER_NOT_FOUND error.
 */
const customerNotFoundError = () => new AppError("Customer not found.", { code: ErrorCodes.CUSTOMER_NOT_FOUND });

/**
 * The admin list view of a customer.
 * @param {import("mongoose").Document} user - The user.
 * @returns {{ id: string, name: string, email: string, status: string, createdAt: Date }} The customer.
 */
const toAdminCustomer = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  status: user.status,
  createdAt: user.createdAt,
});

/**
 * Lists customers (admins are never included), newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.search] - Name or email substring.
 * @param {string} [options.status] - ACTIVE or DISABLED.
 * @returns {Promise<{ customers: Object[], pagination: Object }>} A page of customers.
 */
export const listCustomers = async ({ page, limit, search, status }) => {
  const searchPattern = search && new RegExp(escapeRegex(search), "i");
  const filter = {
    role: Roles.CUSTOMER,
    ...(status && { status }),
    ...(searchPattern && { $or: [{ name: searchPattern }, { email: searchPattern }] }),
  };
  const { users, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { customers: users.map(toAdminCustomer), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets a customer with addresses, spend stats and recent orders.
 * @param {string} customerId - The customer's id.
 * @returns {Promise<{ customer: Object, stats: Object, recentOrders: Object[] }>} The customer page data.
 * @throws {AppError} CUSTOMER_NOT_FOUND
 */
export const getCustomer = async (customerId) => {
  const user = await findOne({ _id: customerId, role: Roles.CUSTOMER });

  if (!user) {
    throw customerNotFoundError();
  }

  const [orderCount, paid, recent] = await Promise.all([
    countOrders({ userId: customerId }),
    sumRevenue({ statuses: PAID_STATUSES, userId: customerId }),
    listAdminOrders({ page: 1, limit: RECENT_ORDERS_LIMIT, customerId }),
  ]);

  return {
    customer: { ...toAdminCustomer(user), addresses: user.addresses },
    stats: { orderCount, paidOrderCount: paid.orderCount, totalSpent: paid.revenue },
    recentOrders: recent.orders,
  };
};

/**
 * Enables or disables a customer. Disabling logs them out on every device immediately
 * (their access token lapses within ~15 min and can't be refreshed).
 * @param {Object} options
 * @param {string} options.customerId - The customer's id.
 * @param {string} options.status - ACTIVE or DISABLED.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The updated customer.
 * @throws {AppError} CUSTOMER_NOT_FOUND - also for admin accounts, which can't be changed here.
 */
export const updateCustomerStatus = async ({ customerId, status, adminId, context }) => {
  const user = await updateStatus({ filter: { _id: customerId, role: Roles.CUSTOMER }, status });

  if (!user) {
    throw customerNotFoundError();
  }

  const isDisabling = status === UserStatuses.DISABLED;
  if (isDisabling) {
    await revokeAllSessions(customerId);
  }

  await writeUserLog({
    userId: adminId,
    action: isDisabling ? UserLogActions.CUSTOMER_DISABLED : UserLogActions.CUSTOMER_ENABLED,
    context,
    meta: { customerId, email: user.email },
  });
  return toAdminCustomer(user);
};
