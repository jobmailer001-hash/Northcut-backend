import { createServer } from "node:http";

import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";

/**
 * Sends a JSON response in the API's `{ data }` / `{ error }` envelope.
 * @param {import("node:http").ServerResponse} res - The response.
 * @param {number} status - HTTP status.
 * @param {Object} body - The envelope.
 * @returns {void}
 */
const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/**
 * Starts a tiny HTTP server inside the worker process. The worker has no HTTP work of its own, but
 * a hosted web service (e.g. Render's free tier) must bind a port, and gets put to sleep without
 * traffic — so an external cron (cron-job.org) pings /keep-alive to keep it awake.
 *   GET /health     → status + queues being processed (for the host's health check)
 *   GET /keep-alive → a lightweight ping target for the cron
 * @param {Object} options
 * @param {string[]} options.queueNames - Queues this worker processes (reported by /health).
 * @returns {Promise<import("node:http").Server>} The listening server.
 */
export const startWorkerHealthServer = ({ queueNames }) => {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } });
      return;
    }

    if (path === "/health") {
      sendJson(res, 200, {
        data: { status: "ok", queues: queueNames, uptimeSeconds: Math.round(process.uptime()) },
      });
      return;
    }

    if (path === "/keep-alive") {
      sendJson(res, 200, { data: { status: "awake", at: new Date().toISOString() } });
      return;
    }

    sendJson(res, 404, { error: { code: "ROUTE_NOT_FOUND", message: "Not found." } });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.workerPort, () => {
      logger.info(`Worker health server listening on port ${env.workerPort} (/health, /keep-alive)`);
      resolve(server);
    });
  });
};
