import { SITE_SETTINGS_KEY } from "#constants/site-settings.constants.js";
import { SiteSetting } from "#models/site-setting.model.js";

/**
 * Upsert options that create the one settings document the first time it's touched.
 * @type {import("mongoose").QueryOptions}
 */
const upsertOptions = { upsert: true, setDefaultsOnInsert: true };

/**
 * Returns the site settings, creating the document with defaults on first use.
 * @returns {Promise<import("mongoose").Document>} The settings.
 */
export const findOrCreate = async () => {
  return SiteSetting.findOneAndUpdate(
    { key: SITE_SETTINGS_KEY },
    { $setOnInsert: { key: SITE_SETTINGS_KEY } },
    { ...upsertOptions, returnDocument: "after" },
  );
};

/**
 * Sets fields on the settings document (dot paths allowed, e.g. "colors.primary").
 * @param {Record<string, unknown>} set - Fields to set.
 * @returns {Promise<import("mongoose").Document>} The settings after the change.
 */
export const updateFields = async (set) => {
  return SiteSetting.findOneAndUpdate(
    { key: SITE_SETTINGS_KEY },
    { $set: set },
    { ...upsertOptions, returnDocument: "after", runValidators: true },
  );
};

/**
 * Replaces (or clears, with `image: null`) one hero panel's image, returning the settings as they
 * were *before* — so the caller can delete the previous image from the host.
 * @param {Object} options
 * @param {string} options.panel - One of HeroPanels.
 * @param {{ url: string, publicId: string } | null} options.image - The new image, or null to clear.
 * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
 * @returns {Promise<import("mongoose").Document | null>} The settings before the change (null if just created).
 */
export const replaceHeroImage = async ({ panel, image, session }) => {
  return SiteSetting.findOneAndUpdate(
    { key: SITE_SETTINGS_KEY },
    { $set: { [`hero.${panel}`]: image } },
    { ...upsertOptions, returnDocument: "before", session },
  );
};
