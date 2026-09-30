import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { uploadStagedHeroImage as uploadStagedHeroImageHandler } from "#handlers/site-settings.handler.js";
import { objectIdField } from "#validators/common.validator.js";

/**
 * Payload of a job on the `site-hero-images` queue. Only ids travel through Redis — the image
 * bytes are staged in MongoDB.
 * @type {import("zod").ZodObject}
 */
const siteHeroImageJobSchema = z.object({
  uploadId: objectIdField,
  adminId: objectIdField,
  context: z.object({ ip: z.string().optional(), userAgent: z.string().optional() }).default({}),
});

/**
 * Uploads a staged hero image to Cloudinary and sets it on its panel. Errors propagate so BullMQ
 * retries; the handler is idempotent.
 * @param {import("bullmq").Job} job - The site-hero-images job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processSiteHeroImageJob = async (job) => {
  const result = siteHeroImageJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid site-hero-images job payload: ${result.error.message}`);
  }

  await uploadStagedHeroImageHandler(result.data);
};
