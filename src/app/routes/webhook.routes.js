import { Router } from "express";

import { receivePaymentWebhook } from "#controllers/webhook.controller.js";

/**
 * Routes called by third parties, mounted at /api/v1/webhooks. Authenticated by signature, not login.
 * @type {import("express").Router}
 */
export const webhookRoutes = Router();

webhookRoutes.post("/payments", receivePaymentWebhook);
