import { logger } from "#configs/logger.config.js";
import { UserLogActions } from "#constants/log.constants.js";
import { HERO_IMAGE_FOLDER, HeroPanels } from "#constants/site-settings.constants.js";
import { runInTransaction } from "#db/mongodb/transaction.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { deleteImage, uploadImage } from "#providers/image.provider.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import {
  createForHeroPanel as createPendingHeroUploadRepo,
  deleteById as deletePendingUploadRepo,
  findById as findPendingUploadById,
} from "#repositories/pending-image-upload.repository.js";
import {
  findOrCreate as findOrCreateSettingsRepo,
  replaceHeroImage as replaceHeroImageRepo,
  updateFields as updateSettingsRepo,
} from "#repositories/site-setting.repository.js";
import { writeUserLog } from "#utils/log.util.js";

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 * @typedef {{
 *   hero: Record<string, { url: string } | null>,
 *   colors: { primary: string | null, secondary: string | null },
 *   updatedAt?: Date
 * }} SiteSettingsView
 */

/**
 * The site settings as clients see them — hero URLs and colours, never the host's image ids.
 * Empty values mean "use the default" (grey hero panel, theme colour).
 * @param {import("mongoose").Document} settings - The settings document.
 * @returns {SiteSettingsView} The view.
 */
const toSiteSettingsView = (settings) => ({
  hero: Object.fromEntries(
    Object.values(HeroPanels).map((panel) => {
      const image = settings.hero?.[panel];
      return [panel, image ? { url: image.url } : null];
    }),
  ),
  colors: {
    primary: settings.colors?.primary ?? null,
    secondary: settings.colors?.secondary ?? null,
  },
  updatedAt: settings.updatedAt,
});

/**
 * Deletes an image from the host. Best-effort: the database is the source of truth, so a failure
 * is logged as an orphan instead of failing the operation.
 * @param {string} publicId - The image's host id.
 * @returns {Promise<void>}
 */
const deleteHostedImage = async (publicId) => {
  try {
    await deleteImage(publicId);
  } catch (error) {
    logger.error("Orphaned hero image left in Cloudinary", { publicId, message: error.message });
  }
};

/**
 * Gets the site settings (public — the storefront loads them before it renders).
 * @returns {Promise<SiteSettingsView>} The settings.
 */
export const getSiteSettings = async () => toSiteSettingsView(await findOrCreateSettingsRepo());

/**
 * Updates site settings. Currently the brand colours; `null` resets a colour to the theme default.
 * @param {Object} options
 * @param {{ primary?: string | null, secondary?: string | null }} [options.colors] - Colours to change.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<SiteSettingsView>} The settings after the change.
 */
export const updateSiteSettings = async ({ colors = {}, adminId, context }) => {
  const set = Object.fromEntries(Object.entries(colors).map(([name, value]) => [`colors.${name}`, value]));
  const settings = await updateSettingsRepo(set);

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.SITE_SETTINGS_UPDATED,
    context,
    meta: { fields: Object.keys(set) },
  });
  return toSiteSettingsView(settings);
};

/**
 * Accepts a hero panel's image and hands the Cloudinary upload to the worker: the bytes are staged
 * in MongoDB and a job carrying only the staged upload's id is queued.
 * @param {Object} options
 * @param {string} options.panel - One of HeroPanels.
 * @param {{ buffer: Buffer } | undefined} options.file - The JPEG from the upload middleware.
 * @param {string} options.adminId - Acting admin (logged when the worker applies the image).
 * @param {RequestContext} options.context - Request context for that log entry.
 * @returns {Promise<{ id: string, panel: string }>} The queued upload.
 * @throws {AppError} INVALID_UPLOAD
 */
export const queueHeroImage = async ({ panel, file, adminId, context }) => {
  if (!file) {
    throw new AppError("Choose an image to upload.", { code: ErrorCodes.INVALID_UPLOAD });
  }

  const pendingUpload = await createPendingHeroUploadRepo({ heroPanel: panel, buffer: file.buffer });

  try {
    // jobId = the staged upload's id, so the same upload can never be queued twice.
    await getQueue(QueueNames.SITE_HERO_IMAGES).add(
      "upload",
      { uploadId: pendingUpload.id, adminId: String(adminId), context },
      { jobId: pendingUpload.id },
    );
  } catch (error) {
    await deletePendingUploadRepo({ uploadId: pendingUpload.id });
    throw error;
  }

  return { id: pendingUpload.id, panel };
};

/**
 * Worker side of a hero upload: uploads the staged image to Cloudinary, then — in one transaction —
 * sets it on its panel and deletes the staged bytes (so a retry after that is a no-op), and finally
 * deletes the panel's previous image from Cloudinary.
 * @param {Object} options
 * @param {string} options.uploadId - The staged upload's id.
 * @param {string} options.adminId - Admin who uploaded the image.
 * @param {RequestContext} options.context - Request context from the upload request.
 * @returns {Promise<void>}
 */
export const uploadStagedHeroImage = async ({ uploadId, adminId, context }) => {
  const pendingUpload = await findPendingUploadById(uploadId);

  if (!pendingUpload) {
    // Already applied by an earlier attempt, or expired by the TTL index.
    return;
  }

  const panel = pendingUpload.heroPanel;
  // A failed upload throws, so BullMQ retries; nothing has changed yet.
  const uploadedImage = await uploadImage({ buffer: pendingUpload.images[0].data, folder: HERO_IMAGE_FOLDER });

  let settingsBefore;
  try {
    settingsBefore = await runInTransaction(async (session) => {
      const before = await replaceHeroImageRepo({ panel, image: uploadedImage, session });
      await deletePendingUploadRepo({ uploadId, session });
      return before;
    });
  } catch (error) {
    await deleteHostedImage(uploadedImage.publicId);
    throw error;
  }

  const previousImage = settingsBefore?.hero?.[panel];

  if (previousImage) {
    await deleteHostedImage(previousImage.publicId);
  }

  await writeUserLog({
    userId: adminId,
    action: UserLogActions.SITE_HERO_IMAGE_UPDATED,
    context,
    meta: { panel },
  });
};

/**
 * Clears a hero panel (it shows grey again) and deletes its image from Cloudinary.
 * @param {Object} options
 * @param {string} options.panel - One of HeroPanels.
 * @param {string} options.adminId - Acting admin.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<SiteSettingsView>} The settings after the change.
 */
export const removeHeroImage = async ({ panel, adminId, context }) => {
  const settingsBefore = await replaceHeroImageRepo({ panel, image: null });
  const previousImage = settingsBefore?.hero?.[panel];

  if (previousImage) {
    await deleteHostedImage(previousImage.publicId);
  }

  await writeUserLog({ userId: adminId, action: UserLogActions.SITE_HERO_IMAGE_REMOVED, context, meta: { panel } });
  return getSiteSettings();
};
