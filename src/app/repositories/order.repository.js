import mongoose from "mongoose";

import { OrderStatuses, OrderTypes, ReservationPools, ReservationStatuses } from "#constants/order.constants.js";
import { Order } from "#models/order.model.js";

/**
 * Newest first.
 * @type {Record<string, 1 | -1>}
 */
const newestFirst = { createdAt: -1 };

/**
 * Customer fields shown alongside orders in the admin.
 * @type {string}
 */
const CUSTOMER_FIELDS = "name email";

/**
 * Marks a paid order SHIPPED and its hold FULFILLED. Only matches a PAID order whose stock
 * is still HELD on the STOCK pool (a pre-order must be converted to stock first).
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The shipped order, or null if it doesn't qualify.
 */
export const markShipped = async ({ orderId, session }) => {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      status: OrderStatuses.PAID,
      reservationStatus: ReservationStatuses.HELD,
      reservedFrom: ReservationPools.STOCK,
    },
    {
      $set: {
        status: OrderStatuses.SHIPPED,
        shippedAt: new Date(),
        reservationStatus: ReservationStatuses.FULFILLED,
      },
    },
    { returnDocument: "after", session },
  );
};

/**
 * Marks a shipped order DELIVERED.
 * @param {string} orderId - The order's id.
 * @returns {Promise<import("mongoose").Document | null>} The delivered order, or null if it wasn't SHIPPED.
 */
export const markDelivered = async (orderId) => {
  return Order.findOneAndUpdate(
    { _id: orderId, status: OrderStatuses.SHIPPED },
    { $set: { status: OrderStatuses.DELIVERED, deliveredAt: new Date() } },
    { returnDocument: "after" },
  );
};

/**
 * Finds an order by id with its customer's name and email.
 * @param {string} orderId - The order's id.
 * @returns {Promise<import("mongoose").Document | null>} The order, or null.
 */
export const findByIdWithCustomer = async (orderId) => Order.findById(orderId).populate("userId", CUSTOMER_FIELDS);

/**
 * Returns one page of orders matching a filter, newest first, with customer name/email, plus the total.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ orders: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [orders, total] = await Promise.all([
    Order.find(filter).sort(newestFirst).skip(skip).limit(limit).populate("userId", CUSTOMER_FIELDS),
    Order.countDocuments(filter),
  ]);
  return { orders, total };
};

/**
 * Counts orders per status.
 * @returns {Promise<Record<string, number>>} e.g. `{ PAID: 4, SHIPPED: 2 }` (missing statuses mean 0).
 */
export const countByStatus = async () => {
  const groups = await Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  return Object.fromEntries(groups.map((group) => [group._id, group.count]));
};

/**
 * Sums order totals and counts orders in the given statuses, optionally since a date / for one customer.
 * @param {Object} options
 * @param {string[]} options.statuses - Statuses that count as revenue.
 * @param {Date} [options.since] - Only orders created at or after this.
 * @param {string} [options.userId] - Only this customer's orders.
 * @returns {Promise<{ revenue: number, orderCount: number }>} Revenue in kobo and the order count.
 */
export const sumRevenue = async ({ statuses, since, userId }) => {
  const [result] = await Order.aggregate([
    {
      $match: {
        status: { $in: statuses },
        ...(since && { createdAt: { $gte: since } }),
        ...(userId && { userId: new mongoose.Types.ObjectId(userId) }),
      },
    },
    { $group: { _id: null, revenue: { $sum: "$total" }, orderCount: { $sum: 1 } } },
  ]);
  return { revenue: result?.revenue ?? 0, orderCount: result?.orderCount ?? 0 };
};

/**
 * Counts orders matching a filter.
 * @param {Object} filter - Mongo filter.
 * @returns {Promise<number>} The count.
 */
export const count = async (filter) => Order.countDocuments(filter);

/**
 * Inserts an order inside a transaction.
 * @param {Object} options
 * @param {Object} options.order - Order fields.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document>} The created order.
 */
export const create = async ({ order, session }) => {
  // Model.create only accepts a session with the array form.
  const [createdOrder] = await Order.create([order], { session });
  return createdOrder;
};

