import { AvailabilityStatuses, PublicityStatuses } from "#constants/product.constants.js";
import { Product } from "#models/product.model.js";

/**
 * Newest first.
 * @type {Record<string, 1 | -1>}
 */
const newestFirst = { createdAt: -1 };

/**
 * Inserts a new product.
 * @param {Object} product - Validated product fields.
 * @returns {Promise<import("mongoose").Document>} The created product.
 */
export const create = async (product) => Product.create(product);

/**
 * Finds a product by id.
 * @param {string} productId - The product's id.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null.
 */
export const findById = async (productId) => Product.findById(productId);

/**
 * Finds a product by slug, optionally restricted to a publicity status.
 * @param {Object} options
 * @param {string} options.slug - The product's slug.
 * @param {string} [options.publicityStatus] - One of PublicityStatuses; omit to match any.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null.
 */
export const findBySlug = async ({ slug, publicityStatus }) => {
  return Product.findOne({ slug, ...(publicityStatus && { publicityStatus }) });
};

/**
 * Finds a product by SKU.
 * @param {string} sku - The product's SKU (uppercase).
 * @returns {Promise<import("mongoose").Document | null>} The product, or null.
 */
export const findBySku = async (sku) => Product.findOne({ sku });

/**
 * Finds products by SKU.
 * @param {string[]} skus - Product SKUs (uppercase).
 * @returns {Promise<import("mongoose").Document[]>} The matching products (missing SKUs are simply absent).
 */
export const findBySkus = async (skus) => Product.find({ sku: { $in: skus } });

/**
 * Finds products by id, restricted to a publicity status, newest first.
 * @param {Object} options
 * @param {string[]} options.productIds - Product ids.
 * @param {string} options.publicityStatus - One of PublicityStatuses.
 * @returns {Promise<import("mongoose").Document[]>} The matching products.
 */
export const findByIds = async ({ productIds, publicityStatus }) => {
  return Product.find({ _id: { $in: productIds }, publicityStatus }).sort(newestFirst);
};

/**
 * Returns one page of products matching a filter, plus the total match count.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ products: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [products, total] = await Promise.all([
    Product.find(filter).sort(newestFirst).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return { products, total };
};

/**
 * Sets (and optionally increments) fields on a product, only if it also matches `conditions`.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {Object} options.set - Fields to `$set` (dot paths allowed).
 * @param {Object} [options.inc] - Counters to `$inc`.
 * @param {Object} [options.conditions] - Extra filter the product must match (e.g. no pending pre-orders).
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The updated product, or null if nothing matched.
 */
export const updateById = async ({ productId, set, inc, conditions = {}, session }) => {
  return Product.findOneAndUpdate(
    { _id: productId, ...conditions },
    { $set: set, ...(inc && { $inc: inc }) },
    { returnDocument: "after", runValidators: true, session },
  );
};

/**
 * Adds to (or subtracts from) physical stock, only if stock stays at or above `reserved`.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {number} options.adjustment - Signed change to stock.
 * @returns {Promise<import("mongoose").Document | null>} The updated product, or null if it would drop below reserved.
 */
export const adjustStock = async ({ productId, adjustment }) => {
  return Product.findOneAndUpdate(
    { _id: productId, $expr: { $gte: [{ $add: ["$stock", adjustment] }, "$reserved"] } },
    { $inc: { stock: adjustment } },
    { returnDocument: "after" },
  );
};

/**
 * Appends images, only if the product will still have at most `maxImages`.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {{ url: string, publicId: string }[]} options.images - Uploaded images.
 * @param {number} options.maxImages - Image cap per product.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The updated product, or null if the cap would be exceeded.
 */
export const addImages = async ({ productId, images, maxImages, session }) => {
  // "images.N doesn't exist" means the array has at most N entries — checked atomically with the push.
  const lastAllowedIndexBeforePush = maxImages - images.length;
  return Product.findOneAndUpdate(
    { _id: productId, [`images.${lastAllowedIndexBeforePush}`]: { $exists: false } },
    { $push: { images: { $each: images } } },
    { returnDocument: "after", session },
  );
};

