import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { env } from "#configs/env.config.js";
import { errorHandler } from "#middlewares/error-handler.middleware.js";
import { notFoundHandler } from "#middlewares/not-found.middleware.js";
import { v1Routes } from "#routes/v1.routes.js";

/**
 * Absolute path of the hand-written API spec (northcut-backend/docs/openapi.yaml).
 * @type {string}
 */
const OPENAPI_SPEC_PATH = fileURLToPath(new URL("../../docs/openapi.yaml", import.meta.url));

/**
 * URL the raw spec is served at; Swagger UI loads it from here.
 * @type {string}
 */
const OPENAPI_SPEC_URL = "/api/docs/openapi.yaml";

/**
 * Builds the Express application: API docs, security headers, CORS (with credentials,
 * for the refresh cookie), cookie and JSON parsing, the v1 routes, and the centralized
 * 404/error handlers. Called only after every database has connected.
 * @returns {import("express").Express} The configured app, ready to `listen`.
 */
const createExpressApp = () => {
  /** @type {import("express").Express} */
  const app = express();

  // Docs are mounted before helmet: its default CSP (upgrade-insecure-requests,
  // strict script-src) stops Swagger UI loading its assets over plain http locally.
  // The raw spec route comes first — Swagger UI's handler answers every path under /api/docs.
  app.get(OPENAPI_SPEC_URL, (req, res) => res.type("text/yaml").sendFile(OPENAPI_SPEC_PATH));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(null, { swaggerOptions: { url: OPENAPI_SPEC_URL } }));

  app.use(helmet());
  // Needed locally, where the frontend (localhost:5173) calls the API (localhost:4000) cross-origin.
  // In production the frontend proxies /api/* to this API (vercel.json), so browser requests are
  // same-origin and CORS never applies — CLIENT_URL must still be the frontend's URL (it's also
  // used for links in emails and the payment return page).
  app.use(cors({ origin: env.clientUrl, credentials: true }));
  app.use(cookieParser());
  // Keep the exact bytes too: webhook signatures are computed over the raw body, not re-serialised JSON.
  app.use(
    express.json({
      verify: (req, res, buffer) => {
        req.rawBody = buffer;
      },
    }),
  );

  app.use("/api/v1", v1Routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createExpressApp;
