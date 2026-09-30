/**
 * Turns text into a URL slug: "Classic Tee — Black!" → "classic-tee-black".
 * @param {string} text - Source text.
 * @returns {string} Lowercase words joined by single hyphens (may be empty).
 */
export const slugify = (text) => {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Escapes user input for use inside a RegExp, so search text can't inject patterns.
 * @param {string} text - Raw search text.
 * @returns {string} Text safe to embed in a RegExp.
 */
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
