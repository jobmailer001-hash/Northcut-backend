import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { uploadStagedProductImages as uploadStagedProductImagesHandler } from "#handlers/product.handler.js";
import { objectIdField } from "#validators/common.validator.js";

/**
 * Payload of a job on the `product-images` queue. Only ids travel through Redis — the image
 * bytes are staged in MongoDB.
 * @type {import("zod").ZodObject}
 */
const productImagesJobSchema = z.object({
  uploadId: objectIdField,
  adminId: objectIdField,
  context: z.object({ ip: z.string().optional(), userAgent: z.string().optional() }).default({}),
});

/**
 * Uploads a staged batch of product images to Cloudinary and attaches them. Errors propagate so
 * BullMQ retries; the handler is idempotent.
 * @param {import("bullmq").Job} job - The product-images job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processProductImagesJob = async (job) => {
  const result = productImagesJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid product-images job payload: ${result.error.message}`);
  }

  await uploadStagedProductImagesHandler(result.data);
};
