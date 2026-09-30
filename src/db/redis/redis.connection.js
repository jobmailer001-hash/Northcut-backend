import { Redis } from "ioredis";

import { redisConfig } from "#configs/redis.config.js";
import { logger } from "#configs/logger.config.js";

/**
 * Shared Redis client for application data (sessions, password-reset codes).
 * Connects lazily so importing this module never opens a socket by itself.
 * @type {import("ioredis").Redis}
 */
export const redis = new Redis(redisConfig.url, redisConfig.options);

redis.on("error", (error) => logger.error("Redis error", { message: error.message }));

/**
 * Opens the shared Redis connection and confirms it responds.
 * @returns {Promise<void>}
 * @throws {Error} If Redis is unreachable — the caller decides whether to crash.
 */
const connectRedis = async () => {
  await redis.connect();
  await redis.ping();
  logger.info("Redis connected");
};

/**
 * Closes the shared Redis connection during graceful shutdown.
 * @returns {Promise<void>}
 */
export const disconnectRedis = async () => {
  await redis.quit();
  logger.info("Redis disconnected");
};

export default connectRedis;
