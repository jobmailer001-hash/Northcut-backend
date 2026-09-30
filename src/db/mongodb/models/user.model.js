import mongoose from "mongoose";

import { Roles, UserStatuses } from "#constants/user.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * Saved shipping address, embedded in the user document.
 * @type {import("mongoose").Schema}
 */
const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { toJSON: jsonOptions },
);

/**
 * Removes passwordHash as well as the shared cleanup, so it can never reach a response.
 * @param {import("mongoose").Document} doc - The source document.
 * @param {Record<string, unknown>} ret - The plain object being returned.
 * @returns {Record<string, unknown>} The cleaned plain object.
 */
const removePrivateFields = (doc, ret) => {
  delete ret.passwordHash;
  return jsonOptions.transform(doc, ret);
};

/**
 * Customer or admin account.
 * @type {import("mongoose").Schema}
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Excluded from queries by default; select("+passwordHash") where it's needed.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(Roles), default: Roles.CUSTOMER },
    status: { type: String, enum: Object.values(UserStatuses), default: UserStatuses.ACTIVE },
    addresses: { type: [addressSchema], default: [] },
    favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true, toJSON: { ...jsonOptions, transform: removePrivateFields } },
);

/**
 * User model.
 * @type {import("mongoose").Model}
 */
export const User = mongoose.model("User", userSchema);
