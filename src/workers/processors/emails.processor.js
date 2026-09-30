import { UnrecoverableError } from "bullmq";

import { deliverEmail as deliverEmailHandler } from "#handlers/email.handler.js";
import { emailJobSchema } from "#validators/email.validator.js";

/**
 * Processes a job from the `emails` queue: validates the payload, then sends.
 * Send errors propagate so BullMQ retries the job.
 * @param {import("bullmq").Job} job - The emails job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processEmailJob = async (job) => {
  const result = emailJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid emails job payload: ${result.error.message}`);
  }

  await deliverEmailHandler(result.data);
};

