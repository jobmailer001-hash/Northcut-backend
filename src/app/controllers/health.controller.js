import { getHealth as getHealthHandler } from "#handlers/health.handler.js";

/**
 * GET /health — returns service health; 503 when a dependency is down.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {import("express").Response} The health envelope.
 */
export const getHealth = (req, res) => {
  const health = getHealthHandler();
  const statusCode = health.status === "ok" ? 200 : 503;
  return res.status(statusCode).json({ data: { health } });
};
