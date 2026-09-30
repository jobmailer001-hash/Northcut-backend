import mongoose from "mongoose";

import { LogLevels, SystemLogEvents } from "#constants/log.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * Audit entry for something the system did on its own (expiry, payments, refunds).
 * @type {import("mongoose").Schema}
 */
const systemLogSchema = new mongoose.Schema(
  {
    level: { type: String, enum: Object.values(LogLevels), required: true },
    event: { type: String, enum: Object.values(SystemLogEvents), required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: jsonOptions },
);

systemLogSchema.index({ createdAt: -1 });
systemLogSchema.index({ entityType: 1, entityId: 1 });

/**
 * SystemLog model.
 * @type {import("mongoose").Model}
 */
export const SystemLog = mongoose.model("SystemLog", systemLogSchema);
