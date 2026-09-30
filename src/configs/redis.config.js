import { env } from "#configs/env.config.js";

/**
 * Settings for the shared application Redis client (sessions, password-reset codes).
 * Connects lazily so importing the client never opens a socket by itself.
 * @type {{ url: string, options: import("ioredis").RedisOptions }}
 */
export const redisConfig = {
  url: env.redisUrl,
  options: { lazyConnect: true },
};

/**
 * Settings for BullMQ queue and worker connections.
 * BullMQ requires maxRetriesPerRequest to be null because workers issue blocking commands.
 * @type {{ url: string, options: import("ioredis").RedisOptions }}
 */
export const bullmqConfig = {
  url: env.redisUrl,
  options: { maxRetriesPerRequest: null },
};
