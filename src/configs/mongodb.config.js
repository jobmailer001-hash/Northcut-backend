import { env } from "#configs/env.config.js";

/**
 * MongoDB connection settings. The URI must point at a replica set — transactions require one.
 * @type {{ uri: string, options: import("mongoose").ConnectOptions }}
 */
export const mongodbConfig = {
  uri: env.mongoUri,
  options: {},
};
