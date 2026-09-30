import { logger } from "#configs/logger.config.js";
import { UserLogActions } from "#constants/log.constants.js";
import {
  AvailabilityStatuses,
  MAX_IMAGES_PER_PRODUCT,
  PublicityStatuses,
} from "#constants/product.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { deleteImage, uploadImage } from "#providers/image.provider.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import { movePreorderHoldsToStock } from "#repositories/order.repository.js";
import {
  countImagesForProduct as countPendingImagesForProduct,
  create as createPendingUploadRepo,
  deleteById as deletePendingUploadRepo,
  findById as findPendingUploadById,
} from "#repositories/pending-image-upload.repository.js";
import {
  addImages as addImagesRepo,
  adjustStock as adjustStockRepo,
  create as createProductRepo,
  findById,
  findBySlug,
  findPage,
  removeImage as removeImageRepo,
  updateById,
} from "#repositories/product.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { isDuplicateKeyError } from "#utils/mongo.util.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";
import { escapeRegex, slugify } from "#utils/string.util.js";

/**
 * Cloudinary sub-folder for product images.
 * @type {string}
 */
const PRODUCT_IMAGE_FOLDER = "products";

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 * @typedef {{ page: number, limit: number, total: number, totalPages: number }} Pagination
 */

/**
 * @returns {AppError} PRODUCT_NOT_FOUND error.
 */
const productNotFoundError = () => new AppError("Product not found.", { code: ErrorCodes.PRODUCT_NOT_FOUND });

/**
 * Loads a product by id or throws.
 * @param {string} productId - The product's id.
 * @returns {Promise<import("mongoose").Document>} The product.
 * @throws {AppError} PRODUCT_NOT_FOUND - if it doesn't exist.
 */
const getProductOrThrow = async (productId) => {
  const product = await findById(productId);

  if (!product) {
    throw productNotFoundError();
  }
  return product;
};

/**
 * Quantity a customer can currently buy or pre-order.
 * @param {import("mongoose").Document} product - The product.
 * @returns {number} Never negative.
 */
const getAvailableQuantity = (product) => {
  const availableByStatus = {
    [AvailabilityStatuses.IN_STOCK]: product.availableStock,
    [AvailabilityStatuses.PRE_ORDER]: product.availablePreorderSpots,
    [AvailabilityStatuses.OUT_OF_STOCK]: 0,
  };
  return Math.max(0, availableByStatus[product.availabilityStatus]);
};

/**
 * The customer-facing view of a product: one current price and one available
 * quantity, without internal counters.
 * @param {import("mongoose").Document} product - The product.
 * @returns {Object} The public product.
 */
export const toPublicProduct = (product) => {
  const isPreorder = product.availabilityStatus === AvailabilityStatuses.PRE_ORDER;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    tags: product.tags,
    images: product.images.map((image) => ({ id: image.id, url: image.url })),
    price: isPreorder ? product.pricing.preorderPrice : product.pricing.launchPrice,
    launchPrice: product.pricing.launchPrice,
    availabilityStatus: product.availabilityStatus,
    availableQuantity: getAvailableQuantity(product),
  };
};

/**
 * Throws if a pre-order product would have no pre-order price.
 * @param {Object} options
 * @param {string} options.availabilityStatus - The resulting availability.
 * @param {number | null | undefined} options.preorderPrice - The resulting pre-order price.
 * @returns {void}
 * @throws {AppError} PREORDER_PRICE_REQUIRED
 */
const assertPreorderPriceSet = ({ availabilityStatus, preorderPrice }) => {
  if (availabilityStatus === AvailabilityStatuses.PRE_ORDER && !preorderPrice) {
    throw new AppError("Set a pre-order price before making the product available for pre-order.", {
      code: ErrorCodes.PREORDER_PRICE_REQUIRED,
    });
  }
};

/**
 * Maps a duplicate-key error on sku/slug to its AppError; rethrows anything else.
 * @param {Error} error - The caught error.
 * @returns {never}
 * @throws {AppError} SKU_ALREADY_EXISTS | SLUG_ALREADY_EXISTS
 */
