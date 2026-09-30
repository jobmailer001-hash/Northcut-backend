import { env } from "#configs/env.config.js";
import { ItemIssueReasons, MAX_QUANTITY_PER_ITEM } from "#constants/order.constants.js";
import { AvailabilityStatuses, PublicityStatuses } from "#constants/product.constants.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { findBySkus } from "#repositories/product.repository.js";

/**
 * @typedef {{ sku: string, quantity: number }} CartItem
 * @typedef {{ sku: string, reason: string, availableQuantity?: number, maxQuantity?: number }} ItemIssue
 * @typedef {{
 *   sku: string, quantity: number, productId: string | null, name: string | null, slug: string | null,
 *   image: string | null, unitPrice: number | null, lineTotal: number | null,
 *   availabilityStatus: string | null, availableQuantity: number, issue: string | null
 * }} CartLine
 */

/**
 * Works out what, if anything, stops this quantity of this product being bought now.
 * @param {import("mongoose").Document | undefined} product - The product, if it exists.
 * @param {number} quantity - Requested units.
 * @returns {Omit<ItemIssue, "sku"> | null} The issue, or null if the line is fine.
 */
const getItemIssue = (product, quantity) => {
  if (!product) {
    return { reason: ItemIssueReasons.NOT_FOUND };
  }
  if (product.publicityStatus !== PublicityStatuses.PUBLIC) {
    return { reason: ItemIssueReasons.NOT_AVAILABLE };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) {
    return { reason: ItemIssueReasons.INVALID_QUANTITY, maxQuantity: MAX_QUANTITY_PER_ITEM };
  }
  if (product.availabilityStatus === AvailabilityStatuses.PRE_ORDER) {
    return { reason: ItemIssueReasons.PRE_ORDER_ONLY };
  }

  const availableQuantity = Math.max(0, product.availableStock);

  if (product.availabilityStatus === AvailabilityStatuses.OUT_OF_STOCK || availableQuantity === 0) {
    return { reason: ItemIssueReasons.OUT_OF_STOCK, availableQuantity: 0 };
  }
  if (availableQuantity < quantity) {
    return { reason: ItemIssueReasons.INSUFFICIENT_QUANTITY, availableQuantity };
  }
  return null;
};

/**
 * Builds the client-facing line for a cart item, from live product data.
 * @param {Object} options
 * @param {CartItem} options.item - The requested item.
 * @param {import("mongoose").Document | undefined} options.product - The product, if it exists.
 * @param {string | null} options.issue - The line's issue reason, if any.
 * @returns {CartLine} The line.
 */
const toCartLine = ({ item, product, issue }) => {
  const isVisible = product?.publicityStatus === PublicityStatuses.PUBLIC;
  const unitPrice = product?.pricing.launchPrice ?? null;
  const hasValidQuantity = issue !== ItemIssueReasons.INVALID_QUANTITY;

  return {
    sku: item.sku,
    quantity: item.quantity,
    productId: product?.id ?? null,
    name: product?.name ?? null,
    slug: isVisible ? product.slug : null,
    image: product?.images[0]?.url ?? null,
    unitPrice,
    lineTotal: unitPrice !== null && hasValidQuantity ? unitPrice * item.quantity : null,
    availabilityStatus: isVisible ? product.availabilityStatus : null,
    availableQuantity: isVisible ? Math.max(0, product.availableStock) : 0,
    issue,
  };
};

/**
 * Checks every cart item against live product data. Never throws for item problems —
 * each problem is reported, so the whole cart can be fixed at once.
 * @param {CartItem[]} items - Requested items (unique SKUs).
 * @returns {Promise<{ lines: CartLine[], issues: ItemIssue[], subtotal: number }>}
 *   One line per item, every issue found, and the subtotal of the issue-free lines.
 */
export const validateItems = async (items) => {
  const products = await findBySkus(items.map((item) => item.sku));
  const productsBySku = new Map(products.map((product) => [product.sku, product]));

  const lines = [];
  const issues = [];

  for (const item of items) {
    const product = productsBySku.get(item.sku);
    const issue = getItemIssue(product, item.quantity);

    lines.push(toCartLine({ item, product, issue: issue?.reason ?? null }));
    if (issue) {
      issues.push({ sku: item.sku, ...issue });
    }
  }

  const subtotal = lines.filter((line) => !line.issue).reduce((sum, line) => sum + line.lineTotal, 0);
  return { lines, issues, subtotal };
};

/**
 * Totals for a subtotal; shipping is only charged when something is being bought.
 * @param {number} subtotal - Sum of line totals, in kobo.
 * @returns {{ subtotal: number, shippingFee: number, total: number }} Totals in kobo.
 */
export const calculateTotals = (subtotal) => {
  const shippingFee = subtotal > 0 ? env.shippingFee : 0;
  return { subtotal, shippingFee, total: subtotal + shippingFee };
};

/**
 * Builds the CART_REQUIRES_UPDATE error, re-checking the cart so it carries fresh data.
 * @param {CartItem[]} items - The requested items.
 * @param {string} [failedSku] - A SKU whose reservation just failed; guaranteed to appear in `issues`
 *   even if a fresh check happens to pass (stock changed again in between).
 * @returns {Promise<AppError>} The error to throw; `details` is `{ items, issues }`.
 */
export const buildCartRequiresUpdateError = async (items, failedSku) => {
  const { lines, issues } = await validateItems(items);

  if (failedSku && !issues.some((issue) => issue.sku === failedSku)) {
    const line = lines.find((cartLine) => cartLine.sku === failedSku);
    issues.push({
      sku: failedSku,
      reason: ItemIssueReasons.INSUFFICIENT_QUANTITY,
      availableQuantity: line?.availableQuantity ?? 0,
    });
  }

  return new AppError("Some items in your cart need attention.", {
    code: ErrorCodes.CART_REQUIRES_UPDATE,
    details: { items: lines, issues },
  });
};

/**
 * Previews a cart with live prices, availability and issues (no login needed, nothing saved).
 * @param {CartItem[]} items - Requested items.
 * @returns {Promise<{ items: CartLine[], issues: ItemIssue[], subtotal: number, shippingFee: number, total: number }>}
 *   The preview.
 */
export const previewCart = async (items) => {
  const { lines, issues, subtotal } = await validateItems(items);
  return { items: lines, issues, ...calculateTotals(subtotal) };
};
