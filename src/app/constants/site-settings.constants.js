/**
 * The one site-settings document's key. There is only ever one document; the unique key makes a
 * second impossible, and it's created on first use.
 * @type {string}
 */
export const SITE_SETTINGS_KEY = "SITE";

/**
 * The landing page's three hero panels, left to right.
 * @type {Readonly<Record<string, string>>}
 */
export const HeroPanels = {
  LEFT: "left",
  MIDDLE: "middle",
  RIGHT: "right",
};

/**
 * Cloudinary sub-folder for hero images.
 * @type {string}
 */
export const HERO_IMAGE_FOLDER = "site/hero";

/**
 * Colours are stored as 6-digit hex, e.g. "#111111".
 * @type {RegExp}
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