const rethrowDuplicate = (error) => {
  if (isDuplicateKeyError(error, "sku")) {
    throw new AppError("Another product already uses this SKU.", { code: ErrorCodes.SKU_ALREADY_EXISTS });
  }
  if (isDuplicateKeyError(error, "slug")) {
    throw new AppError("Another product already uses this slug.", { code: ErrorCodes.SLUG_ALREADY_EXISTS });
  }
  throw error;
};

/**
 * Lists public products, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.tag] - Only products with this tag.
 * @returns {Promise<{ products: Object[], pagination: Pagination }>} A page of public products.
 */
export const listPublicProducts = async ({ page, limit, tag }) => {
  const filter = { publicityStatus: PublicityStatuses.PUBLIC, ...(tag && { tags: tag }) };
  const { products, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { products: products.map(toPublicProduct), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets a public product by slug.
 * @param {string} slug - The product's slug.
 * @returns {Promise<Object>} The public product.
 * @throws {AppError} PRODUCT_NOT_FOUND - if missing or hidden.
 */
export const getPublicProduct = async (slug) => {
  const product = await findBySlug({ slug, publicityStatus: PublicityStatuses.PUBLIC });

  if (!product) {
    throw productNotFoundError();
  }
  return toPublicProduct(product);
};

/**
 * Lists all products (including hidden) for the admin, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.search] - Matches name or SKU, case-insensitive.
 * @param {string} [options.tag] - Only products with this tag.
 * @param {string} [options.availabilityStatus] - Filter by availability.
 * @param {string} [options.publicityStatus] - Filter by publicity.
 * @returns {Promise<{ products: import("mongoose").Document[], pagination: Pagination }>} A page of products.
 */
export const listAdminProducts = async ({ page, limit, search, tag, availabilityStatus, publicityStatus }) => {
  const searchPattern = search && new RegExp(escapeRegex(search), "i");
  const filter = {
    ...(searchPattern && { $or: [{ name: searchPattern }, { sku: searchPattern }] }),
    ...(tag && { tags: tag }),
    ...(availabilityStatus && { availabilityStatus }),
    ...(publicityStatus && { publicityStatus }),
  };

  const { products, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { products, pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets any product (including hidden) for the admin.
 * @param {string} productId - The product's id.
 * @returns {Promise<import("mongoose").Document>} The product.
 * @throws {AppError} PRODUCT_NOT_FOUND
 */
export const getAdminProduct = async (productId) => getProductOrThrow(productId);

/**
 * Gets any product (including hidden) by slug for the admin — the storefront URLs use slugs.
 * @param {string} slug - The product's slug.
 * @returns {Promise<import("mongoose").Document>} The product.
 * @throws {AppError} PRODUCT_NOT_FOUND
 */
export const getAdminProductBySlug = async (slug) => {
  const product = await findBySlug({ slug });

  if (!product) {
    throw productNotFoundError();
  }
  return product;
};

/**
 * Creates a product. The slug defaults to a slug of the name.
 * @param {Object} options
 * @param {Object} options.fields - Validated create body.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<import("mongoose").Document>} The created product.
 * @throws {AppError} PREORDER_PRICE_REQUIRED | SKU_ALREADY_EXISTS | SLUG_ALREADY_EXISTS | VALIDATION_ERROR
 */
export const createProduct = async ({ fields, adminId, context }) => {
  const slug = fields.slug ?? slugify(fields.name);

  if (!slug) {
    throw new AppError("Couldn't make a slug from this name — please provide one.", {
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fields: [{ location: "body", path: "slug", message: "Slug is required for this name." }] },
    });
  }

  assertPreorderPriceSet({
    availabilityStatus: fields.availabilityStatus,
    preorderPrice: fields.pricing.preorderPrice,
  });

  let product;
  try {
    product = await createProductRepo({ ...fields, slug, tags: [...new Set(fields.tags)] });
  } catch (error) {
    rethrowDuplicate(error);
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.PRODUCT_CREATED,
    context,
    meta: { productId: product.id, sku: product.sku },
  });
  return product;
};

/**
 * Updates product details. Pre-order counters are protected:
 * - the pre-order limit can't drop below spots already claimed;
 * - PRE_ORDER → IN_STOCK with claimed spots converts them into reserved stock (plan.md §5):
 *   stock must cover them, and the held pre-orders are re-pointed to stock, in one transaction;
 * - PRE_ORDER → OUT_OF_STOCK is refused while spots are claimed.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {Object} options.changes - Validated update body.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<import("mongoose").Document>} The updated product.
 * @throws {AppError} PRODUCT_NOT_FOUND | PREORDER_PRICE_REQUIRED | PREORDERS_PENDING |
 *   INSUFFICIENT_STOCK_FOR_PREORDERS | PRODUCT_CHANGED | PREORDER_LIMIT_BELOW_RESERVED | SLUG_ALREADY_EXISTS
 */
export const updateProduct = async ({ productId, changes, adminId, context }) => {
  const existing = await getProductOrThrow(productId);
  const { pricing, ...otherChanges } = changes;

  const nextAvailability = changes.availabilityStatus ?? existing.availabilityStatus;
  const nextPreorderPrice =
    pricing?.preorderPrice !== undefined ? pricing.preorderPrice : existing.pricing.preorderPrice;
  assertPreorderPriceSet({ availabilityStatus: nextAvailability, preorderPrice: nextPreorderPrice });

  const set = {
    ...otherChanges,
    ...(otherChanges.tags && { tags: [...new Set(otherChanges.tags)] }),
    ...(pricing?.launchPrice !== undefined && { "pricing.launchPrice": pricing.launchPrice }),
    ...(pricing?.preorderPrice !== undefined && { "pricing.preorderPrice": pricing.preorderPrice }),
  };

  // e.g. `{ pricing: {} }` — valid, but nothing to change.
  if (!Object.keys(set).length) {
    return existing;
  }

  const claimedSpots = existing.preorderReserved;
  const isLeavingPreorder =
    existing.availabilityStatus === AvailabilityStatuses.PRE_ORDER &&
    nextAvailability !== AvailabilityStatuses.PRE_ORDER;
  const isConvertingPreorders =
    isLeavingPreorder && nextAvailability === AvailabilityStatuses.IN_STOCK && claimedSpots > 0;

  if (isLeavingPreorder && !isConvertingPreorders && claimedSpots > 0) {
    throw new AppError("This product has pending pre-orders. Switch it to In stock to fulfil them.", {
      code: ErrorCodes.PREORDERS_PENDING,
      details: { preorderReserved: claimedSpots },
    });
  }

  // Every condition is re-checked atomically with the write, so concurrent orders can't slip in.
  const preorderReservedCondition = {
    ...(changes.preorderLimit !== undefined && { $lte: changes.preorderLimit }),
    ...(isLeavingPreorder && { $eq: isConvertingPreorders ? claimedSpots : 0 }),
  };
  const conditions = {
    ...(Object.keys(preorderReservedCondition).length && { preorderReserved: preorderReservedCondition }),
    ...(isConvertingPreorders && {
      availabilityStatus: AvailabilityStatuses.PRE_ORDER,
      $expr: { $gte: ["$stock", { $add: ["$reserved", claimedSpots] }] },
    }),
  };
  const inc = isConvertingPreorders ? { reserved: claimedSpots, preorderReserved: -claimedSpots } : undefined;

  let product;
  try {
    product = isConvertingPreorders
      ? await runInTransaction(async (session) => {
          const convertedProduct = await updateById({ productId, set, inc, conditions, session });

          if (convertedProduct) {
            await movePreorderHoldsToStock({ productId, session });
          }
          return convertedProduct;
        })
      : await updateById({ productId, set, conditions });
  } catch (error) {
    rethrowDuplicate(error);
  }

  if (!product) {
    throw await explainFailedUpdate({ productId, isLeavingPreorder, isConvertingPreorders, claimedSpots });
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.PRODUCT_UPDATED,
    context,
    meta: { productId, fields: Object.keys(set), ...(isConvertingPreorders && { convertedPreorders: claimedSpots }) },
  });
  return product;
};

/**
 * Re-reads a product after a conditional update matched nothing, and builds the error saying why.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {boolean} options.isLeavingPreorder - Whether the update moved it off PRE_ORDER.
 * @param {boolean} options.isConvertingPreorders - Whether claimed spots were being converted to stock.
 * @param {number} options.claimedSpots - preorderReserved when the update was prepared.
 * @returns {Promise<AppError>} The error to throw.
 * @throws {AppError} PRODUCT_NOT_FOUND - if the product vanished.
 */
const explainFailedUpdate = async ({ productId, isLeavingPreorder, isConvertingPreorders, claimedSpots }) => {
  const current = await getProductOrThrow(productId);
  const hasPreordersChanged = current.preorderReserved !== (isConvertingPreorders ? claimedSpots : 0);

  if (isLeavingPreorder && hasPreordersChanged) {
    return isConvertingPreorders
      ? new AppError("Pre-orders changed while saving. Please try again.", { code: ErrorCodes.PRODUCT_CHANGED })
      : new AppError("This product has pending pre-orders. Switch it to In stock to fulfil them.", {
          code: ErrorCodes.PREORDERS_PENDING,
          details: { preorderReserved: current.preorderReserved },
        });
  }

  if (isConvertingPreorders && current.availabilityStatus !== AvailabilityStatuses.PRE_ORDER) {
    return new AppError("This product changed while saving. Please try again.", { code: ErrorCodes.PRODUCT_CHANGED });
  }

  if (isConvertingPreorders && current.availableStock < claimedSpots) {
    return new AppError(
      `Add stock first: ${claimedSpots} pre-ordered unit(s) need to be covered, but only ${current.availableStock} are free.`,
      {
        code: ErrorCodes.INSUFFICIENT_STOCK_FOR_PREORDERS,
        details: { preorderReserved: claimedSpots, availableStock: current.availableStock },
      },
    );
  }

  return new AppError("The pre-order limit can't be lower than the spots already claimed.", {
    code: ErrorCodes.PREORDER_LIMIT_BELOW_RESERVED,
    details: { preorderReserved: current.preorderReserved },
  });
};

/**
 * Changes physical stock by a signed amount. Stock can never drop below `reserved`.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {number} options.adjustment - Signed change, e.g. 20 or -2.
 * @param {string} [options.reason] - Why stock changed (recorded in the user log).
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<import("mongoose").Document>} The updated product.
 * @throws {AppError} PRODUCT_NOT_FOUND | STOCK_BELOW_RESERVED
 */
export const adjustStock = async ({ productId, adjustment, reason, adminId, context }) => {
  const product = await adjustStockRepo({ productId, adjustment });

  if (!product) {
    const current = await getProductOrThrow(productId);
    throw new AppError(`Stock can't go below the ${current.reserved} unit(s) reserved by open orders.`, {
      code: ErrorCodes.STOCK_BELOW_RESERVED,
      details: { stock: current.stock, reserved: current.reserved },
    });
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.PRODUCT_STOCK_ADJUSTED,
    context,
    meta: { productId, adjustment, reason, stock: product.stock },
  });
  return product;
};

/**
 * Deletes uploaded images from the host, logging (not throwing) on failure.
 * @param {{ publicId: string }[]} images - Images to delete.
 * @returns {Promise<void>}
 */
const deleteUploadedImages = async (images) => {
  const results = await Promise.allSettled(images.map((image) => deleteImage(image.publicId)));

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error("Orphaned image left in Cloudinary", {
        publicId: images[index].publicId,
        message: result.reason?.message,
      });
    }
  });
};

