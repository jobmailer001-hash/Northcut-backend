import { Queue } from "bullmq";

import createBullMqConnection from "#db/redis/bullmq.connection.js";

/**
 * Names of every BullMQ queue, shared by the API (producers) and the worker (consumers).
 * @type {Readonly<Record<string, string>>}
 */
export const QueueNames = {
  ORDER_EXPIRY: "order-expiry",
  PAYMENT_EVENTS: "payment-events",
  REFUNDS: "refunds",
  EMAILS: "emails",
  PRODUCT_IMAGES: "product-images",
  SITE_HERO_IMAGES: "site-hero-images",
};

/**
 * Retry and retention defaults for every job: 3 attempts with exponential backoff,
 * keeping a bounded history of completed and failed jobs for inspection.
 * @type {import("bullmq").DefaultJobOptions}
 */
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

/**
 * Lazily created queue instances, keyed by queue name, so importing this module
 * opens no Redis connection until a job is actually enqueued.
 * @type {Map<string, import("bullmq").Queue>}
 */
const queues = new Map();

/**
 * Connection shared by all producer queues; created on first use.
 * @type {import("ioredis").Redis | undefined}
 */
let queueConnection;

/**
 * Returns the producer queue for a name, creating it on first use.
 * @param {string} queueName - One of QueueNames.
 * @returns {import("bullmq").Queue} The queue instance.
 */
export const getQueue = (queueName) => {
  queueConnection ??= createBullMqConnection();

  if (!queues.has(queueName)) {
    queues.set(queueName, new Queue(queueName, { connection: queueConnection, defaultJobOptions }));
  }

  return queues.get(queueName);
};

/**
 * Closes every open producer queue and their shared connection during graceful shutdown.
 * @returns {Promise<void>}
 */
export const closeQueues = async () => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  await queueConnection?.quit();
  queueConnection = undefined;
};
