import { logger } from "#configs/logger.config.js";
import { UserLogActions } from "#constants/log.constants.js";
import { LOOK_IMAGE_FOLDER } from "#constants/look.constants.js";
import { PublicityStatuses } from "#constants/product.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { deleteImage, uploadImage } from "#providers/image.provider.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import {
  create as createLookRepo,
  findById,
  findByIdWithProducts,
  findBySlugWithProducts,
  findPage,
  findPublicBySlugWithProducts,
  replaceImage as replaceImageRepo,
  updateById,
} from "#repositories/look.repository.js";
import {
  createForLook as createPendingLookUploadRepo,
  deleteById as deletePendingUploadRepo,
  findById as findPendingUploadById,
} from "#repositories/pending-image-upload.repository.js";
import { findBySkus as findProductsBySkus } from "#repositories/product.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { isDuplicateKeyError } from "#utils/mongo.util.js";
import { buildPagination, toSkip } from "#utils/pagination.util.js";
import { escapeRegex, slugify } from "#utils/string.util.js";

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 * @typedef {{ page: number, limit: number, total: number, totalPages: number }} Pagination
 * @typedef {import("#repositories/look.repository.js").LookWithProducts} LookWithProducts
 */

/**
 * @returns {AppError} LOOK_NOT_FOUND error.
 */
const lookNotFoundError = () => new AppError("Look not found.", { code: ErrorCodes.LOOK_NOT_FOUND });

/**
 * Loads a look by id or throws.
 * @param {string} lookId - The look's id.
 * @returns {Promise<import("mongoose").Document>} The look.
 * @throws {AppError} LOOK_NOT_FOUND - if it doesn't exist.
 */
const getLookOrThrow = async (lookId) => {
  const look = await findById(lookId);

  if (!look) {
    throw lookNotFoundError();
  }
  return look;
};

/**
 * Loads the products for a list of SKUs, or throws naming the SKUs that don't exist.
 * @param {string[]} skus - Product SKUs (uppercase).
 * @returns {Promise<import("mongoose").Document[]>} The products (any order).
 * @throws {AppError} PRODUCT_NOT_FOUND - with `details.skus` listing the unknown SKUs.
 */
const getProductsOrThrow = async (skus) => {
  const products = skus.length ? await findProductsBySkus(skus) : [];

  if (products.length !== skus.length) {
    const foundSkus = new Set(products.map((product) => product.sku));
    throw new AppError("Some of these products don't exist.", {
      code: ErrorCodes.PRODUCT_NOT_FOUND,
      details: { skus: skus.filter((sku) => !foundSkus.has(sku)) },
    });
  }
  return products;
};

/**
 * Throws unless a look can be shown to customers: it needs products, all of them public, and its image.
 * @param {Object} options
 * @param {import("mongoose").Document[]} options.products - The look's products.
 * @param {boolean} options.hasImage - Whether the look has its image.
 * @returns {void}
 * @throws {AppError} LOOK_NOT_PUBLISHABLE
 */
const assertPublishable = ({ products, hasImage }) => {
  if (!products.length) {
    throw new AppError("Add at least one product before making this look public.", {
      code: ErrorCodes.LOOK_NOT_PUBLISHABLE,
    });
  }

  const hiddenProducts = products.filter((product) => product.publicityStatus !== PublicityStatuses.PUBLIC);

  if (hiddenProducts.length) {
    throw new AppError(
      `Every product must be public first — hidden: ${hiddenProducts.map((product) => product.name).join(", ")}.`,
      {
        code: ErrorCodes.LOOK_NOT_PUBLISHABLE,
        details: { hiddenProducts: hiddenProducts.map((product) => ({ sku: product.sku, name: product.name })) },
      },
    );
  }

  if (!hasImage) {
    throw new AppError("Upload the look's image before making it public.", { code: ErrorCodes.LOOK_NOT_PUBLISHABLE });
  }
};

