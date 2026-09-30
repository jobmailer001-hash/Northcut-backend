import { z } from "zod";

import { MAX_CART_ITEMS, MAX_QUANTITY_PER_ITEM } from "#constants/order.constants.js";

import { objectIdField, paginationQueryShape } from "./common.validator.js";
import { addressBodySchema } from "./me.validator.js";

const skuField = z.string().trim().toUpperCase().min(1).max(32);

/**
 * One cart line. Quantity is only checked for being a whole number here: out-of-range
 * quantities come back as an INVALID_QUANTITY item issue, so the cart can show them.
 * @type {import("zod").ZodObject}
 */
const cartItemSchema = z.object({
  sku: skuField,
  quantity: z.number().int(),
});

/**
 * Cart items: unique SKUs (the client merges duplicates), at most MAX_CART_ITEMS lines.
 * @param {number} minItems - 0 for previews, 1 for orders.
 * @returns {import("zod").ZodArray} The items schema.
 */
const cartItemsField = (minItems) =>
  z
    .array(cartItemSchema)
    .min(minItems, "Your cart is empty.")
    .max(MAX_CART_ITEMS, `At most ${MAX_CART_ITEMS} different items per order.`)
    .refine((items) => new Set(items.map((item) => item.sku)).size === items.length, "Each SKU may appear only once.");

/**
 * Where to ship: a saved address id, or a one-off address for this order only. A one-off
 * address is never saved to the address book, so it has no label or default flag.
 * @type {import("zod").ZodRawShape}
 */
const shippingShape = {
  shippingAddressId: objectIdField.optional(),
  shippingAddress: addressBodySchema.omit({ isDefault: true, label: true }).optional(),
};

/**
 * Refinement requiring exactly one of shippingAddressId / shippingAddress.
 * @param {{ shippingAddressId?: string, shippingAddress?: Object }} body - The request body.
 * @returns {boolean} Whether exactly one was given.
 */
const hasExactlyOneShippingTarget = (body) => Boolean(body.shippingAddressId) !== Boolean(body.shippingAddress);

const shippingTargetError = {
  message: "Choose a saved address or enter a new one.",
  path: ["shippingAddressId"],
};

/**
 * POST /cart/preview body.
 * @type {import("zod").ZodObject}
 */
export const previewCartBodySchema = z.object({ items: cartItemsField(0) });

/**
 * POST /orders body.
 * @type {import("zod").ZodObject}
 */
export const placeOrderBodySchema = z
  .object({ items: cartItemsField(1), ...shippingShape })
  .refine(hasExactlyOneShippingTarget, shippingTargetError);

/**
 * POST /orders/preorder body.
 * @type {import("zod").ZodObject}
 */
export const placePreorderBodySchema = z
  .object({
    sku: skuField,
    quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_ITEM),
    ...shippingShape,
  })
  .refine(hasExactlyOneShippingTarget, shippingTargetError);

/**
 * PATCH /orders/:orderNumber/shipping-address body.
 * @type {import("zod").ZodObject}
 */
export const changeShippingAddressBodySchema = z
  .object(shippingShape)
  .refine(hasExactlyOneShippingTarget, shippingTargetError);

/**
 * `:orderNumber` route param.
 * @type {import("zod").ZodObject}
 */
export const orderNumberParamsSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^NC-\d{6}-[A-Z0-9]{6}$/, "Invalid order number."),
});

/**
 * POST /orders/:orderNumber/cancel body.
 * @type {import("zod").ZodObject}
 */
export const cancelOrderBodySchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/**
 * GET /orders query.
 * @type {import("zod").ZodObject}
 */
export const listMyOrdersQuerySchema = z.object(paginationQueryShape(10));
