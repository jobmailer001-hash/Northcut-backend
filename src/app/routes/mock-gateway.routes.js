import { Router } from "express";
import { z } from "zod";

import { completeCheckout, getCheckout } from "#controllers/mock-gateway.controller.js";
import { validate } from "#middlewares/validate.middleware.js";

/**
 * `:reference` route param — payment references are `NCPAY-<uuid>`.
 * @type {import("zod").ZodObject}
 */
const referenceParamsSchema = z.object({
  reference: z.string().regex(/^NCPAY-[0-9a-f-]{36}$/i, "Invalid payment reference."),
});

/**
 * Body for settling a fake payment.
 * @type {import("zod").ZodObject}
 */
const completeBodySchema = z.object({ outcome: z.enum(["success", "failure"]) });

/**
 * Fake payment gateway for development, mounted at /api/v1/mock-gateway only when
 * PAYMENT_PROVIDER=mock outside production (see v1.routes.js). Public on purpose: it stands in
 * for a provider's hosted checkout; the unguessable reference is the only key.
 * @type {import("express").Router}
 */
export const mockGatewayRoutes = Router();

mockGatewayRoutes.get("/payments/:reference", validate({ params: referenceParamsSchema }), getCheckout);
mockGatewayRoutes.post(
  "/payments/:reference/complete",
  validate({ params: referenceParamsSchema, body: completeBodySchema }),
  completeCheckout,
);
