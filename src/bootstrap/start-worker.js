import { logger } from "#configs/logger.config.js";
import connectMongoDb, { disconnectMongoDb } from "#db/mongodb/mongodb.connection.js";
import connectRedis, { disconnectRedis } from "#db/redis/redis.connection.js";
import { closeQueues } from "#queues/queues.js";
import { startWorkerHealthServer } from "#workers/health-server.js";
import { closeQueueWorkers, startQueueWorkers } from "#workers/queue-workers.js";

import { crashAndExit } from "./crash-and-exit.js";

/**
 * Stops the health server, closes workers (letting active jobs finish), queues, and database connections.
 * @param {import("node:http").Server} healthServer - The worker's health server.
 * @param {string} signal - The signal that triggered shutdown.
 * @returns {Promise<void>}
 */
const shutdown = async (healthServer, signal) => {
  logger.info(`${signal} received, shutting down worker`);
  healthServer.close();
  await closeQueueWorkers();
  await closeQueues();
  await Promise.all([disconnectMongoDb(), disconnectRedis()]);
  process.exit(0);
};

/**
 * Worker startup: connects MongoDB and Redis, and only once both are up starts every
 * queue processor inside this single worker process (separate from the API), plus a small
 * health server (/health, /keep-alive) so it can run as a hosted web service.
 * @returns {Promise<void>}
 */
export const startWorker = async () => {
  try {
    await Promise.all([connectMongoDb(), connectRedis()]);
  } catch (error) {
    await crashAndExit("A required service failed to connect", error);
  }

  const queueNames = startQueueWorkers();
  logger.info(`Worker started: ${queueNames.join(", ")}`);

  let healthServer;
  try {
    healthServer = await startWorkerHealthServer({ queueNames });
  } catch (error) {
    // e.g. the port is taken — locally, set WORKER_PORT so it doesn't clash with the API.
    await crashAndExit("The worker health server failed to start", error);
  }

  process.once("SIGINT", () => shutdown(healthServer, "SIGINT"));
  process.once("SIGTERM", () => shutdown(healthServer, "SIGTERM"));
};
