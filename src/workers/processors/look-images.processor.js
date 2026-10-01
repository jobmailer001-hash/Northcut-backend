import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { uploadStagedLookImage as uploadStagedLookImageHandler } from "#handlers/look.handler.js";
import { objectIdField } from "#validators/common.validator.js";

/**
 * Payload of a job on the `look-images` queue. Only ids travel through Redis — the image
 * bytes are staged in MongoDB.
 * @type {import("zod").ZodObject}
 */
const lookImageJobSchema = z.object({
  uploadId: objectIdField,
  adminId: objectIdField,
  context: z.object({ ip: z.string().optional(), userAgent: z.string().optional() }).default({}),
});

/**
 * Uploads a staged look image to Cloudinary and sets it on its look. Errors propagate so BullMQ
 * retries; the handler is idempotent.
 * @param {import("bullmq").Job} job - The look-images job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processLookImageJob = async (job) => {
  const result = lookImageJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid look-images job payload: ${result.error.message}`);
  }

  await uploadStagedLookImageHandler(result.data);
};
