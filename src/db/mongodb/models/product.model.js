import mongoose from "mongoose";

import { AvailabilityStatuses, PublicityStatuses } from "#constants/product.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * Non-negative integer counter (stock, reservations, limits).
 * @type {import("mongoose").SchemaDefinitionProperty}
 */
const counterField = { type: Number, default: 0, min: 0, validate: Number.isInteger };

/**
 * Accepts whole numbers, and null for optional prices (e.g. no pre-order price yet).
 * @param {number | null} value - The amount in kobo.
 * @returns {boolean} Whether it's valid.
 */
const isWholeNumberOrNull = (value) => value === null || Number.isInteger(value);

/**
 * Money in integer minor units (kobo).
 * @type {import("mongoose").SchemaDefinitionProperty}
 */
const moneyField = {
  type: Number,
  min: 0,
  validate: { validator: isWholeNumberOrNull, message: "{PATH} must be a whole number of kobo." },
};

/**
 * Hosted product image.
 * @type {import("mongoose").Schema}
 */
const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { toJSON: jsonOptions },
);

/**
 * A product in the catalog. `stock`/`reserved` and `preorderLimit`/`preorderReserved`
 * are only ever changed with conditional `$inc` updates.
 * @type {import("mongoose").Schema}
 */
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Immutable: carts and order snapshots reference products by SKU.
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, immutable: true },
    description: { type: String, default: "", trim: true },
    tags: { type: [String], default: [] },
    images: { type: [imageSchema], default: [] },
    pricing: {
      launchPrice: { ...moneyField, required: true },
      preorderPrice: { ...moneyField, default: null },
    },
    availabilityStatus: {
      type: String,
      enum: Object.values(AvailabilityStatuses),
      default: AvailabilityStatuses.OUT_OF_STOCK,
    },
    publicityStatus: {
      type: String,
      enum: Object.values(PublicityStatuses),
      default: PublicityStatuses.HIDDEN,
    },
    stock: counterField,
    reserved: counterField,
    preorderLimit: counterField,
    preorderReserved: counterField,
  },
  { timestamps: true, toJSON: jsonOptions },
);

productSchema.index({ publicityStatus: 1, createdAt: -1 });
productSchema.index({ tags: 1 });

// Available quantities are always derived, never stored (plan.md §4).
// Mongoose binds the document to `this`, so these must be regular functions, not arrows.
productSchema.virtual("availableStock").get(function getAvailableStock() {
  return this.stock - this.reserved;
});

productSchema.virtual("availablePreorderSpots").get(function getAvailablePreorderSpots() {
  return this.preorderLimit - this.preorderReserved;
});

/**
 * Product model.
 * @type {import("mongoose").Model}
 */
export const Product = mongoose.model("Product", productSchema);
