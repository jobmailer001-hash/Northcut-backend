import mongoose from "mongoose";

import {
  CancelledBy,
  CURRENCY,
  OrderStatuses,
  OrderTypes,
  ReservationPools,
  ReservationStatuses,
} from "#constants/order.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * Money in integer minor units (kobo).
 * @type {import("mongoose").SchemaDefinitionProperty}
 */
const moneyField = { type: Number, required: true, min: 0, validate: Number.isInteger };

/**
 * One order line — a snapshot of the product at the time of ordering.
 * @type {import("mongoose").Schema}
 */
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    image: { type: String, default: null },
    unitPrice: moneyField,
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    lineTotal: moneyField,
  },
  { _id: false },
);

/**
 * Shipping address snapshot — later edits to the address book don't change past orders.
 * @type {import("mongoose").Schema}
 */
const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    postalCode: String,
  },
  { _id: false },
);

/**
 * A customer order. `reservationStatus` flips HELD → RELEASED | FULFILLED exactly once
 * (always with a conditional update), which is what makes release/fulfil idempotent.
 * @type {import("mongoose").Schema}
 */
const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: Object.values(OrderTypes), required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: moneyField,
    shippingFee: moneyField,
    total: moneyField,
    currency: { type: String, default: CURRENCY },
    shippingAddress: { type: shippingAddressSchema, required: true },
    status: { type: String, enum: Object.values(OrderStatuses), default: OrderStatuses.PENDING_PAYMENT },
    reservationStatus: {
      type: String,
      enum: Object.values(ReservationStatuses),
      default: ReservationStatuses.HELD,
    },
    reservedFrom: { type: String, enum: Object.values(ReservationPools), required: true },
    expiresAt: { type: Date, required: true },
    paidAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    cancellation: {
      by: { type: String, enum: Object.values(CancelledBy) },
      reason: String,
    },
  },
  { timestamps: true, toJSON: jsonOptions },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ "items.productId": 1, reservationStatus: 1 });

/**
 * Order model.
 * @type {import("mongoose").Model}
 */
export const Order = mongoose.model("Order", orderSchema);
