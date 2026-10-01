import mongoose from "mongoose";

import { PublicityStatuses } from "#constants/product.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * The look's one hosted image — uploaded by an admin, e.g. the whole outfit worn together.
 * @type {import("mongoose").Schema}
 */
const lookImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false, id: false },
);

/**
 * A look: a suggested outfit made from catalog products, for customers unsure what to wear
 * together. Products are referenced by SKU (immutable), in display order. Each product is
 * still bought on its own page.
 * @type {import("mongoose").Schema}
 */
const lookSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "", trim: true },
    productSkus: { type: [{ type: String, uppercase: true, trim: true }], default: [] },
    image: { type: lookImageSchema, default: null },
    publicityStatus: {
      type: String,
      enum: Object.values(PublicityStatuses),
      default: PublicityStatuses.HIDDEN,
    },
  },
  { timestamps: true, toJSON: jsonOptions },
);

lookSchema.index({ publicityStatus: 1, createdAt: -1 });
lookSchema.index({ productSkus: 1 });

/**
 * Look model.
 * @type {import("mongoose").Model}
 */
export const Look = mongoose.model("Look", lookSchema);