/**
 * Finds an order by id.
 * @param {string} orderId - The order's id.
 * @param {Object} [options]
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The order, or null.
 */
export const findById = async (orderId, { session } = {}) => Order.findById(orderId).session(session ?? null);

/**
 * Finds one of a user's orders by its order number.
 * @param {Object} options
 * @param {string} options.orderNumber - Human-readable order number.
 * @param {string} options.userId - The owner's id.
 * @returns {Promise<import("mongoose").Document | null>} The order, or null.
 */
export const findByNumberForUser = async ({ orderNumber, userId }) => Order.findOne({ orderNumber, userId });

/**
 * Replaces the shipping address on one of a user's orders, only while its status is one of
 * `statuses` — checked in the same update, so a concurrent status change can't slip through.
 * @param {Object} options
 * @param {string} options.orderNumber - Human-readable order number.
 * @param {string} options.userId - The owner's id.
 * @param {string[]} options.statuses - Statuses in which the address may change.
 * @param {Object} options.shippingAddress - The new shipping-address snapshot.
 * @returns {Promise<import("mongoose").Document | null>} The updated order, or null if none qualified.
 */
export const updateShippingAddressForUser = async ({ orderNumber, userId, statuses, shippingAddress }) => {
  return Order.findOneAndUpdate(
    { orderNumber, userId, status: { $in: statuses } },
    { $set: { shippingAddress } },
    { returnDocument: "after", runValidators: true },
  );
};

/**
 * Returns one page of a user's orders, newest first, plus the total count.
 * @param {Object} options
 * @param {string} options.userId - The owner's id.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ orders: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPageForUser = async ({ userId, skip, limit }) => {
  const [orders, total] = await Promise.all([
    Order.find({ userId }).sort(newestFirst).skip(skip).limit(limit),
    Order.countDocuments({ userId }),
  ]);
  return { orders, total };
};

/**
 * Moves an order whose stock is still HELD to a new status and marks the hold RELEASED —
 * only if its status is one of `fromStatuses`. The HELD condition makes this happen once.
 * @param {Object} options
 * @param {Object} options.filter - Identifies the order (e.g. `{ _id }` or `{ orderNumber, userId }`).
 * @param {string[]} options.fromStatuses - Statuses the order may currently be in.
 * @param {Object} options.set - Status and timestamp fields to set.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The updated order, or null if it didn't qualify.
 */
export const releaseHeldOrder = async ({ filter, fromStatuses, set, session }) => {
  return Order.findOneAndUpdate(
    { ...filter, status: { $in: fromStatuses }, reservationStatus: ReservationStatuses.HELD },
    { $set: { ...set, reservationStatus: ReservationStatuses.RELEASED } },
    { returnDocument: "after", session },
  );
};

/**
 * Marks an unpaid order PAID. Only matches while it's still PENDING_PAYMENT with stock HELD,
 * so an expired or cancelled order can never become paid.
 * @param {Object} options
 * @param {string} options.orderId - The order's id.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The paid order, or null if it no longer qualifies.
 */
export const markPaid = async ({ orderId, session }) => {
  return Order.findOneAndUpdate(
    { _id: orderId, status: OrderStatuses.PENDING_PAYMENT, reservationStatus: ReservationStatuses.HELD },
    { $set: { status: OrderStatuses.PAID, paidAt: new Date() } },
    { returnDocument: "after", session },
  );
};

/**
 * Re-points held pre-orders for a product from the pre-order pool to stock
 * (their product has just switched to IN_STOCK).
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<number>} How many orders moved.
 */
export const movePreorderHoldsToStock = async ({ productId, session }) => {
  const result = await Order.updateMany(
    {
      type: OrderTypes.PREORDER,
      "items.productId": productId,
      reservationStatus: ReservationStatuses.HELD,
      reservedFrom: ReservationPools.PREORDER,
    },
    { $set: { reservedFrom: ReservationPools.STOCK } },
    { session },
  );
  return result.modifiedCount;
};
