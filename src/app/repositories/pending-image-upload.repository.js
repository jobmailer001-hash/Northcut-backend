import mongoose from "mongoose";

import { PendingImageUpload } from "#models/pending-image-upload.model.js";

/**
 * Stages image bytes for the worker.
 * @param {Object} options
 * @param {string} options.productId - The product the images belong to.
 * @param {Buffer[]} options.buffers - The images' bytes.
 * @returns {Promise<import("mongoose").Document>} The staged upload.
 */
export const create = async ({ productId, buffers }) => {
  return PendingImageUpload.create({ productId, images: buffers.map((data) => ({ data })) });
};

/**
 * Stages one hero panel's image bytes for the worker.
 * @param {Object} options
 * @param {string} options.heroPanel - One of HeroPanels.
 * @param {Buffer} options.buffer - The image's bytes.
 * @returns {Promise<import("mongoose").Document>} The staged upload.
 */
export const createForHeroPanel = async ({ heroPanel, buffer }) => {
  return PendingImageUpload.create({ heroPanel, images: [{ data: buffer }] });
};

/**
 * Finds a staged upload (hydrated, so each `images[].data` is a Buffer).
 * @param {string} uploadId - The staged upload's id.
 * @returns {Promise<import("mongoose").Document | null>} The staged upload, or null if gone.
 */
export const findById = async (uploadId) => PendingImageUpload.findById(uploadId);

/**
 * Deletes a staged upload.
 * @param {Object} options
 * @param {string} options.uploadId - The staged upload's id.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<void>}
 */
export const deleteById = async ({ uploadId, session }) => {
  await PendingImageUpload.deleteOne({ _id: uploadId }, { session });
};

/**
 * Counts images still waiting to be uploaded for a product; they count toward its image limit.
 * @param {string} productId - The product's id.
 * @returns {Promise<number>} Staged image count.
 */
export const countImagesForProduct = async (productId) => {
  const [result] = await PendingImageUpload.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: null, imageCount: { $sum: { $size: "$images" } } } },
  ]);
  return result?.imageCount ?? 0;
};
