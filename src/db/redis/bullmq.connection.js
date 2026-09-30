import { Redis } from "ioredis";

import { bullmqConfig } from "#configs/redis.config.js";

/**
 * Creates a dedicated Redis connection for BullMQ queues and workers.
 * Each worker needs its own because it holds the connection with blocking commands.
 * @returns {import("ioredis").Redis} A new Redis connection configured for BullMQ.
 */
const createBullMqConnection = () => new Redis(bullmqConfig.url, bullmqConfig.options);

export default createBullMqConnection;
