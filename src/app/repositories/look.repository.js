import mongoose from "mongoose";

import { PublicityStatuses } from "#constants/product.constants.js";
import { Look } from "#models/look.model.js";
import { Product } from "#models/product.model.js";

/**
 * Newest first.
 * @type {Record<string, 1 | -1>}
 */
const newestFirst = { createdAt: -1 };

/**
 * @typedef {{ sku: string, name: string, slug: string, publicityStatus: string, imageUrl: string | null }} LookProductRow
 * @typedef {Object} LookWithProducts - A plain look (aggregation result, so `_id` not `id`) with its products.
 * @property {LookProductRow[]} products - Its products, in the look's order.
 */

/**
 * Inserts a new look.
 * @param {Object} look - Validated look fields.
 * @returns {Promise<import("mongoose").Document>} The created look.
 */
export const create = async (look) => Look.create(look);

/**
 * Finds a look by id.
 * @param {string} lookId - The look's id.
 * @returns {Promise<import("mongoose").Document | null>} The look, or null.
 */
export const findById = async (lookId) => Look.findById(lookId);

/**
 * Loads one look together with its products in a single aggregation: the look is matched, then
 * its SKUs are looked up in the products collection (kept in the look's order) and each product
 * is trimmed to its SKU, name, slug, publicity and first image URL.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter for the look (aggregation doesn't cast, so ids must be ObjectIds).
 * @param {string} [options.productPublicityStatus] - Only include products with this publicity; omit for all.
 * @returns {Promise<LookWithProducts | null>} The look with its products, or null.
 */
const findOneWithProducts = async ({ filter, productPublicityStatus }) => {
  const [look] = await Look.aggregate([
    { $match: filter },
    { $limit: 1 },
    {
      $lookup: {
        from: Product.collection.name,
        let: { skus: "$productSkus" },
        pipeline: [
          {
            $match: {
              $expr: { $in: ["$sku", "$$skus"] },
              ...(productPublicityStatus && { publicityStatus: productPublicityStatus }),
            },
          },
          { $addFields: { position: { $indexOfArray: ["$$skus", "$sku"] } } },
          { $sort: { position: 1 } },
          {
            $project: {
              _id: 0,
              sku: 1,
              name: 1,
              slug: 1,
              publicityStatus: 1,
              imageUrl: { $ifNull: [{ $first: "$images.url" }, null] },
            },
          },
        ],
        as: "products",
      },
    },
  ]);
  return look ?? null;
};

/**
 * Loads a public look by slug with its public products.
 * @param {string} slug - The look's slug.
 * @returns {Promise<LookWithProducts | null>} The look with its products, or null if missing or hidden.
 */
export const findPublicBySlugWithProducts = async (slug) => {
  return findOneWithProducts({
    filter: { slug, publicityStatus: PublicityStatuses.PUBLIC },
    productPublicityStatus: PublicityStatuses.PUBLIC,
  });
};

/**
 * Loads any look by slug with all of its products (the admin view).
 * @param {string} slug - The look's slug.
 * @returns {Promise<LookWithProducts | null>} The look with its products, or null.
 */
export const findBySlugWithProducts = async (slug) => findOneWithProducts({ filter: { slug } });

/**
 * Loads any look by id with all of its products (the admin view).
 * @param {string} lookId - The look's id.
 * @returns {Promise<LookWithProducts | null>} The look with its products, or null.
 */
export const findByIdWithProducts = async (lookId) => {
  return findOneWithProducts({ filter: { _id: new mongoose.Types.ObjectId(lookId) } });
};

/**
 * Returns one page of looks matching a filter, plus the total match count.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ looks: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [looks, total] = await Promise.all([
    Look.find(filter).sort(newestFirst).skip(skip).limit(limit),
    Look.countDocuments(filter),
  ]);
  return { looks, total };
};

/**
 * Sets fields on a look.
 * @param {Object} options
 * @param {string} options.lookId - The look's id.
 * @param {Object} options.set - Fields to `$set`.
 * @returns {Promise<import("mongoose").Document | null>} The updated look, or null if not found.
 */
export const updateById = async ({ lookId, set }) => {
  return Look.findByIdAndUpdate(lookId, { $set: set }, { returnDocument: "after", runValidators: true });
};

/**
 * Sets a look's image.
 * @param {Object} options
 * @param {string} options.lookId - The look's id.
 * @param {{ url: string, publicId: string }} options.image - The new hosted image.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The look as it was before (to clean up its old
 *   image), or null if not found.
 */
export const replaceImage = async ({ lookId, image, session }) => {
  return Look.findByIdAndUpdate(lookId, { $set: { image } }, { returnDocument: "before", session });
};

/**
 * Hides every public look that contains a product.
 * @param {Object} options
 * @param {string} options.sku - The product's SKU.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<{ id: string, name: string }[]>} The looks that were hidden.
 */
export const hideLooksWithSku = async ({ sku, session }) => {
  const filter = { productSkus: sku, publicityStatus: PublicityStatuses.PUBLIC };
  const looks = await Look.find(filter, { name: 1 }, { session });

  if (!looks.length) {
    return [];
  }

  await Look.updateMany(
    { _id: { $in: looks.map((look) => look._id) } },
    { $set: { publicityStatus: PublicityStatuses.HIDDEN } },
    { session },
  );
  return looks.map((look) => ({ id: look.id, name: look.name }));
};