/**
 * Maps a duplicate-key error on slug to its AppError; rethrows anything else.
 * @param {Error} error - The caught error.
 * @returns {never}
 * @throws {AppError} SLUG_ALREADY_EXISTS
 */
const rethrowDuplicateSlug = (error) => {
  if (isDuplicateKeyError(error, "slug")) {
    throw new AppError("Another look already uses this slug.", { code: ErrorCodes.SLUG_ALREADY_EXISTS });
  }
  throw error;
};

/**
 * Deletes an image from the host. Best-effort: the database is the source of truth, so a failure
 * is logged as an orphan instead of failing the operation.
 * @param {string} publicId - The image's host id.
 * @returns {Promise<boolean>} Whether the image was deleted.
 */
const deleteHostedImage = async (publicId) => {
  try {
    await deleteImage(publicId);
    return true;
  } catch (error) {
    logger.error("Orphaned look image left in Cloudinary", { publicId, message: error.message });
    return false;
  }
};

/**
 * The customer-facing look: its image and, per product, only what's needed to show and link to it.
 * @param {LookWithProducts} look - The look with its public products.
 * @returns {Object} The public look.
 */
const toPublicLook = (look) => ({
  id: String(look._id),
  name: look.name,
  slug: look.slug,
  description: look.description,
  imageUrl: look.image?.url ?? null,
  products: look.products.map(({ sku, name, slug, imageUrl }) => ({ sku, name, slug, imageUrl })),
});

/**
 * The admin's view of a look: the public fields plus publicity, and each product's publicity.
 * @param {LookWithProducts} look - The look with all of its products.
 * @returns {Object} The admin look.
 */
const toAdminLook = (look) => ({
  id: String(look._id),
  name: look.name,
  slug: look.slug,
  description: look.description,
  publicityStatus: look.publicityStatus,
  imageUrl: look.image?.url ?? null,
  products: look.products,
  createdAt: look.createdAt,
  updatedAt: look.updatedAt,
});

/**
 * One card in the storefront's looks list.
 * @param {import("mongoose").Document} look - The look.
 * @returns {Object} The public look summary.
 */
const toPublicLookSummary = (look) => ({
  id: look.id,
  name: look.name,
  slug: look.slug,
  description: look.description,
  imageUrl: look.image?.url ?? null,
  productCount: look.productSkus.length,
});

/**
 * One card in the admin's looks list.
 * @param {import("mongoose").Document} look - The look.
 * @returns {Object} The admin look summary.
 */
const toAdminLookSummary = (look) => ({
  ...toPublicLookSummary(look),
  publicityStatus: look.publicityStatus,
  createdAt: look.createdAt,
  updatedAt: look.updatedAt,
});

/**
 * Loads a look with its products (by id) and builds the admin view.
 * @param {string} lookId - The look's id.
 * @returns {Promise<Object>} The admin look.
 * @throws {AppError} LOOK_NOT_FOUND
 */
const buildAdminLook = async (lookId) => {
  const look = await findByIdWithProducts(lookId);

  if (!look) {
    throw lookNotFoundError();
  }
  return toAdminLook(look);
};

/**
 * Lists public looks, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ looks: Object[], pagination: Pagination }>} A page of look summaries.
 */
