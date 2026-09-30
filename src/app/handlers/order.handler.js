import { randomInt } from "node:crypto";

import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";
import { EmailTemplates } from "#constants/email.constants.js";
import { LogLevels, SystemLogEvents, UserLogActions } from "#constants/log.constants.js";
import {
  CancelledBy,
  CURRENCY,
  CUSTOMER_CANCEL_WINDOW_MS,
  ItemIssueReasons,
  MAX_QUANTITY_PER_ITEM,
  OrderStatuses,
  OrderTypes,
  ReservationPools,
  ReservationStatuses,
} from "#constants/order.constants.js";
import { AvailabilityStatuses, PublicityStatuses } from "#constants/product.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { buildCartRequiresUpdateError, calculateTotals, validateItems } from "#handlers/cart.handler.js";
import { queueOrderEmail } from "#handlers/email.handler.js";
import { releaseOrderHold, reserveItems } from "#handlers/inventory.handler.js";
import { queueRefundsForOrder, startPayment } from "#handlers/payment.handler.js";
import {
  create as createOrderRepo,
  findByNumberForUser,
  findPageForUser,
  releaseHeldOrder,
  updateShippingAddressForUser,
} from "#repositories/order.repository.js";
import { findBySku } from "#repositories/product.repository.js";
import { expirePendingPaymentsForOrder } from "#repositories/transaction.repository.js";
import { findById as findUserById } from "#repositories/user.repository.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import { writeSystemLog, writeUserLog } from "#utils/log.util.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";

/**
 * Characters used in order-number suffixes (no 0/O, 1/I/L, to avoid misreading).
 * @type {string}
 */
const ORDER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Length of the random order-number suffix (31^6 ≈ 887M combinations per day).
 * @type {number}
 */
const ORDER_CODE_LENGTH = 6;

/**
 * Address fields copied onto an order.
 * @type {string[]}
 */
const SHIPPING_ADDRESS_FIELDS = ["fullName", "phone", "line1", "line2", "city", "state", "country", "postalCode"];

/**
 * Statuses in which the customer can still change where an order ships — anything before
 * it's shipped. Cancelled and expired orders won't ship at all.
 * @type {string[]}
 */
const ADDRESS_CHANGEABLE_STATUSES = [OrderStatuses.PENDING_PAYMENT, OrderStatuses.PAID];

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 * @typedef {{ sku: string, quantity: number }} CartItem
 */

/**
 * Generates a human-readable order number, e.g. "NC-260928-7K3QX9".
 * @returns {string} The order number.
 */
const generateOrderNumber = () => {
  const datePart = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const codePart = Array.from(
    { length: ORDER_CODE_LENGTH },
    () => ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)],
  ).join("");
  return `NC-${datePart}-${codePart}`;
};

/**
 * BullMQ job id for an order's expiry, so it can be found (and removed) later.
 * @param {string} orderId - The order's id.
 * @returns {string} The job id.
 */
const expiryJobId = (orderId) => `order-expiry-${orderId}`;

/**
 * Copies only the snapshot fields from an address.
 * @param {Object} address - A saved address or a validated inline address.
 * @returns {Object} The shipping-address snapshot.
 */
const toShippingAddress = (address) => {
  return Object.fromEntries(SHIPPING_ADDRESS_FIELDS.map((field) => [field, address[field]]));
};

/**
 * Resolves the order's shipping address from a saved address id or an inline address.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} [options.shippingAddressId] - A saved address id.
 * @param {Object} [options.shippingAddress] - A validated inline address.
 * @returns {Promise<Object>} The shipping-address snapshot.
 * @throws {AppError} ADDRESS_NOT_FOUND
 */
const resolveShippingAddress = async ({ userId, shippingAddressId, shippingAddress }) => {
  if (!shippingAddressId) {
    return toShippingAddress(shippingAddress);
  }

  const user = await findUserById(userId);
  const savedAddress = user?.addresses.id(shippingAddressId);

  if (!savedAddress) {
    throw new AppError("That address is no longer in your address book.", { code: ErrorCodes.ADDRESS_NOT_FOUND });
  }
  return toShippingAddress(savedAddress);
};

