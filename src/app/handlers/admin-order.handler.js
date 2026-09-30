import { EmailTemplates } from "#constants/email.constants.js";
import { UserLogActions } from "#constants/log.constants.js";
import { CancelledBy, OrderStatuses, ReservationPools } from "#constants/order.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { queueOrderEmail } from "#handlers/email.handler.js";
import { fulfilOrderHold } from "#handlers/inventory.handler.js";
import { cancelExpiryJob, releaseOrder, toOrderSummary } from "#handlers/order.handler.js";
import { queueRefundsForOrder } from "#handlers/payment.handler.js";
import {
  findById as findOrderById,
  findByIdWithCustomer,
  findPage,
  markDelivered,
  markShipped,
} from "#repositories/order.repository.js";
import { findByOrderId as findTransactionsByOrderId } from "#repositories/transaction.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";
import { escapeRegex } from "#utils/string.util.js";

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 */

/**
 * @returns {AppError} ORDER_NOT_FOUND error.
 */
const orderNotFoundError = () => new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });

/**
 * The customer reference shown with an order (populated `userId`).
 * @param {import("mongoose").Document | Object} user - Populated user, or a bare id if the user was deleted.
 * @returns {{ id: string, name?: string, email?: string }} The customer reference.
 */
export const toCustomerRef = (user) => {
  return user?.email ? { id: user.id, name: user.name, email: user.email } : { id: String(user) };
};

/**
 * Order summary for admin lists: the customer summary plus the order's id and customer.
 * @param {import("mongoose").Document} order - Order with populated `userId`.
 * @returns {Object} The summary.
 */
export const toAdminOrderSummary = (order) => ({
  id: order.id,
  ...toOrderSummary(order),
  customer: toCustomerRef(order.userId),
});

/**
 * Loads the full admin view of an order: every field, the customer, and every transaction.
 * @param {string} orderId - The order's id.
 * @returns {Promise<Object>} The order.
 * @throws {AppError} ORDER_NOT_FOUND
 */
export const getAdminOrder = async (orderId) => {
  const [order, transactions] = await Promise.all([
    findByIdWithCustomer(orderId),
    findTransactionsByOrderId(orderId),
  ]);

  if (!order) {
    throw orderNotFoundError();
  }

  const { userId, ...fields } = order.toJSON();
  return { ...fields, customer: toCustomerRef(order.userId), transactions };
};

/**
 * Lists all orders for the admin, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.status] - Filter by status.
 * @param {string} [options.type] - Filter by NORMAL / PREORDER.
 * @param {string} [options.search] - Order-number prefix.
 * @param {string} [options.customerId] - Only this customer's orders.
 * @returns {Promise<{ orders: Object[], pagination: Object }>} A page of order summaries.
 */
export const listAdminOrders = async ({ page, limit, status, type, search, customerId }) => {
  const filter = {
    ...(status && { status }),
    ...(type && { type }),
    ...(search && { orderNumber: new RegExp(`^${escapeRegex(search.toUpperCase())}`) }),
    ...(customerId && { userId: customerId }),
  };
  const { orders, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { orders: orders.map(toAdminOrderSummary), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Explains why a status change matched nothing.
 * @param {string} orderId - The order's id.
 * @param {string} targetStatus - The status that was requested.
 * @returns {Promise<AppError>} The error to throw.
 */
const explainRefusedTransition = async (orderId, targetStatus) => {
  const order = await findOrderById(orderId);

  if (!order) {
    return orderNotFoundError();
  }
  if (targetStatus === OrderStatuses.SHIPPED && order.status === OrderStatuses.PAID && order.reservedFrom === ReservationPools.PREORDER) {
    return new AppError("This pre-order can't ship yet — switch its product to In stock first.", {
      code: ErrorCodes.PREORDER_NOT_READY_TO_SHIP,
    });
  }

  const requiredStatus = targetStatus === OrderStatuses.SHIPPED ? OrderStatuses.PAID : OrderStatuses.SHIPPED;
  return new AppError(`Only ${requiredStatus} orders can be marked ${targetStatus}.`, {
    code: ErrorCodes.INVALID_STATUS_TRANSITION,
    details: { status: order.status },
  });
};

/**
 * Moves an order forward: PAID → SHIPPED (units leave stock and reservations, in one
 * transaction) or SHIPPED → DELIVERED.
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {string} options.status - SHIPPED or DELIVERED.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The admin view of the updated order.
 * @throws {AppError} ORDER_NOT_FOUND | INVALID_STATUS_TRANSITION | PREORDER_NOT_READY_TO_SHIP
 */
export const updateOrderStatus = async ({ orderId, status, adminId, context }) => {
  const order =
    status === OrderStatuses.SHIPPED
      ? await runInTransaction(async (session) => {
          const shippedOrder = await markShipped({ orderId, session });
          if (shippedOrder) {
            await fulfilOrderHold({ order: shippedOrder, session });
          }
          return shippedOrder;
        })
      : await markDelivered(orderId);

  if (!order) {
    throw await explainRefusedTransition(orderId, status);
  }

  if (status === OrderStatuses.SHIPPED) {
    await queueOrderEmail({ template: EmailTemplates.ORDER_SHIPPED, order });
  }

  await writeUserLog({
    userId: adminId,
    action: status === OrderStatuses.SHIPPED ? UserLogActions.ORDER_SHIPPED : UserLogActions.ORDER_DELIVERED,
    context,
    meta: { orderId, orderNumber: order.orderNumber },
  });
  return getAdminOrder(orderId);
};

/**
 * Cancels an order as the admin: unpaid, or paid and not shipped (no 24h limit, unlike
 * customers). Stock is returned; a paid order is refunded by the refunds worker.
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {string} [options.reason] - Why (shown to the customer).
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The admin view of the cancelled order.
 * @throws {AppError} ORDER_NOT_FOUND | ORDER_NOT_CANCELLABLE
 */
export const adminCancelOrder = async ({ orderId, reason, adminId, context }) => {
  const order = await releaseOrder({
    filter: { _id: orderId },
    fromStatuses: [OrderStatuses.PENDING_PAYMENT, OrderStatuses.PAID],
    set: {
      status: OrderStatuses.CANCELLED,
      cancelledAt: new Date(),
      cancellation: { by: CancelledBy.ADMIN, reason },
    },
  });

  if (!order) {
    const existing = await findOrderById(orderId);
    if (!existing) {
      throw orderNotFoundError();
    }
    throw new AppError("Only unpaid or paid-but-unshipped orders can be cancelled.", {
      code: ErrorCodes.ORDER_NOT_CANCELLABLE,
      details: { status: existing.status },
    });
  }

  await cancelExpiryJob(order.id);
  if (order.paidAt) {
    await queueRefundsForOrder(order.id);
  }

  await queueOrderEmail({ template: EmailTemplates.ORDER_CANCELLED, order, reason });
  await writeUserLog({
    userId: adminId,
    action: UserLogActions.ORDER_CANCELLED_BY_ADMIN,
    context,
    meta: { orderId, orderNumber: order.orderNumber, reason, refunded: Boolean(order.paidAt) },
  });
  return getAdminOrder(orderId);
};
