/**
 * Order kinds: a normal in-stock purchase or a pre-order.
 * @type {Readonly<Record<string, string>>}
 */
export const OrderTypes = {
  NORMAL: "NORMAL",
  PREORDER: "PREORDER",
};

/**
 * Order lifecycle statuses.
 * @type {Readonly<Record<string, string>>}
 */
export const OrderStatuses = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};

/**
 * State of an order's inventory hold; flipped conditionally so release/fulfil run once.
 * @type {Readonly<Record<string, string>>}
 */
export const ReservationStatuses = {
  HELD: "HELD",
  RELEASED: "RELEASED",
  FULFILLED: "FULFILLED",
};

/**
 * Which product counter an order's hold is on: `reserved` (STOCK) or `preorderReserved` (PREORDER).
 * Pre-orders move from PREORDER to STOCK when their product switches to IN_STOCK.
 * @type {Readonly<Record<string, string>>}
 */
export const ReservationPools = {
  STOCK: "STOCK",
  PREORDER: "PREORDER",
};

/**
 * Currency every amount is in (minor units: kobo).
 * @type {string}
 */
export const CURRENCY = "NGN";

/**
 * Most distinct products in one cart / order.
 * @type {number}
 */
export const MAX_CART_ITEMS = 50;

/**
 * Most units of one product per order line.
 * @type {number}
 */
export const MAX_QUANTITY_PER_ITEM = 20;

/**
 * How long after payment a customer may still cancel (if not yet shipped).
 * @type {number}
 */
export const CUSTOMER_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Who cancelled an order.
 * @type {Readonly<Record<string, string>>}
 */
export const CancelledBy = {
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
};

/**
 * Per-item reasons returned by cart validation.
 * @type {Readonly<Record<string, string>>}
 */
export const ItemIssueReasons = {
  NOT_FOUND: "NOT_FOUND",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  PRE_ORDER_ONLY: "PRE_ORDER_ONLY",
  INSUFFICIENT_QUANTITY: "INSUFFICIENT_QUANTITY",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  // Pre-order checkout only: the product isn't taking pre-orders.
  NOT_PRE_ORDER: "NOT_PRE_ORDER",
};