/**
 * Work to do once an order is committed: schedule its expiry and log. Failures here are
 * logged — the order itself already exists. A one-off checkout address is never saved to
 * the address book; it lives only on the order.
 * @param {Object} options
 * @param {import("mongoose").Document} options.order - The new order.
 * @param {string} options.userId - The customer's id.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<void>}
 */
const afterOrderPlaced = async ({ order, userId, context }) => {
  await getQueue(QueueNames.ORDER_EXPIRY).add(
    "expire",
    { orderId: order.id },
    { jobId: expiryJobId(order.id), delay: Math.max(0, order.expiresAt.getTime() - Date.now()) },
  );

  await queueOrderEmail({ template: EmailTemplates.ORDER_PLACED, order });
  await writeUserLog({
    userId,
    action: UserLogActions.ORDER_PLACED,
    context,
    meta: { orderNumber: order.orderNumber, type: order.type, total: order.total },
  });
};

/**
 * Removes an order's pending expiry job. Best-effort: expiry is a no-op for
 * orders that are no longer pending, so a leftover job is harmless.
 * @param {string} orderId - The order's id.
 * @returns {Promise<void>}
 */
export const cancelExpiryJob = async (orderId) => {
  try {
    const job = await getQueue(QueueNames.ORDER_EXPIRY).getJob(expiryJobId(orderId));
    await job?.remove();
  } catch (error) {
    logger.warn("Couldn't remove order expiry job", { orderId, message: error.message });
  }
};

/**
 * Whether the customer may still cancel: any time while unpaid, or within 24h of paying
 * while its stock is still held (i.e. not shipped).
 * @param {import("mongoose").Document} order - The order.
 * @returns {boolean} Whether "Cancel" should be offered.
 */
const isCustomerCancellable = (order) => {
  if (order.reservationStatus !== ReservationStatuses.HELD) return false;
  if (order.status === OrderStatuses.PENDING_PAYMENT) return true;
  return order.status === OrderStatuses.PAID && Date.now() - order.paidAt.getTime() <= CUSTOMER_CANCEL_WINDOW_MS;
};

/**
 * Starts the first payment for a new order. Best-effort: if the provider is down the order
 * still stands and the customer can press "Pay" later.
 * @param {import("mongoose").Document} order - The new order.
 * @returns {Promise<{ reference: string, checkoutUrl: string } | null>} The payment, or null.
 */
const tryStartPayment = async (order) => {
  try {
    return await startPayment({ order });
  } catch (error) {
    logger.error("Couldn't start payment for new order", { orderNumber: order.orderNumber, message: error.message });
    return null;
  }
};

/**
 * The customer-facing view of an order, without internal hold bookkeeping.
 * @param {import("mongoose").Document} order - The order.
 * @returns {Object} The order.
 */
const toCustomerOrder = (order) => ({
  id: order.id,
  canPay: order.status === OrderStatuses.PENDING_PAYMENT && order.reservationStatus === ReservationStatuses.HELD,
  canCancel: isCustomerCancellable(order),
  canChangeAddress: ADDRESS_CHANGEABLE_STATUSES.includes(order.status),
  orderNumber: order.orderNumber,
  type: order.type,
  status: order.status,
  items: order.items,
  subtotal: order.subtotal,
  shippingFee: order.shippingFee,
  total: order.total,
  currency: order.currency,
  shippingAddress: order.shippingAddress,
  expiresAt: order.expiresAt,
  paidAt: order.paidAt,
  shippedAt: order.shippedAt,
  deliveredAt: order.deliveredAt,
  cancelledAt: order.cancelledAt,
  cancellation: order.cancellation?.by ? order.cancellation : undefined,
  createdAt: order.createdAt,
});

/**
 * A compact view of an order for lists.
 * @param {import("mongoose").Document} order - The order.
 * @returns {Object} The summary.
 */
