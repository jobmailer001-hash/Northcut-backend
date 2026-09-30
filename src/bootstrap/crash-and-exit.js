import mongoose from "mongoose";

import { logger } from "#configs/logger.config.js";
import { redis } from "#db/redis/redis.connection.js";

/**
 * Disconnects every connection startup may have opened — MongoDB and the shared
 * Redis client — ignoring any that was never established or fails to close, so a
 * startup crash never hangs on a connection that isn't really there.
 * @returns {Promise<void>}
 */
const disconnectAllConnections = async () => {
  const connections = [
    { name: "MongoDB", disconnect: () => mongoose.disconnect() },
    // disconnect(), not quit(): quit() waits for a reply from a server that may be unreachable.
    { name: "Redis", disconnect: () => redis.disconnect() },
  ];

  await Promise.all(
    connections.map(async ({ name, disconnect }) => {
      try {
        await disconnect();
      } catch (error) {
        logger.error(`Failed to cleanly disconnect ${name} during crash — continuing`, { message: error.message });
      }
    }),
  );
};

/**
 * Logs why startup failed, disconnects anything already connected, then exits with
 * a non-zero code. A partially-connected process must never be left running.
 * @param {string} reason - What failed (e.g. "A required service failed to connect").
 * @param {Error} error - The underlying error.
 * @returns {Promise<never>}
 */
export const crashAndExit = async (reason, error) => {
  logger.error(`Startup failed: ${reason}`, { message: error.message, stack: error.stack });
  await disconnectAllConnections();
  process.exit(1);
};
