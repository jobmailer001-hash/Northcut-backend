import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { processRefund as processRefundHandler } from "#handlers/payment.handler.js";
import { objectIdField } from "#validators/common.validator.js";

/**
 * Payload of a job on the `refunds` queue.
 * @type {import("zod").ZodObject}
 */
const refundJobSchema = z.object({ paymentTransactionId: objectIdField });

/**
 * Refunds one successful payment. Errors propagate so BullMQ retries; the handler is idempotent.
 * @param {import("bullmq").Job} job - The refunds job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processRefundJob = async (job) => {
  const result = refundJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid refunds job payload: ${result.error.message}`);
  }

  await processRefundHandler(result.data);
};
