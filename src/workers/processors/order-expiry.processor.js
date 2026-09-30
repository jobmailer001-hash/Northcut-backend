import { UnrecoverableError } from "bullmq";
import { z } from "zod";

import { expireOrder as expireOrderHandler } from "#handlers/order.handler.js";
import { objectIdField } from "#validators/common.validator.js";

/**
 * Payload of a job on the `order-expiry` queue.
 * @type {import("zod").ZodObject}
 */
const orderExpiryJobSchema = z.object({ orderId: objectIdField });

/**
 * Processes a job from the `order-expiry` queue: expires the order if it's still unpaid.
 * Errors propagate so BullMQ retries; expiry is a no-op for paid/cancelled orders.
 * @param {import("bullmq").Job} job - The order-expiry job.
 * @returns {Promise<void>}
 * @throws {UnrecoverableError} When the payload is invalid — retrying can't fix it.
 */
export const processOrderExpiryJob = async (job) => {
  const result = orderExpiryJobSchema.safeParse(job.data);

  if (!result.success) {
    throw new UnrecoverableError(`Invalid order-expiry job payload: ${result.error.message}`);
  }

  await expireOrderHandler(result.data.orderId);
};
