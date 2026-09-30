import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";
import connectMongoDb, { disconnectMongoDb } from "#db/mongodb/mongodb.connection.js";
import connectRedis, { disconnectRedis } from "#db/redis/redis.connection.js";
import { closeQueues } from "#queues/queues.js";

import { crashAndExit } from "./crash-and-exit.js";
import createExpressApp from "./express-app.factory.js";

/**
 * Stops accepting requests, then closes queues and database connections.
 * @param {import("node:http").Server} server - The running HTTP server.
 * @param {string} signal - The signal that triggered shutdown.
 * @returns {Promise<void>}
 */
const shutdown = async (server, signal) => {
  logger.info(`${signal} received, shutting down API`);
  server.close();
  await closeQueues();
  await Promise.all([disconnectMongoDb(), disconnectRedis()]);
  process.exit(0);
};

/**
 * API startup: connects MongoDB and Redis, and only once both are up builds the
 * Express app and starts listening.
 * @returns {Promise<void>}
 */
export const startApp = async () => {
  try {
    await Promise.all([connectMongoDb(), connectRedis()]);
  } catch (error) {
    await crashAndExit("A required service failed to connect", error);
  }

  const app = createExpressApp();

  const server = app.listen(env.port, () => {
    logger.info(`API listening on http://localhost:${env.port} (docs at /api/docs)`);
  });

  process.once("SIGINT", () => shutdown(server, "SIGINT"));
  process.once("SIGTERM", () => shutdown(server, "SIGTERM"));
};