export const toOrderSummary = (order) => ({
  orderNumber: order.orderNumber,
  type: order.type,
  status: order.status,
  total: order.total,
  currency: order.currency,
  itemCount: order.items.reduce((count, item) => count + item.quantity, 0),
  previewItem: { name: order.items[0].name, image: order.items[0].image },
  expiresAt: order.expiresAt,
  createdAt: order.createdAt,
});

/**
 * Releases a held order (status change + returned stock) in one transaction.
 * @param {Object} options
 * @param {Object} options.filter - Identifies the order.
 * @param {string[]} options.fromStatuses - Statuses it may currently be in.
 * @param {Object} options.set - New status and timestamps.
 * @returns {Promise<import("mongoose").Document | null>} The released order, or null if it didn't qualify.
 */
export const releaseOrder = async ({ filter, fromStatuses, set }) => {
  return runInTransaction(async (session) => {
    const order = await releaseHeldOrder({ filter, fromStatuses, set, session });

    if (order) {
      await releaseOrderHold({ order, session });
      // A payment attempt that still completes later is refunded (see payment.handler).
      await expirePendingPaymentsForOrder({ orderId: order.id, session });
    }
    return order;
  });
};

/**
 * Places a normal order: validates the whole cart, then in one transaction reserves
 * every item and creates the order (PENDING_PAYMENT, stock HELD).
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {CartItem[]} options.items - Cart items (unique SKUs).
 * @param {string} [options.shippingAddressId] - Saved address id (or use shippingAddress).
 * @param {Object} [options.shippingAddress] - Inline address.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<{ order: Object, payment: { reference: string, checkoutUrl: string } | null }>}
 *   The new order, and where to pay (null if the provider couldn't be reached — retry later).
 * @throws {AppError} CART_REQUIRES_UPDATE - `details: { items, issues }`; nothing is created.
 * @throws {AppError} ADDRESS_NOT_FOUND
 */
export const placeOrder = async ({ userId, items, shippingAddressId, shippingAddress, context }) => {
  const address = await resolveShippingAddress({ userId, shippingAddressId, shippingAddress });
  const { lines, issues, subtotal } = await validateItems(items);

  if (issues.length) {
    throw await buildCartRequiresUpdateError(items);
  }

  const order = await runInTransaction(async (session) => {
    const failedSku = await reserveItems({ items: lines, pool: ReservationPools.STOCK, session });

    // Stock changed between validation and reservation — abort and report fresh data.
    if (failedSku) {
      throw await buildCartRequiresUpdateError(items, failedSku);
    }

    return createOrderRepo({
      session,
      order: {
        orderNumber: generateOrderNumber(),
        userId,
        type: OrderTypes.NORMAL,
        items: lines.map(({ productId, sku, name, image, unitPrice, quantity, lineTotal }) => ({
          productId, sku, name, image, unitPrice, quantity, lineTotal,
        })),
        ...calculateTotals(subtotal),
        currency: CURRENCY,
        shippingAddress: address,
        reservedFrom: ReservationPools.STOCK,
        expiresAt: new Date(Date.now() + env.orderHoldMs),
      },
    });
  });

  await afterOrderPlaced({ order, userId, context });
  return { order: toCustomerOrder(order), payment: await tryStartPayment(order) };
};

/**
 * Error for a pre-order that can't be placed.
 * @param {string} reason - One of ItemIssueReasons.
 * @param {number} [availableQuantity] - Spots left, when relevant.
 * @returns {AppError} PREORDER_UNAVAILABLE error.
 */
const preorderUnavailableError = (reason, availableQuantity) => {
  const messages = {
    [ItemIssueReasons.NOT_FOUND]: "This product isn't available.",
    [ItemIssueReasons.NOT_AVAILABLE]: "This product isn't available.",
    [ItemIssueReasons.NOT_PRE_ORDER]: "This product isn't taking pre-orders right now.",
    [ItemIssueReasons.INVALID_QUANTITY]: `You can pre-order between 1 and ${MAX_QUANTITY_PER_ITEM}.`,
    [ItemIssueReasons.INSUFFICIENT_QUANTITY]: `Only ${availableQuantity} pre-order spot(s) left.`,
  };
  return new AppError(messages[reason], {
    code: ErrorCodes.PREORDER_UNAVAILABLE,
    details: { reason, ...(availableQuantity !== undefined && { availableQuantity }) },
  });
};