export const listPublicLooks = async ({ page, limit }) => {
  const filter = { publicityStatus: PublicityStatuses.PUBLIC };
  const { looks, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { looks: looks.map(toPublicLookSummary), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets a public look by slug, with its public products (aggregated in one query).
 * @param {string} slug - The look's slug.
 * @returns {Promise<Object>} The public look.
 * @throws {AppError} LOOK_NOT_FOUND - if missing or hidden.
 */
export const getPublicLook = async (slug) => {
  const look = await findPublicBySlugWithProducts(slug);

  if (!look) {
    throw lookNotFoundError();
  }
  return toPublicLook(look);
};

/**
 * Lists all looks (including hidden) for the admin, newest first.
 * @param {Object} options
 * @param {number} options.page - 1-based page.
 * @param {number} options.limit - Page size.
 * @param {string} [options.search] - Matches the name, case-insensitive.
 * @param {string} [options.publicityStatus] - Filter by publicity.
 * @returns {Promise<{ looks: Object[], pagination: Pagination }>} A page of admin look summaries.
 */
export const listAdminLooks = async ({ page, limit, search, publicityStatus }) => {
  const filter = {
    ...(search && { name: new RegExp(escapeRegex(search), "i") }),
    ...(publicityStatus && { publicityStatus }),
  };
  const { looks, total } = await findPage({ filter, skip: toSkip({ page, limit }), limit });
  return { looks: looks.map(toAdminLookSummary), pagination: buildPagination({ page, limit, total }) };
};

/**
 * Gets any look (including hidden) by slug for the admin.
 * @param {string} slug - The look's slug.
 * @returns {Promise<Object>} The admin look.
 * @throws {AppError} LOOK_NOT_FOUND
 */
export const getAdminLookBySlug = async (slug) => {
  const look = await findBySlugWithProducts(slug);

  if (!look) {
    throw lookNotFoundError();
  }
  return toAdminLook(look);
};

/**
 * Gets any look (including hidden) for the admin.
 * @param {string} lookId - The look's id.
 * @returns {Promise<Object>} The admin look.
 * @throws {AppError} LOOK_NOT_FOUND
 */
export const getAdminLook = async (lookId) => buildAdminLook(lookId);

/**
 * Creates a hidden look without an image. The slug defaults to a slug of the name.
 * @param {Object} options
 * @param {Object} options.fields - Validated create body.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The created admin look.
 * @throws {AppError} PRODUCT_NOT_FOUND | SLUG_ALREADY_EXISTS | VALIDATION_ERROR
 */
export const createLook = async ({ fields, adminId, context }) => {
  const slug = fields.slug ?? slugify(fields.name);

  if (!slug) {
    throw new AppError("Couldn't make a slug from this name — please provide one.", {
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fields: [{ location: "body", path: "slug", message: "Slug is required for this name." }] },
    });
  }

  await getProductsOrThrow(fields.productSkus);

  let look;
  try {
    look = await createLookRepo({ ...fields, slug });
  } catch (error) {
    rethrowDuplicateSlug(error);
  }

  await writeUserLog({ userId: adminId, action: UserLogActions.LOOK_CREATED, context, meta: { lookId: look.id } });
  return buildAdminLook(look.id);
};

/**
 * Updates a look's details, publicity or products. A look that is (or becomes) public must pass
 * the publish check.
 * @param {Object} options
 * @param {string} options.lookId - The look's id.
 * @param {Object} options.changes - Validated update body.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Object>} The updated admin look.
 * @throws {AppError} LOOK_NOT_FOUND | PRODUCT_NOT_FOUND | LOOK_NOT_PUBLISHABLE | SLUG_ALREADY_EXISTS
 */
export const updateLook = async ({ lookId, changes, adminId, context }) => {
  const existing = await getLookOrThrow(lookId);
  const products = await getProductsOrThrow(changes.productSkus ?? existing.productSkus);

  if ((changes.publicityStatus ?? existing.publicityStatus) === PublicityStatuses.PUBLIC) {
    assertPublishable({ products, hasImage: Boolean(existing.image) });
  }

  let look;
  try {
    look = await updateById({ lookId, set: changes });
  } catch (error) {
    rethrowDuplicateSlug(error);
  }

  if (!look) {
    throw lookNotFoundError();
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.LOOK_UPDATED,
    context,
    meta: { lookId, fields: Object.keys(changes) },
  });
  return buildAdminLook(lookId);
};

/**
 * Accepts a look's image and hands the Cloudinary upload to the worker: the bytes are staged in
 * MongoDB and a job carrying only the staged upload's id is queued. The new image replaces the old one.
 * @param {Object} options
 * @param {string} options.lookId - The look's id.
 * @param {{ buffer: Buffer } | undefined} options.file - The JPEG from the upload middleware.
 * @param {string} options.adminId - Acting admin (logged when the worker applies the image).
 * @param {RequestContext} options.context - Request context for that log entry.
 * @returns {Promise<{ id: string, lookId: string }>} The queued upload.
 * @throws {AppError} INVALID_UPLOAD | LOOK_NOT_FOUND
 */
export const queueLookImage = async ({ lookId, file, adminId, context }) => {
  if (!file) {
    throw new AppError("Choose an image to upload.", { code: ErrorCodes.INVALID_UPLOAD });
  }

  await getLookOrThrow(lookId);
  const pendingUpload = await createPendingLookUploadRepo({ lookId, buffer: file.buffer });

  try {
    // jobId = the staged upload's id, so the same upload can never be queued twice.
    await getQueue(QueueNames.LOOK_IMAGES).add(
      "upload",
      { uploadId: pendingUpload.id, adminId: String(adminId), context },
      { jobId: pendingUpload.id },
    );
  } catch (error) {
    await deletePendingUploadRepo({ uploadId: pendingUpload.id });
    throw error;
  }

  return { id: pendingUpload.id, lookId };
};

/**
 * Worker side of a look image upload: uploads the staged image to Cloudinary, then — in one
 * transaction — sets it on the look and deletes the staged bytes (so a retry after that is a
 * no-op), and finally deletes the look's previous image from Cloudinary.
 * @param {Object} options
 * @param {string} options.uploadId - The staged upload's id.
 * @param {string} options.adminId - Admin who uploaded the image.
 * @param {RequestContext} options.context - Request context from the upload request.
 * @returns {Promise<void>}
 */
export const uploadStagedLookImage = async ({ uploadId, adminId, context }) => {
  const pendingUpload = await findPendingUploadById(uploadId);

  if (!pendingUpload) {
    // Already applied by an earlier attempt, or expired by the TTL index.
    logger.info("Look image upload skipped — already processed or expired", { uploadId });
    return;
  }

  const lookId = String(pendingUpload.lookId);
  const startedAt = Date.now();
  logger.info("Uploading look image to Cloudinary", { uploadId, lookId, folder: LOOK_IMAGE_FOLDER });

  let uploadedImage;
  try {
    uploadedImage = await uploadImage({ buffer: pendingUpload.images[0].data, folder: LOOK_IMAGE_FOLDER });
  } catch (error) {
    // Nothing has changed yet; rethrowing lets BullMQ retry.
    logger.warn("Look image upload to Cloudinary failed — the job will retry", {
      uploadId,
      lookId,
      message: error.message,
    });
    throw error;
  }

  logger.info("Look image uploaded to Cloudinary", {
    uploadId,
    lookId,
    publicId: uploadedImage.publicId,
    durationMs: Date.now() - startedAt,
  });

  let lookBefore;
  try {
    lookBefore = await runInTransaction(async (session) => {
      const before = await replaceImageRepo({ lookId, image: uploadedImage, session });
      await deletePendingUploadRepo({ uploadId, session });
      return before;
    });
  } catch (error) {
    await deleteHostedImage(uploadedImage.publicId);
    throw error;
  }

  if (!lookBefore) {
    await deleteHostedImage(uploadedImage.publicId);
    logger.error("Look image upload dropped — look missing", { uploadId, lookId });
    return;
  }

  const previousImage = lookBefore.image;
  logger.info("Look image applied", { uploadId, lookId, replacedPrevious: Boolean(previousImage) });

  // A failed delete is already logged as an orphan by deleteHostedImage.
  if (previousImage && (await deleteHostedImage(previousImage.publicId))) {
    logger.info("Previous look image removed from Cloudinary", { lookId, publicId: previousImage.publicId });
  }

  await writeUserLog({ userId: adminId, action: UserLogActions.LOOK_IMAGE_UPDATED, context, meta: { lookId } });
};
