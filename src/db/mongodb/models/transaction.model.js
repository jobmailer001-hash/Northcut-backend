import mongoose from "mongoose";

import { CURRENCY } from "#constants/order.constants.js";
import { TransactionStatuses, TransactionTypes } from "#constants/transaction.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * One money movement with the payment provider — a payment attempt or a refund.
 * The Order says whether it's paid; Transactions record every attempt and refund
 * (retries, late payments on dead orders, reconciliation).
 * @type {import("mongoose").Schema}
 */
const transactionSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: Object.values(TransactionTypes), required: true },
    provider: { type: String, required: true },
    // Our reference, sent to the provider; unique so each provider event is processed once.
    providerReference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, default: CURRENCY },
    status: { type: String, enum: Object.values(TransactionStatuses), default: TransactionStatuses.PENDING },
    // REFUND only: the PAYMENT it reverses. Unique so a payment can only ever be refunded once.
    refundOf: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", unique: true, sparse: true },
    // What the provider reported when verified — kept for disputes and reconciliation.
    providerPayload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/**
 * Transaction model.
 * @type {import("mongoose").Model}
 */
export const Transaction = mongoose.model("Transaction", transactionSchema);
