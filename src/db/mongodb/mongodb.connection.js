import mongoose from "mongoose";

import { mongodbConfig } from "#configs/mongodb.config.js";
import { logger } from "#configs/logger.config.js";

/**
 * Establishes the MongoDB connection (replica set, required for transactions).
 * @returns {Promise<import("mongoose").Mongoose>} The connected mongoose instance.
 * @throws {Error} If the connection attempt fails — the caller decides whether to crash.
 */
const connectMongoDb = async () => {
  const connection = await mongoose.connect(mongodbConfig.uri, mongodbConfig.options);
  logger.info("MongoDB connected");
  return connection;
};

/**
 * Closes the MongoDB connection during graceful shutdown.
 * @returns {Promise<void>}
 */
export const disconnectMongoDb = async () => {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
};

export default connectMongoDb;
