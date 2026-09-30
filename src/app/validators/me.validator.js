import { z } from "zod";

import { nameField, passwordField } from "./auth.validator.js";
import { objectIdField } from "./common.validator.js";

/**
 * PATCH /me body. Email changes aren't supported (they'd need re-verification).
 * @type {import("zod").ZodObject}
 */
export const updateProfileBodySchema = z.strictObject({
  name: nameField,
});

/**
 * PATCH /me/password body.
 * @type {import("zod").ZodObject}
 */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: passwordField,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    message: "New password must be different from the current one.",
    path: ["newPassword"],
  });

/**
 * Every address field; used as-is for create and made optional for update.
 * @type {import("zod").ZodRawShape}
 */
const addressShape = {
  // Required: saved addresses are identified by their label (unique per user, checked in the handler).
  label: z.string().trim().min(1, "Give this address a label, e.g. Home.").max(40),
  fullName: z.string().trim().min(2, "Full name is required.").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number."),
  line1: z.string().trim().min(3, "Address line 1 is required.").max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, "City is required.").max(60),
  state: z.string().trim().min(2, "State is required.").max(60),
  country: z.string().trim().min(2, "Country is required.").max(60),
  postalCode: z.string().trim().max(20).optional(),
  isDefault: z.boolean().optional(),
};

/**
 * POST /me/addresses body.
 * @type {import("zod").ZodObject}
 */
export const addressBodySchema = z.object(addressShape);

/**
 * PATCH /me/addresses/:addressId body.
 * @type {import("zod").ZodObject}
 */
export const updateAddressBodySchema = z
  .strictObject(addressShape)
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update.");

/**
 * `:addressId` route param.
 * @type {import("zod").ZodObject}
 */
export const addressIdParamsSchema = z.object({ addressId: objectIdField });

/**
 * `:sku` route param.
 * @type {import("zod").ZodObject}
 */
export const favouriteSkuParamsSchema = z.object({
  sku: z.string().trim().toUpperCase().min(1).max(32),
});