/**
 * Accepts validated images for a product and hands the Cloudinary upload to the worker:
 * the bytes are staged in MongoDB and a job carrying only the staged upload's id is queued.
 * Images still processing count toward the product's image limit.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {{ buffer: Buffer }[]} options.files - JPEG files from the upload middleware.
 * @param {string} options.adminId - Acting admin (logged when the worker attaches the images).
 * @param {RequestContext} options.context - Request context for that log entry.
 * @returns {Promise<{ id: string, imageCount: number }>} The queued upload.
 * @throws {AppError} PRODUCT_NOT_FOUND | INVALID_UPLOAD | PRODUCT_IMAGE_LIMIT_REACHED
 */
export const queueProductImages = async ({ productId, files, adminId, context }) => {
  if (!files?.length) {
    throw new AppError("Choose at least one image to upload.", { code: ErrorCodes.INVALID_UPLOAD });
  }

  const [product, processingCount] = await Promise.all([
    getProductOrThrow(productId),
    countPendingImagesForProduct(productId),
  ]);
  const currentCount = product.images.length + processingCount;

  if (currentCount + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new AppError(
      `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images — it has ${currentCount}, including any still processing.`,
      { code: ErrorCodes.PRODUCT_IMAGE_LIMIT_REACHED, details: { max: MAX_IMAGES_PER_PRODUCT, current: currentCount } },
    );
  }

  const pendingUpload = await createPendingUploadRepo({
    productId,
    buffers: files.map((file) => file.buffer),
  });

  try {
    // jobId = the staged upload's id, so the same upload can never be queued twice.
    await getQueue(QueueNames.PRODUCT_IMAGES).add(
      "upload",
      { uploadId: pendingUpload.id, adminId: String(adminId), context },
      { jobId: pendingUpload.id },
    );
  } catch (error) {
    await deletePendingUploadRepo({ uploadId: pendingUpload.id });
    throw error;
  }

  return { id: pendingUpload.id, imageCount: files.length };
};

