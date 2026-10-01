import { z } from "zod";

import {
  AvailabilityStatuses,
  MAX_TAGS_PER_PRODUCT,
  PublicityStatuses,
} from "#constants/product.constants.js";

import { objectIdField, paginationQueryShape } from "./common.validator.js";

/**
 * Largest single stock adjustment accepted, to catch typos like an extra zero.
 * @type {number}
 */
const MAX_STOCK_ADJUSTMENT = 100000;

/**
 * Money in integer minor units (kobo).
 * @type {import("zod").ZodNumber}
 */
const moneyField = z
  .number()
  .int("Amounts are in kobo and must be whole numbers.")
  .nonnegative();

export const nameField = z.string().trim().min(2, "Name must be at least 2 characters.").max(120);

export const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, "SKU must be 3–32 letters, numbers or dashes.");

export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers and single dashes.")
  .max(120);

export const descriptionField = z.string().trim().max(5000);

const tagsField = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(MAX_TAGS_PER_PRODUCT, `At most ${MAX_TAGS_PER_PRODUCT} tags.`);

const counterField = z.number().int().nonnegative();

const availabilityField = z.enum(Object.values(AvailabilityStatuses));

const publicityField = z.enum(Object.values(PublicityStatuses));

/**
 * POST /admin/products body. SKU is set here once and can never change.
 * @type {import("zod").ZodObject}
 */
export const createProductBodySchema = z.object({
  name: nameField,
  sku: skuField,
  slug: slugField.optional(),
  description: descriptionField.default(""),
  tags: tagsField.default([]),
  pricing: z.object({
    launchPrice: moneyField.positive("Launch price must be more than zero."),
    preorderPrice: moneyField.positive("Pre-order price must be more than zero.").nullable().optional(),
  }),
  availabilityStatus: availabilityField.default(AvailabilityStatuses.OUT_OF_STOCK),
  publicityStatus: publicityField.default(PublicityStatuses.HIDDEN),
  stock: counterField.default(0),
  preorderLimit: counterField.default(0),
});

/**
 * PATCH /admin/products/:id body. Strict, so an attempt to change `sku` (or stock,
 * which has its own endpoint) is rejected instead of silently ignored.
 * @type {import("zod").ZodObject}
 */
export const updateProductBodySchema = z
  .strictObject({
    name: nameField.optional(),
    slug: slugField.optional(),
    description: descriptionField.optional(),
    tags: tagsField.optional(),
    pricing: z
      .strictObject({
        launchPrice: moneyField.positive("Launch price must be more than zero.").optional(),
        preorderPrice: moneyField.positive("Pre-order price must be more than zero.").nullable().optional(),
      })
      .optional(),
    availabilityStatus: availabilityField.optional(),
    publicityStatus: publicityField.optional(),
    preorderLimit: counterField.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update.");

/**
 * PATCH /admin/products/:id/stock body.
 * @type {import("zod").ZodObject}
 */
export const adjustStockBodySchema = z.object({
  adjustment: z
    .number()
    .int()
    .min(-MAX_STOCK_ADJUSTMENT)
    .max(MAX_STOCK_ADJUSTMENT)
    .refine((value) => value !== 0, "Adjustment can't be zero."),
  reason: z.string().trim().max(200).optional(),
});

/**
 * `:id` route param.
 * @type {import("zod").ZodObject}
 */
export const productIdParamsSchema = z.object({ id: objectIdField });

/**
 * `:id/images/:imageId` route params.
 * @type {import("zod").ZodObject}
 */
export const productImageParamsSchema = z.object({ id: objectIdField, imageId: objectIdField });

/**
 * `:slug` route param.
 * @type {import("zod").ZodObject}
 */
export const productSlugParamsSchema = z.object({ slug: slugField });

/**
 * Optional `?tag=` filter shared by the public and admin product lists (tags are stored lowercase).
 * @type {import("zod").ZodOptional}
 */
const tagQueryField = z.string().trim().toLowerCase().min(1).max(30).optional();

/**
 * GET /products query.
 * @type {import("zod").ZodObject}
 */
export const listPublicProductsQuerySchema = z.object({
  ...paginationQueryShape(12),
  tag: tagQueryField,
});

/**
 * GET /admin/products query.
 * @type {import("zod").ZodObject}
 */
export const listAdminProductsQuerySchema = z.object({
  ...paginationQueryShape(20),
  search: z.string().trim().max(100).optional(),
  tag: tagQueryField,
  availabilityStatus: availabilityField.optional(),
  publicityStatus: publicityField.optional(),
});
