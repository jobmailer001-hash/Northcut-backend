import mongoose from "mongoose";

import { SITE_SETTINGS_KEY } from "#constants/site-settings.constants.js";

import { jsonOptions } from "./schema-options.js";

/**
 * A hosted hero image.
 * @type {import("mongoose").Schema}
 */
const heroImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
);

/**
 * Site-wide settings the admin can change. Exactly one document exists: `key` is fixed and unique,
 * and the repository creates it on first use. Empty values mean "use the built-in default"
 * (no hero image → grey panel; no colour → the theme's colour).
 * @type {import("mongoose").Schema}
 */
const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: SITE_SETTINGS_KEY, unique: true, immutable: true },
    hero: {
      left: { type: heroImageSchema, default: null },
      middle: { type: heroImageSchema, default: null },
      right: { type: heroImageSchema, default: null },
    },
    colors: {
      primary: { type: String, default: null },
      secondary: { type: String, default: null },
    },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/**
 * SiteSetting model.
 * @type {import("mongoose").Model}
 */
export const SiteSetting = mongoose.model("SiteSetting", siteSettingSchema);