/**
 * Worker side of an image upload: uploads the staged images to Cloudinary, then — in one
 * transaction — attaches them to the product and deletes the staged bytes. That makes retries
 * safe: once committed, the staged upload is gone and a re-run does nothing. A failed Cloudinary
 * upload cleans up its siblings and throws so BullMQ retries.
 * @param {Object} options
 * @param {string} options.uploadId - The staged upload's id.
 * @param {string} options.adminId - Admin who uploaded the images.
 * @param {RequestContext} options.context - Request context from the upload request.
 * @returns {Promise<void>}
 */
export const uploadStagedProductImages = async ({ uploadId, adminId, context }) => {
  const pendingUpload = await findPendingUploadById(uploadId);

  if (!pendingUpload) {
    // Already attached by an earlier attempt, or expired by the TTL index.
    return;
  }

  const productId = String(pendingUpload.productId);
  const results = await Promise.allSettled(
    pendingUpload.images.map((image) => uploadImage({ buffer: image.data, folder: PRODUCT_IMAGE_FOLDER })),
  );
  const uploadedImages = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failedUpload = results.find((result) => result.status === "rejected");

  if (failedUpload) {
    await deleteUploadedImages(uploadedImages);
    throw failedUpload.reason;
  }

  let updatedProduct;
  try {
    updatedProduct = await runInTransaction(async (session) => {
      const product = await addImagesRepo({
        productId,
        images: uploadedImages,
        maxImages: MAX_IMAGES_PER_PRODUCT,
        session,
      });
      // Deleted even when the images can't be attached: retrying would never succeed.
      await deletePendingUploadRepo({ uploadId, session });
      return product;
    });
  } catch (error) {
    await deleteUploadedImages(uploadedImages);
    throw error;
  }

  if (!updatedProduct) {
    // The product was removed, or concurrent uploads filled its slots after the API's check.
    await deleteUploadedImages(uploadedImages);
    logger.error("Product image upload dropped — product missing or image limit reached", {
      productId,
      uploadId,
      imageCount: uploadedImages.length,
    });
    return;
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.PRODUCT_IMAGES_ADDED,
    context,
    meta: { productId, count: uploadedImages.length },
  });
};

/**
 * Removes an image from a product, then deletes it from the host. The database is the
 * source of truth, so a failed host delete is logged rather than failing the request.
 * @param {Object} options
 * @param {string} options.productId - The product's id.
 * @param {string} options.imageId - The image's id.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<import("mongoose").Document>} The updated product.
 * @throws {AppError} PRODUCT_NOT_FOUND | PRODUCT_IMAGE_NOT_FOUND
 */
export const removeProductImage = async ({ productId, imageId, adminId, context }) => {
  const product = await getProductOrThrow(productId);
  const image = product.images.id(imageId);

  if (!image) {
    throw new AppError("Image not found.", { code: ErrorCodes.PRODUCT_IMAGE_NOT_FOUND });
  }

  const updatedProduct = await removeImageRepo({ productId, imageId });

  if (!updatedProduct) {
    throw new AppError("Image not found.", { code: ErrorCodes.PRODUCT_IMAGE_NOT_FOUND });
  }

  await deleteUploadedImages([image]);
  await writeUserLog({
    userId: adminId,
    action: UserLogActions.PRODUCT_IMAGE_REMOVED,
    context,
    meta: { productId, publicId: image.publicId },
  });
  return updatedProduct;
};
