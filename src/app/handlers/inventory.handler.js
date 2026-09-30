import { LogLevels, SystemLogEvents } from "#constants/log.constants.js";
import { ReservationPools } from "#constants/order.constants.js";
import {
  fulfilUnits,
  releaseUnits,
  reservePreorderSpots,
  reserveStock,
} from "#repositories/product.repository.js";
import { writeSystemLog } from "#utils/log.util.js";

// Internal only — no routes. Every function here runs inside a caller's transaction.

/**
 * Product counter each reservation pool holds units on.
 * @type {Record<string, "reserved" | "preorderReserved">}
 */
const counterByPool = {
  [ReservationPools.STOCK]: "reserved",
  [ReservationPools.PREORDER]: "preorderReserved",
};

/**
 * Reserves every item, in order, with conditional updates. Stops at the first item that
 * can't be reserved and reports it; the caller must then abort the transaction.
 * @param {Object} options
 * @param {{ productId: string, sku: string, quantity: number }[]} options.items - Items to reserve.
 * @param {string} options.pool - One of ReservationPools.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<string | null>} The SKU that couldn't be reserved, or null if all were.
 */
export const reserveItems = async ({ items, pool, session }) => {
  const reserve = pool === ReservationPools.STOCK ? reserveStock : reservePreorderSpots;

  // Sequential on purpose: a transaction session can't run operations in parallel.
  for (const item of items) {
    const product = await reserve({ productId: item.productId, quantity: item.quantity, session });

    if (!product) {
      return item.sku;
    }
  }
  return null;
};

/**
 * Returns an order's held units to the pool it holds them on. The caller must already have
 * flipped the order HELD → RELEASED in the same transaction, which guarantees this runs once.
 * @param {Object} options
 * @param {import("mongoose").Document} options.order - The order being released.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<void>}
 */
export const releaseOrderHold = async ({ order, session }) => {
  const counter = counterByPool[order.reservedFrom];

  for (const item of order.items) {
    const product = await releaseUnits({ productId: item.productId, counter, quantity: item.quantity, session });

    if (!product) {
      // Counters drifted (should never happen). Don't throw — that would roll back the release
      // and leave the order holding stock forever — but make it loud for investigation.
      await writeSystemLog({
        level: LogLevels.ERROR,
        event: SystemLogEvents.INVENTORY_COUNTER_DRIFT,
        entityType: "Product",
        entityId: item.productId,
        message: `${counter} was lower than order ${order.orderNumber}'s hold while releasing it.`,
        meta: { orderId: order.id, counter, quantity: item.quantity },
      });
    }
  }
};

/**
 * Takes a shipped order's units out of physical stock and reservations (`stock -= qty`,
 * `reserved -= qty`). The caller must already have flipped the order HELD → FULFILLED in the
 * same transaction, which guarantees this runs once.
 * @param {Object} options
 * @param {import("mongoose").Document} options.order - The order being shipped (hold on STOCK).
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<void>}
 * @throws {Error} If a product's counters are lower than the order's hold. Unlike a release,
 *   shipping must not go ahead on drifted counters — this aborts the transaction for investigation.
 */
export const fulfilOrderHold = async ({ order, session }) => {
  for (const item of order.items) {
    const product = await fulfilUnits({ productId: item.productId, quantity: item.quantity, session });

    if (!product) {
      throw new Error(`Stock/reserved too low to ship ${item.quantity} × ${item.sku} for order ${order.orderNumber}`);
    }
  }
};
