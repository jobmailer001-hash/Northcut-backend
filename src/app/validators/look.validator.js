import { z } from "zod";

import { MAX_PRODUCTS_PER_LOOK } from "#constants/look.constants.js";
import { PublicityStatuses } from "#constants/product.constants.js";

import { objectIdField, paginationQueryShape } from "./common.validator.js";
import { descriptionField, nameField, skuField, slugField } from "./product.validator.js";

/**
 * The look's products by SKU, in display order. SKUs are uppercased before the repeat check.
 * @type {import("zod").ZodArray}
 */
const productSkusField = z
  .array(skuField)
  .max(MAX_PRODUCTS_PER_LOOK, `A look can have at most ${MAX_PRODUCTS_PER_LOOK} products.`)
  .refine((skus) => new Set(skus).size === skus.length, "A product can only be added to a look once.");

const publicityField = z.enum(Object.values(PublicityStatuses));

/**
 * POST /admin/looks body. New looks start hidden; the image is uploaded afterwards.
 * @type {import("zod").ZodObject}
 */
export const createLookBodySchema = z.object({
  name: nameField,
  slug: slugField.optional(),
  description: descriptionField.default(""),
  productSkus: productSkusField.default([]),
});

/**
 * PATCH /admin/looks/:id body. `productSkus` replaces the whole list.
 * @type {import("zod").ZodObject}
 */
export const updateLookBodySchema = z
  .strictObject({
    name: nameField.optional(),
    slug: slugField.optional(),
    description: descriptionField.optional(),
    publicityStatus: publicityField.optional(),
    productSkus: productSkusField.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update.");

/**
 * `:id` route param.
 * @type {import("zod").ZodObject}
 */
export const lookIdParamsSchema = z.object({ id: objectIdField });

/**
 * `:slug` route param.
 * @type {import("zod").ZodObject}
 */
export const lookSlugParamsSchema = z.object({ slug: slugField });

/**
 * GET /looks query.
 * @type {import("zod").ZodObject}
 */
export const listPublicLooksQuerySchema = z.object(paginationQueryShape(12));

/**
 * GET /admin/looks query.
 * @type {import("zod").ZodObject}
 */
export const listAdminLooksQuerySchema = z.object({
  ...paginationQueryShape(20),
  search: z.string().trim().max(100).optional(),
  publicityStatus: publicityField.optional(),
});
