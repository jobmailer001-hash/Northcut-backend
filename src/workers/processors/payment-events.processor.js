import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { processPaymentEvent as processPaymentEventHandler } from "#handlers/payment.handler.js";

/**
 * Payload of a job on the `payment-events` queue (queued by the webhook).
 * @type {import("zod").ZodObject}
 */
const paymentEventJobSchema = z.object({ event: z.string(), reference: z.string().min(1) });

/**
 * Processes a payment webhook event: verifies with the provider and applies it.
 * Errors propagate so BullMQ retries; the handler is idempotent.
 * @param {import("bullmq").Job} job - The payment-events job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processPaymentEventJob = async (job) => {
  const result = paymentEventJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid payment-events job payload: ${result.error.message}`);
  }

  await processPaymentEventHandler({ reference: result.data.reference });
};
