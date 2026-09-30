import { z } from "zod";

import { HEX_COLOR_PATTERN, HeroPanels } from "#constants/site-settings.constants.js";

/**
 * A brand colour: "#RRGGBB", or null to go back to the theme default.
 * @type {import("zod").ZodNullable}
 */
const colorField = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Use a 6-digit hex colour, e.g. #111111.")
  .transform((value) => value.toLowerCase())
  .nullable();

/**
 * PATCH /admin/site-settings body. Only colours for now; more settings join this object later.
 * @type {import("zod").ZodObject}
 */
export const updateSiteSettingsBodySchema = z.strictObject({
  colors: z
    .strictObject({
      primary: colorField.optional(),
      secondary: colorField.optional(),
    })
    .refine((colors) => Object.keys(colors).length > 0, "Provide at least one colour."),
});

/**
 * `:panel` route param for hero image routes.
 * @type {import("zod").ZodObject}
 */
export const heroPanelParamsSchema = z.object({
  panel: z.enum(Object.values(HeroPanels)),
});
