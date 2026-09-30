import { Router } from "express";

import {
  changePassword,
  completePasswordReset,
  login,
  logout,
  refresh,
  requestPasswordReset,
  signup,
  verifyPasswordResetCode,
} from "#controllers/auth.controller.js";
import { authenticate } from "#middlewares/authenticate.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import { changePasswordBodySchema } from "#validators/me.validator.js";
import {
  loginBodySchema,
  passwordResetCompleteBodySchema,
  passwordResetRequestBodySchema,
  passwordResetVerifyBodySchema,
  signupBodySchema,
} from "#validators/auth.validator.js";

/**
 * Auth routes, mounted at /api/v1/auth.
 * @type {import("express").Router}
 */
export const authRoutes = Router();

authRoutes.post("/signup", validate({ body: signupBodySchema }), signup);
authRoutes.post("/login", validate({ body: loginBodySchema }), login);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);
authRoutes.patch("/password", authenticate, validate({ body: changePasswordBodySchema }), changePassword);
authRoutes.post("/password-reset/request", validate({ body: passwordResetRequestBodySchema }), requestPasswordReset);
authRoutes.post("/password-reset/verify", validate({ body: passwordResetVerifyBodySchema }), verifyPasswordResetCode);
authRoutes.post("/password-reset/complete", validate({ body: passwordResetCompleteBodySchema }), completePasswordReset);
