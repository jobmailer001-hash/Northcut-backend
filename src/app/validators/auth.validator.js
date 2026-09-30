import { z } from "zod";

/**
 * Email field: trimmed and lowercased before format validation.
 * @type {import("zod").ZodType}
 */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

/**
 * New-password field. 72 is bcrypt's input limit.
 * @type {import("zod").ZodString}
 */
export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

/**
 * Display-name field.
 * @type {import("zod").ZodString}
 */
export const nameField = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(80, "Name must be at most 80 characters.");

/**
 * POST /auth/signup body.
 * @type {import("zod").ZodObject}
 */
export const signupBodySchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
});

/**
 * POST /auth/login body. Password is only checked for presence — its rules may have changed since it was set.
 * @type {import("zod").ZodObject}
 */
export const loginBodySchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required."),
});

/**
 * POST /auth/password-reset/request body.
 * @type {import("zod").ZodObject}
 */
export const passwordResetRequestBodySchema = z.object({
  email: emailField,
});

/**
 * POST /auth/password-reset/verify body.
 * @type {import("zod").ZodObject}
 */
export const passwordResetVerifyBodySchema = z.object({
  email: emailField,
  code: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code from the email."),
});

/**
 * POST /auth/password-reset/complete body.
 * @type {import("zod").ZodObject}
 */
export const passwordResetCompleteBodySchema = z.object({
  resetToken: z.uuid("Reset link is invalid."),
  password: passwordField,
});