/**
 * Places a single-item pre-order: claims pre-order spots and creates the order at the
 * pre-order price, in one transaction.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} options.sku - The product's SKU.
 * @param {number} options.quantity - Spots to claim.
 * @param {string} [options.shippingAddressId] - Saved address id (or use shippingAddress).
 * @param {Object} [options.shippingAddress] - Inline address.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<{ order: Object, payment: { reference: string, checkoutUrl: string } | null }>}
 *   The new order, and where to pay (null if the provider couldn't be reached — retry later).
 * @throws {AppError} PREORDER_UNAVAILABLE - `details.reason` says why. | ADDRESS_NOT_FOUND
 */
export const placePreorder = async ({ userId, sku, quantity, shippingAddressId, shippingAddress, context }) => {
  const address = await resolveShippingAddress({ userId, shippingAddressId, shippingAddress });
  const product = await findBySku(sku);

  if (!product) throw preorderUnavailableError(ItemIssueReasons.NOT_FOUND);
  if (product.publicityStatus !== PublicityStatuses.PUBLIC) throw preorderUnavailableError(ItemIssueReasons.NOT_AVAILABLE);
  if (product.availabilityStatus !== AvailabilityStatuses.PRE_ORDER) {
    throw preorderUnavailableError(ItemIssueReasons.NOT_PRE_ORDER);
  }
  if (quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) throw preorderUnavailableError(ItemIssueReasons.INVALID_QUANTITY);

  const unitPrice = product.pricing.preorderPrice;
  const item = {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    image: product.images[0]?.url ?? null,
    unitPrice,
    quantity,
    lineTotal: unitPrice * quantity,
  };

  const order = await runInTransaction(async (session) => {
    const failedSku = await reserveItems({ items: [item], pool: ReservationPools.PREORDER, session });

    if (failedSku) {
      const current = await findBySku(sku);
      throw preorderUnavailableError(
        ItemIssueReasons.INSUFFICIENT_QUANTITY,
        Math.max(0, current?.availablePreorderSpots ?? 0),
      );
    }

    return createOrderRepo({
      session,
      order: {
        orderNumber: generateOrderNumber(),
        userId,
        type: OrderTypes.PREORDER,
        items: [item],
        ...calculateTotals(item.lineTotal),
        currency: CURRENCY,
        shippingAddress: address,
        reservedFrom: ReservationPools.PREORDER,
        expiresAt: new Date(Date.now() + env.orderHoldMs),
      },
    });
  });

  await afterOrderPlaced({ order, userId, context });
  return { order: toCustomerOrder(order), payment: await tryStartPayment(order) };
};

/**
 * Lists the customer's orders, newest first.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ orders: Object[], pagination: Object }>} A page of order summaries.
 */
