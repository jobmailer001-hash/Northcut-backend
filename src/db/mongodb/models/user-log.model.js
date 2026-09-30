import mongoose from "mongoose";

import { UserLogActions } from "#constants/log.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * Audit entry for something a user did (login, logout, password reset, ...).
 * @type {import("mongoose").Schema}
 */
const userLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: Object.values(UserLogActions), required: true },
    ip: { type: String },
    userAgent: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: jsonOptions },
);

/**
 * UserLog model.
 * @type {import("mongoose").Model}
 */
export const UserLog = mongoose.model("UserLog", userLogSchema);
