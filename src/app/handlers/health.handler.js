import mongoose from "mongoose";

import { redis } from "#db/redis/redis.connection.js";

/**
 * Mongoose readyState value meaning "connected".
 * @type {number}
 */
const MONGO_CONNECTED_STATE = 1;

/**
 * Reports whether the API's backing services are reachable.
 * @returns {{ status: "ok" | "degraded", mongo: boolean, redis: boolean, uptimeSeconds: number }} Service health.
 */
export const getHealth = () => {
  const isMongoConnected = mongoose.connection.readyState === MONGO_CONNECTED_STATE;
  const isRedisConnected = redis.status === "ready";

  return {
    status: isMongoConnected && isRedisConnected ? "ok" : "degraded",
    mongo: isMongoConnected,
    redis: isRedisConnected,
    uptimeSeconds: Math.round(process.uptime()),
  };
};