export const listMyOrders = async ({ userId, page, limit }) => {
  const { orders, total } = await findPageForUser({ userId, skip: toSkip({ page, limit }), limit });
  return { orders: orders.map(toOrderSummary), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets one of the customer's orders.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} options.orderNumber - The order number.
 * @returns {Promise<Object>} The customer view of the order.
 * @throws {AppError} ORDER_NOT_FOUND
 */
export const getMyOrder = async ({ userId, orderNumber }) => {
  const order = await findByNumberForUser({ orderNumber, userId });

  if (!order) {
    throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
  }
  return toCustomerOrder(order);
};

/**
 * Cancels one of the customer's orders and returns its stock: any time while unpaid, or within
 * 24h of payment if not shipped (plan.md §5). A paid order is refunded by the refunds worker.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} options.orderNumber - The order number.
 * @param {string} [options.reason] - Optional reason from the customer.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The customer view of the cancelled order.
 * @throws {AppError} ORDER_NOT_FOUND | ORDER_NOT_CANCELLABLE
 */
export const cancelMyOrder = async ({ userId, orderNumber, reason, context }) => {
  const order = await releaseOrder({
    filter: {
      orderNumber,
      userId,
      $or: [
        { status: OrderStatuses.PENDING_PAYMENT },
        { status: OrderStatuses.PAID, paidAt: { $gte: new Date(Date.now() - CUSTOMER_CANCEL_WINDOW_MS) } },
      ],
    },
    fromStatuses: [OrderStatuses.PENDING_PAYMENT, OrderStatuses.PAID],
    set: {
      status: OrderStatuses.CANCELLED,
      cancelledAt: new Date(),
      cancellation: { by: CancelledBy.CUSTOMER, reason },
    },
  });

  if (!order) {
    // Didn't qualify — re-read to say why.
    const existing = await findByNumberForUser({ orderNumber, userId });

    if (!existing) {
      throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
    }
    throw new AppError("This order can no longer be cancelled.", {
      code: ErrorCodes.ORDER_NOT_CANCELLABLE,
      details: { status: existing.status },
    });
  }

  await cancelExpiryJob(order.id);

  if (order.paidAt) {
    await queueRefundsForOrder(order.id);
  }

  await queueOrderEmail({ template: EmailTemplates.ORDER_CANCELLED, order, reason });
  await writeUserLog({ userId, action: UserLogActions.ORDER_CANCELLED, context, meta: { orderNumber, reason } });
  return toCustomerOrder(order);
};

/**
 * Changes where one of the customer's orders ships, from a saved address or a one-off address
 * (the one-off address is never saved to the address book). Allowed until the order ships; the
 * status is checked in the same update, so an order shipped at that moment can't be changed.
 * @param {Object} options
 * @param {string} options.userId - The customer's id.
 * @param {string} options.orderNumber - The order number.
 * @param {string} [options.shippingAddressId] - Saved address id (or use shippingAddress).
 * @param {Object} [options.shippingAddress] - One-off address.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The customer view of the updated order.
 * @throws {AppError} ADDRESS_NOT_FOUND | ORDER_NOT_FOUND | ORDER_ADDRESS_LOCKED
 */
export const changeMyOrderShippingAddress = async ({
  userId,
  orderNumber,
  shippingAddressId,
  shippingAddress,
  context,
}) => {
  const address = await resolveShippingAddress({ userId, shippingAddressId, shippingAddress });
  const order = await updateShippingAddressForUser({
    orderNumber,
    userId,
    statuses: ADDRESS_CHANGEABLE_STATUSES,
    shippingAddress: address,
  });

  if (!order) {
    // Didn't qualify — re-read to say why.
    const existing = await findByNumberForUser({ orderNumber, userId });

    if (!existing) {
      throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
    }
    throw new AppError("This order's address can no longer be changed.", {
      code: ErrorCodes.ORDER_ADDRESS_LOCKED,
      details: { status: existing.status },
    });
  }

  await writeUserLog({
    userId,
    action: UserLogActions.ORDER_ADDRESS_CHANGED,
    context,
    meta: { orderNumber, source: shippingAddressId ? "saved" : "one-off" },
  });
  return toCustomerOrder(order);
};

/**
 * Expires an unpaid order and returns its stock. Called by the order-expiry worker once the
 * job's delay (the hold time) has passed; a no-op if the order was paid or cancelled meanwhile,
 * so it's safe to retry. Timing is the job's delay — deliberately no `expiresAt` check here, as a
 * job firing a moment early (clock skew) would otherwise complete without expiring anything.
 * @param {string} orderId - The order's id.
 * @returns {Promise<boolean>} Whether the order was expired.
 */
export const expireOrder = async (orderId) => {
  const order = await releaseOrder({
    filter: { _id: orderId },
    fromStatuses: [OrderStatuses.PENDING_PAYMENT],
    set: { status: OrderStatuses.EXPIRED },
  });

  if (order) {
    await writeSystemLog({
      level: LogLevels.INFO,
      event: SystemLogEvents.ORDER_EXPIRED,
      entityType: "Order",
      entityId: orderId,
      message: `Order ${order.orderNumber} expired unpaid; stock released.`,
    });
    await queueOrderEmail({ template: EmailTemplates.ORDER_EXPIRED, order });
  }
  return Boolean(order);
};
