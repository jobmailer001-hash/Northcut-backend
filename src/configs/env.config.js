import "dotenv/config";
import { z } from "zod";

/**
 * Schema for every environment variable the API and worker read.
 * Add new variables here and to `.env.example` in the same change.
 * @type {import("zod").ZodObject}
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // The worker's health server port. Unset on a host (it binds PORT, which the host assigns per
  // service); set locally, where the API and worker share one .env and PORT is the API's.
  WORKER_PORT: z.coerce.number().int().positive().optional(),
  CLIENT_URL: z.url(),
  API_URL: z.url().optional(),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  ORDER_HOLD_MINUTES: z.coerce.number().int().positive().default(30),
  SHIPPING_FEE_KOBO: z.coerce.number().int().nonnegative().default(0),
  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, "PAYMENT_WEBHOOK_SECRET must be at least 16 characters"),
  // The mock gateway is off in production unless deliberately enabled (a deployed demo with no real gateway yet).
  ALLOW_MOCK_PAYMENTS: z.enum(["true", "false"]).default("false"),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_FOLDER: z.string().min(1).default("northcut"),
});

/**
 * Parses process.env against the schema, exiting the process when it is invalid
 * so a misconfigured app fails at startup rather than on first use.
 * @returns {z.infer<typeof envSchema>} The validated environment variables.
 */
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // The logger depends on env, so this is the one place console is used directly.
    console.error("Invalid environment configuration:\n", z.prettifyError(result.error));
    process.exit(1);
  }

  return result.data;
};

const parsedEnv = parseEnv();

/**
 * Validated application configuration.
 * @type {{
 *   nodeEnv: string, isProduction: boolean, port: number, workerPort: number, clientUrl: string, apiUrl: string,
 *   paymentProvider: string, paymentWebhookSecret: string, isMockGatewayEnabled: boolean,
 *   mongoUri: string, redisUrl: string, logLevel: string,
 *   jwtAccessSecret: string, accessTokenTtlSeconds: number, refreshTokenTtlSeconds: number,
 *   passwordResetCodeTtlSeconds: number, passwordResetTokenTtlSeconds: number,
 *   orderHoldMs: number, shippingFee: number,
 *   cloudinary: { cloudName: string, apiKey: string, apiSecret: string, folder: string }
 * }}
 */
export const env = {
  nodeEnv: parsedEnv.NODE_ENV,
  isProduction: parsedEnv.NODE_ENV === "production",
  port: parsedEnv.PORT,
  workerPort: parsedEnv.WORKER_PORT ?? parsedEnv.PORT,
  clientUrl: parsedEnv.CLIENT_URL,
  // Where this API is reachable — the mock payment gateway sends webhooks here.
  apiUrl: parsedEnv.API_URL ?? `http://localhost:${parsedEnv.PORT}`,
  paymentProvider: parsedEnv.PAYMENT_PROVIDER,
  paymentWebhookSecret: parsedEnv.PAYMENT_WEBHOOK_SECRET,
  // The fake payment gateway: always on in development; in production only with ALLOW_MOCK_PAYMENTS=true.
  isMockGatewayEnabled:
    parsedEnv.PAYMENT_PROVIDER === "mock" &&
    (parsedEnv.NODE_ENV !== "production" || parsedEnv.ALLOW_MOCK_PAYMENTS === "true"),
  mongoUri: parsedEnv.MONGO_URI,
  redisUrl: parsedEnv.REDIS_URL,
  logLevel: parsedEnv.LOG_LEVEL,
  jwtAccessSecret: parsedEnv.JWT_ACCESS_SECRET,
  accessTokenTtlSeconds: parsedEnv.ACCESS_TOKEN_TTL_MINUTES * 60,
  refreshTokenTtlSeconds: parsedEnv.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  passwordResetCodeTtlSeconds: parsedEnv.PASSWORD_RESET_CODE_TTL_MINUTES * 60,
  passwordResetTokenTtlSeconds: parsedEnv.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60,
  orderHoldMs: parsedEnv.ORDER_HOLD_MINUTES * 60 * 1000,
  shippingFee: parsedEnv.SHIPPING_FEE_KOBO,
  cloudinary: {
    cloudName: parsedEnv.CLOUDINARY_CLOUD_NAME,
    apiKey: parsedEnv.CLOUDINARY_API_KEY,
    apiSecret: parsedEnv.CLOUDINARY_API_SECRET,
    folder: parsedEnv.CLOUDINARY_FOLDER,
  },
};
