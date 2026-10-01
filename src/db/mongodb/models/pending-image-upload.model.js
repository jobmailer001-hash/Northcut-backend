import mongoose from "mongoose";

import { PENDING_IMAGE_UPLOAD_TTL_SECONDS } from "#constants/product.constants.js";
import { HeroPanels } from "#constants/site-settings.constants.js";

/**
 * One staged image's bytes.
 * @type {import("mongoose").Schema}
 */
const stagedImageSchema = new mongoose.Schema({ data: { type: Buffer, required: true } }, { _id: false });

/**
 * Whether this staged upload is for a product (it has no hero panel or look).
 * Mongoose binds the document to `this`, so this must be a regular function, not an arrow.
 * @returns {boolean} True when `productId` is required.
 */
function isProductUpload() {
  return !this.heroPanel && !this.lookId;
}

/**
 * Images accepted by the API and waiting for the worker to upload them to Cloudinary — product
 * images (`productId`), one landing-page hero panel's image (`heroPanel`), or one look's image
 * (`lookId`); exactly one of these.
 * MongoDB is the hand-off because the API and worker may run on separate machines (no shared
 * disk), and file bytes don't belong in Redis. The document is deleted once its images are
 * attached; the TTL index removes any left behind by a job that failed for good.
 * @type {import("mongoose").Schema}
 */
const pendingImageUploadSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: isProductUpload, index: true },
  heroPanel: { type: String, enum: Object.values(HeroPanels) },
  lookId: { type: mongoose.Schema.Types.ObjectId, ref: "Look" },
  images: { type: [stagedImageSchema], required: true },
  createdAt: { type: Date, default: Date.now, expires: PENDING_IMAGE_UPLOAD_TTL_SECONDS },
});

pendingImageUploadSchema.pre("validate", function rejectSeveralTargets() {
  const targetCount = [this.productId, this.heroPanel, this.lookId].filter(Boolean).length;

  if (targetCount > 1) {
    this.invalidate("heroPanel", "A staged upload is for one product, hero panel or look — not several.");
  }
});

/**
 * PendingImageUpload model.
 * @type {import("mongoose").Model}
 */
export const PendingImageUpload = mongoose.model("PendingImageUpload", pendingImageUploadSchema);