/**
 * Removes one image from a product.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {string} options.imageId - The image subdocument's id.
 * @returns {Promise<import("mongoose").Document | null>} The updated product, or null if not found.
 */
export const removeImage = async ({ productId, imageId }) => {
  return Product.findOneAndUpdate(
    { _id: productId, "images._id": imageId },
    { $pull: { images: { _id: imageId } } },
    { returnDocument: "after" },
  );
};

/**
 * Reserves in-stock units, only if the product is public, IN_STOCK and has enough available.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {number} options.quantity - Units to reserve.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null if it couldn't be reserved.
 */
export const reserveStock = async ({ productId, quantity, session }) => {
  return Product.findOneAndUpdate(
    {
      _id: productId,
      availabilityStatus: AvailabilityStatuses.IN_STOCK,
      publicityStatus: PublicityStatuses.PUBLIC,
      $expr: { $gte: [{ $subtract: ["$stock", "$reserved"] }, quantity] },
    },
    { $inc: { reserved: quantity } },
    { returnDocument: "after", session },
  );
};

/**
 * Claims pre-order spots, only if the product is public, PRE_ORDER and has enough spots left.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {number} options.quantity - Spots to claim.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null if spots couldn't be claimed.
 */
export const reservePreorderSpots = async ({ productId, quantity, session }) => {
  return Product.findOneAndUpdate(
    {
      _id: productId,
      availabilityStatus: AvailabilityStatuses.PRE_ORDER,
      publicityStatus: PublicityStatuses.PUBLIC,
      $expr: { $gte: [{ $subtract: ["$preorderLimit", "$preorderReserved"] }, quantity] },
    },
    { $inc: { preorderReserved: quantity } },
    { returnDocument: "after", session },
  );
};

/**
 * Returns held units to a product's pool. Guarded so a counter can never go negative.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {"reserved" | "preorderReserved"} options.counter - Which counter the hold was on.
 * @param {number} options.quantity - Units to release.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null if the counter was lower than expected.
 */
export const releaseUnits = async ({ productId, counter, quantity, session }) => {
  return Product.findOneAndUpdate(
    { _id: productId, [counter]: { $gte: quantity } },
    { $inc: { [counter]: -quantity } },
    { returnDocument: "after", session },
  );
};

/**
 * Removes shipped units from a product: they leave both physical `stock` and `reserved`.
 * Guarded so neither counter can go negative.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {number} options.quantity - Units shipped.
 * @param {import("mongoose").ClientSession} options.session - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The product, or null if the counters were too low.
 */
export const fulfilUnits = async ({ productId, quantity, session }) => {
  return Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: quantity }, reserved: { $gte: quantity } },
    { $inc: { stock: -quantity, reserved: -quantity } },
    { returnDocument: "after", session },
  );
};

/**
 * Finds in-stock products whose available quantity is at or below a threshold, lowest first.
 * @param {Object} options
 * @param {number} options.threshold - Available-quantity threshold.
 * @param {number} options.limit - Most products to return.
 * @returns {Promise<Object[]>} Plain `{ id, name, sku, stock, reserved, availableStock }` rows.
 */
export const findLowStock = async ({ threshold, limit }) => {
  return Product.aggregate([
    { $match: { availabilityStatus: AvailabilityStatuses.IN_STOCK } },
    { $addFields: { availableStock: { $subtract: ["$stock", "$reserved"] } } },
    { $match: { availableStock: { $lte: threshold } } },
    { $sort: { availableStock: 1 } },
    { $limit: limit },
    {
      $project: { _id: 0, id: { $toString: "$_id" }, name: 1, slug: 1, sku: 1, stock: 1, reserved: 1, availableStock: 1 },
    },
  ]);
};
