import { Worker } from "bullmq";

import { logger } from "#configs/logger.config.js";
import createBullMqConnection from "#db/redis/bullmq.connection.js";
import { QueueNames } from "#queues/queues.js";

import { processEmailJob } from "./processors/emails.processor.js";
import { processLookImageJob } from "./processors/look-images.processor.js";
import { processOrderExpiryJob } from "./processors/order-expiry.processor.js";
import { processPaymentEventJob } from "./processors/payment-events.processor.js";
import { processProductImagesJob } from "./processors/product-images.processor.js";
import { processSiteHeroImageJob } from "./processors/site-hero-images.processor.js";
import { processRefundJob } from "./processors/refunds.processor.js";

/**
 * Processor for each queue the worker process consumes. Add an entry as each phase adds a queue.
 * @type {Record<string, (job: import("bullmq").Job) => Promise<void>>}
 */
const processors = {
  [QueueNames.EMAILS]: processEmailJob,
  [QueueNames.ORDER_EXPIRY]: processOrderExpiryJob,
  [QueueNames.PAYMENT_EVENTS]: processPaymentEventJob,
  [QueueNames.REFUNDS]: processRefundJob,
  [QueueNames.PRODUCT_IMAGES]: processProductImagesJob,
  [QueueNames.SITE_HERO_IMAGES]: processSiteHeroImageJob,
  [QueueNames.LOOK_IMAGES]: processLookImageJob,
};

/**
 * Running workers and their dedicated connections (BullMQ doesn't close connections it was given).
 * @type {{ worker: import("bullmq").Worker, connection: import("ioredis").Redis }[]}
 */
const runningWorkers = [];

/**
 * Starts one BullMQ worker per registered processor, all inside this one process,
 * each on its own connection because workers issue blocking Redis commands.
 * @returns {string[]} The names of the queues now being consumed.
 */
export const startQueueWorkers = () => {
  for (const [queueName, processor] of Object.entries(processors)) {
    const connection = createBullMqConnection();
    const worker = new Worker(queueName, processor, { connection });

    worker.on("failed", (job, error) => {
      logger.error(`Job failed on ${queueName}`, {
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        message: error.message,
      });
    });

    runningWorkers.push({ worker, connection });
  }

  return Object.keys(processors);
};

/**
 * Closes every running worker (letting active jobs finish), then their connections.
 * @returns {Promise<void>}
 */
export const closeQueueWorkers = async () => {
  await Promise.all(runningWorkers.map(({ worker }) => worker.close()));
  await Promise.all(runningWorkers.map(({ connection }) => connection.quit()));
  runningWorkers.length = 0;
};
